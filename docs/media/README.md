# Preview media / 效果预览 / 效果預覽

The homepage combines historical v1.8.4 animation GIFs with v1.9.1 panel screenshots. Captures use actual interface code with synthetic demonstration data. Making these previews does not change application animation files or desktop settings.

## Animations / 动画 / 動畫

| Preview | Existing source | Duration | Size |
| --- | --- | --- | --- |
| [Idle / 常态 / 常態](shuangling-demo.gif) | `windows/assets/shuangling/idle.webm` | 4.83 s | 2.03 MiB |
| [Waving / 挥手 / 揮手](shuangling-wave.gif) | `windows/assets/shuangling/waving.webm` | 5.17 s | 1.56 MiB |
| [Thinking / 思考](shuangling-thinking.gif) | `windows/assets/shuangling/running.webm` | 5.17 s | 1.77 MiB |

These are historical v1.8.4 clips, not previews of later animation replacements. Each 368×400 GIF loops independently at the original clip timing. A shared safe crop makes the character visible, with proportional downscaling and a lavender background. All source frames are retained; GIF's centisecond timing differs from each source duration by less than 0.01 seconds. Total GIF size: 5.36 MiB. Source/output hashes are recorded in [animation-preview.json](animation-preview.json).

三个动图保留历史 v1.8.4 的动作与节奏，不代表后续替换素材。制作时仅做安全裁切、等比例缩小、淡紫背景合成和 GIF 转换；本版没有重新生成或修改这些动图。

三個動圖保留歷史 v1.8.4 的動作與節奏，不代表後續替換素材。製作時僅做安全裁切、等比例縮小、淡紫背景合成與 GIF 轉換；本版未重新生成或修改這些動圖。

## Current panel / 当前面板 / 目前面板

- [简体中文：12 格动作面板](panel-v191.zh-CN.png)
- [繁體中文：12 格動作面板](panel-v191.zh-TW.png)
- [English: 12-action panel](panel-v191.en.png)

These v1.9.1 screenshots show the actual Simplified Chinese, Traditional Chinese and English action panels with LXGW WenKai 1.530 and the new line icons. Each PNG is copied unchanged from an isolated native Electron UI check using in-memory fixtures, without connecting to the running pet or real account/chat endpoints. The images use synthetic status and demonstration data; no personal settings were changed. No AI image generation or image editing was used.

v1.9.1 截图展示简体、繁体、英语实际动作面板中的霞鹜文楷与新线条图标。PNG 原样复制自独立 Electron 窗口的原生界面检查，使用内存演示数据，不连接真实桌宠或账户／聊天接口；没有修改个人设置、生成图片或编辑截图。

v1.9.1 截圖展示簡體、繁體、英語實際動作面板中的霞鶩文楷及新線條圖示。PNG 原樣複製自獨立 Electron 視窗的原生介面檢查，使用記憶體展示資料，不連接真實桌寵或帳戶／聊天介面；未修改個人設定、生成圖片或編輯截圖。

## Historical panel / 历史面板 / 歷史面板

- [Overview / 总览 / 總覽](panel-overview.png)
- [Actions / 动作 / 動作](panel-actions.png)
- [Settings / 设置 / 設定](panel-settings.png)

These retained v1.8.4 captures show the former nine-action panel. They were captured in an isolated hidden Electron window, at 704×1040 physical pixels for the 352×520 CSS layout (native 200% rendering). Chat names, token counts and account percentages are synthetic demonstration data. The capture uses in-memory fixtures, with no connection to the running pet or real account/chat endpoints. These historical screenshots use Simplified Chinese and are no longer the current homepage panel previews.

截图使用真实面板与演示数据，不包含真实聊天或账户用量；没有修改现有桌宠设置。

截圖使用實際面板與展示資料，不包含真實聊天或帳戶用量；沒有修改既有桌寵設定。

## Reproduce historical previews

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
