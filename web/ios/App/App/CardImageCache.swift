import Foundation
import WebKit

/// Serves card art to the WebView over the `cardcache://` scheme, backed by a
/// disk cache in the App Group container.
///
/// **Why a scheme handler rather than a fetch-and-blob-URL.** `cardImageSrc` in
/// `web/src/platform/app/index.ts` is called synchronously from inside
/// `<img src={…}>` at ten call sites, so the JS side has to be able to *name* an
/// image before its bytes exist. A custom scheme keeps that call synchronous:
/// the URL is a promise the native side redeems on demand, and no screen has to
/// learn about loading states.
///
/// **Why not let the WebView load the https URL itself.** Scryfall's API
/// guidelines ask for a descriptive User-Agent, no more than ~10 requests a
/// second, and that images be cached locally rather than hot-linked. A WebView
/// cannot set a User-Agent on a subresource load; this can, and it rate-limits
/// and caches on the way through.
///
/// The cache shares its key space with `ios-src/AppSchemeHandler.swift`: that
/// handler resolves bundle-first-then-cache, so an image cached here at
/// `cards.scryfall.io/normal/front/a/b/<id>.jpg` is readable by the Messages
/// extension under the same relative path.
final class CardImageSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "cardcache"

    /// The App Group both targets share. Declared in `MAC-BUILD.md` as a hard
    /// constraint, so it is spelled out rather than derived.
    static let appGroup = "group.com.happygator.passandplay"

    /// The only host this handler will fetch from. The scheme is reachable from
    /// any script running in the WebView, so without an allowlist it would be an
    /// open proxy that attaches our User-Agent to arbitrary requests.
    static let allowedHost = "cards.scryfall.io"

    /// Scryfall asks for ~10 requests a second; one every 100ms is that ceiling.
    private static let minimumInterval: TimeInterval = 0.1

    private static let userAgent = "PassAndPlayMTG/0.1 (kitchen-table MTG sealed app; +https://happygator.github.io/PassAndPlayMTG/)"

    private let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.httpAdditionalHeaders = ["User-Agent": CardImageSchemeHandler.userAgent, "Accept": "image/jpeg,image/*"]
        // We keep our own disk cache; URLSession's would be a second, redundant copy.
        config.urlCache = nil
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration: config)
    }()

    /// Serialises scheduling so the rate limiter's clock has a single writer.
    private let queue = DispatchQueue(label: "com.happygator.passandplay.cardcache")
    private var nextSlot = DispatchTime.now()

    /// WKWebView raises an Objective-C exception if a task is completed after it
    /// has been stopped, and a scrolling card grid stops tasks constantly. Every
    /// completion is gated on the task still being live.
    private var liveTasks = Set<ObjectIdentifier>()
    private let lock = NSLock()

    /// Where cached bytes live. Prefers the App Group so the Messages extension
    /// can read the same files; falls back to the app's own Caches directory so
    /// the cache still works before the App Group entitlement is provisioned.
    private lazy var cacheRoot: URL? = {
        let fm = FileManager.default
        if let group = fm.containerURL(forSecurityApplicationGroupIdentifier: Self.appGroup) {
            return group.appendingPathComponent("cards", isDirectory: true)
        }
        return fm.urls(for: .cachesDirectory, in: .userDomainMask).first?
            .appendingPathComponent("cards", isDirectory: true)
    }()

    // MARK: - WKURLSchemeHandler

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        let token = ObjectIdentifier(urlSchemeTask)
        lock.lock(); liveTasks.insert(token); lock.unlock()

        guard let url = urlSchemeTask.request.url,
              let remote = Self.remoteURL(for: url) else {
            finish(urlSchemeTask, token: token, status: 400, data: Data())
            return
        }

        if let cached = cachedData(for: remote) {
            finish(urlSchemeTask, token: token, status: 200, data: cached)
            return
        }

        schedule { [weak self] in
            guard let self else { return }
            // The task may have been stopped while it sat in the rate-limit
            // queue — a scrolled-past card. Skip the request entirely.
            guard self.isLive(token) else { return }

            self.session.dataTask(with: remote) { data, response, _ in
                let status = (response as? HTTPURLResponse)?.statusCode ?? 500
                guard status == 200, let data, !data.isEmpty else {
                    self.finish(urlSchemeTask, token: token, status: status, data: Data())
                    return
                }
                self.store(data, for: remote)
                self.finish(urlSchemeTask, token: token, status: 200, data: data)
            }.resume()
        }
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        let token = ObjectIdentifier(urlSchemeTask)
        lock.lock(); liveTasks.remove(token); lock.unlock()
    }

    // MARK: - URL mapping

    /// `cardcache://cards.scryfall.io/normal/front/a/b/<id>.jpg`
    ///   → `https://cards.scryfall.io/normal/front/a/b/<id>.jpg`
    ///
    /// Keeping the host in the custom URL means the mapping is lossless and the
    /// allowlist check is a plain host comparison rather than a guess about
    /// which path shape we are looking at.
    static func remoteURL(for url: URL) -> URL? {
        guard url.scheme == scheme, url.host == allowedHost, !url.path.isEmpty else { return nil }
        var components = URLComponents()
        components.scheme = "https"
        components.host = allowedHost
        components.path = url.path
        return components.url
    }

    // MARK: - Disk cache

    private func cacheURL(for remote: URL) -> URL? {
        guard let root = cacheRoot, let host = remote.host else { return nil }
        return root.appendingPathComponent(host).appendingPathComponent(remote.path)
    }

    private func cachedData(for remote: URL) -> Data? {
        guard let path = cacheURL(for: remote) else { return nil }
        return try? Data(contentsOf: path)
    }

    private func store(_ data: Data, for remote: URL) {
        guard let path = cacheURL(for: remote) else { return }
        let fm = FileManager.default
        do {
            try fm.createDirectory(at: path.deletingLastPathComponent(), withIntermediateDirectories: true)
            // Atomic so a kill mid-write cannot leave a truncated JPEG that would
            // then be served from cache forever.
            try data.write(to: path, options: .atomic)
        } catch {
            // A cache miss is recoverable; a crash is not. Nothing to do but
            // serve the bytes we already have in hand.
        }
    }

    // MARK: - Rate limiting

    private func schedule(_ work: @escaping () -> Void) {
        queue.async {
            let slot = max(DispatchTime.now(), self.nextSlot)
            self.nextSlot = slot + Self.minimumInterval
            self.queue.asyncAfter(deadline: slot, execute: work)
        }
    }

    // MARK: - Completion

    private func isLive(_ token: ObjectIdentifier) -> Bool {
        lock.lock(); defer { lock.unlock() }
        return liveTasks.contains(token)
    }

    private func finish(_ task: WKURLSchemeTask, token: ObjectIdentifier, status: Int, data: Data) {
        DispatchQueue.main.async {
            // Re-checked on the main thread: `stop` also arrives here, so this is
            // the only place the check and the completion cannot interleave.
            self.lock.lock()
            let live = self.liveTasks.remove(token) != nil
            self.lock.unlock()
            guard live, let url = task.request.url else { return }

            let headers = [
                "Content-Type": "image/jpeg",
                "Content-Length": String(data.count),
                // Same-origin policy does not apply to the page's own origin, but
                // the WebView treats a custom scheme as a distinct origin.
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "max-age=31536000",
            ]
            guard let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers) else { return }

            task.didReceive(response)
            if !data.isEmpty { task.didReceive(data) }
            task.didFinish()
        }
    }
}
