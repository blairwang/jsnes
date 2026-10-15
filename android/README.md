# JSNES Android

基于本仓库 `web/` React 网页和 `src/` JSNES 内核的离线 Android 应用。网页随 APK 打包，无需启动网页服务器。

## 功能

- 通过系统文件选择器打开单个 `.nes`，或授权目录后递归扫描子目录；保留目录读取授权，下次启动自动加载游戏库，支持搜索和刷新。
- 横竖屏自适应，多点触控方向键（含斜向、滑动）、A/B、连发、SELECT/START；支持键盘。
- 1× / 2× / 3× / 4× 加速；加速时静音，实际速度取决于设备性能。
- 金手指按 ROM 内容的 SHA-256 分开保存，支持添加、启停和删除：
  - 6/8 位 Game Genie，如 `SXIOPO`（需要匹配游戏及版本）。
  - ROM 补丁：`8000:FF`，带原值比较：`8000:FF?10`，地址范围 `8000–FFFF`。
  - 每帧 RAM 锁定：`RAM:00FF:09` 或 `00FF:09`，范围 `0000–07FF`。
- 256×240 原始游戏画面的 PNG 截图。Android 10 及以上写入相册 `Pictures/JSNES/`；Android 8/9 使用系统“另存为”界面选择位置。
- 每个 ROM 一个快速存档槽，支持读档、重开、声音开关；切后台、失去焦点或打开系统选择器会暂停，返回后点击继续。
- 内置仓库中的 Croom 游戏用于验证安装。自选游戏无需复制到 APK。

## 构建

需要 Node.js 24、JDK 17 或 21、Android SDK 35 和 Android SDK Build Tools。推荐使用 Android Studio 自带的 JDK。项目使用 AGP 8.10.1、Gradle 8.11.1、AndroidX WebKit 1.14.0。

在仓库根目录安装依赖：

```powershell
npm ci
npm --prefix web ci
```

用 Android Studio 打开 `android/`，设置 Gradle JDK，等待同步后运行；或者设置 `JAVA_HOME` 和 `ANDROID_HOME` 后使用命令行：

```powershell
cd android
.\gradlew.bat :app:assembleDebug
```

macOS / Linux 使用 `sh ./gradlew :app:assembleDebug`。SDK 也可以在不提交的 `android/local.properties` 中配置：

```properties
sdk.dir=C\:/Users/your-name/AppData/Local/Android/Sdk
```

构建会自动执行 `web` 中的 `npm run build:android`，再将静态资源复制到 Gradle 生成的 assets 目录；不需要手工复制网页。首次构建需要联网下载 npm、Gradle 和 Maven 依赖；安装后的应用不需要联网。

APK 输出：`android/app/build/outputs/apk/debug/app-debug.apk`。

```powershell
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

最低 Android 8.0（API 26），目标 API 35。设备须安装支持 `WEB_MESSAGE_LISTENER` 的 Android System WebView / Chrome；过旧时应用会提示更新。

## 开发与验证

```powershell
npm --prefix web run dev
# 浏览 http://localhost:3000/android，可用浏览器文件/目录选择和 PNG 下载
npm --prefix web test
npm run typecheck
cd android
.\gradlew.bat :app:assembleDebug :app:lintDebug
```

Android 构建使用 `https://appassets.androidplatform.net/assets/web/` 加载本地网页，原来的网页入口 `/` 和 `/run` 保留。桥接通过限定来源和主框架的 WebMessageListener 传递请求；ROM 只从系统授权的 URI 读取。应用不申请联网、所有文件访问或存储权限。实现参考 Android 官方的 [WebView 本地内容加载](https://developer.android.com/develop/ui/views/layout/webapps/load-local-content) 与 [Storage Access Framework](https://developer.android.com/training/data-storage/shared/documents-files)。

Android 的系统文件选择器会限制存储根目录、`Android/data` 等受保护目录。将 ROM 放入可授权的专用子目录（例如 `Documents/NES`）；文件移动、删除或授权被撤销后，请重新选择目录。扫描上限为 20,000 个目录项、5,000 个 ROM、32 层子目录，达到上限或遇到不可读子目录会在页面提示。单个 ROM 上限 16 MiB，只支持本仓库内核已支持的 iNES 格式及 mapper，暂不解压 ZIP/7z。

金手指和快速存档保存在 WebView 本机数据中；卸载或清除应用数据会删除。快速存档会覆盖同一 ROM 的旧槽位；没有自动保存进度，退出前请手动存档。Debug APK 仅供开发安装，正式发布需要自行配置签名。项目及所带开源 ROM 的许可沿用仓库中的 `LICENSE` 和各 ROM 目录说明。
