// What each widget size shows. The same day, more of it as the widget grows:
//   small   the day in focus: where you are and when
//   medium  that, plus the details of your room or who's on, and the day after
//   large   that, plus who's on, the week ahead and what's coming (call, golden weekend, exam)
//   lock screen: a line or two, a single line beside the date, or a circle with your room
import SwiftUI

public enum WidgetLayout: String, CaseIterable, Sendable {
    case small, medium, large, lockRectangular, lockInline, lockCircular
}

public struct ScheduleView: View {
    public let snapshot: ScheduleSnapshot
    public let layout: WidgetLayout

    public init(snapshot: ScheduleSnapshot, layout: WidgetLayout) {
        self.snapshot = snapshot
        self.layout = layout
    }

    public var body: some View {
        if let day = snapshot.day {
            switch layout {
            case .small: SmallWidget(s: snapshot, day: day)
            case .medium: MediumWidget(s: snapshot, day: day)
            case .large: LargeWidget(s: snapshot, day: day)
            case .lockRectangular: LockRectangular(s: snapshot, day: day)
            case .lockInline: LockInline(s: snapshot, day: day)
            case .lockCircular: LockCircular(day: day)
            }
        } else {
            Placeholder(status: snapshot.status, layout: layout)
        }
    }
}

// MARK: - colors

extension Color {
    init?(hex: String) {
        let text = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        guard text.count == 6, let n = UInt32(text, radix: 16) else { return nil }
        self.init(red: Double((n >> 16) & 0xff) / 255, green: Double((n >> 8) & 0xff) / 255, blue: Double(n & 0xff) / 255)
    }
}

enum Tone {
    static func color(_ day: Feed.Day) -> Color {
        switch day.tone {
        case "night": return .indigo
        case "call": return .blue
        case "late": return .green
        case "vacation": return .orange
        case "work": return day.color.flatMap(Color.init(hex:)) ?? .blue
        default: return .gray
        }
    }

    static func chip(_ text: String) -> Color {
        let t = text.lowercased()
        if t.contains("night") { return .indigo }
        if t.contains("24") { return .blue }
        if t.contains("12") { return .teal }
        if t.contains("late") { return .green }
        if t.contains("cardiac") { return .purple }
        if t.contains("vacation") { return .orange }
        return .gray
    }
}

// MARK: - pieces

struct DayHeader: View {
    let label: String
    let day: Feed.Day
    var stale = false

    var body: some View {
        HStack(spacing: 5) {
            Circle().fill(Tone.color(day)).frame(width: 7, height: 7)
            Text(label.uppercased()).font(.caption2.weight(.bold)).foregroundStyle(.secondary)
            if day.draft { Text("NOT FINAL").font(.caption2.weight(.bold)).foregroundStyle(.orange) }
            if stale { Text("OLD").font(.caption2.weight(.bold)).foregroundStyle(.orange) }
            Spacer(minLength: 0)
        }
        .lineLimit(1)
    }
}

struct Chip: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.caption2.weight(.semibold))
            .lineLimit(1)
            .padding(.horizontal, 7).padding(.vertical, 3)
            .foregroundStyle(Tone.chip(text))
            .background(Tone.chip(text).opacity(0.16), in: Capsule())
    }
}

struct SectionLabel: View {
    let text: String
    var body: some View { Text(text.uppercased()).font(.caption2.weight(.bold)).foregroundStyle(.secondary).lineLimit(1) }
}

struct PairRow: View {
    let pair: Feed.Pair
    var keyWidth: CGFloat = 66

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(pair.k).font(.caption2).foregroundStyle(.secondary).lineLimit(1).frame(width: keyWidth, alignment: .leading)
            Names(text: pair.v).layoutPriority(1)
            Spacer(minLength: 0)
        }
    }
}

/// One or more names: on one line when they fit, otherwise on two, split between names, so a
/// long name is shown whole instead of being cut off.
struct Names: View {
    let text: String

    var body: some View {
        let names = text.components(separatedBy: ", ")
        let half = (names.count + 1) / 2
        ViewThatFits(in: .horizontal) {
            line(text).fixedSize()
            VStack(alignment: .leading, spacing: 0) {
                if names.count > 1 {
                    line(names[..<half].joined(separator: ", ") + ",")
                    line(names[half...].joined(separator: ", "))
                } else {
                    line(text)
                }
            }
        }
    }

    private func line(_ words: String) -> some View {
        Text(words).font(.caption.weight(.medium)).lineLimit(1).minimumScaleFactor(0.75)
    }
}

