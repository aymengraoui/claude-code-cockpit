/** Readers for tool-call payloads. Pure, so they test without the engine. */

import type { Todo } from '../../types'

/** What a call is about, in one short string: the subject column of the activity list. */
export const subjectOf = (tool: string, input: Record<string, unknown>): string => {
  const first = (...keys: string[]): string => {
    for (const key of keys) {
      const value = input[key]
      if (typeof value === 'string' && value !== '') return value
    }

    return ''
  }

  if (tool === 'Bash') return first('command')
  if (tool === 'Agent') return first('description', 'prompt')
  if (tool === 'WebFetch' || tool === 'WebSearch') return first('url', 'query')
  if (tool === 'TodoWrite') return 'plan updated'

  return first('file_path', 'path', 'pattern', 'notebook_path')
}

/**
 * The `TodoWrite` payload, or null when it is not the shape this build documents —
 * so a changed tool leaves the last good plan standing instead of emptying it.
 */
export const todosOf = (input: Record<string, unknown>): Todo[] | null => {
  const todos = input['todos']
  if (!Array.isArray(todos)) return null

  const kept = todos.filter(
    (one): one is Todo =>
      typeof one === 'object' &&
      one !== null &&
      typeof (one as Todo).content === 'string' &&
      typeof (one as Todo).status === 'string',
  )

  return kept.length === todos.length ? kept : null
}
