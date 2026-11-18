// The widget feed, as the server sends it (lib/widget-feed.js). The server writes the words;
// nothing here knows what a call sheet is. Missing fields fall back to empty, so an older app
// keeps working when the feed grows.
import Foundation

public struct Feed: Codable, Equatable, Sendable {
    public struct Pair: Codable, Equatable, Hashable, Sendable {
        public var k: String
        public var v: String
        public init(k: String, v: String) { self.k = k; self.v = v }
    }

    public struct Day: Codable, Equatable, Identifiable, Sendable {
        public var date: String
        public var letter: String
        public var title: String
        public var sub: String
        public var time: String
        public var chips: [String]
        public var tone: String
        public var color: String?
        public var code: String
        public var lines: [String]
        public var on: [Pair]
        public var posted: Bool
        public var draft: Bool
        public var id: String { date }

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            date = try c.decode(String.self, forKey: .date)
            letter = c.value(.letter, or: "")
            title = c.value(.title, or: "")
            sub = c.value(.sub, or: "")
            time = c.value(.time, or: "")
            chips = c.value(.chips, or: [])
            tone = c.value(.tone, or: "none")
            color = try? c.decodeIfPresent(String.self, forKey: .color)
            code = c.value(.code, or: "")
            lines = c.value(.lines, or: [])
            on = c.value(.on, or: [])
            posted = c.value(.posted, or: false)
            draft = c.value(.draft, or: false)
        }
    }

    public struct Screen: Codable, Equatable, Sendable {
        public var at: Date
        public var date: String
    }

    public var generatedAt: Date
    public var today: String
    public var name: String
    public var days: [Day]
    public var screens: [Screen]
    public var ahead: [Pair]

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        generatedAt = try c.decode(Date.self, forKey: .generatedAt)
        today = c.value(.today, or: "")
        name = c.value(.name, or: "")
        days = try c.decode([Day].self, forKey: .days)
        screens = c.value(.screens, or: [])
        ahead = c.value(.ahead, or: [])
    }

    public static func decode(_ data: Data) throws -> Feed {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { d in
            let text = try d.singleValueContainer().decode(String.self)
            let f = ISO8601DateFormatter()
            f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = f.date(from: text) { return date }
            f.formatOptions = [.withInternetDateTime]
            if let date = f.date(from: text) { return date }
            throw DecodingError.dataCorrupted(.init(codingPath: d.codingPath, debugDescription: "Not a date: \(text)"))
        }
        return try decoder.decode(Feed.self, from: data)
    }
}

extension KeyedDecodingContainer {
    func value<T: Decodable>(_ key: Key, or fallback: T) -> T {
        ((try? decodeIfPresent(T.self, forKey: key)) ?? nil) ?? fallback
    }
}

public extension Feed.Day {
    /// "OR 12 · Whitfield" reads best as a big "OR 12" over "Whitfield".
    var primary: String { title.components(separatedBy: " · ").first ?? title }
    var secondary: String { title.components(separatedBy: " · ").dropFirst().joined(separator: " · ") }
    /// The one line worth showing under the title when there's room for one.
    var detail: String { lines.first ?? [time, sub].filter { !$0.isEmpty }.joined(separator: " · ") }
    /// The hospital alone: `sub` is "rotation · hospital", and the hospital is the part to keep.
    var site: String { sub.components(separatedBy: " · ").last ?? "" }
    /// The same line with the rotation left out, for where the whole of it won't fit.
    var shortDetail: String { lines.first ?? [time, site].filter { !$0.isEmpty }.joined(separator: " · ") }
}

public extension Feed {
    /// An invented day for the widget gallery, so the preview shows what the widget does.
    static func sample(now: Date) -> Feed? {
        let cal = FeedTimeline.calendar
        let rows: [(String, String, String, String, [String])] = [
            ("OR 12 · Whitfield", "Basic Anesthesia · Harper", "6a–6p", "OR 12", ["Starts 7:30 · 3 cases", "MDA Abara", "JA Marchetti"]),
            ("Basic Anesthesia", "Harper", "6a–6p", "BA", []),
            ("24-hr call", "Basic Anesthesia · Harper", "6a–6a", "24h", []),
            ("Off", "", "", "Off", []), ("Off", "", "", "Off", []),
            ("Basic Anesthesia", "Harper", "6a–6p", "BA", []), ("Basic Anesthesia", "Harper", "6a–6p", "BA", []),
        ]
        let days: [[String: Any]] = rows.enumerated().compactMap { index, row in
            guard let date = cal.date(byAdding: .day, value: index, to: now) else { return nil }
            return [
                "date": FeedTimeline.dayString(date), "letter": String(FeedTimeline.formatter("EEEEE").string(from: date)),
                "title": row.0, "sub": row.1, "time": row.2, "code": row.3, "lines": row.4,
                "tone": row.3 == "Off" ? "off" : row.3 == "24h" ? "call" : "work",
                "on": [["k": "Night float", "v": "Okafor, Lindqvist"], ["k": "10a–7p", "v": "Marchetti"]], "posted": index == 0,
            ]
        }
        let object: [String: Any] = [
            "generatedAt": ISO8601DateFormatter().string(from: now), "today": FeedTimeline.dayString(now), "name": "", "days": days, "screens": [],
            "ahead": [["k": "Next call", "v": "Fri · 24-hr call"], ["k": "Golden weekend", "v": "This weekend"], ["k": "ITE", "v": "81 days"]],
        ]
        return (try? JSONSerialization.data(withJSONObject: object)).flatMap { try? Feed.decode($0) }
    }
}
