// Validate Theme Forge's theme math in isolation (same functions as plugin.js).
// Feeds it synthetic pixels matching /tmp/forge-test.png's color blocks and
// asserts the generated DesktopTheme is structurally valid.

const fs = require('fs')
const src = fs.readFileSync(process.env.HOME + '/.hermes/desktop-plugins/theme-forge/plugin.js', 'utf8')

// Pull out everything between the color-math header and the UI section,
// minus the canvas-dependent extractPalette (tested separately with fake boxes).
const start = src.indexOf('// ── color math')
const end = src.indexOf('// ── forge pipeline')
let core = src.slice(start, end)

// eval in this scope — wrap so const bindings come back out
const api = new Function(core + '; return {rgbToHex, hexToRgb, rgbToHsl, hslToRgb, hexToHsl, hslToHex, buildColorsFromPalette, ansiPalette, synthesize, deriveSwatches, contrast, luminance, mix, readableOn, ensureContrast, stripForgePrefix}')()
const { rgbToHex, hexToRgb, rgbToHsl, hslToRgb, hexToHsl, hslToHex, buildColorsFromPalette, ansiPalette, synthesize, deriveSwatches, contrast, luminance, mix, readableOn, ensureContrast, stripForgePrefix } = api

// Simulate palette output of extractPalette for our test image blocks
const mk = (r, g, b, w) => ({ hex: rgbToHex(r, g, b), hsl: rgbToHsl(r, g, b), weight: w })
const palette = [
  mk(13, 47, 134, 2000), mk(255, 120, 50, 1800), mk(255, 224, 196, 1500),
  mk(120, 30, 80, 1400), mk(46, 160, 120, 1300), mk(240, 200, 60, 1200),
  mk(110, 60, 110, 600)  // gradient average
]

