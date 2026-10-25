# Shuangling GPT · 霜铃 GPT

[简体中文](../../README.md) · [繁體中文](README.zh-TW.md) · **English**

A silver-haired chibi dragon companion for Codex on Windows. Shuangling lives on your desktop, follows the work of the local Codex app, and provides a compact control panel for animations, context usage and account limits.

**Version:** 1.8.4 · **Platform:** Windows x64 · **Integration:** local Codex plugin + MCP

**Character guide:** [Record Keeper of the Frostrealm Library](CHARACTER.en.md) · [简体中文](../CHARACTER.md) · [繁體中文](CHARACTER.zh-TW.md). The backstory and nine animation guides are references for future creative work; current features and animation clips are unchanged.

## Preview

### Animation demo

<table>
  <tr><th>Idle companion</th><th>Waving</th><th>Thinking</th></tr>
  <tr>
    <td><a href="../media/shuangling-demo.gif"><img src="../media/shuangling-demo.gif" width="240" alt="Shuangling idle companion animation" /></a></td>
    <td><a href="../media/shuangling-wave.gif"><img src="../media/shuangling-wave.gif" width="240" alt="Shuangling waving animation" /></a></td>
    <td><a href="../media/shuangling-thinking.gif"><img src="../media/shuangling-thinking.gif" width="240" alt="Shuangling thinking animation" /></a></td>
  </tr>
</table>

Three independent loops made from the existing release animations, using cropping, background compositing and GIF conversion while retaining the original timing. Click a preview to view it at full size.

### Right-click control panel

<table>
  <tr><th>Overview</th><th>Actions</th><th>Settings</th></tr>
  <tr>
    <td><a href="../media/panel-overview.png"><img src="../media/panel-overview.png" width="240" alt="Shuangling Overview panel with demonstration data" /></a></td>
    <td><a href="../media/panel-actions.png"><img src="../media/panel-actions.png" width="240" alt="Shuangling Actions panel with nine animations" /></a></td>
    <td><a href="../media/panel-settings.png"><img src="../media/panel-settings.png" width="240" alt="Shuangling Settings panel for size, docking and automatic launch" /></a></td>
  </tr>
</table>

Captured from the actual panel code, showing the Simplified Chinese interface with demonstration chat and usage data. Click an image for the full-resolution screenshot. The panel supports Simplified Chinese, Traditional Chinese and English. [Preview sources and details](../media/README.md)

## Features

- Nine character animations, a transparent desktop window, dragging, throwing and edge docking.
- A frost-white and lavender right-click panel with **Overview**, **Actions** and **Settings**.
- Automatic startup when a Codex main window opens; shutdown after all main windows have been closed for three seconds.
- Task status aggregated across the root chats observed in the current local Codex app session.
- Context remaining and cumulative token usage for a chat selected in the usage panel; the selected chat is remembered after restart.
- Simplified Chinese, Traditional Chinese and English across the panel, system tray, hover name and error banner; the language choice is remembered after restart.
- Account-wide limits read independently from the currently signed-in local Codex account.
- Local operation without an API key or additional model requests.

## Quick start · Install the plugin

You need **Windows 10/11 x64 and the Codex desktop app**. The portable package includes Node, Electron, the compiled desktop host and window observer, and production dependencies. You do not need to install Node/npm or compile anything. Installation uses a local plugin, not an official store listing. macOS, Linux and Windows ARM are not supported.

