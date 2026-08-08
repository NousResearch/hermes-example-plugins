# Theme Forge — resize behavior notes

How the pane adapts when resized, and the intentional constraints.

## The hard constraint: frozen build CSS

The desktop app ships a Tailwind stylesheet compiled ONLY from the app's own
source tree at build time. Plugins load at runtime from `~/.hermes`, so any
class used ONLY by a plugin generates NO CSS rules. Before touching layout
here, verify every class against the shipped stylesheet:

    app.asar.unpacked/dist/assets/index-*.css   (inside the release build)

Rules this pane follows:
- No `sm:` / breakpoint variants (the build contains zero `@media (min-width)`).
- No arbitrary values used only here (`shadow-[…]`, `w-[min(…)]`, `accent-(…)`,
  `scale-*`, `flex-nowrap`…). Those live as inline `style` instead.
- Anything size-critical (the color wheel) is sized inline in px.

## What resizes fluidly

- Pane zone: `width: 280px` default, `minWidth: 220px`, `maxWidth: 520px`
  (CSS STRINGS — the PaneSizing contract rejects bare numbers).
- Card header row: `flex-wrap`, so at narrow widths the icon-button cluster
  wraps to a second line instead of clipping the name.
- Theme name: `min-w-0 truncate` — long names ellipsize, never push buttons out.
- Swatch tray + strip-view swatches: `overflow-x-auto` horizontal scroll with a
  fade hint; wheel-scroll is translated to horizontal scroll.
- Theme list: `ScrollArea` with `min-h-0 flex-1` — vertical scroll, never clips.
- Terminal preview: `overflow-x-auto` — long mono lines scroll instead of
  hard-clipping.
- Drop zone / header / segmented controls: `min-w-0`, wrap when needed.

## Intentional non-fluid cases (graceful degradation)

1. **Color wheel = fixed 128px square.** A fluid wheel needs ResizeObserver
   plumbing for pointer math (radius from live rect); not worth the complexity
   for a 220–520px pane. Instead the wheel+controls container is `flex-wrap`:
   below ~260px content width the controls column wraps UNDER the wheel.
2. **Swatch slots = fixed 36px.** They scroll horizontally; never shrink.
   Shrinking below ~28px makes them untappable.
3. **Segmented controls** keep their natural width; at extreme narrow widths
   the header row wraps rather than compressing the controls.

## Pointer interaction note

The color wheel's hue/sat picking uses `setPointerCapture` on the wheel div —
handlers (`onPointerDown/Move/Up/Cancel`) MUST stay attached to that same div.
A refactor that lifts them off silently kills the drag (this happened once;
regression-fixed in commit 5404738).
