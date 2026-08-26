import UIKit
import WebKit
import Capacitor

/// Capacitor builds and owns the WKWebView, so the one place a custom scheme can
/// be registered is the configuration it hands out just before creating it.
///
/// Referenced from `Base.lproj/Main.storyboard` in place of the stock
/// `CAPBridgeViewController` that `npx cap add ios` generates. Re-running
/// `cap sync` does not rewrite the storyboard, so that substitution survives.
final class MainViewController: CAPBridgeViewController {
    private let cardImages = CardImageSchemeHandler()

    override func webViewConfiguration(for instanceConfiguration: InstanceConfiguration) -> WKWebViewConfiguration {
        let configuration = super.webViewConfiguration(for: instanceConfiguration)
        configuration.setURLSchemeHandler(cardImages, forURLScheme: CardImageSchemeHandler.scheme)
        return configuration
    }
}
