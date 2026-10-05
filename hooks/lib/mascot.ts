/**
 * The mascot: what it does is what the session is doing. Pure, so it tests without the engine.
 *
 * One look at the band answers "what is happening, and do I need to do anything?" — the
 * sprite moves differently for each, and the line beside it says it in words.
 */

import type { MascotActivity } from '../../types'

export type { MascotActivity }

/** The tool a call names, as the activity the mascot acts out. */
export const activityOfTool = (tool: string): MascotActivity => {
  if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(tool)) return 'writing'
  if (tool === 'Bash') return 'running'
  if (tool === 'TodoWrite') return 'planning'
  if (['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch', 'LS'].includes(tool)) return 'reading'

  return 'thinking'
}

// Claude's own mascot, with a second pair of arms at the head's lower corners: four in all.
const HEAD = '▗▐▛███▜▌▖'
const BLINK = '▗▐▀███▀▌▖'
/** The upper pair raised. */
const HEAD_UP = '▝▐▛███▜▌▘'
const BODY = '▝▜█████▛▘'
const ARMS_UP = '▗▟█████▙▖'
const WAVE_LEFT = '▗▟█████▛▘'
const WAVE_RIGHT = '▝▜█████▙▖'
const LEGS = '  ▘▘ ▝▝  '
const STEP = '  ▝▘ ▘▝  '

/** The mascot's three rows for an activity at a frame; every row nine columns wide. */
export const spriteFor = (activity: MascotActivity, frame: number): [string, string, string] => {
  const even = frame % 2 === 0

  switch (activity) {
    case 'idle':
      // Still, with a blink now and then.
      return [frame % 12 === 0 ? BLINK : HEAD, BODY, LEGS]
    case 'thinking':
      // A slow bob.
      return frame % 4 < 2 ? [HEAD, BODY, LEGS] : [BLINK, BODY, LEGS]
    case 'writing':
    case 'running':
    case 'reading':
    case 'planning':
      // Busy feet, and the upper arms going up and down with them.
      return [even ? HEAD : HEAD_UP, BODY, even ? LEGS : STEP]
    case 'done':
      // All four arms up, and down, and up.
      return even ? [HEAD_UP, ARMS_UP, LEGS] : [HEAD, BODY, LEGS]
    case 'waiting':
      // Waving for attention.
      return [HEAD, even ? WAVE_LEFT : WAVE_RIGHT, LEGS]
    case 'alert': {
      // A shake: the whole sprite jumps a column each way.
      const shake = (row: string) => (even ? ` ${row.slice(0, -1)}` : `${row.slice(1)} `)

      return [shake(HEAD), shake(BODY), shake(LEGS)]
    }
  }
}

/** Short and plain: one line that says what is going on, and whether it is your turn. */
export const describe = (activity: MascotActivity, detail: string | null): string => {
  const about = detail === null || detail === '' ? '' : ` ${detail}`

  switch (activity) {
    case 'idle':
      return 'ready'
    case 'thinking':
      return 'thinking…'
    case 'writing':
      return `writing${about}`
    case 'running':
      return `running${about}`
    case 'reading':
      return `reading${about}`
    case 'planning':
      return 'updating the plan'
    case 'done':
      return '✓ done — your turn'
    case 'waiting':
      return `⏳ needs you${detail === null ? '' : `: ${detail}`}`
    case 'alert':
      return `⚠ failed${about}`
  }
}

/**
 * What a call is about, as the mascot's line says it: a file by its name, a command by
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
