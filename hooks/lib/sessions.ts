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
 * A transcript larger than this is listed without its title rather than read.
 *
 * `$.fs.read` has no range, so a title costs reading the whole file — and the longest
 * sessions, the ones most worth resuming, are the largest. The cap is therefore generous
 * and the cost paid once: a title cannot change, so it is cached in `$.store` for good.
 */
export const MAX_READ_BYTES = 32 * 1024 * 1024

/** One directory entry, as `$.fs.list` describes it. */
export type Entry = { name: string; kind: 'file' | 'dir' | 'other'; size: number; mtimeMs: number }

/** The directory a transcript path sits in. */
export const dirOf = (transcriptPath: string): string =>
  toPosix(transcriptPath).split('/').slice(0, -1).join('/')

/** The session id a transcript file is named for. */
export const idOf = (name: string): string => name.replace(/\.jsonl$/, '')

/**
 * The newest transcripts first, at most `keep` of them: the sessions worth listing.
 * Entries too large to read keep their place, titled by nothing.
 */
export const pickRecent = (entries: readonly Entry[], keep: number): Entry[] =>
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

/** One listed session, titled where a title could be had. */
export const toPast = (entry: Entry, title: string | null): Past => ({
  id: idOf(entry.name),
  at: entry.mtimeMs,
  title: title ?? idOf(entry.name).slice(0, 8),
})

/** The command that returns to a session, for the clipboard. */
export const resumeCommand = (id: string): string => `claude --resume ${id}`
