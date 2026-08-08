# theme-lab

**Turn any image into a full Hermes desktop theme.** A desktop plugin for the
[Hermes Desktop](https://hermes-agent.nousresearch.com/docs/user-guide/desktop)
that demonstrates the **`THEMES_AREA`** surface end to end: drop an image, get a
color-matched light + dark theme with a complete 16-color terminal palette,
installed live into the app.

> Plugin id: `theme-lab` (folder name == id). This example is the standalone
> distribution of the same plugin; full history lives in the
> [`theme-lab`](https://github.com/0-CYBERDYNE-SYSTEMS-0/theme-lab) repo.

## What it demonstrates

- **`THEMES_AREA`** — register a `DesktopTheme` (light + dark palettes, ANSI
  terminal palette) so it appears instantly in Settings → Appearance, ⌘K, and
  `/skin`.
- **`PANES_AREA`** + **`PALETTE_AREA`** — the forge pane and a ⌘K command.
- **`ctx.storage`** — persist themes across restarts, with a v1 → v2 schema
  migration.
- **Live apply without Settings** — the app has no SDK API to programmatically
  set the active skin, but the gateway `config.set display.skin=<name>` RPC
  broadcasts `skin.changed`, which the desktop drains into a live repaint. This
  example writes the forged theme as a backend skin (`~/.hermes/skins/<slug>.yaml`)
  so `config.set` can resolve it, then applies it live — no Settings visit.
- **Boot persistence** — the desktop hydrates the saved skin before plugin/backend
  themes exist (so it snaps to default); this example re-applies the saved
  appearance via `config.set` once the gateway is ready.

## Install

Requires the **Hermes desktop app** (`hermes desktop`).

```bash
cp -r theme-lab ~/.hermes/desktop-plugins/
```

The app watches `desktop-plugins/` and hot-loads within seconds. If it doesn't
appear: ⌘K → **Reload desktop plugins**. Then open the **Theme Lab** pane and
drop an image on it.

To uninstall: delete `~/.hermes/desktop-plugins/theme-lab/`.

## Usage

1. Open the **Theme Lab** pane (drag it wherever you like).
2. Drop / paste / browse for an image.
3. Pick **dark** or **light** forge mode, reorder swatches if you want a color to
   dominate, then hit **Apply** — it applies live, no Settings visit.

## Notes for plugin authors

Desktop plugins are single ESM files importing only `@hermes/plugin-sdk`, `react`,
and `react/jsx-runtime` — UI is `jsx()` calls, not JSX syntax. The official docs:
[Desktop Plugin SDK](https://hermes-agent.nousresearch.com/docs/developer-guide/desktop-plugin-sdk).

This is the **first `THEMES_AREA` example** in this repo — the other examples here
are Python gateway/dashboard plugins that install to `~/.hermes/plugins/`. A
desktop plugin lives in `~/.hermes/desktop-plugins/` (a different SDK surface).

## Development

The color math is validated by a standalone Node harness (no build, zero deps):

```bash
node theme-lab/forge-math-test.cjs   # palette math, verbatim swatch→theme, ANSI, migration
```

`RESIZE-NOTES.md` documents the frozen-CSS layout constraints of the packaged app.

## License

MIT — see [LICENSE](LICENSE).