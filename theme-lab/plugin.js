/**
 * Theme Forge — turn any image into a full Hermes desktop theme.
 *
 * Drop/paste/browse an image; the palette engine extracts dominant colors
 * (median-cut), maps them to DesktopTheme tokens, guarantees WCAG contrast,
 * builds light + dark variants, and registers via THEMES_AREA — themes appear
 * live in Settings → Appearance, ⌘K, and /skin.
 *
 * Pane features: dark/light forge mode, drag-to-reorder swatch priorities
 * (re-synthesizes the theme live), inline rename, terminal ANSI preview,
 * Apply (jumps to Appearance settings), reforge, delete. Sources are kept
 * downscaled so themes can reforge after restarts.
 *
 * Save as: ~/.hermes/desktop-plugins/theme-lab/plugin.js
 * Plain ESM, loaded uncompiled — jsx() calls, not JSX syntax.
 */

import {
  Button,
  Input,
  PALETTE_AREA,
  ScrollArea,
  SegmentedControl,
  THEMES_AREA,
  cn,
  haptic,
  host,
  icons,
  useValue,
  atom
} from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'
import { useEffect, useRef, useState } from 'react'

// ── reactive state (module-level, survives pane unmount) ────────────────────

const $busy = atom(false)
const $generated = atom([]) // persisted themes (full objects) — single source of truth
const $mode = atom('dark')
const $expanded = atom(null) // slug with terminal preview open
const $editing = atom(null) // slug being renamed
const $picked = atom(null) // { slug, index } — swatch awaiting a new position
const $viewMode = atom('cards') // 'cards' | 'strip' — strip = quiet swatch-only overview
const $viewModeKey = 'theme-lab-viewMode'

/** Strip mode is display-only; card mode is the editor. */
function normalizeViewMode(v) {
  return v === 'strip' ? 'strip' : 'cards'
}

const $wheelOpen = atom(null) // { slug, index } — single inline color editor

// ── active-skin detection ──────────────────────────────────────────────────
// The app paints the active theme's slug onto <html data-hermes-theme="…">
// (themes/context.tsx applyTheme). Reading it + a MutationObserver gives the
// pane a live "which theme is applied" signal so we can light the active card
// and pin it to the top of the list.
const $forgeActiveSkin = atom(null)

function forgeReadActiveSkin() {
  if (typeof window === 'undefined' || !document.documentElement) return null
  return document.documentElement.dataset.hermesTheme || null
}

let forgeSkinObserver = null
function forgeEnsureSkinObserver() {
  if (forgeSkinObserver || typeof window === 'undefined') return
  forgeSkinObserver = new MutationObserver(() => {
    const v = forgeReadActiveSkin()
    if (v !== $forgeActiveSkin.get()) $forgeActiveSkin.set(v)
  })
  forgeSkinObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-hermes-theme'] })
  $forgeActiveSkin.set(forgeReadActiveSkin())
}

function forgeUseActiveSkin() {
  const v = useValue($forgeActiveSkin)
  useEffect(() => {
    forgeEnsureSkinObserver()
  }, [])
  return v
}

/** Small indicator dot: lit when this theme is the one currently applied. */
function forgeActiveDot({ active }) {
  return jsx('span', {
    title: active ? 'Currently applied' : 'Not applied',
    'aria-hidden': true,
    style: {
      width: 8,
      height: 8,
      borderRadius: 999,
      flexShrink: 0,
      background: active ? 'var(--ui-accent)' : 'var(--ui-stroke-secondary)',
      boxShadow: active ? '0 0 6px var(--ui-accent)' : 'none',
      transition: 'background 0.15s ease, box-shadow 0.15s ease'
    }
  })
}

// ── color math ──────────────────────────────────────────────────────────────

const rgbToHex = (r, g, b) =>
  '#' +
  [r, g, b]
    .map(n =>
      Math.round(Math.min(255, Math.max(0, n)))
        .toString(16)
        .padStart(2, '0')
    )
    .join('')

const hexToRgb = hex => {
  const c = String(hex).trim().replace(/^#/, '')
  if (!/^[0-9a-f]{6}$/i.test(c)) return null
  return [0, 2, 4].map(i => parseInt(c.slice(i, i + 2), 16))
}

const mix = (a, b, t) => {
  const A = hexToRgb(a)
  const B = hexToRgb(b)
  return A && B ? rgbToHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t) : a
}

const lin = c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)

const luminance = hex => {
  const rgb = hexToRgb(hex)
  if (!rgb) return 0
  const [r, g, b] = rgb.map(v => lin(v / 255))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

const contrast = (a, b) => {
  const la = luminance(a)
  const lb = luminance(b)
  return la >= lb ? (la + 0.05) / (lb + 0.05) : (lb + 0.05) / (la + 0.05)
}

const readableOn = bg => (luminance(bg) > 0.58 ? '#161616' : '#ffffff')

const ensureContrast = (color, bg, min) => {
  if (contrast(color, bg) >= min) return color
  const toward = luminance(bg) < 0.5 ? '#ffffff' : '#000000'
  let best = color
  for (let t = 0.1; t <= 1.001; t += 0.1) {
    const c = mix(color, toward, t)
    if (contrast(c, bg) > contrast(best, bg)) best = c
    if (contrast(c, bg) >= min) return c
  }
  return readableOn(bg)
}

/**
 * Tripwire floor for the verbatim foreground (slot-2) color. WCAG body-text
 * target is 4.5:1, but the user's whole point of a verbatim slot-2 is to place
 * an exact accent/text color — so the floor is deliberately the LARGE-TEXT bar
 * (3:1), a "you can't read this at all" tripwire, not a readability rule.
 * ensureContrast is a no-op above it, so readable low-contrast accents pass
 * through untouched; only a near-black-on-near-black hard illegibility nudges
 * toward the correct polarity just enough to clear the bar. Keeps creative
 * freedom while guaranteeing the theme is never literally unreadable.
 */
const FORGE_TEXT_FLOOR = 3

function rgbToHsl(r, g, b) {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0
  let s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6
        break
      case g:
        h = ((b - r) / d + 2) / 6
        break
      default:
        h = ((r - g) / d + 4) / 6
    }
  }
  return { h, s, l }
}

function hslToRgb(h, s, l) {
  let r, g, b
  if (s === 0) {
    r = g = b = l
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1
      if (t > 1) t -= 1
      if (t < 1/6) return p + (q - p) * 6 * t
      if (t < 1/2) return q
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6
      return p
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    r = hue2rgb(p, q, h + 1/3)
    g = hue2rgb(p, q, h)
    b = hue2rgb(p, q, h - 1/3)
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)]
}

const hexToHsl = hex => {
  const rgb = hexToRgb(hex)
  return rgb ? rgbToHsl(rgb[0], rgb[1], rgb[2]) : null
}

const hslToHex = (h, s, l) => {
  const [r, g, b] = hslToRgb(h, s, l)
  return rgbToHex(r, g, b)
}

// ── palette extraction: median-cut ──────────────────────────────────────────

function extractPalette(imgEl, maxColors = 12) {
  const w = imgEl.naturalWidth || imgEl.width
  const h = imgEl.naturalHeight || imgEl.height
  const side = 256
  const scale = Math.min(1, side / Math.max(w, h))
  const cw = Math.max(1, Math.round(w * scale))
  const ch = Math.max(1, Math.round(h * scale))

  const canvas = document.createElement('canvas')
  canvas.width = cw
  canvas.height = ch
  const g2d = canvas.getContext('2d', { willReadFrequently: true })
  g2d.drawImage(imgEl, 0, 0, cw, ch)

  const data = g2d.getImageData(0, 0, cw, ch).data
  const px = []
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue
    px.push([data[i], data[i + 1], data[i + 2]])
  }
  if (px.length < 8) throw new Error('Image has no usable pixels (too small or transparent)')

  let boxes = [px]
  while (boxes.length < maxColors) {
    let bi = 0
    let bestRange = -1
    let bestCh = 0
    boxes.forEach((box, idx) => {
      for (let ch2 = 0; ch2 < 3; ch2++) {
        let lo = 255
        let hi = 0
        for (const p of box) {
          if (p[ch2] < lo) lo = p[ch2]
          if (p[ch2] > hi) hi = p[ch2]
        }
        if (hi - lo > bestRange) {
          bestRange = hi - lo
          bestCh = ch2
          bi = idx
        }
      }
    })
    if (bestRange <= 0) break
    const box = boxes[bi]
    box.sort((a, b) => a[bestCh] - b[bestCh])
    const mid = Math.floor(box.length / 2)
    boxes.splice(bi, 1, box.slice(0, mid), box.slice(mid))
  }

  return boxes
    .filter(b => b.length > 0)
    .map(b => {
      let r = 0
      let g = 0
      let bl = 0
      for (const p of b) {
        r += p[0]
        g += p[1]
        bl += p[2]
      }
      const n = b.length
      const hex = rgbToHex(r / n, g / n, bl / n)
      return { hex, hsl: rgbToHsl(r / n, g / n, bl / n), weight: n }
    })
    .sort((a, b) => b.weight - a.weight)
}

