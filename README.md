# cockpit

A sidebar for [Claude Code](https://claude.com/claude-code) in the terminal.

The desktop app shows you where a session stands. The terminal makes you guess: how full the
context is, what the session has cost, which files changed, what Claude just ran, whether that
subagent is still going. `cockpit` puts all of it in a pane beside the conversation.

```
╭─ cockpit ──────────────────────────╮
│ my-app · 7 turns                   │
│ Opus 5.5 ▾ · High ▾ · plan         │
│ ────────────────────────────────── │
│ ctx  ▰▰▱▱▱  37% 74k/200k           │
│ 5h   ▰▱▱▱▱  12% ↻ 2h14             │
│ week ▰▰▰▰▱  81% ↻ 4d               │
│ ────────────────────────────────── │
│ feat/parser ↑2                     │
│ WORKING TREE 3                     │
│ +169 -12 in 3 files                │
│ ● M src/parse.ts          +48 -12  │
│ ● M src/parse.test.ts     +31  -0  │
│   ? notes.md               +0  -0  │
│ ────────────────────────────────── │
│ PLAN 2/5                           │
│ ▸ wire the numstat parser          │
│ · show the plan in the pane        │
│ · cover it with a test             │
│ ────────────────────────────────── │
│ AGENTS 1                           │
│ ⟳ find every call site             │
│ ────────────────────────────────── │
│ SESSIONS 4                         │
│ ▸ enhance the cockpit              │
│   fix the parser rounding          │
│   add the cockpit pane             │
│   warp theme for windows           │
│ press a session to open it         │
╰────────────────────────────────────╯
```

`●` marks a file this session wrote to, so your edits stand out from whatever else is dirty in
the tree. Percentages go green → amber → red as they climb. Every color is a theme key, so the
pane follows whatever theme you run, custom ones included.

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
| permission mode | the words the prompt's hint line is drawing, read as it redraws |
| context fill, 5h and weekly windows | `session.measure` |
| branch, divergence, working tree, line counts | `git status --porcelain=v2 --branch` and `git diff HEAD --numstat`, once per turn |
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

The permission mode is the awkward one. No event fires when it is toggled, and the transcript
records it only at a turn boundary, so neither a hook input nor a file sees a shift+tab while
the session sits idle. What does see it is the hint line under the prompt: it redraws that
instant. So a `ui.render` hook on `PromptHint` reads the mode out of the line and passes it
through untouched. A render hook may not write `$.state`, so the mode is held in a module
variable and the pane picks it up on its next tick.

One catch: the hook is handed the line *as already drawn*, which right after a toggle is
still the line from before it — read naively, the pane runs one change behind. So each tick
asks for the hint line to be redrawn (`$.ui.invalidate`) and gives it a moment to land; the
hook then reads the line as it now stands, and the tick takes the mode from that.

The words matched are the engine's own indicators — `manual mode`, `plan mode`,
`accept edits`, `bypass permissions`, `don't ask`, `auto mode` — not the permission
dialog's `auto mode on`, which is a different component. A line naming no mode leaves the
last known one standing rather than reading as `default`.

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
