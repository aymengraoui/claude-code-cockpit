/** One running or finished subagent, newest last. */
export type Activity = {
  id: string
  /** Tool name as the engine calls it (`Edit`, `Bash`, `Agent`, ...). */
  tool: string
  /** The call's subject: a path, a command, an agent's description. */
  subject: string
  /** Wall-clock duration, once the call has returned. */
  ms: number | null
  /** null while the call runs. */
  isError: boolean | null
}

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
  branch: string | null
  ahead: number
  behind: number
  changes: Change[]
}

/** A rate-limit window as the engine reports it. */
export type Window = { percent: number; resetsAt: string | null }

/** One item of the plan, as the `TodoWrite` tool last wrote it. */
export type Todo = {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

/** One of Claude Code's own sessions, read from the transcript it wrote. */
export type Past = {
  /** The session id, which is its transcript's filename. */
  id: string
  /** Epoch ms the transcript was last written: that session's last activity. */
  at: number
  /** Its first typed prompt, or the id's first characters when it has none. */
  title: string
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
  /** This session's id, so the history can mark which entry is live. */
  sessionId: string | null
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
  agents: Activity[]
  /** Claude Code's recent sessions, newest first, this one included. */
  history: Past[]
  /** When the live ticker last looked; a redraw of the clocks hangs off it. */
  tickedAt: number | null
}

declare module 'claude-code' {
  interface PluginState {
    cockpit: { state: Cockpit }
  }
}
