# bot-sessions — a per-bot conversation browser for Hermes Desktop

A **desktop plugin** (`@hermes/plugin-sdk`) that answers "what has each of my
bots been doing?" in one live view: every conversation from every registered
connection, newest activity first, with the filter automatically following
whichever bot you are chatting with.

Born from [hermes-agent#89347](https://github.com/NousResearch/hermes-agent/issues/89347)
(per-bot session visibility on the desktop) — implemented entirely with the
public plugin SDK, no core patches.

## What it does

- **Unified history** — sessions from every profile/connection returned by
  `host.profileRoutes()`, merged and sorted by last activity, plus each bot's
  cron routines in a collapsible section.
- **Follow the active bot** — a toggle pill tracks
  `host.state.focusedSessionProfile`: click a bot in the roster and the list
  filters to it (picking another bot manually pauses following).
- **Live updates** — refreshes on the gateway's `sessions.changed` /
  `cron.changed` events (with a slow polling fallback); conversations that
  just changed rise to the top and brand-new ones get an accent border until
  opened.
- **Category chips** — one-click hide/show for Bot Mode plumbing sessions
  ("Bot Chat" / "Agent Inbox"), group-chat rooms ("Group: …"), and every
  `source` (telegram, cli, desktop, …).
- Click any row to open the real conversation via `host.openSession`
  (soft-swapping to the owning profile).

## SDK surfaces demonstrated

| Surface | Where |
|---|---|
| `ROUTES_AREA` + `SIDEBAR_NAV_AREA` + `PALETTE_AREA` | `register()` |
| `host.profileRoutes()` / `host.requestProfile()` (registry-routed RPC) | `loadAll()` / `readRoute()` |
| `session.list` / `cron.manage` RPC, profile-scoped | `readRoute()` |
| `host.onEvent` gateway event stream | the auto-refresh effect |
| `host.state.focusedSessionProfile` + `useValue` | the follow toggle |
| `ctx.storage` plugin-scoped persistence | follow/filter/fold state |
| Theme variables (`var(--ui-*)`) throughout | all styles |

## Install

```bash
cp -r bot-sessions ~/.hermes/desktop-plugins/
```

The desktop app hot-loads it within seconds (⌘K → **Reload desktop plugins**
if needed). Requires a desktop build with `host.requestProfile`; degrades
gracefully on older gateways (cron falls back to `[bot:<name>]` tag
filtering, `session.list` to the launch profile).

## Notes for readers

- `session.list` responses carry only `started_at`, but arrive ordered by
  last activity. The plugin derives a lower bound for each row's real
  activity from that ordering, then tightens it with local change-detection
  stamps (message-count/title signatures persisted in `ctx.storage`) so
  updated conversations bubble up with an honest timestamp.
- Cron ownership follows the bundled Bots plugin convention:
  `profile`-scoped `cron.manage` where available, `[bot:<name>]` name tags
  as the compatibility fallback.
