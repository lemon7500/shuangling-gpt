# Changelog

## 1.9.1 — Frost note cards, WenKai and consistent icons (2026-10-31)

### 简体中文

- 提示气泡改为霜白淡紫纸卡，增加细边框、雪花印记与更从容的阅读时间；仅调整气泡，不改变角色窗口、位置或动画。
- 离线随附 LXGW 的霞鹜文楷 1.530 原版，提示与短标签覆盖简体、繁体、英语；正文与用户输入保留系统字体及缺字回退。字体加载完成后重新定位可见提示，用量气泡保留原有完整布局。
- 每种语言加入六条完成短句，按顺序轮换、不紧邻重复；保留已有事件去重及隐藏、暂停、手动接管优先规则，不新增动作或声称任务已通过验收。
- 面板和小工具采用统一线条图标，保留按钮翻译、无障碍名称和既有操作。
- 修复专注、霜铃手记、我的书签首次点击后未显示的问题；工具就绪后再交接菜单，并确认窗口可见，首次启动即可打开对应页面。
- 每次有效左键按下即时产生短暂 Q 弹反馈，不再等待视频解码或较长陪伴动作的冷却；拖拽或取消时正确复位，同一次点击不重复触发回弹，较长动作的原有节奏保留。
- 延用 1.9.0 已接纳的全部动画文件及媒体版本记录。代码 MIT、字体 OFL-1.1 和 @ZipZipPipe 原参考图衍生美术的非商业许可分别保留。

### 繁體中文

- 提示氣泡改為霜白淡紫紙卡，加入細邊框、雪花印記及更從容的閱讀時間；僅調整氣泡，不改變角色視窗、位置或動畫。
- 離線隨附 LXGW 的霞鶩文楷 1.530 原版，提示與短標籤涵蓋簡體、繁體、英語；內文及使用者輸入保留系統字型與缺字後備。字型載入完成後重新定位可見提示，用量氣泡保留原有完整版面。
- 每種語言加入六句完成短句，依序輪替、不連續重複；保留既有事件去重及隱藏、暫停、手動接管優先規則，不新增動作或宣稱工作已通過驗收。
- 面板及小工具採用統一線條圖示，保留按鈕翻譯、無障礙名稱與既有操作。
- 修復專注、霜鈴手記、我的書籤首次點選後未顯示的問題；工具就緒後才交接選單並確認視窗可見，首次啟動即可開啟對應頁面。
- 每次有效左鍵按下即時產生短暫 Q 彈回饋，不再等待影片解碼或較長陪伴動作的冷卻；拖曳或取消時正確復位，同一次點選不重複觸發回彈，較長動作的原有節奏保留。
- 沿用 1.9.0 已接納的全部動畫檔案及媒體版本紀錄。程式碼 MIT、字型 OFL-1.1 與 @ZipZipPipe 原參考圖衍生美術的非商業許可分別保留。

### English

- Restyle captions as frost-white and lilac note cards with a fine border, snowflake seal and more reading time. Only the caption changes; the character window, position and animations retain their existing behavior.
- Bundle LXGW's original WenKai 1.530 offline font for captions and short labels in Simplified Chinese, Traditional Chinese and English. Long text and user input retain system fonts and missing-glyph fallbacks. Reposition visible captions when fonts finish loading and retain the usage bubble's complete layout.
- Rotate six completion lines per language without immediate repetition. Preserve event deduplication and the priority of hiding, pause and manual control, without introducing another animation or claiming that a task passed verification.
- Use consistent line icons across the control panel and tools, preserving translated labels, accessible names and existing operations.
- Fix focus, journal and bookmark windows failing to appear on their first click. Hand off the menu after the tool is ready and confirm window visibility so a cold launch opens the requested page.
- Give every valid left-button press an immediate, brief springy response, without waiting for video decoding or the longer companion gesture cooldown. Restore the pose on dragging or cancellation, avoid a second bounce for the same click and retain the existing pace of longer gestures.
- Retain all accepted 1.9.0 animation files and media-version records. Preserve MIT for code, OFL-1.1 for fonts and the separate noncommercial permission for artwork adapted from @ZipZipPipe's original reference.

See the [trilingual release notes](releases/v1.9.1.md) for installation, migration and credits.

## 1.9.0 — Companion desk and animation runtime (2026-10-31)

