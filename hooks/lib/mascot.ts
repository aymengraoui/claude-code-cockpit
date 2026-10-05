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

// Two rows, seven columns, four arms: the corners of each row are the arms, the middle
// the head (its eyes) and the body. Every frame keeps that size.
const EYES = '▐▛█▜▌'
const BLINK = '▐▀█▀▌'
const BODY = '▜███▛'

/** Arms as the corner marks of a row: down-and-out, or raised. */
const LEFT_DOWN = '▗'
const LEFT_OUT = '▝'
const RIGHT_DOWN = '▖'
const RIGHT_OUT = '▘'
const LEFT_UP = '▘'
const RIGHT_UP = '▝'

const pose = (top: [string, string, string], bottom: [string, string, string]): [string, string] => [
  top.join(''),
  bottom.join(''),
]

const REST = pose([LEFT_DOWN, EYES, RIGHT_DOWN], [LEFT_OUT, BODY, RIGHT_OUT])

/** The mascot's two rows for an activity at a frame; every row seven columns wide. */
export const spriteFor = (activity: MascotActivity, frame: number): [string, string] => {
  const even = frame % 2 === 0

  switch (activity) {
    case 'idle':
      // At rest, with a blink now and then.
      return frame % 12 === 0 ? pose([LEFT_DOWN, BLINK, RIGHT_DOWN], [LEFT_OUT, BODY, RIGHT_OUT]) : REST
    case 'thinking':
      // A slow blink while it works out what to do.
      return frame % 4 < 2 ? REST : pose([LEFT_DOWN, BLINK, RIGHT_DOWN], [LEFT_OUT, BODY, RIGHT_OUT])
    case 'writing':
    case 'running':
    case 'reading':
    case 'planning':
      // All four arms at it, crosswise: the upper left with the lower right, then the others.
      return even
        ? pose([LEFT_UP, EYES, RIGHT_DOWN], [LEFT_DOWN, BODY, RIGHT_OUT])
        : pose([LEFT_DOWN, EYES, RIGHT_UP], [LEFT_OUT, BODY, RIGHT_DOWN])
    case 'done':
      // All four arms up, and down, and up.
      return even ? pose([LEFT_UP, EYES, RIGHT_UP], [LEFT_UP, BODY, RIGHT_UP]) : REST
    case 'waiting':
      // One arm waving for you.
      return even ? pose([LEFT_UP, EYES, RIGHT_DOWN], [LEFT_OUT, BODY, RIGHT_OUT]) : REST
    case 'alert':
      // Arms flung up and back, blinking: something went wrong.
      return even
        ? pose([LEFT_UP, BLINK, RIGHT_UP], [LEFT_UP, BODY, RIGHT_UP])
        : pose([LEFT_DOWN, EYES, RIGHT_DOWN], [LEFT_DOWN, BODY, RIGHT_DOWN])
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
