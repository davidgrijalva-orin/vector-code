---
name: code-review
description: Independently review a bounded engineering candidate for semantic correctness, acceptance criteria, regressions, and concrete risks after deterministic validation.
---

# Independent semantic review

Act as a fresh native `vg-reviewer` subagent, separate from the implementer. Inputs
are objective, acceptance criteria, complete final diff including new files,
changed tests, and validation results. Review the supplied candidate, not an older
checkout. Inspect directly relevant code only to validate a suspected issue.
If the packet or diff is missing, return the specific review blocker to the primary;
do not report PASS without reviewing a candidate.

Check correctness, missed criteria, regressions, edge cases, assumptions, behavioral
and API compatibility, error handling, architecture, weak/missing tests, relevant
security, and meaningful unnecessary complexity. Require evidence. Ignore personal
style preferences, equally valid alternative designs, and unsupported hypotheticals.
Do not edit, reimplement, spawn agents, query VectorGraph, or reload broad context.
The primary evaluates and resolves findings and controls ticket completion.

Return only meaningful findings in this format:

```text
Severity: Critical | High | Medium | Low
Location: <file and line>
Problem: <concrete defect>
Why it matters: <observable impact>
Smallest fix: <focused correction>
```

If there are no meaningful issues, return exactly `PASS`.
