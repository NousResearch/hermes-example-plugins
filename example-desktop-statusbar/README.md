# example-desktop-statusbar

Reference example for the **Hermes Desktop status-bar** surface. A chip in the
bottom-right status bar paints a state — here, whether DeepSeek is billing peak
or off-peak rates — with an icon and a countdown, and explains itself on hover.

Read it alongside the [Desktop Plugin SDK](https://hermes-agent.nousresearch.com/docs/developer-guide/desktop-plugin-sdk),
the human reference for every surface this plugin touches.

## What it demonstrates

| Piece | What to look at |
|---|---|
| The contribution | `ctx.register({ area: STATUSBAR_AREAS.right, order, render })` — one status-bar slot, no other surface. |
| A stateful chip | A plain React component (`useEffect` + `setInterval`) mounted by the render function; the app owns the slot, the plugin owns the chrome. |
| The app's tooltip | `Tip` from the SDK, with the two-line label a status chip wants. |
| Theming | `var(--ui-accent)` / `var(--ui-text-quaternary)` — the chip follows every theme instead of hardcoding blue and grey. |
| No build step | The whole plugin is this one file. |

## Three things that will bite you

1. **A disk plugin is loaded uncompiled**, so JSX syntax does not parse. Build UI
   with `jsx()` / `jsxs()` from `react/jsx-runtime`, and import nothing but
   `@hermes/plugin-sdk`, `react`, and `react/jsx-runtime`.
2. **The app's tooltip paints its background on inline flow only.** Break lines
   with `<br/>`. A block child collapses the tooltip into an empty chip.
3. **Never hardcode colours.** Use the theme variables above — the value the
   plugin reads is whatever the user's active theme resolves.

## Install

Desktop plugins live in a different root than agent plugins — copy the folder
itself, not the file:

```bash
git clone https://github.com/NousResearch/hermes-example-plugins.git
mkdir -p "<HERMES_HOME>/desktop-plugins"
cp -R hermes-example-plugins/example-desktop-statusbar \
  "<HERMES_HOME>/desktop-plugins/example-desktop-statusbar"
```

`<HERMES_HOME>` is `~/.hermes` by default, or the profile directory
`~/.hermes/profiles/<profile>`. The app watches that folder and hot-reloads on
every save; if the chip does not appear, run **⌘K → Reload desktop plugins**.
Enable or disable it in **Settings → Plugins**.

The folder name must match the plugin `id` (`example-desktop-statusbar`), which
is why the copy keeps the folder rather than renaming it.

## What the chip shows

- A whale, blue during off-peak (half price) and grey during peak.
- The time left until the rate flips.
- On hover: which rate is running, and the exact local time it ends.

Peak windows are UTC, Monday to Friday: 01:00–04:00 and 06:00–10:00. Everything
else is off-peak. The real thing, with a 24-hour timezone table and an agent-side
tool, lives at [aimagist/hermes-desktop-deepseek-offpeak-status](https://github.com/aimagist/hermes-desktop-deepseek-offpeak-status).
