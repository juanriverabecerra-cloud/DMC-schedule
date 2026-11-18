import Capacitor
import UIKit

extension Notification.Name {
    /// Posted whenever the app's view is laid out again: a turn, a fold, a split view.
    static let screenLaidOut = Notification.Name("DmcScreenLaidOut")
}

/// Tells the web app (as `DmcScreen`) which parts of the screen the phone keeps for itself: the
/// camera and clock on a folding iPhone, and the hinge. The page lays itself out around them
/// instead of leaving the whole edge empty. Older phones report nothing, and the page falls back
/// to the usual safe margins.
@objc(ScreenPlugin)
public class ScreenPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ScreenPlugin"
    public let jsName = "DmcScreen"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "regions", returnType: CAPPluginReturnPromise),
    ]

    private var lastSent = ""

    override public func load() {
        NotificationCenter.default.addObserver(self, selector: #selector(laidOut), name: .screenLaidOut, object: nil)
    }

    @objc func regions(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let now = self.read()
            self.lastSent = Self.signature(now)
            call.resolve(now)
        }
    }

    /// Layout runs many times a second while the phone turns: only a real change is passed on.
    @objc private func laidOut() {
        let now = read()
        let signature = Self.signature(now)
        guard signature != lastSent else { return }
        lastSent = signature
        notifyListeners("change", data: now)
    }

    private static func signature(_ screen: [String: Any]) -> String {
        let regions = (screen["regions"] as? [[String: Any]] ?? []).map { r in
            ["kind", "x", "y", "width", "height"].map { "\(r[$0] ?? "")" }.joined(separator: ",")
        }
        return "\(screen["width"] ?? 0)x\(screen["height"] ?? 0)|" + regions.joined(separator: "|")
    }

    /// Every region, in the page's own coordinates (the page fills the screen edge to edge).
    private func read() -> [String: Any] {
        guard let view = bridge?.webView else { return ["width": 0, "height": 0, "regions": []] }
        var regions: [[String: Any]] = []
        if #available(iOS 27.1, *) {
            let kinds: [(String, UIView.ReservedRegion.Kind)] = [("occlusion", .occlusion), ("division", .division)]
            for (name, kind) in kinds {
                for region in view.reservedRegions(kind: kind) where region.isActive && !region.frame.isEmpty {
                    regions.append([
                        "kind": name,
                        "x": Double(region.frame.minX.rounded()), "y": Double(region.frame.minY.rounded()),
                        "width": Double(region.frame.width.rounded()), "height": Double(region.frame.height.rounded()),
                    ])
                }
            }
        }
        return ["width": Double(view.bounds.width), "height": Double(view.bounds.height), "regions": regions]
    }
}
