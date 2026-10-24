# Shuangling GPT · 霜铃 GPT

[简体中文](../../README.md) · [繁體中文](README.zh-TW.md) · **English**

A silver-haired chibi dragon companion for Codex on Windows. Shuangling lives on your desktop, follows the work of the local Codex app, and provides a compact control panel for animations, context usage and account limits.

**Version:** 1.8.1 · **Platform:** Windows x64 · **Integration:** local Codex plugin + MCP

## Features

- Nine character animations, a transparent desktop window, dragging, throwing and edge docking.
- A frost-white and lavender right-click panel with **Overview**, **Actions** and **Settings**.
- Automatic startup when a Codex main window opens; shutdown after all main windows have been closed for three seconds.
- Task status aggregated across the root chats observed in the current local Codex app session.
- Context remaining and cumulative token usage for a chat selected in the usage panel.
- Account-wide limits read independently from the currently signed-in local Codex account.
- Local operation without an API key or additional model requests.

## Quick start · Install the plugin

Install the **Codex desktop app for Windows x64** first. This repository provides source installation; there is currently no ready-made portable release or official store listing. The first setup needs an internet connection to download dependencies.

Clone the repository, or choose **Code → Download ZIP** on GitHub and extract it to a permanent, writable folder. Open PowerShell in that folder:

```powershell
git clone https://github.com/lemon7500/shuangling-gpt.git
cd shuangling-gpt
powershell -NoProfile -ExecutionPolicy Bypass -File .\setup.ps1
```

Skip the first two commands if you downloaded the ZIP. Setup downloads and verifies Node and Electron, installs the locked dependencies, builds the desktop runtime and compiles the window observer. It does not register a Codex plugin or start the pet automatically.

After setup succeeds:

1. Double-click **`安装Codex插件.vbs`** in the project folder. It regenerates local paths and registers the plugin through Codex's native plugin commands.
2. Check that **霜铃 GPT** is enabled in Codex's plugin list.
3. Close all Codex windows and reopen Codex. Shuangling should appear without sending a message or calling a plugin tool.
4. Right-click Shuangling to open the panel. Select a chat in **Overview** to view its context and cumulative tokens; before a chat is selected, those values may be unknown. Use **Settings** to change **Start with Codex**.

The plugin uses a local marketplace named `shuangling-local`; its identifier is `shuangling-gpt@shuangling-local`. It is not an OpenAI bundled or officially endorsed plugin. Do not install the machine-specific development manifest directly. See [plugin installation details](../../plugin-marketplace/README.md).

The installation registers a login task for the current Windows user. Signing into Windows starts a small observer; the pet appears only when Codex is open. Minimized windows count as open, and multiple Codex windows share one pet. Manually quitting Shuangling suppresses automatic relaunch for that Codex session. Reopen Codex completely or explicitly start Shuangling to clear that suppression.

If you move the project, run the installer again at its new location. Keep the project folder while the plugin is installed.

Repository: [`lemon7500/shuangling-gpt`](https://github.com/lemon7500/shuangling-gpt).

## Everyday controls

| Control | Behavior |
|---|---|
| Drag / throw | Move Shuangling; transparent areas let clicks pass through. |
| Right-click | Open the fixed-size control card without resizing the pet. |
| Overview | View task state, choose a usage chat, and pause or resume task following. |
| Actions | Play one of the nine animations. Manual actions take priority; use **Resume following** to return control. |
| Settings | Adjust visible height, docking position and automatic startup. |
| Esc / outside click / top close button | Close the panel. |
| Bottom controls | Reset position, hide Shuangling or quit it. |

The folder also provides manual shortcuts: **`启动霜铃.vbs`** (start), **`霜铃设置.vbs`** (settings) and **`退出霜铃.vbs`** (quit).

## Task state, tokens and account limits

These are three separate sources:

| Display | Scope |
|---|---|
| Task animation | Root chats observed in the current local Codex application session. A chat working keeps Shuangling working; child agents do not independently trigger completion. |
| Context and cumulative tokens | Only the chat chosen in the usage panel. Other chats in the same project are not added. |
| Five-hour / weekly limits | The current signed-in account. Choosing another usage chat does not change this source. |

Context is a sample from the selected chat's most recent model request, not an exact live count of text that has not yet been submitted. Older valid context samples are labeled as historical. Incomplete cumulative records may show a verified lower bound with **≥**.

Account limits use the native local Codex account interface. The service clears old account data when the local authentication version changes and rejects late results from the previous account. Refresh normally runs every 30 seconds. Windows are identified by their reported duration: a five-hour card appears when the account actually reports that window. If Pro or Max explicitly reports only a weekly window, the five-hour card is hidden. Missing, expired or disconnected data is shown as unknown; it is never invented as zero or a full balance.

Current Pro operation and chat-switch isolation have been verified. Plus/Pro/Max transitions are covered by automated tests; real Plus/Max login switching has not yet been verified.

Codex currently exposes no reliable public identifier for the chat visible on its current page. Choose the usage chat manually. Selecting it does not change the global task following scope.

## Privacy and limitations

- The task adapter reads local root-chat events. It does not save or transmit conversation bodies, edit Codex settings during ordinary operation, or create model tasks.
- The window observer checks Codex package identity and main windows. It does not read conversations.
- Account authentication stays with the native Codex client. Account identifiers, email addresses and credentials are not included in panel results or saved usage reports.
- Local log formats are internal and may change. Unreadable or incompatible state is shown as unknown while dragging and companionship remain available.
- Log silence is not completion, and one failed tool call is not a failed task. Precise approval-wait and whole-task-error detection is not guaranteed.
- A few existing animation artifacts remain, including sleeve details, local clipping and the task board covering the mouth. The code does not claim that these source-media defects have been redrawn.
- This repository's Windows desktop plugin does not automatically import the character into the separate Pets service.

## Development

The project uses ES modules. Complete `setup.ps1` first, then run the tests with the prepared Node runtime from the project root; no global Node or npm installation is required:

```powershell
.\windows\runtime\node\node.exe --test --test-concurrency=4 tests/bridge/*.test.mjs tests/plugin/*.test.mjs tests/lifecycle/*.test.mjs tests/panel/*.test.mjs
```

The setup script installs the locked `vendor/dsh-pet` dependencies and builds the standalone host and desktop shared core. Runtime diagnostics and authenticated local interfaces are described in [BRIDGE.md](../../BRIDGE.md). Do not publish local data, runtime authentication files or conversation logs.

## Disable or uninstall

Turn off **Start with Codex** in Settings to disable automatic startup. Disable or uninstall **霜铃 GPT** from Codex's plugin list to stop future automatic launches and disable its login task. An existing managed instance exits when all Codex main windows close; use **Quit Shuangling** to stop it immediately. Uninstalling the plugin does not remove the project folder or your local settings.

## Credits and licenses

- **Desktop runtime reference:** [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet), pinned to commit `d7a308ecd4504cf4468c03707ce228ed1e1c0402`. This project builds on its desktop window, physical interaction, standalone mode and local animation interfaces. Retain the upstream MIT license and third-party notices; see [UPSTREAM.md](../../UPSTREAM.md).
- **Original character design:** Bilibili [@ZipZipPipe](https://space.bilibili.com/4168597). Shuangling's chibi interpretation and animations were developed from the user-provided reference with AI-assisted production and local processing.

Code licensing does not grant ownership of the reference artwork or character design. Their rights remain with the respective rights holders; attribution does not imply their endorsement or an additional redistribution license.
