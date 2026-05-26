import Foundation

public enum VectorCodeLanguageInference {
    public static func language(for path: String) -> String {
        let ext = URL(fileURLWithPath: path).pathExtension.lowercased()
        return VectorCodeGeneratedConfig.languageByExtension[ext] ?? "text"
    }
}
