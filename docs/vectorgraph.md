# VectorGraph in Vector Code

Open Explorer and expand **Work**. Choose **Sign in to VectorGraph** to approve Vector Code in your browser. Choose the workspaces you want the IDE to access, then return to the IDE. No CLI installation or terminal login is required.

Vector Code stores its workspace credentials using the operating system encryption service. These credentials belong to the IDE; **Sign Out** clears them without changing VectorGraph CLI profiles. **Reconnect** starts a new browser approval to renew access or change the authorized workspace selection. Canceling approval preserves the existing signed-in account.

When a local project has no saved association, Work reads the Git origin remote and looks for an enabled repository/team mapping in the authorized VectorGraph workspaces. Equivalent GitHub HTTPS and SSH remotes match. One complete match connects automatically. Missing mappings, multiple matches, non-GitHub repositories, unavailable mapping access, or ambiguous remotes require **Choose Workspace**. The chosen workspace and team are remembered for that project; a saved association never silently falls back to a different authorized workspace.

Work shares Explorer with project navigation and files. Issues are scoped to the active project, can be filtered and searched, and open as read-only editor documents. Arrow keys, Home, and End navigate the issue list. Account changes clear stale issue content and invalidate pending requests. The integration currently reads issues, descriptions and comments; issue editing remains in VectorGraph.

## Implementation contract

The main process uses the supported device flow at `/cli/v1/auth/device` and `/cli/v1/auth/device/token`, then the CLI operation gateway at `/cli/v1/workspaces/{workspaceId}/operations/{operationId}`. These are the same protocol endpoints used by the official CLI. The IDE only exposes named authentication methods and the workspace, team, repository and issue reads over IPC. Device codes, access tokens, raw API responses, arbitrary HTTP requests and process execution are not renderer capabilities.

`VectorGraphAuth` owns authorization generations, bounded polling, encrypted persistence and request isolation. `VectorGraphMainService` owns API projections and local repository discovery. The Work view owns project association and interaction, reusing the existing workbench project state, storage, quick picker and issue editor. Repository discovery checks authoritative enabled GitHub mappings and never infers an association from directory names or project documentation.
