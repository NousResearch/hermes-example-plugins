/**
 * skin-studio — 皮肤工坊 for Hermes Desktop.
 *
 * 复刻自 Theme Forge（https://github.com/NousResearch/hermes-example-plugins/pull/8，
 * MIT 协议），深度改造：
 *   - 全中文界面（原版为葡萄牙语）
 *   - 新增中国风主题：水墨 / 青花瓷 / 故宫 / 竹林 / 敦煌 / 汉字雨
 *   - 新增动漫风主题：EVA 初号机 / 高达 / 初音未来 / 鬼灭之刃
 *   - 汉字雨特效：中文汉字从墨夜坠落，偶见朱砂印章红（中国版数字墙）
 *
 * 技术机制沿用原版：在原生 DesktopTheme 模型之外扩展——
 *   - 扩展调色板（应用固定的 --ui-* 色标：红橙黄绿青蓝紫暖、diff 增删）
 *   - 背景图片（URL 或 data URI）+ 遮罩 + 模糊，画在玻璃外壳后面
 *   - 文字加粗等级（提升 font-weight 一至两级）
 *
 * 扩展字段随主题对象传递（应用忽略未知键），由本插件的 CSS 注入引擎读回。
 *
 * Plain ESM, loaded uncompiled — UI is jsx() calls, not JSX syntax.
 * Only these imports resolve: @hermes/plugin-sdk, react, react/jsx-runtime.
 */

import {
  Badge,
  Button,
  cn,
  host,
  Input,
  ScrollArea,
  Tabs,
  TabsList,
  TabsTrigger,
  Tip,
  PALETTE_AREA,
  THEMES_AREA,
  ROUTES_AREA,
  SIDEBAR_NAV_AREA,
  icons
} from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'
import { useEffect, useRef, useState } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// Presets — the forge ships three full themes + one editable custom theme.
// The custom theme starts as a clone of ss-cyber (the user's cyberpunk
// palette: #000 / #A8FF00 / #B026FF / #FFD700).
// ─────────────────────────────────────────────────────────────────────────────

const EMOJI = '"Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji", emoji'
const SANS =
  '"Inter", "SF Pro Text", -apple-system, BlinkMacSystemFont, system-ui, sans-serif, ' + EMOJI
const MONO = '"JetBrains Mono", "Cascadia Code", "SF Mono", ui-monospace, Menlo, Monaco, Consolas, monospace, ' + EMOJI

const FONT_URL =
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700;800&display=swap'

const SYSTEM_SANS = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif, ' + EMOJI
const SYSTEM_MONO = '"SF Mono", ui-monospace, Menlo, Monaco, Consolas, monospace, ' + EMOJI

// Font presets for the Text tab — each sets typography.fontSans/fontMono/fontUrl
// on the custom theme; applyTheme() re-applies them (and injects fontUrl) on
// every registry-bump repaint.
const FONT_PRESETS = {
  system: { label: '系统', fontSans: SYSTEM_SANS, fontMono: SYSTEM_MONO, fontUrl: null },
  inter: { label: 'Inter', fontSans: SANS, fontMono: MONO, fontUrl: FONT_URL },
  geist: {
    label: 'Geist',
    fontSans: '"Geist", "SF Pro Text", -apple-system, BlinkMacSystemFont, system-ui, sans-serif, ' + EMOJI,
    fontMono: '"Geist Mono", "SF Mono", ui-monospace, Menlo, Monaco, Consolas, monospace, ' + EMOJI,
    fontUrl: 'https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700;800&family=Geist+Mono:wght@400;500;700&display=swap'
  },
  plex: {
    label: 'Plex',
    fontSans: '"IBM Plex Sans", "SF Pro Text", -apple-system, BlinkMacSystemFont, system-ui, sans-serif, ' + EMOJI,
    fontMono: '"IBM Plex Mono", "SF Mono", ui-monospace, Menlo, Monaco, Consolas, monospace, ' + EMOJI,
    fontUrl:
      'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;700&display=swap'
  },
  grotesk: {
    label: 'Grotesk',
    fontSans: '"Space Grotesk", "SF Pro Text", -apple-system, BlinkMacSystemFont, system-ui, sans-serif, ' + EMOJI,
    fontMono: MONO,
    fontUrl:
      'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap'
  }
}

// Defaults for the Text-tab extras (merged into every theme's .forge).
const TEXT_DEFAULTS = {
  fontFamily: 'inter',
  fontSize: 13, // px base for the conversation text (app default: 13px)
  linkColor: null,
  headingColor: null,
  codeColor: null,
  backgroundVideo: null, // animated backdrop (URL/data URI/blob) — wins over backgroundImage
  // Sidebar per-element colors (null = theme default). Scoped token overrides
  // via the app's stable data-slot hooks — hover/active keep text-foreground.
  sidebarNavColor: null, // New Session · Capabilities · Messaging · Artifacts
  sidebarSectionColor: null, // group labels: Pinned, Recents, …
  sidebarItemColor: null // session + project row labels
}

const forgeCyber = {
  name: 'ss-cyber',
  label: '赛博',
  description: '纯黑底、荧光绿字、紫色镀铬、金色光环——完整赛博朋克配色',
  colors: {
    background: '#000000',
    foreground: '#A8FF00',
    card: '#060608',
    cardForeground: '#A8FF00',
    muted: '#0E0E12',
    mutedForeground: '#6D9900',
    popover: '#0A0A0D',
    popoverForeground: '#A8FF00',
    primary: '#A8FF00',
    primaryForeground: '#000000',
    secondary: '#14141A',
    secondaryForeground: '#8FCC00',
    accent: '#101018',
    accentForeground: '#BFFF00',
    border: '#2A103A',
    input: '#2A103A',
    ring: '#FFD700',
    midground: '#A8FF00',
    destructive: '#FF2E88',
    destructiveForeground: '#000000',
    sidebarBackground: '#000000',
    sidebarBorder: '#1A0828',
    userBubble: '#08080E',
    userBubbleBorder: '#2A103A'
  },
  darkColors: {
    background: '#000000',
    foreground: '#A8FF00',
    card: '#060608',
    cardForeground: '#A8FF00',
    muted: '#0E0E12',
    mutedForeground: '#6D9900',
    popover: '#0A0A0D',
    popoverForeground: '#A8FF00',
    primary: '#A8FF00',
    primaryForeground: '#000000',
    secondary: '#14141A',
    secondaryForeground: '#8FCC00',
    accent: '#101018',
    accentForeground: '#BFFF00',
    border: '#2A103A',
    input: '#2A103A',
    ring: '#FFD700',
    midground: '#A8FF00',
    destructive: '#FF2E88',
    destructiveForeground: '#000000',
    sidebarBackground: '#000000',
    sidebarBorder: '#1A0828',
    userBubble: '#08080E',
    userBubbleBorder: '#2A103A'
  },
  typography: { fontSans: SANS, fontMono: MONO, fontUrl: FONT_URL },
  forge: {
    backgroundImage: null,
    imageFit: 'cover',
    overlayOpacity: 0.15,
    blur: 0,
    boldLevel: 1,
    extraColors: {
      uiRed: '#FF2E88',
      uiOrange: '#FF8A3D',
      uiYellow: '#FFD700',
      uiGreen: '#A8FF00',
      uiCyan: '#00E5FF',
      uiBlue: '#4D7CFF',
      uiPurple: '#B026FF',
      uiWarm: '#FFD700'
    }
  }
}

const forgeGlass = {
  name: 'ss-glass',
  label: '玻璃',
  description: '冷调半透明中性色，青色点缀——玻璃质感',
  colors: {
    background: '#0B0F14',
    foreground: '#DCE6F0',
    card: '#10161D',
    cardForeground: '#DCE6F0',
    muted: '#141C25',
    mutedForeground: '#7E8EA1',
    popover: '#121A22',
    popoverForeground: '#DCE6F0',
    primary: '#DCE6F0',
    primaryForeground: '#0B0F14',
    secondary: '#1A2430',
    secondaryForeground: '#B6C4D4',
    accent: '#16202B',
    accentForeground: '#C8D6E6',
    border: '#1E2A38',
    input: '#1E2A38',
    ring: '#00C8E8',
    midground: '#00C8E8',
    destructive: '#D64545',
    destructiveForeground: '#FFF5F5',
    sidebarBackground: '#090D11',
    sidebarBorder: '#141C24',
    userBubble: '#12202B',
    userBubbleBorder: '#1E3A48'
  },
  darkColors: {
    background: '#0B0F14',
    foreground: '#DCE6F0',
    card: '#10161D',
    cardForeground: '#DCE6F0',
    muted: '#141C25',
    mutedForeground: '#7E8EA1',
    popover: '#121A22',
    popoverForeground: '#DCE6F0',
    primary: '#DCE6F0',
    primaryForeground: '#0B0F14',
    secondary: '#1A2430',
    secondaryForeground: '#B6C4D4',
    accent: '#16202B',
    accentForeground: '#C8D6E6',
    border: '#1E2A38',
    input: '#1E2A38',
    ring: '#00C8E8',
    midground: '#00C8E8',
    destructive: '#D64545',
    destructiveForeground: '#FFF5F5',
    sidebarBackground: '#090D11',
    sidebarBorder: '#141C24',
    userBubble: '#12202B',
    userBubbleBorder: '#1E3A48'
  },
  typography: { fontSans: SANS, fontMono: MONO, fontUrl: FONT_URL },
  forge: {
    backgroundImage: null,
    imageFit: 'cover',
    overlayOpacity: 0.6,
    blur: 0,
    boldLevel: 0,
    extraColors: {
      uiRed: '#E5484D',
      uiOrange: '#E58B3D',
      uiYellow: '#D9B43C',
      uiGreen: '#30A46C',
      uiCyan: '#12A594',
      uiBlue: '#0091FF',
      uiPurple: '#8E4EC6',
      uiWarm: '#C99B7A'
    }
  }
}

const forgePaper = {
  name: 'ss-paper',
  label: '纸感',
  description: '暖调纸感浅色，墨色文字与陶土色点缀',
  colors: {
    background: '#FAF6F0',
    foreground: '#23201C',
    card: '#FFFFFF',
    cardForeground: '#23201C',
    muted: '#F1EAE0',
    mutedForeground: '#7A7166',
    popover: '#FFFDF9',
    popoverForeground: '#23201C',
    primary: '#B4552D',
    primaryForeground: '#FFFFFF',
    secondary: '#F4EDE3',
    secondaryForeground: '#4A4238',
    accent: '#EFE6D8',
    accentForeground: '#3A332B',
    border: '#E4DACA',
    input: '#E4DACA',
    ring: '#B4552D',
    midground: '#B4552D',
    destructive: '#C0392B',
    destructiveForeground: '#FFF5F2',
    sidebarBackground: '#F3ECE1',
    sidebarBorder: '#E2D6C4',
    userBubble: '#F4E9DB',
    userBubbleBorder: '#E2D2BC'
  },
  darkColors: {
    background: '#141210',
    foreground: '#E8E0D4',
    card: '#1B1815',
    cardForeground: '#E8E0D4',
    muted: '#241F1B',
    mutedForeground: '#9C9184',
    popover: '#1F1B17',
    popoverForeground: '#E8E0D4',
    primary: '#D9804F',
    primaryForeground: '#1B1109',
    secondary: '#2A241E',
    secondaryForeground: '#C8BCAC',
    accent: '#262019',
    accentForeground: '#DCCFC0',
    border: '#332B23',
    input: '#332B23',
    ring: '#D9804F',
    midground: '#D9804F',
    destructive: '#D64545',
    destructiveForeground: '#FFF5F5',
    sidebarBackground: '#100E0C',
    sidebarBorder: '#241F1A',
    userBubble: '#241C15',
    userBubbleBorder: '#3A2E22'
  },
  typography: { fontSans: SANS, fontMono: MONO, fontUrl: FONT_URL },
  forge: {
    backgroundImage: null,
    imageFit: 'cover',
    overlayOpacity: 0.25,
    blur: 0,
    boldLevel: 0,
    extraColors: {
      uiRed: '#C0392B',
      uiOrange: '#D4760A',
      uiYellow: '#B58A1E',
      uiGreen: '#3E7C4F',
      uiCyan: '#3A7E8C',
      uiBlue: '#3A6EA5',
      uiPurple: '#7D5BA6',
      uiWarm: '#B4552D'
    }
  }
}

/** Matrix — pure black, phosphor green, animated digital rain background. */
const forgeMatrix = {
  name: 'ss-matrix',
  label: '数字墙',
  description: '纯黑底磷光绿，黑客帝国式纯数字墙动画背景',
  colors: {
    background: '#000000',
    foreground: '#00FF41',
    card: '#00140A',
    cardForeground: '#00FF41',
    muted: '#002A12',
    mutedForeground: '#2E8B57',
    popover: '#001A0A',
    popoverForeground: '#00FF41',
    primary: '#00FF41',
    primaryForeground: '#000000',
    secondary: '#002A12',
    secondaryForeground: '#66FF99',
    accent: '#001A0A',
    accentForeground: '#7CFFAB',
    border: '#0A3D1A',
    input: '#0A3D1A',
    ring: '#00FF41',
    midground: '#00FF41',
    destructive: '#FF2E88',
    destructiveForeground: '#000000',
    sidebarBackground: '#000000',
    sidebarBorder: '#062B12',
    userBubble: '#00140A',
    userBubbleBorder: '#0A3D1A'
  },
  darkColors: {
    background: '#000000',
    foreground: '#00FF41',
    card: '#00140A',
    cardForeground: '#00FF41',
    muted: '#002A12',
    mutedForeground: '#2E8B57',
    popover: '#001A0A',
    popoverForeground: '#00FF41',
    primary: '#00FF41',
    primaryForeground: '#000000',
    secondary: '#002A12',
    secondaryForeground: '#66FF99',
    accent: '#001A0A',
    accentForeground: '#7CFFAB',
    border: '#0A3D1A',
    input: '#0A3D1A',
    ring: '#00FF41',
    midground: '#00FF41',
    destructive: '#FF2E88',
    destructiveForeground: '#000000',
    sidebarBackground: '#000000',
    sidebarBorder: '#062B12',
    userBubble: '#00140A',
    userBubbleBorder: '#0A3D1A'
  },
  typography: { fontSans: SANS, fontMono: MONO, fontUrl: FONT_URL },
  forge: {
    backgroundImage: null,
    imageFit: 'cover',
    overlayOpacity: 0.3,
    blur: 0,
    boldLevel: 0,
    matrixRain: true,
    extraColors: {
      uiRed: '#FF2E88',
      uiOrange: '#FF8A3D',
      uiYellow: '#D4FF00',
      uiGreen: '#00FF41',
      uiCyan: '#00E5FF',
      uiBlue: '#00A8FF',
      uiPurple: '#B026FF',
      uiWarm: '#00FF41'
    }
  }
}

/** Hacker — lime terminal on black with purple chrome and gold highlights. */
const forgeHacker = {
  name: 'ss-hacker',
  label: '黑客',
  description: '荧光绿终端、紫色镀铬、金色光环——黑客风格',
  colors: {
    background: '#050505',
    foreground: '#A8FF00',
    card: '#0C0C0C',
    cardForeground: '#A8FF00',
    muted: '#121212',
    mutedForeground: '#6D9900',
    popover: '#0F0F0F',
    popoverForeground: '#A8FF00',
    primary: '#A8FF00',
    primaryForeground: '#050505',
    secondary: '#161616',
    secondaryForeground: '#8FCC00',
    accent: '#111111',
    accentForeground: '#C6FF2E',
    border: '#2A103A',
    input: '#2A103A',
    ring: '#FFD700',
    midground: '#A8FF00',
    destructive: '#FF2E88',
    destructiveForeground: '#050505',
    sidebarBackground: '#050505',
    sidebarBorder: '#1A0828',
    userBubble: '#0A0A0A',
    userBubbleBorder: '#2A103A'
  },
  darkColors: {
    background: '#050505',
    foreground: '#A8FF00',
    card: '#0C0C0C',
    cardForeground: '#A8FF00',
    muted: '#121212',
    mutedForeground: '#6D9900',
    popover: '#0F0F0F',
    popoverForeground: '#A8FF00',
    primary: '#A8FF00',
    primaryForeground: '#050505',
    secondary: '#161616',
    secondaryForeground: '#8FCC00',
    accent: '#111111',
    accentForeground: '#C6FF2E',
    border: '#2A103A',
    input: '#2A103A',
    ring: '#FFD700',
    midground: '#A8FF00',
    destructive: '#FF2E88',
    destructiveForeground: '#050505',
    sidebarBackground: '#050505',
    sidebarBorder: '#1A0828',
    userBubble: '#0A0A0A',
    userBubbleBorder: '#2A103A'
  },
  typography: { fontSans: SANS, fontMono: MONO, fontUrl: FONT_URL },
  forge: {
    backgroundImage: null,
    imageFit: 'cover',
    overlayOpacity: 0.4,
    blur: 0,
    boldLevel: 1,
    scanlines: true,
    extraColors: {
      uiRed: '#FF2E88',
      uiOrange: '#FF8A3D',
      uiYellow: '#FFD700',
      uiGreen: '#A8FF00',
      uiCyan: '#00E5FF',
      uiBlue: '#4D7CFF',
      uiPurple: '#B026FF',
      uiWarm: '#FFD700'
    }
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// Small color helpers (same math family as the app's themes/color.ts).
// ─────────────────────────────────────────────────────────────────────────────

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function readableOn(hex) {
  const rgb = hexToRgb(hex)
  if (!rgb) return '#FFFFFF'
  const [r, g, b] = rgb.map(v => v / 255)
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return lum > 0.5 ? '#000000' : '#FFFFFF'
}

function mix(hexA, hexB, t) {
  const a = hexToRgb(hexA)
  const b = hexToRgb(hexB)
  if (!a || !b) return hexA
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * t))
  return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('')
}