// ── theme synthesis ─────────────────────────────────────────────────────────
// Swatch ORDER is user-editable: index 0 seeds the background, remaining
// swatches rank as accent priority (most-chromatic slot first).

const slugify = s =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'forged'

function ansiPalette(ordered, bg, fgSeed) {
  const bgL = luminance(bg)
  const darkBg = bgL < 0.5
  // accent priority = swatches after the bg seed, chromatic ones first
  const chroma = ordered.slice(1).filter(c => c.hsl.s > 0.12)
  const fallbacks = ordered.slice(1).filter(c => c.hsl.s <= 0.12)
  const pool = [...chroma, ...fallbacks]

  const pick = (hLo, hHi, fi) => {
    const hit = chroma.find(c => {
      const h = c.hsl.h * 360
      return h >= hLo && h < hHi
    })
    const alt = pool.find((c, i) => i === fi % Math.max(1, pool.length))
    return (hit || alt || ordered[0]).hex
  }

  const tune = (hex, lift) =>
    darkBg ? ensureContrast(mix(hex, '#ffffff', lift), bg, 3) : ensureContrast(mix(hex, '#000000', lift * 0.8), bg, 3)

  const black = darkBg ? mix(bg, '#ffffff', 0.08) : mix(bg, '#000000', 0.55)
  const white = darkBg ? mix(bg, '#ffffff', 0.85) : mix(bg, '#000000', 0.08)

  return {
    // Terminal body text follows the slot-2 swatch VERBATIM — the exact color
    // the user places is the terminal foreground. Tripwire floor applies: a
    // no-op above FORGE_TEXT_FLOOR, nudges only when the pair is unreadable.
    foreground: fgSeed ? ensureContrast(fgSeed, bg, FORGE_TEXT_FLOOR) : readableOn(bg),
    cursor: tune(pick(150, 260, 0), 0.2),
    selectionBackground: darkBg ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.14)',
    black,
    red: tune(pick(345, 381, 0), 0.1),
    green: tune(pick(80, 160, 1), 0.1),
    yellow: tune(pick(40, 70, 2), 0.1),
    blue: tune(pick(200, 260, 3), 0.1),
    magenta: tune(pick(280, 345, 4), 0.1),
    cyan: tune(pick(160, 200, 5), 0.1),
    white,
    brightBlack: mix(black, white, darkBg ? 0.35 : 0.25),
    brightRed: mix(tune(pick(345, 381, 0), 0.1), white, darkBg ? 0.25 : 0),
    brightGreen: mix(tune(pick(80, 160, 1), 0.1), white, darkBg ? 0.25 : 0),
    brightYellow: mix(tune(pick(40, 70, 2), 0.1), white, darkBg ? 0.25 : 0),
    brightBlue: mix(tune(pick(200, 260, 3), 0.1), white, darkBg ? 0.25 : 0),
    brightMagenta: mix(tune(pick(280, 345, 4), 0.1), white, darkBg ? 0.25 : 0),
    brightCyan: mix(tune(pick(160, 200, 5), 0.1), white, darkBg ? 0.25 : 0),
    brightWhite: mix(white, darkBg ? '#ffffff' : '#000000', darkBg ? 0.4 : 0.18)
  }
}

function buildColorsFromPalette(ordered, wantDark) {
  const seed = ordered[0] || { hex: wantDark ? '#101014' : '#fafafa', hsl: { h: 0, s: 0, l: wantDark ? 0.06 : 0.97 } }
  const rest = ordered.slice(1)
  const byLum = [...rest].sort((a, b) => a.hsl.l - b.hsl.l)
  const chromaRank = [...rest].sort((a, b) => b.hsl.s * (1 - Math.abs(b.hsl.l - 0.5)) - a.hsl.s * (1 - Math.abs(a.hsl.l - 0.5)))

  // accent = first chromatic swatch in USER order (priority), else chroma rank
  const userAccent = rest.find(c => c.hsl.s > 0.12)
  const accentRaw = userAccent || chromaRank[0] || seed

  // ── Background: slot 1 IS the background color, VERBATIM. No lightness
  // enforcement, no mix-toward-black/white: the color the user places in
  // slot 1 is exactly the background the theme uses. (The old enforcement
  // "blended" every seed toward near-black/near-white, so placing a swatch
  // never showed THAT color.)
  const background = seed.hex

  // Foreground: slot 2 IS the foreground/text color, VERBATIM. No lightness
  // guidance: the exact color the user places in slot 2 is the starting text
  // color (UI + terminal). This is the fix for "swapped swatches and text
  // never visibly changed" — the old code blended every slot-2 seed toward
  // near-white/near-black for contrast, so the swap never showed THAT color.
  //
  // Tripwire floor (below): the verbatim contract is preserved UNLESS the pair
  // is genuinely unreadable (near-black text on a near-black bg). ensureContrast
  // is a no-op above the floor, so deliberate, readable low-contrast choices
  // pass through untouched — freedom kept. Only a hard illegibility (contrast
  // < FORGE_TEXT_FLOOR) nudges toward the correct polarity, just enough to clear
  // the floor. This is the backstop the user asked for after landing on a
  // super-dark, unreadable theme.
  let foreground
  if (ordered.length >= 2) {
    foreground = ordered[1].hex
  } else {
    if (wantDark) {
      foreground = (byLum[byLum.length - 1] || seed).hex
      if (luminance(foreground) < 0.55) foreground = mix(foreground, '#ffffff', 0.75)
    } else {
      foreground = (byLum[0] || seed).hex
      if (luminance(foreground) > 0.35) foreground = mix(foreground, '#060608', 0.7)
    }
  }
  foreground = ensureContrast(foreground, background, FORGE_TEXT_FLOOR)

  const accentSafe = accentRaw.hex
  const card = wantDark ? mix(background, '#ffffff', 0.045) : mix(background, '#000000', 0.015)
  const muted = wantDark ? mix(background, '#ffffff', 0.07) : mix(background, '#000000', 0.045)
  const mutedFg = ensureContrast(mix(foreground, background, 0.42), background, 4.5)
  const border = wantDark ? mix(background, '#ffffff', 0.14) : mix(background, '#000000', 0.13)

  return {
    background,
    // Slot-2 color is the text color, verbatim — no contrast re-mix so the
    // swap shows THAT color on screen. (Readability is the user's call now.)
    foreground,
    card,
    cardForeground: foreground,
    muted,
    mutedForeground: mutedFg,
    popover: card,
    popoverForeground: foreground,
    primary: accentSafe,
    primaryForeground: readableOn(accentSafe),
    secondary: mix(muted, accentSafe, 0.12),
    secondaryForeground: ensureContrast(foreground, muted, 5),
    accent: mix(muted, accentSafe, 0.22),
    accentForeground: ensureContrast(foreground, mix(muted, accentSafe, 0.22), 5),
    border,
    input: border,
    ring: accentSafe,
    midground: accentSafe,
    composerRing: accentSafe,
    destructive: ensureContrast(wantDark ? '#c0473a' : '#c72e4d', background, 3),
    destructiveForeground: '#ffffff',
    sidebarBackground: wantDark ? mix(background, '#000000', 0.16) : mix(background, '#000000', 0.03),
    sidebarBorder: wantDark ? mix(border, '#ffffff', 0.02) : border,
    userBubble: mix(muted, accentSafe, 0.16),
    userBubbleBorder: mix(border, accentSafe, 0.3)
  }
}

