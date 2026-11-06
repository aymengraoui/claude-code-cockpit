/** One path in the working tree, as `git status`/`git diff --numstat` report it. */
export type Change = {
  path: string
  /** Index status letter: M, A, D, R, ? for untracked. */
  status: string
  added: number
  removed: number
  /** True when a tool call in this session wrote to it. */
  isMine: boolean
}

/** What `git status --porcelain=v2 --branch` says about where HEAD is. */
export type Repo = {
  /** The repository's top directory, POSIX-spelled. */
  root: string
  branch: string | null
  ahead: number
  behind: number
  changes: Change[]
}

/** One file's diff, open in the pane in place of the overview. */
export type OpenDiff = {
  path: string
  /** Unified diff text, or the file itself when git has no diff for it. */
  source: string
  format: 'diff' | 'source'
}

/** One of Claude Code's own sessions, read from the transcript it wrote. */
export type Past = {
  /** The session id, which is its transcript's filename. */
  id: string
  /** Epoch ms the transcript was last written: that session's last activity. */
  at: number
  /** Its `/rename` name, else Claude Code's title for it, else its first typed prompt. */
  title: string
  /** The directory it ran in, where `claude --resume` finds it; null when it never said. */
  cwd: string | null
  /** That directory's last segment: the project it belongs to. */
  project: string
}

/** A rate-limit window as the engine reports it. */
export type Window = { percent: number; resetsAt: string | null }

/** One row of the context breakdown, as /context counts it. */
export type ContextRow = { name: string; tokens: number }

/** One item of the plan, as the `TodoWrite` tool last wrote it. */
export type Todo = {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

/** Everything the pane draws, as the hooks accumulate it. */
export type Cockpit = {
  model: string | null
  effort: string | null
  /** The permission mode exactly as the engine reports it: `auto`, `plan`, `default`, ... */
  mode: string | null
  /** The directory the session runs in, by its last segment. */
  project: string | null
  /** That directory in full: what a resumed session should open in. */
  cwd: string | null
  /** Prompts answered so far. */
  turns: number | null
  context: number | null
  /** Input tokens the last response was answered over, and the window they sit in. */
  tokens: number | null
  window: number | null
  fiveHour: Window | null
  sevenDay: Window | null
  repo: Repo | null
  /** True once git has been asked and said this is not a repository. */
  isRepoChecked: boolean
  todos: Todo[]
  /** Claude Code's sessions in every project, newest first, this one included. */
  history: Past[]
  /** The page of the full session list on show in place of the overview; null while closed. */
  sessionsPage: number | null
  /** A file's diff, when one is open. */
  diff: OpenDiff | null
  /** When the live ticker last looked; a redraw of the clocks hangs off it. */
  tickedAt: number | null
  /** The context breakdown, when it is open; null while closed. */
  contextRows: ContextRow[] | null
  /** An action pressed once that wants a second press, and when: /clear. */
  armed: { action: string; at: number } | null
  /** When the main loop last had a response: the prompt cache is warm for a TTL after. */
  respondedAt: number | null
}

/** What the session is doing, as its hooks last saw it. */
export type MascotActivity =
  | 'idle'
  | 'thinking'
  | 'writing'
  | 'running'
  | 'reading'
  | 'planning'
  | 'done'
  | 'alert'
  | 'waiting'

/** What the session is doing: drives the chime, the toasts and the progress shimmer. */
export type MascotState = {
  activity: MascotActivity
  /** The shimmer's frame; the pane redraws on each. */
  frame: number
  /** Tools that failed this turn, by what they were doing. */
  failures: string[]
  /** When the running turn began, to tell a long turn from a short one. */
  turnStartedAt: number | null
  /** Subagents still at work, as the engine reports them: the shimmer runs while any do. */
  agents: { id: string; label: string; at?: number }[]
}

declare module 'claude-code' {
  interface PluginState {
    cockpit: { state: Cockpit; mascot: MascotState }
  }
}
