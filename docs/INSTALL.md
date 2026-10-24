# 安装、迁移与卸载 / Installation

Follow the [简体中文 quick start](../README.md#快速开始安装插件), [繁體中文](i18n/README.zh-TW.md) or [English](i18n/README.en.md).

## Portable installation (recommended)

You need Windows 10/11 x64 and an installed Codex desktop app. Download [shuangling-gpt-1.8.3-windows-x64.zip](https://github.com/lemon7500/shuangling-gpt/releases/download/v1.8.3/shuangling-gpt-1.8.3-windows-x64.zip) from the [v1.8.3 Release](https://github.com/lemon7500/shuangling-gpt/releases/tag/v1.8.3). GitHub's automatically generated **Source code** archives do not include the portable runtime.

1. Extract the entire ZIP to a permanent folder writable by your Windows user. Do not run it inside the archive.
2. Double-click root **`安装Codex插件.vbs`**, then check that **霜铃 GPT** is enabled in Codex.
3. Close every Codex window and reopen Codex. Automatic launch does not require a message or a plugin-tool call.
4. Right-click Shuangling. **Overview** lets you select a usage chat. **Settings** provides automatic startup and interface language: **简体中文 / 繁體中文 / English**. The language setting is also available in advanced settings.

The ZIP includes Node.js, Electron, the compiled desktop host and observer, and production dependencies. No Node/npm installation, source setup or compilation is needed. It is a local plugin installation, not an official store listing; the package supports Windows x64, not macOS, Linux or Windows ARM. Runtime and dependency licenses remain in their directories.

Installation uses the current Windows user and does not need administrator rights. It regenerates paths for the extracted folder and registers the local marketplace/plugin. The included MCP template is disabled placeholder metadata; use the installer instead of adding the template directly. Current-user login-task registration can be restricted by local policy. If that step is unavailable, use the manual start entry.

Keep the folder in place. The root entries **`启动霜铃.vbs`**, **`霜铃设置.vbs`** and **`退出霜铃.vbs`** provide manual start, settings and exit. Manual start can provide independent companionship; task status and account usage need readable data from local Codex. Before selecting a chat or when data is unavailable, usage stays unknown. See the [trilingual package readme](PORTABLE.md).

## Prepare from source (developers)

Clone the repository or extract its source archive, then run `powershell -NoProfile -ExecutionPolicy Bypass -File .\setup.ps1 -Plan` to inspect preparation without writes or downloads. Remove `-Plan` to download checksum-verified Node.js 24.19.0 / Electron 43.2.0, install locked dependencies, build the standalone host and compile the observer. Setup does not register the plugin or start the pet. After it finishes, use the root installer described above.

The script refuses an existing `node_modules` directory instead of replacing an installation. Use a fresh checkout for an upgrade and retain existing data privately. Setup does not delete runtime ZIPs or previous installations. Network failures leave the download cache available for inspection and retry.

## Move / upgrade

Do not run two installations at once. Exit the pet normally and close every Codex window. Extract the new package to a new folder, retain a private backup of your original `windows/data` outside Git, then copy that data directory into the new folder as `windows/data` before running the installer. This carries forward existing persisted preferences; version 1.8.3 also persists the usage chat you select. Run the installer from the final intended directory to regenerate paths and the per-user observer task, then reopen Codex. The installer verifies marketplace ownership before migration and attempts rollback on a partially committed failure; it will not silently enable an explicitly disabled existing plugin. Do not publish credentials, logs, local data or path manifests. The public package does not contain another user's settings or authentication.

## Disable / uninstall

Turn off automatic launch in the panel, then use Codex's plugin manager to disable/remove **霜铃 GPT**. Existing managed instances still shut down when all Codex windows close; use `退出霜铃.vbs` for immediate exit. The observer disables its login task when the plugin is disabled/removed. Local artwork and settings are retained; uninstallation does not automatically clean the project directory.

## Troubleshooting

- No Codex CLI found: launch the installed Codex desktop app once; the installer discovers the current local runtime rather than a fixed version directory.
- Installation fails: inspect `reports/codex-plugin-install.json` locally. Do not publish the raw report, which can contain local paths.
- Observer unavailable: manual launch still works. Confirm that the entire portable archive was extracted and current-user task registration is permitted. The portable package does not need a compiler.
- No automatic launch after manual exit: reopen the complete Codex application session or explicitly start the pet.
- Unknown usage: select a local root chat; missing/incompatible logs or unavailable native account reads stay unknown.
- Interface language: choose **简体中文 / 繁體中文 / English** in panel Settings or advanced settings. This does not change the selected chat, animation, position or account.
