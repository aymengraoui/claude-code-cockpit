/**
 * Making the conversation's important lines easy to see, for attention that drifts.
 * Pure: it rewrites markdown and reads tool output, nothing more.
 */

const NEWLINE = String.fromCharCode(10)
const FENCE = '```'

/** A list item's marker and indent, kept in front of whatever is added. */
const LIST_PREFIX = /^(\s*(?:[-*+]|\d+[.)])\s+)/

/**
 * Every question the reply puts to you, marked: `👉 **Want me to push it?**`.
 *
 * A question is where the session waits on a decision of yours, and it is the line most
 * easily lost at the end of a long reply. Code blocks, headings, tables and lines that
 * are already marked are left alone; a line that already holds bold text is marked but
 * not wrapped, so its own emphasis is not broken. Only the drawing changes: the stored
 * message is untouched.
 */
export const emphasizeQuestions = (markdown: string): string => {
  let isInCode = false

  return markdown
    .split(NEWLINE)
    .map(line => {
      if (line.trimStart().startsWith(FENCE)) {
        isInCode = !isInCode

        return line
      }
      const text = line.trim()
      if (isInCode || text.length < 4 || !text.endsWith('?')) return line
      if (text.startsWith('#') || text.startsWith('|') || text.startsWith('>') || text.includes('👉')) return line

      const prefix = line.match(LIST_PREFIX)?.[1] ?? line.match(/^\s*/)?.[0] ?? ''
      const body = line.slice(prefix.length)

      return body.includes('**') ? `${prefix}👉 ${body}` : `${prefix}👉 **${body}**`
    })
    .join(NEWLINE)
}

/**
 * The first lines of a failed call's output, which is where the reason usually is.
 * Output arrives as text or as a tool's own record; stderr is preferred to stdout.
 */
export const errorLines = (output: unknown, max = 3): string[] => {
  const textOf = (value: unknown): string => {
    if (typeof value === 'string') return value
    if (typeof value !== 'object' || value === null) return ''
    const record = value as Record<string, unknown>
    for (const key of ['stderr', 'error', 'message', 'stdout', 'text', 'content']) {
      const field = record[key]
      if (typeof field === 'string' && field.trim() !== '') return field
    }

    return ''
  }

  return textOf(output)
    .split(NEWLINE)
    .map(line => line.trim())
    .filter(line => line !== '')
    .slice(0, max)
}
