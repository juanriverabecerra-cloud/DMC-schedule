// The widget itself: fetch the feed, lay out a timeline, and draw it at whatever size it was
// added. The drawing and the timing live in ScheduleWidgets/Sources/Core.
import SwiftUI
import WidgetKit

struct ScheduleEntry: TimelineEntry {
    let date: Date
    let snapshot: ScheduleSnapshot
}

struct ScheduleProvider: TimelineProvider {
    /// In the widget gallery, before anyone has signed in, show an example instead of a blank.
    private func current(preview: Bool) -> ScheduleEntry {
        let now = Date()
        let feed = FeedStore.cached() ?? (preview ? Feed.sample(now: now) : nil)
        return ScheduleEntry(date: now, snapshot: FeedTimeline.snapshot(feed: feed, at: now))
    }

    func placeholder(in context: Context) -> ScheduleEntry { current(preview: true) }

    func getSnapshot(in context: Context, completion: @escaping (ScheduleEntry) -> Void) {
        completion(current(preview: context.isPreview))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<ScheduleEntry>) -> Void) {
        Task {
            let feed = await FeedStore.load()
            let now = Date()
            let entries = FeedTimeline.snapshots(feed: feed, now: now).map { ScheduleEntry(date: $0.date, snapshot: $0) }
            completion(Timeline(entries: entries, policy: .after(FeedTimeline.refreshDate(after: now))))
        }
    }
}

struct ScheduleWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: ScheduleEntry

    private var layout: WidgetLayout {
        switch family {
        case .systemSmall: return .small
        case .systemMedium: return .medium
        case .accessoryRectangular: return .lockRectangular
        case .accessoryInline: return .lockInline
        case .accessoryCircular: return .lockCircular
        default: return .large
        }
    }

    var body: some View {
        ScheduleView(snapshot: entry.snapshot, layout: layout)
            .containerBackground(for: .widget) {
                if family == .accessoryCircular { AccessoryWidgetBackground() } else { Color(.systemBackground) }
            }
            // A tap opens the app on the day the widget is showing.
            .widgetURL(entry.snapshot.day.flatMap { URL(string: "dmcschedule://day/\($0.date)") })
    }
}

struct ScheduleWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "Schedule", provider: ScheduleProvider()) { ScheduleWidgetView(entry: $0) }
            .configurationDisplayName("My schedule")
            .description("Where you are today and tomorrow. Bigger sizes add who's on, your week and what's ahead.")
            .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .accessoryRectangular, .accessoryInline, .accessoryCircular])
    }
}

@main
struct ScheduleWidgets: WidgetBundle {
    var body: some Widget { ScheduleWidget() }
}
