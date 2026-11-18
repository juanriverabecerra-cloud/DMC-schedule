// Turns a feed into what a widget shows at each moment. The server says which day is in focus
// from when ("screens"); this adds the words that depend on the clock ("Today", "Tomorrow").
import Foundation

public struct ScheduleSnapshot: Equatable, Sendable {
    public enum Status: Equatable, Sendable { case ready, setup, stale }
    public var date: Date
    public var status: Status
    public var label: String
    public var day: Feed.Day?
    public var next: Feed.Day?
    public var nextLabel: String
    public var week: [Feed.Day]
    public var ahead: [Feed.Pair]

    public static func setup(at date: Date) -> ScheduleSnapshot {
        ScheduleSnapshot(date: date, status: .setup, label: "", day: nil, next: nil, nextLabel: "", week: [], ahead: [])
    }
}

public enum FeedTimeline {
    /// The hospital's time zone: the schedule's "today" doesn't move when the phone travels.
    public static let zone = TimeZone(identifier: "America/Detroit") ?? .current
    static let staleAfter: TimeInterval = 36 * 3600

    static var calendar: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = zone
        return c
    }

    static func formatter(_ format: String) -> DateFormatter {
        let f = DateFormatter()
        f.calendar = calendar
        f.timeZone = zone
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = format
        return f
    }

    public static func dayString(_ date: Date) -> String { formatter("yyyy-MM-dd").string(from: date) }
    static func dayDate(_ day: String) -> Date? { formatter("yyyy-MM-dd").date(from: day) }

    static func daysApart(_ from: String, _ to: String) -> Int? {
        guard let a = dayDate(from), let b = dayDate(to) else { return nil }
        return calendar.dateComponents([.day], from: a, to: b).day
    }

    public static func label(for day: String, at moment: Date, short: Bool = false) -> String {
        switch daysApart(dayString(moment), day) {
        case 0?: return "Today"
        case 1?: return "Tomorrow"
        default:
            guard let date = dayDate(day) else { return "" }
            return formatter(short ? "EEE" : "EEEE").string(from: date)
        }
    }

    /// Which day the feed says to show at a moment.
    static func focus(_ feed: Feed, at moment: Date) -> String {
        let screens = feed.screens.sorted { $0.at < $1.at }
        return screens.last { $0.at <= moment }?.date ?? screens.first?.date ?? dayString(moment)
    }

    public static func snapshot(feed: Feed?, at moment: Date) -> ScheduleSnapshot {
        guard let feed else { return .setup(at: moment) }
        let date = focus(feed, at: moment)
        guard let index = feed.days.firstIndex(where: { $0.date == date }) else {
            return ScheduleSnapshot(date: moment, status: .stale, label: "", day: nil, next: nil, nextLabel: "", week: [], ahead: [])
        }
        let next = index + 1 < feed.days.count ? feed.days[index + 1] : nil
        return ScheduleSnapshot(
            date: moment,
            status: moment.timeIntervalSince(feed.generatedAt) > staleAfter ? .stale : .ready,
            label: label(for: date, at: moment),
            day: feed.days[index],
            next: next,
            nextLabel: next.map { label(for: $0.date, at: moment, short: true) } ?? "",
            week: Array(feed.days[index...].prefix(7)),
            ahead: feed.ahead
        )
    }

    /// Now, each change of focus in the next two days, and each midnight (when "Tomorrow" becomes "Today").
    public static func snapshots(feed: Feed?, now: Date) -> [ScheduleSnapshot] {
        guard let feed else { return [.setup(at: now)] }
        let horizon = now.addingTimeInterval(48 * 3600)
        var moments = [now] + feed.screens.map(\.at).filter { $0 > now && $0 < horizon }
        var midnight = calendar.startOfDay(for: now)
        for _ in 0..<2 {
            guard let next = calendar.date(byAdding: .day, value: 1, to: midnight) else { break }
            midnight = next
            moments.append(next)
        }
        var seen = Set<Date>()
        return moments.sorted().filter { seen.insert($0).inserted }.map { snapshot(feed: feed, at: $0) }
    }

    /// The OR sheet moves in the afternoon and evening, so look more often then.
    public static func refreshDate(after now: Date) -> Date {
        let hour = calendar.component(.hour, from: now)
        return now.addingTimeInterval((12..<22).contains(hour) ? 30 * 60 : 90 * 60)
    }
}
