import Foundation

public extension VectorCodeRemoteWorkspaceSnapshot {
    static let empty = VectorCodeRemoteWorkspaceSnapshot()

    static let sample = VectorCodeRemoteWorkspaceSnapshot(
        activeProjectId: "job-board",
        projects: [
            VectorCodeProjectSummary(id: "job-board", name: "job_board", path: "~/OrinTech/job_board"),
            VectorCodeProjectSummary(id: "neuron", name: "NEURON", path: "~/OrinTech/NEURON"),
        ],
        filesByProject: [
            "job-board": [
                VectorCodeFileNode(name: "apps", path: "apps", kind: .folder, children: [
                    VectorCodeFileNode(name: "web", path: "apps/web", kind: .folder, children: [
                        VectorCodeFileNode(name: "page.tsx", path: "apps/web/app/page.tsx", kind: .file),
                    ]),
                ]),
                VectorCodeFileNode(name: "README.md", path: "README.md", kind: .file),
                VectorCodeFileNode(name: "package.json", path: "package.json", kind: .file),
            ],
            "neuron": [
                VectorCodeFileNode(name: "products", path: "products", kind: .folder, children: [
                    VectorCodeFileNode(name: "audio-lab", path: "products/audio-lab", kind: .folder),
                ]),
                VectorCodeFileNode(name: "README.md", path: "README.md", kind: .file),
            ],
        ],
        editorsByProject: [
            "job-board": [
                VectorCodeEditorTab(
                    id: "job-board:README.md",
                    projectId: "job-board",
                    path: "README.md",
                    title: "README.md",
                    language: "markdown",
                    content: "# job_board\n\nOpen from desktop, continue on phone.\n"
                ),
            ],
            "neuron": [
                VectorCodeEditorTab(
                    id: "neuron:README.md",
                    projectId: "neuron",
                    path: "README.md",
                    title: "README.md",
                    language: "markdown",
                    content: "# NEURON\n\nProject state restores when you switch back.\n"
                ),
            ],
        ],
        terminalsByProject: [
            "job-board": [
                VectorCodeTerminalTab(
                    id: "job-board:terminal-1",
                    projectId: "job-board",
                    title: "zsh",
                    cwd: "~/OrinTech/job_board",
                    isActive: true,
                    output: ["david@Mac job_board % pnpm test", "Tests ready."]
                ),
                VectorCodeTerminalTab(
                    id: "job-board:terminal-2",
                    projectId: "job-board",
                    title: "server",
                    cwd: "~/OrinTech/job_board",
                    output: ["ready - started server on 3000"]
                ),
            ],
            "neuron": [
                VectorCodeTerminalTab(
                    id: "neuron:terminal-1",
                    projectId: "neuron",
                    title: "zsh",
                    cwd: "~/OrinTech/NEURON",
                    isActive: true,
                    output: ["david@Mac NEURON % swift test"]
                ),
            ],
        ]
    )
}
