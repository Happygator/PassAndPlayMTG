import Foundation
import WebKit

/// Serves the built web bundle to the extension's WKWebView over a custom scheme.
///
/// DRAFT: authored on Windows, never compiled. See README.md.
///
/// A `file://` URL will not do. A file origin is opaque, so `fetch()` — which is how the app
/// loads every cube, booster set, banlist and the card catalogue — fails against it, and the
/// built `index.html` refers to `/assets/`, `/fonts/` and `/icons/` absolutely, which resolve
/// to the filesystem root under `file://`. A custom scheme gives the page a real origin, so
/// both absolute paths and `fetch` behave exactly as they do on the website.
///
/// Two roots, in order: the extension's own bundle holds the shipped app and its cube images,
/// and the App Group container holds card images cached at runtime (section 7.2). Sharing one
/// key space means a lookup is just "bundle first, then cache".
final class AppSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "passandplay"

    private let bundleRoot: URL
    private let cacheRoot: URL?

    init(bundleRoot: URL, cacheRoot: URL?) {
        self.bundleRoot = bundleRoot
        self.cacheRoot = cacheRoot
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else {
            urlSchemeTask.didFailWithError(SchemeError.badRequest)
            return
        }

        // A path of "/" is the app shell; everything else is a file under one of the roots.
        var path = url.path
        if path.isEmpty || path == "/" { path = "/index.html" }
        let relative = String(path.dropFirst())

        guard let fileURL = resolve(relative: relative) else {
            // A 404 rather than a failure: the JS side already handles a non-ok response by
            // falling back (see dataRefresh.ts), and failing the task logs noise instead.
            let response = HTTPURLResponse(
                url: url,
                statusCode: 404,
                httpVersion: "HTTP/1.1",
                headerFields: nil
            )!
            urlSchemeTask.didReceive(response)
            urlSchemeTask.didFinish()
            return
        }

        do {
            let data = try Data(contentsOf: fileURL)
            let response = HTTPURLResponse(
                url: url,
                statusCode: 200,
                httpVersion: "HTTP/1.1",
                headerFields: [
                    "Content-Type": Self.mimeType(for: fileURL.pathExtension),
                    "Content-Length": String(data.count),
                    // The bundle is immutable for the life of a build, and the WebView is
                    // recreated often in an extension; caching avoids re-reading the
                    // catalogue from disk on every presentation.
                    "Cache-Control": "max-age=31536000",
                ]
            )!
            urlSchemeTask.didReceive(response)
            urlSchemeTask.didReceive(data)
            urlSchemeTask.didFinish()
        } catch {
            urlSchemeTask.didFailWithError(error)
        }
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        // Every response is delivered synchronously in `start`, so there is nothing in
        // flight to cancel. This method still has to exist to satisfy the protocol.
    }

    /// Bundle first, then the runtime image cache in the App Group.
    private func resolve(relative: String) -> URL? {
        let candidate = bundleRoot.appendingPathComponent(relative)
        if FileManager.default.fileExists(atPath: candidate.path) { return candidate }
        if let cacheRoot = cacheRoot {
            let cached = cacheRoot.appendingPathComponent(relative)
            if FileManager.default.fileExists(atPath: cached.path) { return cached }
        }
        return nil
    }

    private static func mimeType(for pathExtension: String) -> String {
        switch pathExtension.lowercased() {
        case "html": return "text/html; charset=utf-8"
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json": return "application/json; charset=utf-8"
        // The catalogue and the booster sets ship pre-gzipped. Serving the encoding rather
        // than the type matters: the JS sniffs the gzip magic number and decompresses in
        // the page, so this must NOT be reported as text or WebKit may decode it first.
        case "gz": return "application/octet-stream"
        case "jpg", "jpeg": return "image/jpeg"
        case "png": return "image/png"
        case "svg": return "image/svg+xml"
        case "woff2": return "font/woff2"
        case "webmanifest": return "application/manifest+json"
        default: return "application/octet-stream"
        }
    }

    enum SchemeError: Error {
        case badRequest
    }
}