const REQUIRED = ['background', 'foreground', 'primary']
let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`)
  if (!ok) failures++
}

for (const wantDark of [true, false]) {
  const c = buildColorsFromPalette(palette, wantDark)
  const label = wantDark ? 'dark' : 'light'
  check(`[${label}] required keys`, REQUIRED.every(k => typeof c[k] === 'string' && /^#[0-9a-f]{6}$/i.test(c[k])))
  check(`[${label}] all 23 tokens are hex`, Object.entries(c).every(([k, v]) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v), Object.keys(c).length + ' tokens'))
  // VERBATIM contract (post-blending-fix): slot 1 IS the background, exact.
  check(`[${label}] bg equals slot-1 swatch VERBATIM`, c.background.toLowerCase() === palette[0].hex.toLowerCase(), `${c.background} vs ${palette[0].hex}`)
  check(`[${label}] fg equals slot-2 swatch VERBATIM`, c.foreground.toLowerCase() === palette[1].hex.toLowerCase(), `${c.foreground} vs ${palette[1].hex}`)
  check(`[${label}] primary equals first chromatic swatch VERBATIM`, c.primary.toLowerCase() === palette[1].hex.toLowerCase(), `${c.primary} vs ${palette[1].hex}`)
  check(`[${label}] mutedFg contrast >= 4.5`, contrast(c.mutedForeground, c.background) >= 4.5, contrast(c.mutedForeground, c.background).toFixed(2))

  const t = ansiPalette(palette, c.background, palette[1].hex)
  const ansiKeys = ['black','red','green','yellow','blue','magenta','cyan','white','brightBlack','brightRed','brightGreen','brightYellow','brightBlue','brightMagenta','brightCyan','brightWhite']
  check(`[${label}] terminal: 16 ANSI slots`, ansiKeys.every(k => /^#[0-9a-f]{6}$/i.test(t[k])))
  check(`[${label}] terminal fg/cursor set`, typeof t.foreground === 'string' && typeof t.cursor === 'string')
  check(`[${label}] terminal fg equals slot-2 swatch VERBATIM`, t.foreground.toLowerCase() === palette[1].hex.toLowerCase(), `${t.foreground} vs ${palette[1].hex}`)
  // black (dark bg) and white (light bg) are intentionally near-background —
  // standard terminal behavior — so exclude them from the visibility floor.
  // Luminance-based, NOT mode-based: verbatim backgrounds can be dark even in
  // the light variant, and the near-bg ANSI slot should follow the ACTUAL bg.
  const bgLum = luminance(c.background)
  const visKeys = ansiKeys.filter(k => !(bgLum < 0.5 && k === 'black') && !(bgLum >= 0.5 && k === 'white'))
  check(`[${label}] ANSI colors visible on term bg`, visKeys.every(k => contrast(t[k], c.background) >= 1.4), 'min ' + Math.min(...visKeys.map(k => contrast(t[k], c.background))).toFixed(2))
}

// Full theme shape check via synthesize (what THEMES_AREA receives)
const meta = { name: 'forge-test', label: 'Forge · test', mode: 'dark' }
const theme = synthesize(palette, meta)
check('theme: isValidTheme bar (name/label/colors + required)', !!theme.name && !!theme.label && REQUIRED.every(k => typeof theme.colors[k] === 'string'))
check('theme: label carries through', theme.label === 'Forge · test')
// Reorder check: moving a saturated color to front shouldn't crash synthesis
const reordered = [palette[1], ...palette.slice(0, 1), ...palette.slice(2)]
const t2 = synthesize(reordered, meta)
check('theme: reorder-safe synthesis', REQUIRED.every(k => typeof t2.colors[k] === 'string') && typeof t2.terminal.red === 'string')

// deriveSwatches: v1-era themes (no stored palette) must recover a usable tray
const derived = deriveSwatches(theme)
check('deriveSwatches: 4-8 swatches from tokens', derived.length >= 4 && derived.length <= 8, derived.length + ' swatches')
check('deriveSwatches: valid hex + hsl', derived.every(s => /^#[0-9a-f]{6}$/i.test(s.hex) && typeof s.hsl.h === 'number'))
const t3 = synthesize(derived, meta)
check('deriveSwatches: resynthesis round-trip', REQUIRED.every(k => typeof t3.colors[k] === 'string') && typeof t3.terminal.green === 'string')

// ── Wheel HSL↔HEX round-trip ────────────────────────────────────────────
const wheelColors = [mk(13, 47, 134, 5000), mk(255, 120, 50, 4000), mk(46, 160, 120, 3000), mk(240, 235, 220, 2000)]
const wheelOk = wheelColors.every(c => {
  const back = hslToHex(c.hsl.h, c.hsl.s, c.hsl.l)
  const hsl = hexToHsl(back)
  return typeof back === 'string' && /^#[0-9a-f]{6}$/i.test(back) && hsl && Math.abs(hsl.h - c.hsl.h) < 0.005 && Math.abs(hsl.s - c.hsl.s) < 0.005 && Math.abs(hsl.l - c.hsl.l) < 0.005
})
check('wheel: hsl↔hex round-trip', wheelOk, `${wheelColors.length} sample swatches`)

// ── Slot-1 background control
const hueDist = (a, b) => {
  const d = Math.abs(a * 360 - b * 360) % 360
  return d > 180 ? 360 - d : d
}
// Build an order where slot 1 is NOT the darkest color — old code would have
// ignored slot 1 and used the darkest anyway.
const teal = mk(46, 160, 120, 5000)   // mid-tone teal, deliberately not darkest
const deepBlue = mk(13, 47, 134, 4000)
const ordered2 = [teal, deepBlue, mk(255, 120, 50, 3000), mk(255, 224, 196, 2000), mk(120, 30, 80, 1000)]
const themeA = synthesize(ordered2, { name: 'x', label: 'x', mode: 'dark' })
const bgA = themeA.darkColors.background
const bgAHue = rgbToHsl(...hexToRgb(bgA)).h
check('slot1-ctrl: dark bg hue follows teal seed', hueDist(bgAHue, teal.hsl.h) < 35, `bg ${bgA} hueDist=${hueDist(bgAHue, teal.hsl.h).toFixed(1)}°`)
check('slot1-ctrl: teal seed lands bg VERBATIM', bgA.toLowerCase() === teal.hex.toLowerCase(), `${bgA} vs ${teal.hex}`)

// Swap: put deep blue in slot 1 — bg must follow exactly
const ordered3 = [deepBlue, teal, mk(255, 120, 50, 3000), mk(255, 224, 196, 2000), mk(120, 30, 80, 1000)]
const themeB = synthesize(ordered3, { name: 'x', label: 'x', mode: 'dark' })
const bgB = themeB.darkColors.background
const bgBHue = rgbToHsl(...hexToRgb(bgB)).h
check('slot1-ctrl: swap changes bg hue', hueDist(bgBHue, deepBlue.hsl.h) < 35 && hueDist(bgAHue, bgBHue) > 20, `bgA=${bgA} bgB=${bgB} Δ=${hueDist(bgAHue, bgBHue).toFixed(1)}°`)

// Light mode: slot-1 seed is the background verbatim regardless of lightness
const themeC = synthesize([deepBlue, teal, mk(255, 224, 196, 2000)], { name: 'x', label: 'x', mode: 'light' })
const bgC = themeC.colors.background
check('slot1-ctrl: light bg keeps seed VERBATIM', bgC.toLowerCase() === deepBlue.hex.toLowerCase(), `${bgC} vs ${deepBlue.hex}`)
check('slot1-ctrl: light bg keeps seed hue', hueDist(rgbToHsl(...hexToRgb(bgC)).h, deepBlue.hsl.h) < 40, `bg ${bgC}`)

// Very bright seed in dark mode: still lands verbatim (no blending to dark)
const themeD = synthesize([mk(255, 224, 196, 5000), teal, deepBlue], { name: 'x', label: 'x', mode: 'dark' })
const bgD = themeD.darkColors.background
check('slot1-ctrl: bright seed lands bg VERBATIM', bgD.toLowerCase() === mk(255, 224, 196, 5000).hex.toLowerCase(), `${bgD} vs seed`)

// ── Slot-2 foreground control (regression: was always luminance-extreme derived) ──
// Use distinct swatches so hue swaps are observable. Background is a realistic
// dark (deepBlue) so the contrast floor is a no-op and the verbatim carry-through
// is visible. (A dedicated floor test below checks the disaster case.)
const softPink = mk(230, 150, 160, 1200)
const skyBlue = mk(120, 180, 255, 1100)
const slot2Base = [deepBlue, softPink, skyBlue, mk(255, 120, 50, 3000), mk(120, 30, 80, 2000)]
const themeFG1 = synthesize(slot2Base, { name: 'x', label: 'x', mode: 'dark' })
const themeFG2 = synthesize([...slot2Base.slice(0, 1), skyBlue, softPink, ...slot2Base.slice(3)], { name: 'x', label: 'x', mode: 'dark' })
check('slot2-ctrl: swapping slot 2 changes dark fg hue', hueDist(rgbToHsl(...hexToRgb(themeFG1.darkColors.foreground)).h, rgbToHsl(...hexToRgb(themeFG2.darkColors.foreground)).h) > 15, `fg1=${themeFG1.darkColors.foreground} fg2=${themeFG2.darkColors.foreground}`)
check('slot2-ctrl: light swap changes light fg hue', hueDist(rgbToHsl(...hexToRgb(themeFG1.colors.foreground)).h, rgbToHsl(...hexToRgb(themeFG2.colors.foreground)).h) > 15, `fg1=${themeFG1.colors.foreground} fg2=${themeFG2.colors.foreground}`)
check('slot2-ctrl: dark fg equals slot-2 swatch VERBATIM', themeFG1.darkColors.foreground.toLowerCase() === softPink.hex.toLowerCase(), `${themeFG1.darkColors.foreground} vs ${softPink.hex}`)
check('slot2-ctrl: light fg equals slot-2 swatch VERBATIM', themeFG1.colors.foreground.toLowerCase() === softPink.hex.toLowerCase(), `${themeFG1.colors.foreground} vs ${softPink.hex}`)

// Foreground must visibly CARRY the seed color now (no near-white collapse).
// Both slot-2 seeds are chromatic → resulting fg must keep full chroma.
const fg1Sat = rgbToHsl(...hexToRgb(themeFG1.darkColors.foreground)).s
const fg2Sat = rgbToHsl(...hexToRgb(themeFG2.darkColors.foreground)).s
check('slot2-ctrl: fg keeps seed chroma (sat > 0.08)', fg1Sat > 0.08 && fg2Sat > 0.08, `sat1=${fg1Sat.toFixed(3)} sat2=${fg2Sat.toFixed(3)}`)

// ── Terminal fg follows slot 2 (regression: was hardcoded readableOn(bg)) ──
const termFG1 = themeFG1.darkTerminal.foreground
const termFG2 = themeFG2.darkTerminal.foreground
check('term-fg: not hardcoded white/black', termFG1.toLowerCase() !== '#ffffff' && termFG1.toLowerCase() !== '#000000', termFG1)
check('term-fg: follows slot-2 seed hue', hueDist(rgbToHsl(...hexToRgb(termFG1)).h, softPink.hsl.h) < 40, `termFG=${termFG1} seedHue=${Math.round(softPink.hsl.h * 360)}°`)
check('term-fg: swapping slot 2 changes terminal fg', termFG1 !== termFG2 && hueDist(rgbToHsl(...hexToRgb(termFG1)).h, rgbToHsl(...hexToRgb(termFG2)).h) > 15, `fg1=${termFG1} fg2=${termFG2}`)
check('term-fg: terminal fg equals slot-2 swatch VERBATIM', termFG1.toLowerCase() === softPink.hex.toLowerCase(), `${termFG1} vs ${softPink.hex}`)
// Single swatch → no slot 2 → best-effort readable fallback, still a valid hex
const themeSingle = synthesize([softPink], { name: 'x', label: 'x', mode: 'dark' })
check('term-fg: no slot 2 falls back to readable', /^#[0-9a-f]{6}$/i.test(themeSingle.darkTerminal.foreground) && themeSingle.darkTerminal.foreground.toLowerCase() !== themeSingle.darkColors.background.toLowerCase(), themeSingle.darkTerminal.foreground)

// Light seed in dark-mode slot 2: verbatim carry-through, no collapse to white.
const lightSeedFG = mk(240, 235, 220, 4000)
const themeLightSeed = synthesize([deepBlue, lightSeedFG, skyBlue], { name: 'x', label: 'x', mode: 'dark' })
const lightSeedFGResult = themeLightSeed.darkColors.foreground
check('slot2-ctrl: light seed fg does not collapse to white', lightSeedFGResult.toLowerCase() !== '#ffffff', lightSeedFGResult)
check('slot2-ctrl: light seed fg VERBATIM', lightSeedFGResult.toLowerCase() === lightSeedFG.hex.toLowerCase(), `${lightSeedFGResult} vs ${lightSeedFG.hex}`)

// Single-swatch fallback derives a usable fg (different from bg).
check('slot2-ctrl: single swatch still derives fg', typeof themeSingle.darkColors.foreground === 'string' && themeSingle.darkColors.foreground.toLowerCase() !== themeSingle.darkColors.background.toLowerCase(), themeSingle.darkColors.foreground)

// ── Contrast floor (tripwire) ───────────────────────────────────────────────
// The disaster the floor exists for: near-black bg + near-black text must be
// nudged to a readable ratio, while a deliberately readable pair stays verbatim.
const FLOOR = 3
const nearBlackBg = mk(8, 8, 10, 5000)      // ~#08080a
const nearBlackFg = mk(12, 12, 14, 2000)    // ~#0c0c0e  (contrast ~1.1:1 on bg)
const floorTheme = synthesize([nearBlackBg, nearBlackFg], { name: 'floor', label: 'floor', mode: 'dark' })
const floorFG = floorTheme.darkColors.foreground
check('floor: near-black text is nudged readable (>= 3:1)', contrast(floorFG, floorTheme.darkColors.background) >= FLOOR, `fg=${floorFG} ratio=${contrast(floorFG, floorTheme.darkColors.background).toFixed(2)}`)
check('floor: nudged fg is NOT the original (actually changed)', floorFG.toLowerCase() !== nearBlackFg.hex.toLowerCase(), `${floorFG} vs ${nearBlackFg.hex}`)
check('floor: nudged fg is a valid hex', /^#[0-9a-f]{6}$/i.test(floorFG))
check('floor: terminal fg follows same floor', contrast(floorTheme.darkTerminal.foreground, floorTheme.darkColors.background) >= FLOOR, `term=${floorTheme.darkTerminal.foreground}`)

// Opposite polarity: near-white bg + near-white text must nudge toward dark.
const nearWhiteBg = mk(250, 250, 252, 5000)
const nearWhiteFg = mk(248, 248, 250, 2000)
const floorLight = synthesize([nearWhiteBg, nearWhiteFg], { name: 'floor', label: 'floor', mode: 'light' })
const floorLightFG = floorLight.colors.foreground
check('floor: near-white light-mode text nudged readable (>= 3:1)', contrast(floorLightFG, floorLight.colors.background) >= FLOOR, `fg=${floorLightFG} ratio=${contrast(floorLightFG, floorLight.colors.background).toFixed(2)}`)

// A genuinely readable pair passes through untouched (verbatim preserved).
// softPink on deepBlue is ~5.8:1 (> 3) so the floor is a no-op.
const readableFG = themeFG1.darkColors.foreground
check('floor: readable pair stays VERBATIM (floor is no-op)', readableFG.toLowerCase() === softPink.hex.toLowerCase(), `${readableFG} vs ${softPink.hex}`)

// Dark-mode bright seed on dark bg stays verbatim too (no over-nudge to pure white).
check('floor: light seed fg VERBATIM on dark bg', lightSeedFGResult.toLowerCase() === lightSeedFG.hex.toLowerCase(), `${lightSeedFGResult} vs ${lightSeedFG.hex}`)

// ── Plugin behavior probes ────────────────────────────────────────────────
const pluginPath = process.env.HOME + '/.hermes/desktop-plugins/theme-forge/plugin.js'
const pluginSrc = fs.readFileSync(pluginPath, 'utf8')

// viewMode persistence defaults to cards and round-trips through storage.
const viewModeMatch = pluginSrc.match(/const \$viewModeKey = '([^']+)'/)
const viewModeKey = viewModeMatch ? viewModeMatch[1] : null
check('storage: viewMode key is declared', !!viewModeKey, viewModeKey || 'missing')

const storageRoundTripOk = pluginSrc.includes(`$viewModeKey`) &&
  pluginSrc.includes(`ctx.storage.get($viewModeKey, 'cards')`) &&
  pluginSrc.includes(`storageRef?.set($viewModeKey, normalizeViewMode(v))`) &&
  pluginSrc.includes(`storageRef?.set($viewModeKey, 'cards')`)
check('storage: viewMode default + persisted round-trip wired', storageRoundTripOk)

const stripRowExists = /function StripRow\(/.test(pluginSrc)
check('ui: StripRow component exists', stripRowExists)
const stripEntrypoint = pluginSrc.includes('StripRow')
check('ui: strip mode renders StripRow', stripEntrypoint)

// ── Wheel editor: commit-only, no live synthesis race ───────────────────────
// onChange must NOT call synthesize — it fires on every wheel drag pixel and
// would overwrite the committed color with intermediate grays. Only commitWheel
// (the OK button) should synthesize + save.
// Use a brace-balanced match, not a lazy regex, to get the full onChange body.
const onChangeStart = pluginSrc.indexOf('onChange: hex => {')
let onChangeBlock = null
if (onChangeStart !== -1) {
  let depth = 0
  let i = onChangeStart + 'onChange: hex => {'.length - 1 // at the opening {
  for (; i < pluginSrc.length; i++) {
    if (pluginSrc[i] === '{') depth++
    else if (pluginSrc[i] === '}') {
      depth--
      if (depth === 0) break
    }
  }
  onChangeBlock = pluginSrc.slice(onChangeStart, i + 1)
}
check('wheel: onChange block found', !!onChangeBlock)
check('wheel: onChange does NOT synthesize', onChangeBlock && !onChangeBlock.includes('synthesize'))
check('wheel: onChange only updates swatches', onChangeBlock && onChangeBlock.includes('updateTheme(entry.name, { swatches: next })') && !onChangeBlock.includes('synthesize'))
check('wheel: commitWheel still synthesizes', pluginSrc.includes('const commitWheel = (index, hex) => {') && pluginSrc.includes('const theme = synthesize(next, entry)'))
check('wheel: commitWheel saves both swatches and theme', pluginSrc.includes('updateTheme(entry.name, { swatches: next, theme })'))

// ── bkgnd / text role captions on slot 1 + slot 2 (both view modes) ─────────
check('labels: tray captions bkgnd/text present', pluginSrc.includes("i === 0 ? 'bkgnd' : i === 1 ? 'text' : ''"))
const captionOccurrences = (pluginSrc.match(/i === 0 \? 'bkgnd' : i === 1 \? 'text'/g) || []).length
check('labels: captions wired in BOTH card tray and strip row', captionOccurrences === 2, captionOccurrences + ' occurrences')
check('labels: slot tooltips explain their role', pluginSrc.includes('background seed') && pluginSrc.includes('text seed'))

// ── Sleek naming: no auto 'Forge · ' branding ───────────────────────────
check('naming: stripForgePrefix removes auto prefix', stripForgePrefix('Forge · Sunset') === 'Sunset', stripForgePrefix('Forge · Sunset'))
check('naming: stripForgePrefix is case/separator tolerant', stripForgePrefix('forge•  Aurora') === 'Aurora', stripForgePrefix('forge•  Aurora'))
check('naming: intentional Forge names preserved', stripForgePrefix('Dark Forge') === 'Dark Forge' && stripForgePrefix('Forge Midnight') === 'Forge Midnight')
check('naming: empty-result fallback keeps original', stripForgePrefix('Forge · ') === 'Forge · ')
check('naming: forgeTheme no longer injects prefix', !pluginSrc.includes('label: `Forge ·') && !pluginSrc.includes('label: `Forge · ${label}`'))
check('naming: rename commit no longer re-adds prefix', !pluginSrc.includes('const label = `Forge · ${clean}`'))
check('naming: rename draft seeded via stripForgePrefix', pluginSrc.includes('setDraft(stripForgePrefix(entry.label))'))
check('naming: v3 migration normalizes persisted labels', pluginSrc.includes('stripForgePrefix(base.label ?? base.theme.label)'))

