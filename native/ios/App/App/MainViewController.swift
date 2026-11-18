import Capacitor
import UIKit

/// The app is the website in a native frame. This adds what the website can't do for itself:
/// hand the widgets their feed, and say which parts of the screen the phone keeps for itself.
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(WidgetBridgePlugin())
        bridge?.registerPluginInstance(ScreenPlugin())
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        NotificationCenter.default.post(name: .screenLaidOut, object: nil)
    }
}
