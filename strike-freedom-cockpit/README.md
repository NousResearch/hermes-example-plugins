# Strike Freedom Cockpit — dashboard skin demo

Demonstrates how the dashboard skin+plugin system can be used to build a
fully custom cockpit-style reskin without touching the core dashboard.

Two pieces:

- `theme/strike-freedom.yaml` — a dashboard theme YAML that paints the
  palette, typography, layout variant (`cockpit`), component chrome
  (notched card corners, scanlines, accent colors), and declares asset
  slots (`hero`, `crest`, `bg`).
- `dashboard/` — a plugin that populates the `sidebar`, `header-left`,
  and `footer-right` slots reserved by the cockpit layout. The sidebar
  renders an MS-STATUS panel with segmented telemetry bars driven by
  real agent status; the header-left injects a COMPASS crest; the
  footer-right replaces the default org tagline.

## Install

```bash
git clone https://github.com/NousResearch/hermes-example-plugins.git

# 1. Theme — copy the theme YAML into your Hermes home:
cp hermes-example-plugins/strike-freedom-cockpit/theme/strike-freedom.yaml \
   ~/.hermes/dashboard-themes/

# 2. Plugin — copy the whole plugin directory into ~/.hermes/plugins/:
cp -r hermes-example-plugins/strike-freedom-cockpit ~/.hermes/plugins/

# 3. Restart the web UI (or GET /api/dashboard/plugins/rescan), then
#    pick "Strike Freedom" from the theme switcher.
```

## Customising the artwork

The sidebar plugin reads `--theme-asset-hero` and `--theme-asset-crest`
from the active theme. Drop your own URLs into the theme YAML:

```yaml
assets:
  hero: "/my-images/strike-freedom.png"
  crest: "/my-images/compass-crest.svg"
  bg: "/my-images/cosmic-era-bg.jpg"
```

The plugin reads those at render time — no plugin code changes needed
to swap artwork across themes.

## What this demo proves

The dashboard skin+plugin system supports (ref: `web/src/themes/types.ts`,
`web/src/plugins/slots.ts`):

- Palette, typography, font URLs, density, radius — already present
- **Asset URLs exposed as CSS vars** (bg / hero / crest / logo /
  sidebar / header + arbitrary `custom.*`)
- **Raw `customCSS` blocks** injected as scoped `<style>` tags
- **Per-component style overrides** (card / header / sidebar / backdrop /
  tab / progress / footer / badge / page) via CSS vars
- **`layoutVariant`** — `standard`, `cockpit`, or `tiled`
- **Plugin slots** — 10 named shell slots plugins can inject into
  (`backdrop`, `header-left/right/banner`, `sidebar`, `pre-main`,
  `post-main`, `footer-left/right`, `overlay`)
- **Route overrides** — plugins can replace a built-in page entirely
  (`tab.override: "/"`) instead of just adding a tab
- **Hidden plugins** — slot-only plugins that never show in the nav
  (`tab.hidden: true`) — as used here
