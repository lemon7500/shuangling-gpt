# Changelog

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
