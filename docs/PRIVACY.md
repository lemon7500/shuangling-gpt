# Privacy / 隐私 / 隱私

The pet runs locally on Windows. It reads allowlisted task events and numeric token samples from local Codex root-chat logs, chat/project naming metadata for explicit selection, and read-only native current-account quota. The file parser can encounter log records containing conversation fields; those bodies are not retained in state, saved by this integration, or transmitted.

The window observer checks process/package identity and main-window presence only. Authentication detection reads file version metadata, not credential contents; authentication and network quota retrieval remain inside the native Codex client. Only sanitized plan/window/time/percentage fields reach the panel. This integration does not start model tasks and needs no separate API key.

Project-local `windows/data` contains settings, session tracking, cached local endpoint capabilities and runtime logs. Treat it as private. Git also ignores the generated MCP path manifest, runtime binaries, dependency caches and installation reports. Sharing a diagnostic file still requires checking its content first.

The independent Frost desk stores timer durations/status/checkpoints, journal selection/read status/favorites/reading positions, manually entered bookmark text, pin/archive flags and local timestamps in `windows/data/desk.json` (or `desk.json` inside an explicitly overridden data directory). Its six stories are fixed project-written fiction, not summaries of conversations. It does not scrape chats, the browser, the clipboard or other applications to fill bookmarks. Text you explicitly enter and save, including anything private you paste yourself, is stored locally as entered; this file is not a credential vault or encrypted storage. Unsaved bookmark drafts are not written to `desk.json`.

**Our days together** is enabled by default and adds a small local experience ledger to `desk.json`: aggregate completed-focus minutes/counts, opaque hashes for explicitly completed root-chat turns, dated journal pages in three languages, selected bookmark excerpts, your saved replies/edits, and once-per-day hint bookkeeping. It starts at enablement and does not reconstruct conversation history. Task identities are hashed before reaching the ledger; conversation bodies, paths and original chat/turn identifiers are not stored there. Recording and hint switches are independent. Disabling recording stops new collection/generation/hints while preserving existing pages. The journal uses local, prewritten character narration and adds no model call, external text service or analytics.

Deleting a source bookmark clears tracked derived quotes by default; editing/clearing a source reply updates its derived copies. Edited prose preserves unrelated user wording and removes matching direct quotes; independently written paraphrases and replies require your own editing. The store is bounded to 365 pages and 8MiB; existing pages are never evicted automatically. Private backups made before a local update may still contain the older version of your text, so inspect them before sharing. See the [Frost desk guide](COMPANION-DESK.md) for controls and limits.

Frost desk uses fixed, authenticated loopback `/api/desk` operations through a restricted Electron main-process IPC bridge. The renderer receives only the bounded public desk snapshot and chosen language, never endpoint credentials, filesystem paths or an arbitrary URL/request facility. Story and bookmark bodies are rendered as plain text; addresses in them do not automatically open. Ambient preferences (`ambientEnabled`, `ambientFrequency`) are stored with the existing local preferences. These features add no model calls, analytics or content-upload service. Closing the tool window does not stop a running timer; sleep and application exit pause it. See the [Frost desk guide](COMPANION-DESK.md) for recovery and backup behavior.

霜白小工具仅在本机 `desk.json` 保存计时、手记已读／收藏／阅读位置和你手动保存的书签文字，不自动提取聊天、剪贴板或网页内容。手动粘贴并保存的隐私内容也会保存在该文件中，分享或备份 `windows/data` 前请先检查。六篇手记为固定创作故事。窗口不获得本机接口凭据，也不能自行打开文本中的地址。

「我们的日常」默认开启，仅从启用时积累已完成专注的分钟与次数、明确结束根聊天轮次的散列去重凭据、你选中的书签节选、补写与手改正文，以及日期和提示去重记录。它不保存聊天正文、路径或原始聊天／轮次编号，不倒推过去的工作。记录和提示可分别关闭；关闭记录后停止新采集、生成与提示，保留已有页。文本由本地角色文案组合，不增加模型请求或上传。删除来源默认清除派生直接引用，自己的转述与独立回应仍需自行编辑；更新前的本地私人备份可能保留旧文本。最多365页、8MiB，旧页不会被自动清理。

霜白小工具僅在本機 `desk.json` 儲存計時、手記已讀／收藏／閱讀位置及你手動儲存的書籤文字，不會自動擷取聊天、剪貼簿或網頁內容。手動貼上並儲存的私人內容也會留在該檔案中，分享或備份 `windows/data` 前請先檢查。六篇手記為固定創作故事。視窗不會取得本機介面憑證，也不能自行開啟文字中的位址。

「我們的日常」預設開啟，僅從啟用時累積已完成專注的分鐘與次數、明確結束根聊天輪次的雜湊去重憑據、選定書籤節選、補寫與手改正文，以及日期和提示去重紀錄。不儲存聊天正文、路徑或原始聊天／輪次編號，不推補過去工作。記錄和提示可分別關閉；關閉記錄後停止新蒐集、生成與提示，保留舊頁。文字以本機角色文案組合，不增加模型請求或上傳。刪除來源預設清除衍生直接引用，自行轉述及獨立回應仍須自己編輯；更新前的本機私人備份可能留有舊文字。最多365頁、8MiB，不自動清理舊頁。

The setup script connects to official Node.js/Electron distribution locations and npm for downloads. Native quota reads may connect through Codex's existing account service. This project does not add an analytics or conversation-upload service.
