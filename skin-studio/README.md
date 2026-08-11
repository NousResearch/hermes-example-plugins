# Skin Studio (皮肤工坊) — Dress up your Hermes Desktop

**A Hermes Desktop theme editor plugin: wallpaper / animated video backdrops, extended palette, text bold levels, chat font size, markdown accent colors, and animated rain backdrops (Matrix-style digit wall & traditional-Chinese-character rain).**

- ✅ No build step, no app-code changes — one ESM file + an optional Python backend
- ✅ **One-click apply** via Hermes' native skin path (`/skin`-equivalent hot path, repaints every surface in ~1s)
- ✅ **Live editing** — changes repaint the active theme immediately
- ✅ **15 preset themes**: 6 Chinese-style + 4 anime-style + 5 classics
- ✅ **Auto-color from image** (median-cut extraction + WCAG contrast guarantee) + 10 palette templates
- ✅ **Video media library**: large videos stored in IndexedDB, survive restarts, click-to-apply
- ✅ **Global FX layer**: rain effects decoupled from themes — pair the digit wall or hanzi rain with *any* color theme

> This plugin is a deep localization of the open-source [Theme Forge](https://github.com/NousResearch/hermes-example-plugins/pull/8) (MIT, by criptogus): fully Chinese UI, Chinese-style & anime-style themes, hanzi-rain FX, auto-color, video library, and the global FX layer.

## Included themes

### Chinese style

| Theme | Look | FX |
|---|---|---|
| **水墨 Ink** | Rice-paper white + ink black + cinnabar seal red | — |
| **青花瓷 Blue-and-white** | Glaze white + cobalt blue, oriental elegance | — |
| **故宫 Forbidden City** | Palace-wall red + glazed gold | — |
| **竹林 Bamboo** | Bamboo green + ink green, airy | — |
| **敦煌 Dunhuang** | Sand gold + mural ochre, Silk Road colors | — |
| **汉字雨 Hanzi Rain** | Ink-black paper + seal red | 🌧️ **Traditional-hanzi rain** (parchment-white drops + cinnabar accents) |

### Anime style

| Theme | Look | FX |
|---|---|---|
| **EVA 初号机 Unit-01** | Eva purple + phosphor green | — |
| **高达 Gundam** | RX-78 white/blue/red | — |
| **初音未来 Hatsune Miku** | Miku teal | — |
| **鬼灭之刃 Demon Slayer** | Tanjiro black-green check + nichirin red | — |

### Classics (inherited from Theme Forge)

| Theme | Look | FX |
|---|---|---|
| **赛博 Cyber** | Pure black + phosphor green + purple + gold | — |
| **玻璃 Glass** | Cool translucent neutrals + cyan | — |
| **纸感 Paper** | Warm paper light + terracotta | — |
| **数字墙 Digit Wall** | Pure black + phosphor green | 🌧️ **Matrix-style digit wall** (full-screen 0–9 grid, in-place refresh flow — no falling, no stacking, dim green so it never steals focus from text) |
| **黑客 Hacker** | Terminal green + purple + gold | 📺 CRT scanlines |
| **自定义 Custom** | Your editable theme (persists) | Everything adjustable |

## What it does that Hermes can't natively

| Feature | Why it doesn't exist natively |
|---|---|
| **Wallpaper / animated video backdrop** + overlay/blur | The `DesktopTheme` model only supports solid colors |
| **Extended palette** — `--ui-red/green/blue/purple/yellow/cyan/orange/warm` | Those colors are fixed in the app's `styles.css` |
| **Text bold levels** (3 levels) | No per-theme typography weight control |
| **Conversation font size** (12–48px for FX, 11–18px text) | Token exists but no UI |
| **Markdown accent colors** (headings, links, chat code) | Not configurable |
| **Digit wall / hanzi rain / CRT scanlines** | Impossible in the theme model |
| **One-click theme apply** | The desktop doesn't expose `setTheme` to plugins |

## Global FX layer (new in Skin Studio)

Rain effects are a **separate layer from color themes** — pick any theme and overlay any FX:

```
[跟随主题 Follow theme] [无 None] [数字墙 Digit wall] [汉字雨 Hanzi rain]
```

- `Follow theme` keeps each theme's built-in FX (classic behavior)
- `Digit wall` / `Hanzi rain` apply globally — switch color themes freely, the FX persists
- Font size & speed sliders tune the rain globally
- CRT scanlines get their own three-state switch (follow / on / off) and are **mutually exclusive with the digit wall** (a full-screen digit grid + horizontal lines reads as noise)
- FX config lives in its own storage key, themes stay clean

## Installation

### 1. Desktop plugin (required)

```bash
mkdir -p ~/.hermes/desktop-plugins
cp -R skin-studio ~/.hermes/desktop-plugins/
```

The desktop app hot-reloads the folder (or ⌘K → **Reload desktop plugins**).

### 2. Python backend (for one-click "Apply")

```bash
mkdir -p ~/.hermes/plugins/skin-studio
cp -R skin-studio/dashboard ~/.hermes/plugins/skin-studio/
```

Then make sure `skin-studio` is in `plugins.enabled` in `~/.hermes/config.yaml` (as a **YAML list**, not a stringified JSON string):

```yaml
plugins:
  enabled:
    - skin-studio
```

The backend writes `$HERMES_HOME/skins/<name>.yaml` and sets `display.skin`, so the gateway's skin watcher broadcasts `skin.changed` and every surface repaints live — no restart needed. Restart the app after installing the backend (routes mount at startup only).

Without the backend, themes still work: pick them via ⌘K → **Themes**.

## Usage

1. Open **皮肤工坊** from the sidebar (or ⌘K → "皮肤工坊")
2. **颜色** tab: hand-tune any color module (all Chinese labels), or click a palette template / auto-color from an image
3. **背景** tab: wallpaper URL / local image / local video (IndexedDB library keeps the last 5), overlay & blur
4. **文字** tab: bold levels, font size, markdown accents
5. **背景特效（全局层）**: pick the global FX layer & scanlines
6. Click **应用** to activate as the live Hermes skin (global — CLI/TUI repaint too)

## License

MIT — see [LICENSE](./LICENSE). Forked from [Theme Forge](https://github.com/NousResearch/hermes-example-plugins/pull/8) (MIT). Film/anime presets are palette homages with no official affiliation.
