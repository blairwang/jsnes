package io.github.jsnes.android;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.FileAlreadyExistsException;
import java.nio.file.Files;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

/** File-backed saves. Call from the activity's single worker to serialize writes. */
final class SaveStore {
    private static final String EXTENSION = ".jsnes.json";
    private static final int MAX_BYTES = 16 * 1024 * 1024;
    private final File root;

    SaveStore(File root) { this.root = root; }

    JSONObject execute(String method, JSONObject params) throws Exception {
        if (params == null) throw new IOException("缺少存档参数");
        String romKey = params.optString("romKey");
        if (!romKey.matches("[0-9a-f]{64}")) throw new IOException("游戏标识无效");
        switch (method) {
            case "listStates": return list(romKey);
            case "saveState": return save(params, romKey);
            case "readState": {
                File file = resolve(params.getString("id"));
                checkGame(file, romKey);
                if (file.length() > MAX_BYTES) throw new IOException("存档文件超过 16 MiB");
                JSONObject document = new JSONObject(new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8));
                JSONObject result = new JSONObject();
                result.put("state", document.getJSONObject("state"));
                return result;
            }
            case "renameState": {
                File file = resolve(params.getString("id"));
                checkGame(file, romKey);
                String name = validateName(params.getString("name"));
                File target = new File(file.getParentFile(), name + EXTENSION);
                if (!file.equals(target)) {
                    try { Files.move(file.toPath(), target.toPath()); }
                    catch (FileAlreadyExistsException error) { throw new IOException("同名存档已存在，请换一个名称"); }
                }
                return metadata(target);
            }
            default: throw new IOException("未知存档操作");
        }
    }

    private JSONObject save(JSONObject params, String romKey) throws Exception {
        JSONObject state = params.getJSONObject("state");
        validateState(state);
        boolean legacy = params.optBoolean("legacy", false);
        // Retry-safe migration if the app closes after writing but before removing localStorage.
        if (legacy) {
            JSONArray entries = list(romKey).getJSONArray("saves");
            for (int i = 0; i < entries.length(); i++) {
                if (entries.getJSONObject(i).optBoolean("legacy")) return entries.getJSONObject(i);
            }
        }
        String gameName = params.optString("gameName", "未命名游戏").replaceFirst("(?i)\\.nes$", "");
        String folderName = gameName.trim().replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_");
        if (folderName.isEmpty() || folderName.equals(".") || folderName.equals("..")) folderName = "未命名游戏";
        if (folderName.codePointCount(0, folderName.length()) > 60) folderName = folderName.substring(0, folderName.offsetByCodePoints(0, 60));
        File folder = new File(root, folderName);
        if (!folder.isDirectory() && !folder.mkdirs()) throw new IOException("无法创建游戏存档目录");
        if (!folder.getCanonicalFile().getParentFile().equals(root.getCanonicalFile())) throw new IOException("存档目录无效");
        long createdAt = System.currentTimeMillis();
        JSONObject header = new JSONObject();
        header.put("version", 2);
        header.put("romKey", romKey);
        header.put("gameName", gameName);
        header.put("createdAt", createdAt);
        header.put("legacy", legacy);
        // Keep metadata on the first line so listing thousands of saves never loads their NES state.
        String serialized = header.toString();
        byte[] bytes = (serialized.substring(0, serialized.length() - 1) + ",\n\"state\":" + state + "}")
            .getBytes(StandardCharsets.UTF_8);
        if (bytes.length > MAX_BYTES) throw new IOException("存档文件超过 16 MiB");
        File temporary = File.createTempFile(".saving-", ".tmp", folder);
        try {
            try (FileOutputStream output = new FileOutputStream(temporary)) {
                output.write(bytes);
                output.getFD().sync();
            }
            SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd_HH-mm-ss-SSS", Locale.ROOT);
            long filenameTime = createdAt;
            while (true) {
                File target = new File(folder, format.format(new Date(filenameTime)) + EXTENSION);
                try {
                    Files.move(temporary.toPath(), target.toPath());
                    return metadata(target);
                } catch (FileAlreadyExistsException error) { filenameTime++; }
            }
        } finally {
            if (temporary.exists() && !temporary.delete()) temporary.deleteOnExit();
        }
    }

    private JSONObject list(String romKey) throws Exception {
        List<JSONObject> entries = new ArrayList<>();
        int skipped = 0;
        File[] folders = root.listFiles();
        if (folders != null) {
            for (File folder : folders) {
                if (!folder.isDirectory() || !folder.getCanonicalFile().getParentFile().equals(root.getCanonicalFile())) continue;
                File[] files = folder.listFiles((directory, name) -> name.endsWith(EXTENSION));
                if (files == null) continue;
                for (File file : files) {
                    try {
                        JSONObject entry = metadata(file);
                        if (romKey.equals(entry.getString("romKey"))) entries.add(entry);
                    } catch (Exception error) { skipped++; }
                }
            }
        }
        entries.sort(Comparator.<JSONObject>comparingLong(item -> item.optLong("createdAt")).reversed()
            .thenComparing((first, second) -> second.optString("id").compareTo(first.optString("id"))));
        JSONObject result = new JSONObject();
        result.put("saves", new JSONArray(entries));
        result.put("skipped", skipped);
        return result;
    }

    private JSONObject metadata(File file) throws Exception {
        if (!file.isFile() || !file.getCanonicalFile().getParentFile().getParentFile().equals(root.getCanonicalFile())) {
            throw new IOException("存档不存在或路径无效");
        }
        String firstLine;
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(new FileInputStream(file), StandardCharsets.UTF_8))) {
            // Metadata is small. Bound reads even if a file is corrupted or replaced externally.
            StringBuilder line = new StringBuilder();
            int next;
            while ((next = reader.read()) != -1 && next != '\n') {
                if (line.length() >= 8192) throw new IOException("存档头部损坏");
                line.append((char) next);
            }
            firstLine = line.toString();
        }
        if (!firstLine.endsWith(",")) throw new IOException("存档头部损坏");
        JSONObject result = new JSONObject(firstLine.substring(0, firstLine.length() - 1) + "}");
        if (result.optInt("version") != 2 || result.optLong("createdAt") <= 0) throw new IOException("不兼容的存档版本");
        String filename = file.getName();
        result.put("id", file.getParentFile().getName() + "/" + filename);
        result.put("path", result.getString("id"));
        result.put("filename", filename);
        result.put("name", filename.substring(0, filename.length() - EXTENSION.length()));
        return result;
    }

    private File resolve(String id) throws IOException {
        String[] components = id.split("/", -1);
        if (components.length != 2 || components[0].isEmpty() || components[0].equals(".") || components[0].equals("..")
            || id.contains("\\") || !components[1].endsWith(EXTENSION)) throw new IOException("存档路径无效");
        File file = new File(root, id);
        if (!file.getCanonicalFile().getParentFile().getParentFile().equals(root.getCanonicalFile())) throw new IOException("存档路径无效");
        return file;
    }

    private void checkGame(File file, String romKey) throws Exception {
        if (!romKey.equals(metadata(file).optString("romKey"))) throw new IOException("存档与当前游戏不匹配");
    }

    private static String validateName(String name) throws IOException {
        name = name.trim();
        if (name.endsWith(EXTENSION)) name = name.substring(0, name.length() - EXTENSION.length());
        if (name.isEmpty() || name.equals(".") || name.equals("..") || Pattern.compile("[\\\\/:*?\"<>|\\p{Cntrl}]").matcher(name).find()
            || name.codePointCount(0, name.length()) > 60) throw new IOException("名称需为 1–60 个字符，不能包含斜杠等文件名特殊字符");
        return name;
    }

    private static void validateState(JSONObject state) throws IOException {
        for (String key : new String[]{"cpu", "ppu", "papu", "mmap"}) {
            if (!(state.opt(key) instanceof JSONObject)) throw new IOException("存档内容无效");
        }
    }
}
