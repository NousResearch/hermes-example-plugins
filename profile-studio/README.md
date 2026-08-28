# Profile Studio — desktop plugin example

A Hermes Desktop plugin that gives every profile a persona card: roster grid, identity sheet, Persona-to-SOUL generator, and model picker.

**This is a Desktop Plugin SDK example** — it runs in the Electron desktop app, not in the Python gateway. Install differs from the Python plugin examples in this repo.

## Surface demonstrated

| Surface | Area | Demonstrates |
|---|---|---|
| Static pane | `PANES_AREA` | A `placement: 'main'` pane with `uncloseable: false`, using `host.request('pane.focus')` for auto-open |
| Palette command | `PALETTE_AREA` | `⌘K` action with keywords and a run handler |
| Sidebar nav | `SIDEBAR_NAV_AREA` | Left sidebar row that focuses the pane on click |
| REST bridge | `window.hermesDesktop.api()` | Profile CRUD, SOUL read/write, model assignment via `/api/profiles` and `/api/model/set` |
| Session spawn | `host.request('session.create')` + `host.onEvent('message.delta')` | AI SOUL generation in a throwaway session |

## Install (desktop)

```bash
git clone https://github.com/0-CYBERDYNE-SYSTEMS-0/profile-studio.git
cp -r profile-studio ~/.hermes/desktop-plugins/
```

Hermes hot-reloads desktop plugins within seconds. Look for **Studio** in the left sidebar, or `⌘K → Profile Studio`.

## File structure

```
profile-studio/
└── plugin.js          # Single-file desktop plugin, plain ESM
```

Single-file, zero build step, zero deps beyond `@hermes/plugin-sdk` and `react/jsx-runtime`. ~870 LOC — see the notes in the file for namespace conventions and SDK import patterns.

## Companion docs

- [Desktop Plugin SDK](https://hermes-agent.nousresearch.com/docs/developer-guide/desktop-plugin-sdk) — the API surface this plugin uses
- Full distribution: [github.com/0-CYBERDYNE-SYSTEMS-0/profile-studio](https://github.com/0-CYBERDYNE-SYSTEMS-0/profile-studio)