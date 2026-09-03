# vector-code agent workflow

VS Code-derived TypeScript/Electron workbench with extensions, browser and node tests, VectorCode desktop/mobile protocol integration. Root instructions prioritize source and DRY shared mobile contracts.

## Usage

- New session: `Work VectorGraph.`
- Continue: `Continue VectorGraph.`
- Specific issue: `Work VectorGraph ticket <TICKET-ID>.`
- Explicit: `Use the vectorgraph-work skill and continue the current VectorGraph engineering workflow.`

## Repository tracker binding

Verified through CLI reads on 2026-09-03: workspace `vectorcode`
(`bf275fab-fe03-44c3-b993-ced522c45a07`), team `VC`
(`658d2b51-5118-46d4-8b60-bf1954501284`). Scope is this product team across its projects;
verify each ticket belongs to this repository before acting.

Ready explicitly means **Todo (`unstarted`) with all dependencies and repository
admission gates satisfied**. Re-read `listApiTeams` each session and match these
identities before using status UUIDs:

| Role | Actual status | UUID |
| --- | --- | --- |
| Ready | Todo | `8e045317-a99b-4517-95ff-b2b7e56f2e69` |
| Active | In Progress | `b2470f8e-e052-4e3a-881d-ab967858f66e` |
| Complete | Done | `f97fabec-a1eb-4e75-b106-b610bc8a8482` |

## Integration and native agents

VectorGraph CLI is the authoritative production integration. The VectorGraph
plugin is **EXPERIMENTAL / TESTING** and is not required by this workflow. Its
existing source, configuration, MCP entries, hooks and tests remain intact.
See [verified CLI syntax and limitations](VECTORGRAPH_CLI.md).

Skills `vectorgraph-work`, `implementation-worker`, and `code-review` live in
`.agents/skills/` for Codex and `.claude/skills/` for Claude, with identical bodies
and metadata. `.codex/agents/` and `.claude/agents/` define `vg-worker` and
`vg-reviewer`. Use native fresh subagents, compact packets and disjoint ownership;
use native worktrees when edit isolation helps. Workers do not own the tracker.
The primary runs deterministic validation, requests one independent review for
meaningful changes, resolves findings, checks every criterion and delivery gate,
then updates the ticket. Critical/High fixes get one focused follow-up review.

Codex project configuration selects `gpt-5.6-sol` with `medium` reasoning. Claude
subagents inherit the session model; Sol is not a Claude model identifier.
Mandatory product/CI reviews still apply. Existing user settings and permissions
are preserved; project configuration loads according to each tool's normal trust
rules. No background service or scheduler is installed. Fresh sessions resume
using ticket comments and branch/worktree evidence.

## Repository validation

Run from this repository root using its existing dependency/toolchain setup.
Choose the relevant commands below plus all existing gates that apply to the
changed behavior. Command discovery is not a claim that application tests passed.

| Command | Purpose | Existing source |
| --- | --- | --- |
| `npm run compile-check-ts-native` | First required TypeScript check | `AGENTS.md; package.json scripts.compile-check-ts-native` |
| `npm run test-node` | Node unit tests when relevant after compilation | `package.json scripts.test-node` |
| `npm run test-browser-no-install` | Browser unit runner when environment prepared | `package.json scripts.test-browser-no-install` |

Always inspect `git diff --check` and the complete intended diff, including new
files. For workflow edits, verify root instruction equality, all three paired
skills, YAML frontmatter, TOML parsing, native skill/agent discovery, and CLI
read access for the repository binding. Do not mutate a real ticket merely to
test a command.

## Repository-specific notes

- npm test only prints guidance; it is not meaningful validation. Select relevant scripts/extensions after initial TypeScript check.
- Preserve nested src/vs/workbench/contrib/imageCarousel/AGENTS.md and existing .agents/skills/launch and vectorcode-release-update skills.

## Maintenance

Edit AGENTS.md and CLAUDE.md together; merge useful content if they diverge,
never overwrite an instruction source blindly. Make matching skill changes in
both native directories and keep the two native agent definitions behaviorally
aligned. Load procedural details only when the corresponding skill is needed.

Native conventions: [Codex skills](https://developers.openai.com/codex/skills/),
[Codex subagents](https://developers.openai.com/codex/subagents/),
[Claude skills](https://code.claude.com/docs/en/skills), and
[Claude subagents](https://code.claude.com/docs/en/sub-agents).
