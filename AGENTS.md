# VectorCode Agents Instructions

This file provides instructions for AI coding agents working with the VectorCode workbench codebase.

Use the repository source as the authority. Validate TypeScript changes with `npm run compile-check-ts-native` first, then run the narrower extension/client checks that match the files you touched.

Keep VectorCode mobile work DRY. Reuse shared protocol models, project-scoped state helpers, and small SwiftUI controls instead of duplicating request shapes, tab chrome, project rows, buttons, or empty-state UI across iOS views and desktop bridge code.
