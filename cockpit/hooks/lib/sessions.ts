/**
 * Claude Code's own sessions, read from the transcripts it writes.
 *
 * One `<session-id>.jsonl` per session, in the project's transcript directory.
 * The directory is never guessed: the classic hook inputs carry this session's
 * `transcript_path`, which sits in it.
 */

import type { Past } from '../../types'
import { titleOf, toPosix } from './format'

/**
 * `$.fs.read` rejects a file over 4 MiB, and has no range. A transcript larger than this
 * is read with `git grep` instead, which hands back only the rows that name it.
 */
export const MAX_READ_BYTES = 4 * 1024 * 1024

/** One directory entry, as `$.fs.list` describes it. */
export type Entry = { name: string; kind: 'file' | 'dir' | 'other'; size: number; mtimeMs: number }

/** One transcript found on disk, with the project directory it sits in. */
export type Found = Entry & { dir: string }

/** The directory a transcript path sits in. */
export const dirOf = (transcriptPath: string): string =>
  toPosix(transcriptPath).split('/').slice(0, -1).join('/')

/** The session id a transcript file is named for. */
export const idOf = (name: string): string => name.replace(/\.jsonl$/, '')

/**
 * The newest transcripts first, at most `keep` of them: the sessions worth listing.
 * Entries too large to read keep their place, titled by nothing.
 */
export const pickRecent = <T extends Entry>(entries: readonly T[], keep: number): T[] =>
  entries
    .filter(one => one.kind === 'file' && one.name.endsWith('.jsonl') && one.size > 0)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, keep)

/** True for a line the person did not type: a slash command's echo, a system reminder. */
const isNoise = (text: string): boolean =>
  text.startsWith('<') || text.startsWith('Caveat:') || text.startsWith('[Request interrupted')

/** The text of a transcript row's message, whether it holds a string or content blocks. */
const textOf = (row: Record<string, unknown>): string => {
  const message = row['message']
  if (typeof message !== 'object' || message === null) return ''
  const content = (message as Record<string, unknown>)['content']
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  return content
    .filter(
      (block): block is { type: string; text: string } =>
        typeof block === 'object' &&
        block !== null &&
        (block as { type?: string }).type === 'text' &&
        typeof (block as { text?: string }).text === 'string',
    )
    .map(block => block.text)
    .join(' ')
}

/**
 * What a session was about: its first typed prompt, as a one-line title.
 *
 * Returns null when the transcript holds no prompt yet — a session opened and
 * left alone — so the caller can fall back to the id.
 */
export const titleFromTranscript = (jsonl: string, limit = 400): string | null => {
  const lines = jsonl.split('\n')

  for (let index = 0; index < Math.min(lines.length, limit); index += 1) {
    const line = lines[index]
    if (line === undefined || line === '') continue

    let row: Record<string, unknown>
    try {
      row = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }

    if (row['type'] !== 'user' || row['isMeta'] === true) continue
    const text = textOf(row).trim()
    if (text === '' || isNoise(text)) continue

    return titleOf(text)
  }

  return null
}

/**
 * What `/resume` shows of a session, read off its transcript: the name given with
 * `/rename`, else the title Claude Code wrote for it, else its first typed prompt.
 */
export type Meta = {
  /** The last `custom-title`, `ai-title` or `summary` row, in that order of precedence. */
  title: string | null
  /** The first prompt the person typed, as a one-line title. */
  prompt: string | null
  /** The directory the session ran in: where `claude --resume` must run to find it. */
  cwd: string | null
}

/** The string field `key` of a row, or null. */
const field = (row: Record<string, unknown>, key: string): string | null => {
  const value = row[key]

  return typeof value === 'string' && value.trim() !== '' ? value : null
}

/**
 * A transcript's title, prompt and directory, from its rows.
 *
 * Takes the whole file or just the rows `git grep` matched in it: each row stands alone.
 * Titles are appended as a session goes on, so the last of each kind wins.
 */
export const metaFromTranscript = (jsonl: string): Meta => {
  let custom: string | null = null
  let ai: string | null = null
  let summary: string | null = null
  let cwd: string | null = null
  let prompt: string | null = null

  for (const line of jsonl.split('\n')) {
    if (line === '') continue

    let row: Record<string, unknown>
    try {
      row = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }

    const type = row['type']
    if (type === 'custom-title') custom = field(row, 'customTitle') ?? custom
    else if (type === 'ai-title') ai = field(row, 'aiTitle') ?? ai
    else if (type === 'summary') summary = field(row, 'summary') ?? summary
    cwd ??= field(row, 'cwd')

    if (prompt === null && type === 'user' && row['isMeta'] !== true) {
      const text = textOf(row).trim()
      if (text !== '' && !isNoise(text)) prompt = titleOf(text)
    }
  }

  const title = custom ?? ai ?? summary

  return { title: title === null ? null : titleOf(title), prompt, cwd: cwd === null ? null : toPosix(cwd) }
}

/**
 * The `git grep` runs that read a transcript too large for `$.fs.read`, each from the
 * transcript's own directory (git refuses a path outside the one it runs in): the title
 * rows, then the first user rows, which carry the first prompt and the directory.
 */
export const grepArgv = (name: string): readonly (readonly string[])[] => [
  ['git', 'grep', '--no-index', '-h', '-E', '"type":"(custom-title|ai-title|summary)"', '--', name],
  ['git', 'grep', '--no-index', '-h', '-m', '40', '-F', '"type":"user"', '--', name],
]

/** True when a session has something to resume: a prompt, or a name it was given. */
export const isResumable = (meta: Meta): boolean => meta.title !== null || meta.prompt !== null

/** The last segment of a directory: the project's name. */
export const projectOf = (dir: string): string =>
  toPosix(dir).split('/').filter(one => one !== '').at(-1) ?? dir

/**
 * One listed session, titled as `/resume` titles it.
 *
 * The project comes from the directory the session ran in; a transcript that never
 * said falls back to its folder's name, which is that directory with `-` for each
 * separator.
 */
export const toPast = (found: Found, meta: Meta | null): Past => ({
  id: idOf(found.name),
  at: found.mtimeMs,
  title: meta?.title ?? meta?.prompt ?? idOf(found.name).slice(0, 8),
  cwd: meta?.cwd ?? null,
  project: meta?.cwd ? projectOf(meta.cwd) : projectOf(found.dir),
})

/** How long ago a moment was, as the list says it: `now`, `12m`, `3h`, `4d`, `2w`. */
export const ago = (at: number, now: number): string => {
  const minutes = Math.floor(Math.max(0, now - at) / 60000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`
  if (minutes < 14 * 1440) return `${Math.floor(minutes / 1440)}d`

  return `${Math.floor(minutes / (7 * 1440))}w`
}

/** The command that returns to a session, for the clipboard. */
export const resumeCommand = (id: string): string => `claude --resume ${id}`
