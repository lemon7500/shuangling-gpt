# 霜白小工具 / 霜白小工具 / Frost desk

[简体中文](#简体中文) · [繁體中文](#繁體中文) · [English](#english)

## 简体中文

右键霜铃，在「总览」点击「专注」「霜铃手记」或「我的书签」，打开独立工具窗。它不改变宠物的大小、位置或聊天绑定，失去焦点也不会像右键面板一样关闭。界面与手记沿用设置中的简体中文、繁體中文或 English。

本页描述 1.9.0；Windows 免安装包包含本页功能。首次打开工具直接进入所选页面，保存中切页或确认关闭会等待写入完成；断连时保留草稿及已确认的界面语言，不把读取失败当成空记录。

### 专注

默认专注 25 分钟、休息 5 分钟。尚未开始或本段完成后，可修改专注 10–120 分钟、休息 1–30 分钟并保存；每次均需手动点击「开始专注」或「开始休息」。暂停会保留剩余时间，「继续计时」从该时间恢复，「结束本段」回到未开始状态。计时进行或暂停期间先结束本段，才能重新配置时长。

关闭工具窗不会停止计时；休眠和应用退出会暂停，重开后由你决定何时继续。完成一段后不会自动开始休息或下一轮。异常退出后按最近已保存的检查点恢复为暂停，不把离线时间计入专注；最后一次检查点之后的少量进度可能未保存。这里的计时不代表 Codex 的模型工作时长，也不会创建模型任务。

到时提醒遵守任务与用户操作优先：Codex 忙碌、霜铃隐藏、拖拽或手动接管时，不抢播动作、不自动显示桌宠，也不在恢复后补播过时提醒。

### 霜铃手记

六篇角色短篇依次为「风铃下的名字」「那枚玫瑰」「歪了一点的书签」「没写满的一页」「窗边的微光」「第一条见闻」，每篇均有三语正文。选择一篇会标记已读；收藏按钮与「只看收藏」用于整理，滚动位置按篇保留，停止滚动约半秒后保存。它们是固定创作故事，不是对你聊天内容的记录或总结。

### 我的书签

手动填写文字后点击保存，可编辑、置顶、归档、移出归档和删除。归档也计入 100 条总上限；每条最多 1,000 字符。删除需再次确认。书签是纯文本，保存的地址不会自动打开。关闭窗口或按 Esc 时，如果还有未保存输入，会先让你选择继续编辑或放弃修改；中文输入候选期间的 Esc 不会关闭工具窗。

### 我们的日常

「霜铃手记」内保留六篇「霜境往事」，另有「我们的日常」。书签可选「值得记住」或「下次继续」；普通书签不会自动引用。新功能从启用时起记录可确认的根聊天轮次结束、已完成的专注，以及主动留下的片段，不读取或概括聊天正文，也不把一轮结束写成整个项目完成。

跨日后，有记录的日期会形成一页三语手记。可以「补一句」、编辑当前语言正文、移除某个片段，或「留到下次」打开预填的书签编辑器；预填内容需手动保存。回应以你的文字保留，后续页面可以接着提起；继续书签可再次打开、暂放或标记告一段落。没有记录的日子不会编造工作。

「记录设置」中的自动记录和轻提示分开控制，默认开启。关闭记录后停止新采集、生成与提示，旧页仍可阅读；只关轻提示仍会记录。每天最多一次气泡，只在桌宠可见、空闲且未被接管时显示，忙碌或隐藏时不自动开窗。继续书签处理后冷却三天，已完成或归档的书签不再提示。

删除书签时，默认同时移除手记中的派生引用，也可以在确认区选择保留。修改或清空原回应会同步更新派生引用。自动正文会相应重建；你改过的正文保留，仅将匹配来源的直接引用替换成「…」。自己另写的转述或独立回应仍由你编辑。旧页不会自动删除；达到365页上限时暂停新增，可自行删除旧页后继续。全部在本机保存，无额外模型请求或生成积分消耗。

### 自主陪伴

安静／适中／活跃的基础间隔分别为 45–90／25–45／12–25 秒，从前一个动作真实结束后计算；完整常态片段播完可能略长。看书冷却 180 秒、侧望冷却 45 秒、舒翼冷却 120 秒，均从动作结束起算，不连续重复同种自主动作。可用动作的选择权重为看书 40%、侧望 40%、舒翼 20%；冷却中的动作暂不参与选择。

在右键面板「设置」切换自主陪伴，并选择安静、适中或活跃。闲暇动作只使用已安装且已接纳的素材，遵守间隔、冷却与用户操作优先规则。1.9.0 动作页的 12 个动作均可用，新增「侧望微光」「轻舒双翼」「翻看见闻」。阅读采用已接纳的 10 秒暂定版，本次接入由既有样片本地调整阅读节奏，不额外生成视频；书本高度及翻页靠脸的细节仍可继续优化。页面计数以实际安装的接纳素材为准。隐藏或退出后，工具不会擅自重新显示宠物。

点击思考、检查或等待时，从新旧两个版本随机选播，同一版本不连续超过两次；这不改变真实任务状态。拖拽使用托起、持续循环和放下三个阶段。看书中收到任务会先自然收书，不以突然切姿势代替衔接；播放与解码仍在优化，不承诺所有电脑零丢帧。

### 本地保存与隐私

计时状态、阅读／收藏／位置、书签文字及时间戳保存在 `windows/data/desk.json`；若明确使用独立数据目录，则在该目录的 `desk.json`。自主陪伴偏好保存在既有的本地偏好文件中。迁移时先退出应用，再备份和复制整个数据目录，不要覆盖正在运行的状态文件。

工具不自动读取剪贴板、浏览器页面或对话来生成书签，不需要 API Key，也不添加模型请求或上传服务。你手动粘贴并保存的内容仍会存入本机文件；它不是加密保险库，分享诊断或备份前请检查。界面只能调用固定的本机接口，不会得到接口凭据。详细字段见 [BRIDGE](../BRIDGE.md#frost-desk-and-ambient-preferences)，整体隐私说明见 [PRIVACY](PRIVACY.md)。

## 繁體中文

按右鍵開啟霜鈴面板，在「總覽」點選「專注」「霜鈴手記」或「我的書籤」，即可開啟獨立工具視窗。它不改變桌寵大小、位置或聊天綁定，失去焦點也不會關閉。介面與手記沿用設定中的簡體中文、繁體中文或 English。

本頁描述 1.9.0；Windows 免安裝包包含本頁功能。首次開啟直接進入所選頁面，儲存中切頁或確認關閉會等待寫入完成；斷線時保留草稿及已確認的介面語言，不將讀取失敗視為空紀錄。

### 專注

預設專注 25 分鐘、休息 5 分鐘。尚未開始或本段完成後，可儲存專注 10–120 分鐘、休息 1–30 分鐘的時長；每一段都須手動開始。暫停保留剩餘時間，「繼續計時」接續該時間，「結束本段」回到未開始狀態。計時中或暫停時，先結束本段才能變更時長。

關閉工具視窗仍繼續計時；休眠及退出應用程式會暫停，重開後須手動恢復。完成後不會自動開始休息或下一輪。異常退出時依最近儲存的檢查點恢復為暫停，不計入離線時間，最後一次檢查點後的少量進度可能遺失。這個計時不是 Codex 模型工作時長，也不會建立模型工作。

到時提醒遵守工作與使用者操作優先：Codex 忙碌、霜鈴隱藏、拖曳或被手動接管時，不搶播動作、不自行顯示桌寵，恢復後也不補播過時提醒。

### 霜鈴手記與我的書籤

六篇固定創作短篇依序為「風鈴下的名字」「那枚玫瑰」「歪了一點的書籤」「沒寫滿的一頁」「窗邊的微光」「第一條見聞」，各有三語內容。選取即標記已讀，可收藏及只看收藏；每篇保留閱讀位置，停止捲動約半秒後儲存。它們不會摘要或記錄你的聊天。

書籤由你手動輸入及儲存，支援編輯、置頂、封存、移出封存和刪除。最多 100 條（含封存），每條最多 1,000 字元；刪除須再次確認。文字中的位址不會自動開啟。未儲存內容遇到關閉或 Esc 時，會先詢問繼續編輯或放棄；中文輸入候選期間不會被 Esc 關閉。

### 我們的日常

手記保留六篇「霜境往事」，另設「我們的日常」。書籤可選「值得記住」或「下次繼續」；普通書籤不會自動引用。從啟用時起，只記錄可確認的根聊天輪次結束、完成的專注及你主動留下的片段，不讀取或摘要聊天正文，不將一輪結束說成整個專案完成。

跨日後，有紀錄的日期會形成一頁三語手記。可以補一句、編輯目前語言正文、移除片段，或「留到下次」開啟預填的書籤編輯器；仍須自行儲存。你的回應會保留，也能在後續頁面接續提起。繼續書籤可再次開啟、暫放或標為告一段落；空白的日子不編造工作。

自動記錄和輕提示於「記錄設定」分開開關，預設開啟。關閉記錄即停止新蒐集、生成和提示，舊頁仍可閱讀；只關提示仍會記錄。氣泡每天最多一次，只在桌寵可見、閒暇且未被接管時顯示，不強制開窗。繼續書籤處理後冷卻三天，已完成或封存後不再提示。

刪除書籤預設一併移除手記衍生引用，也能在確認區選擇保留。修改或清空原回應會同步更新衍生引用。自動正文會重建；手改正文保留，只將相符的直接引用替換為「…」。自行轉述或獨立回應仍由你編輯。不自動刪除舊頁；達365頁時暫停新增，可自行刪除舊頁後繼續。資料留在本機，不新增模型請求或消耗生成積分。

### 自主陪伴與本機資料

安靜／適中／活躍的基本間隔分別為 45–90／25–45／12–25 秒，從前一個動作真正結束後計算；完整常態片段播完可能略長。看書冷卻 180 秒、側望冷卻 45 秒、舒翼冷卻 120 秒，均從動作結束起算，不連續重複同種自主動作。可用動作的選擇權重為看書 40%、側望 40%、舒翼 20%；冷卻中的動作暫不參與選擇。

於右鍵面板「設定」開關自主陪伴，頻率為安靜／適中／活躍。閒暇動作只選已安裝且已接納的素材，保留間隔、冷卻及使用者操作優先。1.9.0 動作頁的 12 個動作均可用，新增「側望微光」「輕舒雙翼」「翻看見聞」。閱讀採用已接納的 10 秒暫定版，本次接入由既有樣片在本機調整閱讀節奏，不額外生成影片；書本高度及翻頁靠臉的細節仍可繼續改善。頁面計數以實際安裝的接納素材為準。隱藏或退出後不會自行再顯示桌寵。

點選思考、檢查或等待時，從新舊兩版隨機播放，同一版不連續超過兩次；這不改變真實工作狀態。拖曳採用托起、持續循環與放下三階段。看書時收到工作會先自然收書，不以突然換姿勢取代銜接；播放與解碼仍持續改善，不承諾所有電腦都零掉格。

計時、閱讀／收藏／位置、書籤文字及時間戳儲存在 `windows/data/desk.json`，或明確指定資料目錄中的 `desk.json`；自主陪伴偏好仍放在既有偏好檔案。備份或搬移前先退出應用程式，再複製整個資料目錄。

工具不會自動從剪貼簿、瀏覽器或聊天擷取書籤，不需 API Key，不新增模型請求或上傳服務。你自行貼上並儲存的私人內容也會留在本機；檔案不是加密保險庫，分享前請檢查。介面只使用固定本機能力，不會取得介面憑證。詳見 [BRIDGE](../BRIDGE.md#frost-desk-and-ambient-preferences) 及 [PRIVACY](PRIVACY.md)。

## English

Right-click Shuangling and choose **Focus**, **Shuangling’s journal** or **My bookmarks** in **Overview**. This opens a separate Frost desk window without moving/resizing the pet or changing its chat binding. It stays open when it loses focus. The interface and stories use your chosen Simplified Chinese, Traditional Chinese or English language.

This guide describes version 1.9.0; the Windows portable package includes these features. A cold open goes directly to the requested page. Navigation or a confirmed close waits for pending saves; a disconnection preserves drafts and the last confirmed interface language rather than treating failed reads as empty records.

### Focus

Defaults are 25 minutes of focus and a 5-minute break. While idle or completed, save a focus duration of 10–120 minutes and a break duration of 1–30 minutes. Start every session manually. Pause preserves remaining time; Resume continues it; End session resets to idle. End a running/paused session before changing durations.

Closing the tool window keeps the timer running. Sleep or application exit pauses it; reopening requires a manual resume. Completion never starts a break or the next focus session automatically. After an unexpected exit, the last saved checkpoint is restored as paused, without counting offline time as focus. Some progress since the last checkpoint may be lost. This timer does not measure Codex model work and does not start model tasks.

### Journal and bookmarks

The six fixed fictional entries are **A Name Beneath the Chimes**, **The Rose Keepsake**, **A Slightly Crooked Bookmark**, **Room for Tomorrow**, **Light by the Window**, and **Her First Travel Entry**. Each has three language versions. Selecting an entry marks it read. Favorite entries, filter favorites, and return to each entry’s saved reading position. Position writes wait for about half a second after scrolling stops. Stories do not summarize or record your conversations.

Bookmarks are manually entered plain text. Create, edit, pin, archive, unarchive or delete them. The limit is 100 entries including archived ones, with at most 1,000 characters each. Deletion requires a second confirmation; addresses in text do not automatically open. Closing or pressing Esc with unsaved text offers Keep editing or Discard and close. Escape during Chinese input composition does not close the window.

### Our days together

The journal keeps its six **Frost Library stories** and adds **Our days together**. Mark a bookmark **Worth remembering** or **Continue next time** to include a moment; ordinary bookmarks are not quoted automatically. Collection starts when enabled and uses confirmed root-chat turn endings, completed focus sessions and words you explicitly save. Conversation bodies are not read or summarized, and a finished turn is never described as a finished project.

After the date changes, a recorded day becomes a translated journal page. Add your own line, edit the current language, exclude a fragment, or carry a thought into a prefilled bookmark editor. Prefilled bookmarks still require Save. Your replies can be recalled on later pages. Return to a continuing bookmark, leave it for later, or mark it settled for now. Days without records do not acquire invented work.

Automatic recording and gentle hints have separate switches under **Memory settings**, both enabled by default. Turning recording off stops new collection, page generation and hints; existing pages remain readable. Turning only hints off keeps recording. At most one bubble appears per day, while the pet is visible, idle and free of manual control. It never opens a window automatically. A handled continuation rests for three days; settled or archived bookmarks are not prompted again.

Deleting a bookmark removes its derived journal quotes by default; the confirmation also offers to keep them. Editing or clearing an original reply updates its derived copies. Automatic prose is rebuilt; your edited prose is retained, with matching direct quotes replaced by “…” where necessary. Your own paraphrases and independent replies remain yours to edit. Old pages are never automatically deleted. At 365 pages, new collection/pages pause until you choose to delete pages. Everything stays local, without additional model requests or generation credits.

### Ambient company and local data

Quiet, Normal and Lively intervals are 45–90, 25–45 and 12–25 seconds from the previous gesture’s actual end. Finishing a complete idle clip may extend the interval slightly. Reading has a 180-second cooldown, glancing a 45-second cooldown and wing stretching a 120-second cooldown, all measured from the end. The same autonomous gesture never runs twice in succession. Eligible gestures have selection weights of 40% reading, 40% glancing and 20% wing stretching; gestures on cooldown are excluded.

In the right-click **Settings** page, turn ambient company on/off and choose Quiet, Normal or Lively. Idle selection uses installed, accepted assets with intervals, cooldowns and user interaction taking priority. All 12 actions are available in 1.9.0, adding **Glance at light**, **Stretch wings** and **Read journal** to the original nine. Reading uses the accepted provisional 10-second version, with its pace adjusted locally from the existing sample rather than generating another video. Its book height and the page turning close to the face can still be refined. The counter reflects the accepted files actually installed. Hidden or closed pets are not reopened automatically.

Manual thinking, checking and waiting selections randomly choose between the new and classic variants, with no more than two consecutive plays of one variant. This does not change the real task state. Dragging uses lift, continuous held-loop and set-down phases. An incoming task allows reading to stow the book naturally instead of jumping to another pose. Playback and decoding remain under refinement; zero dropped frames on every computer is not promised.

Focus completion respects tasks and user control: while Codex is busy, Shuangling is hidden, dragged or manually controlled, the reminder does not take over the animation or reveal the pet. Expired reminders are not replayed afterwards.

Timer state, journal reading/favorites/positions, bookmark text and timestamps stay in `windows/data/desk.json`, or `desk.json` in an explicitly overridden data directory. Ambient preferences stay in the existing preferences file. Exit the application before backing up or moving the whole data directory; do not replace a live state file.

The tools do not scrape the clipboard, browser or conversations to create bookmarks. They require no API key, extra model calls or upload service. Private text you explicitly paste and save still goes into the local file. It is not an encrypted vault; inspect data before sharing it. The renderer has only fixed local capabilities and receives no endpoint credentials. See [BRIDGE](../BRIDGE.md#frost-desk-and-ambient-preferences) and [PRIVACY](PRIVACY.md).
