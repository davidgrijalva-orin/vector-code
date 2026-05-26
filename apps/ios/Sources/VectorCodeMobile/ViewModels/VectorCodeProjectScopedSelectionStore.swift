import Foundation

struct VectorCodeProjectScopedSelectionStore {
    private var selectedIdByProject: [String: String] = [:]

    mutating func clear() {
        selectedIdByProject.removeAll()
    }

    mutating func remember(projectId: String?, selectedId: String?) {
        guard let projectId, let selectedId else {
            return
        }
        selectedIdByProject[projectId] = selectedId
    }

    mutating func restoreId(for projectId: String, availableIds: [String]) -> String? {
        if let remembered = selectedIdByProject[projectId], availableIds.contains(remembered) {
            return remembered
        }
        return availableIds.first
    }

    mutating func close(
        projectId: String,
        removedId: String,
        removedIndex: Int,
        remainingIds: [String],
        currentProjectId: String?,
        currentSelectedId: String?
    ) -> VectorCodeProjectScopedCloseSelection {
        let nextId = remainingIds.indices.contains(removedIndex) ? remainingIds[removedIndex] : remainingIds.last
        let closedCurrentSelection = currentProjectId == projectId && currentSelectedId == removedId

        if selectedIdByProject[projectId] == removedId {
            selectedIdByProject[projectId] = nextId
        } else if let remembered = selectedIdByProject[projectId], !remainingIds.contains(remembered) {
            selectedIdByProject.removeValue(forKey: projectId)
        }

        return VectorCodeProjectScopedCloseSelection(closedCurrentSelection: closedCurrentSelection, nextId: nextId)
    }
}

struct VectorCodeProjectScopedCloseSelection {
    let closedCurrentSelection: Bool
    let nextId: String?
}