// ── Standard color picker parts (swatches: sliders + cells + eyedropper) ────
check('picker: H slider present', pluginSrc.includes("label: 'H'") && pluginSrc.includes("display: `${hueDeg}°`"))
check('picker: S slider present', pluginSrc.includes("label: 'S'") && pluginSrc.includes("display: `${satPct}%`"))
check('picker: L slider present', pluginSrc.includes("label: 'L'") && pluginSrc.includes("display: `${liPct}%`"))
check('picker: sliders drive live color', pluginSrc.includes('onChange: v => setH(v / 360)') && pluginSrc.includes('onChange: v => setS(v / 100)') && pluginSrc.includes('onChange: v => setL(v / 100)'))
check('picker: editable hex input wired', pluginSrc.includes('onHexInput') && pluginSrc.includes('parseHexStrict') && pluginSrc.includes('onHexBlur'))
check('picker: hex supports 3- and 6-digit', pluginSrc.includes("/^[0-9a-f]{3}$/i.test(c)") && pluginSrc.includes("/^[0-9a-f]{6}$/i.test(c)"))
check('picker: eyedropper uses EyeDropper API', pluginSrc.includes("'EyeDropper' in window") && pluginSrc.includes('new window.EyeDropper()') && pluginSrc.includes('ed.open()'))
check('picker: eyedropper guards unsupported builds', pluginSrc.includes('not supported in this build'))
check('picker: preset cells grid present', pluginSrc.includes('PRESET_CELLS') && pluginSrc.includes('pickCell'))
check('picker: cells apply color on click', pluginSrc.includes('onClick: () => pickCell(cell)'))
check('picker: Enter commits, Escape cancels', pluginSrc.includes("if (ev.key === 'Enter') onCommit(live)") && pluginSrc.includes("if (ev.key === 'Escape') onCancel()"))

// ── VERBATIM commit: the exact selected color lands in the swatch + theme ──
check('commit: OK passes the live (selected) color', pluginSrc.includes('onClick: () => onCommit(live)'))
check('commit: commitWheel writes exact hex to swatch', pluginSrc.includes('const next = swatches.map((s, i) => (i === index ? { ...s, hex, hsl: hexToHsl(hex) } : s))'))
check('commit: commitWheel synthesizes from that exact swatch', pluginSrc.includes('const theme = synthesize(next, entry)'))
check('commit: slot-1 bg is verbatim (no blend)', pluginSrc.includes('const background = seed.hex'))
check('commit: slot-2 text is verbatim (no blend)', pluginSrc.includes('foreground = ordered[1].hex'))
check('commit: terminal text is verbatim (floor only trips on unreadable)', pluginSrc.includes('foreground: fgSeed ? ensureContrast(fgSeed, bg, FORGE_TEXT_FLOOR) : readableOn(bg)'))
check('commit: accent is verbatim', pluginSrc.includes('const accentSafe = accentRaw.hex'))

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} FAILURES`)
process.exit(failures ? 1 : 0)