// ─────────────────────────────────────────────────────────────────────────────
// 自动配色引擎 — 从图片提取主色板（中位切分），或从配色模板生成整套主题。
// ─────────────────────────────────────────────────────────────────────────────

function rgbToHex(r, g, b) {
  const c = [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))))
  return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('')
}

function colorLum(hex) {
  const rgb = hexToRgb(hex)
  if (!rgb) return 0
  const [r, g, b] = rgb.map(v => v / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function colorSat(hex) {
  const rgb = hexToRgb(hex)
  if (!rgb) return 0
  const [r, g, b] = rgb.map(v => v / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return 0
  const d = max - min
  return l > 0.5 ? d / (2 - max - min) : d / (max + min)
}

function hexToHsl(hex) {
  const rgb = hexToRgb(hex)
  if (!rgb) return { h: 0, s: 0, l: 0 }
  const [r, g, b] = rgb.map(v => v / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else h = ((r - g) / d + 4) / 6
  return { h: h * 360, s, l }
}

function hslToHex(h, s, l) {
  const hue = ((h % 360) + 360) % 360 / 360
  let r, g, b
  if (s === 0) {
    r = g = b = l
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1
      if (t > 1) t -= 1
      if (t < 1 / 6) return p + (q - p) * 6 * t
      if (t < 1 / 2) return q
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
      return p
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    r = hue2rgb(p, q, hue + 1 / 3)
    g = hue2rgb(p, q, hue)
    b = hue2rgb(p, q, hue - 1 / 3)
  }
  return rgbToHex(r * 255, g * 255, b * 255)
}

// 色相旋转（保持饱和度/亮度）——用于从强调色生成和谐扩展色板。
function hueShift(hex, deg) {
  const { h, s, l } = hexToHsl(hex)
  return hslToHex(h + deg, s, l)
}

// 中位切分（median cut）：递归按 RGB 范围最大的通道对半分，取桶内平均色。
function medianCut(pixels, depth) {
  if (depth === 0 || pixels.length < 8) {
    const n = pixels.length
    const sum = pixels.reduce((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]], [0, 0, 0])
    return [[Math.round(sum[0] / n), Math.round(sum[1] / n), Math.round(sum[2] / n)]]
  }
  let chan = 0
  let maxRange = -1
  for (let c = 0; c < 3; c++) {
    let lo = 255, hi = 0
    for (const p of pixels) {
      if (p[c] < lo) lo = p[c]
      if (p[c] > hi) hi = p[c]
    }
    const range = hi - lo
    if (range > maxRange) {
      maxRange = range
      chan = c
    }
  }
  if (maxRange < 24) {
    const n = pixels.length
    const sum = pixels.reduce((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]], [0, 0, 0])
    return [[Math.round(sum[0] / n), Math.round(sum[1] / n), Math.round(sum[2] / n)]]
  }
  const sorted = [...pixels].sort((a, b) => a[chan] - b[chan])
  const mid = Math.floor(sorted.length / 2)
  return [...medianCut(sorted.slice(0, mid), depth - 1), ...medianCut(sorted.slice(mid), depth - 1)]
}

// 从图片（URL / data URI）提取主色板（最多 8 色）。
function extractPaletteFromImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const size = 48
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, size, size)
        const { data } = ctx.getImageData(0, 0, size, size)
        const pixels = []
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 128) continue
          pixels.push([data[i], data[i + 1], data[i + 2]])
        }
        if (pixels.length < 32) {
          reject(new Error('图片像素不足'))
          return
        }
        const sample =
          pixels.length > 5000 ? pixels.filter(() => Math.random() < 5000 / pixels.length) : pixels
        const sw = medianCut(sample, 3)
        resolve(sw.map(([r, g, b]) => rgbToHex(r, g, b)))
      } catch (e) {
        reject(e)
      }
    }
    img.onerror = () => reject(new Error('图片加载失败（跨域图片可能无法取色，请用本地图片）'))
    img.src = src
  })
}

// WCAG 对比度（用于可读性保证）。
function contrastRatio(hexA, hexB) {
  const la = colorLum(hexA)
  const lb = colorLum(hexB)
  const hi = Math.max(la, lb)
  const lo = Math.min(la, lb)
  return (hi + 0.05) / (lo + 0.05)
}

// 从主色板生成整套主题配色（背景取最暗、文字取最亮、强调取最鲜艳）。
function themeFromPalette(hexes) {
  const cs = (hexes || []).filter(h => hexToRgb(h))
  if (cs.length < 2) return null
  const byLum = [...cs].sort((a, b) => colorLum(a) - colorLum(b))
  const bySat = [...cs].sort((a, b) => colorSat(b) - colorSat(a))
  let bg = byLum[0]
  let fg = byLum[byLum.length - 1]
  let accent = bySat[0]
  // 可读性保护：太亮的背景压暗、太暗的文字提亮、灰扑扑的强调色提饱和。
  if (colorLum(bg) > 0.3) bg = mix(bg, '#000000', 0.5)
  if (colorLum(fg) < 0.35) fg = mix(fg, '#FFFFFF', 0.75)
  if (colorSat(accent) < 0.35) {
    // 强调色饱和度不足（灰图/白图）：以文字色相为基础生成鲜艳强调色，
    // 完全无色相时默认用暖橙（避免白色/灰色 accent 毫无存在感）。
    const { h } = hexToHsl(fg)
    accent = hslToHex(h > 0 ? h : 25, 0.65, 0.55)
  }
  if (colorLum(accent) < 0.35) {
    // HSL 提亮而非混白——保持色相与饱和度（避免暗红变粉）。
    const { h, s, l } = hexToHsl(accent)
    accent = hslToHex(h, s, Math.min(l + 0.18, 0.72))
  }
  // 对比度迭代保证：正文与背景 WCAG 对比度 >= 4.5（看不清的核心修复）。
  let guard = 0
  while (contrastRatio(fg, bg) < 4.5 && guard++ < 10) {
    if (colorLum(fg) < 0.55) fg = mix(fg, '#FFFFFF', 0.3)
    else bg = mix(bg, '#000000', 0.25)
  }
  // mutedForeground（次要文字）对比度保证 >= 3，并降低饱和度保持中性灰调
  //（避免 fg 是荧光色时次要文字也跟着变色，影响协调）。
  let mutedFg = mix(fg, bg, 0.42)
  {
    const { h, s, l } = hexToHsl(mutedFg)
    mutedFg = hslToHex(h, s * 0.3, l)
  }
  guard = 0
  while (contrastRatio(mutedFg, bg) < 3 && guard++ < 8) {
    mutedFg = mix(mutedFg, fg, 0.3)
  }
  const border = mix(bg, accent, 0.28)
  const destructive = mix('#C0392B', accent, 0.25)
  const colors = {
    background: bg,
    foreground: fg,
    card: mix(bg, fg, 0.05),
    cardForeground: fg,
    muted: mix(bg, fg, 0.08),
    mutedForeground: mutedFg,
    popover: mix(bg, fg, 0.04),
    popoverForeground: fg,
    primary: accent,
    primaryForeground: readableOn(accent),
    secondary: mix(bg, accent, 0.16),
    secondaryForeground: fg,
    accent: mix(bg, accent, 0.12),
    accentForeground: fg,
    border,
    input: border,
    ring: accent,
    midground: accent,
    destructive,
    destructiveForeground: readableOn(destructive),
    sidebarBackground: bg,
    sidebarBorder: mix(bg, fg, 0.12),
    userBubble: mix(bg, accent, 0.1),
    userBubbleBorder: border
  }
  // 扩展色板（语法高亮/状态色）：使用标准色相轮的绝对色相——语义永远正确
  //（uiRed 是红色、uiGreen 是绿色），统一饱和/亮度保证在暗背景上清晰、
  // 整体协调（修「代码黑字看不清」+ 配色协调性）。
  const extraColors = {
    uiRed: hslToHex(0, 0.65, 0.6),
    uiOrange: hslToHex(30, 0.65, 0.6),
    uiYellow: hslToHex(55, 0.65, 0.6),
    uiGreen: hslToHex(140, 0.65, 0.6),
    uiCyan: hslToHex(185, 0.65, 0.6),
    uiBlue: hslToHex(220, 0.65, 0.6),
    uiPurple: hslToHex(275, 0.65, 0.6),
    uiWarm: hslToHex(25, 0.65, 0.6)
  }
  // Markdown 强调色自动生成：代码文字比正文略亮（保证代码块可读），
  // 链接用强调色，标题用带强调色调的亮色——开箱即用，无需手动调。
  const forge = {
    extraColors,
    codeColor: mix(fg, '#FFFFFF', 0.2),
    linkColor: accent,
    headingColor: mix(fg, accent, 0.25)
  }
  return { colors, darkColors: colors, forge }
}

// ─────────────────────────────────────────────────────────────────────────────
// Film-inspired presets — generated from a 6-color palette so every theme has
// the full DesktopTheme shape the app expects (dark + light derived).
// ─────────────────────────────────────────────────────────────────────────────

