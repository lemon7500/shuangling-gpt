<div align="center">
  <img src="vendor/dsh-pet/runtime/electron-helper/panel-avatar.png" width="128" alt="霜铃 GPT：银白龙女 Q 版桌宠" />
  <h1>霜铃 GPT · Shuangling GPT</h1>
  <p>陪你思考、等你回答，也陪你安静工作。</p>
  <p>Windows 桌宠 × Codex 本地插件 × 任务与用量面板</p>
  <p><a href="README.md">简体中文</a> · <a href="docs/i18n/README.zh-TW.md">繁體中文</a> · <a href="docs/i18n/README.en.md">English</a></p>
  <p><img alt="Windows x64" src="https://img.shields.io/badge/Windows-x64-8B73A6" /> <img alt="Version 1.8.4" src="https://img.shields.io/badge/version-1.8.4-8B73A6" /> <a href="LICENSE"><img alt="Code license MIT" src="https://img.shields.io/badge/code-MIT-8B73A6" /></a> <a href="https://github.com/lemon7500/shuangling-gpt/actions/workflows/windows.yml"><img alt="Windows source check" src="https://github.com/lemon7500/shuangling-gpt/actions/workflows/windows.yml/badge.svg" /></a></p>
</div>

霜铃是一只银白卷发、淡紫双翼的 Q 版龙女桌宠。她通过本地 Codex 插件跟随整个应用的任务状态，提供九种动画、拖拽与抛出交互，以及霜白淡紫的右键控制卡片。