/** Build the full DesktopTheme from an ORDERED swatch list. */
function synthesize(ordered, meta) {
  const darkColors = buildColorsFromPalette(ordered, true)
  const lightColors = buildColorsFromPalette(ordered, false)
  const primary = meta.mode === 'light' ? lightColors : darkColors
  // Slot 2 (index 1) is the TEXT seed — feed its raw hue to the terminal
  // palette so the terminal's body text follows the same swatch as the UI.
  const textSeed = ordered.length >= 2 ? ordered[1].hex : null
  return {
    name: meta.name,
    label: meta.label,
    description: 'Forged from an image · theme-lab plugin',
    colors: primary,
    darkColors,
    terminal: ansiPalette(ordered, primary.background, textSeed),
    darkTerminal: ansiPalette(ordered, darkColors.background, textSeed)
  }
}

/**
 * Recover a swatch list from a theme's own tokens — for v1-era entries that
 * never stored their extracted palette. Order follows the tray's semantics:
 * slot 1 = background seed, rest = accent priority.
 */
function deriveSwatches(theme) {
  const c = theme.darkColors || theme.colors || {}
  const t = theme.darkTerminal || theme.terminal || {}
  const candidates = [c.background, c.primary, c.foreground, t.red, t.green, t.blue, t.yellow, t.magenta, t.cyan, c.destructive, c.accent, c.secondary]
  const seen = new Set()
  const out = []
  for (const hex of candidates) {
    if (typeof hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(hex)) continue
    const key = hex.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const rgb = hexToRgb(hex)
    if (!rgb) continue
    out.push({ hex, hsl: rgbToHsl(rgb[0], rgb[1], rgb[2]), weight: 1000 - out.length })
    if (out.length >= 8) break
  }
  return out
}

/**
 * The plugin used to auto-prepend 'Forge · ' to every theme label. Sleek
 * mode: strip ONLY that exact auto-injected prefix. Names that carry 'Forge'
 * as part of the actual name ('Dark Forge', 'Forge Midnight') are untouched.
 * Falls back to the original if stripping would empty the label.
 */
const stripForgePrefix = label => {
  const raw = String(label || '')
  return raw.replace(/^\s*forge\s*[·•]\s*/i, '').trim() || raw
}

// ── persistence + registration ──────────────────────────────────────────────

let storageRef = null
let registerRef = null
const disposersBySlug = new Map()

function registerTheme(theme) {
  if (!registerRef) return
  if (disposersBySlug.has(theme.name)) disposersBySlug.get(theme.name)()
  // Fresh object identity each call → the registry snapshot cache busts and
  // the Appearance grid / active skin repaint live.
  const dispose = registerRef({ id: `theme:${theme.name}`, area: THEMES_AREA, data: { ...theme } })
  disposersBySlug.set(theme.name, dispose)
}

function saveThemes(list) {
  if (storageRef) storageRef.set('themes', list)
  $generated.set(list)
}

function updateTheme(slug, patch) {
  const list = storageRef ? storageRef.get('themes', []) : []
  const next = list.map(t => (t.name === slug ? { ...t, ...patch } : t))
  saveThemes(next)
  const t = next.find(x => x.name === slug)
  if (t && t.theme) registerTheme(t.theme)
  return t
}

// ── forge pipeline ──────────────────────────────────────────────────────────

async function loadImageFromUrl(url) {
  return new Promise((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = () => reject(new Error('Could not decode that image'))
    el.src = url
  })
}

/** Downscale to a small JPEG data-URL so sources survive restarts cheaply. */
function thumbOf(imgEl) {
  const w = imgEl.naturalWidth || imgEl.width
  const h = imgEl.naturalHeight || imgEl.height
  const side = 128
  const s = Math.min(1, side / Math.max(w, h))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(w * s))
  canvas.height = Math.max(1, Math.round(h * s))
  const g = canvas.getContext('2d')
  g.drawImage(imgEl, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.75)
}

async function forgeTheme(file, mode) {
  const url = URL.createObjectURL(file)
  try {
    const img = await loadImageFromUrl(url)
    const palette = extractPalette(img, 12)
    const baseName = file.name.replace(/\.[a-z0-9]+$/i, '')
    const slug = slugify(baseName)
    const label = baseName.length > 24 ? baseName.slice(0, 24) + '…' : baseName
    const ordered = [...palette].sort((a, b) => b.weight - a.weight).slice(0, 8)
    const themeName = `forge-${slug}`

    return {
      name: themeName,
      label,
      mode,
      swatches: ordered,
      theme: synthesize(ordered, { name: themeName, label, mode }),
      source: thumbOf(img),
      forgedAt: Date.now()
    }
  } finally {
    URL.revokeObjectURL(url)
  }
}

function handleFile(file) {
  if (!file || !file.type.startsWith('image/')) {
    host.notify({ kind: 'warning', message: 'That file is not an image.' })
    return
  }
  $busy.set(true)
  forgeTheme(file, $mode.get())
    .then(entry => {
      const list = (storageRef ? storageRef.get('themes', []) : []).filter(t => t.name !== entry.name)
      list.unshift(entry)
      saveThemes(list)
      registerTheme(entry.theme)
      // Also write the backend skin so it applies live + survives restart.
      forgeWriteBackendSkin(entry.theme, entry.label).catch(err =>
        host.notify({ kind: 'warning', message: 'Theme saved, but backend skin write failed.' })
      )
      haptic('tap')
      host.notify({
        kind: 'success',
        message: `"${entry.label}" forged — Apply in the pane, or pick it in Settings → Appearance.`
      })
    })
    .catch(err => host.notifyError(err, 'Theme Forge'))
    .finally(() => $busy.set(false))
}

function reforge(entry) {
  if (!entry.source) {
    host.notify({ kind: 'warning', message: 'No source image kept for this theme — forge a new one.' })
    return
  }
  loadImageFromUrl(entry.source)
    .then(img => {
      const palette = extractPalette(img, 12)
      const ordered = [...palette].sort((a, b) => b.weight - a.weight).slice(0, 8)
      const theme = synthesize(ordered, entry)
      const updated = updateTheme(entry.name, { swatches: ordered, theme, mode: $mode.get() })
      if (updated?.theme) {
        forgeWriteBackendSkin(updated.theme, updated.label).catch(() => {})
      }
      haptic('tap')
      host.notify({ kind: 'success', message: `"${entry.label}" reforged.` })
    })
    .catch(err => host.notifyError(err, 'Theme Forge'))
}

function applyTheme(entry) {
  // Every forge theme now also has a backend skin YAML (~/.hermes/skins),
  // so the gateway can resolve it and config.set applies it LIVE — no
  // Settings visit. Built-in backend skins apply live directly.
  const writeFirst = !forgeBackendSkins.has(entry.name) && entry.theme
  const apply = () => {
    if (forgeIsBackendSkin(entry.name)) {
      forgeApplyLive(entry)
      return
    }
    host.navigate('/settings?tab=config:appearance')
    host.notify({ kind: 'info', message: `Click "${entry.label}" in the grid to apply.` })
  }
  if (writeFirst) {
    forgeWriteBackendSkin(entry.theme, entry.label)
      .then(apply)
      .catch(() => {
        host.navigate('/settings?tab=config:appearance')
        host.notify({ kind: 'info', message: `Click "${entry.label}" in the grid to apply.` })
      })
    return
  }
  apply()
}

// Backend-known skins: the gateway's `config.set display.skin=<name>` RPC
// broadcasts skin.changed, which the desktop drains through setTheme → the
// theme repaints WITHOUT navigating away from this pane. Names from
// hermes_cli/skin_engine.py _BUILTIN_SKINS (verified in the app source).
const forgeBackendSkins = new Set([
  'default', 'ares', 'mono', 'slate', 'daylight', 'warm-lightmode',
  'poseidon', 'sisyphus', 'charizard'
])

function forgeIsBackendSkin(name) {
  // Built-in backend skins + any forge-* theme (every forge theme now has a
  // backend YAML, so the gateway resolves it and config.set applies it live).
  return Boolean(name) && (forgeBackendSkins.has(name) || name.startsWith('forge-'))
}

function forgeApplyLive(entry) {
  host.request('config.set', { key: 'skin', value: entry.name })
    .then(() => {
      haptic('tap')
      host.notify({ kind: 'success', message: `"${entry.label}" applied live.` })
    })
    .catch(err => {
      host.notifyError(err, 'Theme Forge apply')
      // Fall back to the honest path if the gateway can't take it.
      host.navigate('/settings?tab=config:appearance')
      host.notify({ kind: 'info', message: `Click "${entry.label}" in the grid to apply.` })
    })
}

