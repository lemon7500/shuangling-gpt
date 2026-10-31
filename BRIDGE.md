# Local integration

## Independent sources

- **Work state:** verified local root-chat events in the current Codex desktop application session. Child-agent events do not complete the parent task; silent logs and individual tool failures do not imply completion. Unknown or incompatible evidence stays unknown.
- **Chat usage:** explicitly selected local root chat, resolved against the local metadata index. Context is the last request sample; cumulative tokens belong to that chat. Incomplete cumulative evidence is displayed as a lower bound. The current desktop navigation route is not exposed to third-party plugins.
- **Account quota:** native local Codex `account/read` and `account/rateLimits/read`, independent of the chat selector. Authentication file metadata changes clear prior samples; generation and before/after account checks prevent late old-account results. No fallback to historic chat quota. Normal refresh is 30 seconds, with bounded retry.

First launch can have no usage chat selected. Whole-app work state and account reads continue while chat usage stays unknown; choose a verified chat in the panel. A real account's reported windows decide which quota cards appear.

## Lifecycle

The per-user login task starts a small hidden C# observer. It checks the OpenAI.Codex package identity and visible main windows, excluding ordinary ChatGPT and CLI processes. Multiple windows share one pet; minimization is not closure. All main windows gone for three seconds triggers authenticated shutdown. Manual exit suppresses resurrection for that application session. Disabling automatic launch or the plugin disables future launch and the task.

## Local interfaces

The MCP service exposes `companion_status`, `companion_usage`, `companion_open_settings`, `companion_control` (start/stop/pause/resume), and `companion_auto_launch` (enabled). Plugin initialization ensures observation rather than directly bypassing session suppression.

The loopback settings service provides authenticated state, usage, account-usage, usage-target, settings, threads, appearance and preferences operations. The separate panel receives a restricted IPC bridge; request credentials remain in the main process. Existing upstream HTTP interfaces remain available with their original authentication/ownership rules. Do not expose loopback capabilities or generated runtime files publicly.

### Frost desk and ambient preferences

`GET /api/desk` returns the local `focus`, `journal`, `notes` and `memories` snapshot. `POST /api/desk` accepts a single flat object with a fixed `type` and only that command’s fields. Successful commands return the complete updated snapshot. Authentication is the same as the settings service; the independent tool window cannot choose a route or supply an endpoint URL.

| `type` | Fields and limits |
| --- | --- |
| `focus.configure` | `focusMinutes`: integer 10–120; `breakMinutes`: integer 1–30. Only idle/completed. |
| `focus.start` | Optional `phase`: `focus` or `break` (default `focus`). Only idle/completed; each session starts manually. |
| `focus.pause` / `focus.resume` / `focus.stop` | No extra fields. Pause keeps remaining time; resume requires paused; stop resets to idle. |
| `focus.suspend` | Optional `reason`: `sleep` or `app-exit`. Native host lifecycle only; not exposed in tool-window IPC. |
| `story.select` | `id`: one of the six fixed story IDs. Remembers selection and marks it read. |
| `story.favorite` | Fixed story `id`, `favorite`: boolean. |
| `story.position` | Fixed story `id`, `position`: finite number 0–1. The UI debounces writes by 500 ms. |
| `note.create` / `note.update` | `text`: nonblank plain text, at most 1,000 characters; update also requires an existing UUID `id`. Optional `intent`: `none`, `remember`, `continue`. At most 100 notes, including archived notes. |
| `note.pin` / `note.archive` / `note.delete` | Existing UUID `id`; pin adds boolean `pinned`, archive adds boolean `archived`; delete has no extra fields. |

The journal contains six project-written stories with `title` and `body` for `zh-CN`, `zh-TW` and `en`, per-entry `read`/`favorite`, `selectedId` and `positionById`. Bookmarks are entered manually and never populated from conversation bodies. All text is rendered through plain text nodes. Story IDs and command fields are allowlisted; unknown commands and extra fields are rejected. The main process exposes only desk snapshot/command/close IPC plus fixed tab/close notifications, and admits the exact tool-window main frame only. Opening or closing the independent tool window does not move/resize the pet or change task binding.

