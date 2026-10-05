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

// Two rows, five columns, four arms: a dash at each end of each row is an arm, the middle
// the head (its eyes) and the body. An arm is stretched out, or pulled in to the half of the
// cell against the body — still a dash, so the arms can move. Every frame keeps that size.
const EYES = '▛█▜'
const BLINK = '▀█▀'
const BODY = '▜█▛'

const OUT = '─'
const LEFT_IN = '╶'
const RIGHT_IN = '╴'

/** One row: its left arm stretched or pulled in, the middle, its right arm. */
const row = (left: boolean, middle: string, right: boolean): string =>
  `${left ? OUT : LEFT_IN}${middle}${right ? OUT : RIGHT_IN}`

const pose = (
  top: [boolean, boolean],
  bottom: [boolean, boolean],
  eyes: string = EYES,
): [string, string] => [row(top[0], eyes, top[1]), row(bottom[0], BODY, bottom[1])]

const REST = pose([true, true], [true, true])

/** The mascot's two rows for an activity at a frame; every row five columns wide. */
export const spriteFor = (activity: MascotActivity, frame: number): [string, string] => {
  const even = frame % 2 === 0

  switch (activity) {
    case 'idle':
      // Arms out, at rest, with a blink now and then.
      return frame % 12 === 0 ? pose([true, true], [true, true], BLINK) : REST
    case 'thinking':
      // A slow blink while it works out what to do.
      return frame % 4 < 2 ? REST : pose([true, true], [true, true], BLINK)
    case 'writing':
    case 'running':
    case 'reading':
    case 'planning':
      // All four arms at it, crosswise: upper left with lower right, then the other two.
      return even ? pose([true, false], [false, true]) : pose([false, true], [true, false])
    case 'done':
      // All four out, all four in: a cheer.
      return even ? REST : pose([false, false], [false, false])
    case 'waiting':
      // One arm waving for you.
      return even ? REST : pose([true, false], [true, true])
    case 'alert':
      // Arms pulled in, blinking: something went wrong.
      return even ? pose([false, false], [false, false], BLINK) : REST
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
