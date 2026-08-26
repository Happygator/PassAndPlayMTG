import Messages
import UIKit
import WebKit

/// The Messages extension's entry point: a WKWebView running the same Preact app as the
/// website and the container app, plus the transport that moves game state in and out of it.
///
/// DRAFT: authored on Windows, never compiled. See README.md.
///
/// The division of labour is deliberate and worth preserving: **the JS side owns all game
/// logic and rendering; this file owns only transport.** It decodes a payload out of the
/// selected message, hands it to the page, takes a payload back, and wraps it in an
/// `MSMessage`. It knows nothing about pools, decks or Magic.
final class MessagesViewController: MSMessagesAppViewController {
    private static let appGroup = "group.com.happygator.passandplay"
    /// Must match STATE_PARAM in web/src/messageState.ts.
    private static let stateParameter = "s"
    /// Must match the handler name the page posts to.
    private static let bridgeName = "game"

    private var webView: WKWebView!
    /// Set in `willBecomeActive`; the page may finish loading before or after it arrives.
    private var pendingState: String?
    private var isPageReady = false

    override func viewDidLoad() {
        super.viewDidLoad()

        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(
            AppSchemeHandler(bundleRoot: Self.bundleRoot(), cacheRoot: Self.cacheRoot()),
            forURLScheme: AppSchemeHandler.scheme
        )
        configuration.userContentController.add(self, name: Self.bridgeName)

        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.navigationDelegate = self
        // The app paints its own background; a white flash between presentations reads as a
        // bug rather than as loading.
        webView.isOpaque = false
        webView.backgroundColor = .clear
        // The page handles its own safe-area padding with env(safe-area-inset-*), so the
        // scroll view must not inset the content a second time.
        webView.scrollView.contentInsetAdjustmentBehavior = .never

        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])

        var components = URLComponents()
        components.scheme = AppSchemeHandler.scheme
        components.host = "app"
        components.path = "/index.html"
        if let url = components.url {
            webView.load(URLRequest(url: url))
        }
    }

    // MARK: - Conversation lifecycle

    override func willBecomeActive(with conversation: MSConversation) {
        super.willBecomeActive(with: conversation)
        // The payload rides in the message URL's query (section 6.3). An absent or
        // unreadable one means "no game yet", which the page treats as a fresh start.
        pendingState = Self.statePayload(from: conversation.selectedMessage?.url)
        deliverStateIfReady()
    }

    override func didTransition(to presentationStyle: MSMessagesAppPresentationStyle) {
        super.didTransition(to: presentationStyle)
        // Compact is a tray above the keyboard and is far too short to build a deck in, so
        // it is treated as a "tap to open" affordance only. The page decides what to show.
        let isExpanded = presentationStyle == .expanded
        webView.evaluateJavaScript(
            "window.__setPresentation && window.__setPresentation(\(isExpanded));",
            completionHandler: nil
        )
    }

    // MARK: - Transport

    private func deliverStateIfReady() {
        guard isPageReady, let payload = pendingState else { return }
        pendingState = nil
        // JSON-encode the payload string so quotes and backslashes cannot break out of the
        // expression. Passing a raw string here would be an injection bug waiting to happen.
        guard
            let data = try? JSONSerialization.data(withJSONObject: [payload], options: []),
            let wrapped = String(data: data, encoding: .utf8)
        else { return }
        webView.evaluateJavaScript(
            "window.__onMessageState && window.__onMessageState(\(wrapped)[0]);",
            completionHandler: nil
        )
    }

    /// Build a message for a payload the page produced, and STAGE it in the input field.
    ///
    /// `insert` stages; it does not send. The player taps send themselves — a platform rule,
    /// not a setting, and the reason the flow has to tolerate several deliberate sends per
    /// game rather than syncing quietly in the background (section 6.2).
    private func stage(payload: String, caption: String) {
        guard let conversation = activeConversation else { return }

        var components = URLComponents()
        components.scheme = AppSchemeHandler.scheme
        components.host = "game"
        components.queryItems = [URLQueryItem(name: Self.stateParameter, value: payload)]
        guard let url = components.url else { return }

        let layout = MSMessageTemplateLayout()
        layout.caption = caption

        // Reusing the selected message's session is what makes the bubbles COLLAPSE: a new
        // message in the same session replaces the previous one in the transcript rather
        // than stacking, so a conversation holds one live game bubble however long the game
        // runs.
        let message = MSMessage(session: conversation.selectedMessage?.session ?? MSSession())
        message.layout = layout
        message.url = url

        conversation.insert(message) { error in
            if let error = error {
                NSLog("Could not stage the game message: \(error.localizedDescription)")
            }
        }
    }

    // MARK: - Paths

    private static func bundleRoot() -> URL {
        // `web` is the folder reference holding the built dist-imsg bundle (see README).
        Bundle.main.bundleURL.appendingPathComponent("web")
    }

    private static func cacheRoot() -> URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)
    }

    private static func statePayload(from url: URL?) -> String? {
        guard
            let url = url,
            let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        else { return nil }
        return components.queryItems?.first(where: { $0.name == stateParameter })?.value
    }
}

// MARK: - Page ready

extension MessagesViewController: WKNavigationDelegate {
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        isPageReady = true
        deliverStateIfReady()
    }
}

// MARK: - Messages from the page

extension MessagesViewController: WKScriptMessageHandler {
    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard message.name == Self.bridgeName, let body = message.body as? [String: Any] else {
            return
        }

        switch body["type"] as? String {
        case "state":
            guard let payload = body["payload"] as? String else { return }
            stage(payload: payload, caption: body["caption"] as? String ?? "Your turn")
        case "expand":
            // Deck building needs the full sheet; the page asks when it is ready to.
            requestPresentationStyle(.expanded)
        default:
            break
        }
    }
}
