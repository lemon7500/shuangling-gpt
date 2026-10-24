# 安装、迁移与卸载 / Installation

Follow the [简体中文 quick start](../README.md#快速开始安装插件), [繁體中文](i18n/README.zh-TW.md) or [English](i18n/README.en.md).

## Preparation

Windows 10/11 x64 and Codex desktop are required. Run `powershell -NoProfile -ExecutionPolicy Bypass -File .\setup.ps1 -Plan` first to inspect preparation without writes or downloads. Remove `-Plan` to download checksum-verified Node.js 24.19.0 / Electron 43.2.0, install locked npm dependencies, build the standalone host and compile the observer. Runtime and dependency licenses stay in their directories.

The script intentionally refuses an existing `node_modules` directory rather than running a destructive `npm ci` over an installation. For an upgrade, use a fresh checkout and review how to migrate your existing data. No runtime ZIP or previous installation is deleted by setup. Network failures leave the download cache available for inspection/retry.

## Install

Double-click `安装Codex插件.vbs`, or run `.\windows\runtime\node\node.exe .\windows\install-plugin.mjs`. The native installer regenerates absolute paths for this extraction directory and registers the local marketplace/plugin. The shipped `.mcp.template.json` is disabled placeholder metadata and is not itself a ready-to-use command.

Keep the folder in place. Fully close and reopen Codex to check automatic launch without sending a message. Right-click → Overview to select a usage chat; Settings contains the automatic-launch switch. Manual launch/settings/stop VBS entries remain available.

## Move / upgrade

Do not run two installations at once. Exit the pet normally, retain your original `windows/data` privately, and keep backups outside Git. Install from the final intended directory to regenerate paths and the per-user observer task. The installer verifies marketplace ownership before migration and attempts rollback on a partially committed failure; it will not silently enable an explicitly disabled existing plugin. Do not copy credentials, logs, or local path manifests into a public repository.

## Disable / uninstall

Turn off automatic launch in the panel, then use Codex's plugin manager to disable/remove **霜铃 GPT**. Existing managed instances still shut down when all Codex windows close; use `退出霜铃.vbs` for immediate exit. The observer disables its login task when the plugin is disabled/removed. Local artwork and settings are retained; uninstallation does not automatically clean the project directory.

## Troubleshooting

- No Codex CLI found: launch the installed Codex desktop app once; the installer discovers the current local runtime rather than a fixed version directory.
- Installation fails: inspect `reports/codex-plugin-install.json` locally. Do not publish the raw report, which can contain local paths.
- Observer unavailable: manual launch still works. Confirm that the standard .NET Framework C# compiler exists and current-user task registration is permitted.
- No automatic launch after manual exit: reopen the complete Codex application session or explicitly start the pet.
- Unknown usage: select a local root chat; missing/incompatible logs or unavailable native account reads stay unknown.
