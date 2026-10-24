<div align="center">
  <img src="vendor/dsh-pet/runtime/electron-helper/panel-avatar.png" width="128" alt="霜铃 GPT：银白龙女 Q 版桌宠" />
  <h1>霜铃 GPT · Shuangling GPT</h1>
  <p>陪你思考、等你回答，也陪你安静工作。</p>
  <p>Windows 桌宠 × Codex 本地插件 × 任务与用量面板</p>
  <p><a href="README.md">简体中文</a> · <a href="docs/i18n/README.zh-TW.md">繁體中文</a> · <a href="docs/i18n/README.en.md">English</a></p>
  <p><img alt="Windows x64" src="https://img.shields.io/badge/Windows-x64-8B73A6" /> <img alt="Version 1.8.1" src="https://img.shields.io/badge/version-1.8.1-8B73A6" /> <a href="LICENSE"><img alt="Code license MIT" src="https://img.shields.io/badge/code-MIT-8B73A6" /></a> <a href="https://github.com/lemon7500/shuangling-gpt/actions/workflows/windows.yml"><img alt="Windows source check" src="https://github.com/lemon7500/shuangling-gpt/actions/workflows/windows.yml/badge.svg" /></a></p>
</div>

霜铃是一只银白卷发、淡紫双翼的 Q 版龙女桌宠。她通过本地 Codex 插件跟随整个应用的任务状态，提供九种动画、拖拽与抛出交互，以及霜白淡紫的右键控制卡片。

**桌宠运行时参考并基于 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)。初始参考图原作者为 B 站 [@ZipZipPipe](https://space.bilibili.com/4168597)。** 霜铃的 Q 版形象和动画由本项目在该参考图基础上改编制作；代码与美术的权利说明分别见 [许可证](LICENSE) 和 [素材说明](ASSETS.md)。

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

截图来自实际面板代码，聊天和用量为演示数据；点击图片可查看清晰原图。界面目前为简体中文。[素材来源与预览说明](docs/media/README.md)

## 功能

| 功能 | 说明 |
| --- | --- |
| 九种角色动画 | 常态陪伴、左右小跑、挥手、小跳、收起、等你回答、认真思考、检查工作 |
| 整个 Codex 的任务联动 | 汇总当前本机 Codex 应用会话中的根聊天；子代理不会提前触发完成 |
| 独立右键控制卡片 | 总览、动作、设置三页；面板尺寸独立于角色缩放 |
| 聊天用量 | 按聊天名称选择，查看该聊天最近请求的上下文和累计 token |
| 当前账号额度 | 独立读取当前登录账号；切换用量聊天不会改变账户余额 |
| 随 Codex 自动启停 | 打开首个主窗口启动，全部主窗口关闭三秒后退出 |
| 桌面交互 | 拖拽、抛出反弹、边缘停靠、大小与位置调整、透明区域点击穿透 |
| 本地运行 | 不需要 API Key，不发起额外模型任务，不保存或上传对话正文 |

## 快速开始（安装插件）

**需要 Windows 10/11 x64、已安装的 Codex 桌面版，以及首次准备时的网络连接。** 当前提供源码安装流程，尚未上架官方插件商店，也没有附带运行时的预制 Release 安装包。首次准备建议留出至少 2 GB 空间。

### 1. 下载项目

使用 Git：

~~~powershell
git clone https://github.com/lemon7500/shuangling-gpt.git
cd shuangling-gpt
~~~

也可以在仓库页面选择 **Code → Download ZIP**，完整解压到一个固定目录，再在该目录打开 PowerShell。路径包含中文或空格均可；安装后不要随意移动此目录。

### 2. 准备运行环境

~~~powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\setup.ps1
~~~

脚本下载固定版本的 Node.js 与 Electron 并校验 SHA-256，安装锁定依赖、构建桌宠宿主、编译小型窗口观察器。该步骤不安装插件、不注册登录任务，也不启动桌宠。可先用 `-Plan` 查看准备内容；脚本发现已有依赖目录会停止，避免覆盖现有安装。

### 3. 安装 Codex 插件

双击根目录 **「安装Codex插件.vbs」**。也可以在 PowerShell 执行：

~~~powershell
.\windows\runtime\node\node.exe .\windows\install-plugin.mjs
~~~

安装器根据当前目录重建本机路径，通过 Codex 原生插件命令安装 `shuangling-gpt@shuangling-local`，并按偏好管理当前 Windows 用户的登录观察任务。直接添加仓库中的禁用模板不会完成安装；请使用这个安装入口。

### 4. 打开 Codex

**完整关闭并重新打开 Codex，无需发消息或手动调用工具。** 霜铃会随主窗口出现。首次用量尚未选聊天时显示未知；右键打开「总览」，在用量区选择本机聊天即可。默认单只、右下角、可见高度约 200 像素；声音和自动漫游关闭。

详细说明见 [安装、迁移与卸载](docs/INSTALL.md)。

## 日常操作

| 操作 | 效果 |
| --- | --- |
| 左键拖动／松手甩出 | 移动角色，保留物理交互 |
| 右键 | 打开霜白控制面板 |
| 总览 | 查看工作状态、选择用量聊天、暂停／恢复联动 |
| 动作 | 点播九种动作；用户操作优先，可用「恢复联动」交回控制 |
| 设置 | 调整可见高度、停靠位置和随 Codex 自动启动 |
| Esc／点击面板外部 | 关闭面板，不退出角色 |
| 隐藏／退出 | 隐藏角色或完整退出；聊天事件不会擅自重新打开 |

备用入口：`启动霜铃.vbs`、`霜铃设置.vbs`、`退出霜铃.vbs`。主动退出会抑制本次 Codex 应用会话内的自动重启；完整关闭再打开 Codex，或明确手动启动，才恢复。

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

详见 [联动与接口](BRIDGE.md)、[隐私](docs/PRIVACY.md)、[更新记录](docs/CHANGELOG.md)和[发布验证记录](reports/publication-check.json)。全新 Windows 环境已通过运行时下载、锁定依赖安装、宿主／观察器编译与核心测试。本次公开版本保留本地既有九段媒体的字节；来源记录只保留运行所需的相对路径元数据，并重新绑定校验值。

## 致谢与参考

- **桌宠运行时参考**：[PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)，固定提交 [d7a308e](https://github.com/PC2005-cloud/dsh-pet/tree/d7a308ecd4504cf4468c03707ce228ed1e1c0402)。复用并修改其独立模式、透明窗口、拖拽物理与本机接口，保留 [上游 MIT 许可证](vendor/dsh-pet/LICENSE)。
- **初始参考图原作者**：B 站 [@ZipZipPipe](https://space.bilibili.com/4168597)。该作者创作了用户最初提供的参考图；霜铃的 Q 版形象与桌宠动画由本项目在此基础上改编制作，署名不代表原作者参与开发或背书。
- **制作辅助**：OpenAI 图像生成与 MiniMax 视频素材，以及本地逐帧处理。生成服务和官方 Pets 工具不随本仓库再分发。

本项目独立维护，不是 OpenAI、Codex、MiniMax 或上述作者的官方产品。新增代码采用 MIT；第三方代码保留原许可证，美术素材不纳入代码 MIT 的授权范围。见 [NOTICE](NOTICE.md)、[ASSETS](ASSETS.md) 与 [UPSTREAM](UPSTREAM.md)。
