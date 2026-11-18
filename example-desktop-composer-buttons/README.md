# example-desktop-composer-buttons

Reference example for the **Hermes Desktop composer** surface. A row of
one-click prompt buttons sits above the chat input; clicking one sends its
prompt as if the user had typed it and pressed Enter.

Read it alongside the [Desktop Plugin SDK](https://hermes-agent.nousresearch.com/docs/developer-guide/desktop-plugin-sdk),
sections *Composer extensions*, *Composer draft API* and *Files — `ctx.files`*.

## What it demonstrates

| Piece | What to look at |
|---|---|
| The contribution | `ctx.register({ area: COMPOSER_AREAS.top, order, render })` — one composer slot, no other surface. |
| Sending a prompt | `host.composer.submit(null, prompt)` — the supported door into the input. It is fail-closed (returns `false` when no chat is focused), so the example tells the user instead of failing silently. |
| User-editable config | A JSON file in the plugin's own `ctx.files` `'data'` folder, seeded on first load and re-read every 5 s with `ctx.setInterval`. |
| Shared state | A nanostores `atom` + `useValue` from the SDK, so the row re-renders only when the list changes. |
| No build step | The whole plugin is this one file. |

## Three things that will bite you

1. **A disk plugin is loaded uncompiled**, so JSX syntax does not parse. Build UI
   with `jsx()` from `react/jsx-runtime`, and import nothing but
   `@hermes/plugin-sdk`, `react`, and `react/jsx-runtime`.
2. **Don't reach into the composer's markup.** Typing into the ProseMirror DOM
   or querying `[data-composer-target]` breaks on the next app update; use
   `host.composer`.
3. **Timers belong to the plugin context.** A bare `setInterval` survives
   disable and every hot reload; `ctx.setInterval` is cleared with the plugin.

## Install

```bash
git clone https://github.com/NousResearch/hermes-example-plugins.git
mkdir -p "<HERMES_HOME>/desktop-plugins"
cp -R hermes-example-plugins/example-desktop-composer-buttons \
  "<HERMES_HOME>/desktop-plugins/example-desktop-composer-buttons"
```

`<HERMES_HOME>` is `~/.hermes` by default (`%LOCALAPPDATA%\hermes` on Windows).
The folder name must match the plugin `id`. If the row does not appear, run
**⌘K → Reload desktop plugins**; enable or disable it in
**Capabilities → Plugins**.

## Editing the buttons

On first load the plugin writes `buttons.json` to its data folder with three
defaults — **Status**, **What's blocked?** and **What's due today?**:

```json
[
  { "label": "Status", "prompt": "Give me a short status update on what we are working on." }
]
```

Edit and save it; the row updates within about 5 seconds. Up to 12 buttons,
labels are cut to 40 characters, malformed entries are skipped, and an invalid
file leaves the current row in place. Delete the file to get the defaults back.

Note: a click sends straight away, through the same path as pressing Enter.