/// A title set as large as its space allows, on up to `maxLines` lines, without breaking a word.
/// SwiftUI's own shrink-to-fit gives up on wrapped text and cuts it off, so this offers each
/// size and line count in turn, largest first, and the first that fits is used.
struct FitTitle: View {
    let text: String
    var sizes: [CGFloat] = [30, 26, 22, 19, 17, 15]
    var maxLines = 3

    /// One way of setting the title: a size, and the words on one, two or three lines.
    private struct Setting: Identifiable {
        let id: Int
        let size: CGFloat
        let lines: [String]
    }

    private var settings: [Setting] {
        let words = text.split(separator: " ").map(String.init)
        let most = max(1, min(maxLines, words.count))
        return sizes.enumerated().flatMap { index, size in
            (1...most).map { Setting(id: index * 10 + $0, size: size, lines: Self.lines(words, $0)) }
        }
    }

    var body: some View {
        ViewThatFits {
            ForEach(settings) { setting in
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(setting.lines.enumerated()), id: \.offset) { _, line in
                        Text(line).font(.system(size: setting.size, weight: .bold)).lineLimit(1).fixedSize()
                    }
                }
            }
            Text(text).font(.system(size: sizes.last ?? 15, weight: .bold)).lineLimit(maxLines).minimumScaleFactor(0.8)
        }
    }

    private static let joiners: Set<String> = ["–", "—", "-", "/", "·"]

    /// The words on `count` lines, as even as they'll go. A dash joining two parts of a name
    /// ("Basic Anesthesia – Vascular") gives way to the line break when it falls at one.
    static func lines(_ words: [String], _ count: Int) -> [String] {
        func join(_ part: ArraySlice<String>) -> String {
            var part = Array(part)
            if let first = part.first, joiners.contains(first) { part.removeFirst() }
            if let last = part.last, joiners.contains(last) { part.removeLast() }
            return part.joined(separator: " ")
        }
        guard count > 1, words.count >= count else { return [words.joined(separator: " ")] }
        var best: [String] = []
        var bestWidth = Int.max
        func place(from start: Int, left: Int, done: [String]) {
            if left == 1 {
                let lines = (done + [join(words[start...])]).filter { !$0.isEmpty }
                let widest = lines.map(\.count).max() ?? 0
                if widest < bestWidth { bestWidth = widest; best = lines }
                return
            }
            for end in (start + 1)...(words.count - left + 1) {
                place(from: end, left: left - 1, done: done + [join(words[start..<end])])
            }
        }
        place(from: 0, left: count, done: [])
        return best
    }
}

/// The day in focus. A room reads as a big first line ("OR 12") over who it's with; anything
/// else is one name, set as large as fits.
struct DayBlock: View {
    let day: Feed.Day
    var maxLines = 3

    var body: some View {
        if day.secondary.isEmpty {
            FitTitle(text: day.primary, maxLines: maxLines)
        } else {
            VStack(alignment: .leading, spacing: 1) {
                Text(day.primary).font(.system(size: 30, weight: .bold)).minimumScaleFactor(0.5).lineLimit(1)
                Text(day.secondary).font(.system(size: 17, weight: .semibold)).minimumScaleFactor(0.7).lineLimit(1)
            }
        }
    }
}

struct NextRow: View {
    let label: String
    let day: Feed.Day

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(label.uppercased()).font(.caption2.weight(.bold)).foregroundStyle(.secondary)
            Text(day.title).font(.caption.weight(.semibold)).minimumScaleFactor(0.8)
            Spacer(minLength: 0)
            if !day.time.isEmpty { Text(day.time).font(.caption2).foregroundStyle(.secondary) }
        }
        .lineLimit(1)
    }
}

struct WeekStrip: View {
    let days: [Feed.Day]

    var body: some View {
        HStack(spacing: 4) {
            ForEach(Array(days.enumerated()), id: \.element.id) { index, day in
                VStack(spacing: 2) {
                    Text(day.letter).font(.system(size: 9, weight: .semibold)).foregroundStyle(.secondary)
                    Text(day.code.isEmpty ? "·" : day.code).font(.system(size: 10, weight: .bold)).minimumScaleFactor(0.6)
                }
                .lineLimit(1)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 5).padding(.horizontal, 1)
                .background(Tone.color(day).opacity(index == 0 ? 0.3 : 0.13), in: RoundedRectangle(cornerRadius: 7, style: .continuous))
            }
        }
    }
}

struct AheadRow: View {
    let pairs: [Feed.Pair]