// ── backend skin bridge ────────────────────────────────────────────────────
// Forge themes are ALSO written as backend skins (~/.hermes/skins/<slug>.yaml)
// so the gateway can resolve them: config.set skin=<slug> then applies LIVE
// (no Settings visit) AND the selection survives restarts (backend skins are
// re-seeded via gateway.ready). Colors map to the exact keys skinToDesktopTheme
// (apps/desktop/src/themes/skin.ts) reads back out.

const forgeSkinsDir = () => '~/.hermes/skins'

function forgeThemeToBackendColors(theme) {
  const c = theme.colors || {}
  return {
    background: c.background,
    status_bar_bg: c.background,
    ui_text: c.foreground,
    banner_text: c.foreground,
    ui_accent: c.primary,
    banner_accent: c.primary,
    banner_title: c.primary,
    ui_border: c.border || c.ring,
    banner_border: c.border || c.ring,
    banner_dim: c.mutedForeground,
    session_border: c.border || c.ring,
    ui_error: c.destructive,
    completion_menu_bg: c.muted
  }
}

function forgeBackendYaml(theme, label) {
  const colors = forgeThemeToBackendColors(theme)
  const lines = [
    `# Forged by Theme Forge — ${label || theme.name}`,
    `name: ${theme.name}`,
    `description: "${String(label || theme.name).replace(/"/g, '\\"')}"`,
    'colors:'
  ]
  for (const [key, value] of Object.entries(colors)) {
    if (value) lines.push(`  ${key}: "${value}"`)
  }
  return lines.join('\n') + '\n'
}

let forgeSkinsDirReady = null
async function forgeEnsureSkinsDir() {
  if (forgeSkinsDirReady) return forgeSkinsDirReady
  forgeSkinsDirReady = host
    .request('shell.exec', { command: `mkdir -p ${forgeSkinsDir()}` })
    .then(() => true)
    .catch(err => {
      forgeSkinsDirReady = null
      throw err
    })
  return forgeSkinsDirReady
}

async function forgeWriteBackendSkin(theme, label) {
  await forgeEnsureSkinsDir()
  const path = `${forgeSkinsDir()}/${theme.name}.yaml`
  if (window.hermesDesktop && typeof window.hermesDesktop.writeTextFile === 'function') {
    await window.hermesDesktop.writeTextFile(path, forgeBackendYaml(theme, label))
    return true
  }
  return false
}

async function forgeRemoveBackendSkin(name) {
  if (window.hermesDesktop && typeof window.hermesDesktop.trashPath === 'function') {
    try {
      await window.hermesDesktop.trashPath(`${forgeSkinsDir()}/${name}.yaml`)
    } catch (err) {
      // Already gone — fine.
    }
  }
}

// ── escape hatch (theme-immune) ─────────────────────────────────────────────
// A broken theme (super-dark bg + dark text) makes the pane's theme-var text
// illegible. This button is the ONE thing that must survive any theme, so it
// deliberately uses HARDCODED colors and a fixed glow — never theme vars. It
// resets to the safe default via the gateway (config.set skin=default →
// skin.changed → desktop setTheme('default') → repaints to the canonical
// 'nous' theme). No navigation, no Settings, fully reversible: the user's
// forged themes stay saved in the pane.
function forgeResetToDefault() {
  host.request('config.set', { key: 'skin', value: 'default' })
    .then(() => {
      haptic('tap')
      $forgeActiveSkin.set('default')
      host.notify({ kind: 'success', message: 'Reset to the safe default theme.' })
    })
    .catch(err => host.notifyError(err, 'Theme Forge reset'))
}

function forgeEscapeHatch() {
  return jsx('button', {
    type: 'button',
    onClick: forgeResetToDefault,
    title: 'Always visible — reset to the safe default theme if this one is unreadable',
    'aria-label': 'Reset to safe default theme',
    // Hardcoded, theme-independent: high-contrast amber-on-dark that reads
    // against ANY background (light or dark, any palette). boxShadow rings
    // are inline because arbitrary shadow-[…] classes are frozen-CSS dead.
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      width: '100%',
      padding: '6px 10px',
      borderRadius: 6,
      fontSize: 12,
      fontWeight: 700,
      lineHeight: 1.2,
      color: '#111111',
      background: 'linear-gradient(135deg, #ffb300 0%, #ff8f00 100%)',
      border: '1px solid #6d4c00',
      boxShadow: '0 0 0 1px rgba(0,0,0,0.35), 0 0 10px rgba(255,179,0,0.55)',
      cursor: 'pointer',
      flexShrink: 0,
      userSelect: 'none'
    },
    children: [
      jsx(icons.AlertTriangle, { className: 'size-3.5 shrink-0', style: { color: '#111111' } }),
      jsx('span', { children: 'Reset to safe theme' })
    ]
  })
}

function StripRow({ entry, onOpen, active }) {
  const theme = entry.theme || {}
  const t = theme.darkTerminal || theme.terminal || {}
  const colors = theme.darkColors || theme.colors || {}
  const swatches = entry.swatches && entry.swatches.length ? entry.swatches : deriveSwatches(theme)

  const handleClick = ev => {
    if (ev.target.closest('button')) return
    onOpen?.()
  }

  const handleApply = ev => {
    ev.stopPropagation()
    applyTheme(entry)
  }

  const label = entry.label || theme.label || entry.name
  const thumb = entry.source
    ? jsx('img', { src: entry.source, alt: '', className: 'h-5 w-5 shrink-0 rounded-[2px] object-cover' })
    : jsx('div', {
        className: 'h-5 w-5 shrink-0 rounded-[2px]',
        style: { background: `linear-gradient(135deg, ${colors.background || '#222'} 0%, ${colors.primary || '#666'} 100%)` }
      })

  return jsxs('button', {
    type: 'button',
    onClick: handleClick,
    className: cn(
      'flex w-full items-center gap-2 rounded-none px-1.5 py-1 text-left',
      'hover:bg-(--chrome-action-hover) active:bg-(--chrome-active-hover)'
    ),
    children: [
      jsx(forgeActiveDot, { active }),
      thumb,
      jsx('div', {
        className: 'min-w-0 flex-1 truncate text-[0.6875rem] text-(--ui-text-tertiary)',
        title: label,
        children: label
      }),
      jsxs('div', { className: 'flex shrink-0 items-center gap-1', children: [
        jsx('div', {
          ref: el => {
            if (!el) return
            const inner = el.firstElementChild
            if (!inner) return
            const hint = el._scrollHint
            const overflow = inner.scrollWidth > el.clientWidth + 1
            if (!overflow && hint) { hint.style.opacity = '0'; hint.removeAttribute('aria-hidden') }
            else if (overflow && !hint) {
              const node = document.createElement('span')
              node.setAttribute('aria-hidden', 'true')
              node.style.cssText = 'position:absolute;right:0;top:0;bottom:0;width:14px;pointer-events:none;background:linear-gradient(to right, transparent, var(--chrome-action-hover));'
              el.appendChild(node)
              el._scrollHint = node
            }
          },
          onWheel: ev => {
            const el = ev.currentTarget
            if (Math.abs(ev.deltaY) > Math.abs(ev.deltaX)) {
              ev.preventDefault()
              el.scrollLeft += ev.deltaY
            }
          },
          className: 'relative flex overflow-x-auto overflow-y-visible',
          style: { scrollbarWidth: 'none', scrollSnapType: 'x proximity' },
          children: [
            ...swatches.slice(0, 8).map((s, i) =>
              jsxs(
                'span',
                {
                  className: 'flex shrink-0 flex-col items-center',
                  style: { scrollSnapAlign: 'start', gap: 1 },
                  children: [
                    jsx('span', {
                      className: 'h-3.5 w-3.5 rounded-[2px]',
                      style: { background: s.hex },
                      title:
                        i === 0
                          ? `#1 · bkgnd · ${s.hex}`
                          : i === 1
                            ? `#2 · text · ${s.hex}`
                            : `#${i + 1} · ${s.hex}`,
                      'aria-hidden': true
                    }),
                    jsx('span', {
                      className: 'text-[0.5rem] leading-none text-(--ui-text-quaternary)',
                      style: { height: 7 },
                      'aria-hidden': true,
                      children: i === 0 ? 'bkgnd' : i === 1 ? 'text' : ''
                    })
                  ]
                },
                `s-${i}`
              )
            ),
            jsx(Button, {
              variant: 'ghost',
              size: 'icon-xs',
              title: 'Apply theme',
              onClick: handleApply,
              children: jsx(icons.Palette, { className: 'size-3.5' })
            })
          ]
        })
      ] })
    ]
  })
}

