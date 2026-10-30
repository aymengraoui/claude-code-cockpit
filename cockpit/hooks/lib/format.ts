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

/** The purples the shimmer cycles through: dark to bright and back, as ultrathink's band. */
export const SHIMMER = ['#5b2a86', '#7c3aed', '#8b5cf6', '#bb9af7', '#e9d5ff', '#bb9af7', '#8b5cf6', '#7c3aed']

/**
 * A 0-100 bar whose filled cells each take a purple, the band moving one cell per
 * frame so a bright crest sweeps across it. Empty cells carry no colour of their own.
 */
export const shimmer = (percent: number, width: number, frame: number): { char: string; color: string | null }[] =>
  Array.from(bar(percent, width), (char, index) => ({
    char,
    color: char === FILLED ? (SHIMMER[(((index - frame) % SHIMMER.length) + SHIMMER.length) % SHIMMER.length] ?? null) : null,
  }))

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

/**
 * The words the footer draws for each permission mode, from the engine's own tables.
 *
 * This is a lookup of the engine's exact value, not a reading of the screen: `auto` is
 * always `auto mode on`. Manual draws no pill in the footer; its own name stands in.
 */
const FOOTER_MODES: Readonly<Record<string, string>> = {
  default: 'manual mode',
  acceptEdits: 'accept edits on',
  plan: 'plan mode on',
  auto: 'auto mode on',
  bypassPermissions: 'bypass permissions on',
  dontAsk: "don't ask on",
}

/** A permission mode as the footer words it; a mode it does not know, as reported. */
export const footerMode = (mode: string): string => FOOTER_MODES[mode] ?? mode

/** A turn's length as people say it: `45s`, `3m 12s`, `1h 04m`. */
export const spoken = (ms: number): string => {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`

  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
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
