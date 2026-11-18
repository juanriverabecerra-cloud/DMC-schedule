// Where the app leaves the feed's address for the widgets, and where the last good feed is kept
// so a widget still has something to show with no signal.
import Foundation

public enum FeedStore {
    public static let group = "group.app.netlify.dmcschedule"
    public static let host = "dmcschedule.netlify.app"
    static let urlKey = "feedURL"
    static let cacheKey = "feedCache"

    static var defaults: UserDefaults? { UserDefaults(suiteName: group) }

    public static var feedURL: URL? {
        defaults?.string(forKey: urlKey).flatMap(URL.init(string:))
    }

    /// Only the app's own widget feed is accepted, so nothing can point the widgets elsewhere.
    public static func allowed(_ text: String) -> URL? {
        guard let url = URL(string: text), url.path.hasPrefix("/api/widget/") else { return nil }
        if url.scheme == "https", url.host == host { return url }
        #if DEBUG
        if url.host == "localhost" || url.host == "127.0.0.1" { return url }
        #endif
        return nil
    }

    @discardableResult
    public static func setFeed(_ text: String) -> Bool {
        guard let url = allowed(text) else { return false }
        if defaults?.string(forKey: urlKey) != url.absoluteString { defaults?.removeObject(forKey: cacheKey) }
        defaults?.set(url.absoluteString, forKey: urlKey)
        return true
    }

    public static func clear() {
        defaults?.removeObject(forKey: urlKey)
        defaults?.removeObject(forKey: cacheKey)
    }

    public static func cached() -> Feed? {
        defaults?.data(forKey: cacheKey).flatMap { try? Feed.decode($0) }
    }

    /// The newest feed, or the last good one when the server can't be reached.
    public static func load(session: URLSession = .shared) async -> Feed? {
        guard let url = feedURL else { return nil }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 12)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        do {
            let (data, response) = try await session.data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { return cached() }
            let feed = try Feed.decode(data)
            defaults?.set(data, forKey: cacheKey)
            return feed
        } catch {
            return cached()
        }
    }
}
