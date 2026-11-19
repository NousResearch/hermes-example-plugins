# profile-chip

Reference example for the **Hermes Desktop status-bar** surface, focused on one
question core leaves unanswered: *which profile will this brand-new draft run
on?* Press Ctrl+N and the chat pane shows no profile anywhere — the title-bar
profile tag only mounts after the first message creates the stored session.
This chip names the owner up front, in the status bar, with the app's own
profile mark.

Read it alongside the [Desktop Plugin SDK](https://hermes-agent.nousresearch.com/docs/developer-guide/desktop-plugin-sdk),
the human reference for every surface this plugin touches.

## What it demonstrates

| Piece | What to look at |
|---|---|
| The contribution | `ctx.register({ area: 'statusBar.left', order, render })` — one status-bar slot, no other surface. |
| Draft-aware owner | `host.state.focusedSessionOwner` follows the chat in focus and **falls back to the active gateway owner while no session exists** — exactly the blank-draft case core's profile tag hides. |
| Multi-gateway disambiguation | `host.connections()` resolves the owner's connection id to its display label for the tooltip (`Profile: default · Gateway: This device`), so two gateways' `default` profiles never read alike. |
| The app's identity vocabulary | Core `ProfileGlyph` replica: `default` is the `home` codicon (core intentionally leaves it uncolored); named profiles get a 16px soft-tinted initial tile in the deterministic identity hue (`profileColor`, inlined as a fallback for older shells). |
| Core chrome | The button copies `STATUSBAR_ACTION_CLASS` — 11px, `--ui-text-tertiary`, standard hover — so the chip reads as a native status-bar item, not a plugin sticker. |
| Defensive degradation | `useAtomSafe` subscribes only to atoms that exist; missing `host.connections` / `profileColor` on older builds degrade to the plain active-profile readout instead of throwing. |
| No build step | The whole plugin is this one file. |

## Three things that will bite you

1. **A disk plugin is loaded uncompiled**, so JSX syntax does not parse. Build UI
   with `jsx()` / `jsxs()` from `react/jsx-runtime`, and import nothing but
   `@hermes/plugin-sdk`, `react`, and `react/jsx-runtime`.
2. **`default` has no identity color — on purpose.** Core's `profileColor()`
   returns `null` for `default`/empty so the root profile reads neutral
   everywhere. Rendering a colored swatch for it invents a hue the rest of the
   app doesn't use; render the neutral `home` mark instead.
3. **Plugin status-bar items append after the core items of their cluster.**
   There is no public reorder API; don't reach into the core DOM to move the
   chip (catalog rule 8). Pick the cluster (`statusBar.left` / `statusBar.right`)
   and an `order` within your own contributions.

## Install

Desktop plugins live in a different root than agent plugins — copy the folder
itself, not the file:

```bash
git clone https://github.com/NousResearch/hermes-example-plugins.git
mkdir -p "<HERMES_HOME>/desktop-plugins"
cp -R hermes-example-plugins/profile-chip \
  "<HERMES_HOME>/desktop-plugins/profile-chip"
```

`<HERMES_HOME>` is `~/.hermes` by default (`%LOCALAPPDATA%\hermes` on Windows).
Desktop plugins are app-level: one `desktop-plugins/` root serves every profile
and connection. The app watches that folder and hot-reloads on every save; if
the chip does not appear, run **Ctrl+K → Reload desktop plugins**. Enable or
disable it in **Capabilities → Plugins**.

The folder name must match the plugin `id` (`profile-chip`), which is why the
copy keeps the folder rather than renaming it.

## What the chip shows

- The profile mark + name of the chat in focus — including a fresh draft that
  has no session yet.
- `default`: neutral home icon. Named profiles: identity-colored initial tile,
  the same hue as the profile rail and Bot Mode avatars.
- On hover: `Profile: <name> · Gateway: <connection label>`. Click re-reads the
  connection registry (handy right after renaming a gateway).
