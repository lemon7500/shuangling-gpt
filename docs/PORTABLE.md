# 霜铃 GPT 1.9.0 · Portable guide

[简体中文](#简体中文) · [繁體中文](#繁體中文) · [English](#english)

## 简体中文

需要 **Windows 10/11 x64**。Codex 插件与自动启停需要已安装的 Codex 桌面版；不支持 macOS、Linux 或 Windows ARM。

1.9.0 包含自主陪伴、专注与休息、六篇角色短篇、书签联动的「我们的日常」，以及 12 个可用动作。另附经典动作变体和三阶段拖拽素材；「翻看见闻」采用已接纳的 10 秒暂定版。动画仍可能零星丢帧，书本高度和靠脸翻页等细节仍可优化。完整用法见[霜白小工具（三语）](COMPANION-DESK.md)。

1. 从 [v1.9.0 Release](https://github.com/lemon7500/shuangling-gpt/releases/tag/v1.9.0) 下载 [shuangling-gpt-1.9.0-windows-x64.zip](https://github.com/lemon7500/shuangling-gpt/releases/download/v1.9.0/shuangling-gpt-1.9.0-windows-x64.zip)。不要下载 Source code 代替。
2. 完整解压到固定、当前用户可写的目录，不要在 ZIP 中运行。
3. 双击根目录 **`安装Codex插件.vbs`**，确认 Codex 中的霜铃 GPT 插件已启用。
4. 完整关闭所有 Codex 窗口并重新打开，无需发送消息。右键霜铃可查看任务、选择用量聊天或调整设置。

包内含 Node、Electron、运行依赖及已编译程序，无需安装 Node/npm 或自行编译。安装使用当前用户，无需管理员；若系统策略阻止登录任务登记，可用 **`启动霜铃.vbs`** 手动陪伴。**`霜铃设置.vbs`** 打开设置，**`退出霜铃.vbs`** 完整退出。任务与账户用量需要本机 Codex 数据；数据不可用时显示未知。

本版继续由 Windows 计划任务独立托管窗口观察器，打开 Codex 主窗口即触发霜铃启动，无需等待聊天插件加载；登录任务检查在后台进行。登录 Windows 只启动观察器，不显示桌宠。全部 Codex 窗口关闭三秒后霜铃退出，观察器继续等待下次打开。关闭自动启动或停用插件会停止后续自动拉起。

在面板「设置」或高级设置中选择 **简体中文／繁體中文／English**。三语覆盖面板、托盘、悬浮名称和错误提示；重启后保留语言及用量区所选聊天，账户额度仍独立于聊天。请保留解压目录。升级时先正常退出霜铃并完整关闭 Codex，将新版解压到新文件夹，私下备份原 `windows/data`，再把它复制到新文件夹的 `windows/data`，最后从新目录运行安装入口并重新打开 Codex。不要同时运行两份桌宠。包内 MCP 模板默认禁用，本机路径仅由安装器生成。

霜铃不发起额外模型请求，不保存或上传对话正文。请勿分享个人 `windows/data`、认证文件或日志。代码采用 [MIT](../LICENSE)，第三方声明见 [NOTICE](../NOTICE.md) 与 [UPSTREAM](../UPSTREAM.md)；美术权利单独见 [ASSETS](../ASSETS.md)。桌宠运行时参考 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)；**初始参考图原作者为 B 站 [@ZipZipPipe](https://space.bilibili.com/4168597)**。本项目据此改编 Q 版形象和桌宠动画，署名不代表原作者参与开发或背书。

原作者就本项目的改编、动画制作及 GitHub 免费分享申请回复“非商业用途随意”（由项目维护者提供）。本项目据此在非商业范围内制作和分享，并保留原作者署名；美术不纳入代码 MIT，商用须另行取得相关权利人的许可。见 [完整素材许可说明](../ASSETS.md)。

## 繁體中文

需要 **Windows 10/11 x64**。Codex 外掛程式與自動啟停需要已安裝的 Codex 桌面版；不支援 macOS、Linux 或 Windows ARM。

1.9.0 包含自主陪伴、專注與休息、六篇角色短篇、與書籤聯動的「我們的日常」，以及 12 個可用動作。另附經典動作變體及三階段拖曳素材；「翻看見聞」採用已接納的 10 秒暫定版。動畫仍可能零星掉格，書本高度及靠臉翻頁等細節仍可改善。完整用法見[霜白小工具（三語）](COMPANION-DESK.md)。

1. 從 [v1.9.0 Release](https://github.com/lemon7500/shuangling-gpt/releases/tag/v1.9.0) 下載 [shuangling-gpt-1.9.0-windows-x64.zip](https://github.com/lemon7500/shuangling-gpt/releases/download/v1.9.0/shuangling-gpt-1.9.0-windows-x64.zip)。請勿以 Source code 取代。
2. 完整解壓縮至固定、目前使用者可寫入的目錄，不要在 ZIP 中執行。
3. 按兩下根目錄 **`安装Codex插件.vbs`**，確認 Codex 中的霜铃 GPT 外掛程式已啟用。
4. 完整關閉所有 Codex 視窗後重新開啟，無須傳送訊息。按右鍵可查看工作狀態、選擇用量聊天或調整設定。

包內含 Node、Electron、執行依賴與已編譯程式，不必安裝 Node/npm 或自行編譯。安裝使用目前使用者，不需管理員；若系統原則阻止登錄登入工作，可使用 **`启动霜铃.vbs`** 手動陪伴。**`霜铃设置.vbs`** 開啟設定，**`退出霜铃.vbs`** 完整退出。工作與帳戶用量需要本機 Codex 資料；不可用時顯示未知。

本版繼續由 Windows 工作排程器獨立託管視窗觀察器，開啟 Codex 主視窗即觸發霜鈴啟動，不必等待聊天外掛程式載入；登入工作檢查在背景執行。登入 Windows 只啟動觀察器，不顯示桌寵。所有 Codex 視窗關閉三秒後霜鈴退出，觀察器繼續等待下次開啟。關閉自動啟動或停用外掛程式會停止後續自動拉起。

在面板「設定」或進階設定選擇 **简体中文／繁體中文／English**。三語涵蓋面板、系統匣、懸浮名稱與錯誤提示；重新啟動後保留語言及用量區所選聊天，帳戶額度仍獨立於聊天。請保留解壓目錄。升級時先正常退出霜鈴並完整關閉 Codex，將新版解壓縮到新資料夾，私下備份原 `windows/data`，再複製到新資料夾的 `windows/data`，最後從新目錄執行安裝入口並重新開啟 Codex。不要同時執行兩份桌寵。包內 MCP 範本預設停用，本機路徑僅由安裝器產生。

霜鈴不建立額外模型請求，不保存或上傳對話正文。請勿分享個人 `windows/data`、認證檔案或日誌。程式碼採用 [MIT](../LICENSE)，第三方聲明見 [NOTICE](../NOTICE.md) 與 [UPSTREAM](../UPSTREAM.md)；美術權利另見 [ASSETS](../ASSETS.md)。桌寵執行環境參考 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)；**初始參考圖原作者為 B 站 [@ZipZipPipe](https://space.bilibili.com/4168597)**。本專案據此改編 Q 版形象與桌寵動畫，署名不代表原作者參與開發或背書。

原作者就本專案的改編、動畫製作及 GitHub 免費分享申請回覆「非商业用途随意」（由專案維護者提供，保留簡體原文）。本專案據此在非商業範圍內製作與分享，並保留原作者署名；美術不納入程式碼 MIT，商用須另行取得相關權利人的許可。見 [完整素材許可說明](../ASSETS.md)。

## English

Requires **Windows 10/11 x64**. The Codex plugin and automatic lifecycle need the Codex desktop app installed. macOS, Linux and Windows ARM are not supported.

Version 1.9.0 includes ambient company, focus and breaks, six character stories, bookmark-linked **Our days together**, and 12 available actions. Classic variants and three-phase drag media are also included. **Read journal** uses the accepted provisional 10-second version. Occasional single-frame drops, book height and page-to-face clearance remain areas for refinement. See the [trilingual Frost desk guide](COMPANION-DESK.md).

1. Download [shuangling-gpt-1.9.0-windows-x64.zip](https://github.com/lemon7500/shuangling-gpt/releases/download/v1.9.0/shuangling-gpt-1.9.0-windows-x64.zip) from the [v1.9.0 Release](https://github.com/lemon7500/shuangling-gpt/releases/tag/v1.9.0), rather than a Source code archive.
2. Extract the complete ZIP to a permanent folder writable by your Windows user. Do not run it inside the archive.
3. Double-click root **`Install plugin.vbs`** (or **`安装Codex插件.vbs`**), then check that **霜铃 GPT** is enabled in Codex.
4. Close every Codex window and reopen Codex. No message is needed. Right-click Shuangling to view task status, choose a usage chat or change settings.

Node, Electron, production dependencies and compiled programs are included. No Node/npm installation or compilation is required. Installation is per user without administrator rights. If local policy blocks login-task registration, **`Start Pet.vbs`** provides manual companionship. **`Settings.vbs`** opens settings; **`Exit Pet.vbs`** exits completely. The Chinese aliases remain available. Task status and account usage need local Codex data; unavailable values remain unknown.

Windows Task Scheduler independently hosts the window observer. Opening a Codex main window triggers Shuangling without waiting for a chat plugin connection; login-task checks run in the background. Signing into Windows starts only the observer. Shuangling exits three seconds after all Codex windows close, while the observer waits for the next launch. Turning off automatic startup or disabling the plugin prevents further automatic launches.

Choose **简体中文 / 繁體中文 / English** in panel Settings or advanced settings. These languages cover the panel, system tray, hover name and error banner. The language and selected usage chat are remembered after restart; account limits remain independent of chat selection. Keep the extracted folder in place. To upgrade, exit Shuangling normally and close all Codex windows, extract the new package to a new folder, privately back up the original `windows/data`, then copy it into the new folder as `windows/data` before running the installer from that new location and reopening Codex. Do not run both installations at once. The included MCP template is disabled until the installer generates your local paths.

Shuangling makes no additional model requests and does not save or upload conversation bodies. Do not share personal `windows/data`, authentication files or logs. Code uses [MIT](../LICENSE); see [NOTICE](../NOTICE.md) and [UPSTREAM](../UPSTREAM.md) for third-party notices and [ASSETS](../ASSETS.md) for separate artwork rights. The desktop runtime builds on [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet). **Bilibili [@ZipZipPipe](https://space.bilibili.com/4168597) is the original author of the initial reference image.** This project adapted that reference into Shuangling's chibi design and desktop animations; attribution does not imply participation or endorsement.

In response to the project's request for adaptation, animation production and free GitHub sharing, the artist replied “非商业用途随意,” according to the reply supplied by the maintainer (translation: “You may use it freely for non-commercial purposes.”). The project relies on this reply for non-commercial creation and sharing with continued attribution. Artwork is excluded from the code's MIT grant; commercial use requires separate permission from the relevant rights holders. See the [full artwork notice](../ASSETS.md).

[完整说明 / Full documentation](../README.md) · [安装、迁移与卸载 / Installation](INSTALL.md)
