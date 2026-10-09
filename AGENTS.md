<!-- BEGIN SHARED PROGRESS POLICY -->
## Required agent progress and handoff log

Every project/repository keeps one canonical root `PROGRESS.md`, committed and
published to `main`. Read it before starting or resuming work. This owner-requested
policy supersedes older rules that forbid repository progress logs or keep progress
only in tickets/chat; existing product, security, review and release gates still apply.

- Every agent, including each parallel worker, records its own entries with a stable
  agent/session ID. Record the start/scope, meaningful milestones, decisions, blockers
  and final handoff. The coordinator checks that every worker's entries are present.
- Append dated entries; preserve all previous agents' entries. Use the actual clock
  and ISO 8601 timestamp with timezone offset, plus agent/session, ticket/topic and
  status (`in-progress`, `blocked`, `ready`, `complete`). Keep entries concise and
  factual, usually 3–5 bullets: changed paths and decisions; branch/commit/PR;
  commands and actual results; remaining blocker; exact next action.
- Separate local implementation, CI, merge, deployment and user acceptance evidence.
  Never call unrun tests, pending merges or unverified deployments complete. Do not
  include secrets, credentials, personal data or raw verbose tool output.
- From a worktree, locate the primary checkout with `git worktree list --porcelain`
  and append to its root log. Do not create independent operational logs in scratch
  folders. Preserve the full canonical history when publishing from an isolated
  documentation branch; a primary checkout is not necessarily currently on `main`.
- Serialize read/append/write operations on the shared file (a file lock or a single
  coordinator queue). Every worker authors its own entry. On Git conflicts, preserve
  both agents' entries; never resolve by dropping a side or replacing the whole log.
- Publish progress to `main` at milestones and before handoff, even while code work
  remains on a feature branch. Commit only the log and necessary logging instructions
  in a separate documentation commit. Use direct non-force push only where repository
  rules allow it; otherwise promptly open and merge a documentation PR through required
  checks. Do not bundle unfinished code, force-push `main` or weaken protections.
- Verify the log is readable on remote `main`. If delivery is blocked, retain the entry
  locally, record the exact blocker and PR/branch, and report publication as pending.
  For projects without a remote, commit to local `main` and record that limitation.
- A new repository/project must establish this log and these instructions before
  material work. For a project spanning repositories, each repository logs its own
  changes and links related repository work rather than duplicating its history.

Entry format:

```markdown
### 2026-10-09T00:15:00-05:00 | agent/session | ticket or topic | in-progress
- Changed: concrete result, relevant paths and decision/reason.
- Evidence: branch, commit/PR; commands run and actual results.
- Remaining: exact blocker or unverified gate; none when there is none.
- Next: first executable action for the next agent.
```
<!-- END SHARED PROGRESS POLICY -->

# VectorCode Agents Instructions

## Persistent engineering workflow

For `Work VectorGraph.`, `Continue VectorGraph.`, `Continue development.`, taking
the next ticket, or a specific VectorGraph ticket, load `vectorgraph-work`.
Read [the repository workflow](docs/AGENT_WORKFLOW.md) for scope and commands;
read [CLI operations](docs/VECTORGRAPH_CLI.md) on demand. VectorGraph is the live
engineering ticket, status, dependency, acceptance, and evidence authority.
Repository contracts remain authoritative for architecture and product constraints.

Use the VectorGraph CLI with this repository's explicit verified workspace.
The VectorGraph plugin is EXPERIMENTAL / TESTING; preserve its code and settings.
Normal engineering must work without it. Never guess a missing workspace binding.

Resume matching In Progress work first; otherwise choose the highest-priority
Ready ticket with satisfied dependencies. Use optional bounded workers via
`implementation-worker`; one independent `code-review` reviewer follows
deterministic validation for meaningful changes. Verify every acceptance criterion
and existing delivery gates before recording evidence and setting Done via CLI.
Continue to the next eligible ticket until a genuine blocker or empty queue.
Persist resumable progress on the ticket, not only in conversation history.

### Instruction synchronization and precedence

Keep AGENTS.md and CLAUDE.md byte-for-byte identical in every instruction change.
Both existing sources are incorporated below; substantive rules were preserved.
The owner-requested workflow above supersedes earlier tracker selection,
mandatory full-context delegation, automatic high/max reasoning, and incompatible
local-review routing only. Preserve product, security, testing, licensing, CI,
merge, and release gates. Specific conflicts are resolved in the workflow document.
Required applicable nested instructions still apply; do not broadly reload context.

### Tool-specific configuration

Codex discovers `.agents/skills/`; Claude Code discovers `.claude/skills/`.
Keep matching skill files identical. Native `vg-worker` and `vg-reviewer` agents
use bounded, fresh contexts. Use Astra (`gpt-6-astra`) with medium reasoning for
Codex. Use Fable 5.1 for Claude Code sessions; Claude agents inherit that session
model. Do not escalate ordinary work automatically.


This file provides instructions for AI coding agents working with the VectorCode workbench codebase.

Use the repository source as the authority. Validate TypeScript changes with `npm run compile-check-ts-native` first, then run the narrower extension/client checks that match the files you touched.

Keep the whole codebase DRY. Treat duplicated logic or configuration as a defect: prefer shared helpers, schema/config sources, and thin adapters over copying behavior between desktop, iOS, services, docs, and tests.

Keep VectorCode mobile work DRY. Reuse shared protocol models, project-scoped state helpers, and small SwiftUI controls instead of duplicating request shapes, tab chrome, project rows, buttons, or empty-state UI across iOS views and desktop bridge code.
