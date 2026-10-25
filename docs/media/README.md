# Preview media / 效果预览 / 效果預覽

These previews reuse the current release artwork and actual panel code. The nine application WebM clips and desktop settings are unchanged.

## Animations / 动画 / 動畫

| Preview | Existing source | Duration | Size |
| --- | --- | --- | --- |
| [Idle / 常态 / 常態](shuangling-demo.gif) | `windows/assets/shuangling/idle.webm` | 4.83 s | 2.03 MiB |
| [Waving / 挥手 / 揮手](shuangling-wave.gif) | `windows/assets/shuangling/waving.webm` | 5.17 s | 1.56 MiB |
| [Thinking / 思考](shuangling-thinking.gif) | `windows/assets/shuangling/running.webm` | 5.17 s | 1.77 MiB |

Each 368×400 GIF loops independently at the original clip timing. A shared safe crop makes the character visible, with proportional downscaling and a lavender background. All source frames are retained; GIF's centisecond timing differs from each source duration by less than 0.01 seconds. Total GIF size: 5.36 MiB. Source/output hashes are recorded in [animation-preview.json](animation-preview.json).

三个动图分别原速循环播放现有素材，仅做安全裁切、等比例缩小、淡紫背景合成和 GIF 转换。没有重新生成动画或修改桌宠媒体。

三個動圖分別原速循環播放既有素材，僅做安全裁切、等比例縮小、淡紫背景合成與 GIF 轉換。沒有重新生成動畫或修改桌寵媒體。

## Panel / 面板

- [Overview / 总览 / 總覽](panel-overview.png)
- [Actions / 动作 / 動作](panel-actions.png)
- [Settings / 设置 / 設定](panel-settings.png)

Captured from the production panel in an isolated hidden Electron window, at 704×1040 physical pixels for the 352×520 CSS layout (native 200% rendering). Chat names, token counts and account percentages are synthetic demonstration data. The capture uses in-memory fixtures, with no connection to the running pet or real account/chat endpoints. These screenshots use Simplified Chinese; Settings also supports Traditional Chinese and English.

截图使用真实面板与演示数据，不包含真实聊天或账户用量；没有修改现有桌宠设置。

截圖使用實際面板與展示資料，不包含真實聊天或帳戶用量；沒有修改既有桌寵設定。

## Reproduce

From the repository root, after preparing the source checkout:

```powershell
# Optional developer dependency: FFmpeg on PATH, with libvpx-vp9 support.
.\windows\runtime\node\node.exe .\tools\make-readme-demo.mjs

# Run the screenshot tool in Electron mode.
$env:ELECTRON_RUN_AS_NODE = $null
.\windows\runtime\electron\electron.exe .\tools\capture-readme-panels.cjs
```

Set `FFMPEG` to its executable path if it is not on PATH. These tools overwrite only their preview outputs; source animation files and the current desktop instance are not changed. Screenshot reproduction uses an isolated temporary Electron profile.

## Credits

Original reference artwork by Bilibili [@ZipZipPipe](https://space.bilibili.com/4168597); this project makes the chibi and desktop-animation adaptations. Desktop host based on [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet). The [artwork notice](../../ASSETS.md), [project notices](../../NOTICE.md), and upstream code license continue to apply.

原画作者已就本项目的非商业用途回复“非商业用途随意”（由项目维护者提供）。本页角色动图及截图中的美术内容遵循该非商业范围，不纳入代码 MIT；商用须另行取得相关权利人的许可。

原畫作者已就本專案的非商業用途回覆「非商业用途随意」（由專案維護者提供，保留簡體原文）。本頁角色動圖及截圖中的美術內容遵循此非商業範圍，不納入程式碼 MIT；商用須另行取得相關權利人的許可。

The artist allowed this project's non-commercial use in the reply supplied by the maintainer. Character artwork in these GIFs and screenshots follows that non-commercial scope and is excluded from the code's MIT grant; commercial use requires separate permission from the relevant rights holders. See the [full reply and scope](../../ASSETS.md).
