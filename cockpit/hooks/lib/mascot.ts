/**
 * What the session is doing, as the chime, the toasts and the progress shimmer read it.
 * Pure, so it tests without the engine.
 */

import type { MascotActivity } from '../../types'

export type { MascotActivity }

/** The tool a call names, as the activity it stands for. */
export const activityOfTool = (tool: string): MascotActivity => {
  if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(tool)) return 'writing'
  if (tool === 'Bash') return 'running'
  if (tool === 'TodoWrite') return 'planning'
  if (['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch', 'LS'].includes(tool)) return 'reading'

  return 'thinking'
}

/**
 * What a call is about, said short: a file by its name, a command by
 * itself — without a leading `cd <dir> &&`, which only says where it ran. Taking the part
 * after the last slash suits a path and mangles a command, so the two are told apart.
 */
export const aboutCall = (tool: string, subject: string): string => {
  if (tool !== 'Bash') {
    const segments = subject.split(String.fromCharCode(92)).join('/').split('/').filter(one => one !== '')

    return segments.at(-1) ?? subject
  }

  return subject.replace(/^\s*cd\s+("[^"]*"|'[^']*'|\S+)\s*(&&|;)\s*/, '').trim()
}

/** How long a turn must run before its end is worth a chime: attention drifts by then. */
export const CHIME_AFTER_MS = 30_000
