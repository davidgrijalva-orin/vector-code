# VectorGraph CLI reference

The production engineering interface is the installed `vectorgraph` executable
from `@orintech/cli`. The plugin is **EXPERIMENTAL / TESTING** and is optional.
This command contract was verified against installed CLI 0.6.1 on 2026-09-03,
its help/implementation, the operation catalogue, and live authenticated reads.
Check `vectorgraph version --json` when using another machine or version.
The plugin's independently pinned CLI runtime is not the workflow runtime.

## Workspace and schema discovery

Use the repository binding in [AGENT_WORKFLOW.md](AGENT_WORKFLOW.md). Examples
below use placeholders deliberately; replace them with that verified binding.
Never copy credentials into repository files or change the global active workspace.

```powershell
vectorgraph version --json
vectorgraph workspace list --json
vectorgraph auth status --workspace '<WORKSPACE>' --json
vectorgraph api operations --workspace '<WORKSPACE>' --json
vectorgraph api call listApiTeams --workspace '<WORKSPACE>' --json
vectorgraph api call listApiProjects --workspace '<WORKSPACE>' --json
```

Verify workspace identity and the bound team in every new session. `listApiTeams`
returns `teams` and `statusesByTeam`, including status UUID, name, and category.
Refresh stored UUIDs if the configured workflow changes. Do not infer a workspace
from a product name or select the first available team/project. Saved profiles
are not a directory of every workspace the human could access. CLI 0.6.1 does
not expose the cross-workspace `listApiWorkspaces` operation. Missing profiles
require authorized CLI login/access; do not substitute QA workspaces or the plugin.

## Read and select

```powershell
vectorgraph api call listApiIssues --workspace '<WORKSPACE>' --query-json '{"teamId":"<TEAM-UUID>","statusCategory":"started","limit":100}' --json
vectorgraph api call listApiIssues --workspace '<WORKSPACE>' --query-json '{"teamId":"<TEAM-UUID>","statusId":"<READY-UUID>","limit":100}' --json
vectorgraph api call getApiIssue --workspace '<WORKSPACE>' --path-json '{"issueIdentifier":"<TICKET-ID>"}' --json
vectorgraph api call listApiIssueComments --workspace '<WORKSPACE>' --path-json '{"issueIdentifier":"<TICKET-ID>"}' --json
vectorgraph api call getApiIssueContext --workspace '<WORKSPACE>' --path-json '{"issueIdentifier":"<TICKET-ID>"}' --json
vectorgraph api call listApiIssueChildren --workspace '<WORKSPACE>' --path-json '{"issueIdentifier":"<TICKET-ID>"}' --json
```

Add `projectId` when the repository binding limits work to one project. Follow
`pageInfo.hasNextPage` and `pageInfo.nextCursor` using `cursor` in subsequent
`--query-json` requests; preserve the other filters. Limits must be 1 through 100.
Do not conclude that a queue is empty or select the highest priority from an
incomplete page. Choose urgent, high, medium, low, then no_priority; break ties
deterministically by identifier after dependency checks. Investigate unknown values.

The short `issues query` command does not forward project, cursor, or sorting
options. In CLI 0.6.1, `--status Ready` silently fails to filter; arbitrary status
names are not supported. Use the actual `statusId` with `api call`. Do not pass
`workspaceSlug` in `--path-json`; the CLI injects workspace routing itself.

`getApiIssue` exposes the issue, description, status, priority, parent/project,
comments, context, relations, links, history, and related evidence. Acceptance
criteria live in Markdown description/context rather than a separate proven
field. Read linked requirements and all relevant comments. Use the dedicated
reads above if detail is incomplete; `vectorgraph context bundle --workspace
'<WORKSPACE>' --issue '<TICKET-ID>' --json` is another available context read.

For dependency direction, a ticket is blocked when it is the source of a
`blocked_by` relation (target is prerequisite), or the target of a `blocks`
relation (source is prerequisite). Fetch each prerequisite and require completion
or an explicit waiver. `related`/duplicate edges alone are not blockers. Also
check textual dependencies, parent/child requirements, and repository admission
gates. Permission-filtered or inaccessible context is not proof of readiness.

## Write and read back

These schemas were checked against the CLI catalogue and Vector's validation
source. Writes require the token's appropriate scopes; operation visibility alone
does not establish permission. Do not probe production mutations to learn schemas.

```powershell
vectorgraph api call updateApiIssue --workspace '<WORKSPACE>' --path-json '{"issueIdentifier":"<TICKET-ID>"}' --body-json '{"statusId":"<IN-PROGRESS-UUID>"}' --idempotency-key '<TRANSITION-KEY>' --json
vectorgraph api call createApiIssueComment --workspace '<WORKSPACE>' --path-json '{"issueIdentifier":"<TICKET-ID>"}' --body-json '{"body":"Implementation, decisions, validation, acceptance-criterion evidence, limitations, and follow-up."}' --idempotency-key '<NOTE-KEY>' --json
vectorgraph api call updateApiIssue --workspace '<WORKSPACE>' --path-json '{"issueIdentifier":"<TICKET-ID>"}' --body-json '{"statusId":"<DONE-UUID>"}' --idempotency-key '<DONE-KEY>' --json
```

Construct JSON as data and pass argument arrays; never interpolate ticket text as
shell code. On shells that alter native JSON quoting, invoke the installed CLI's
Node entrypoint with an argument array instead of changing the payload. Scope
idempotency keys to repository, ticket, candidate, and operation; reuse the exact
key and payload after uncertain results. Read ticket/evidence after each write.
Post evidence before Done, and verify the final actual status. No automatic
acceptance-criteria gate or atomic agent claim was established in this CLI.

Required scopes include `issue:read` for ticket reads, `issue:write` for updates,
`issue:read` plus `comment:write` for comments, and `context:read` plus `issue:read`
for context. Respect structured denials/approval requirements. Preserve description
content when adding notes; update descriptions only when the repository contract
requires a maintained plan and preserve every existing requirement.
