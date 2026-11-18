/**
 * example-desktop-composer-buttons — reference example for the Hermes Desktop
 * composer surface.
 *
 * A row of one-click prompt buttons above the chat input. Clicking one sends
 * its prompt exactly as if the user typed it and pressed Enter:
 *
 *   ctx.register({ area: COMPOSER_AREAS.top, render })   ← the SDK surface
 *   host.composer.submit(null, prompt)                   ← the supported send door
 *
 * The button list is a JSON file in the plugin's own data folder
 * (ctx.files, handle 'data'), seeded on first load and re-read on a timer, so
 * a user edits buttons without touching code.
 *
 * Things to know before copying this:
 *
 *   1. A disk plugin is loaded UNCOMPILED, so JSX will not parse. UI is built
 *      with jsx() from react/jsx-runtime, and only `@hermes/plugin-sdk`,
 *      `react` and `react/jsx-runtime` resolve.
 *   2. host.composer.submit is fail-closed: with no focused chat it returns
 *      false and sends nothing. Tell the user instead of failing silently.
 *   3. Use ctx.setInterval, not a bare setInterval — it is cleared when the
 *      plugin is disabled or hot-reloaded.
 */

import { Button, COMPOSER_AREAS, atom, host, useValue } from '@hermes/plugin-sdk'
import { jsx } from 'react/jsx-runtime'

const FILE = 'buttons.json'
const RELOAD_MS = 5000
const MAX_BUTTONS = 12
const MAX_LABEL = 40

/** Written to the data folder the first time the plugin loads. */
const DEFAULT_BUTTONS = [
  { label: 'Status', prompt: 'Give me a short status update on what we are working on.' },
  { label: "What's blocked?", prompt: "What's blocked right now? For each item, say why and what would unblock it." },
  { label: "What's due today?", prompt: "What's due today, and is anything overdue?" }
]

const $buttons = atom(DEFAULT_BUTTONS)

/** Keep only well-formed { label, prompt } entries; null when the file isn't a list. */
function parseButtons(text) {
  let raw
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (!Array.isArray(raw)) return null
  return raw
    .filter(b => b && typeof b.label === 'string' && typeof b.prompt === 'string')
    .map(b => ({ label: b.label.trim().slice(0, MAX_LABEL), prompt: b.prompt.trim() }))
    .filter(b => b.label && b.prompt)
    .slice(0, MAX_BUTTONS)
}

async function loadButtons(files) {
  const res = await files.readText('data', FILE)
  if (!res.ok) {
    if (res.error === 'not-found') {
      await files.writeText('data', FILE, JSON.stringify(DEFAULT_BUTTONS, null, 2) + '\n')
    }
    return
  }
  const next = parseButtons(res.text)
  if (next && JSON.stringify(next) !== JSON.stringify($buttons.get())) $buttons.set(next)
}

function send(prompt) {
  if (!host.composer.submit(null, prompt)) {
    host.notify({ kind: 'warning', message: 'Click into a chat first, then press the button again.' })
  }
}

function ButtonRow() {
  const buttons = useValue($buttons)
  if (!buttons.length) return null
  return jsx('div', {
    className: 'flex flex-wrap items-center gap-1.5 pb-1',
    children: buttons.map(b =>
      jsx(
        Button,
        {
          size: 'xs',
          variant: 'outline',
          className: 'h-6 rounded-full px-2.5 text-xs',
          title: b.prompt,
          onClick: () => send(b.prompt),
          children: b.label
        },
        b.label
      )
    )
  })
}

export default {
  id: 'example-desktop-composer-buttons',
  name: 'Composer buttons (example)',
  description: 'One-click prompt buttons above the chat input.',
  register(ctx) {
    ctx.register({ id: 'row', area: COMPOSER_AREAS.top, order: 10, render: () => jsx(ButtonRow, {}) })
    if (!ctx.files) return // older app: the defaults stay in memory
    void loadButtons(ctx.files)
    ctx.setInterval(() => void loadButtons(ctx.files), RELOAD_MS)
  }
}
