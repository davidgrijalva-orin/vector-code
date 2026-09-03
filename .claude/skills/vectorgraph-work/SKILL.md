---
name: vectorgraph-work
description: Resume and complete repository engineering tickets through the VectorGraph CLI. Use for Work VectorGraph, Continue VectorGraph, Continue development, Take the next ticket, Work VectorGraph ticket ID, or Complete the current engineering work.
---

# VectorGraph engineering loop

The primary agent owns the ticket, context, integration, evidence, and status.
Use the installed VectorGraph CLI independently of the experimental plugin.
Read the repository's `docs/AGENT_WORKFLOW.md` for its verified workspace/team,
commands, and constraints, then `docs/VECTORGRAPH_CLI.md` for exact CLI syntax.
Do not inherit the CLI's active workspace. Pass the verified workspace explicitly
on every workspace-scoped call; discovery commands such as `version`, `workspace list`,
and `api operations` do not take a workspace. If this repository has no verified binding, follow the documented
access discovery, record the limitation, and stop before selecting or mutating work.

## Resume and select

1. Inspect the current branch, worktrees, and dirty paths without discarding edits.
   Read In Progress tickets in the bound team/project via the CLI, following all
   pages. Resume a ticket only when its branch, evidence, ownership, and current
   changes match. An active ticket owned by another session is not yours to claim.
2. For an explicit ticket, fetch it directly and verify repository scope and
   dependencies. Otherwise select the highest-priority eligible Ready ticket.
   Use the team's actual status UUID; this setup maps Todo in the `unstarted`
   category to Ready only where the repository binding explicitly says so.
   Never treat Backlog, Triage, Canceled, or an arbitrary unstarted state as Ready.
3. Read the complete objective, description, acceptance criteria, priority,
   dependencies/relations, comments, related tickets, and issue context. Follow
   truncated or paginated context. Verify all incoming blockers and required
   parent/child dependencies; absence of a field is not proof of no dependencies.
   Canceled dependencies do not count as satisfied unless the requirement was
   explicitly waived. Re-fetch related tickets when state is uncertain.
4. Before implementation, re-read ownership and status to avoid a stale claim,
   then set the actual In Progress status via the CLI and verify it by reading
   back. The CLI has no proven atomic claim/lease. Proceed only under an external
   single-runner guarantee or after verifying a unique owner claim; status read-back alone
   is not ownership. Stop before implementation if exclusivity is not established.
   Preserve existing ticket descriptions, requirements, and unrelated context.

## Investigate, plan, implement

Read applicable repository/subdirectory instructions and only relevant code,
interfaces, tests, and directly related documents. Reuse reliable context already
in the session. Code describes current behavior; VectorGraph defines the desired
outcome; repository contracts still govern architecture and product constraints.
Investigate inconsistencies rather than treating tickets as permission to weaken
contracts. Map every acceptance criterion to a change and evidence. Plan affected
components, regression risks, validation, and independent work briefly in context.

Implement root-cause fixes using existing abstractions and focused scope. Include
supporting changes when correctness requires them and explain non-obvious ones.
Avoid speculative features, unrelated refactors, duplicated abstractions, new
dependencies without need, weakened tests, and temporary production workarounds.

## Optional bounded delegation

Use the primary agent alone for normal tickets. Add at most one implementation
worker for one independent workstream or two for a larger genuinely parallel task.
More workers require a concrete benefit. Avoid delegation for sequential edits or
work requiring nearly all the parent's context. Default to Sol Medium in Codex;
inherit the configured capable Claude model. Do not escalate reasoning by habit.

Before delegating, the primary must isolate the child from tracker-capable MCP
servers, VectorGraph credentials, and any callable VectorGraph command. If those boundaries
cannot be enforced, do not delegate. Use `implementation-worker` with the native `vg-worker`
agent when available. Supply only objective, relevant acceptance criteria, files/modules, interfaces,
discovered constraints including applicable nested rules, ownership boundaries,
and required checks. Use fresh context (Codex `fork_turns="none"` when exposed;
Claude's named Agent subagent). Do not request full-history forks. Native agents
may automatically load repository instructions; do not ask them to reread all
docs or rediscover the tracker. Workers never select tickets or update VectorGraph.
Use disjoint file ownership or native worktrees when concurrent edits would collide;
integrate and validate the actual combined candidate before review.

## Deterministic validation, then independent review

Run the narrowest reliable compiler/type, format/lint, unit/regression/integration,
build, and repository checks covering the change. Existing required gates still
apply. Record exact commands, outcomes, unavailable tooling, and retained evidence.
Investigate failures caused by the change; do not weaken legitimate tests.

For meaningful behavioral changes, use one independent `vg-reviewer` with the
`code-review` skill after deterministic checks. Trivial edits may skip semantic
review when deterministic evidence suffices. Send only objective, acceptance
criteria, final diff (including new files), changed tests, validation results,
and directly relevant code as needed. Supply the candidate revision or patch
when the reviewer's worktree would otherwise show an older version. Before spawning the reviewer, the primary must use a read-only parent permission
mode because live parent overrides can supersede the custom-agent default. If that cannot
be enforced, report the gap and skip the independent review. The reviewer must be
different from the implementer, must not receive the full conversation,
and must not rediscover VectorGraph or implement the fix. If independent execution
is unavailable, report that gap; do not label self-review independent review.

Evaluate findings. Fix valid Critical/High issues, rerun affected checks, and use
one focused follow-up review. Verify Medium/Low fixes directly. Do not loop through
reviewers endlessly. Existing required CI/provider review gates remain binding.

## Verify and complete

Evaluate EVERY acceptance criterion explicitly against the final candidate, with
evidence and pass/fail. Passing tests, a worker's completion message, or reviewer
PASS alone is insufficient. Inspect the complete final diff for scope, debug
artifacts, dead code, missing tests, generated junk, compatibility regressions,
error handling, unnecessary complexity, and accidental configuration changes.
Fulfil this repository's PR/merge/deployment/acceptance requirements before Done.

Post a concise CLI ticket update: implementation, important decisions, each
criterion's evidence, test commands/results, review resolution, remaining limits,
and necessary follow-up. Use stable per-operation idempotency keys; after an
uncertain response retry the exact same request/key, never a new key. Read back
the evidence; only then set Done through the actual status field and verify it.
An unverified write, missing criterion, unresolved required review, or unavailable
required validation leaves the ticket open. Keep durable progress on the ticket,
not a second local backlog. At interruption record branch/worktree, modified paths,
decisions, checks, unresolved criteria, and the next concrete action through the CLI.
During an outage retain a bounded local note without secrets, reconcile it on
recovery, and never treat it as proof of a successful tracker update.

After Done, query the CLI again, select the next eligible ticket, and repeat.
Completion of one ticket is not a stopping condition. Stop only for a genuine
external/access blocker, conflicting requirements, material ambiguous behavior,
an unauthorized destructive/irreversible action, an out-of-scope architectural
decision, or no eligible work (including an empty queue or unresolved dependencies).
Investigate reasonable alternatives first. The setup does not itself schedule
background execution; a fresh session resumes from the persisted ticket evidence.