function filmTheme({ name, label, description, bg, fg, accent, border, destructive, mutedFg, extraColors, boldLevel = 1, overlayOpacity = 0.3, scanlines, matrixRain, hanziRain }) {
  const dark = {
    background: bg,
    foreground: fg,
    card: mix(bg, fg, 0.05),
    cardForeground: fg,
    muted: mix(bg, fg, 0.08),
    mutedForeground: mutedFg || mix(fg, bg, 0.35),
    popover: mix(bg, fg, 0.04),
    popoverForeground: fg,
    primary: accent,
    primaryForeground: readableOn(accent),
    secondary: mix(bg, accent, 0.16),
    secondaryForeground: fg,
    accent: mix(bg, accent, 0.12),
    accentForeground: fg,
    border,
    input: border,
    ring: accent,
    midground: accent,
    destructive,
    destructiveForeground: readableOn(destructive),
    sidebarBackground: bg,
    sidebarBorder: mix(bg, fg, 0.12),
    userBubble: mix(bg, accent, 0.1),
    userBubbleBorder: border
  }
  const forge = {
    backgroundImage: null,
    imageFit: 'cover',
    overlayOpacity,
    blur: 0,
    boldLevel,
    extraColors: extraColors || {}
  }
  if (scanlines) forge.scanlines = true
  if (matrixRain) forge.matrixRain = true
  if (hanziRain) forge.hanziRain = true
  return {
    name,
    label,
    description,
    colors: dark,
    darkColors: dark,
    typography: { fontSans: SANS, fontMono: MONO, fontUrl: FONT_URL },
    forge
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 中国风主题 — 水墨、青花瓷、故宫、竹林、敦煌、汉字雨
// ─────────────────────────────────────────────────────────────────────────────

/** 水墨 — 宣纸白 + 墨色 + 朱砂印章红，文人画意境。 */
const ssInk = filmTheme({
  name: 'ss-ink',
  label: '水墨',
  description: '宣纸白与墨色，朱砂印章点睛——文人画意境',
  bg: '#0D0C0A',
  fg: '#E8E2D5',
  accent: '#B0342A',
  border: '#2A251C',
  destructive: '#8A2A22',
  mutedFg: '#8F8778',
  boldLevel: 1,
  overlayOpacity: 0.25,
  extraColors: { uiRed: '#B0342A', uiWarm: '#C9A86A', uiGreen: '#4A6B4A', uiBlue: '#3A5A7A', uiYellow: '#B08D2E', uiCyan: '#4A6A6A', uiPurple: '#6E5A8E', uiOrange: '#A86A3A' }
})

/** 青花瓷 — 釉白 + 钴蓝，克制典雅的东方美学。 */
const ssQinghua = filmTheme({
  name: 'ss-qinghua',
  label: '青花瓷',
  description: '釉白与钴蓝——青花瓷的东方典雅',
  bg: '#0A0F16',
  fg: '#DCE6EE',
  accent: '#33779E',
  border: '#1E3A52',
  destructive: '#8A3A2E',
  mutedFg: '#7E8E9E',
  boldLevel: 1,
  overlayOpacity: 0.25,
  extraColors: { uiBlue: '#33779E', uiCyan: '#2E8CA8', uiGreen: '#2E7A6A', uiRed: '#B0342A', uiYellow: '#B08D2E', uiOrange: '#C77B2F', uiPurple: '#6A5A8E', uiWarm: '#8E9AA8' }
})

/** 故宫 — 宫墙红 + 琉璃金，皇家气派。 */
const ssGugong = filmTheme({
  name: 'ss-gugong',
  label: '故宫',
  description: '宫墙红与琉璃金——紫禁城的皇家气派',
  bg: '#140B0A',
  fg: '#F0E4D0',
  accent: '#B03A2E',
  border: '#4A2A1E',
  destructive: '#7A1E14',
  mutedFg: '#A8977E',
  boldLevel: 1,
  overlayOpacity: 0.25,
  extraColors: { uiRed: '#B03A2E', uiYellow: '#D4A017', uiOrange: '#C77B2F', uiWarm: '#D4A017', uiGreen: '#4A6B4A', uiCyan: '#4A6A8A', uiBlue: '#3A5A7A', uiPurple: '#7A4A6A' }
})

/** 竹林 — 竹青 + 墨绿，清雅空灵。 */
const ssBamboo = filmTheme({
  name: 'ss-bamboo',
  label: '竹林',
  description: '竹青与墨绿——七贤竹林之清雅',
  bg: '#0A0F0C',
  fg: '#DCE8DA',
  accent: '#4A8C5C',
  border: '#1E3A28',
  destructive: '#8A3A2E',
  mutedFg: '#7E9A86',
  boldLevel: 1,
  overlayOpacity: 0.25,
  extraColors: { uiGreen: '#4A8C5C', uiCyan: '#3E7A6A', uiBlue: '#3A5A7A', uiRed: '#B0413E', uiYellow: '#B08D2E', uiOrange: '#A86A3A', uiPurple: '#6E5A8E', uiWarm: '#8A9A6A' }
})

/** 敦煌 — 沙金 + 壁画赭石，丝路色彩。 */
const ssDunhuang = filmTheme({
  name: 'ss-dunhuang',
  label: '敦煌',
  description: '沙金与壁画赭石——丝路石窟的千年色彩',
  bg: '#140E08',
  fg: '#E8DCC0',
  accent: '#C77B2F',
  border: '#4A3520',
  destructive: '#8A2E2E',
  mutedFg: '#A89778',
  boldLevel: 1,
  overlayOpacity: 0.25,
  extraColors: { uiOrange: '#C77B2F', uiYellow: '#D9A441', uiWarm: '#D9A441', uiRed: '#B0413E', uiGreen: '#7A8B3E', uiBlue: '#5A6E8C', uiCyan: '#4A7A7A', uiPurple: '#8E6A4E' }
})

/** 汉字雨 — 墨色宣纸 + 印章红，汉字从天而降（中国版 Matrix）。 */
const ssHanziRain = filmTheme({
  name: 'ss-hanzi-rain',
  label: '汉字雨',
  description: '墨黑宣纸上汉字飘落，偶见朱砂印章红——中国版数字墙',
  bg: '#0B0A08',
  fg: '#F5F1E8',
  accent: '#C0392B',
  border: '#2A251C',
  destructive: '#8A2A22',
  mutedFg: '#9A927E',
  boldLevel: 1,
  overlayOpacity: 0.15,
  matrixRain: true,
  hanziRain: true,
  // 汉字雨专属参数：繁体大字、无媒体时慢速飘落（预设值，可在自定义主题中调节）。
  rainFontSize: 26,
  rainSpeed: 0.3,
  extraColors: { uiRed: '#C0392B', uiWarm: '#B08D2E', uiGreen: '#4A6B4A', uiBlue: '#3A5A7A', uiYellow: '#B08D2E', uiCyan: '#4A6A6A', uiPurple: '#6E5A8E', uiOrange: '#A86A3A' }
})

// ─────────────────────────────────────────────────────────────────────────────
// 动漫风主题 — EVA、高达、初音未来、鬼灭之刃（调色板灵感致敬，无官方关联）
// ─────────────────────────────────────────────────────────────────────────────

/** EVA 初号机 — 深紫 + 荧光绿，新世纪福音战士。 */
const ssEva = filmTheme({
  name: 'ss-eva',
  label: 'EVA 初号机',
  description: '初号机紫与荧光绿——新世纪福音战士配色',
  bg: '#0A0A14',
  fg: '#E8E8F0',
  accent: '#00E56A',
  border: '#2E2450',
  destructive: '#E53935',
  mutedFg: '#8A8A9E',
  boldLevel: 2,
  overlayOpacity: 0.3,
  extraColors: { uiPurple: '#7B2FBE', uiGreen: '#00E56A', uiCyan: '#00E5FF', uiRed: '#E53935', uiBlue: '#4D7CFF', uiYellow: '#FFD700', uiOrange: '#FF8A3D', uiWarm: '#00E56A' }
})

/** 高达 — RX-78 白蓝红，机动战士高达。 */
const ssGundam = filmTheme({
  name: 'ss-gundam',
  label: '高达',
  description: 'RX-78 白蓝红三色——机动战士高达',
  bg: '#0E1116',
  fg: '#E8ECF0',
  accent: '#1E6BB8',
  border: '#2A3542',
  destructive: '#D64545',
  mutedFg: '#8A94A0',
  boldLevel: 1,
  overlayOpacity: 0.3,
  extraColors: { uiBlue: '#1E6BB8', uiRed: '#D64545', uiYellow: '#E8C93D', uiGreen: '#30A46C', uiCyan: '#4DD0E1', uiOrange: '#FF8A3D', uiPurple: '#8E4EC6', uiWarm: '#E8C93D' }
})

/** 初音未来 — 青绿双马尾，VOCALOID 代表色。 */
const ssMiku = filmTheme({
  name: 'ss-miku',
  label: '初音未来',
  description: '初音青绿——VOCALOID 的代表色',
  bg: '#0A0E12',
  fg: '#E8F0EE',
  accent: '#39C5BB',
  border: '#1E3A3A',
  destructive: '#E53935',
  mutedFg: '#7E9A96',
  boldLevel: 1,
  overlayOpacity: 0.25,
  extraColors: { uiCyan: '#39C5BB', uiGreen: '#2ECC71', uiBlue: '#4D7CFF', uiRed: '#E53935', uiYellow: '#E8C93D', uiOrange: '#FF8A3D', uiPurple: '#8E4EC6', uiWarm: '#39C5BB' }
})

/** 鬼灭之刃 — 炭治郎黑绿格纹 + 日轮刀红。 */
const ssKimetsu = filmTheme({
  name: 'ss-kimetsu',
  label: '鬼灭之刃',
  description: '炭治郎黑绿格纹与日轮刀红——鬼灭之刃',
  bg: '#0B0D0A',
  fg: '#E8ECE0',
  accent: '#C0392B',
  border: '#26301E',
  destructive: '#8A1E1E',
  mutedFg: '#8A9684',
  boldLevel: 1,
  overlayOpacity: 0.3,
  extraColors: { uiGreen: '#2E8B57', uiRed: '#C0392B', uiWarm: '#8A7A5A', uiYellow: '#B08D2E', uiBlue: '#3A5A7A', uiCyan: '#4A7A6A', uiOrange: '#A86A3A', uiPurple: '#6E5A8E' }
})

// ─────────────────────────────────────────────────────────────────────────────
// The forge state: the editable custom theme + its extras. Persisted as JSON
// in ctx.storage (namespace hermes.plugin.skin-studio.*).
// ─────────────────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'ss-custom-v1'
// The wallpaper data URI lives in its OWN storage key so a large image can
// never block the theme save (blur/overlay/colors are small and always
// persist). Before, the whole theme — image included — went into one JSON:
// a big data URI blew the localStorage quota and the ENTIRE save failed
// silently, so slider tweaks rolled back on every reload.
const STORAGE_IMG_KEY = 'ss-custom-img-v1'
// 本地视频改存 IndexedDB（容量可达 GB 级，不再受 localStorage 3.5MB 限制）。
// 主题 JSON 里只存 videoId 标记，启动时从 IDB 读回 blob → objectURL。
const STORAGE_VIDEO_ID_KEY = 'ss-video-id'
// 视频媒体库：IndexedDB 存视频本体，localStorage 只存元数据列表
//（[{id, name, size, date}]），最多保留 VIDEO_LIB_MAX 个，超出自动清理最旧。
const STORAGE_VIDEO_LIB_KEY = 'ss-video-lib'
const VIDEO_LIB_MAX = 5
const IDB_NAME = 'skin-studio-media'
const IDB_STORE = 'videos'
// 全局特效配置（独立于主题的「特效层」）：mode = auto(跟随主题) /
// none(关闭) / matrix(数字墙) / hanzi(汉字雨)；rainFontSize / rainSpeed
// 为 null 时跟随主题默认。可与任意配色主题搭配使用。
const STORAGE_FX_KEY = 'ss-fx-v1'

function readVideoLib() {
  try {
    const raw = storage?.get(STORAGE_VIDEO_LIB_KEY, null)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

function writeVideoLib(lib) {
  storage?.set(STORAGE_VIDEO_LIB_KEY, JSON.stringify(lib.slice(0, VIDEO_LIB_MAX)))
}

// ── 全局特效层（独立于主题，可与任意配色搭配）──
function loadFxGlobal() {
  try {
    const raw = storage?.get(STORAGE_FX_KEY, null)
    const o = raw ? JSON.parse(raw) : {}
    return {
      mode: ['auto', 'none', 'matrix', 'hanzi'].includes(o.mode) ? o.mode : 'auto',
      rainFontSize: Number(o.rainFontSize) || null,
      rainSpeed: Number(o.rainSpeed) || null,
      scanlines: ['on', 'off'].includes(o.scanlines) ? o.scanlines : 'auto'
    }
  } catch {
    return { mode: 'auto', rainFontSize: null, rainSpeed: null, scanlines: 'auto' }
  }
}

function saveFxGlobal(fx) {
  storage?.set(STORAGE_FX_KEY, JSON.stringify(fx))
}

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) {
        req.result.createObjectStore(IDB_STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbPut(key, blob) {
  const db = await idbOpen()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite')
    tx.objectStore(IDB_STORE).put(blob, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function idbGet(key) {
  const db = await idbOpen()
  return new Promise((resolve, reject) => {
    const req = db.transaction(IDB_STORE).objectStore(IDB_STORE).get(key)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbDel(key) {
  const db = await idbOpen()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite')
    tx.objectStore(IDB_STORE).delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

// 请求持久化存储（IndexedDB 默认为「尽力而为」模式，配额小且可能被系统
// 清理；persist() 后数据稳定保留，配额也大幅放宽）。
async function ensurePersistentStorage() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      await navigator.storage.persist()
    }
  } catch {
    // 非致命：尽力而为模式下仍可写入，只是配额较小。
  }
}

// 查询当前存储配额与使用量（供诊断显示）。
async function storageEstimate() {
  try {
    if (!navigator.storage || !navigator.storage.estimate) return null
    const e = await navigator.storage.estimate()
    return { usage: e.usage, quota: e.quota }
  } catch {
    return null
  }
}

const PRESETS = [forgeCyber, forgeGlass, forgePaper, forgeMatrix, forgeHacker, ssInk, ssQinghua, ssGugong, ssBamboo, ssDunhuang, ssHanziRain, ssEva, ssGundam, ssMiku, ssKimetsu]
const CUSTOM_NAME = 'ss-custom'

let storage = null // injected from register(ctx)
let themeMap = new Map() // name -> theme object (with .forge extras)
let customTheme = null // live-editable custom theme
let customDisposer = null // registry disposer for the custom theme contribution

function defaultCustom() {
  const base = JSON.parse(JSON.stringify(forgeCyber))
  return {
    ...base,
    name: CUSTOM_NAME,
    label: '皮肤工坊 · 自定义',
    description: '可编辑主题——在皮肤工坊面板中调整',
    forge: { ...TEXT_DEFAULTS, ...base.forge }
  }
}

function loadCustom() {
  try {
    const raw = storage?.get(STORAGE_KEY, null)
    if (!raw) return defaultCustom()
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && parsed.colors && parsed.forge) {
      const base = defaultCustom()
      const forge = { ...TEXT_DEFAULTS, ...base.forge, ...(parsed.forge || {}) }
      // blob: URLs die with the session that minted them. 有 localVideoId 标记的
      // 说明视频存在 IndexedDB，restoreLocalVideo() 会异步读回（这里先清空）；
      // 没有标记的旧 blob 是死引用，直接清。
      if (typeof forge.backgroundVideo === 'string' && forge.backgroundVideo.startsWith('blob:')) {
        if (!forge.localVideoId) forge.backgroundVideo = null
      }
      // Wallpaper data URI from its dedicated key (large images live there so
      // they can't block the theme save). Older saves carry the data URI
      // inline in forge.backgroundImage — migrate it to the dedicated key.
      const imgKey = storage?.get(STORAGE_IMG_KEY, null)
      const inline = typeof forge.backgroundImage === 'string' && forge.backgroundImage.startsWith('data:')
      if (typeof imgKey === 'string' && imgKey.startsWith('data:')) {
        forge.backgroundImage = imgKey
      } else if (inline) {
        // keep as-is; next saveCustom() migrates it out of the theme JSON
      }
      return {
        ...base,
        ...parsed,
        forge
      }
    }
    return defaultCustom()
  } catch {
    return defaultCustom()
  }
}

let saveWarned = false

// 安全通知：模块级函数里 host 是 SDK 导入（组件/函数里若有局部变量
// 也叫 host 会遮蔽它，导致 host.notify 不是函数——统一走这里）。
function notifyUser(msg) {
  try {
    host.notify(msg)
  } catch {
    // 通知失败不影响功能
  }
}

// 启动时从 IndexedDB 恢复本地视频（大视频持久化的关键一步）。
// 完成后通过全局事件通知面板组件同步 state（否则面板的防抖保存会用
// 无视频的旧 state 覆盖掉刚恢复的视频）。
async function restoreLocalVideo() {
  try {
    const vid = storage?.get(STORAGE_VIDEO_ID_KEY, null)
    if (!vid || !customTheme) return
    const blob = await idbGet(vid)
    if (blob) {
      const url = URL.createObjectURL(blob)
      customTheme.forge.backgroundVideo = url
      customTheme.forge.localVideoId = vid
      publishCustom()
      const entry = readVideoLib().find(e => e.id === vid)
      document.dispatchEvent(
        new CustomEvent('skin-studio:video-restored', {
          detail: { url, id: vid, name: entry ? entry.name : '视频', size: entry ? entry.size : blob.size }
        })
      )
    } else {
      // IDB 记录丢失（数据库被清）——清理标记，避免死引用。
      storage?.remove(STORAGE_VIDEO_ID_KEY)
      if (customTheme.forge.localVideoId) {
        customTheme.forge.localVideoId = null
        customTheme.forge.backgroundVideo = null
        publishCustom()
      }
    }
  } catch {
    // 静默失败：主题本身仍可用，只是视频回到未设置状态。
  }
}

function saveCustom() {
  // Split the payload: the theme (colors, blur, overlay, text) saves ALWAYS —
  // a big wallpaper data URI must never be able to roll back slider tweaks.
  // The image goes to its own key; if IT overflows, only the image is lost.
  // blob: 视频 URL 不写进 localStorage（会话级引用，重启失效）——
  // 视频本体存在 IndexedDB，restoreLocalVideo() 负责恢复。
  const forge = customTheme.forge || {}
  const inlineImg = forge.backgroundImage
  const isData = typeof inlineImg === 'string' && inlineImg.startsWith('data:')
  const isBlobVideo =
    typeof forge.backgroundVideo === 'string' && forge.backgroundVideo.startsWith('blob:')
  const themeForSave = isData || isBlobVideo
    ? {
        ...customTheme,
        forge: {
          ...forge,
          backgroundImage: isData ? null : forge.backgroundImage,
          backgroundVideo: isBlobVideo ? null : forge.backgroundVideo
        }
      }
    : customTheme
  try {
    storage?.set(STORAGE_KEY, JSON.stringify(themeForSave))
    saveWarned = false
  } catch {
    if (!saveWarned && typeof host !== 'undefined') {
      saveWarned = true
      host.notify({
        kind: 'error',
        message: '主题保存失败（存储空间已满）。' // pragma: no cover
      })
    }
  }
  try {
    if (isData) storage?.set(STORAGE_IMG_KEY, inlineImg)
    else if (!forge.backgroundImage) storage?.remove(STORAGE_IMG_KEY)
  } catch {
    // Only the wallpaper is lost on reload — theme tweaks are already safe.
    if (!saveWarned && typeof host !== 'undefined') {
      saveWarned = true
      host.notify({
        kind: 'error',
        message: '背景图片超出存储容量——请用更小的文件或粘贴 URL。'
      })
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CSS injection engine.
//
// The app's applyTheme() paints --theme-* / --dt-* seeds + data-hermes-theme
// on <html>. We watch those attributes (same technique as the app's own
// onThemeRepaint) and, when the active theme is one of ours, mount a <style>
// that:
//   - paints the background image behind the shell (body::before) with an
//     overlay (body::after) and re-tints the shell surfaces translucent via
//     color-mix so the image shows through the glass;
//   - overrides the app's fixed --ui-* accent palette with our extra colors;
//   - bumps font-weight per the bold level.
// ─────────────────────────────────────────────────────────────────────────────

const OBSERVED_ATTRS = ['data-hermes-theme', 'data-hermes-mode', 'class', 'style']
const CSS_ID = 'skin-studio-css'
let observer = null
let codePaintRaf = null
let prevHtmlBg = null

function buildCss(theme) {
  // resolveFx：全局特效层（数字墙/汉字雨/关闭）会影响玻璃透明度判断，
  // 所以这里也要合并，而不是只看主题自带 forge。
  const f = resolveFx(theme)
  const extra = f.extraColors || {}
  const hasMedia = Boolean(f.backgroundImage || f.backgroundVideo)
  const fxOnly = Boolean(f.matrixRain || f.scanlines) && !hasMedia
  const glassy = hasMedia || fxOnly
  const dark = (document.documentElement.dataset.hermesMode || 'dark') !== 'light'
  // With a wallpaper/video the backdrop must DOMINATE the default chrome —
  // keep the glass tint low so the media actually REPLACES the app's default
  // background instead of reading as a faint layer under it. Without media
  // (rain/scanlines only) keep the darker glass so the FX reads on a dark
  // canvas. No backdrop at all → opaque default surfaces.
  let chromeMix, sidebarMix, editorMix, elevatedMix
  if (hasMedia) {
    // Media present → it must DOMINATE the content area, but the sidebar stays
    // a clearly distinct panel (classic glass hierarchy): wallpaper in the
    // middle, darker sidebar, so the app keeps its division of areas.
    // elevated（浮层：代码围栏/命令面板/弹层）保持较高不透明度——
    // 太透明会让壁纸穿透代码块和命令面板（可读性杀手）。
    chromeMix = dark ? '16%' : '48%'
    sidebarMix = dark ? '60%' : '78%'
    editorMix = dark ? '10%' : '34%'
    elevatedMix = dark ? '55%' : '68%'
  } else if (fxOnly) {
    // 只有特效（雨/扫描线）没有媒体：玻璃高度透明——雨在玻璃后依然
    // 清晰可见（这是无背景图时看雨的关键）；背景显示主题纯色，
    // 可读性反而更好（对比更强）。
    chromeMix = dark ? '12%' : '60%'
    sidebarMix = dark ? '40%' : '78%'
    editorMix = dark ? '8%' : '40%'
    elevatedMix = dark ? '50%' : '70%'
  } else {
    chromeMix = sidebarMix = editorMix = elevatedMix = '100%'
  }

  const lines = []
  lines.push(`html[data-hermes-theme="${theme.name}"] { background: transparent; }`)

  // NOTE: the background image itself is painted directly on <body> from
  // applyForge() (inline style wins over the app's body background) — not via
  // a body::before pseudo, which would sit *behind* the app's body paint.
  // The overlay is a div inside the FX container (see startFx).

  lines.push(
    `html[data-hermes-theme="${theme.name}"] {`,
    `  --ui-bg-chrome: color-mix(in srgb, var(--theme-background-seed) ${chromeMix}, transparent);`,
    `  --ui-bg-sidebar: color-mix(in srgb, var(--theme-sidebar-seed) ${sidebarMix}, transparent);`,
    `  --ui-bg-editor: color-mix(in srgb, var(--theme-card-seed) ${editorMix}, transparent);`,
    `  --ui-bg-elevated: color-mix(in srgb, var(--theme-elevated-seed) ${elevatedMix}, transparent);`,
    `}`
  )

  // Extended palette — the app's fixed --ui-* accents.
  const extraVars = {
    uiRed: '--ui-red',
    uiOrange: '--ui-orange',
    uiYellow: '--ui-yellow',
    uiGreen: '--ui-green',
    uiCyan: '--ui-cyan',
    uiBlue: '--ui-blue',
    uiPurple: '--ui-purple',
    uiWarm: '--ui-warm',
    diffAdd: '--ui-diff-add-border',
    diffAddBg: '--ui-diff-add-background',
    diffAddFg: '--ui-diff-add-foreground',
    diffRemove: '--ui-diff-remove-border',
    diffRemoveBg: '--ui-diff-remove-background',
    diffRemoveFg: '--ui-diff-remove-foreground'
  }
  const setExtra = Object.entries(extra).filter(([k]) => extraVars[k])
  if (setExtra.length > 0) {
    lines.push(`html[data-hermes-theme="${theme.name}"] {`)
    for (const [k, v] of setExtra) lines.push(`  ${extraVars[k]}: ${v};`)
    lines.push(`}`)
  }

  // Bold level: bump one or two steps on elements that already carry a weight.
  const bold = Number(f.boldLevel) || 0
  if (bold === 1) {
    lines.push(
      `html[data-tf-bold="1"] .font-medium { font-weight: 600; }`,
      `html[data-tf-bold="1"] .font-semibold { font-weight: 700; }`,
      `html[data-tf-bold="1"] .font-bold { font-weight: 800; }`
    )
  } else if (bold === 2) {
    lines.push(
      `html[data-tf-bold="2"] .font-medium { font-weight: 600; }`,
      `html[data-tf-bold="2"] .font-semibold { font-weight: 700; }`,
      `html[data-tf-bold="2"] .font-bold { font-weight: 800; }`,
      `html[data-tf-bold="2"] body { font-weight: 450; }`
    )
  }

  // Conversation text size — override the app's --conversation-* tokens.
  const fontSize = Number(f.fontSize) || 13
  if (fontSize !== 13) {
    const rem = (fontSize / 16).toFixed(4)
    const lineRem = ((fontSize * 1.3846) / 16).toFixed(4) // app line-height ratio
    lines.push(
      `html[data-hermes-theme="${theme.name}"] {`,
      `  --conversation-text-font-size: ${rem}rem;`,
      `  --conversation-line-height: ${lineRem}rem;`,
      `}`
    )
  }

  // Accent colors for chat markdown (typography plugin uses :where() with
  // zero specificity, so these plain rules win).
  if (f.headingColor) {
    lines.push(
      `html[data-hermes-theme="${theme.name}"] .prose :is(h1,h2,h3,h4) { color: ${f.headingColor}; }`
    )
  }
  if (f.linkColor) {
    lines.push(`html[data-hermes-theme="${theme.name}"] .prose a { color: ${f.linkColor}; }`)
  }
  // 代码块显式配色：背景用 muted（暗色实底），文字用 foreground（亮色）——
  // 覆盖 app 的 light/dark 两套 inline-code token（浅色模式的暗文字在暗色
  // 主题上会变成黑字看不清），并给代码围栏不透明背景防止壁纸穿透。
  const tc = theme.darkColors || theme.colors || {}
  const codeBg = tc.muted || mix(tc.background || '#000000', tc.foreground || '#FFFFFF', 0.08)
  const codeFg = f.codeColor || tc.foreground || '#FFFFFF'
  lines.push(
    `html[data-hermes-theme="${theme.name}"] {`,
    `  --ui-inline-code-background: ${codeBg};`,
    `  --ui-inline-code-foreground: ${codeFg};`,
    `}`,
    `html[data-hermes-theme="${theme.name}"] .prose pre { background: ${codeBg}; color: ${codeFg}; }`,
    `html[data-hermes-theme="${theme.name}"] .prose code { color: ${codeFg}; }`,
    `html[data-hermes-theme="${theme.name}"] .prose pre code { color: inherit; }`,
    // ai-ui 渲染器的代码围栏与行内代码（Hermes 聊天实际用的结构）。
    // 注意：只给 fence 设色，语法高亮 span 保留自己的 --ui-* 颜色。
    `html[data-hermes-theme="${theme.name}"] [data-streamdown="code-block"] { background: ${codeBg} !important; color: ${codeFg} !important; }`,
    `html[data-hermes-theme="${theme.name}"] [data-streamdown="code-block"] .aui-prose-fence { background: ${codeBg} !important; color: ${codeFg} !important; }`,
    `html[data-hermes-theme="${theme.name}"] [data-streamdown="code-block"] .aui-prose-fence > code { background: transparent !important; }`,
    `html[data-hermes-theme="${theme.name}"] [data-streamdown="inline-code"] { background: ${codeBg} !important; color: ${codeFg} !important; }`
  )

  // Sidebar per-element colors. Token overrides scoped to the nav group
  // (:has — only the top nav rows are sidebar-menu-button) and the content
  // area; the nav scope is more specific, so nav wins inside its group. The
  // app's hover/active use `text-foreground` (a different token), so they
  // still light up — only the resting color changes.
  const sidebarRules = [
    f.sidebarNavColor &&
      `html[data-hermes-theme="${theme.name}"] [data-slot="sidebar-group"]:has([data-slot="sidebar-menu-button"]) { --ui-text-secondary: ${f.sidebarNavColor}; }`,
    f.sidebarItemColor &&
      `html[data-hermes-theme="${theme.name}"] [data-slot="sidebar-content"] { --ui-text-secondary: ${f.sidebarItemColor}; }`,
    f.sidebarSectionColor &&
      `html[data-hermes-theme="${theme.name}"] [data-slot="sidebar-group-label"] { color: ${f.sidebarSectionColor}; }`
  ].filter(Boolean)
  lines.push(...sidebarRules)

  return lines.filter(Boolean).join('\n')
}

// The pre-refactor plugin painted the wallpaper inline on <body>; a hot-reload
// leaves that paint behind (no code clears it) and it propagates to the canvas
// as a STALE wallpaper — the new media layer/overlay/blur then act on the
// invisible FX layer while the stale image keeps showing. The app itself never
// sets body backgrounds inline, so clearing them here is safe.
function clearBodyLegacy() {
  const body = document.body
  if (!body) return
  for (const p of [
    'backgroundImage',
    'backgroundSize',
    'backgroundPosition',
    'backgroundRepeat',
    'backgroundColor',
    'filter',
    'transform'
  ]) {
    if (body.style[p]) body.style[p] = ''
  }
}

// 代码块 inline 着色——CSS 规则可能被 app 的局部变量/高优先级规则压制
//（代码块显示为浅色模式默认的灰底黑字），直接在元素上设 inline
// !important 样式：优先级最高，任何 CSS 来源都压不过。
// 配色比例：背景比主题背景再深一档（深色实底），文字用前景亮色。
function activeThemeObj() {
  const name = document.documentElement.dataset.hermesTheme
  return name ? themeMap.get(name) : null
}

const CODE_SELECTOR =
  '[data-streamdown="code-block"], [data-streamdown="inline-code"], .aui-prose-fence'

function codeColorsOf(theme) {
  const tc = theme.darkColors || theme.colors || {}
  const bg = tc.background || '#000000'
  const fg = tc.foreground || '#FFFFFF'
  return {
    bg: mix(bg, '#000000', 0.18),
    fg: (theme.forge && theme.forge.codeColor) || fg
  }
}

function paintCodeInline() {
  if (codePaintRaf) return
  codePaintRaf = requestAnimationFrame(() => {
    codePaintRaf = null
    const theme = activeThemeObj()
    if (!theme) return
    const { bg, fg } = codeColorsOf(theme)
    document.querySelectorAll(CODE_SELECTOR).forEach(el => {
      el.style.setProperty('background', bg, 'important')
      el.style.setProperty('color', fg, 'important')
    })
    // 围栏内的 pre/code 本体：继承亮色文字，背景透明（fence 已有底色）。
    document
      .querySelectorAll('[data-streamdown="code-block"] pre, [data-streamdown="code-block"] code, .aui-prose-fence > code')
      .forEach(el => {
        el.style.setProperty('color', fg, 'important')
        el.style.setProperty('background', 'transparent', 'important')
      })
  })
}

// 观察 body 子树的新增节点（聊天流式渲染会不断插入代码块）。
let codeObserver = null
function ensureCodeObserver() {
  if (codeObserver || typeof document === 'undefined' || !document.body) return
  codeObserver = new MutationObserver(paintCodeInline)
  codeObserver.observe(document.body, { childList: true, subtree: true })
}

function clearCodeInline() {
  if (codePaintRaf) {
    cancelAnimationFrame(codePaintRaf)
    codePaintRaf = null
  }
  document.querySelectorAll(CODE_SELECTOR).forEach(el => {
    el.style.removeProperty('background')
    el.style.removeProperty('color')
  })
  document
    .querySelectorAll('[data-streamdown="code-block"] pre, [data-streamdown="code-block"] code, .aui-prose-fence > code')
    .forEach(el => {
      el.style.removeProperty('color')
      el.style.removeProperty('background')
    })
}

function applyForge(theme) {
  const doc = document.documentElement
  let el = document.getElementById(CSS_ID)
  if (!el) {
    el = document.createElement('style')
    el.id = CSS_ID
    document.head.appendChild(el)
  }
  el.textContent = buildCss(theme)

  // Paint the html background transparent so the app's own body/chrome paint
  // propagates to the canvas and sits BEHIND the FX container (media, overlay,
  // rain) — otherwise the opaque default chrome would cover the backdrop
  // layer. Restore when leaving the forge theme.
  if (prevHtmlBg === null) prevHtmlBg = doc.style.background || ''
  doc.style.background = 'transparent'

  clearBodyLegacy()

  const bold = Number(theme.forge?.boldLevel) || 0
  if (bold > 0) doc.dataset.tfBold = String(bold)
  else delete doc.dataset.tfBold

  paintMedia(theme)
  startFx(theme)
  // 代码块 inline 着色（立即处理已有元素 + 持续监听新增元素）。
  ensureCodeObserver()
  paintCodeInline()
}

// ─────────────────────────────────────────────────────────────────────────────
// Media layer — the wallpaper (image) or the animated background (video).
//
// Lives at the BOTTOM of the FX container (z-index 0), above the canvas but
// below the overlay/rain/scanlines and the app's glass shell. A real element
// instead of a body background because:
//   - <video> cannot be a CSS background (animated backdrop);
//   - filter blur applies to JUST the media (on <body> it blurred the whole
//     app UI — every descendant is a filter target).
// When a video is set it wins over the image; the image stays as fallback.
// ─────────────────────────────────────────────────────────────────────────────

const MEDIA_Z = 0
const OVERLAY_Z = 1
const RAIN_Z = 2
const SCANLINE_Z = 3

let mediaEl = null // <div> (image) or <video>
let mediaIsVideo = false

function mediaFilter(f) {
  const blurPx = Math.max(0, Number(f.blur) || 0)
  // `scale()` is NOT a valid `filter` function — it only exists on `transform`.
  // An invalid declaration makes Chromium drop the WHOLE filter (blur silently
  // never applied). Valid blur here; the edge-reveal compensation lives in
  // mediaTransform so both properties are well-formed.
  return blurPx > 0 ? `blur(${blurPx}px)` : ''
}

function mediaTransform(f) {
  const blurPx = Math.max(0, Number(f.blur) || 0)
  // Grow the media slightly so the transparent edge ring a blur leaves behind
  // stays off-screen (cover images) — scale is a transform, not a filter.
  return blurPx > 0 ? `scale(${(1 + blurPx * 0.015).toFixed(3)})` : ''
}

function attachVideoLifecycle(video) {
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const onVis = () => {
    if (document.hidden || reduced()) {
      try { video.pause() } catch { /* noop */ }
    } else {
      try { void video.play().catch(() => {}) } catch { /* noop */ }
    }
  }
  document.addEventListener('visibilitychange', onVis)
  video._tfCleanup = () => document.removeEventListener('visibilitychange', onVis)
  if (document.hidden || reduced()) onVis()
}

function paintMedia(theme) {
  const f = theme.forge || {}
  const video = f.backgroundVideo || ''
  const img = video ? '' : f.backgroundImage || ''
  const fit = f.imageFit === 'contain' ? 'contain' : 'cover'
  const filter = mediaFilter(f)
  const transform = mediaTransform(f)

  if (!video && !img) {
    if (mediaEl) {
      mediaEl.remove()
      mediaEl = null
      mediaIsVideo = false
    }
    return
  }

  const host = ensureFxContainer()
  const base = `position:absolute;inset:0;width:100%;height:100%;z-index:${MEDIA_Z};pointer-events:none;`

  if (video) {
    if (!mediaEl || !mediaIsVideo) {
      if (mediaEl) mediaEl.remove()
      const v = document.createElement('video')
      v.setAttribute('autoplay', '')
      v.setAttribute('muted', '')
      v.setAttribute('loop', '')
      v.setAttribute('playsinline', '')
      v.setAttribute('preload', 'auto')
      v.style.cssText = base + `object-fit:${fit};`
      v.addEventListener('error', () => {
        console.error('[skin-studio] 背景视频加载失败: ' + String(video).slice(0, 120))
        notifyUser({
          kind: 'error',
          message:
            '视频加载失败——请确认是视频文件直链（以 .mp4/.webm 结尾），且网站允许外链播放。'
        })
      })
      host.appendChild(v)
      mediaEl = v
      mediaIsVideo = true
      attachVideoLifecycle(v)
    }
    mediaEl.src = video
    mediaEl.style.objectFit = fit
    mediaEl.style.filter = filter
    mediaEl.style.transform = transform
    mediaEl.load()
    try { void mediaEl.play().catch(() => {}) } catch { /* noop */ }
  } else {
    if (!mediaEl || mediaIsVideo) {
      if (mediaEl) mediaEl.remove()
      const d = document.createElement('div')
      d.style.cssText =
        base + 'background-repeat:no-repeat;background-position:center;'
      host.appendChild(d)
      mediaEl = d
      mediaIsVideo = false
    }
    mediaEl.style.backgroundImage = `url("${String(img).replace(/"/g, '%22')}")`
    mediaEl.style.backgroundSize = fit
    mediaEl.style.filter = filter
    mediaEl.style.transform = transform
  }
}

function clearForge() {
  const el = document.getElementById(CSS_ID)
  if (el) el.remove()
  const doc = document.documentElement
  if (prevHtmlBg !== null) {
    doc.style.background = prevHtmlBg
    prevHtmlBg = null
  }
  delete doc.dataset.tfBold
  stopFx()
  clearCodeInline()
  if (codeObserver) {
    codeObserver.disconnect()
    codeObserver = null
  }
}

function refresh() {
  const active = document.documentElement.dataset.hermesTheme
  const theme = active ? themeMap.get(active) : null
  if (theme) applyForge(theme)
  else clearForge()
}

function ensureObserver() {
  if (observer || typeof document === 'undefined') return
  observer = new MutationObserver(refresh)
  observer.observe(document.documentElement, {
    attributeFilter: OBSERVED_ATTRS,
    attributes: true
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// FX engine — animated backdrop effects the stock theme model can't do:
// the media layer (wallpaper image / background video), matrix rain (canvas)
// and CRT scanlines. All live in one fixed container behind the glass shell
// (z-index: -1) owned by the active forge theme, stacked by explicit
// z-index: media 0 → overlay 1 → rain 2 → scanlines 3.
// ─────────────────────────────────────────────────────────────────────────────

const FX_ID = 'skin-studio-fx'
// 数字墙（黑客帝国风）：纯数字组合——0-9，去掉了原版混入的片假名。
const RAIN_LEGACY_CHARS = '0123456789'
// 汉字雨字符集（繁体）：文言虚词 + 常用字 + 千字文片段，营造「汉字从墨夜坠落」的意境。
const RAIN_CHARS =
  '道可道非常道名可名非常名天地玄黃宇宙洪荒日月盈昃辰宿列張之乎者也兮哉山水雲月風花雪雨墨紙硯琴棋書畫春秋冬夏龍鳳龜鶴松竹梅蘭荷菊詩詞賦曲夢夜霞霧一二三四五六七八九十'

// 汉字雨模式：偶发朱砂印章红（读取 --ui-red，主题可调）。
const HANZI_SEAL_RATE = 0.07
const RAIN_FONT_SIZE = 15

let fxContainer = null
let rainCanvas = null
let rainCtx = null
let rainRaf = null
let rainCols = []
// 数字墙（黑客帝国风）网格：满屏数字原地刷新流动。每个格子 {x, y, ch, t}。
let wallCells = null
let fxResizeObserver = null
let overlayEl = null

function ensureFxContainer() {
  if (fxContainer) return fxContainer
  fxContainer = document.createElement('div')
  fxContainer.id = FX_ID
  fxContainer.style.cssText = 'position:fixed;inset:0;z-index:-1;pointer-events:none;overflow:hidden;'
  document.body.appendChild(fxContainer)
  return fxContainer
}

function removeFx() {
  if (rainRaf) {
    cancelAnimationFrame(rainRaf)
    rainRaf = null
  }
  if (fxResizeObserver) {
    fxResizeObserver.disconnect()
    fxResizeObserver = null
  }
  if (mediaEl) {
    if (mediaIsVideo && mediaEl._tfCleanup) mediaEl._tfCleanup()
    mediaEl = null
    mediaIsVideo = false
  }
  rainCanvas = null
  rainCtx = null
  rainCols = []
  wallCells = null
  overlayEl = null
  if (fxContainer) {
    fxContainer.remove()
    fxContainer = null
  }
}

function resizeRain() {
  if (!rainCanvas) return
  rainCanvas.width = window.innerWidth
  rainCanvas.height = window.innerHeight
  const forge = rainThemeForge()
  const fontSize = rainFontSizeOf(forge)
  const isHanzi = Boolean(forge?.hanziRain)
  if (isHanzi) {
    // 汉字雨（列链模式）：列距 2.5x 字号——密度折中（明显但不拥挤）。
    const step = fontSize * 2.5
    const cols = Math.ceil(rainCanvas.width / step)
    rainCols = Array.from({ length: cols }, () => ({
      y: Math.random() * -rainCanvas.height,
      acc: Math.random(), // 累积位移（控制加字节奏，慢速不堆字的关键）
      len: 3 + Math.floor(Math.random() * 3), // 尾链长度 3–5 字
      chars: []
    }))
  } else {
    // 数字墙（黑客帝国风）：满屏数字网格，原地随机刷新流动——不下落、
    // 不堆叠。网格步长 1.15x 字号：满屏但不挤成一团，留一点呼吸感。
    const step = fontSize * 1.15
    const cols = Math.ceil(rainCanvas.width / step)
    const rows = Math.ceil(rainCanvas.height / step)
    wallCells = []
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        wallCells.push({
          x: c * step,
          y: r * step + fontSize, // baseline 对齐格底
          ch: RAIN_LEGACY_CHARS[Math.floor(Math.random() * RAIN_LEGACY_CHARS.length)],
          t: Math.floor(Math.random() * 24), // 初始随机错开——避免整屏同时闪烁
          lit: Math.random() < 0.07 // 亮点状态随刷新更新，重绘时沿用（不闪）
        })
      }
    }
    paintWallAll()
  }
}

// 数字墙颜色：固定黑客帝国荧光绿（科技感标志色），暗度低不晃眼。
// 不跟随主题 accent——主题色可能是白/暖色，会让数字墙发白失去科技感
//（与汉字雨固定宣纸米白同理：固定色在玻璃/壁纸之下最可靠）。
function wallColors() {
  return {
    dim: 'rgba(0, 255, 65, 0.35)',
    lit: 'rgba(0, 255, 65, 0.72)'
  }
}

// 数字墙：一次性绘制全部格子（初始化 / 窗口变化重建网格后调用）。
function paintWallAll() {
  if (!rainCtx || !wallCells) return
  const ctx = rainCtx
  const { dim, lit } = wallColors()
  ctx.font =
    rainFontSizeOf(rainThemeForge()) + 'px "JetBrains Mono", ui-monospace, monospace'
  for (let i = 0; i < wallCells.length; i++) {
    const c = wallCells[i]
    ctx.fillStyle = c.lit ? lit : dim
    ctx.fillText(c.ch, c.x, c.y)
  }
}

// ── 全局特效层 ──
// fxGlobal（独立于主题，面板「背景特效」分类调节）：mode=auto 时跟随
// 主题自带特效；none/matrix/hanzi 时全局覆盖，与任何配色主题搭配。
// rainFontSize/rainSpeed 非空时覆盖主题默认值。
let fxGlobal = null
// 特效层变化事件：皮肤工坊有多个界面实例（侧边栏面板 + 完整页面），
// 各自 useState 只在挂载时读一次——某实例修改后其他实例的显示会
// 停留在旧值（用户实测「扫描线开启是关闭、关闭是开启」）。通过
// 自定义事件广播，让所有实例实时同步。
const FX_CHANGED_EVENT = 'skin-studio:fx-changed'

function resolveFx(theme) {
  const f = theme?.forge || {}
  const g = fxGlobal || {}
  const out = { ...f }
  if (g.mode === 'matrix') {
    out.matrixRain = true
    out.hanziRain = false
  } else if (g.mode === 'hanzi') {
    out.hanziRain = true
    out.matrixRain = false
  } else if (g.mode === 'none') {
    out.matrixRain = false
    out.hanziRain = false
  }
  if (g.rainFontSize) out.rainFontSize = g.rainFontSize
  if (g.rainSpeed) out.rainSpeed = g.rainSpeed
  // CRT 扫描线：auto=跟随主题 / on=强制开启 / off=强制关闭。
  if (g.scanlines === 'on') out.scanlines = true
  else if (g.scanlines === 'off') out.scanlines = false
  return out
}

// 雨特效参数：读当前激活主题的 forge（预设主题自带参数，自定义主题由面板调节），
// 并叠加全局特效层覆盖（resolveFx）。
function rainThemeForge() {
  const activeName = document.documentElement.dataset.hermesTheme
  return activeName ? resolveFx(themeMap.get(activeName)) : null
}
function rainFontSizeOf(forge) {
  // 汉字雨默认 26px（大字清晰），数字墙保持原版 15px。
  const def = forge?.hanziRain ? 26 : RAIN_FONT_SIZE
  return Math.max(12, Math.min(48, Number(forge?.rainFontSize) || def))
}
function rainSpeedOf(forge) {
  // 汉字雨默认速度跟随背景：有背景图/视频时 0.5（动感），无背景图时 0.3
  //（纯色背景上运动感更强，慢一点视觉才一致）。数字墙保持原版速度（1）。
  const def = forge?.hanziRain
    ? forge.backgroundImage || forge.backgroundVideo
      ? 0.5
      : 0.3
    : 1
  return Math.max(0.15, Math.min(3, Number(forge?.rainSpeed) || def))
}

let lastRainFontSize = null

function tickRain() {
  // 异常保护：任何绘制错误都不能中断雨循环（否则雨永久消失）。
  try {
    tickRainInner()
  } catch (e) {
    console.error('[skin-studio] 雨绘制异常（已忽略）:', e && e.message ? e.message : e)
  }
  rainRaf = requestAnimationFrame(tickRain)
}

function tickRainInner() {
  if (!rainCtx || !rainCanvas) return
  const ctx = rainCtx
  const w = rainCanvas.width
  const h = rainCanvas.height
  // 当前主题的 forge 配置（汉字雨模式从这里读取）。
  const forge = rainThemeForge()
  const isHanzi = Boolean(forge?.hanziRain)
  const fontSize = rainFontSizeOf(forge)
  const speed = rainSpeedOf(forge)
  // 字号变化时重建列布局——否则列间距还是旧字号，大字会重叠堆在一起。
  if (lastRainFontSize !== fontSize) {
    lastRainFontSize = fontSize
    resizeRain()
  }
  // 擦除策略：汉字雨用 clearRect 全清重绘——零残影、字迹绝对清晰、
  // 字距固定、慢慢飘不堆叠；数字墙不清屏——只有变化的格子被新数字
  // 覆盖，天然「原地刷新」无残影、无拖尾。
  if (isHanzi) {
    ctx.clearRect(0, 0, w, h)
  }
  // 汉字雨印章：固定亮朱砂（不读变量——玻璃之下要醒目）。
  const seal = '#E64A3A'

  if (isHanzi) {
    // 汉字雨（列链模式）：每列一串字，头部亮、尾部渐隐——慢速不堆字、
    // 不闪烁、不抢视野。头部 7% 概率朱砂印章红。
    // 加字节奏：累积位移满一个字距才加新字（速度再慢，字距也恒为字号，
    // 不会挤成一团）。
    // 颜色用高亮白 + 黑色光晕衬底（雨层在玻璃/壁纸之上会被压暗或与
    // 亮色背景混在一起——黑晕让字在任何背景下都清晰）。
    ctx.font =
      '600 ' + fontSize + 'px "Songti SC", "STSong", "Noto Serif SC", "Kaiti SC", serif'
    ctx.save()
    ctx.shadowColor = 'rgba(0, 0, 0, 0.85)'
    ctx.shadowBlur = 6
    ctx.shadowOffsetX = 1
    ctx.shadowOffsetY = 1
    const step = fontSize * 2.5
    for (let i = 0; i < rainCols.length; i++) {
      const col = rainCols[i]
      col.y += speed * fontSize
      col.acc += speed
      if (col.y - col.len * fontSize > h) {
        col.y = -Math.random() * h
        col.len = 3 + Math.floor(Math.random() * 3)
        col.chars = []
      }
      while (col.acc >= 1) {
        col.acc -= 1
        col.chars.unshift(RAIN_CHARS[Math.floor(Math.random() * RAIN_CHARS.length)])
        if (col.chars.length > col.len) col.chars.pop()
      }
      for (let k = 0; k < col.chars.length; k++) {
        // 头部纯白 1.0，尾部渐隐到 0.3——玻璃之下依然清晰。
        const alpha = k === 0 ? 1 : Math.max(0.3, 0.6 - k * 0.12)
        ctx.fillStyle =
          k === 0 && Math.random() < HANZI_SEAL_RATE
            ? seal
            : `rgba(255, 255, 255, ${alpha.toFixed(2)})`
        ctx.fillText(col.chars[k], i * step, col.y - k * fontSize)
      }
    }
    ctx.restore()
  } else {
    // 数字墙（黑客帝国风）：满屏数字网格原地刷新流动——不堆叠、不下落。
    // canvas 在 FX 容器（z-index:-1）里，永远位于文字之下，纯背景层。
    if (!wallCells) return
    // 每帧全清重绘——绝不让旧像素残留叠加（残留会越叠越糊、越叠越白）。
    ctx.clearRect(0, 0, w, h)
    ctx.font = fontSize + 'px "JetBrains Mono", ui-monospace, monospace'
    const { dim, lit } = wallColors()
    // 刷新节奏：speed=1 → 平均 14 帧（~0.23s）换一批；speed 越大变化越快。
    const base = Math.max(3, 14 / speed)
    for (let i = 0; i < wallCells.length; i++) {
      const c = wallCells[i]
      c.t -= 1
      if (c.t <= 0) {
        c.t = Math.round(base * (0.5 + Math.random() * 1.5))
        c.ch = RAIN_LEGACY_CHARS[Math.floor(Math.random() * RAIN_LEGACY_CHARS.length)]
        c.lit = Math.random() < 0.07
      }
      ctx.fillStyle = c.lit ? lit : dim
      ctx.fillText(c.ch, c.x, c.y)
    }
  }
}
function startMatrixRain() {
  if (typeof document === 'undefined') return
  if (rainCanvas) {
    // canvas 已存在（皮肤工坊主题之间切换：数字墙↔汉字雨）——必须重建列
    // 布局，否则列数组类型不匹配（数字 vs 对象），tickRain 直接崩溃，
    // 雨消失。
    resizeRain()
    return
  }
  const host = ensureFxContainer()
  const canvas = document.createElement('canvas')
  canvas.style.cssText = `position:absolute;inset:0;width:100%;height:100%;z-index:${RAIN_Z};`
  host.appendChild(canvas)
  rainCanvas = canvas
  rainCtx = canvas.getContext('2d')
  resizeRain()
  fxResizeObserver = new ResizeObserver(resizeRain)
  fxResizeObserver.observe(document.body)
  rainRaf = requestAnimationFrame(tickRain)
}

function addScanlines() {
  if (typeof document === 'undefined') return
  const host = ensureFxContainer()
  if (host.querySelector('.ss-scanlines')) return
  const el = document.createElement('div')
  el.className = 'ss-scanlines'
  el.style.cssText =
    `position:absolute;inset:0;z-index:${SCANLINE_Z};background:repeating-linear-gradient(0deg, rgba(0,0,0,0.22) 0px, rgba(0,0,0,0.22) 1px, transparent 1px, transparent 3px);`
  host.appendChild(el)
}

function startFx(theme) {
  // 用 resolveFx 合并全局特效层——全局覆盖（数字墙/汉字雨/关闭）优先于主题自带。
  const f = resolveFx(theme)
  const wantsRain = Boolean(f.matrixRain || f.hanziRain)
  if (!wantsRain && rainRaf) {
    // 切到无雨主题：停掉正在运行的雨（否则雨会一直下）。
    cancelAnimationFrame(rainRaf)
    rainRaf = null
    if (rainCanvas) {
      rainCanvas.remove()
      rainCanvas = null
      rainCtx = null
      rainCols = []
    }
    if (fxResizeObserver) {
      fxResizeObserver.disconnect()
      fxResizeObserver = null
    }
  }
  // Overlay sits above the media (z-index 1), below rain/scanlines.
  if (f.overlayOpacity > 0) {
    const host = ensureFxContainer()
    if (!overlayEl) {
      overlayEl = document.createElement('div')
      overlayEl.style.cssText = `position:absolute;inset:0;pointer-events:none;z-index:${OVERLAY_Z};`
      host.appendChild(overlayEl)
    }
    const dark = (document.documentElement.dataset.hermesMode || 'dark') !== 'light'
    overlayEl.style.background = dark ? `rgba(0,0,0,${f.overlayOpacity})` : `rgba(245,242,235,${f.overlayOpacity})`
  } else if (overlayEl) {
    overlayEl.remove()
    overlayEl = null
  }
  if (f.matrixRain || f.hanziRain) startMatrixRain()
  // 扫描线与数字墙互斥：满屏数字 + 满屏横线会叠成噪点/横纹（用户实测：
  // 「屏幕上好多横线」）。数字墙激活时自动移除扫描线；汉字雨较稀疏可共存。
  // 注意必须「加」与「移」成对——之前只加不移，背景切换（视频↔图片）后
  // 已存在的扫描线 DOM 永远不会被清掉，横线又冒出来。
  if (f.scanlines && !f.matrixRain) addScanlines()
  else removeScanlines()
}

// 移除 CRT 扫描线层（与 addScanlines 成对；数字墙激活 / 全局关闭 /
// 切到无扫描线主题时清理，否则 DOM 残留导致横线复活）。
function removeScanlines() {
  const host = fxContainer
  if (!host) return
  const el = host.querySelector('.ss-scanlines')
  if (el) el.remove()
}

function stopFx() {
  removeFx()
}

// ─────────────────────────────────────────────────────────────────────────────
// Live authoring: push an updated custom theme into the registry so the app
// repaints the active skin in place ($registryVersion bumps → ThemeProvider
// re-derives + re-applies). The extras ride along in the object.
// ─────────────────────────────────────────────────────────────────────────────

function publishCustom() {
  if (customDisposer) {
    customDisposer()
    customDisposer = null
  }
  if (!customTheme) return
  customDisposer = registerTheme(customTheme)
  saveCustom()
  refresh()
}

function registerTheme(theme) {
  // Every theme carries the Text-tab defaults in its .forge extras (the app
  // ignores unknown keys; we read them back in buildCss).
  const merged = { ...theme, forge: { ...TEXT_DEFAULTS, ...(theme.forge || {}) } }
  themeMap.set(merged.name, merged)
  if (merged.name === CUSTOM_NAME) customTheme = merged
  return ctxOf.register({ id: 'theme:' + merged.name, area: THEMES_AREA, data: merged })
}

// Holds the plugin context (set in register); needed because live authoring
// happens outside register().
let ctxOf = null

// ─────────────────────────────────────────────────────────────────────────────
// Apply — activate a forge theme as the live skin.
//
// The desktop has NO programmatic setTheme for plugins, so we ride the
// canonical skin path: write `$HERMES_HOME/skins/<name>.yaml` + set
// `display.skin` via the plugin's Python backend (ctx.rest). The gateway's
// skin watcher then broadcasts `skin.changed` and the app repaints — the same
// live path `/skin` uses. Works for any Hermes surface, not just desktop.
// ─────────────────────────────────────────────────────────────────────────────

function skinTokensFromTheme(theme) {
  const c = theme.darkColors || theme.colors
  return {
    background: c.background,
    ui_text: c.foreground,
    ui_accent: c.midground || c.ring || c.primary,
    ui_primary: c.primary,
    ui_border: c.border,
    ui_error: c.destructive,
    banner_dim: c.mutedForeground,
    banner_title: c.foreground,
    banner_text: c.foreground,
    status_bar_bg: c.background,
    completion_menu_bg: c.popover,
    ui_ok: '#30A46C',
    ui_warn: c.ring || '#FFD700'
  }
}

// Re-assert the configured forge skin on plugin boot (register). Re-writing
// display.skin bumps the config mtime, which makes the gateway's skin watcher
// re-broadcast skin.changed — the desktop then re-applies the theme even after
// an app update reset its local storage. Retries a few times in case the
// gateway is still coming up during boot.
async function reassertConfiguredSkin() {
  // 启动时 hermes serve 可能还没就绪 → 快速重试（500ms 间隔 × 5 次，总计 ~2.5s 最坏情况）。
  // 之前是 3s 间隔 × 3 次，用户看到最长 9s 的"无皮肤"闪屏。
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const cfg = await host.request('config.get', { key: 'skin' })
      const raw = cfg && cfg.value !== undefined ? cfg.value : cfg
      const skin = typeof raw === 'string' ? raw : raw && raw.name ? raw.name : null
      if (skin && themeMap.has(skin)) {
        const res = await ctxOf.rest('/reassert', { method: 'POST', body: { name: skin } })
        if (res && res.ok) console.error('[skin-studio] skin reasserted: ' + skin)
        else console.error('[skin-studio] reassert failed: ' + JSON.stringify(res))
      }
      return
    } catch (e) {
      if (attempt < 5) {
        await new Promise(r => setTimeout(r, 500))
      } else {
        console.error('[skin-studio] reassert gave up: ' + (e && e.message ? e.message : String(e)))
      }
    }
  }
}

async function activateSkin(theme) {
  const name = String(theme.name || '').replace(/[^a-z0-9-]/gi, '')
  if (!name) {
    host.notify({ kind: 'error', message: '主题名称无效。' })
    return null
  }
  try {
    const res = await ctxOf.rest('/activate', {
      method: 'POST',
      body: {
        name,
        label: theme.label,
        description: theme.description,
        colors: skinTokensFromTheme(theme)
      }
    })
    host.notify({ kind: 'info', message: `"${theme.label}" 已应用——约 1 秒后重绘` })
    return res
  } catch (e) {
    host.notify({
      kind: 'error',
      message: '应用失败。请手动激活：⌘K → 主题 → ' + theme.label + '. (' + (e && e.message ? e.message : String(e)) + ')'
    })
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The pane UI.
// ─────────────────────────────────────────────────────────────────────────────

const MAIN_TOKENS = [
  ['background', '背景'],
  ['foreground', '前景文字'],
  ['primary', '主色'],
  ['midground', '强调色'],
  ['ring', '焦点环'],
  ['accent', '柔和强调'],
  ['accentForeground', '强调文字'],
  ['border', '边框'],
  ['input', '输入框'],
  ['mutedForeground', '次要文字'],
  ['secondary', '次要色'],
  ['destructive', '危险色'],
  ['userBubble', '用户气泡'],
  ['card', '卡片']
]

const EXTRA_TOKENS = [
  ['uiRed', '红'],
  ['uiOrange', '橙'],
  ['uiYellow', '黄'],
  ['uiGreen', '绿'],
  ['uiCyan', '青'],
  ['uiBlue', '蓝'],
  ['uiPurple', '紫'],
  ['uiWarm', '暖']
]

const BOLD_OPTIONS = [
  [0, '普通'],
  [1, '中等'],
  [2, '强']
]

// 配色模板库 — 每套 6 个主色，一键生成整套和谐主题（themeFromPalette 复用）。
const COLOR_TEMPLATES = [
  { name: '莫兰迪', swatches: ['#6E6259', '#A89F93', '#4A443D', '#8B8174', '#C0B7A9', '#5A5148'] },
  { name: '马卡龙', swatches: ['#3A2A3A', '#F7B2BD', '#A8D8B9', '#F8E1A4', '#B5D0E8', '#D9B8E0'] },
  { name: '赛博霓虹', swatches: ['#0A0A14', '#00E56A', '#B026FF', '#00E5FF', '#FF2E88', '#FFD700'] },
  { name: '暗夜森林', swatches: ['#0B120E', '#2E5E4E', '#7FA98E', '#1E3A2C', '#C9DCC9', '#4A8C5C'] },
  { name: '深海', swatches: ['#0A1428', '#1E4A7A', '#5AA8E8', '#123052', '#A8D4F0', '#2E6E9E'] },
  { name: '落日', swatches: ['#1A0E08', '#C77B2F', '#E8A44A', '#5A2A14', '#F0D4A4', '#8A3A1E'] },
  { name: '薄荷', swatches: ['#0A1410', '#2ECC71', '#7AE0B0', '#1A3A28', '#D0F0E0', '#3E8C5A'] },
  { name: '玫瑰金', swatches: ['#140A0E', '#B76E79', '#E8B4B8', '#3A1A22', '#F0D4D4', '#8A4A52'] },
  { name: '黑白极简', swatches: ['#0A0A0A', '#F2F2F2', '#8A8A8A', '#2A2A2A', '#C9C9C9', '#4A4A4A'] },
  { name: '复古胶片', swatches: ['#14100C', '#B08D2E', '#C77B2F', '#2A241C', '#E8DCC0', '#8A6A3A'] }
]

// 套用一套主色（模板或图片提取结果）到自定义主题。
function applyPaletteToState(setState, setSaved, hostNotify, name, swatches) {
  const th = themeFromPalette(swatches)
  if (!th) return false
  setState(prev => ({
    ...prev,
    colors: { ...prev.colors, ...th.colors },
    darkColors: { ...prev.darkColors, ...th.darkColors },
    forge: {
      ...prev.forge,
      ...th.forge,
      extraColors: { ...prev.forge.extraColors, ...(th.forge.extraColors || {}) }
    }
  }))
  setSaved(false)
  hostNotify({ kind: 'info', message: `配色「${name}」已套用——可继续微调` })
  return true
}

function ColorField({ label, value, onChange }) {
  return jsxs('label', {
    className: 'flex items-center gap-2 text-xs text-(--ui-text-secondary)',
    children: [
      jsx('input', {
        type: 'color',
        value: value,
        onChange: e => onChange(e.target.value),
        className: 'h-6 w-9 cursor-pointer rounded border border-(--ui-stroke-secondary) bg-transparent p-0'
      }),
      jsx('span', { className: 'min-w-0 flex-1 truncate', children: label }),
      jsx('span', { className: 'font-mono text-[0.625rem] text-(--ui-text-quaternary)', children: value })
    ]
  })
}

// ColorField variant that supports "unset" (null): the picker is ALWAYS
// visible so a color can be chosen even from the auto state; the reset
// affordance returns to the theme default.
function ColorResetField({ label, value, onChange, onReset, defaultColor }) {
  const shown = value || defaultColor || '#808080'
  const isAuto = !value
  return jsxs('div', {
    className: 'flex items-center gap-2 text-xs text-(--ui-text-secondary)',
    children: [
      jsx('div', {
        className: 'relative shrink-0',
        children: [
          jsx('input', {
            type: 'color',
            value: shown,
            onChange: e => onChange(e.target.value),
            className: cn(
              'h-6 w-9 cursor-pointer rounded border bg-transparent p-0',
              isAuto ? 'border-dashed border-(--ui-stroke-secondary)' : 'border-(--ui-stroke-secondary)'
            ),
            title: isAuto ? '使用主题默认颜色——选择以自定义' : '自定义颜色'
          }),
          isAuto &&
            jsx('span', {
              className: 'pointer-events-none absolute -right-1 -top-1 h-2 w-2 rounded-full border border-(--ui-bg-elevated) bg-(--ui-yellow)',
              title: '自动'
            })
        ]
      }),
      jsx('span', { className: 'min-w-0 flex-1 truncate', children: label }),
      jsx('button', {
        type: 'button',
        onClick: onReset,
        className: 'rounded p-1 text-(--ui-text-quaternary) transition-colors hover:bg-(--ui-row-hover-background) hover:text-(--ui-text-secondary)',
        title: '重置为主题默认颜色',
        children: jsx(icons.RefreshCw, { className: 'h-3 w-3' })
      })
    ]
  })
}

function Segmented({ options, value, onChange, className }) {
  return jsx('div', {
    className: cn('flex rounded-md border border-(--ui-stroke-secondary) p-0.5', className),
    children: options.map(([v, label]) =>
      jsx(
        'button',
        {
          key: String(v),
          type: 'button',
          onClick: () => onChange(v),
          className: cn(
            'flex-1 rounded-[0.3125rem] px-2 py-1 text-[0.6875rem] font-medium transition-colors',
            value === v
              ? 'bg-(--ui-accent) text-(--ui-bg-primary)'
              : 'text-(--ui-text-secondary) hover:bg-(--ui-row-hover-background)'
          ),
          children: label
        },
        String(v)
      )
    )
  })
}

function Section({ title, children }) {
  return jsxs('div', {
    className: 'flex flex-col gap-2',
    children: [
      jsx('div', {
        className: 'text-[0.6875rem] font-semibold uppercase tracking-wide text-(--ui-text-quaternary)',
        children: title
      }),
      children
    ]
  })
}


function activeThemeName() {
  return typeof document !== 'undefined' ? document.documentElement.dataset.hermesTheme || 'nous' : 'nous'
}

// Re-render the pane header when the active theme changes.
function useActiveTheme() {
  const [name, setName] = useState(activeThemeName())
  useEffect(() => {
    if (typeof document === 'undefined') return
    const obs = new MutationObserver(() => setName(activeThemeName()))
    obs.observe(document.documentElement, { attributeFilter: ['data-hermes-theme'], attributes: true })
    return () => obs.disconnect()
  }, [])
  return name
}

// ─────────────────────────────────────────────────────────────────────────────
// Plugin entry.
// ─────────────────────────────────────────────────────────────────────────────

export default {
  id: 'skin-studio',
  name: '皮肤工坊',
  register(ctx) {
    ctxOf = ctx
    storage = ctx.storage
    customTheme = loadCustom()
    fxGlobal = loadFxGlobal()

    // Clean up any FX container left behind by a previous incarnation of this
    // module (hot-reload re-evaluates the file; the DOM keeps old canvases).
    const staleFx = document.getElementById(FX_ID)
    if (staleFx) staleFx.remove()

    for (const theme of PRESETS) registerTheme(theme)
    customDisposer = registerTheme(customTheme)

    // ── 立刻注入 CSS — 放在所有 ctx.register 之前，尽可能缩短启动闪屏 ──
    // 如果 data-hermes-theme 已经是皮肤工坊主题（上次正常退出时写入的），
    // 这里同步注入 CSS，不需要等后端；如果还不是（后端还没就绪），observer
    // 会在 skin.changed 广播后自动补上。
    ensureObserver()
    refresh()

    // 从 IndexedDB 异步恢复本地视频（大视频持久化）。
    restoreLocalVideo()

    // Persistence across restarts/updates: if the backend config still points
    // at a forge skin, re-assert it (re-writing display.skin bumps the config
    // mtime → the gateway watcher re-broadcasts skin.changed → the desktop
    // re-applies the theme). Without this, an app update resets the desktop to
    // its local-storage theme even though the config says ss-*.
    reassertConfiguredSkin()

    ctx.register({
      id: 'pane',
      area: 'panes',
      title: '皮肤工坊',
      data: { placement: 'right', width: '340px' },
      render: () => jsx(ForgePane, {})
    })

    // Full page + sidebar nav row — discoverable next to the app's other
    // menu entries (Capabilities, Messaging, Artifacts).
    ctx.registerMany([
      {
        id: 'page',
        area: ROUTES_AREA,
        data: { path: '/skin-studio' },
        render: () => jsx(ForgePage, {})
      },
      {
        id: 'nav',
        area: SIDEBAR_NAV_AREA,
        data: { path: '/skin-studio', label: '皮肤工坊', codicon: 'project' }
      },
      {
        id: 'open',
        area: PALETTE_AREA,
        data: {
          id: 'skin-studio.open',
          label: '皮肤工坊 · 打开编辑器',
          keywords: ['theme', '皮肤', '壁纸', '编辑', '主题'],
          run: () => host.navigate('/skin-studio')
        }
      }
    ])

    ctx.register({
      id: 'reset',
      area: PALETTE_AREA,
      data: {
        id: 'skin-studio.reset',
        label: '皮肤工坊 · 重置自定义主题',
        keywords: ['theme', '重置', '恢复', '皮肤'],
        run: () => {
          customTheme = defaultCustom()
          publishCustom()
          host.notify({ kind: 'info', message: '皮肤工坊：自定义主题已重置' })
        }
      }
    })

    // CSS 已在主题注册后同步注入（见 register() 开头），这里不需要再调。
  }
}

// Pane component must see fresh theme-name state; wrap in a component using
// the hook so the header badge stays live.
function ForgePane() {
  const activeTheme = useActiveTheme()
  const isForgeActive = activeTheme === CUSTOM_NAME || PRESETS.some(p => p.name === activeTheme)
  return jsx(PaneInner, { activeTheme: activeTheme, isForgeActive: isForgeActive })
}

// Full-page version of the same editor (route /theme-forge).
function ForgePage() {
  const activeTheme = useActiveTheme()
  const isForgeActive = activeTheme === CUSTOM_NAME || PRESETS.some(p => p.name === activeTheme)
  return jsx('div', {
    className: 'h-full w-full',
    children: jsx(PaneInner, { activeTheme: activeTheme, isForgeActive: isForgeActive, wide: true })
  })
}

function PaneInner({ activeTheme, isForgeActive, wide = false }) {
  const [tab, setTab] = useState('colors')
  const [palette, setPalette] = useState('dark')
  // Which backdrop editor is open — 'image' or 'video'. Independent of the
  // data: both fields can coexist, video wins at paint time.
  const [mediaTab, setMediaTab] = useState(() => (cloneState().forge.backgroundVideo ? 'video' : 'image'))
  const [state, setState] = useState(() => cloneState())
  const [saved, setSaved] = useState(true)
  const [localFile, setLocalFile] = useState(null) // { name, size } of the picked image
  const [localVideo, setLocalVideo] = useState(null) // { name, size, persistent } of the picked video
  const [videoLib, setVideoLib] = useState(() => readVideoLib()) // 已保存的视频媒体库
  const [applyName, setApplyName] = useState(CUSTOM_NAME)
  // 全局特效层：独立于主题，可与任意配色主题搭配（auto=跟随主题）。
  const [fx, setFx] = useState(() => loadFxGlobal())
  // 诊断信息：当前主题、代码块数量与计算样式（用于排查配色不生效问题）。
  const [diag, setDiag] = useState(null)
  const timer = useRef(null)
  const fileInputRef = useRef(null)
  const videoInputRef = useRef(null)
  const inactiveWarned = useRef(false)

  // 特效层跨实例同步：其他界面实例（侧边栏面板/完整页面）修改后，
  // 本实例的 fx state 跟随广播事件更新，开关显示不再停留在旧值。
  useEffect(() => {
    const onFxChanged = e => setFx(e.detail)
    document.addEventListener(FX_CHANGED_EVENT, onFxChanged)
    return () => document.removeEventListener(FX_CHANGED_EVENT, onFxChanged)
  }, [])

  useEffect(() => {
    const t = setInterval(() => {
      try {
        const active = document.documentElement.dataset.hermesTheme || '(无)'
        const blocks = document.querySelectorAll('[data-streamdown="code-block"]').length
        const fences = document.querySelectorAll('.aui-prose-fence').length
        const inlines = document.querySelectorAll('[data-streamdown="inline-code"]').length
        const first = document.querySelector('[data-streamdown="code-block"] .aui-prose-fence')
        let bg = null
        let color = null
        if (first) {
          const cs = getComputedStyle(first)
          bg = cs.backgroundColor
          color = cs.color
        }
        const cssEl = document.getElementById(CSS_ID)
        const injected = cssEl ? cssEl.textContent.length : 0
        const vid = storage?.get(STORAGE_VIDEO_ID_KEY, null)
        const lib = readVideoLib()
        const rainState = rainCanvas
          ? 'canvas✓' + (rainRaf ? '+动画' : '+停')
          : '无canvas'
        const themeCount = themeMap ? themeMap.size : -1
        const hanziRegistered = themeMap ? themeMap.has('ss-hanzi-rain') : false
        storageEstimate().then(est => {
          setDiag({
            active,
            blocks,
            fences,
            inlines,
            bg,
            color,
            injected,
            quota: est ? est.quota : null,
            usage: est ? est.usage : null,
            vid,
            libCount: lib.length,
            libNames: lib.map(e => e.name).join('、'),
            rainState,
            themeCount,
            hanziRegistered
          })
        })
        // 实测 IDB：当前视频数据能否读到（大小 / 丢失）。
        if (vid) {
          idbGet(vid).then(blob => {
            setDiag(d => ({ ...d, idbSize: blob ? blob.size : -1 }))
          })
        } else {
          setDiag(d => ({ ...d, idbSize: null }))
        }
      } catch (e) {
        setDiag({ error: String(e && e.message ? e.message : e) })
      }
    }, 2000)
    return () => clearInterval(t)
  }, [])

  const colors = palette === 'dark' ? state.darkColors : state.colors
  const extras = state.forge

  function cloneState() {
    const t = loadCustom()
    return JSON.parse(JSON.stringify(t))
  }

  // Local image picker: input[type=file] → FileReader → data URI. Electron
  // gives us the real File, so no backend/bridge is needed.
  function pickLocalImage(file) {
    if (!file) return
    const MAX = 2.5 * 1024 * 1024
    if (file.size > MAX) {
      host.notify({
        kind: 'error',
        message: '图片过大（>2.5MB）。请用更小的图片或粘贴 URL——大图无法存入应用存储。'
      })
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      setLocalFile({ name: file.name, size: file.size })
      bumpExtras({ backgroundImage: reader.result })
    }
    reader.onerror = () => host.notify({ kind: 'error', message: '读取图片文件失败。' })
    reader.readAsDataURL(file)
  }

  function clearLocalFile() {
    setLocalFile(null)
    bumpExtras({ backgroundImage: null })
  }

  // Local video picker. 视频存 IndexedDB（容量大，不再受 localStorage 限制）：
  // blob URL 即时播放，同时把 File 写入 IDB 媒体库；重启后从 IDB 读回恢复。
  // 媒体库最多保留 VIDEO_LIB_MAX 个，超出自动删除最旧的（不无限累积）。
  function pickLocalVideo(file) {
    if (!file) return
    const type = String(file.type || '')
    if (type && !type.startsWith('video/')) {
      host.notify({
        kind: 'error',
        message: '格式不支持——请选择视频文件（mp4、webm、mov…）。'
      })
      return
    }
    const objUrl = URL.createObjectURL(file)
    const videoId = 'v-' + Date.now()
    setLocalVideo({ name: file.name, size: file.size, persistent: true })
    bumpExtras({ backgroundVideo: objUrl, localVideoId: videoId })
    ensurePersistentStorage()
      .then(() => idbPut(videoId, file))
      .then(() => {
        const lib = readVideoLib()
        lib.push({ id: videoId, name: file.name, size: file.size, date: Date.now() })
        // 超出上限删除最旧的（连同 IDB 记录），避免存储无限累积。
        const removed = lib.splice(0, Math.max(0, lib.length - VIDEO_LIB_MAX))
        removed.forEach(e => idbDel(e.id).catch(() => {}))
        writeVideoLib(lib)
        setVideoLib(lib)
        storage?.set(STORAGE_VIDEO_ID_KEY, videoId)
        host.notify({
          kind: 'info',
          message: `视频已保存到媒体库（${fmtSize(file.size)}，重启后依然保留）`
        })
      })
      .catch(err => {
        host.notify({
          kind: 'error',
          message: `视频保存失败：${String((err && err.message) || err)}。当前会话可用，重启后需重新选择。`
        })
      })
  }

  // 从媒体库应用已保存的视频（无需重新上传）。
  function useVideoFromLib(entry) {
    idbGet(entry.id).then(blob => {
      if (!blob) {
        host.notify({
          kind: 'error',
          message: `「${entry.name}」的数据已丢失（存储被清理），请重新上传。`
        })
        delVideoFromLib(entry.id)
        return
      }
      const url = URL.createObjectURL(blob)
      setLocalVideo({ name: entry.name, size: entry.size, persistent: true })
      storage?.set(STORAGE_VIDEO_ID_KEY, entry.id)
      bumpExtras({ backgroundVideo: url, localVideoId: entry.id })
    })
  }

  // 从媒体库删除一个视频（若正被使用则同时清掉背景视频）。
  function delVideoFromLib(id) {
    idbDel(id).catch(() => {})
    const lib = readVideoLib().filter(e => e.id !== id)
    writeVideoLib(lib)
    setVideoLib(lib)
    if (storage?.get(STORAGE_VIDEO_ID_KEY, null) === id) {
      storage?.remove(STORAGE_VIDEO_ID_KEY)
      setLocalVideo(null)
      bumpExtras({ backgroundVideo: null, localVideoId: null })
    }
  }

  // 移除当前背景视频（媒体库记录保留，可随时再点用）。
  function clearLocalVideo() {
    setLocalVideo(null)
    bumpExtras({ backgroundVideo: null, localVideoId: null })
    storage?.remove(STORAGE_VIDEO_ID_KEY)
  }

  function fmtSize(bytes) {
    return bytes >= 1024 * 1024 ? (bytes / (1024 * 1024)).toFixed(1) + ' MB' : Math.round(bytes / 1024) + ' KB'
  }

  function bump(patch) {
    setState(prev => ({ ...prev, ...patch }))
    setSaved(false)
  }

  function bumpColors(patch) {
    setState(prev => {
      const target = palette === 'dark' ? prev.darkColors : prev.colors
      return { ...prev, [palette === 'dark' ? 'darkColors' : 'colors']: { ...target, ...patch } }
    })
    setSaved(false)
  }

  function bumpExtras(patch) {
    setState(prev => ({ ...prev, forge: { ...prev.forge, ...patch } }))
    setSaved(false)
  }

  // 全局特效层修改：写 storage + 更新引擎变量 + 立即重绘（雨类型/字号/
  // 速度、玻璃透明度都实时生效，且不依赖当前是哪个主题）。同时广播
  // FX_CHANGED_EVENT 让所有皮肤工坊界面实例（侧边栏面板/完整页面）同步。
  function bumpFx(patch) {
    const next = {
      ...(fxGlobal || { mode: 'auto', rainFontSize: null, rainSpeed: null, scanlines: 'auto' }),
      ...patch
    }
    fxGlobal = next
    saveFxGlobal(next)
    setFx(next)
    document.dispatchEvent(new CustomEvent(FX_CHANGED_EVENT, { detail: next }))
    refresh()
  }

  function bumpExtraColor(key, value) {
    setState(prev => ({ ...prev, forge: { ...prev.forge, extraColors: { ...prev.forge.extraColors, [key]: value } } }))
    setSaved(false)
  }

  // 一键套用配色模板。
  function applyTemplate(t) {
    applyPaletteToState(setState, setSaved, m => host.notify(m), t.name, t.swatches)
  }

  // 从当前背景图片自动提取主色 → 生成整套配色。
  async function autoColorFromWallpaper() {
    const src = extras.backgroundImage
    if (!src) {
      host.notify({ kind: 'error', message: '请先在「背景」中放入一张图片' })
      return
    }
    try {
      const swatches = await extractPaletteFromImage(src)
      const ok = applyPaletteToState(setState, setSaved, m => host.notify(m), '图片自动配色', swatches)
      if (ok) host.notify({ kind: 'info', message: `已从图片提取 ${swatches.length} 种主色自动配色` })
    } catch (e) {
      host.notify({ kind: 'error', message: '自动配色失败：' + (e && e.message ? e.message : String(e)) })
    }
  }

  // 面板挂载时主动检查本地视频：若 state 缺视频但存储有 ID，异步读回同步
  //（双保险——restore 事件可能在面板未打开时错过监听）。
  useEffect(() => {
    const vid = storage?.get(STORAGE_VIDEO_ID_KEY, null)
    if (vid && !state.forge.backgroundVideo) {
      idbGet(vid).then(blob => {
        if (!blob) return
        const url = URL.createObjectURL(blob)
        const entry = readVideoLib().find(e => e.id === vid)
        setState(prev => ({
          ...prev,
          forge: { ...prev.forge, backgroundVideo: url, localVideoId: vid }
        }))
        setLocalVideo({
          name: entry ? entry.name : '视频',
          size: entry ? entry.size : blob.size,
          persistent: true
        })
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 监听模块级 restoreLocalVideo 的恢复事件：同步面板 state（防抖保存
  // 不再用无视频的旧 state 覆盖 customTheme 的已恢复视频）。
  useEffect(() => {
    const onRestore = e => {
      const d = e.detail || {}
      setState(prev => ({
        ...prev,
        forge: { ...prev.forge, backgroundVideo: d.url, localVideoId: d.id }
      }))
      setLocalVideo({ name: d.name || '视频', size: d.size || 0, persistent: true })
    }
    document.addEventListener('skin-studio:video-restored', onRestore)
    return () => document.removeEventListener('skin-studio:video-restored', onRestore)
  }, [])

  useEffect(() => {
    if (isForgeActive) inactiveWarned.current = false
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const st = JSON.parse(JSON.stringify(state))
      // 视频补回：state 有 localVideoId 但缺 blob 视频（视频由 IndexedDB
      // 异步恢复、或面板 state 尚未同步）时，继承 customTheme 当前视频——
      // 保证编辑永远生效，且不会覆盖掉已恢复的视频。
      if (st.forge.localVideoId && !st.forge.backgroundVideo) {
        const cur = customTheme && customTheme.forge && customTheme.forge.backgroundVideo
        if (cur) st.forge.backgroundVideo = cur
      }
      customTheme = st
      publishCustom()
      setSaved(true)
      // Edited while the forge theme is NOT active → nothing visibly changed.
      // Warn once per editing session so the user knows why.
      if (!isForgeActive && !inactiveWarned.current) {
        inactiveWarned.current = true
        host.notify({
          kind: 'info',
          message: '更改已保存到皮肤工坊——激活主题查看：⌘K → 主题 → 皮肤工坊 · 自定义'
        })
      }
    }, 180)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [state])

  function resetAll() {
    customTheme = defaultCustom()
    publishCustom()
    setState(JSON.parse(JSON.stringify(customTheme)))
    setSaved(true)
  }

  return jsxs(ScrollArea, {
    className: 'h-full',
    children: [
      jsx('div', {
        className: cn('flex h-full flex-col gap-4 text-sm', wide ? 'mx-auto w-full max-w-2xl p-6' : 'p-3'),
        children: [
          jsxs('div', {
            className: 'flex items-center justify-between gap-2',
            children: [
              jsxs('div', {
                className: 'flex items-center gap-1.5',
                children: [
                  jsx(icons.Palette, { className: 'h-3.5 w-3.5 text-(--ui-accent)' }),
                  jsx('div', { className: 'text-[0.8125rem] font-semibold', children: '皮肤工坊' }),
                  jsx(Badge, {
                    variant: 'outline',
                    children: isForgeActive ? '皮肤工坊主题已激活' : '当前：' + activeTheme
                  })
                ]
              }),
              jsx(Tip, {
                label: '重置自定义主题',
                children: jsx(Button, {
                  variant: 'ghost',
                  size: 'sm',
                  onClick: resetAll,
                  children: jsx(icons.RefreshCw, { className: 'h-3.5 w-3.5' })
                })
              })
            ]
          }),
          jsxs('div', {
            className: 'flex items-center gap-2',
            children: [
              jsx('select', {
                value: applyName,
                onChange: e => setApplyName(e.target.value),
                className: cn(
                  'h-7 min-w-0 flex-1 rounded-md border border-(--ui-stroke-secondary) bg-(--ui-bg-elevated) px-2 text-[0.6875rem]',
                  'text-(--ui-text-primary) outline-none focus:border-(--ui-accent)'
                ),
                children: [
                  jsx('option', { value: CUSTOM_NAME, children: '自定义（已编辑）' }),
                  PRESETS.map(p => jsx('option', { key: p.name, value: p.name, children: p.label }))
                ]
              }),
              jsx(Button, {
                size: 'sm',
                onClick: () => {
                  const theme =
                    applyName === CUSTOM_NAME ? state : PRESETS.find(p => p.name === applyName) || state
                  void activateSkin(theme)
                },
                children: '应用'
              })
            ]
          }),
          !isForgeActive &&
            jsxs('div', {
              className: 'flex flex-col gap-1.5 rounded-md border border-(--ui-yellow) bg-(--ui-bg-secondary) p-2.5 text-[0.6875rem] leading-relaxed text-(--ui-text-secondary)',
              children: [
                jsxs('div', {
                  className: 'flex items-center gap-1.5 font-medium text-(--ui-text-primary)',
                  children: [
                    jsx(icons.Info, { className: 'h-3.5 w-3.5 text-(--ui-yellow)' }),
                    '皮肤工坊主题尚未激活——以下更改不会显示。'
                  ]
                }),
                jsx('p', {
                  className: 'text-[0.625rem]',
                  children:
                    '所有编辑都会自动保存。要查看效果：⌘K → 主题 → 选择「皮肤工坊 · 自定义」。'
                })
              ]
            }),
          jsx(Tabs, {
            value: tab,
            onValueChange: setTab,
            children: [
              jsx(TabsList, {
                children: [
                  jsx(TabsTrigger, { value: 'colors', children: '颜色' }),
                  jsx(TabsTrigger, { value: 'image', children: '背景' }),
                  jsx(TabsTrigger, { value: 'text', children: '文字' })
                ]
              }),
              tab === 'colors' &&
                jsxs('div', {
                  className: 'flex flex-col gap-4 pt-1',
                  children: [
                    jsx(Segmented, {
                      options: [
                        ['dark', '深色'],
                        ['light', '浅色']
                      ],
                      value: palette,
                      onChange: setPalette
                    }),
                    jsxs(Section, {
                      title: '配色模板（一键套用）',
                      children: [
                        jsx('div', {
                          className: 'flex flex-wrap gap-1.5',
                          children: COLOR_TEMPLATES.map(t =>
                            jsx('button', {
                              key: t.name,
                              className:
                                'flex items-center gap-1.5 rounded-md border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) px-2 py-1 text-[0.6875rem] text-(--ui-text-secondary) hover:border-(--ui-accent) hover:text-(--ui-text-primary)',
                              onClick: () => applyTemplate(t),
                              children: [
                                jsx('span', {
                                  className: 'flex items-center',
                                  children: t.swatches.slice(0, 4).map(c =>
                                    jsx('span', {
                                      key: c,
                                      className: 'h-2.5 w-2.5 rounded-full border border-black/20',
                                      style: { background: c }
                                    })
                                  )
                                }),
                                t.name
                              ]
                            })
                          )
                        }),
                        jsx('p', {
                          className: 'text-[0.625rem] leading-relaxed text-(--ui-text-quaternary)',
                          children: '点一下生成整套和谐配色（背景/文字/强调色/扩展色板），可继续微调。'
                        })
                      ]
                    }),
                    jsxs(Section, {
                      title: '核心',
                      children: jsx('div', {
                        className: 'grid grid-cols-1 gap-1.5',
                        children: MAIN_TOKENS.map(([key, label]) =>
                          jsx(ColorField, {
                            key: key,
                            label: label,
                            value: colors[key] || '#000000',
                            onChange: v => bumpColors({ [key]: v })
                          })
                        )
                      })
                    }),
                    jsxs(Section, {
                      title: '扩展调色板（应用固定色）',
                      children: jsxs('div', {
                        className: 'grid grid-cols-1 gap-1.5',
                        children: [
                          jsx('p', {
                            className: 'text-[0.625rem] leading-relaxed text-(--ui-text-quaternary)',
                            children: '应用固定使用的颜色（状态、差异、语法高亮）。皮肤工坊可以覆盖它们。'
                          }),
                          EXTRA_TOKENS.map(([key, label]) =>
                            jsx(ColorField, {
                              key: key,
                              label: label,
                              value: extras.extraColors[key] || '#888888',
                              onChange: v => bumpExtraColor(key, v)
                            })
                          )
                        ]
                      })
                    }),
                    jsxs(Section, {
                      title: '侧边栏（左侧菜单）',
                      children: jsxs('div', {
                        className: 'grid grid-cols-1 gap-1.5',
                        children: [
                          jsx('p', {
                            className: 'text-[0.625rem] leading-relaxed text-(--ui-text-quaternary)',
                            children:
                              '侧边栏菜单的逐元素颜色。置顶跟随条目颜色；悬停/激活仍会高亮（使用应用自带 token）。留空 = 使用主题默认色。'
                          }),
                          jsx(ColorResetField, {
                            label: '导航（新建会话 · 能力 · …）',
                            value: extras.sidebarNavColor,
                            defaultColor: colors.foreground,
                            onChange: v => bumpExtras({ sidebarNavColor: v }),
                            onReset: () => bumpExtras({ sidebarNavColor: null })
                          }),
                          jsx(ColorResetField, {
                            label: '分组标题（置顶、最近…）',
                            value: extras.sidebarSectionColor,
                            defaultColor: colors.foreground,
                            onChange: v => bumpExtras({ sidebarSectionColor: v }),
                            onReset: () => bumpExtras({ sidebarSectionColor: null })
                          }),
                          jsx(ColorResetField, {
                            label: '条目（会话和项目）',
                            value: extras.sidebarItemColor,
                            defaultColor: colors.foreground,
                            onChange: v => bumpExtras({ sidebarItemColor: v }),
                            onReset: () => bumpExtras({ sidebarItemColor: null })
                          })
                        ]
                      })
                    })
                  ]
                }),
              tab === 'image' &&
                jsxs('div', {
                  className: 'flex flex-col gap-4 pt-1',
                  children: [
                    jsx(Segmented, {
                      options: [
                        ['image', '图片'],
                        ['video', '动态视频']
                      ],
                      value: mediaTab,
                      onChange: setMediaTab
                    }),
                    mediaTab === 'image' &&
                      jsxs(Section, {
                        title: '背景图片',
                        children: [
                          jsxs('div', {
                            className: 'flex items-center gap-2',
                            children: [
                              jsx('input', {
                                ref: fileInputRef,
                                type: 'file',
                                accept: 'image/*',
                                className: 'hidden',
                                onChange: e => {
                                  pickLocalImage(e.target.files && e.target.files[0])
                                  e.target.value = ''
                                }
                              }),
                              jsx(Button, {
                                variant: 'outline',
                                size: 'sm',
                                onClick: () => fileInputRef.current && fileInputRef.current.click(),
                                children: jsxs('span', {
                                  className: 'flex items-center gap-1.5',
                                  children: [
                                    jsx(icons.FolderOpen, { className: 'h-3.5 w-3.5' }),
                                    '从本机选择…'
                                  ]
                                })
                              }),
                              localFile &&
                                jsx('span', {
                                  className: 'min-w-0 flex-1 truncate text-[0.625rem] text-(--ui-text-tertiary)',
                                  children: localFile.name + ' · ' + fmtSize(localFile.size)
                                })
                            ]
                          }),
                          jsx(Input, {
                            placeholder: '…或粘贴 URL（https://）',
                            value: extras.backgroundImage && !extras.backgroundImage.startsWith('data:') ? extras.backgroundImage : '',
                            onChange: e => bumpExtras({ backgroundImage: e.target.value || null })
                          }),
                          extras.backgroundImage &&
                            jsx(Button, {
                              variant: 'outline',
                              size: 'sm',
                              onClick: autoColorFromWallpaper,
                              className: 'self-start',
                              children: jsxs('span', {
                                className: 'flex items-center gap-1.5',
                                children: [
                                  jsx(icons.Palette, { className: 'h-3.5 w-3.5' }),
                                  '从图片自动配色'
                                ]
                              })
                            })
                        ]
                      }),
                    mediaTab === 'video' &&
                      jsxs(Section, {
                        title: '背景视频（循环播放）',
                        children: [
                          jsx('p', {
                            className: 'text-[0.625rem] leading-relaxed text-(--ui-text-quaternary)',
                            children:
                              '设置视频后优先于图片。静音循环播放，应用不可见时暂停，并遵循 macOS 的「减弱动态效果」。'
                          }),
                          jsxs('div', {
                            className: 'flex items-center gap-2',
                            children: [
                              jsx('input', {
                                ref: videoInputRef,
                                type: 'file',
                                accept: 'video/*,.mp4,.webm,.mov,.m4v,.ogv',
                                className: 'hidden',
                                onChange: e => {
                                  pickLocalVideo(e.target.files && e.target.files[0])
                                  e.target.value = ''
                                }
                              }),
                              jsx(Button, {
                                variant: 'outline',
                                size: 'sm',
                                onClick: () => videoInputRef.current && videoInputRef.current.click(),
                                children: jsxs('span', {
                                  className: 'flex items-center gap-1.5',
                                  children: [
                                    jsx(icons.MonitorPlay, { className: 'h-3.5 w-3.5' }),
                                    '从本机选择…'
                                  ]
                                })
                              }),
                              localVideo &&
                                jsx('span', {
                                  className: 'min-w-0 flex-1 truncate text-[0.625rem] text-(--ui-text-tertiary)',
                                  children:
                                    localVideo.name +
                                    ' · ' +
                                    fmtSize(localVideo.size) +
                                    (localVideo.persistent ? '' : ' · 不持久')
                                })
                            ]
                          }),
                          jsx(Input, {
                            placeholder: '…或粘贴视频 URL（https://…mp4|webm）',
                            value:
                              extras.backgroundVideo &&
                              !extras.backgroundVideo.startsWith('data:') &&
                              !extras.backgroundVideo.startsWith('blob:')
                                ? extras.backgroundVideo
                                : '',
                            onChange: e => {
                              const url = e.target.value || null
                              bumpExtras({ backgroundVideo: url, localVideoId: null })
                              if (url && !/\.(mp4|webm|mov|m4v|ogv)(\?.*)?$/i.test(url)) {
                                host.notify({
                                  kind: 'info',
                                  message:
                                    '提示：这看起来不是视频文件直链（结尾需是 .mp4/.webm）。网页播放页链接无法作为背景视频。'
                                })
                              }
                            }
                          }),
                          jsxs('div', {
                            className: 'flex flex-col gap-1',
                            children: [
                              jsx('p', {
                                className: 'text-[0.625rem] text-(--ui-text-quaternary)',
                                children: '已保存的视频（点击即用，无需重新上传）：'
                              }),
                              videoLib.length === 0
                                ? jsx('p', {
                                    className: 'text-[0.625rem] text-(--ui-text-quaternary)',
                                    children: '暂无——从本机选择视频后会自动保存在这里（最多保留 5 个）'
                                  })
                                : videoLib.map(entry =>
                                    jsxs('div', {
                                      key: entry.id,
                                      className: 'flex items-center gap-2',
                                      children: [
                                        jsx('button', {
                                          className: 'min-w-0 flex-1 truncate text-left text-xs text-(--ui-text-secondary) hover:text-(--ui-text-primary)',
                                          onClick: () => useVideoFromLib(entry),
                                          children:
                                            '▶ ' + entry.name + '（' + fmtSize(entry.size) + '）'
                                        }),
                                        jsx('button', {
                                          className: 'shrink-0 text-xs text-(--ui-destructive) hover:opacity-80',
                                          onClick: () => delVideoFromLib(entry.id),
                                          children: '✕ 删除'
                                        })
                                      ]
                                    })
                                  )
                            ]
                          })
                        ]
                      }),
                    jsx(Segmented, {
                      options: [
                        ['cover', '铺满'],
                        ['contain', '适应']
                      ],
                      value: extras.imageFit,
                      onChange: v => bumpExtras({ imageFit: v })
                    }),
                    jsxs(Section, {
                      title: '遮罩（压暗背景提升可读性）',
                      children: jsx('div', {
                        className: 'flex items-center gap-2',
                        children: [
                          jsx('input', {
                            type: 'range',
                            min: 0,
                            max: 0.9,
                            step: 0.05,
                            value: extras.overlayOpacity,
                            onChange: e => bumpExtras({ overlayOpacity: Number(e.target.value) }),
                            className: 'flex-1 accent-(--ui-accent)'
                          }),
                          jsx('span', {
                            className: 'w-9 text-right font-mono text-[0.625rem] text-(--ui-text-tertiary)',
                            children: Math.round(extras.overlayOpacity * 100) + '%'
                          })
                        ]
                      })
                    }),
                    jsxs(Section, {
                      title: '模糊（仅背景）',
                      children: jsx('div', {
                        className: 'flex items-center gap-2',
                        children: [
                          jsx('input', {
                            type: 'range',
                            min: 0,
                            max: 12,
                            step: 1,
                            value: extras.blur,
                            onChange: e => bumpExtras({ blur: Number(e.target.value) }),
                            className: 'flex-1 accent-(--ui-accent)'
                          }),
                          jsx('span', {
                            className: 'w-9 text-right font-mono text-[0.625rem] text-(--ui-text-tertiary)',
                            children: extras.blur + 'px'
                          })
                        ]
                      })
                    }),
                    extras.backgroundVideo
                      ? jsx(Button, {
                          variant: 'outline',
                          size: 'sm',
                          onClick: clearLocalVideo,
                          children: '移除视频'
                        })
                      : extras.backgroundImage
                        ? jsx(Button, {
                            variant: 'outline',
                            size: 'sm',
                            onClick: clearLocalFile,
                            children: '移除图片'
                          })
                        : jsx('p', {
                            className: 'text-[0.625rem] text-(--ui-text-quaternary)',
                            children: '无背景——主题使用纯色。'
                          })
                  ]
                }),
              // 背景特效（全局层）——独立于主题，可与任意配色主题搭配。
              jsxs(Section, {
                title: '背景特效（全局层）',
                children: jsxs('div', {
                  className: 'flex flex-col gap-2',
                  children: [
                    jsx(Segmented, {
                      options: [
                        ['auto', '跟随主题'],
                        ['none', '无'],
                        ['matrix', '数字墙'],
                        ['hanzi', '汉字雨']
                      ],
                      value: fx.mode,
                      onChange: v => bumpFx({ mode: v })
                    }),
                    fx.mode !== 'auto' &&
                      jsx('div', {
                        className: 'flex flex-col gap-2',
                        children: [
                          jsxs('div', {
                            className: 'flex items-center gap-2',
                            children: [
                              jsx('input', {
                                type: 'range',
                                min: 12,
                                max: 48,
                                step: 1,
                                value: fx.rainFontSize || (fx.mode === 'hanzi' ? 26 : 15),
                                onChange: e => bumpFx({ rainFontSize: Number(e.target.value) }),
                                className: 'flex-1 accent-(--ui-accent)'
                              }),
                              jsx('span', {
                                className: 'w-9 text-right font-mono text-[0.625rem] text-(--ui-text-tertiary)',
                                children: '字 ' + (fx.rainFontSize || (fx.mode === 'hanzi' ? 26 : 15)) + 'px'
                              })
                            ]
                          }),
                          jsxs('div', {
                            className: 'flex items-center gap-2',
                            children: [
                              jsx('input', {
                                type: 'range',
                                min: 0.2,
                                max: 2,
                                step: 0.05,
                                value:
                                  fx.rainSpeed ||
                                  (fx.mode === 'hanzi'
                                    ? extras.backgroundImage || extras.backgroundVideo
                                      ? 0.5
                                      : 0.3
                                    : 1),
                                onChange: e => bumpFx({ rainSpeed: Number(e.target.value) }),
                                className: 'flex-1 accent-(--ui-accent)'
                              }),
                              jsx('span', {
                                className: 'w-9 text-right font-mono text-[0.625rem] text-(--ui-text-tertiary)',
                                children:
                                  '速 ' +
                                  (fx.rainSpeed ||
                                    (fx.mode === 'hanzi'
                                      ? extras.backgroundImage || extras.backgroundVideo
                                        ? 0.5
                                        : 0.3
                                      : 1)).toFixed(2) +
                                  'x'
                              })
                            ]
                          })
                        ]
                      }),
                    jsxs('div', {
                      className: 'flex items-center justify-between gap-2',
                      children: [
                        jsx('span', {
                          className: 'text-[0.625rem] text-(--ui-text-tertiary)',
                          children: 'CRT 扫描线'
                        }),
                        jsx(Segmented, {
                          options: [
                            ['auto', '跟随主题'],
                            ['on', '开启'],
                            ['off', '关闭']
                          ],
                          value: fx.scanlines || 'auto',
                          onChange: v => bumpFx({ scanlines: v })
                        })
                      ]
                    }),
                    jsx('p', {
                      className: 'text-[0.625rem] leading-relaxed text-(--ui-text-quaternary)',
                      children:
                        fx.mode === 'auto'
                          ? '跟随各主题自带的特效。选择「数字墙」或「汉字雨」即可全局叠加——搭配任意配色主题都生效。'
                          : '已全局覆盖：切换任何配色主题都会保留此特效（数字墙为黑客帝国式纯数字；汉字雨为繁体汉字+米白雨滴+朱砂红点缀）。数字墙与扫描线互斥（自动跳过扫描线）。'
                    })
                  ]
                })
              }),
              tab === 'text' &&
                jsxs('div', {
                  className: 'flex flex-col gap-4 pt-1',
                  children: [
                    jsxs(Section, {
                      title: '文字加粗',
                      children: [
                        jsx(Segmented, {
                          options: BOLD_OPTIONS,
                          value: extras.boldLevel,
                          onChange: v => bumpExtras({ boldLevel: v })
                        }),
                        jsx('p', {
                          className: 'text-[0.625rem] leading-relaxed text-(--ui-text-quaternary)',
                          children:
                            '中等：有字重的文本（medium/semibold/bold）加重一级。强：正文字体整体加重。'
                        })
                      ]
                    }),
                    jsxs(Section, {
                      title: '字体',
                      children: [
                        jsx(Segmented, {
                          options: Object.entries(FONT_PRESETS).map(([key, p]) => [key, p.label]),
                          value: extras.fontFamily,
                          onChange: v => {
                            const preset = FONT_PRESETS[v]
                            if (!preset) return
                            bump({
                              typography: { fontSans: preset.fontSans, fontMono: preset.fontMono, fontUrl: preset.fontUrl },
                              forge: { ...extras, fontFamily: v }
                            })
                          }
                        }),
                        jsx('p', {
                          className: 'text-[0.625rem] leading-relaxed text-(--ui-text-quaternary)',
                          children: '应用于整个应用（sans + mono）。Google 字体按需加载。'
                        })
                      ]
                    }),
                    jsxs(Section, {
                      title: '文字大小',
                      children: jsx('div', {
                        className: 'flex items-center gap-2',
                        children: [
                          jsx('input', {
                            type: 'range',
                            min: 11,
                            max: 18,
                            step: 0.5,
                            value: extras.fontSize,
                            onChange: e => bumpExtras({ fontSize: Number(e.target.value) }),
                            className: 'flex-1 accent-(--ui-accent)'
                          }),
                          jsx('span', {
                            className: 'w-12 text-right font-mono text-[0.625rem] text-(--ui-text-tertiary)',
                            children: extras.fontSize + 'px'
                          })
                        ]
                      })
                    }),
                    jsxs(Section, {
                      title: '强调色',
                      children: jsxs('div', {
                        className: 'grid grid-cols-1 gap-1.5',
                        children: [
                          jsx('p', {
                            className: 'text-[0.625rem] leading-relaxed text-(--ui-text-quaternary)',
                            children: '聊天 Markdown 中的标题、链接和代码/文件名。留空 = 使用主题默认色。'
                          }),
                          jsx(ColorResetField, {
                            label: '标题（h1–h4）',
                            value: extras.headingColor,
                            defaultColor: colors.foreground,
                            onChange: v => bumpExtras({ headingColor: v }),
                            onReset: () => bumpExtras({ headingColor: null })
                          }),
                          jsx(ColorResetField, {
                            label: '链接',
                            value: extras.linkColor,
                            defaultColor: colors.midground || colors.ring || colors.primary,
                            onChange: v => bumpExtras({ linkColor: v }),
                            onReset: () => bumpExtras({ linkColor: null })
                          }),
                          jsx(ColorResetField, {
                            label: '代码 / 文件名',
                            value: extras.codeColor,
                            defaultColor: colors.mutedForeground,
                            onChange: v => bumpExtras({ codeColor: v }),
                            onReset: () => bumpExtras({ codeColor: null })
                          })
                        ]
                      })
                    }),
                    saved
                      ? jsx('p', {
                          className: 'text-[0.625rem] text-(--ui-text-quaternary)',
                          children: '✓ 更改已保存并实时应用'
                        })
                      : jsx('p', {
                          className: 'text-[0.625rem] text-(--ui-text-tertiary)',
                          children: '…应用中'
                        })
                  ]
                }),
              diag &&
                jsxs(Section, {
                  title: '诊断（每 2 秒刷新）',
                  children: jsx('div', {
                    className: 'grid grid-cols-2 gap-1 font-mono text-[0.625rem] text-(--ui-text-tertiary)',
                    children: [
                      jsx('div', { children: '主题: ' + (diag.active || '?') }),
                      jsx('div', { children: '注入CSS: ' + (diag.injected || 0) + 'B' }),
                      jsx('div', { children: '代码块: ' + (diag.blocks || 0) }),
                      jsx('div', { children: '围栏: ' + (diag.fences || 0) }),
                      jsx('div', { children: '行内代码: ' + (diag.inlines || 0) }),
                      jsx('div', {
                        className: 'col-span-2',
                        children: diag.quota
                          ? '存储配额: ' + fmtSize(diag.quota) + ' / 已用 ' + fmtSize(diag.usage || 0)
                          : ''
                      }),
                      jsx('div', { children: '当前视频ID: ' + (diag.vid || '无') }),
                      jsx('div', { children: '雨状态: ' + (diag.rainState || '?') }),
                      jsx('div', { children: '主题注册: ' + (diag.themeCount ?? '?') + '个' }),
                      jsx('div', { children: '汉字雨已注册: ' + (diag.hanziRegistered ? '✓' : '✗') }),
                      jsx('div', { children: 'IDB读取: ' + (diag.idbSize === null ? '未测' : diag.idbSize < 0 ? '❌ 数据丢失' : fmtSize(diag.idbSize)) }),
                      jsx('div', { className: 'col-span-2', children: '媒体库(' + (diag.libCount || 0) + '): ' + (diag.libNames || '空') }),
                      jsx('div', { children: diag.error ? '错误: ' + diag.error : '代码块背景: ' + (diag.bg || '无') }),
                      jsx('div', { className: 'col-span-2', children: '代码块文字: ' + (diag.color || '无') })
                    ]
                  })
                })
            ]
          })
        ]
      })
    ]
  })
}