    var body: some View {
        HStack(alignment: .top, spacing: 6) {
            ForEach(pairs, id: \.self) { pair in
                VStack(alignment: .leading, spacing: 0) {
                    Text(pair.v).font(.caption.weight(.bold)).minimumScaleFactor(0.7)
                    Text(pair.k).font(.caption2).foregroundStyle(.secondary)
                }
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }
}

struct Placeholder: View {
    let status: ScheduleSnapshot.Status
    let layout: WidgetLayout

    var message: String { status == .setup ? "Open DMC Schedule and pick yourself" : "Open DMC Schedule to refresh" }

    var body: some View {
        switch layout {
        case .lockInline: Text("Open DMC Schedule")
        case .lockCircular: Image(systemName: "calendar")
        case .lockRectangular:
            VStack(alignment: .leading) { Text("DMC Schedule").font(.headline); Text(message).font(.caption) }
                .frame(maxWidth: .infinity, alignment: .leading)
        default:
            VStack(alignment: .leading, spacing: 6) {
                Image(systemName: "calendar").font(.title2).foregroundStyle(.blue)
                Text("DMC Schedule").font(.headline)
                Text(message).font(.caption).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }
}

// MARK: - home screen

struct SmallWidget: View {
    let s: ScheduleSnapshot
    let day: Feed.Day

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            DayHeader(label: s.label, day: day, stale: s.status == .stale)
            Spacer(minLength: 6)
            DayBlock(day: day).layoutPriority(1)
            Spacer(minLength: 6)
            if !day.detail.isEmpty {
                // All of it on up to two lines (one above a chip), or else without the rotation.
                ViewThatFits(in: .vertical) {
                    Text(day.detail).fixedSize(horizontal: false, vertical: true)
                    Text(day.shortDetail).lineLimit(day.chips.isEmpty ? 2 : 1)
                }
                .font(.caption).foregroundStyle(.secondary)
                .frame(maxHeight: day.chips.isEmpty ? 34 : 17, alignment: .topLeading)
            }
            if let chip = day.chips.first { Chip(text: chip).padding(.top, 4) }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

struct MediumWidget: View {
    let s: ScheduleSnapshot
    let day: Feed.Day

    /// With no room details and nobody on to list, the side shows what's ahead instead.
    private var showsAhead: Bool { day.lines.count <= 1 && day.on.isEmpty }

    var body: some View {
        GeometryReader { box in
            HStack(alignment: .top, spacing: 12) {
                // The day itself needs less room than the names beside it.
                SmallWidget(s: s, day: day).frame(width: max(0, box.size.width - 25) * 0.42)
                Rectangle().fill(.quaternary).frame(width: 1)
                // As many rows as fit above the last line; a row that wraps takes the place of one.
                ViewThatFits(in: .vertical) {
                    side(rows: 3)
                    side(rows: 2)
                    side(rows: 1)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            }
        }
    }

    private func side(rows: Int) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            if day.lines.count > 1 {
                SectionLabel(text: "Your room")
                ForEach(day.lines.dropFirst().prefix(rows), id: \.self) { Text($0).font(.caption.weight(.medium)).lineLimit(1).minimumScaleFactor(0.8) }
            } else if !day.on.isEmpty {
                SectionLabel(text: "Who's on")
                ForEach(day.on.prefix(rows), id: \.self) { PairRow(pair: $0, keyWidth: 58) }
            } else if !s.ahead.isEmpty {
                SectionLabel(text: "Ahead")
                ForEach(s.ahead.prefix(rows), id: \.self) { PairRow(pair: $0, keyWidth: 58) }
            }
            Spacer(minLength: 2)
            footer
        }
    }

    /// The day after, unless it's just more of the same: then the next thing coming up says more.
    @ViewBuilder private var footer: some View {
        if let next = s.next, next.title != day.title || showsAhead || s.ahead.isEmpty {
            last(s.nextLabel, next.title)
        } else if let ahead = s.ahead.first, !showsAhead {
            last(ahead.k, ahead.v)
        }
    }

    private func last(_ label: String, _ words: String) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            SectionLabel(text: label)
            Text(words).font(.caption.weight(.semibold)).lineLimit(1).minimumScaleFactor(0.75)
        }
    }
}

struct LargeWidget: View {
    let s: ScheduleSnapshot
    let day: Feed.Day

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            DayHeader(label: s.label, day: day, stale: s.status == .stale)
            DayBlock(day: day, maxLines: 2).layoutPriority(1)
            let place = [day.sub, day.time].filter { !$0.isEmpty }.joined(separator: " · ")
            if !place.isEmpty { Text(place).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
            if !day.lines.isEmpty {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(day.lines.prefix(3), id: \.self) { Text($0).font(.caption.weight(.medium)).lineLimit(1) }
                }
            }
            if !day.chips.isEmpty { HStack(spacing: 5) { ForEach(day.chips.prefix(3), id: \.self) { Chip(text: $0) } } }
            if let next = s.next {
                Divider()
                NextRow(label: s.nextLabel, day: next)
            }
            if !day.on.isEmpty {
                Divider()
                VStack(alignment: .leading, spacing: 3) { ForEach(day.on.prefix(day.lines.isEmpty ? 4 : 3), id: \.self) { PairRow(pair: $0) } }
            }
            Spacer(minLength: 0)
            WeekStrip(days: s.week)
            if !s.ahead.isEmpty { AheadRow(pairs: Array(s.ahead.prefix(3))) }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

// MARK: - lock screen

struct LockRectangular: View {
    let s: ScheduleSnapshot
    let day: Feed.Day

    var body: some View {
        let short = s.label == "Tomorrow" ? "Tmrw" : s.label
        VStack(alignment: .leading, spacing: 0) {
            if !day.secondary.isEmpty {
                // A room: "Tomorrow · OR 12" / "Whitfield" / "Starts 7:30 · 3 cases".
                ViewThatFits(in: .horizontal) {
                    Text("\(s.label) · \(day.primary)").fixedSize()
                    Text("\(short) · \(day.primary)")
                }
                .font(.headline)
                Text(day.secondary).font(.subheadline)
                Lowest(text: day.chips.first ?? day.detail)
            } else {
                // Anything else: "Tomorrow   6a–6p", then the name, on two lines if it needs them.
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text(s.label).font(.headline)
                    Spacer(minLength: 2)
                    if !day.time.isEmpty { Text(day.time).font(.subheadline.weight(.semibold)) }
                }
                // The name on one line with a line under it, or else on two lines: as large as fits.
                // (A name's natural width is always its one-line width, so the two-line choice
                // is made on height alone.)
                ViewThatFits(in: .horizontal) {
                    VStack(alignment: .leading, spacing: 0) {
                        Text(day.title).font(.subheadline).fixedSize()
                        Lowest(text: day.chips.first ?? day.site)
                    }
                    // Split where a dash joins the two halves of the name, like the bigger widgets.
                    let two = FitTitle.lines(day.title.split(separator: " ").map(String.init), 2).joined(separator: "\n")
                    ViewThatFits(in: .vertical) {
                        Text(two).font(.subheadline).lineLimit(2).fixedSize(horizontal: false, vertical: true)
                        Text(two).font(.footnote).lineLimit(2).fixedSize(horizontal: false, vertical: true)
                        Text(two).font(.caption).lineLimit(2)
                    }
                }
            }
        }
        .lineLimit(1)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// The last, quietest line of a lock-screen widget. It never decides whether the lines above fit.
private struct Lowest: View {
    let text: String

    var body: some View {
        if !text.isEmpty {
            Text(text).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                .frame(minWidth: 0, idealWidth: 0, maxWidth: .infinity, alignment: .leading)
        }
    }
}

/// One line beside the date. The phone gives it what's left of the row, so it offers shorter
/// and shorter versions: the whole name, then the short code ("BA-V", "OR 12"), then the code alone.
struct LockInline: View {
    let s: ScheduleSnapshot
    let day: Feed.Day

    var body: some View {
        let label = s.label == "Tomorrow" ? "Tmrw" : s.label
        let start = day.lines.first.flatMap { $0.hasPrefix("Starts ") ? $0.dropFirst(7).components(separatedBy: " · ").first : nil }
        let at = start.map { " \($0)" } ?? ""
        let code = day.code.isEmpty ? day.primary : day.code
        ViewThatFits {
            Text("\(label): \(day.title)\(at)")
            Text("\(label): \(code)\(at)")
            Text("\(label): \(code)")
        }
    }
}

struct LockCircular: View {
    let day: Feed.Day

    var body: some View {
        let parts = day.code.split(separator: " ")
        VStack(spacing: -2) {
            if parts.count == 2 {
                Text(parts[0]).font(.system(size: 11, weight: .semibold))
                Text(parts[1]).font(.system(size: 22, weight: .bold)).minimumScaleFactor(0.6)
            } else {
                Text(day.code.isEmpty ? "–" : day.code).font(.system(size: 17, weight: .bold)).minimumScaleFactor(0.5)
            }
        }
        .lineLimit(1)
        .padding(4)
    }
}
