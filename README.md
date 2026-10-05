# cockpit

A sidebar for [Claude Code](https://claude.com/claude-code) in the terminal.

The desktop app shows you where a session stands. The terminal makes you guess: how full the
context is, what the session has cost, which files changed, what Claude just ran, whether that
subagent is still going. `cockpit` puts all of it in a pane beside the conversation.

```
╭─ cockpit ──────────────────────────╮
│ my-app · 7 turns                   │
│ Opus 5.5 ▾ · High ▾ · auto mode on │
│ ────────────────────────────────── │
│ ctx  ▰▰▱▱▱  37% 74k/200k ▾         │
│   ▰▱▱ System tools 14k             │
│   ▰▱▱ Messages 9k                  │
│ 5h   ▰▱▱▱▱  12% ↻ 2h14             │
│ week ▰▰▰▰▱  81% ↻ 4d               │
│ ────────────────────────────────── │
│ my-app · feat/parser ↑2            │
│ WORKING TREE 3                     │
│ +169 -12 in 3 files                │
│ ● M src/parse.ts          +48 -12  │
│ ● M src/parse.test.ts     +31  -0  │
│   ? notes.md               +0  -0  │
│ ────────────────────────────────── │
│ SESSIONS 4                         │
│ ▸ enhance the cockpit              │
│   fix the parser rounding          │
│                                    │
│ ────────────────────────────────── │
│ + new session                      │
│ compact · rewind · resume · clear  │
╰────────────────────────────────────╯
```

`●` marks a file this session wrote to, so your edits stand out from whatever else is dirty in
the tree. Percentages go green → amber → red as they climb. Every color is a theme key, so the
pane follows whatever theme you run, custom ones included.

## The mascot

Right above the input, at the right-hand edge, Claude's own mascot acts out what the
session is doing, with what it is doing written underneath. Each subagent at work gets one
of its own to its left, in its own colour, labelled with its task:

```
                               ▘▐▛█▜▌▖   ▗▐▛█▜▌▝          ▗▐▛█▜▌▖
                               ▗▜███▛▘   ▝▜███▛▖          ▝▜███▛▘
                             find cal…  write t…   running npm test
```

It is built for attention that drifts. **Motion means something is happening**: the arms go while work
is under way and for a few seconds after a change, then the mascot stands
still — idle never moves. **Colour says whose turn it is**: green when done (`✓ done — your
turn`), red when a step failed (`⚠ failed 1 step: npm test`, kept until the next prompt),
yellow when the session is waiting on you (`⏳ needs you: …`).

A soft chime, with a toast, marks the moments attention has most likely wandered: a
permission prompt, and the end of a turn that ran longer than 30 seconds. Short turns stay
quiet.

## The conversation

The transcript is redrawn, never rewritten — the stored messages are untouched:

- **Questions put to you are marked**: `👉 **Want me to push it?**`, so the decision
  waiting on you is not lost at the end of a long reply. Code, headings and tables are left
  alone. This shows on every surface, Remote Control included.
- **A failed tool call is loud**: `✗ Bash failed · npm test`, in red, with the first lines of
  why, in place of the quiet row. Calls that worked keep the engine's own row.
- **The end of each turn is a line you can find**: `━━━ ✓ done in 3m 12s ━━━`, so the start
  of each answer stands out when scrolling back (terminal only).

## Install

```bash
git clone https://github.com/aymengraoui/claude-code-cockpit
claude --plugin-dir ./claude-code-cockpit
```

To keep it loaded in every session, add the folder to `CLAUDE_CODE_PLUGIN_DIRS`, or install it
as a plugin with `/plugin`.

The pane opens itself at session start on a terminal at least 144 columns wide — the width at
which an unasked pane is allowed to seat itself. Narrower than that, or if you close it, open it
with `/cockpit`, or bind a key to it:

```json
// ~/.claude/keybindings.json
{ "bindings": [ { "context": "Global", "bindings": { "alt+c": "command:cockpit" } } ] }
```

Any action spelled `command:<name>` runs that slash command, so `command:cockpit` opens the
pane from anywhere.

## What it reads

Everything comes from the session you are already in. Nothing is sent anywhere, and the only
process it ever starts is `git`:

| Shown | Where it comes from |
| --- | --- |
| project, turn count | `$.session.cwd()` and `$.session.turns()` |
| everything above, at launch | `$.session.usage()`, `$.session.model()` and `$.session.turns()`, asked for in `session.start` |
| model | `$.session.model()`, every tick |
| effort | `turn.step`, and `effort.level` on the classic hook inputs |
| the plan | `tool.call` on `TodoWrite`, read from the payload Claude writes |
| permission mode | `permission_mode` on the prompt, tool-result and stop hook inputs |
| context fill, 5h and weekly windows | `session.measure` |
| the repository | the session's directory when it is one; otherwise the one the session last wrote a file in |
| branch, divergence, working tree, line counts | `git status --porcelain=v2 --branch` and `git diff HEAD --numstat`, once per turn |
| what fills the context | `$.session.usage({ breakdown: 'summary' })`, the categories `/context` counts |
| running agents | `tool.call` on the `Agent` tool, timed around `next(e)` |
| Claude Code's sessions | the transcripts in this project's transcript directory, found through the `transcript_path` the classic hook inputs carry |

The session list is Claude Code's own, not the mod's bookkeeping. Claude Code writes one
`<session-id>.jsonl` per session into a per-project directory, and the classic hook inputs
carry this session's `transcript_path` — which sits in that directory, so it is never guessed.
The eight newest are listed, each titled by the first prompt its author actually typed (meta
rows and slash-command echoes skipped), or by its id where it holds no prompt yet.

Titles are cached in `$.store`: a session's first prompt cannot change, so each transcript is
read at most once ever and later listings only stat the directory. The directory itself is
cached too, so a reload lists the sessions before any prompt has been typed.

**Press the model or the effort to change it.** Each opens the engine's own picker, `/model`
or `/effort`, through `$.command.run`, which runs a slash command as if it were typed. The
pane keeps no list of its own on purpose: what those pickers offer depends on the account
and the model (plan-gated models, context-window variants, the effort levels a model
takes), and none of it is exposed to a plugin, so a copy could never be exact. Should the
run be refused, the command is left in the prompt box, one Enter away.

The model line names the running model, as `/model` does (`Opus 5.5`), read from
`$.session.model()` on every tick so a switch shows at once. Effort has no setting to read,
so it arrives with each request and with the classic hook inputs, which carry
`effort.level` — a change made with `/effort` shows at the next tool call or turn end.

**Press a changed file to see its diff.** The diff against `HEAD` takes the pane, drawn as a
diff, with `← back` to return; an untracked file is shown as it stands. Past 1,500 lines it
is cut, and says how much was left out.

**Press the `▸` beside the context bar to see what fills it** — the categories `/context`
counts, largest first, deferred tool schemas left out since they cost nothing until loaded —
with `compact` waiting in the toolbar below.

**The quick actions sit in a toolbar pinned to the bottom edge** — `+ new session` on a row of
its own, then `compact · rewind · resume · clear` — so they never scroll away with the content above:
the pane is drawn exactly as tall as its body, the content growing into what is left and
clipped there. Each quick action runs the engine's own command; `compact` shows a `⚠` past
85% context. `+ new session` opens a fresh `claude` in a terminal of its own, in the same directory. `clear` discards the conversation, so it asks twice: the first
press arms it and shows `clear?`, a second within four seconds runs it.

**The repository follows the work.** A session started in a home directory still works in a
repository, so when the session's own directory is not one, the pane follows the repository
of the last file the session wrote, and remembers it for the next launch.

**Press a session to open it.** The hook API exposes no way to switch sessions in place —
`--resume` is a launch flag — so a press opens `claude --resume <id>` in a terminal of its
own, trying Windows Terminal then a console on Windows, Terminal.app then the usual
emulators elsewhere. Nothing about the setup is assumed: when no terminal answers, the
command goes to the clipboard instead, so a click is never lost.

Two read-only `git` calls per completed turn, not per edit — the pane costs a few milliseconds
a turn and never writes to your repo.

## How it is built

A Claude Code mod is a plugin of function hooks: every event in the engine runs through a chain,
and a hook can watch it, rewrite what the rest of the chain sees, or answer for it. `cockpit`
only ever watches, except for the one hook that draws:

```ts
on('ui.render', { component: 'Pane', requestId: 'cockpit' }, async ($, e) => {
  const { Box, Text } = $.ui.resolve(e)
  const it = await read($, state)

  return <Box flexDirection="column">{/* ... */}</Box>
})
```

Four files do the work:

- `hooks/register.tsx` — the hooks and the pane's tree
- `hooks/lib/format.ts` — bars, durations, token counts, path and model formatting
- `hooks/lib/git.ts` — parsers for the two git commands
- `hooks/lib/tools.ts` — readers for tool-call payloads
- `hooks/lib/sessions.ts` — Claude Code's transcripts: titles, the mode, the tail command
- `hooks/lib/launch.ts` — the terminal commands to try, per platform
- `hooks/lib/palette.ts` — the colours, by value: swap this file for your own

Everything outside `register.tsx` is pure functions, which is why most of the suite needs no
engine at all.

Sections that have nothing to show say so — `not a git repository`, `nothing yet` — rather
than vanishing, so a quiet pane reads as quiet instead of broken.

The pane ticks every two seconds while it is open: durations and resets are read at draw time,
so a tick that stamps the state is enough to move every clock, and it re-reads the usage
figures as it goes. It stops the moment the pane is closed and never runs twice.

The permission mode is the awkward one. In a local terminal session no event reaches a
plugin when it changes: the engine notices the change but tells only the remote bridge and
the SDK stream. The mode pill in the footer (`⏵⏵ auto mode on`) is drawn as its own element,
which is not in the text the `PromptHint` hook receives. That text is only
`(shift+tab to cycle) · ← for agents`, so the footer cannot be read for it either.

What a plugin does get is the exact value, `permission_mode`, on the classic hook inputs for
a prompt, a tool result and a turn's end. The pane shows that value in the footer's own
words (`auto` is `auto mode on`). It is never a guess, but it moves at those moments, not on
the keypress: a shift+tab made while the session sits idle shows with your next message.

The pane is primed in `session.start`, so it is populated the moment it opens rather than
filling in as events arrive: the engine already holds the usage figures, the model and the
turn count, so they are asked for instead of waited on. `session.start` runs again on every
reload, so an edit to the mod repopulates it too.

State lives in `$.state` rather than module variables, so a hot reload keeps the pane's
contents, and a write redraws exactly the readers.

## Development

```bash
claude plugin validate .   # manifest, hooks and every $ call the module makes
claude plugin test .       # the suite, against the real engine
```

The suite covers the pure helpers and mounts the pane through the engine on the `terminal`
surface, asserting what it draws from seeded usage figures and seeded `git` output.

Edits hot-reload: with the folder loaded, each change takes effect when the turn that made it
ends.

## Compatibility

Built and tested against Claude Code 2.1.289 on the `terminal` surface. The hook API is young —
if a release moves under it, `claude plugin validate` will say so before anything draws, and a
hook that fails is skipped with the engine drawing its own thing instead.

## License

MIT © Aymen Graoui
