import AppKit
import SwiftUI
import UniformTypeIdentifiers
import WebKit

struct HarnessWebView: NSViewRepresentable {
    let url: URL
    let service: HarnessService

    func makeCoordinator() -> DownloadCoordinator {
        DownloadCoordinator(service: service)
    }

    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.addUserScript(
            WKUserScript(
                source: DownloadCoordinator.sessionDownloadDialogSuppressionScript,
                injectionTime: .atDocumentEnd,
                forMainFrameOnly: true
            )
        )
        configuration.userContentController.addUserScript(
            WKUserScript(
                source: HostRPCBridge.bootstrapScript,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            )
        )
        configuration.userContentController.addScriptMessageHandler(
            context.coordinator.hostRPC,
            contentWorld: .page,
            name: HostRPCBridge.handlerName
        )
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        context.coordinator.attach(to: webView)
        // Private KVC key: hides the default white background so the SwiftUI
        // backdrop shows through while the web UI boots. May break in future
        // macOS versions if WebKit changes its internals.
        webView.setValue(false, forKey: "drawsBackground")
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        guard context.coordinator.shouldLoad(serviceURL: url, currentURL: webView.url) else { return }
        webView.load(URLRequest(url: url))
    }

    @MainActor
    final class DownloadCoordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
        let hostRPC: HostRPCBridge
        private unowned let service: HarnessService

        init(service: HarnessService) {
            self.service = service
            hostRPC = HostRPCBridge(service: service)
        }

        static let sessionDownloadDialogSuppressionScript = #"""
        (() => {
          const style = document.createElement("style");
          style.textContent = `
            [role="presentation"]:has(> [role="dialog"][aria-label="正在导出 Session"]),
            [role="presentation"]:has(> [role="dialog"][aria-label="Exporting Session"]),
            [role="presentation"]:has(> [role="dialog"][aria-label="Session 导出已开始下载"]),
            [role="presentation"]:has(> [role="dialog"][aria-label="Session download started"]) {
              display: none !important;
            }
          `;
          document.head.appendChild(style);

          const messages = [
            "浏览器正在下载 Session ZIP 文件。",
            "The browser is downloading the Session ZIP."
          ];
          const dismiss = () => {
            for (const dialog of document.querySelectorAll('[role="dialog"]')) {
              if (!messages.some((message) => dialog.textContent?.includes(message))) continue;
              const closeLabels = new Set(["关闭", "Close"]);
              const button = [...dialog.querySelectorAll('button')].find((node) =>
                closeLabels.has(node.textContent?.trim() ?? "")
              );
              button?.click();
            }
          };
          dismiss();
          new MutationObserver(dismiss).observe(document.documentElement, {
            childList: true,
            subtree: true
          });
        })();
        """#

        private var activeDownloads: [WKDownload] = []
        private var destinations: [ObjectIdentifier: URL] = [:]
        private var userCancelledDownloads: Set<ObjectIdentifier> = []
        private var sessionLogDownloads: Set<ObjectIdentifier> = []
        private weak var webView: WKWebView?
        private var lastServiceURL: URL?

        func attach(to webView: WKWebView) {
            self.webView = webView
        }

        /// SwiftUI may update this representable while the user is working
        /// through an SSH tunnel. Keep that remote navigation in the existing
        /// WebView instead of snapping back to the local Harness URL. A changed
        /// service URL is followed only while the WebView is still showing the
        /// previous local service (for example after a local Harness restart).
        func shouldLoad(serviceURL: URL, currentURL: URL?) -> Bool {
            defer { lastServiceURL = serviceURL }
            guard currentURL != serviceURL else { return false }
            guard let currentURL else { return true }
            guard let previousServiceURL = lastServiceURL else {
                return currentURL.scheme == "about"
            }
            return previousServiceURL != serviceURL && currentURL == previousServiceURL
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            service.markWebContentReady(webView.url)
        }

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            service.markWebContentUnavailable()
            webView.reload()
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            preferences: WKWebpagePreferences,
            decisionHandler: @escaping (WKNavigationActionPolicy, WKWebpagePreferences) -> Void
        ) {
            if navigationAction.shouldPerformDownload {
                decisionHandler(.download, preferences)
                return
            }

            guard navigationAction.navigationType == .linkActivated,
                  let url = navigationAction.request.url,
                  isExternalURL(url, relativeTo: webView.url)
            else {
                decisionHandler(.allow, preferences)
                return
            }

            openExternally(url)
            decisionHandler(.cancel, preferences)
        }

        // MARK: WKUIDelegate

        func webView(
            _ webView: WKWebView,
            createWebViewWith configuration: WKWebViewConfiguration,
            for navigationAction: WKNavigationAction,
            windowFeatures: WKWindowFeatures
        ) -> WKWebView? {
            // `target="_blank"` and `window.open`: open in the default browser
            // instead of creating a second in-app window.
            if let url = navigationAction.request.url {
                openExternally(url)
            }
            return nil
        }

        func webView(
            _ webView: WKWebView,
            runJavaScriptAlertPanelWithMessage message: String,
            initiatedByFrame frame: WKFrameInfo,
            completionHandler: @escaping () -> Void
        ) {
            let alert = NSAlert()
            alert.alertStyle = .informational
            alert.messageText = "Gildra DSH"
            alert.informativeText = message
            presentAlert(alert) { _ in
                completionHandler()
            }
        }

        func webView(
            _ webView: WKWebView,
            runJavaScriptConfirmPanelWithMessage message: String,
            initiatedByFrame frame: WKFrameInfo,
            completionHandler: @escaping (Bool) -> Void
        ) {
            let alert = NSAlert()
            alert.alertStyle = .warning
            alert.messageText = "Gildra DSH"
            alert.informativeText = message
            alert.addButton(withTitle: "Подтвердить")
            alert.addButton(withTitle: "Отмена")
            presentAlert(alert) { response in
                completionHandler(response == .alertFirstButtonReturn)
            }
        }

        func webView(
            _ webView: WKWebView,
            runJavaScriptTextInputPanelWithPrompt prompt: String,
            defaultText: String?,
            initiatedByFrame frame: WKFrameInfo,
            completionHandler: @escaping (String?) -> Void
        ) {
            let alert = NSAlert()
            alert.alertStyle = .informational
            alert.messageText = "Gildra DSH"
            alert.informativeText = prompt
            let inputField = NSTextField(frame: NSRect(x: 0, y: 0, width: 260, height: 24))
            inputField.stringValue = defaultText ?? ""
            alert.accessoryView = inputField
            alert.addButton(withTitle: "Подтвердить")
            alert.addButton(withTitle: "Отмена")
            presentAlert(alert) { response in
                completionHandler(response == .alertFirstButtonReturn ? inputField.stringValue : nil)
            }
        }

        // MARK: External links

        private func isExternalURL(_ url: URL, relativeTo localURL: URL?) -> Bool {
            guard let scheme = url.scheme?.lowercased() else { return false }
            switch scheme {
            case "http", "https":
                guard let local = localURL else { return true }
                return url.host != local.host || url.port != local.port
            case "mailto", "tel", "file":
                return true
            default:
                // blob:, data:, about:, javascript:, … — let WebKit handle them.
                return false
            }
        }

        private func openExternally(_ url: URL) {
            NSWorkspace.shared.open(url)
        }

        private func presentAlert(
            _ alert: NSAlert,
            completion: @escaping (NSApplication.ModalResponse) -> Void
        ) {
            if let window = NSApp.keyWindow ?? NSApp.mainWindow {
                alert.beginSheetModal(for: window, completionHandler: completion)
            } else {
                completion(alert.runModal())
            }
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationResponse: WKNavigationResponse,
            decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
        ) {
            let policy: WKNavigationResponsePolicy = navigationResponse.canShowMIMEType
                ? .allow
                : .download
            decisionHandler(policy)
        }

        func webView(
            _ webView: WKWebView,
            navigationAction: WKNavigationAction,
            didBecome download: WKDownload
        ) {
            begin(download)
        }

        func webView(
            _ webView: WKWebView,
            navigationResponse: WKNavigationResponse,
            didBecome download: WKDownload
        ) {
            begin(download)
        }

        func download(
            _ download: WKDownload,
            decideDestinationUsing response: URLResponse,
            suggestedFilename: String,
            completionHandler: @escaping (URL?) -> Void
        ) {
            if isSessionLogDownload(response: response, suggestedFilename: suggestedFilename) {
                sessionLogDownloads.insert(ObjectIdentifier(download))
            }
            let panel = NSSavePanel()
            let contentType = response.mimeType.flatMap {
                UTType.types(tag: $0, tagClass: .mimeType, conformingTo: nil).first
            }
            panel.canCreateDirectories = true
            if let contentType {
                panel.allowedContentTypes = [contentType]
                panel.isExtensionHidden = false
            }
            panel.nameFieldStringValue = safeFilename(
                suggestedFilename,
                contentType: contentType
            )

            let handleResult: (NSApplication.ModalResponse) -> Void = { [weak self, weak download] result in
                guard let download else {
                    completionHandler(nil)
                    return
                }
                if result == .OK {
                    if let destination = panel.url {
                        self?.destinations[ObjectIdentifier(download)] = destination
                        completionHandler(destination)
                    } else {
                        completionHandler(nil)
                    }
                } else {
                    self?.userCancelledDownloads.insert(ObjectIdentifier(download))
                    self?.dismissSessionDownloadDialog()
                    completionHandler(nil)
                }
            }

            if let window = NSApp.keyWindow ?? NSApp.mainWindow {
                panel.beginSheetModal(for: window, completionHandler: handleResult)
            } else {
                panel.begin(completionHandler: handleResult)
            }
        }

        func downloadDidFinish(_ download: WKDownload) {
            let isSessionLog = sessionLogDownloads.remove(ObjectIdentifier(download)) != nil
            let destination = destinations.removeValue(forKey: ObjectIdentifier(download))
            finish(download)
            showDownloadSucceeded(destination: destination, isSessionLog: isSessionLog)
        }

        func download(
            _ download: WKDownload,
            didFailWithError error: Error,
            resumeData: Data?
        ) {
            let userCancelled = userCancelledDownloads.remove(ObjectIdentifier(download)) != nil
            destinations.removeValue(forKey: ObjectIdentifier(download))
            sessionLogDownloads.remove(ObjectIdentifier(download))
            finish(download)
            guard !userCancelled, !isSystemCancellation(error) else { return }

            let alert = NSAlert()
            alert.alertStyle = .warning
            alert.messageText = "Ошибка загрузки"
            alert.informativeText = error.localizedDescription
            alert.runModal()
        }

        private func begin(_ download: WKDownload) {
            activeDownloads.append(download)
            download.delegate = self
            dismissSessionDownloadDialog()
        }

        private func finish(_ download: WKDownload) {
            activeDownloads.removeAll { $0 === download }
        }

        private func isSystemCancellation(_ error: Error) -> Bool {
            let nsError = error as NSError
            if nsError.code == NSUserCancelledError {
                return true
            }
            if nsError.domain == NSURLErrorDomain,
               nsError.code == URLError.cancelled.rawValue {
                return true
            }
            if let underlying = nsError.userInfo[NSUnderlyingErrorKey] as? Error {
                return isSystemCancellation(underlying)
            }
            return false
        }

        /// Session log exports follow the stable `dsh-session-*.zip` filename
        /// convention and the `/api/session.export` endpoint (owned by
        /// @deepseek-ai/dsh-session-log-export), which distinguishes them from
        /// ordinary attachment downloads.
        private func isSessionLogDownload(response: URLResponse, suggestedFilename: String) -> Bool {
            let path = response.url?.path.lowercased() ?? ""
            return path.hasSuffix("session.export")
                || suggestedFilename.lowercased().hasPrefix("dsh-session-")
        }

        private func showDownloadSucceeded(destination: URL?, isSessionLog: Bool) {
            let alert = NSAlert()
            alert.alertStyle = .informational
            alert.messageText = isSessionLog ? "Журнал сессии сохранён" : "Файл сохранён"
            alert.informativeText = destination?.path ?? "Файл сохранён в выбранную папку."
            if let window = NSApp.keyWindow ?? NSApp.mainWindow {
                alert.beginSheetModal(for: window)
            } else {
                alert.runModal()
            }
        }

        private func dismissSessionDownloadDialog() {
            let script = #"""
            (() => {
              const messages = [
                "浏览器正在下载 Session ZIP 文件。",
                "The browser is downloading the Session ZIP."
              ];
              const dialog = [...document.querySelectorAll('[role="dialog"]')].find((node) =>
                messages.some((message) => node.textContent?.includes(message))
              );
              if (!dialog) return false;
              const closeLabels = new Set(["关闭", "Close"]);
              const button = [...dialog.querySelectorAll('button')].find((node) =>
                closeLabels.has(node.textContent?.trim() ?? "")
              );
              if (!button) return false;
              button.click();
              return true;
            })();
            """#
            webView?.evaluateJavaScript(script)
        }

        private func safeFilename(
            _ suggestedFilename: String,
            contentType: UTType?
        ) -> String {
            var filename = suggestedFilename
                .replacingOccurrences(of: "/", with: "-")
                .replacingOccurrences(of: ":", with: "-")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            if filename.isEmpty {
                filename = "session-log"
            }
            if URL(fileURLWithPath: filename).pathExtension.isEmpty,
               let fileExtension = contentType?.preferredFilenameExtension {
                filename += ".\(fileExtension)"
            }
            return filename
        }
    }
}