// ── UI bits ─────────────────────────────────────────────────────────────────

/** Card thumbnail: the kept source image, or a color field built from the
 *  theme's own tokens for v1-era entries (no source persisted). */
function ThemeThumb({ entry }) {
  if (entry.source) {
    return jsx('img', { src: entry.source, alt: '', className: 'h-5 w-5 shrink-0 rounded-[2px] object-cover' })
  }
  const c = entry.theme?.darkColors || entry.theme?.colors || {}
  const t = entry.theme?.darkTerminal || entry.theme?.terminal || {}
  const bg = c.background || '#222222'
  const p1 = c.primary || '#888888'
  const p2 = t.cyan || t.green || p1
  return jsx('div', {
    className: 'h-5 w-5 shrink-0 rounded-[3px]',
    title: 'Theme colors (no source image kept)',
    style: {
      background: `linear-gradient(135deg, ${bg} 0%, ${bg} 40%, ${p1} 40%, ${p1} 70%, ${p2} 70%)`,
      boxShadow: 'inset 0 0 0 1px rgba(128,128,128,0.35)'
    }
  })
}

function TermPreview({ theme, mode }) {
  // Render a mini terminal using the theme's ANSI palette for the right mode
  const t = mode === 'light' && !theme.darkTerminal ? theme.terminal : mode === 'light' ? theme.terminal : theme.darkTerminal || theme.terminal
  const colors = mode === 'light' ? theme.colors : theme.darkColors || theme.colors
  const bg = colors.background
  const fg = t.foreground || colors.foreground

  const line = (chunks, key) =>
    jsx(
      'div',
      { className: 'whitespace-pre', children: chunks.map(([text, color], i) => jsx('span', { style: { color }, children: text }, `${key}-${i}`)) },
      key
    )

  return jsx('div', {
    className: 'overflow-x-auto rounded-[6px] p-2 font-mono text-[0.6875rem] leading-relaxed',
    style: { background: bg, color: fg, boxShadow: 'inset 0 0 0 1px rgba(128,128,128,0.25)' },
    children: [
      line([['➜ ', t.green], ['~/farmfriend ', t.cyan], ['git status', fg]], 'l1'),
      line([['On branch ', fg], ['main', t.magenta]], 'l2'),
      line([['  modified:   ', t.yellow], ['src/agent/core.py', t.blue]], 'l3'),
      line([['  new file:   ', t.green], ['themes/', t.blue], ['forge.json', fg]], 'l4'),
      line([['$ ', t.green], ['hermes ', t.cyan], ['--profile ', t.yellow], ['closer', t.magenta], [' chat', fg]], 'l5'),
      line([['⚡ error: ', t.red], ['provider timeout — retrying', fg], [' (bright: ', t.brightYellow], ['ok', t.brightGreen], [')', fg]], 'l6')
    ]
  })
}

function SwatchTray({ entry }) {
  const dragIdx = useRef(null)
  const [over, setOver] = useState(null)
  const picked = useValue($picked)
  const pickedHere = picked && picked.slug === entry.name ? picked.index : null

  // v1-era entries persisted with an empty swatch list — recover from tokens
  const swatches = entry.swatches && entry.swatches.length > 0 ? entry.swatches : deriveSwatches(entry.theme)

  const move = (from, to) => {
    if (from === to) return
    $wheelOpen.set(null)
    const sw = [...swatches]
    const [moved] = sw.splice(from, 1)
    sw.splice(to, 0, moved)
    const theme = synthesize(sw, entry)
    updateTheme(entry.name, { swatches: sw, theme })
    haptic('tap')
  }

  // Primary interaction: click a swatch to pick it up, click a slot to place
  // it. Works with any pointer; drag remains available as a fast path.
  const place = i => {
    if ($wheelOpen.get()) $wheelOpen.set(null)
    if (pickedHere === null) {
      $picked.set({ slug: entry.name, index: i })
      return
    }
    if (pickedHere === i) {
      $picked.set(null) // toggle off
      return
    }
    move(pickedHere, i)
    $picked.set(null)
  }

  const wheel = useValue($wheelOpen)
  const wheelHere = wheel && wheel.slug === entry.name ? wheel.index : null

  const openWheel = i => {
    if (pickedHere !== null) return
    $wheelOpen.set({ slug: entry.name, index: i })
  }

  const commitWheel = (index, hex) => {
    const next = swatches.map((s, i) => (i === index ? { ...s, hex, hsl: hexToHsl(hex) } : s))
    const theme = synthesize(next, entry)
    updateTheme(entry.name, { swatches: next, theme })
    $wheelOpen.set(null)
    haptic('tap')
  }

  return jsxs('div', {
    className: 'flex flex-col gap-1',
    children: [
      jsx('div', {
        className: 'text-[0.625rem] text-(--ui-text-quaternary)',
        children: pickedHere !== null
          ? 'picked up — click a slot to place (click again to cancel)'
          : 'swatch 1 = background hue · swatch 2 = text · tap to pick up, double-click to edit'
      }),
      jsx('div', {
        ref: el => {
          if (!el) return
          const inner = el.firstElementChild
          if (!inner) return
          const hint = el._scrollHint
          const overflow = inner.scrollWidth > el.clientWidth + 1
          if (!overflow && hint) { hint.style.opacity = '0'; hint.removeAttribute('aria-hidden') }
          else if (overflow && !hint) {
            const node = document.createElement('span')
            node.setAttribute('aria-hidden', 'true')
            node.style.cssText = 'position:absolute;right:0;top:0;bottom:0;width:18px;pointer-events:none;background:linear-gradient(to right, transparent, var(--chrome-action-hover));'
            el.appendChild(node)
            el._scrollHint = node
          }
        },
        onWheel: ev => {
          const el = ev.currentTarget
          if (Math.abs(ev.deltaY) > Math.abs(ev.deltaX)) {
            ev.preventDefault()
            el.scrollLeft += ev.deltaY
          }
        },
        className: 'relative flex gap-1.5 overflow-x-auto overflow-y-visible',
        style: { scrollbarWidth: 'none', scrollSnapType: 'x proximity' },
        children: swatches.map((s, i) =>
          jsxs(
            'div',
            {
              className: 'flex shrink-0 flex-col items-center gap-0.5',
              style: { scrollSnapAlign: 'start' },
              children: [
                jsx(
                  'div',
                  {
                    role: 'button',
                    tabIndex: 0,
                    draggable: true,
                    title:
                      i === 0
                        ? `#1 · background seed · ${s.hex}`
                        : i === 1
                          ? `#2 · text seed · ${s.hex}`
                          : `#${i + 1} · ${s.hex}`,
                    onClick: () => place(i),
                    onDoubleClick: () => openWheel(i),
                    onKeyDown: ev => {
                      if (ev.key === 'Enter' || ev.key === ' ') {
                        ev.preventDefault()
                        place(i)
                      }
                    },
                    onDragStart: ev => {
                      dragIdx.current = i
                      ev.dataTransfer.effectAllowed = 'move'
                      ev.dataTransfer.setData('text/plain', String(i))
                    },
                    onDragOver: ev => {
                      ev.preventDefault()
                      ev.dataTransfer.dropEffect = 'move'
                      setOver(i)
                    },
                    onDragLeave: () => setOver(v => (v === i ? null : v)),
                    onDrop: ev => {
                      ev.preventDefault()
                      ev.stopPropagation()
                      setOver(null)
                      if (dragIdx.current !== null) move(dragIdx.current, i)
                      dragIdx.current = null
                    },
                    onDragEnd: () => {
                      dragIdx.current = null
                      setOver(null)
                    },
                    className: 'flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-[5px] text-xs font-bold',
                    style: {
                      background: s.hex,
                      color: readableOn(s.hex),
                      // ring/scale inline: arbitrary shadow-[…] and scale-* are not
                      // in the app's frozen build CSS
                      boxShadow:
                        'inset 0 0 0 1px rgba(128,128,128,0.45)' +
                        (pickedHere === i || over === i ? ', 0 0 0 2px var(--ui-accent)' : ''),
                      transform: pickedHere === i || over === i ? 'scale(1.08)' : 'none',
                      transition: 'transform 0.1s ease'
                    },
                    children: i + 1
                  },
                  `sw-${i}`
                ),
                // Role captions: slot 1 seeds the background, slot 2 seeds the
                // text color (UI + terminal). Fixed-height slot keeps the row
                // aligned where no caption applies.
                jsx('div', {
                  className: 'h-3 text-center text-[0.5625rem] leading-none text-(--ui-text-quaternary)',
                  'aria-hidden': true,
                  children: i === 0 ? 'bkgnd' : i === 1 ? 'text' : ''
                })
              ]
            },
            `swc-${i}`
          )
        )
      }),
      wheelHere !== null && wheelHere < swatches.length
        ? jsx(ColorWheelPanel, {
            value: swatches[wheelHere].hex,
            // Live preview: only update the swatch hex in memory so the wheel's
            // own preview chip follows. Do NOT synthesize/save on every drag —
            // that races with commit and bleaches the final color.
            onChange: hex => {
              const next = swatches.map((s, i) => (i === wheelHere ? { ...s, hex, hsl: hexToHsl(hex) } : s))
              updateTheme(entry.name, { swatches: next })
            },
            onCommit: hex => commitWheel(wheelHere, hex),
            onCancel: () => $wheelOpen.set(null)
          })
        : null
    ]
  })
}

