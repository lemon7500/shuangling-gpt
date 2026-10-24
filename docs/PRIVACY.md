# Privacy / 隐私 / 隱私

The pet runs locally on Windows. It reads allowlisted task events and numeric token samples from local Codex root-chat logs, chat/project naming metadata for explicit selection, and read-only native current-account quota. The file parser can encounter log records containing conversation fields; those bodies are not retained in state, saved by this integration, or transmitted.

The window observer checks process/package identity and main-window presence only. Authentication detection reads file version metadata, not credential contents; authentication and network quota retrieval remain inside the native Codex client. Only sanitized plan/window/time/percentage fields reach the panel. This integration does not start model tasks and needs no separate API key.

Project-local `windows/data` contains settings, session tracking, cached local endpoint capabilities and runtime logs. Treat it as private. Git also ignores the generated MCP path manifest, runtime binaries, dependency caches and installation reports. Sharing a diagnostic file still requires checking its content first.

The setup script connects to official Node.js/Electron distribution locations and npm for downloads. Native quota reads may connect through Codex's existing account service. This project does not add an analytics or conversation-upload service.
