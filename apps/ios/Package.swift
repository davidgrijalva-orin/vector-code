// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "VectorCodeMobile",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
    ],
    products: [
        .library(
            name: "VectorCodeMobile",
            targets: ["VectorCodeMobile"]
        ),
        .executable(
            name: "VectorCodeMobileApp",
            targets: ["VectorCodeMobileApp"]
        ),
        .executable(
            name: "VectorCodeMobileVerifier",
            targets: ["VectorCodeMobileVerifier"]
        ),
    ],
    dependencies: [
        .package(url: "https://github.com/migueldeicaza/SwiftTerm.git", from: "1.13.0"),
    ],
    targets: [
        .target(
            name: "VectorCodeMobile",
            dependencies: ["SwiftTerm"],
            resources: [
                .process("Resources"),
            ]
        ),
        .executableTarget(
            name: "VectorCodeMobileApp",
            dependencies: ["VectorCodeMobile"]
        ),
        .executableTarget(
            name: "VectorCodeMobileVerifier",
            dependencies: ["VectorCodeMobile"]
        ),
    ]
)
