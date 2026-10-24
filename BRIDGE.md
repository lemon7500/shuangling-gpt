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

## Data and limits

Generated local configuration, locks, process identity, port/token capabilities and logs live under `windows/data` (or an explicitly overridden data directory). They are ignored by Git. The integration does not persist or transmit conversation bodies or create model requests. See [privacy](docs/PRIVACY.md).

Internal Codex log formats and native interfaces can change. Current Windows x64 desktop integration is verified locally; other devices, cloud tasks, precise approval waits and full task-error inference are outside the supported contract. Real Plus/Max account-switch validation remains pending; simulated boundary tests cover Plus/Pro/Max, late replies and auth changes, while the current Pro account has been checked live.
