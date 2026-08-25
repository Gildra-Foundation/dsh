import AppKit
import Foundation
import WebKit

@MainActor
final class HostRPCBridge: NSObject, WKScriptMessageHandlerWithReply {
    static let handlerName = "gildraHost"

    static let bootstrapScript = #"""
    (() => {
      const handler = window.webkit?.messageHandlers?.gildraHost;
      if (!handler || window.gildraHost) return;
      window.gildraHost = Object.freeze({
        version: 1,
        call(method, params = {}) {
          if (typeof method !== "string" || !params || typeof params !== "object") {
            return Promise.reject(new Error("Некорректный вызов Gildra Host RPC."));
          }
          return handler.postMessage({ version: 1, method, params });
        }
      });
    })();
    """#

    private unowned let service: HarnessService

    init(service: HarnessService) {
        self.service = service
    }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler: @escaping (Any?, String?) -> Void
    ) {
        guard message.frameInfo.isMainFrame,
              isTrusted(origin: message.frameInfo.securityOrigin)
        else {
            replyHandler(nil, "Gildra Host RPC доступен только главному локальному окну Harness.")
            return
        }
        guard let request = message.body as? [String: Any],
              (request["version"] as? NSNumber)?.intValue == HostCapabilities.rpcVersion,
              let name = request["method"] as? String,
              let method = HostRPCMethod(rawValue: name),
              let params = request["params"] as? [String: Any]
        else {
            replyHandler(nil, "Неизвестный или некорректный метод Gildra Host RPC.")
            return
        }

        switch method {
        case .capabilities:
            UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: "DSHLastHostRPCHandshakeAt")
            replyHandler(HostCapabilities.payload, nil)
        case .openExternal:
            openExternal(params: params, replyHandler: replyHandler)
        case .chooseDirectory:
            chooseDirectory(replyHandler: replyHandler)
        case .revealFile:
            revealFile(params: params, replyHandler: replyHandler)
        case .processStatus:
            replyHandler(service.hostStatusPayload, nil)
        case .restartHarness:
            confirmRestart(replyHandler: replyHandler)
        }
    }

    private func isTrusted(origin: WKSecurityOrigin) -> Bool {
        guard origin.protocol == "http" || origin.protocol == "https" else { return false }
        return ["127.0.0.1", "localhost", "::1", "[::1]"].contains(origin.host.lowercased())
    }

    private func openExternal(
        params: [String: Any],
        replyHandler: @escaping (Any?, String?) -> Void
    ) {
        guard let raw = params["url"] as? String,
              let url = URL(string: raw),
              let scheme = url.scheme?.lowercased(),
              ["http", "https", "mailto"].contains(scheme),
              url.user == nil,
              url.password == nil
        else {
            replyHandler(nil, "Разрешены только безопасные HTTP(S) и mailto-ссылки без учётных данных.")
            return
        }
        guard NSWorkspace.shared.open(url) else {
            replyHandler(nil, "Системе не удалось открыть ссылку.")
            return
        }
        replyHandler(["opened": true], nil)
    }

    private func chooseDirectory(replyHandler: @escaping (Any?, String?) -> Void) {
        let panel = NSOpenPanel()
        panel.title = "Выберите рабочую папку"
        panel.prompt = "Выбрать"
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = true
        let completion: (NSApplication.ModalResponse) -> Void = { response in
            guard response == .OK, let url = panel.url else {
                replyHandler(["cancelled": true], nil)
                return
            }
            replyHandler(["cancelled": false, "path": url.path], nil)
        }
        if let window = NSApp.keyWindow ?? NSApp.mainWindow {
            panel.beginSheetModal(for: window, completionHandler: completion)
        } else {
            panel.begin(completionHandler: completion)
        }
    }

    private func revealFile(
        params: [String: Any],
        replyHandler: @escaping (Any?, String?) -> Void
    ) {
        guard let raw = params["path"] as? String, raw.hasPrefix("/") else {
            replyHandler(nil, "Для показа файла требуется абсолютный путь.")
            return
        }
        let url = URL(fileURLWithPath: raw).standardizedFileURL
        guard FileManager.default.fileExists(atPath: url.path) else {
            replyHandler(nil, "Файл или папка не найдены.")
            return
        }
        NSWorkspace.shared.activateFileViewerSelecting([url])
        replyHandler(["revealed": true], nil)
    }

    private func confirmRestart(replyHandler: @escaping (Any?, String?) -> Void) {
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = "Перезапустить Harness?"
        alert.informativeText = "Текущий локальный процесс будет остановлен и запущен заново. Проекты и настройки сохранятся."
        alert.addButton(withTitle: "Перезапустить")
        alert.addButton(withTitle: "Отмена")
        let completion: (NSApplication.ModalResponse) -> Void = { [weak service] response in
            guard response == .alertFirstButtonReturn else {
                replyHandler(["accepted": false], nil)
                return
            }
            replyHandler(["accepted": true], nil)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
                service?.restart()
            }
        }
        if let window = NSApp.keyWindow ?? NSApp.mainWindow {
            alert.beginSheetModal(for: window, completionHandler: completion)
        } else {
            completion(alert.runModal())
        }
    }
}
