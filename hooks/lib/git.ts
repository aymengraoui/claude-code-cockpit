/** Parsers for the two git commands the pane reads. Pure, so they test without a repo. */

import type { Change, Repo } from '../../types'

const STATUS_LETTERS = 'MADRCU'

/** The XY status pair of porcelain v2 reduced to one letter for the pane. */
const letterOf = (xy: string): string => {
  for (const char of xy) if (STATUS_LETTERS.includes(char)) return char

  return 'M'
}

/**
 * `git status --porcelain=v2 --branch -z`-style output, read from the plain
 * (newline) form: the `# branch.*` headers plus one line per path.
 *
 * Unparsable input yields a repo with no branch rather than throwing: the pane
 * should degrade, never fail.
 */
export const parseStatus = (stdout: string): Repo => {
  const repo: Repo = { branch: null, ahead: 0, behind: 0, changes: [] }

  for (const line of stdout.split('\n')) {
    if (line === '') continue

    if (line.startsWith('# branch.head ')) {
      const head = line.slice('# branch.head '.length).trim()
      repo.branch = head === '(detached)' ? null : head
      continue
    }

    if (line.startsWith('# branch.ab ')) {
      const match = line.match(/\+(\d+)\s+-(\d+)/)
      if (match !== null) {
        repo.ahead = Number(match[1])
        repo.behind = Number(match[2])
      }
      continue
    }

    if (line.startsWith('# ')) continue

    // 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
    if (line.startsWith('1 ') || line.startsWith('2 ')) {
      const fields = line.split(' ')
      const xy = fields[1] ?? ''
      // A rename (`2 `) carries "<path>\t<origPath>"; the new path is what matters.
      const path = fields.slice(8).join(' ').split('\t')[0]
      if (path !== undefined && path !== '') {
        repo.changes.push({ path, status: letterOf(xy), added: 0, removed: 0 })
      }
      continue
    }

    // u <XY> ... <path>  — an unmerged path.
    if (line.startsWith('u ')) {
      const path = line.split(' ').slice(10).join(' ')
      if (path !== '') repo.changes.push({ path, status: 'U', added: 0, removed: 0 })
      continue
    }

    // ? <path>  — untracked.
    if (line.startsWith('? ')) {
      const path = line.slice(2)
      if (path !== '') repo.changes.push({ path, status: '?', added: 0, removed: 0 })
    }
  }

  return repo
}

/** `git diff HEAD --numstat` as a path -> line counts map; `-` counts (binary) read as 0. */
export const parseNumstat = (stdout: string): Map<string, { added: number; removed: number }> => {
  const counts = new Map<string, { added: number; removed: number }>()

  for (const line of stdout.split('\n')) {
    if (line === '') continue
    const [added, removed, ...rest] = line.split('\t')
    const path = rest.join('\t')
    if (path === '' || added === undefined || removed === undefined) continue
    counts.set(path, {
      added: added === '-' ? 0 : Number(added),
      removed: removed === '-' ? 0 : Number(removed),
    })
  }

  return counts
}

/** The paths this session wrote to, folded into the working-tree list. */
export const withCounts = (
  repo: Repo,
  counts: Map<string, { added: number; removed: number }>,
  mine: ReadonlySet<string>,
): Repo => {
  const changes = repo.changes.map(change => ({
    ...change,
    ...(counts.get(change.path) ?? {}),
    isMine: mine.has(change.path),
  }))

  // What this session touched first, then the largest diffs: the rest is context.
  changes.sort((a, b) => {
    if (a.isMine !== b.isMine) return a.isMine ? -1 : 1

    return b.added + b.removed - (a.added + a.removed)
  })

  return { ...repo, changes }
}
