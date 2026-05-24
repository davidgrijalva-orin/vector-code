import CoreText
import Foundation
import SwiftUI

enum VectorCodeIcon: String {
    case add = "\u{EA60}"
    case arrowRight = "\u{EA9C}"
    case chevronDown = "\u{EAB4}"
    case chevronRight = "\u{EAB6}"
    case clearAll = "\u{EABF}"
    case close = "\u{EA76}"
    case copy = "\u{EBCC}"
    case debugStop = "\u{EAD7}"
    case deviceMobile = "\u{EADB}"
    case edit = "\u{EA73}"
    case file = "\u{EA7B}"
    case files = "\u{EAF0}"
    case folder = "\u{EA83}"
    case folderOpened = "\u{EAF7}"
    case link = "\u{EB15}"
    case projects = "\u{EB46}"
    case refresh = "\u{EB37}"
    case save = "\u{EB4B}"
    case search = "\u{EA6D}"
    case send = "\u{EC0F}"
    case sourceControl = "\u{EA68}"
    case terminal = "\u{EA85}"
    case trash = "\u{EA81}"
}

enum VectorCodeIconFont {
    static let name = "codicon"

    static func registerIfNeeded() {
        _ = registered
    }

    private static let registered: Void = {
        for url in fontURLs() {
            CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
        }
    }()

    private static func fontURLs() -> [URL] {
        var urls: [URL] = []

        #if SWIFT_PACKAGE
        if let packageURL = Bundle.module.url(
            forResource: "codicon",
            withExtension: "ttf",
            subdirectory: "Fonts"
        ) {
            urls.append(packageURL)
        }
        #endif

        if let bundledURL = Bundle.main.url(
            forResource: "codicon",
            withExtension: "ttf",
            subdirectory: "Fonts"
        ) {
            urls.append(bundledURL)
        }
        if let flatBundledURL = Bundle.main.url(forResource: "codicon", withExtension: "ttf") {
            urls.append(flatBundledURL)
        }

        return urls
    }
}

struct VectorCodeIconView: View {
    let icon: VectorCodeIcon
    var size: CGFloat = 16

    init(icon: VectorCodeIcon, size: CGFloat = 16) {
        VectorCodeIconFont.registerIfNeeded()
        self.icon = icon
        self.size = size
    }

    var body: some View {
        Text(icon.rawValue)
            .font(.custom(VectorCodeIconFont.name, size: size))
            .frame(width: size, height: size)
    }
}
