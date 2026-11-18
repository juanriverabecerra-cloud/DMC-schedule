import Capacitor
import WidgetKit

/// What the web app can ask the native side for (as `DmcWidget`): where the widgets get their
/// feed, a refresh, and the day a tapped widget wanted to open.
@objc(WidgetBridgePlugin)
public class WidgetBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WidgetBridgePlugin"
    public let jsName = "DmcWidget"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setFeed", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "reload", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pendingDay", returnType: CAPPluginReturnPromise),
    ]

    /// Set when a widget is tapped; the web app collects it once it has loaded.
    private var pending: String?

    override public func load() {
        pending = Self.day(from: ApplicationDelegateProxy.shared.lastURL)
        NotificationCenter.default.addObserver(self, selector: #selector(opened(_:)), name: .capacitorOpenURL, object: nil)
    }

    /// "dmcschedule://day/2026-11-16" → "2026-11-16". Anything else is ignored.
    static func day(from url: URL?) -> String? {
        guard let url, url.scheme == "dmcschedule", url.host == "day" else { return nil }
        let day = url.lastPathComponent
        return day.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) == nil ? nil : day
    }

    @objc private func opened(_ notification: Notification) {
        guard let info = notification.object as? [String: Any], let day = Self.day(from: info["url"] as? URL) else { return }
        pending = day
        notifyListeners("openDay", data: ["day": day])
    }

    @objc func setFeed(_ call: CAPPluginCall) {
        guard let url = call.getString("url"), FeedStore.setFeed(url) else {
            call.reject("That isn't this app's widget feed.")
            return
        }
        WidgetCenter.shared.reloadAllTimelines()
        call.resolve()
    }

    @objc func clear(_ call: CAPPluginCall) {
        FeedStore.clear()
        WidgetCenter.shared.reloadAllTimelines()
        call.resolve()
    }

    @objc func reload(_ call: CAPPluginCall) {
        WidgetCenter.shared.reloadAllTimelines()
        call.resolve()
    }

    @objc func pendingDay(_ call: CAPPluginCall) {
        call.resolve(pending.map { ["day": $0] } ?? [:])
        pending = nil
    }
}
