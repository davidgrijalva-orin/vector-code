# vector-code shared agent progress

# Shared progress log (every repo, every agent)

Each repo has ONE `PROGRESS.md` at the root of its main checkout (the primary
folder, normally on `main`). It is the handoff: any agent or LLM taking over
must be able to continue from it alone. All agents working on the repo write to it.

- **On start:** read `PROGRESS.md` before doing anything; resume from the latest
  entries for your area instead of rediscovering state. If the file is missing,
  create it at the main-checkout root with a short header copying these rules.
- **Location:** always the main checkout's file. From a worktree, branch folder
  or subagent, find it with `git worktree list` (first line) and write to that
  path. Never in `.tmp`, a scratchpad/temp folder, a worktree copy, or outside
  the repo. No other progress/notes files; append to the one that exists.
- **When:** add an entry at each meaningful milestone (PR opened, blocker hit,
  decision made, handing off) and before ending the session, not only at the
  end, so the log survives an interrupted session.
- **How:** append at the bottom; never edit or delete another agent's entry.
  Heading `### YYYY-MM-DD HH:MM CDT — <agent (model)> / <session> — <ticket or topic>`
  using the machine clock (`date "+%Y-%m-%d %H:%M %Z"`). Then short bullets,
  detailed but not verbose:
  - **Did:** what changed, with paths, branch, commit, PR/ticket links.
  - **Verified:** what actually ran and passed/failed. No unmeasured claims.
  - **State / next step:** exactly where it stands and what the next agent does first.
  - **Needs owner:** decisions or approvals waiting, if any.
- **Git:** the file is committed to `main`. If `main` accepts direct pushes and
  the main checkout is on `main`, commit only this file
  (`git commit -m "progress: <topic>" -- PROGRESS.md`) and push. If `main` is
  protected, copy the main checkout's `PROGRESS.md` (always the newest superset)
  into your PR branch just before your final commit; on conflict take the
  main-checkout version. Never commit unrelated changes with it.

### 2026-10-09 00:00 CDT — Codex / shared-progress-policy rollout — One persistent Markdown handoff log for every agent

- **Did:** Added owner logging rules to AGENTS.md and CLAUDE.md; preserved existing history and initialized root log when missing. Context: Primary root C:\Users\grija\Documents\OrinTech\vector-code; branch main; no commit/push in setup step.
- **Verified:** Primary checkout verified with git worktree list; read existing history. Final policy inventory and helper concurrency checks follow.
- **State / next step:** in-progress. Finish rollout validation. Each project agent reads latest relevant entries before takeover and records exact next action; deliver root PROGRESS.md through its existing main/PR gates. Decisions: Only root PROGRESS.md is operational. NeuroTopo outside history merged into its root log; original timestamps preserved.
- **Needs owner:** None

### 2026-10-09 00:05 CDT — Codex / shared-progress-policy rollout — Validated handoff-log rollout and Git delivery

- **Did:** One root PROGRESS.md and local Codex/Claude instructions installed. Every agent must read before takeover and append its own milestones. Context: C:\Users\grija\Documents\OrinTech\vector-code; primary main checkout; remote parent 3217b2a2479fcae042ee754145600b671a92051f. Existing HEAD/index remain untouched.
- **Verified:** 34-project policy/routing/history preservation and diff checks passed; 12 concurrent append writers preserved once each. Remote main protection checked and direct delivery allowed.
- **State / next step:** complete. This log-only commit is being delivered to remote main. Resume your project task from its latest relevant entry; local checkout alignment and instruction-file delivery remain with the project owner. Decisions: Separate Git index and remote-parent log-only commit preserve unrelated staged files and avoid rebasing active work.
- **Needs owner:** None