Shared-memory commands keep the same restricted `/api/desk` transport:

| Type | Fields |
| --- | --- |
| `note.intent` | Existing note UUID `id`; `intent`: `none`, `remember`, `continue`. |
| `note.delete` | Existing UUID `id`; optional boolean `purgeMemories`, default `true`. |
| `memory.configure` | Both `enabled` and `reminders`, booleans. |
| `memory.select` / `memory.delete` | `date`: real local-calendar `YYYY-MM-DD`, year 1970–9999. |
| `memory.reply` | `date`, `text`: at most 1,000 characters, empty allowed to clear. |
| `memory.edit` | `date`, `language`: `zh-CN`, `zh-TW`, `en`; nonblank `text`, at most 1,000 characters. |
| `memory.exclude` | `date`, bounded source `factId` from the snapshot. |
| `memory.dismiss` | Bounded prompt `id` from the snapshot. |
| `memory.revisit` | Note UUID `id`; `choice`: `open`, `later`, `done`. No task is started. |

The `memories` view contains enabled/reminder flags, `since`, `limitReached`, `selectedDate`, at most 365 dated translated pages and a fixed daily/continuation prompt. Pages contain plain-text narration/reply and at most six facts (`bookmark`, `focus`, `round`, `reply`). Bookmark facts can distinguish `saved`, `revisited` and `resolved`; reply facts link to a `sourceDate`. Internal ledgers, deduplication hashes, original task identifiers and endpoint capabilities never enter the renderer. `recordTask()` and durable hint claims are internal service methods, not HTTP or MCP commands. Hints use an existing lease only while idle and visible, and do not reopen the pet or tools. See [Frost desk](docs/COMPANION-DESK.md) for retention and quote-removal behavior.

`GET /api/preferences` also reports `ambientEnabled` (boolean) and `ambientFrequency` (`quiet`, `normal`, `lively`); `POST /api/preferences` can update those same fixed fields. Quiet intervals are sampled at 45–90, 25–45 or 12–25 seconds respectively, measured after confirmed action completion; a whole idle clip or cooldown can extend the interval. Selection excludes unavailable assets and immediate repeats. The panel enables `reading` (Read journal), `looking-around` (Glance at light) and `stretching-wings` (Stretch wings) only when `/api/state.availableAnimations` advertises them; an entry in the UI is not a claim that a new asset has passed release validation.

Timer state is service-owned, with `idle`, `running`, `paused` and `completed` statuses. Closing the tool window keeps a running timer active. Sleep/application exit pauses it; restart restores a paused checkpoint rather than counting offline time as completed focus. A completed session never automatically starts a break or next focus session. Usage and local data details are in [Frost desk](docs/COMPANION-DESK.md).

## Data and limits

Generated local configuration, locks, process identity, port/token capabilities and logs live under `windows/data` (or an explicitly overridden data directory). They are ignored by Git. The integration does not persist or transmit conversation bodies or create model requests. See [privacy](docs/PRIVACY.md).

`desk.json` in that directory contains timer state/checkpoints, journal reading metadata, manually saved bookmarks and completion-notice bookkeeping. User-entered bookmark text is intentionally persisted; it is not extracted from chats and should be treated as private. Ambient preferences remain in the existing preferences file. Back up the whole private directory only after stopping the application; neither Git nor the public source package is a backup of this data.

Internal Codex log formats and native interfaces can change. Current Windows x64 desktop integration is verified locally; other devices, cloud tasks, precise approval waits and full task-error inference are outside the supported contract. Real Plus/Max account-switch validation remains pending; simulated boundary tests cover Plus/Pro/Max, late replies and auth changes, while the current Pro account has been checked live.
