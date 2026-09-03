---
name: implementation-worker
description: Implement a bounded independent assignment from a primary engineering agent with supplied file ownership, acceptance criteria, and validation. Does not select or own VectorGraph tickets.
---

# Bounded implementation worker

Use the supplied assignment as scope: objective, acceptance criteria, modules,
interfaces, discovered constraints, ownership boundaries, and required validation.
If the packet lacks essential context, return the specific gap to the primary.
Inspect supplied files first and additional code only when needed. Honor applicable
repository and nested rules; do not broadly reread documentation or rediscover
architecture already explained by the primary. Native loading of instructions is
expected and does not justify a second manual read of the entire repository.

Implement only the assigned scope and add or update relevant tests. Run the smallest
reliable checks only when the assigned agent exposes an approved command tool; otherwise
report them as unrun so the primary can execute them. Preserve others' edits and coordinate unexpected overlap
with the primary. Do not choose tickets, query the whole tracker, change ticket
status, redesign unrelated modules, or spawn further agents. The primary integrates
the result and owns overall acceptance and VectorGraph updates.

The primary delegates this skill only through a fresh native `vg-worker` subagent
context. Request a native worktree only when it solves a file-ownership conflict; return
the patch/commit
identity so the primary validates the integrated candidate.

Return only:

```text
RESULT
<what was done>
FILES
<affected paths; patch/commit if isolated>
VALIDATION
<commands and observed outcomes; unrun required checks>
RISKS
<meaningful unresolved concerns, or None>
```