function clamp01(n) {
  return n < 0 ? 0 : n > 1 ? 1 : n
}

function hslString(h, s, l) {
  return `hsl(${Math.round(((h % 1) + 1) % 1 * 360)}, ${Math.round(clamp01(s) * 100)}%, ${Math.round(clamp01(l) * 100)}%)`
}

// Curated fast-pick cells for the picker grid (standard picker behavior).
const PRESET_CELLS = [
  '#ffffff', '#f1f3f5', '#ced4da', '#868e96', '#495057', '#161616', '#000000',
  '#fa5252', '#ff922b', '#fcc419', '#82c91e', '#37b24d', '#12b886', '#20c997',
  '#22b8cf', '#339af0', '#1971c2', '#4c6ef5', '#7048e8', '#be4bdb', '#f06595', '#ff8787'
]

/** Strict hex parse: 3- or 6-digit (#abc / #aabbcc) → normalized 6-digit, else null. */
const parseHexStrict = v => {
  const c = String(v).trim().replace(/^#/, '')
  if (/^[0-9a-f]{3}$/i.test(c)) return '#' + c.split('').map(x => x + x).join('')
  if (/^[0-9a-f]{6}$/i.test(c)) return '#' + c.toLowerCase()
  return null
}

function PickerSlider({ label, display, min, max, step, value, onChange, track }) {
  return jsxs('div', {
    className: 'flex items-center gap-1.5',
    children: [
      jsx('span', { className: 'w-4 shrink-0 text-[0.625rem] text-(--ui-text-quaternary)', children: label }),
      jsx('input', {
        type: 'range',
        min,
        max,
        step,
        value,
        onChange: ev => onChange(Number(ev.target.value)),
        className: 'h-1 min-w-0 flex-1',
        style: { background: track, borderRadius: 999, accentColor: 'var(--ui-accent)' }
      }),
      jsx('span', {
        className: 'shrink-0 text-[0.625rem] text-(--ui-text-tertiary)',
        style: { width: 40, textAlign: 'right' },
        children: display
      })
    ]
  })
}

function ColorWheelPanel({ value, onChange, onCommit, onCancel }) {
  const base = hexToHsl(value) || { h: 0, s: 0.75, l: 0.5 }
  const [h, setH] = useState(base.h)
  const [s, setS] = useState(base.s)
  const [l, setL] = useState(base.l)
  const live = hslToHex(h, s, l)
  const [hexDraft, setHexDraft] = useState(live.toUpperCase())
  const wheelRef = useRef(null)
  const dragging = useRef(null)

  // Keep the hex field in sync with wheel/slider edits while you drag.
  useEffect(() => setHexDraft(live.toUpperCase()), [live])

  const hueDeg = Math.round(h * 360)
  const satPct = Math.round(s * 100)
  const liPct = Math.round(l * 100)

  const pickFromScreen = async () => {
    if (typeof window === 'undefined' || !('EyeDropper' in window)) {
      host.notify({ kind: 'warning', message: 'Screen pick (eyedropper) is not supported in this build.' })
      return
    }
    try {
      const ed = new window.EyeDropper()
      const res = await ed.open()
      const hit = parseHexStrict(res.sRGBHex)
      if (!hit) return
      const hsl = hexToHsl(hit)
      if (hsl) { setH(hsl.h); setS(hsl.s); setL(hsl.l) }
    } catch (err) {
      // AbortError = user pressed Escape to cancel; ignore.
      if (!err || err.name !== 'AbortError') host.notify({ kind: 'warning', message: 'Screen pick failed.' })
    }
  }

  const onHexInput = ev => {
    const raw = ev.target.value
    setHexDraft(raw)
    const hit = parseHexStrict(raw)
    if (!hit) return
    const hsl = hexToHsl(hit)
    if (hsl) { setH(hsl.h); setS(hsl.s); setL(hsl.l) }
  }

  const onHexBlur = () => setHexDraft(live.toUpperCase())

  const pickCell = hex => {
    const hsl = hexToHsl(hex)
    if (!hsl) return
    setH(hsl.h)
    setS(hsl.s)
    setL(hsl.l)
  }

  const wheelFromPoint = (clientX, clientY) => {
    const rect = wheelRef.current?.getBoundingClientRect()
    if (!rect) return null
    const x = clientX - rect.left - rect.width / 2
    const y = clientY - rect.top - rect.height / 2
    const radius = Math.min(rect.width, rect.height) / 2
    const dist = Math.sqrt(x * x + y * y) / radius
    if (dist < 0.08 || dist > 1.02) return null
    let angle = Math.atan2(y, x) / (2 * Math.PI)
    if (angle < 0) angle += 1
    return { h: angle, s: Math.min(1, dist) }
  }

  const onWheelPointerDown = ev => {
    const hit = wheelFromPoint(ev.clientX, ev.clientY)
    if (!hit) return
    dragging.current = true
    setH(hit.h)
    setS(hit.s)
    ev.currentTarget.setPointerCapture?.(ev.pointerId)
    ev.preventDefault()
  }

  const onWheelPointerMove = ev => {
    if (!dragging.current) return
    const hit = wheelFromPoint(ev.clientX, ev.clientY)
    if (!hit) return
    setH(hit.h)
    setS(hit.s)
    ev.preventDefault()
  }

  const onWheelPointerUp = () => {
    dragging.current = false
  }

  return jsxs('div', {
    // flex-wrap: when the pane is too narrow for wheel + controls
    // side-by-side, the controls column wraps below the wheel instead of
    // clipping. min() / vw arbitrary classes are NOT in the app's frozen
    // build CSS, so the wheel size lives inline.
    className: 'flex min-w-0 flex-wrap items-stretch gap-2 overflow-hidden rounded-[6px] border border-(--ui-stroke-secondary) p-2',
    style: { background: 'var(--chrome-action-hover)' },
    children: [
      jsx('div', {
        className: 'relative shrink-0 cursor-crosshair select-none overflow-hidden rounded-full',
        ref: wheelRef,
        onPointerDown: onWheelPointerDown,
        onPointerMove: onWheelPointerMove,
        onPointerUp: onWheelPointerUp,
        onPointerCancel: onWheelPointerUp,
        title: 'angle = hue · radius = saturation',
        style: {
          width: 128,
          height: 128,
          background:
            `conic-gradient(from 0deg, hsl(0,100%,50%), hsl(60,100%,50%), hsl(120,100%,50%), hsl(180,100%,50%), hsl(240,100%,50%), hsl(300,100%,50%), hsl(360,100%,50%)),` +
            `radial-gradient(farthest-corner, #fff 0%, rgba(255,255,255,0) 58%, rgba(0,0,0,0.45) 100%)`,
          backgroundBlendMode: 'normal, normal'
        },
        children: [
          jsx('div', {
            // border/shadow inline: arbitrary shadow-[…] and border-white/70
            // are not in the app's frozen build CSS.
            className: 'pointer-events-none absolute left-1/2 top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full',
            style: {
              transform: `translate(calc(-50% + ${Math.cos(h * 2 * Math.PI) * s * 56}px), calc(-50% + ${Math.sin(h * 2 * Math.PI) * s * 56}px))`,
              background: live,
              border: '1px solid rgba(255,255,255,0.7)',
              boxShadow: '0 0 0 1px rgba(0,0,0,0.45)'
            }
          }),
          jsx('div', {
            className: 'pointer-events-none absolute inset-0 rounded-full',
            style: { background: `radial-gradient(circle, transparent 56%, rgba(0,0,0,0.18) 78%, rgba(0,0,0,0.5) 100%)` }
          })
        ]
      }),
      jsxs('div', { className: 'flex min-w-0 flex-col gap-2', style: { flex: '1 1 100px' }, children: [
        jsxs('div', { className: 'flex items-center gap-1.5', children: [
          jsx('div', {
            className: 'h-8 w-8 shrink-0 rounded-[4px]',
            style: { background: live, boxShadow: 'inset 0 0 0 1px rgba(128,128,128,0.45)' }
          }),
          jsx(Input, {
            value: hexDraft,
            onChange: onHexInput,
            onBlur: onHexBlur,
            onKeyDown: ev => {
              if (ev.key === 'Enter') onCommit(live)
              if (ev.key === 'Escape') onCancel()
            },
            className: 'h-6 min-w-0 flex-1 font-mono text-xs',
            style: { width: 88 }
          }),
          jsx(Button, {
            variant: 'ghost',
            size: 'icon-xs',
            title: 'Pick color from screen (eyedropper)',
            onClick: pickFromScreen,
            children: jsx(icons.Eye, { className: 'size-3.5' })
          })
        ] }),
        jsx('div', { className: 'text-[0.625rem] text-(--ui-text-tertiary)', children: `${hueDeg}° hue · ${satPct}% sat · ${liPct}% light` }),
        jsxs('div', { className: 'flex items-center gap-1.5', children: [
          jsx(Button, { variant: 'secondary', size: 'xs', onClick: onCancel, children: 'Cancel' }),
          jsx(Button, { variant: 'primary', size: 'xs', onClick: () => onCommit(live), children: 'OK' })
        ] })
      ] }),
      // Full H/S/L slider set with gradient tracks (standard picker).
      jsxs('div', { className: 'flex w-full min-w-0 flex-col gap-1', children: [
        jsx(PickerSlider, { label: 'H', display: `${hueDeg}°`, min: 0, max: 360, step: 1, value: hueDeg, onChange: v => setH(v / 360), track: `linear-gradient(to right, ${[0, 60, 120, 180, 240, 300, 360].map(a => `hsl(${a},100%,50%)`).join(', ')})` }),
        jsx(PickerSlider, { label: 'S', display: `${satPct}%`, min: 0, max: 100, step: 1, value: satPct, onChange: v => setS(v / 100), track: `linear-gradient(to right, hsl(${hueDeg},0%,${liPct}%), hsl(${hueDeg},100%,${liPct}%))` }),
        jsx(PickerSlider, { label: 'L', display: `${liPct}%`, min: 0, max: 100, step: 1, value: liPct, onChange: v => setL(v / 100), track: `linear-gradient(to right, hsl(${hueDeg},${satPct}%,0%), hsl(${hueDeg},${satPct}%,50%), hsl(${hueDeg},${satPct}%,100%))` })
      ] }),
      // Clickable preset cells.
      jsxs('div', { className: 'flex w-full min-w-0 flex-wrap gap-1', children: PRESET_CELLS.map(cell => jsx('button', {
        type: 'button',
        title: cell,
        'aria-label': cell,
        onClick: () => pickCell(cell),
        className: 'h-3.5 w-3.5 shrink-0 cursor-pointer rounded-[3px]',
        style: { background: cell, boxShadow: 'inset 0 0 0 1px rgba(128,128,128,0.45)' }
      }, cell)) })
    ]
  })
}

function ThemeCard({ entry, active }) {
  const expanded = useValue($expanded) === entry.name
  const editing = useValue($editing) === entry.name
  const mode = useValue($mode)
  const [draft, setDraft] = useState(entry.label)

  useEffect(() => {
    if (editing) setDraft(stripForgePrefix(entry.label))
  }, [editing])

  const commitRename = () => {
    const clean = draft.trim()
    if (clean) {
      const label = clean
      const theme = { ...entry.theme, label }
      updateTheme(entry.name, { label, theme })
      host.notify({ kind: 'success', message: `Renamed to "${label}".` })
    }
    $editing.set(null)
  }

  return jsxs('div', {
    className: 'flex flex-col gap-1.5 rounded-[6px] p-2',
    style: { boxShadow: 'inset 0 0 0 1px var(--ui-stroke-secondary)' },
    children: [
      // header row
      jsxs('div', {
        className: 'flex min-w-0 flex-wrap items-center gap-1',
        children: [
          jsx(forgeActiveDot, { active }),
          jsx(ThemeThumb, { entry }),
          editing
            ? jsxs('div', { className: 'flex min-w-0 flex-1 items-center gap-1', children: [
                jsx(Input, {
                  autoFocus: true,
                  value: draft,
                  onChange: ev => setDraft(ev.target.value),
                  onKeyDown: ev => {
                    if (ev.key === 'Enter') commitRename()
                    if (ev.key === 'Escape') $editing.set(null)
                  },
                  className: 'h-6 min-w-0 flex-1 text-xs'
                }),
                jsx(Button, { variant: 'ghost', size: 'icon-xs', onClick: commitRename, children: jsx(icons.Check, {}) })
              ] })
            : jsxs('div', { className: 'min-w-0 flex-1 truncate', children: [
                jsx('button', {
                  type: 'button',
                  title: 'Rename',
                  onClick: () => $editing.set(entry.name),
                  className: 'min-w-0 truncate text-left text-xs font-medium text-(--ui-text-primary) hover:underline',
                  children: entry.label
                })
              ] }),
          jsxs('div', { className: 'flex shrink-0 items-center gap-0.5', children: [
            jsx(Button, { variant: 'ghost', size: 'icon-xs', title: 'Rename theme', onClick: () => $editing.set(entry.name), children: jsx(icons.Pencil, {}) }),
            jsx(Button, { variant: 'ghost', size: 'icon-xs', title: expanded ? 'Hide terminal preview' : 'Terminal preview', onClick: () => $expanded.set(expanded ? null : entry.name), children: jsx(icons.Terminal, {}) }),
            jsx(Button, { variant: 'ghost', size: 'icon-xs', title: 'Reforge from source image', onClick: () => reforge(entry), children: jsx(icons.RefreshCw, {}) }),
            jsx(Button, { variant: 'ghost', size: 'icon-xs', title: 'Delete theme', onClick: () => {
              const list = (storageRef ? storageRef.get('themes', []) : []).filter(t => t.name !== entry.name)
              saveThemes(list)
              const d = disposersBySlug.get(entry.name)
              if (d) { d(); disposersBySlug.delete(entry.name) }
              forgeRemoveBackendSkin(entry.name)
              haptic('tap')
              host.notify({ kind: 'info', message: `Removed "${entry.label}".` })
            }, children: jsx(icons.Trash2, {}) })
          ] })
        ]
      }),

      jsx(SwatchTray, { entry }),

      jsx(Button, {
        variant: 'secondary',
        size: 'xs',
        onClick: () => {
          host.navigate('/settings?tab=config:appearance')
          host.notify({ kind: 'info', message: `Click "${entry.label}" in the grid to apply.` })
        },
        children: 'Apply…'
      }),

      expanded ? jsx(TermPreview, { theme: entry.theme, mode: entry.mode || mode }) : null
    ]
  })
}

function ForgePane() {
  const busy = useValue($busy)
  const generated = useValue($generated)
  const mode = useValue($mode)
  const viewMode = useValue($viewMode)
  const activeSkin = forgeUseActiveSkin()

  // Pin the currently-applied theme to the top so it's always visible for
  // quick customization; the indicator dot marks it. Rest keeps its order.
  const list = (() => {
    if (!activeSkin) return generated
    const active = generated.find(e => e.name === activeSkin)
    if (!active) return generated
    return [active, ...generated.filter(e => e.name !== activeSkin)]
  })()

  const onDrop = ev => {
    ev.preventDefault()
    handleFile(ev.dataTransfer?.files?.[0])
  }

  const setViewMode = v => {
    $viewMode.set(normalizeViewMode(v))
    storageRef?.set($viewModeKey, normalizeViewMode(v))
  }

  const openCard = entry => {
    $viewMode.set('cards')
    storageRef?.set($viewModeKey, 'cards')
    $expanded.set(entry.name)
  }

  return jsxs('div', {
    'data-forge-pane': 'true',
    tabIndex: 0,
    className: 'flex h-full flex-col gap-3 overflow-hidden p-3 text-sm outline-none',
    onDragOver: ev => ev.preventDefault(),
    onDrop,
    children: [
      // Pinned escape hatch: always visible, never scrolled away, and immune
      // to the theme's own colors (hardcoded) so it works even under a
      // broken/unreadable theme.
      jsx(forgeEscapeHatch, {}, 'forge-escape'),
      jsxs('div', {
        className: 'flex min-w-0 flex-wrap items-center justify-between gap-2',
        children: [
          jsx('div', { className: 'min-w-0 truncate font-medium text-(--ui-text-primary)', children: 'Theme Forge' }),
          jsxs('div', { className: 'flex min-w-0 items-center gap-1', children: [
            jsx('div', { className: 'min-w-0', children: jsx(SegmentedControl, {
              className: 'max-w-full',
              options: [
                { id: 'cards', label: 'Cards' },
                { id: 'strip', label: 'Strip' }
              ],
              value: viewMode,
              onChange: v => setViewMode(v)
            }) }),
            jsx('div', { className: 'min-w-0', children: jsx(SegmentedControl, {
              className: 'max-w-full',
              options: [
                { id: 'dark', label: 'Dark' },
                { id: 'light', label: 'Light' }
              ],
              value: mode,
              onChange: v => $mode.set(v)
            }) })
          ] })
        ]
      }),

      jsxs('label', {
        className: cn(
          'flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-[6px] border border-dashed p-3 text-center transition-colors',
          'border-(--ui-stroke-secondary) hover:bg-(--chrome-action-hover)'
        ),
        children: [
          jsx(icons.Upload, { className: 'size-4 text-(--ui-text-tertiary)' }),
          jsx('div', { className: 'text-xs text-(--ui-text-secondary)', children: busy ? 'Forging…' : 'Drop an image here' }),
          jsx('div', { className: 'text-[0.6875rem] text-(--ui-text-tertiary)', children: 'or click to browse · click pane then ⌘V to paste' }),
          jsx('input', { type: 'file', accept: 'image/*', className: 'hidden', onChange: ev => handleFile(ev.target.files?.[0]) })
        ]
      }),

      jsxs('div', {
        className: 'flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden',
        children: [
          jsx('div', {
            className: 'min-w-0 text-[0.6875rem] font-medium uppercase tracking-wide text-(--ui-text-tertiary)',
            children: `Forged themes (${generated.length})`
          }),
          jsx(ScrollArea, {
            className: 'min-h-0 flex-1',
            children: jsx('div', {
              className: viewMode === 'strip' ? 'flex min-w-0 flex-col gap-px' : 'flex min-w-0 flex-col gap-2 pb-2',
              children: list.length
                ? list.map(entry =>
                    viewMode === 'strip'
                      ? jsx(StripRow, { entry, active: entry.name === activeSkin, onOpen: () => openCard(entry) })
                      : jsx(ThemeCard, { entry, active: entry.name === activeSkin }, entry.name)
                  )
                : jsx('div', { className: 'py-2 text-xs text-(--ui-text-tertiary)', children: 'None yet — forge one above.' })
            })
          })
        ]
      })
    ]
  })
}

// ── plugin entry ────────────────────────────────────────────────────────────

let pasteHandler = null

export default {
  id: 'theme-lab',
  name: 'Theme Forge',

  register(ctx) {
    storageRef = ctx.storage
    registerRef = ctx.register

    // One-time schema migration: v1 stored raw theme objects; v2 stores
    // { name, label, mode, swatches, theme, source } entries. v3 (sleek
    // naming) strips the auto-injected 'Forge · ' prefix from both the
    // card label and the registered theme label, so names show clean —
    // including legacy data persisted before this change.
    const migrated = ctx.storage.get('themes', []).map(e => {
      const base =
        e && !e.theme && e.colors
          ? { name: e.name, label: e.label, mode: 'dark', swatches: [], theme: e, source: null, forgedAt: Date.now() }
          : e
      if (!base || !base.theme) return base
      const label = stripForgePrefix(base.label ?? base.theme.label)
      return { ...base, label, theme: { ...base.theme, label } }
    })
    ctx.storage.set('themes', migrated)

    // Re-register every persisted theme so they survive restarts.
    for (const entry of migrated) {
      if (entry?.theme?.name && entry.theme.colors) registerTheme(entry.theme)
    }
    $generated.set(migrated)

    // Persistence bridge: write every persisted theme as a backend skin so the
    // gateway can resolve it at boot, then restore the user's saved appearance
    // once connected. The desktop hydrates the saved skin into state BEFORE
    // plugin/backend themes exist (so it snaps to default); we re-apply the
    // saved choice live via config.set after the gateway is ready.
    const persisted = migrated.filter(e => e?.theme?.name && e.theme.colors)
    persisted.forEach(e => forgeWriteBackendSkin(e.theme, e.label).catch(() => {}))
    const restoreSaved = () => {
      // Read the app's persisted skin name (localStorage; the app never
      // overwrites it on the boot snap — resolve only reads).
      let saved = null
      try {
        const profile = window.localStorage.getItem('hermes-desktop-active-profile-v1') || 'default'
        saved = (() => {
          if (profile === 'default') return window.localStorage.getItem('hermes-desktop-theme-v2')
          try {
            const rec = JSON.parse(window.localStorage.getItem('hermes-desktop-profile-themes-v1') || '{}')
            return rec[profile]
          } catch {
            return null
          }
        })()
      } catch {
        saved = null
      }
      if (!saved || !saved.startsWith('forge-')) return
      const entry = persisted.find(e => e.theme.name === saved)
      if (!entry) return
      // Ensure the backend YAML exists before the gateway resolves it, then
      // re-apply live. Awaits the write so config.set never races a rejected
      // prior boot write (which would silently fall back to default).
      forgeWriteBackendSkin(entry.theme, entry.label)
        .then(() => forgeApplyLive(entry))
        .catch(() => {})
    }
    // Re-apply once the gateway is connected (active skin is then resolvable).
    const gatewayReadyOff = host.onEvent('gateway.ready', () => {
      restoreSaved()
      gatewayReadyOff()
    })

    $viewMode.set(normalizeViewMode(ctx.storage.get($viewModeKey, 'cards')))

    ctx.register({
      id: 'pane',
      area: 'panes',
      title: 'theme forge',
      data: { placement: 'right', width: '280px', minWidth: '220px', maxWidth: '520px' },
      render: () => jsx(ForgePane, {})
    })

    ctx.register({
      id: 'palette-open',
      area: PALETTE_AREA,
      data: {
        id: 'theme-lab-open',
        label: 'Theme Forge: forge a theme from an image',
        keywords: ['theme', 'skin', 'color', 'palette', 'image'],
        run: () =>
          host.notify({ kind: 'info', message: 'Drop or paste an image into the Theme Forge pane (right side).' })
      }
    })

    // Capture-phase paste: forge image pastes aimed at the pane or plain
    // chrome; never steal pastes aimed at the chat composer.
    pasteHandler = ev => {
      const item = Array.from(ev.clipboardData?.items || []).find(i => i.type.startsWith('image/'))
      if (!item) return
      const t = ev.target
      const inPane = t instanceof Element && !!t.closest('[data-forge-pane]')
      const editable = t instanceof Element && !!t.closest('input, textarea, [contenteditable="true"]')
      if (!inPane && editable) return
      const file = item.getAsFile()
      if (file) {
        ev.preventDefault()
        ev.stopPropagation()
        handleFile(file)
      }
    }
    window.addEventListener('paste', pasteHandler, true)

    ctx.onDispose(() => {
      if (pasteHandler) window.removeEventListener('paste', pasteHandler, true)
      pasteHandler = null
      if (forgeSkinObserver) {
        forgeSkinObserver.disconnect()
        forgeSkinObserver = null
      }
      disposersBySlug.forEach(d => d())
      disposersBySlug.clear()
    })
  }
}
