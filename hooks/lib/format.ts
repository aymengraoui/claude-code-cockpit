/** Pure formatting helpers. No engine, no I/O — so the tests can be plain unit tests. */

const BACKSLASH = String.fromCharCode(92)

/** Windows paths read as POSIX ones, so one code path handles both. */
export const toPosix = (path: string): string => path.split(BACKSLASH).join('/')

const FILLED = '▰'
const EMPTY = '▱'

/** A 0-100 percentage as a bar of `width` cells. */
export const bar = (percent: number, width = 5): string => {
  const safe = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0
  const filled = Math.round((safe / 100) * width)

  return FILLED.repeat(filled) + EMPTY.repeat(width - filled)
}

/** The palette key a 0-100 figure should be drawn in: calm until it is worth noticing. */
export const heat = (percent: number): string => {
  if (percent >= 90) return 'error'
  if (percent >= 75) return 'warning'
  if (percent >= 50) return 'claude'

  return 'success'
}

/** `2h14`, `18m`, `4d` until an ISO timestamp; null when it is past or unparsable. */
export const until = (iso: string | null, now = Date.now()): string | null => {
  if (iso === null) return null
  const ms = new Date(iso).getTime() - now
  if (!Number.isFinite(ms) || ms <= 0) return null

  const minutes = Math.round(ms / 60000)
  if (minutes >= 1440) return `${Math.round(minutes / 1440)}d`
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}`

  return `${minutes}m`
}

/**
 * A path cut to `width` from the left, so the filename always survives:
 * `src/engine/parse.ts` at 14 becomes `…ngine/parse.ts`.
 */
export const shortPath = (path: string, width: number): string => {
  const clean = toPosix(path)
  if (clean.length <= width || width < 2) return clean

  return `…${clean.slice(clean.length - (width - 1))}`
}

/** A command cut to `width` from the right, where the verb is. */
export const shortText = (text: string, width: number): string => {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= width) return clean
  if (width < 2) return clean.slice(0, width)

  return `${clean.slice(0, width - 1)}…`
}

/** `74k`, `1.2M`, `980` — a token count at a glance. */
export const kilo = (n: number): string => {
  if (!Number.isFinite(n)) return '0'
  if (Math.abs(n) >= 1000000) return `${(n / 1000000).toFixed(1)}M`
  if (Math.abs(n) >= 1000) return `${Math.round(n / 1000)}k`

  return String(Math.round(n))
}

const MODE_LABELS: Readonly<Record<string, string>> = {
  default: 'manual',
  acceptEdits: 'accept edits',
  plan: 'plan',
  auto: 'auto',
  dontAsk: "don't ask",
  bypassPermissions: 'bypass',
}

/** The engine's permission mode in the words the footer uses for it. */
export const modeLabel = (mode: string): string => MODE_LABELS[mode] ?? mode

/** A prompt reduced to one short line, to title a session in the history list. */
export const titleOf = (text: string, max = 64): string => {
  const line = text.replace(/\s+/g, ' ').trim()
  if (line === '') return 'untitled'

  return line.length <= max ? line : `${line.slice(0, max - 1)}…`
}

const MODEL_LABELS: Readonly<Record<string, string>> = {
  'claude-opus-5': 'Opus 5',
  'claude-opus-5-5': 'Opus 5.5',
  'claude-sonnet-5-5': 'Sonnet 5.5',
  'claude-fable-5-1': 'Fable 5.1',
  'claude-haiku-4-5-20251001': 'Haiku 4.5',
}

/** `claude-sonnet-5-5` as `Sonnet 5.5`; an unknown id prettified rather than hidden. */
export const modelLabel = (id: string): string => {
  const known = MODEL_LABELS[id]
  if (known !== undefined) return known

  const [family, ...rest] = id
    .replace(/^claude-/, '')
    .replace(/-\d{8}$/, '')
    .split('-')
  if (family === undefined || family === '') return id
  const name = family.charAt(0).toUpperCase() + family.slice(1)
  const version = rest.join('.')

  return version === '' ? name : `${name} ${version}`
}
