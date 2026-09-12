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


This file provides instructions for AI coding agents working with the VectorCode work application codebase.

## Product direction

The authoritative [work application brief](docs/work-application-brief.md) and
[architecture decision](docs/work-application-architecture.md) guide cross-product
work. VectorCode is a general-purpose work application containing an IDE; local
folders and repositories are optional project resources. A desktop work project
may contain zero, one, or many folders; never make its identity one folder URI.
The first milestone is the non-development project document workflow. Explicit workflow priorities replace
blanket non-billing VectorGraph API parity. Preserve local IDE functionality,
security, tenant isolation, licensing, review and release gates. Do not reactivate
retired agent integrations or profiles implicitly.

Use the repository source as the authority. Validate TypeScript changes with `npm run compile-check-ts-native` first, then run the narrower extension/client checks that match the files you touched.

## API client boundary

Owner clarification: the desktop application is a client of Graph and Voice APIs.
Core local work must remain useful without a VectorGraph account; the connected
Graph workflow is optional, not the universal project-creation prerequisite.
The accepted entry experience is durable account-free personal work. An optional
account adds connected context, cross-device continuity and collaboration. Do not
gate basic local capture, editing, organization, recovery or export behind signup;
do not silently upload local materials when an account is connected.
Use explicit, versioned HTTP contracts for shared work and voice capabilities.
Frontend/native presentation code must not import backend services, repositories,
SQL, queues, provider implementations, or backend configuration. Server APIs own
authorization, domain invariants, persistence, processing, relationship mutations,
and authoritative inbox classification. Do not recreate those rules in the UI.
The client owns presentation, editor drafts, explicit context selection, and retry
receipts. Local files, microphones, terminals, and devices use their separately
scoped native service/IPC APIs; artifact or voice access does not grant local access.

Keep the whole codebase DRY. Treat duplicated logic or configuration as a defect: prefer shared helpers, schema/config sources, and thin adapters over copying behavior between desktop, iOS, services, docs, and tests.

Keep VectorCode mobile work DRY. Reuse shared protocol models, project-scoped state helpers, and small SwiftUI controls instead of duplicating request shapes, tab chrome, project rows, buttons, or empty-state UI across iOS views and desktop bridge code.
