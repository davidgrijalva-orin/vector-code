# VectorGraph Tickets in VectorCode

Open **Tickets** in the desktop sidebar. The Projects controls use the same Add,
Select, and Close behavior as the rest of VectorCode.

For each local project, choose a saved VectorGraph workspace and then its team.
VectorCode remembers that mapping on this machine without changing the CLI's
default workspace. The official `@orintech/cli` npm package must be installed on
your shell PATH and signed in with `vectorgraph auth login`.

Search matches the identifiers, titles, and project names of loaded tickets.
The status filter also applies to loaded tickets. Use **Load more tickets** when
another page is available, or **Refresh** to fetch the team's current list.
Tab and Shift+Tab move between controls; arrow keys, Home, and End navigate the
list; Enter or Space opens a ticket.

Tickets open in regular read-only editor tabs. Descriptions and comments render
as Markdown; **Refresh** fetches the latest details, and **Retry** recovers from a
failed request. Tabs restore their workspace and ticket identity after restart
and fetch fresh content. Ticket bodies and credentials are not serialized into
editor state. Markdown cannot execute commands or HTML, and remote images are
not loaded automatically. Web links use the workbench's opener validation.

The view does not update ticket status or post comments. CLI execution and saved
credentials stay in the desktop main process; the renderer receives only the
fields required by the view through four read operations. The browser workbench
reports that desktop access is required.