1. Download the **[Windows x64 portable package](https://github.com/lemon7500/shuangling-gpt/releases/download/v1.8.4/shuangling-gpt-1.8.4-windows-x64.zip)**, `shuangling-gpt-1.8.4-windows-x64.zip`. [Release page and assets](https://github.com/lemon7500/shuangling-gpt/releases/tag/v1.8.4). GitHub's **Source code** archives are not the portable package.
2. **Extract the entire archive** to a permanent folder writable by your Windows user. Do not run it inside the ZIP. Spaces and Chinese characters in the path are supported; keep the folder in place after installation.
3. Double-click **`安装Codex插件.vbs`** in the extracted root folder, then check that **霜铃 GPT** is enabled in Codex's plugin list. Installation is per user and does not require administrator rights. If local policy blocks login-task registration, manual launch remains available.
4. **Close all Codex windows and reopen Codex.** No message or plugin-tool call is needed. Right-click Shuangling, select a local chat in **Overview**, and use **Settings** to change **Start with Codex**.

The installer generates paths for the extracted folder, registers `shuangling-gpt@shuangling-local`, and manages the current user's login observer task according to your preferences. The included MCP template is disabled until the installer registers the local paths; do not install the template directly. If you move the folder, run the installer again from its new location. See [plugin installation details](../../plugin-marketplace/README.md).

Signing into Windows starts only the observer; the pet appears when Codex opens. Minimized windows count as open, and multiple windows share one pet. Manually quitting Shuangling suppresses automatic relaunch for that Codex session; fully reopen Codex or explicitly start Shuangling to clear it.

**Automatic startup fix in 1.8.4:** Windows Task Scheduler independently hosts the lightweight window observer. A Codex main window triggers launch without waiting for a chat plugin connection. Login-task checks run in the background and no longer block pet startup. After all Codex windows close, Shuangling exits while the observer stays ready for the next launch. To upgrade, exit Shuangling and close all Codex windows, back up and copy the original `windows/data` into the new package folder, then run the new installer to preserve settings, language and the selected usage chat.

You can also double-click **`启动霜铃.vbs`** for independent companionship. Task status and account usage require data from local Codex. Context and tokens stay unknown until a chat is selected and readable data is available.

See the [trilingual portable-package guide](../PORTABLE.md) and [installation, migration and removal guide](../INSTALL.md).

<details>
<summary>Developers: prepare from source</summary>

```powershell
git clone https://github.com/lemon7500/shuangling-gpt.git
cd shuangling-gpt
powershell -NoProfile -ExecutionPolicy Bypass -File .\setup.ps1
```

For a source ZIP, run only the last command from its extracted folder. Setup downloads checksum-verified Node and Electron, installs locked dependencies, builds the host and compiles the observer. It does not install the plugin or start the pet; use the root installer afterward. Add `-Plan` to inspect setup first. Portable-package users do not need this step.

</details>

## Everyday controls

| Control | Behavior |
|---|---|
| Drag / throw | Move Shuangling; transparent areas let clicks pass through. |
| Right-click | Open the fixed-size control card without resizing the pet. |
| Overview | View task state, choose a usage chat, and pause or resume task following. |
| Actions | Play one of the nine animations. Manual actions take priority; use **Resume following** to return control. |
| Settings | Adjust visible height, docking position, interface language and automatic startup. |
| Esc / outside click / top close button | Close the panel. |
| Bottom controls | Reset position, hide Shuangling or quit it. |

The folder also provides manual shortcuts: **`启动霜铃.vbs`** (start), **`霜铃设置.vbs`** (settings) and **`退出霜铃.vbs`** (quit).

Choose **简体中文 / 繁體中文 / English** under **Settings → Interface language**, or in advanced settings. Changing language preserves your selected chat, animations, position and other preferences.

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
- **Original reference artwork:** Bilibili [@ZipZipPipe](https://space.bilibili.com/4168597), author of the reference image initially supplied by the user. Shuangling's chibi interpretation and desktop animations are this project's adaptations of that reference, developed with AI-assisted production and local processing.

In response to this project's request for chibi adaptation, animation production and free sharing on GitHub, the original artist replied: “非商业用途随意” (translation: “You may use it freely for non-commercial purposes.”). The project relies on that permission for non-commercial learning and reference. See the [artwork permission notice](../../ASSETS.md) for the scope and attribution.

Code remains under MIT; character designs, avatars and animation artwork are outside the code's MIT grant. Rights remain with the respective rights holders, and attribution and permission do not imply the artist's participation or endorsement. Commercial use of the artwork requires separate permission from the relevant rights holders.
