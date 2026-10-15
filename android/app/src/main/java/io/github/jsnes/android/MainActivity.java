package io.github.jsnes.android;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ContentValues;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.DocumentsContract;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayDeque;
import java.util.Collections;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private static final String ORIGIN = "https://appassets.androidplatform.net";
    private static final int PICK_DIRECTORY = 100, PICK_ROM = 101, SAVE_IMAGE = 102;
    private static final int MAX_ROM_BYTES = 16 * 1024 * 1024;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final Map<String, Uri> romUris = new ConcurrentHashMap<>();
    private WebView webView;
    private SharedPreferences preferences;
    private BridgeRequest pickerRequest;
    private byte[] pendingImage;
    private boolean resumed;

    @SuppressLint("SetJavaScriptEnabled")
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        preferences = getSharedPreferences("library", MODE_PRIVATE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xff101416);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            } else {
                view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                    insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            }
            return insets;
        });
        webView = new WebView(this);
        WebView.setWebContentsDebuggingEnabled((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0);
        root.addView(webView, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);
        root.requestApplyInsets();
        webView.setBackgroundColor(0xff101416);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setSupportMultipleWindows(false);

        WebViewAssetLoader assets = new WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this)).build();
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                // The native bridge is available exclusively to the packaged page.
                return !isLocal(request.getUrl());
            }

            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (!isLocal(uri)) return response(403, "Forbidden", "text/plain", new byte[0]);
                if (uri.getPath() != null && uri.getPath().startsWith("/rom/")) {
                    try {
                        Uri document = romUris.get(uri.getLastPathSegment());
                        if (document == null) throw new IOException("ROM 未授权，请重新选择文件或目录");
                        try (InputStream input = getContentResolver().openInputStream(document)) {
                            byte[] bytes = readLimited(input, MAX_ROM_BYTES);
                            if (bytes.length < 16 || bytes[0] != 'N' || bytes[1] != 'E' || bytes[2] != 'S' || bytes[3] != 0x1a) {
                                throw new IOException("文件不是有效的 iNES ROM");
                            }
                            return response(200, "OK", "application/octet-stream", bytes);
                        }
                    } catch (Exception error) {
                        return response(400, "Bad Request", "text/plain", message(error).getBytes(java.nio.charset.StandardCharsets.UTF_8));
                    }
                }
                WebResourceResponse resource = assets.shouldInterceptRequest(uri);
                return resource != null ? resource : response(404, "Not Found", "text/plain", new byte[0]);
            }
        });

        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            new AlertDialog.Builder(this).setMessage("请先更新 Android System WebView 或 Chrome，再启动 JSNES。")
                .setPositiveButton("关闭", (dialog, which) -> finish()).setCancelable(false).show();
            return;
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
        WebViewCompat.addWebMessageListener(webView, "NativeHost", Collections.singleton(ORIGIN),
            (view, message, sourceOrigin, isMainFrame, reply) -> {
                if (!isMainFrame || !ORIGIN.equals(sourceOrigin.toString())) return;
                try {
                    JSONObject payload = new JSONObject(message.getData());
                    BridgeRequest request = new BridgeRequest(payload.getString("id"), reply);
                    dispatch(request, payload.getString("method"), payload.optJSONObject("params"));
                } catch (Exception ignored) {
                    // Ignore malformed messages without a usable request ID.
                }
            });
        }
        webView.loadUrl(ORIGIN + "/assets/web/index.html");
    }

    private static boolean isLocal(Uri uri) {
        return "https".equals(uri.getScheme()) && "appassets.androidplatform.net".equals(uri.getHost())
            && (uri.getPort() == -1 || uri.getPort() == 443);
    }

    private void dispatch(BridgeRequest request, String method, JSONObject params) {
        switch (method) {
            case "listDirectory":
                worker.execute(() -> scanSavedDirectory(request));
                break;
            case "pickDirectory":
            case "pickRom":
                if (pickerRequest != null) { request.fail("文件选择器正在使用中"); return; }
                pickerRequest = request;
                Intent intent = new Intent(method.equals("pickDirectory") ? Intent.ACTION_OPEN_DOCUMENT_TREE : Intent.ACTION_OPEN_DOCUMENT);
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
                if (method.equals("pickRom")) { intent.setType("*/*"); intent.addCategory(Intent.CATEGORY_OPENABLE); }
                try { startActivityForResult(intent, method.equals("pickDirectory") ? PICK_DIRECTORY : PICK_ROM); }
                catch (Exception error) { pickerRequest = null; request.fail(message(error)); }
                break;
            case "saveScreenshot":
                if (params == null) { request.fail("缺少截图内容"); return; }
                saveScreenshot(request, params);
                break;
            case "exit":
                request.ok(new JSONObject());
                finish();
                break;
            default: request.fail("未知操作：" + method);
        }
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != PICK_DIRECTORY && requestCode != PICK_ROM && requestCode != SAVE_IMAGE) return;
        BridgeRequest request = pickerRequest;
        pickerRequest = null;
        byte[] image = pendingImage;
        pendingImage = null;
        if (request == null) return;
        if (resultCode != RESULT_OK || data == null || data.getData() == null) {
            request.ok(json("canceled", true));
            return;
        }
        Uri uri = data.getData();
        worker.execute(() -> {
            try {
                if (requestCode == SAVE_IMAGE) {
                    writeImage(uri, image);
                    request.ok(json("saved", true));
                } else {
                    try {
                        if ((data.getFlags() & Intent.FLAG_GRANT_READ_URI_PERMISSION) != 0) {
                            getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        }
                    } catch (SecurityException ignored) { /* Some providers offer a session grant only. */ }
                    if (requestCode == PICK_DIRECTORY) {
                        String previous = preferences.getString("tree", null);
                        JSONObject library = scanDirectory(uri);
                        preferences.edit().putString("tree", uri.toString()).apply();
                        // Retain only the selected directory's persisted grant.
                        if (previous != null && !previous.equals(uri.toString())) {
                            try { getContentResolver().releasePersistableUriPermission(Uri.parse(previous), Intent.FLAG_GRANT_READ_URI_PERMISSION); }
                            catch (SecurityException ignored) { }
                        }
                        request.ok(library);
                    } else {
                        String name = documentName(uri);
                        if (!name.toLowerCase(Locale.ROOT).endsWith(".nes")) throw new IOException("请选择 .nes 文件");
                        request.ok(json("rom", registerRom(uri, name, name)));
                    }
                }
            } catch (Exception error) { request.fail(message(error)); }
        });
    }

    private void scanSavedDirectory(BridgeRequest request) {
        String saved = preferences.getString("tree", null);
        try {
            request.ok(saved == null ? json("roms", new JSONArray()) : scanDirectory(Uri.parse(saved)));
        } catch (Exception error) { request.fail("目录不可读，请重新授权：" + message(error)); }
    }

    private JSONObject scanDirectory(Uri tree) throws Exception {
        JSONArray roms = new JSONArray();
        ArrayDeque<String[]> queue = new ArrayDeque<>();
        queue.add(new String[]{DocumentsContract.getTreeDocumentId(tree), "", "0"});
        HashSet<String> visited = new HashSet<>();
        int scanned = 0;
        boolean truncated = false;
        while (!queue.isEmpty()) {
            if (Thread.currentThread().isInterrupted()) throw new IOException("扫描已停止");
            String[] folder = queue.removeFirst();
            if (!visited.add(folder[0])) continue;
            Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, folder[0]);
            String[] columns = {DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                DocumentsContract.Document.COLUMN_MIME_TYPE};
            try (Cursor cursor = getContentResolver().query(children, columns, null, null, null)) {
                if (cursor == null) throw new IOException("无法读取目录");
                while (cursor.moveToNext()) {
                    if (++scanned > 20000 || roms.length() >= 5000) { truncated = true; break; }
                    String id = cursor.getString(0), name = cursor.getString(1), mime = cursor.getString(2);
                    if (id == null || name == null) continue;
                    String path = folder[1] + name;
                    if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) {
                        int depth = Integer.parseInt(folder[2]);
                        if (depth < 32) queue.add(new String[]{id, path + "/", String.valueOf(depth + 1)});
                        else truncated = true;
                    } else if (name.toLowerCase(Locale.ROOT).endsWith(".nes")) {
                        roms.put(registerRom(DocumentsContract.buildDocumentUriUsingTree(tree, id), name, path));
                    }
                }
            } catch (SecurityException error) {
                if (folder[1].isEmpty()) throw error;
                truncated = true;
            }
            if (scanned > 20000 || roms.length() >= 5000) break;
        }
        JSONObject result = json("roms", roms);
        result.put("folder", documentName(DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree))));
        result.put("truncated", truncated);
        return result;
    }

    private JSONObject registerRom(Uri uri, String name, String path) throws Exception {
        String id = UUID.nameUUIDFromBytes(uri.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8)).toString();
        romUris.put(id, uri);
        JSONObject rom = json("id", id);
        rom.put("name", name);
        rom.put("path", path);
        rom.put("url", ORIGIN + "/rom/" + id);
        return rom;
    }

    private String documentName(Uri uri) {
        try (Cursor cursor = getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) return cursor.getString(0);
        } catch (Exception ignored) { }
        return "NES 游戏目录";
    }

    private void saveScreenshot(BridgeRequest request, JSONObject params) {
        try {
            String data = params.getString("dataUrl");
            if (!data.startsWith("data:image/png;base64,") || data.length() > 2 * 1024 * 1024) throw new IOException("截图格式无效");
            byte[] image = Base64.decode(data.substring(22), Base64.DEFAULT);
            if (image.length < 8 || image[0] != (byte) 137 || image[1] != 80 || image[2] != 78 || image[3] != 71) throw new IOException("截图必须为 PNG");
            String name = params.optString("name", "JSNES").replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_");
            if (name.length() > 80) name = name.substring(0, 80);
            final String filename = name + "-" + System.currentTimeMillis() + ".png";
            if (Build.VERSION.SDK_INT >= 29) {
                worker.execute(() -> {
                    Uri uri = null;
                    try {
                        ContentValues values = new ContentValues();
                        values.put(MediaStore.Images.Media.DISPLAY_NAME, filename);
                        values.put(MediaStore.Images.Media.MIME_TYPE, "image/png");
                        values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/JSNES");
                        values.put(MediaStore.Images.Media.IS_PENDING, 1);
                        uri = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
                        if (uri == null) throw new IOException("无法创建截图");
                        writeImage(uri, image);
                        values.clear();
                        values.put(MediaStore.Images.Media.IS_PENDING, 0);
                        getContentResolver().update(uri, values, null, null);
                        request.ok(json("saved", "Pictures/JSNES/" + filename));
                    } catch (Exception error) {
                        if (uri != null) getContentResolver().delete(uri, null, null);
                        request.fail(message(error));
                    }
                });
            } else {
                if (pickerRequest != null) throw new IOException("文件选择器正在使用中");
                pickerRequest = request;
                pendingImage = image;
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).setType("image/png")
                    .addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_TITLE, filename);
                try { startActivityForResult(intent, SAVE_IMAGE); }
                catch (Exception error) { pickerRequest = null; pendingImage = null; throw error; }
            }
        } catch (Exception error) { request.fail(message(error)); }
    }

    private void writeImage(Uri uri, byte[] image) throws IOException {
        try (OutputStream output = getContentResolver().openOutputStream(uri, "w")) {
            if (output == null || image == null) throw new IOException("无法写入截图");
            output.write(image);
        }
    }

    private static byte[] readLimited(InputStream input, int limit) throws IOException {
        if (input == null) throw new IOException("文件不可读");
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int count;
        while ((count = input.read(buffer)) != -1) {
            if (output.size() + count > limit) throw new IOException("ROM 超过 16 MiB 限制");
            output.write(buffer, 0, count);
        }
        return output.toByteArray();
    }

    private static WebResourceResponse response(int status, String reason, String mime, byte[] bytes) {
        return new WebResourceResponse(mime, "UTF-8", status, reason,
            Collections.singletonMap("Cache-Control", "no-store"), new ByteArrayInputStream(bytes));
    }

    private static JSONObject json(String key, Object value) {
        JSONObject result = new JSONObject();
        try { result.put(key, value); } catch (Exception ignored) { }
        return result;
    }

    private static String message(Exception error) {
        return error.getMessage() == null ? "操作失败" : error.getMessage();
    }

    private final class BridgeRequest {
        final String id;
        final JavaScriptReplyProxy reply;
        BridgeRequest(String id, JavaScriptReplyProxy reply) { this.id = id; this.reply = reply; }
        void ok(JSONObject result) { send("result", result); }
        void fail(String error) { send("error", error); }
        void send(String key, Object value) {
            JSONObject response = json("id", id);
            try { response.put(key, value); } catch (Exception ignored) { }
            runOnUiThread(() -> {
                if (!isDestroyed() && WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
                    reply.postMessage(response.toString());
                }
            });
        }
    }

    @Override protected void onResume() {
        super.onResume();
        resumed = true;
        if (webView != null) { webView.onResume(); dispatchLifecycle(true); }
    }

    @Override protected void onPause() {
        resumed = false;
        dispatchLifecycle(false);
        if (webView != null) webView.onPause();
        super.onPause();
    }

    private void dispatchLifecycle(boolean active) {
        if (webView != null) webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('jsnes:lifecycle',{detail:{active:" + active + "}}))", null);
    }

    @Override public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (!hasFocus && resumed) dispatchLifecycle(false);
    }

    @Override public void onBackPressed() {
        if (webView != null) webView.evaluateJavascript("window.dispatchEvent(new Event('jsnes:back'))", null);
        else super.onBackPressed();
    }

    @Override protected void onDestroy() {
        worker.shutdownNow();
        if (webView != null) {
            webView.removeAllViews();
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
