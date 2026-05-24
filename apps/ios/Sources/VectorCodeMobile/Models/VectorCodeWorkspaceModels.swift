import Foundation

public struct VectorCodeRemoteWorkspaceSnapshot: Codable, Equatable, Sendable {
    public var activeProjectId: String?
    public var projects: [VectorCodeProjectSummary]
    public var filesByProject: [String: [VectorCodeFileNode]]
    public var fileTreeTruncatedByProject: [String: Bool]
    public var editorsByProject: [String: [VectorCodeEditorTab]]
    public var terminalsByProject: [String: [VectorCodeTerminalTab]]

    public init(
        activeProjectId: String? = nil,
        projects: [VectorCodeProjectSummary] = [],
        filesByProject: [String: [VectorCodeFileNode]] = [:],
        fileTreeTruncatedByProject: [String: Bool] = [:],
        editorsByProject: [String: [VectorCodeEditorTab]] = [:],
        terminalsByProject: [String: [VectorCodeTerminalTab]] = [:]
    ) {
        self.activeProjectId = activeProjectId
        self.projects = projects
        self.filesByProject = filesByProject
        self.fileTreeTruncatedByProject = fileTreeTruncatedByProject
        self.editorsByProject = editorsByProject
        self.terminalsByProject = terminalsByProject
    }

    private enum CodingKeys: String, CodingKey {
        case activeProjectId
        case projects
        case filesByProject
        case fileTreeTruncatedByProject
        case editorsByProject
        case terminalsByProject
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        activeProjectId = try container.decodeIfPresent(String.self, forKey: .activeProjectId)
        projects = try container.decodeIfPresent([VectorCodeProjectSummary].self, forKey: .projects) ?? []
        filesByProject = try container.decodeIfPresent([String: [VectorCodeFileNode]].self, forKey: .filesByProject) ?? [:]
        fileTreeTruncatedByProject = try container.decodeIfPresent([String: Bool].self, forKey: .fileTreeTruncatedByProject) ?? [:]
        editorsByProject = try container.decodeIfPresent([String: [VectorCodeEditorTab]].self, forKey: .editorsByProject) ?? [:]
        terminalsByProject = try container.decodeIfPresent([String: [VectorCodeTerminalTab]].self, forKey: .terminalsByProject) ?? [:]
    }

    public var activeProject: VectorCodeProjectSummary? {
        guard let activeProjectId else {
            return projects.first
        }
        return projects.first { $0.id == activeProjectId } ?? projects.first
    }
}

public struct VectorCodeProjectSummary: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let name: String
    public let path: String
    public var isOnline: Bool

    public init(id: String, name: String, path: String, isOnline: Bool = true) {
        self.id = id
        self.name = name
        self.path = path
        self.isOnline = isOnline
    }
}

public struct VectorCodeFileNode: Codable, Identifiable, Equatable, Sendable {
    public enum Kind: String, Codable, Sendable {
        case file
        case folder
    }

    public var id: String { path }
    public let name: String
    public let path: String
    public let kind: Kind
    public var children: [VectorCodeFileNode]
    public var childrenTruncated: Bool

    public init(name: String, path: String, kind: Kind, children: [VectorCodeFileNode] = [], childrenTruncated: Bool = false) {
        self.name = name
        self.path = path
        self.kind = kind
        self.children = children
        self.childrenTruncated = childrenTruncated
    }

    private enum CodingKeys: String, CodingKey {
        case name
        case path
        case kind
        case children
        case childrenTruncated
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        name = try container.decode(String.self, forKey: .name)
        path = try container.decode(String.self, forKey: .path)
        kind = try container.decode(Kind.self, forKey: .kind)
        children = try container.decodeIfPresent([VectorCodeFileNode].self, forKey: .children) ?? []
        childrenTruncated = try container.decodeIfPresent(Bool.self, forKey: .childrenTruncated) ?? false
    }
}

public struct VectorCodeEditorTab: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let projectId: String
    public let path: String
    public var title: String
    public var language: String
    public var isDirty: Bool
    public var content: String?
    public var version: String?

    public init(
        id: String,
        projectId: String,
        path: String,
        title: String,
        language: String,
        isDirty: Bool = false,
        content: String? = nil,
        version: String? = nil
    ) {
        self.id = id
        self.projectId = projectId
        self.path = path
        self.title = title
        self.language = language
        self.isDirty = isDirty
        self.content = content
        self.version = version
    }
}

public struct VectorCodeTerminalTab: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let projectId: String
    public var title: String
    public var cwd: String
    public var isActive: Bool
    public var output: [String]
    public var rawOutput: String?

    public init(id: String, projectId: String, title: String, cwd: String, isActive: Bool = false, output: [String] = [], rawOutput: String? = nil) {
        self.id = id
        self.projectId = projectId
        self.title = title
        self.cwd = cwd
        self.isActive = isActive
        self.output = output
        self.rawOutput = rawOutput
    }

    private enum CodingKeys: String, CodingKey {
        case id
        case projectId
        case title
        case cwd
        case isActive
        case output
        case rawOutput
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        projectId = try container.decode(String.self, forKey: .projectId)
        title = try container.decode(String.self, forKey: .title)
        cwd = try container.decode(String.self, forKey: .cwd)
        isActive = try container.decode(Bool.self, forKey: .isActive)
        output = try container.decodeIfPresent([String].self, forKey: .output) ?? []
        rawOutput = try container.decodeIfPresent(String.self, forKey: .rawOutput)
    }
}
