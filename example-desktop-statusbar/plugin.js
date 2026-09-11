/**
 * example-desktop-statusbar — reference example for the Hermes Desktop
 * status-bar surface.
 *
 * A chip in the bottom-right status bar that paints a state (here: DeepSeek's
 * peak / off-peak rate) with an icon and a countdown, and explains itself on
 * hover. It is the shipped version of a standalone plugin, trimmed to the one
 * surface it demonstrates:
 *
 *   ctx.register({ area: STATUSBAR_AREAS.right, render })   ← the SDK surface
 *
 * Three things to know before copying this:
 *
 *   1. A disk plugin is loaded UNCOMPILED, so JSX will not parse. UI is built
 *      with jsx()/jsxs() from react/jsx-runtime, and only `@hermes/plugin-sdk`,
 *      `react` and `react/jsx-runtime` resolve.
 *   2. The app's tooltip paints its background on inline flow only. Separate
 *      lines with <br/>; a block child collapses the tooltip to an empty chip.
 *   3. Style with theme variables (`var(--ui-accent)`, `var(--ui-text-*)`) —
 *      never a hardcoded colour — so the chip follows every theme.
 *
 * Peak hours, UTC, Monday through Friday: 01:00-04:00 and 06:00-10:00;
 * everything else is off-peak. Source:
 * https://api-docs.deepseek.com/quick_start/pricing (footnote 1).
 */

import { STATUSBAR_AREAS, Tip } from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'
import { useEffect, useState } from 'react'

/** Peak windows in UTC hours. `[from, to)` — `to` is exclusive. */
const PEAK_WINDOWS = [
  [1, 4],
  [6, 10]
]

/** How often the state is recomputed (the countdown is minute-granular). */
const CHECK_MS = 30_000

/** Whale: body + tail + spout, on a 24x24 viewBox. */
const WHALE = [
  'M2.5 13.6C2.5 9.4 5.6 6.4 9.6 6.4c4.2 0 7.4 3.1 7.4 7.2 0 4.1-3.2 7.2-7.4 7.2-4 0-7.1-3-7.1-7.2Z',
  'M16.6 13.6c1.3-.5 2.4-1.5 3.1-2.8.3-.5 1-.5 1.2.1.5 1.1.8 2.3.8 3.5s-.3 2.4-.8 3.5c-.2.6-.9.6-1.2.1-.7-1.3-1.8-2.3-3.1-2.8Z',
  'M7.2 5.4c-.5-1.6.3-3.3 2-4-.4 1.3-.1 2.2.5 2.9.5.6.3 1.5-.5 1.9-.9.4-1.8 0-2-.8Z'
]

export function isPeak(date) {
  const day = date.getUTCDay() // 0 = Sunday … 6 = Saturday
  if (day === 0 || day === 6) {
    return false
  }
  const hour = date.getUTCHours()
  return PEAK_WINDOWS.some(([from, to]) => hour >= from && hour < to)
}

/** Next rate switch after `from`, or null if none is found. */
export function nextChange(from) {
  const peak = isPeak(from)
  const cursor = new Date(from)
  cursor.setUTCSeconds(0, 0)
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1)
  // Minute-by-minute sweep: the longest jump is the weekend (~3 days), so an
  // 8-day margin covers it without any day arithmetic.
  for (let i = 0; i < 60 * 24 * 8; i++) {
    if (isPeak(cursor) !== peak) {
      return cursor
    }
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1)
  }
  return null
}

export function fmtLeft(ms) {
  const minutes = Math.max(0, Math.round(ms / 60_000))
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const mins = minutes % 60
  if (days > 0) {
    return `${days}d ${hours}h`
  }
  if (hours > 0) {
    return `${hours}h${String(mins).padStart(2, '0')}m`
  }
  return `${mins}m`
}

/** Local time of the switch, prefixed with the weekday if it is not today.
 *  Pinned to en-US so the label always matches the (English) tooltip text. */
export function fmtLocal(when, now) {
  const time = when.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
  return when.toDateString() === now.toDateString()
    ? time
    : `${when.toLocaleDateString('en-US', { weekday: 'short' })} ${time}`
}

function Chip() {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), CHECK_MS)
    return () => clearInterval(id)
  }, [])

  const offPeak = !isPeak(now)
  const change = nextChange(now)
  const left = change ? fmtLeft(change - now) : ''
  const at = change ? fmtLocal(change, now) : ''

  // Two short lines: which rate is running now, and until when. The app's
  // tooltip paints its background on inline flow only, so the break is a <br/>.
  const tip = jsxs('span', {
    children: [
      offPeak ? 'Off-peak · 50% off' : 'Peak · full price',
      jsx('br', { key: 'br' }),
      change ? `Ends ${at} · in ${left}` : 'No upcoming switch'
    ]
  })

  return jsx(Tip, {
    label: tip,
    children: jsxs('span', {
      className: 'inline-flex h-full items-center gap-1 px-1.5 text-[0.6875rem]',
      style: { color: offPeak ? 'var(--ui-accent)' : 'var(--ui-text-quaternary)' },
      children: [
        jsx('svg', {
          width: 12,
          height: 12,
          viewBox: '0 0 24 24',
          'aria-hidden': 'true',
          children: WHALE.map((d, i) => jsx('path', { d, fill: 'currentColor', key: i }))
        }),
        jsx('span', { style: { fontVariantNumeric: 'tabular-nums' }, children: left })
      ]
    })
  })
}

export default {
  id: 'example-desktop-statusbar',
  name: 'Status Bar Chip Example',
  register(ctx) {
    ctx.register({
      id: 'chip',
      area: STATUSBAR_AREAS.right,
      order: 120,
      render: () => jsx(Chip, {})
    })
  }
}
