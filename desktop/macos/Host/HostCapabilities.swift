import Foundation

enum HostRPCMethod: String, CaseIterable {
    case capabilities = "host.capabilities"
    case openExternal = "browser.openExternal"
    case chooseDirectory = "files.chooseDirectory"
    case revealFile = "files.reveal"
    case processStatus = "processes.status"
    case restartHarness = "processes.restartHarness"
}

enum HostCapabilities {
    static let rpcVersion = 1

    static var allowedMethods: [String] {
        HostRPCMethod.allCases.map(\.rawValue)
    }

    static var payload: [String: Any] {
        var value = manifestDesktopHost
        value["runtime"] = [
            "platform": "darwin",
            "native": true,
            "rpcAvailable": true
        ]
        value["implementedMethods"] = allowedMethods
        return value
    }

    private static var manifestDesktopHost: [String: Any] {
        guard let url = Bundle.main.url(forResource: "kit", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let host = root["desktopHost"] as? [String: Any]
        else {
            return [
                "schemaVersion": 1,
                "rpc": [
                    "version": rpcVersion,
                    "allowedMethods": allowedMethods
                ]
            ]
        }
        return host
    }
}
