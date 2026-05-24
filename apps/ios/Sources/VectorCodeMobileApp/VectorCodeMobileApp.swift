import SwiftUI
#if SWIFT_PACKAGE
import VectorCodeMobile
#endif

@main
struct VectorCodeMobileApp: App {
    var body: some Scene {
        WindowGroup {
            VectorCodeMobileRootView()
                .preferredColorScheme(.dark)
        }
    }
}
