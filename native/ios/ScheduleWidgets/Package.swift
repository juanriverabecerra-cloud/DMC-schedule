// swift-tools-version: 5.9
// The widgets' model, timing and views as a package, so they can be built and drawn on a Mac
// without Xcode (`npm run snapshots`). The widget extension compiles these same files.
import PackageDescription

let package = Package(
    name: "ScheduleWidgets",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "ScheduleWidgetCore", targets: ["ScheduleWidgetCore"])],
    targets: [
        .target(name: "ScheduleWidgetCore", path: "Sources/Core"),
        .executableTarget(name: "WidgetSnapshots", dependencies: ["ScheduleWidgetCore"], path: "Sources/Snapshots"),
    ]
)
