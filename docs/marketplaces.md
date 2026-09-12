# Marketplaces

Open **Extensions** from the activity bar (`Shift+Command+X` on macOS, `Ctrl+Shift+X` on Windows/Linux).

## Extensions

The existing VS Code extension manager connects to [Open VSX](https://open-vsx.org). Search for an extension, open its details, and choose **Install**. Installed extensions retain the native update, enable/disable, and uninstall actions. **Install from VSIX** remains available in the Extensions menu.

Signed Open VSX packages are verified against the registry's Ed25519 public key before installation. Tampered packages, invalid signatures, unavailable keys, and key URLs outside the registry fail installation. Signature verification remains enabled.

Open VSX is a separate catalog from Microsoft's Visual Studio Marketplace. Availability and licensing vary by publisher; a compatible VSIX can also be installed directly. Extensions that require Microsoft's proprietary services may not work in Vector Code.

## MCP servers

Expand **MCP Marketplace** inside Extensions, or run **MCP: Browse Marketplace** from the Command Palette. Search the [official MCP Registry](https://registry.modelcontextprotocol.io), inspect the publisher, version, description, and generated configuration, then choose **Install Configuration**.

Installation targets the active project's `.vscode/mcp.json`. It preserves existing JSON comments, server entries, and inputs. An existing server is never silently overwritten. The **Installed** view lists configured entries and provides **Edit Configuration** and **Remove** actions. Removal cleans up that server's namespaced inputs while preserving inputs referenced by other servers.

Supported install formats are HTTPS streamable HTTP remotes and stdio packages using npm, PyPI, Docker, or NuGet. Package managers must be available on the machine where a compatible MCP client runs the server. Required secrets become namespaced `${input:...}` prompts instead of storing credentials. Save or revert unsaved configuration changes before installing or removing entries. Installation requires a trusted workspace.

The marketplace installs configuration; it does not start servers or provide an AI tool-calling runtime. Use an MCP-capable client that reads VS Code's `servers`/`inputs` configuration format to run them. This does not restore the removed Codex or chat integration. SSE-only and unsupported package entries remain discoverable but are not offered for installation.

## Implementation provenance

The registry client, schemas, and manifest services are restored from Microsoft VS Code's MIT-licensed source at `13375c8744186c933270842cb2c029d12bc4e86a`. The manifest-to-configuration converter is extracted from its management service to avoid importing chat and agent dependencies. Local changes retain search filters when paginating, encode opaque cursors, report network failures, and preserve required secret prompts. Native workbench controls and services own the project selection, JSON edits, trust, dialogs, and editor navigation.
