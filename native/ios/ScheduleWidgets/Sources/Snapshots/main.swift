// Draws every widget size from a feed file, so the designs can be checked on a Mac without Xcode
// or a phone:  swift run WidgetSnapshots <feed.json> <output folder>
import AppKit
import ScheduleWidgetCore
import SwiftUI

let arguments = CommandLine.arguments
guard arguments.count == 3 else {
    print("usage: WidgetSnapshots <feed.json> <output folder>")
    exit(2)
}
let feed = try Feed.decode(Data(contentsOf: URL(fileURLWithPath: arguments[1])))
let output = URL(fileURLWithPath: arguments[2], isDirectory: true)
try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)

struct Tile: View {
    let snapshot: ScheduleSnapshot
    let layout: WidgetLayout
    let dark: Bool

    var size: CGSize {
        switch layout {
        // The sizes on an ordinary iPhone: the narrower the widget, the sooner words run out of room.
        case .small: return CGSize(width: 158, height: 158)
        case .medium: return CGSize(width: 338, height: 158)
        case .large: return CGSize(width: 338, height: 354)
        case .lockRectangular: return CGSize(width: 142, height: 58) // the text area: the phone insets the widget
        case .lockInline: return CGSize(width: 210, height: 26)
        case .lockCircular: return CGSize(width: 76, height: 76)
        }
    }

    var lock: Bool { layout.rawValue.hasPrefix("lock") }

    var body: some View {
        ScheduleView(snapshot: snapshot, layout: layout)
            .padding(lock ? 0 : 16)
            .frame(width: size.width, height: size.height)
            .background(lock ? Color.white.opacity(layout == .lockCircular ? 0.18 : 0) : (dark ? Color(white: 0.11) : .white),
                        in: RoundedRectangle(cornerRadius: layout == .lockCircular ? 38 : lock ? 10 : 24, style: .continuous))
            .foregroundStyle(lock ? Color.white : (dark ? Color.white : Color.black))
            .environment(\.colorScheme, lock || dark ? .dark : .light)
    }
}

struct Sheet: View {
    let title: String
    let snapshot: ScheduleSnapshot
    let dark: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(title).font(.headline).foregroundStyle(.white)
            HStack(alignment: .top, spacing: 16) {
                VStack(alignment: .leading, spacing: 16) {
                    HStack(alignment: .top, spacing: 16) {
                        Tile(snapshot: snapshot, layout: .small, dark: dark)
                        VStack(alignment: .leading, spacing: 10) {
                            Tile(snapshot: snapshot, layout: .lockInline, dark: dark)
                            HStack(spacing: 10) {
                                Tile(snapshot: snapshot, layout: .lockRectangular, dark: dark)
                                Tile(snapshot: snapshot, layout: .lockCircular, dark: dark)
                            }
                        }
                    }
                    Tile(snapshot: snapshot, layout: .medium, dark: dark)
                }
                Tile(snapshot: snapshot, layout: .large, dark: dark)
            }
        }
        .padding(24)
        .background(LinearGradient(colors: [Color(red: 0.16, green: 0.2, blue: 0.34), Color(red: 0.05, green: 0.07, blue: 0.12)], startPoint: .top, endPoint: .bottom))
    }
}

@MainActor
func save<V: View>(_ view: V, as name: String) {
    let renderer = ImageRenderer(content: view)
    renderer.scale = 2
    guard let image = renderer.cgImage, let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) else {
        print("couldn't draw \(name)")
        return
    }
    try? png.write(to: output.appendingPathComponent("\(name).png"))
    print("drew \(name).png")
}

@MainActor
func drawAll() {
    // One sheet per change of focus in the feed, plus the two states with nothing to show.
    let moments = [feed.generatedAt] + feed.screens.map(\.at).filter { $0 > feed.generatedAt }
    for (index, moment) in moments.enumerated() {
        let snapshot = FeedTimeline.snapshot(feed: feed, at: moment)
        let name = "\(index + 1)-\(snapshot.label.lowercased())-\(snapshot.day?.code.replacingOccurrences(of: " ", with: "") ?? "none")"
        save(Sheet(title: "\(snapshot.label): \(snapshot.day?.title ?? "–")", snapshot: snapshot, dark: index % 2 == 0), as: name)
    }
    save(Sheet(title: "Not set up yet", snapshot: .setup(at: feed.generatedAt), dark: true), as: "0-setup")

    // The timeline a widget would get: every entry must have a day to show.
    let timeline = FeedTimeline.snapshots(feed: feed, now: feed.generatedAt)
    print("timeline:", timeline.map { "\($0.label) \($0.day?.code ?? "?")" }.joined(separator: " → "))
    if timeline.contains(where: { $0.day == nil }) { print("a timeline entry has no day"); exit(1) }
}

// Top-level code runs on the main thread, which is where drawing has to happen.
MainActor.assumeIsolated { drawAll() }
