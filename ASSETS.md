# 美术素材 / 美術素材 / Artwork

## 简体中文

初始参考图原作者为 B 站 [@ZipZipPipe](https://space.bilibili.com/4168597)。本项目基于该参考图，通过 AI 图像／视频辅助制作和本地逐帧处理，改编制作霜铃的 Q 版形象与桌宠动画。原始参考设定图、历史候选和生成服务的工具代码不在本次公开仓库中。

针对本项目关于 Q 版改编、动画制作及在 GitHub 免费公开分享的申请，原作者回复如下（由项目维护者提供）：

> 非商业用途随意

本项目依据该回复，在非商业范围内制作和免费分享霜铃桌宠，供下载、运行、学习和参考，并持续保留原作者署名。涉及商业用途时，须另行取得相关权利人的许可。

原画及相关既有设计的权利仍归相应权利人所有。该许可不转移这些权利；署名及许可不代表原作者参与开发或为项目背书。本说明不授予超出原作者许可范围的素材使用权。

新增代码和文档继续采用根目录的 [MIT 许可证](LICENSE)，第三方代码遵循各自许可证。角色形象、头像、动画及预览中的美术内容**不纳入代码 MIT 的授权范围**；美术的非商业使用范围不改变代码的 MIT 许可。

## 繁體中文

初始參考圖原作者為 B 站 [@ZipZipPipe](https://space.bilibili.com/4168597)。本專案基於該參考圖，透過 AI 圖像／影片輔助製作與本機逐格處理，改編製作霜鈴的 Q 版形象與桌寵動畫。原始參考設定圖、歷史候選及生成服務的工具程式碼不在此次公開倉庫中。

針對本專案關於 Q 版改編、動畫製作及在 GitHub 免費公開分享的申請，原作者回覆如下（由專案維護者提供，保留簡體原文）：

> 非商业用途随意

本專案依據此回覆，在非商業範圍內製作與免費分享霜鈴桌寵，供下載、執行、學習與參考，並持續保留原作者署名。涉及商業用途時，須另行取得相關權利人的許可。

原畫及相關既有設計的權利仍歸相應權利人所有。此許可不移轉這些權利；署名及許可不代表原作者參與開發或為專案背書。本說明不授予超出原作者許可範圍的素材使用權。

新增程式碼與文件繼續採用根目錄的 [MIT 授權](LICENSE)，第三方程式碼遵循各自授權。角色形象、頭像、動畫及預覽中的美術內容**不納入程式碼 MIT 的授權範圍**；美術的非商業使用範圍不改變程式碼的 MIT 授權。

## English

The original reference artwork is by Bilibili [@ZipZipPipe](https://space.bilibili.com/4168597). This project adapts that reference into Shuangling's chibi design and desktop animations using AI-assisted image/video production and local frame processing. The original reference sheet, historical candidates and generation-service tool code are not redistributed in this repository.

In response to this project's request for chibi adaptation, animation production and free public sharing on GitHub, the original artist replied as follows, according to the reply supplied by the project maintainer:

> 非商业用途随意

English translation: "You may use it freely for non-commercial purposes."

The project relies on this reply to create and freely share Shuangling for non-commercial use, including downloading, running, learning and reference, while retaining the original artist's credit. Commercial use requires separate permission from the relevant rights holders.

Rights in the original artwork and existing designs remain with their respective rights holders. This permission does not transfer those rights or imply the artist's participation or endorsement. This notice grants no artwork rights beyond the scope of the artist's permission.

New code and documentation remain under the root [MIT license](LICENSE); third-party code retains its own licenses. The character design, avatar, animations and artwork in previews are **excluded from the code's MIT grant**. The artwork's non-commercial scope does not change the MIT license for code.

## Included media / 公开素材 / 公開素材

Development application media: `windows/assets/shuangling/*.webm`; avatar: `vendor/dsh-pet/runtime/electron-helper/panel-avatar.png`. The action menu offers 12 accepted actions. The 18 media files also include three manual alternatives and three internal drag clips. The provisional 10-second `reading` animation reuses the accepted H3 sample: its original 8 seconds / 192 frames were locally retimed with motion-compensated intermediate frames to 10 seconds / 240 frames, then keyed to transparency. It is not a new 10-second AI generation. Only accepted clips belong in the application media directory and `reports/windows-assets.json`. All 17 files installed before this reading addition retain their bytes, including idle and both runs. Media identities are recorded by hashes in `reports/`; publication normalizes metadata paths and recomputes their integrity binding.

README previews under `docs/media/` record the published 1.8.4 animations and control panel, including its nine-action screenshot; they do not preview development replacements. Panel captures use synthetic demonstration data. The preview GIF and character artwork within screenshots follow the same artwork notice above. See [preview sources](docs/media/README.md).
