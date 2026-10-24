# Codex local plugin marketplace

Use the [project installation instructions](../README.md#快速开始安装插件). Download and fully extract the Windows x64 portable package, then run root `安装Codex插件.vbs` / `Install plugin.vbs`. The runtime is included; source developers can prepare it with `setup.ps1` first. The installer generates the private `.mcp.json` for the final project location before invoking the native Codex plugin CLI. The included `.mcp.template.json` is a disabled example only.

Version 1.8.4 uses a Windows Task Scheduler observer that remains ready between Codex sessions. It detects Codex main windows independently of chat plugin initialization; scheduled-task checks do not block pet startup. Signing into Windows runs only the observer. Close all Codex windows and reopen Codex after installation; no message or plugin-tool call is needed.

When upgrading, exit Shuangling and close all Codex windows. Privately back up the original `windows/data`, copy it into the fully extracted new package before installation, and rerun the installer from the final new directory. This preserves settings, language and the selected usage chat while updating the observer. Do not run two installations at once.

Plugin ID: `shuangling-gpt@shuangling-local`. Keep the project in place after installation. This source repository is not an official plugin-store listing. See [installation and removal](../docs/INSTALL.md).