- Add a separate three-language focus timer and journal/bookmark window. Focus and breaks always start manually; closing the window keeps time, while sleep or full exit pauses it for explicit resumption.
- Include six immediately readable character stories, saved favorites and reading position, and user-written local bookmarks with editing, pinning and archiving. No automatic conversation or clipboard extraction.
- Add **Our days together**, with locally assembled dated pages from confirmed turn endings, completed focus sessions and explicitly marked bookmarks. Replies, editable prose and continue-next-time bookmarks retain their links across days and restarts. Recording and gentle hints have separate switches; no conversation bodies, external text service or extra model request are used.
- Schedule accepted reading, glancing and wing-stretch clips only during confirmed idle time, with weighted selection, end-based cooldowns and no consecutive repetition. Quiet/normal/lively preferences never clear pause, hide or manual takeover. All 12 actions are available. Reading uses the accepted provisional 10-second version, retimed locally from the existing sample without another video-generation call; book height and page-to-face clearance remain details for later refinement.
- Recognize the standalone host's verified `main` media route for Shuangling, preserving the original canonical route and rejecting unrelated pets or custom media. Apply measured transparent-background cleanup before outlining; the native audit now requires that trusted cleanup path to be active rather than treating playback alone as a visual pass.
- Adopt reviewed native-24-fps thinking, checking and waiting clips and the improved waving candidate. Retain classic variants for randomized manual playback, capped at two consecutive plays of one variant. Preserve the accepted idle artwork, use the subsequently accepted local left/right run repairs, and trim the jump's excess near-apex hold without interpolating or blending frames.
- Add lift, continuous held-loop and set-down drag phases. Keep readable snowflakes while removing detached point-like decoration, with effect bounds tied to the character. Preserve natural neutral-pose entry/return and reject stale playback generations instead of dissolving between incompatible poses.
- Reuse bounded private canvas workspaces across idle, reading and wing-stretch handoffs to reduce repeated allocation without raising the memory limit. Fully overwrite copied regions, retain separate frame identities/timestamps, and release resources on failure or disposal; synthetic comparisons preserve identical RGBA output.
- Preserve confirmed user takeover even when it arrives with a new task event. Drop queued companion cues on interaction and restart the quiet interval after a cue actually ends.
- Restore the requested tool page on its first cold open, wait for pending saves before a confirmed close, and retain drafts and the trusted interface language across data failures. Failed or late panel commands no longer cancel local actions or affect a newer panel session.
- Fence sleep-pause handling to the matching timer run, and retain an unknown work state while a new session header is incomplete rather than announcing completion early. Recover promptly from temporary state-poll failures without treating log silence as task completion.
- Preserve core task-state events, account/chat usage separation, automatic startup, settings and all artwork/upstream attribution. Animation decoding and reading/wing/idle transitions remain under investigation; this is not a claim of zero dropped frames on every device. The **v1.9.0** Windows x64 portable package includes the accepted runtime, all 18 media files, bundled Node/Electron, production dependencies and double-click installation entries. Homepage preview media remain historical **v1.8.4** captures.

## 1.8.4 — Prompt Codex startup and persistent window observation

- Host the window observer through the current user's Windows scheduled task, keeping it ready between Codex sessions without waiting for a chat plugin connection.
- Move scheduled-task maintenance off the native window-observation path so a slow task query cannot block pet startup, heartbeat updates or the three-second close grace.
- Require a fresh observer heartbeat after requesting scheduled startup, retain manual launch if task access is unavailable, and preserve automatic-start preferences and manual-exit suppression.
- Transfer observer ownership during installation and disable verified old-directory login tasks. Require an active previous pet to exit before migration, while retaining personal settings.
- Retain all nine animation clips, the three interface languages, remembered usage chat, settings and existing artwork/upstream attribution.

## 1.8.3 — Translation completion and remembered usage chat

- Persist the explicitly selected usage chat across restarts, independently of the default chat, global task following and shared account quotas. Revalidate saved chats before showing usage; temporarily unavailable chats stay selected with unknown values.
- Complete language switching for the native tray, default hover/accessibility name, window title and configuration error banner. Custom pet names are preserved.
- Add real-renderer checks for three languages at 100/150/200% panel scaling, narrow/desktop advanced settings, full-process language persistence and native animation playback.

## 1.8.2 — Windows portable package and interface languages

- Add a Windows x64 portable package with bundled Node/Electron, production dependencies, compiled desktop host and window observer; no source compilation is needed for package users.
- Provide double-click plugin installation and manual start/settings/exit entries. The installer generates paths only for the user's extracted directory; shipped MCP template metadata remains disabled.
- Make the portable download the primary quick-start path in Simplified Chinese, Traditional Chinese and English; retain source setup as a developer option and include a trilingual package readme.
- Add Simplified Chinese, Traditional Chinese and English interface selection in the control panel and advanced settings, preserving existing user preferences.
- Retain the nine existing animation clips, homepage previews, upstream notices and attribution to the original reference-image author, Bilibili @ZipZipPipe.

## 1.8.1 — public source edition

- Separate whole-Codex work state, explicitly selected chat usage, and current-authenticated-account quota.
- Native read-only account provider clears old snapshots on authentication changes and rejects late old-account responses; weekly-only accounts hide the inapplicable 5-hour card.
- First launch works without a preselected usage chat and exposes safe local choices.
- Frost-white/lilac control panel, nine final animation clips, Windows Codex window lifecycle observer and manual-exit suppression.
- Add Windows source preparation script, Simplified Chinese / Traditional Chinese / English documentation, upstream MIT notice and character-design attribution.
- Normalize publication metadata paths while retaining all nine deployed animation files unchanged. Local settings, history, runtime binaries and private reports are excluded.

Known limitations: some sleeve/turning artwork details remain; current-page automatic usage selection is unavailable. Real Plus/Max account switching has not yet been tested on this machine; Pro has been checked live. The public source preparation path is checked separately from the already-running local installation; see the publication verification record.