**桌宠运行时参考并基于 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)。初始参考图原作者为 B 站 [@ZipZipPipe](https://space.bilibili.com/4168597)。** 霜铃的 Q 版形象和动画由本项目在该参考图基础上改编制作，已获原作者对本项目非商业用途的同意；代码与美术的权利说明分别见 [许可证](LICENSE) 和 [素材说明](ASSETS.md)。

[效果预览](#效果预览) · [快速开始](#快速开始安装插件) · [功能](#功能) · [操作](#日常操作) · [常见问题](#常见问题) · [开发](#开发) · [致谢](#致谢与参考)

## 效果预览

### 动画演示

<table>
  <tr><th>常态陪伴</th><th>开心挥手</th><th>认真思考</th></tr>
  <tr>
    <td><a href="docs/media/shuangling-demo.gif"><img src="docs/media/shuangling-demo.gif" width="240" alt="霜铃常态陪伴动画" /></a></td>
    <td><a href="docs/media/shuangling-wave.gif"><img src="docs/media/shuangling-wave.gif" width="240" alt="霜铃挥手动画" /></a></td>
    <td><a href="docs/media/shuangling-thinking.gif"><img src="docs/media/shuangling-thinking.gif" width="240" alt="霜铃认真思考动画" /></a></td>
  </tr>
</table>

三个预览分别循环播放当前版本已有动画，保留原动作节奏。仅做裁切、背景合成和 GIF 转换；点击可查看原尺寸动图。

### 右键控制面板

<table>
  <tr><th>总览</th><th>动作</th><th>设置</th></tr>
  <tr>
    <td><a href="docs/media/panel-overview.png"><img src="docs/media/panel-overview.png" width="240" alt="霜铃右键面板：总览，使用演示数据" /></a></td>
    <td><a href="docs/media/panel-actions.png"><img src="docs/media/panel-actions.png" width="240" alt="霜铃右键面板：九种动作" /></a></td>
    <td><a href="docs/media/panel-settings.png"><img src="docs/media/panel-settings.png" width="240" alt="霜铃右键面板：大小、停靠与自动启动设置" /></a></td>
  </tr>
</table>

截图来自实际面板代码，以简体中文界面和演示聊天、用量展示；点击图片可查看清晰原图。面板支持简体中文、繁體中文和 English。[素材来源与预览说明](docs/media/README.md)

## 功能

| 功能 | 说明 |
| --- | --- |
| 九种角色动画 | 常态陪伴、左右小跑、挥手、小跳、收起、等你回答、认真思考、检查工作 |
| 整个 Codex 的任务联动 | 汇总当前本机 Codex 应用会话中的根聊天；子代理不会提前触发完成 |
| 独立右键控制卡片 | 总览、动作、设置三页；面板尺寸独立于角色缩放 |
| 聊天用量 | 按聊天名称选择，查看该聊天最近请求的上下文和累计 token；重启后记住所选聊天 |
| 三语界面 | 简体、繁体和英语覆盖面板、托盘、悬浮名称与错误提示；重启后保留语言选择 |
| 当前账号额度 | 独立读取当前登录账号；切换用量聊天不会改变账户余额 |
| 随 Codex 自动启停 | 打开首个主窗口启动，全部主窗口关闭三秒后退出 |
| 桌面交互 | 拖拽、抛出反弹、边缘停靠、大小与位置调整、透明区域点击穿透 |
| 本地运行 | 不需要 API Key，不发起额外模型任务，不保存或上传对话正文 |

## 快速开始（安装插件）

**需要 Windows 10/11 x64 和已安装的 Codex 桌面版。** 免安装包已包含 Node、Electron、桌宠宿主、窗口观察器和运行依赖，无需安装 Node/npm 或自行编译。当前通过 GitHub 下载及本地插件安装，不是官方插件商店项目；不支持 macOS、Linux 或 Windows ARM。

1. 下载 **[Windows x64 免安装包](https://github.com/lemon7500/shuangling-gpt/releases/download/v1.8.4/shuangling-gpt-1.8.4-windows-x64.zip)**（`shuangling-gpt-1.8.4-windows-x64.zip`）。[查看 Release 与附件](https://github.com/lemon7500/shuangling-gpt/releases/tag/v1.8.4)。请勿将 GitHub 的 **Source code** 压缩包当作免安装包。
2. **完整解压**到一个固定、当前用户可写的目录。不要直接在 ZIP 中运行；中文和空格路径均可，安装后请保留此目录。
3. 双击解压后根目录的 **`安装Codex插件.vbs`**，然后确认 Codex 插件列表中的 **霜铃 GPT** 已启用。安装使用当前 Windows 用户，无需管理员身份；若本机策略阻止登录任务登记，仍可手动启动霜铃。
4. **完整关闭所有 Codex 窗口并重新打开，无需发消息或手动调用工具。** 右键霜铃打开「总览」，在用量区选择本机聊天；在「设置」调整「随 Codex 自动启动」。

安装器按当前解压目录生成本机路径，注册 `shuangling-gpt@shuangling-local`，并按偏好管理当前用户的登录观察任务。包内 MCP 模板默认禁用，不能直接用于安装；运行上述入口后才会注册本机路径。移动目录后需在新位置重新运行安装入口。

**1.8.4 自动启动修复：**轻量窗口观察器由 Windows 计划任务独立托管，检测到 Codex 主窗口便触发启动，无需等待聊天插件加载。Windows 登录任务检查在后台进行，不再挡住桌宠启动。登录 Windows 时只运行观察器；全部 Codex 主窗口关闭三秒后，霜铃退出，观察器继续等待下次打开。旧版用户请先退出霜铃并关闭所有 Codex 窗口，备份并复制原 `windows/data` 到新版目录后，再运行新版安装入口，以保留设置、语言和所选用量聊天。

默认单只、右下角、可见高度约 200 像素；声音和自动漫游关闭。也可双击 **`启动霜铃.vbs`** 独立陪伴；任务状态和账户用量需要本机 Codex 提供数据。首次未选择聊天或数据不可用时，用量保留为未知。

包内首读见 [免安装包使用说明（三语）](docs/PORTABLE.md)，迁移、保留设置及排查见 [安装、迁移与卸载](docs/INSTALL.md)。

<details>
<summary>开发者：从源码准备运行环境</summary>

~~~powershell
git clone https://github.com/lemon7500/shuangling-gpt.git
cd shuangling-gpt
powershell -NoProfile -ExecutionPolicy Bypass -File .\setup.ps1
~~~

也可下载源码 ZIP 后在解压目录运行最后一行。准备脚本下载固定版本的 Node.js 与 Electron 并校验 SHA-256，安装锁定依赖、构建宿主并编译观察器；不安装插件或启动桌宠。可加 `-Plan` 只查看准备内容。完成后使用根目录的安装入口；免安装包用户无需运行此脚本。

</details>

## 日常操作

| 操作 | 效果 |
| --- | --- |
| 左键拖动／松手甩出 | 移动角色，保留物理交互 |
| 右键 | 打开霜白控制面板 |
| 总览 | 查看工作状态、选择用量聊天、暂停／恢复联动 |
| 动作 | 点播九种动作；用户操作优先，可用「恢复联动」交回控制 |
| 设置 | 调整可见高度、停靠位置、界面语言和随 Codex 自动启动 |
| Esc／点击面板外部 | 关闭面板，不退出角色 |
| 隐藏／退出 | 隐藏角色或完整退出；聊天事件不会擅自重新打开 |

备用入口：`启动霜铃.vbs`、`霜铃设置.vbs`、`退出霜铃.vbs`。主动退出会抑制本次 Codex 应用会话内的自动重启；完整关闭再打开 Codex，或明确手动启动，才恢复。

在面板「设置 → 界面语言」或高级设置中选择 **简体中文／繁體中文／English**，会保留当前聊天选择、动画、位置和其他设置。

## 用量显示的含义

- **任务状态**跟随整个本机 Codex 应用会话；用量选择不会改变任务联动范围。
- **上下文**显示所选聊天最近一次模型请求的采样，不是实时逐字计数。旧记录标注历史采样。
- **累计 token**仅统计所选聊天；记录不完整时用 `≥` 标明已核验下限，不等同于上下文占用或账单金额。
- **账户额度**来自当前认证的本机 Codex 原生只读接口，独立于聊天。识别到登录变更即清空旧采样，通常每 30 秒刷新；网络失败、缺失或过期显示未知。
- **5 小时窗口**以账号实际报告为准；Plus 报告该窗口时显示。Pro／Max 明确仅报告周窗口时隐藏 5 小时卡片，不用虚构数值代替未知。
- 当前 Codex 未向插件公开可核验的当前页面聊天接口，因此用量区采用手动聊天选择，不宣称自动追随当前页面。

## 常见问题

**为什么不自动出现？** 确认插件启用、设置中的自动启动打开、目录没有移动；然后完整关闭并重开 Codex。也可先使用手动启动入口。观察器识别 OpenAI.Codex 的主窗口，普通 ChatGPT 窗口或后台 Codex 命令行不会触发。

**为什么余额或上下文是未知？** 首次选择聊天、登录或网络变化时需要重新采样。没有本机日志、格式变化、权限不足或额度未报告时保留未知；不从其他聊天借用数值。

**手动退出后怎么没有自动回来？** 这是本次会话的退出抑制规则。手动启动，或完整关闭再重新打开 Codex。

**能用在 macOS／Linux 或云端任务吗？** 当前 Windows 桌宠和自动启停仅支持 Windows x64，只跟踪当前本机 Codex 会话。仓库不是 ChatGPT Pets 的通用一键导入包。

**动画是否已完全没有瑕疵？** 当前九段为可用版本，挥手袖口和局部转身仍有细节限制；后续改进欢迎提交 Issue。仓库不含历史候选和生成过程的庞大归档。

## 开发

~~~powershell
# 完成 setup 后，使用随项目准备的 Node
.\windows\runtime\node\node.exe --test --test-concurrency=4 tests/bridge/*.test.mjs tests/plugin/*.test.mjs tests/lifecycle/*.test.mjs tests/panel/*.test.mjs
~~~

源码目录：`src/bridge`（工作状态、聊天用量和当前账号）、`src/plugin`（MCP）、`src/lifecycle` 与 `windows/lifecycle`（自动启停），以及 `vendor/dsh-pet`（保留上游与本项目修改的宿主）。最终九段动画在 `windows/assets/shuangling`。

详见 [联动与接口](BRIDGE.md)、[隐私](docs/PRIVACY.md)、[更新记录](docs/CHANGELOG.md)和[源码准备检查记录](reports/publication-check.json)。公开版本保留既有九段媒体的字节；来源记录只保留运行所需的相对路径元数据，并重新绑定校验值。

## 致谢与参考

- **桌宠运行时参考**：[PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)，固定提交 [d7a308e](https://github.com/PC2005-cloud/dsh-pet/tree/d7a308ecd4504cf4468c03707ce228ed1e1c0402)。复用并修改其独立模式、透明窗口、拖拽物理与本机接口，保留 [上游 MIT 许可证](vendor/dsh-pet/LICENSE)。
- **初始参考图原作者**：B 站 [@ZipZipPipe](https://space.bilibili.com/4168597)。该作者创作了用户最初提供的参考图；霜铃的 Q 版形象与桌宠动画由本项目在此基础上改编制作，署名不代表原作者参与开发或背书。
- **美术许可**：针对本项目关于 Q 版改编、动画制作及 GitHub 免费公开分享的申请，原作者回复“非商业用途随意”（由项目维护者提供）。本项目依据该回复在非商业范围内制作和分享，并保留原作者署名；美术素材不纳入代码 MIT，商用须另行取得相关权利人的许可。完整说明见 [ASSETS](ASSETS.md)。
- **制作辅助**：OpenAI 图像生成与 MiniMax 视频素材，以及本地逐帧处理。生成服务和官方 Pets 工具不随本仓库再分发。

本项目独立维护，不是 OpenAI、Codex、MiniMax 或上述作者的官方产品。新增代码采用 MIT；第三方代码保留原许可证，美术素材不纳入代码 MIT 的授权范围。见 [NOTICE](NOTICE.md)、[ASSETS](ASSETS.md) 与 [UPSTREAM](UPSTREAM.md)。
