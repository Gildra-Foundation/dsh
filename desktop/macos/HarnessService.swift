import Combine
import Foundation

private struct LaunchCommand {
    let executable: URL
    let arguments: [String]
}

@MainActor
final class HarnessService: ObservableObject {
    enum State: Equatable {
        case idle
        case starting
        case installing
        case running
        case failed(String)
        case stopped
    }

    private static let latestDSHVersion = "latest"
    private static let defaultPreferredPort = 3080
    /// How long a launched process may take to report readiness. If `dsh web`
    /// prints no loopback URL within this window (hung, unexpected output
    /// format), the user gets a diagnosable failure instead of an eternal
    /// spinner. 90 s leaves room for a cold `npx` run that downloads the
    /// package first.
    private static let startupReadinessDeadline: TimeInterval = 90
    private static let dshOverrideDefaultsKey = "DSHBinOverride"
    private static let preferredPortDefaultsKey = "DSHPreferredPort"
    private static let pinnedVersionDefaultsKey = "DSHPinnedVersion"

    @Published private(set) var state: State = .idle
    @Published private(set) var serverURL: URL?
    @Published private(set) var webContentReady = false

    private var process: Process?
    private var outputPipe: Pipe?
    private var outputBuffer = ""
    private var requestedStop = false
    private var installing = false
    private var startupDeadlineTask: Task<Void, Never>?

    var statusText: String {
        switch state {
        case .idle: "Готово к запуску"
        case .starting: "Запускаем Gildra DSH…"
        case .installing: "Устанавливаем DSH…"
        case .running: "Приложение готово"
        case .failed(let message): "Ошибка запуска: \(message)"
        case .stopped: "Служба остановлена"
        }
    }

    var isProcessRunning: Bool {
        process?.isRunning ?? false
    }

    var hostStatusPayload: [String: Any] {
        let name: String
        switch state {
        case .idle: name = "idle"
        case .starting: name = "starting"
        case .installing: name = "installing"
        case .running: name = "running"
        case .failed: name = "failed"
        case .stopped: name = "stopped"
        }
        return [
            "state": name,
            "running": isProcessRunning,
            "webContentReady": webContentReady,
            "serverURL": serverURL?.absoluteString ?? NSNull()
        ]
    }

    func markWebContentReady(_ url: URL?) {
        guard let url, ["127.0.0.1", "localhost", "::1"].contains(url.host?.lowercased() ?? "") else { return }
        webContentReady = true
        UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: "DSHLastWebContentReadyAt")
        UserDefaults.standard.set(url.absoluteString, forKey: "DSHLastWebContentURL")
    }

    func markWebContentUnavailable() {
        webContentReady = false
    }

    func start() {
        guard process == nil, !installing else { return }

        requestedStop = false
        outputBuffer = ""
        serverURL = nil
        webContentReady = false
        state = .starting

        if preferredPort == 0 {
            // Explicitly random port: nothing to probe.
            launchProcess(port: 0)
            return
        }

        Task { [weak self] in
            guard let self else { return }
            switch await Self.probeDSH(at: self.preferredPort) {
            case .dshService:
                // An existing DeepSeek Harness already serves the preferred
                // port: connect to it without spawning a child process, so
                // quitting the app never kills a service it didn't start.
                self.serverURL = URL(string: "http://127.0.0.1:\(self.preferredPort)")
                self.state = .running
            case .nothingListening:
                self.launchProcess(port: self.preferredPort)
            case .foreignService:
                self.state = .failed("Порт \(self.preferredPort) занят другой программой. Закройте её или измените DSHPreferredPort.")
            }
        }
    }

    private func launchProcess(port: Int) {
        // The local Web service is an implementation detail of the desktop
        // shell. Never open a separate browser window or tab.
        let baseArguments = ["web", "--host", "127.0.0.1", "--port", "\(port)", "--no-open"]

        let executableURL: URL
        let arguments: [String]
        if let command = resolveDirectCommand(baseArguments: baseArguments) {
            executableURL = command.executable
            arguments = command.arguments
        } else if let npx = locateExecutable(named: "npx") {
            executableURL = npx
            arguments = ["--yes", dshPackageSpecifier] + baseArguments
        } else {
            state = .failed("Не найдены dsh и npx. Установите Node.js или нажмите «Установить DSH».")
            return
        }

        let task = Process()
        let pipe = Pipe()
        task.executableURL = executableURL
        task.arguments = arguments
        task.currentDirectoryURL = defaultWorkingDirectory()

        var environment = ProcessInfo.processInfo.environment
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let dshHome = environment["DSH_HOME"] ?? "\(home)/.dsh"
        let requiredPaths = [
            "\(dshHome)/lsp/node_modules/.bin",
            "\(home)/.gildra-dsh/lsp/node_modules/.bin",
            executableURL.deletingLastPathComponent().path,
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/usr/bin",
            "/bin"
        ]
        let existingPath = environment["PATH"] ?? ""
        environment["PATH"] = (requiredPaths + [existingPath]).joined(separator: ":")
        task.environment = environment

        task.standardOutput = pipe
        task.standardError = pipe
        pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty, let text = String(data: data, encoding: .utf8) else { return }
            DispatchQueue.main.async {
                self?.consumeOutput(text)
            }
        }

        task.terminationHandler = { [weak self] finishedTask in
            DispatchQueue.main.async {
                self?.handleTermination(of: finishedTask, status: finishedTask.terminationStatus)
            }
        }

        do {
            try task.run()
            process = task
            outputPipe = pipe
            armStartupDeadline(for: task)
        } catch {
            pipe.fileHandleForReading.readabilityHandler = nil
            state = .failed(error.localizedDescription)
        }
    }

    /// Starts the readiness countdown for a freshly launched `dsh web`.
    /// The install path (`npm install`) deliberately has no deadline: a slow
    /// download is legitimate there and is bounded by npm's own failure modes.
    private func armStartupDeadline(for launchedTask: Process) {
        startupDeadlineTask?.cancel()
        startupDeadlineTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(Self.startupReadinessDeadline * 1_000_000_000))
            guard !Task.isCancelled else { return }
            self?.handleStartupDeadline(for: launchedTask)
        }
    }

    private func cancelStartupDeadline() {
        startupDeadlineTask?.cancel()
        startupDeadlineTask = nil
    }

    private func handleStartupDeadline(for launchedTask: Process) {
        // Guard against a stale deadline racing a restart or a success: fire
        // only while we are still waiting for readiness of this very process.
        // Mirrors the `finishedTask === process` guard in handleTermination.
        guard launchedTask === process, state == .starting else { return }
        startupDeadlineTask = nil

        outputPipe?.fileHandleForReading.readabilityHandler = nil
        let tail = startupOutputTail()

        // Drop the references before killing the tree: the dying task's
        // terminationHandler is then filtered out by its `=== process` guard
        // and cannot overwrite the diagnostic message below.
        process = nil
        outputPipe = nil
        ProcessTreeController.stop(rootPID: launchedTask.processIdentifier, completion: nil)

        let seconds = Int(Self.startupReadinessDeadline)
        let details = tail.isEmpty
            ? "Процесс ничего не вывел в журнал."
            : "Последний вывод:\n\(tail)"
        state = .failed("Служба не сообщила о готовности за \(seconds) с. \(details)")
    }

    /// Tail of the child's combined stdout/stderr for diagnostics.
    /// `outputBuffer` is already a sliding 16 KB window (see consumeOutput),
    /// so slicing the last lines out of it is the ring buffer we need; the
    /// character cap keeps the status screen from turning into a wall of text.
    private func startupOutputTail(maxLines: Int = 20, maxCharacters: Int = 1_500) -> String {
        let lines = outputBuffer
            .split(whereSeparator: \.isNewline)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
            .suffix(maxLines)
        let tail = lines.joined(separator: "\n")
        guard tail.count > maxCharacters else { return tail }
        return "…" + tail.suffix(maxCharacters)
    }

    private enum PortProbe {
        case dshService
        case nothingListening
        case foreignService
    }

    /// Probes the preferred port for an already-running DeepSeek Harness by
    /// asking for its web manifest. The manifest is served by the shipped Web
    /// frontend and is the most stable, side-effect-free identity marker.
    private static func probeDSH(at port: Int) async -> PortProbe {
        guard let url = URL(string: "http://127.0.0.1:\(port)/manifest.webmanifest") else {
            return .foreignService
        }
        var request = URLRequest(url: url)
        request.timeoutInterval = 2
        request.cachePolicy = .reloadIgnoringLocalCacheData
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                return .foreignService
            }
            return isDSHManifest(data) ? .dshService : .foreignService
        } catch let error as URLError {
            switch error.code {
            case .cannotConnectToHost, .networkConnectionLost, .cannotFindHost:
                return .nothingListening
            default:
                // Timeout and anything else: be conservative and report a
                // port conflict instead of risking a silent double-launch.
                return .foreignService
            }
        } catch {
            return .foreignService
        }
    }

    private static func isDSHManifest(_ data: Data) -> Bool {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return false
        }
        return (object["name"] as? String) == "DeepSeek Harness"
            && (object["short_name"] as? String) == "DSH"
    }

    func stop(completion: (() -> Void)? = nil) {
        requestedStop = true
        // A user-requested stop (including the stop inside restart) must not
        // be reported as a startup failure by a still-armed deadline.
        cancelStartupDeadline()
        outputPipe?.fileHandleForReading.readabilityHandler = nil

        guard let task = process, task.isRunning else {
            process = nil
            outputPipe = nil
            state = .stopped
            completion?()
            return
        }

        ProcessTreeController.stop(rootPID: task.processIdentifier, completion: completion)
    }

    func restart() {
        // Wait for the old process tree to actually exit before launching the
        // replacement, so the new instance never races the dying one for the
        // preferred port.
        stop { [weak self] in
            guard let self else { return }
            self.process = nil
            self.outputPipe = nil
            self.installing = false
            self.state = .idle
            self.start()
        }
    }

    private func consumeOutput(_ text: String) {
        outputBuffer += text
        if outputBuffer.count > 16_384 {
            outputBuffer = String(outputBuffer.suffix(16_384))
        }

        guard !installing,
              serverURL == nil,
              let range = outputBuffer.range(
                  of: #"http://127\.0\.0\.1:[0-9]+"#,
                  options: .regularExpression
              ),
              let url = URL(string: String(outputBuffer[range]))
        else { return }

        serverURL = url
        state = .running
        // Readiness reached: the deadline must never fire after success.
        cancelStartupDeadline()
    }

    private func handleTermination(of finishedTask: Process, status: Int32) {
        // Guard against a stale task's termination racing a restart: after
        // `restart()` has spawned a new process, the old task's handler would
        // otherwise tear down the new pipe and clobber the new state.
        guard finishedTask === process else { return }

        // The process is gone, so termination reporting below owns the final
        // state; a later deadline firing would only overwrite it.
        cancelStartupDeadline()
        outputPipe?.fileHandleForReading.readabilityHandler = nil
        process = nil
        outputPipe = nil

        if installing {
            installing = false
            if status == 0 {
                state = .idle
                start()
            } else {
                let lastLine = outputBuffer
                    .split(whereSeparator: \.isNewline)
                    .last
                    .map(String.init) ?? "код завершения \(status)"
                state = .failed("Не удалось установить DSH: \(lastLine)")
            }
            return
        }

        if requestedStop {
            state = .stopped
        } else if serverURL == nil {
            if outputBuffer.localizedCaseInsensitiveContains("EADDRINUSE") {
                // Lost the race: the probe saw the port free but something
                // grabbed it before `dsh web` bound it. Report the conflict
                // explicitly instead of silently switching ports.
                state = .failed("Порт \(preferredPort) занят. Закройте использующую его программу или измените DSHPreferredPort.")
                return
            }
            let lastLine = outputBuffer
                .split(whereSeparator: \.isNewline)
                .last
                .map(String.init) ?? "код завершения \(status)"
            state = .failed(lastLine)
        } else {
            serverURL = nil
            webContentReady = false
            state = .failed("Локальная служба неожиданно завершилась (\(status)).")
        }
    }

    func installGlobalDSH() {
        guard process == nil, !installing else { return }
        guard let npm = locateExecutable(named: "npm") else {
            state = .failed("Не найден npm. Сначала установите Node.js.")
            return
        }

        installing = true
        requestedStop = false
        outputBuffer = ""
        serverURL = nil
        state = .installing

        let task = Process()
        let pipe = Pipe()
        task.executableURL = npm
        task.arguments = ["install", "--global", dshPackageSpecifier]
        task.currentDirectoryURL = defaultWorkingDirectory()

        var environment = ProcessInfo.processInfo.environment
        let requiredPaths = [
            npm.deletingLastPathComponent().path,
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/usr/bin",
            "/bin"
        ]
        let existingPath = environment["PATH"] ?? ""
        environment["PATH"] = (requiredPaths + [existingPath]).joined(separator: ":")
        task.environment = environment

        task.standardOutput = pipe
        task.standardError = pipe
        pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty, let text = String(data: data, encoding: .utf8) else { return }
            DispatchQueue.main.async {
                self?.consumeOutput(text)
            }
        }

        task.terminationHandler = { [weak self] finishedTask in
            DispatchQueue.main.async {
                self?.handleTermination(of: finishedTask, status: finishedTask.terminationStatus)
            }
        }

        do {
            try task.run()
            process = task
            outputPipe = pipe
        } catch {
            installing = false
            pipe.fileHandleForReading.readabilityHandler = nil
            state = .failed(error.localizedDescription)
        }
    }

    /// The dsh version the app should resolve, install, and pin to.
    /// Read from the `DSHPinnedVersion` preference; defaults to
    /// the version bundled in `config/kit.json`; `latest` means "follow the newest release".
    private var pinnedDSHVersion: String {
        let defaults = UserDefaults.standard
        guard defaults.object(forKey: Self.pinnedVersionDefaultsKey) != nil,
              let value = defaults.string(forKey: Self.pinnedVersionDefaultsKey)?
                  .trimmingCharacters(in: .whitespacesAndNewlines),
              !value.isEmpty
        else { return Self.bundledDSHVersion }
        return value
    }

    private static var bundledDSHVersion: String {
        guard let url = Bundle.main.url(forResource: "kit", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let runtime = object["runtime"] as? [String: Any],
              let version = runtime["dshVersion"] as? String,
              !version.isEmpty
        else { return latestDSHVersion }
        return version
    }

    private var usesLatestVersion: Bool {
        pinnedDSHVersion.caseInsensitiveCompare(Self.latestDSHVersion) == .orderedSame
    }

    /// The npm package specifier passed to `npx` / `npm install`.
    private var dshPackageSpecifier: String {
        usesLatestVersion
            ? "@deepseek-ai/dsh"
            : "@deepseek-ai/dsh@\(pinnedDSHVersion)"
    }

    private var preferredPort: Int {
        let defaults = UserDefaults.standard
        guard defaults.object(forKey: Self.preferredPortDefaultsKey) != nil else {
            return Self.defaultPreferredPort
        }
        let value = defaults.integer(forKey: Self.preferredPortDefaultsKey)
        return (0...65535).contains(value) ? value : Self.defaultPreferredPort
    }

    private var dshOverridePath: String? {
        let value = UserDefaults.standard
            .string(forKey: Self.dshOverrideDefaultsKey)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return (value?.isEmpty == false) ? value : nil
    }

    private func resolveDirectCommand(baseArguments: [String]) -> LaunchCommand? {
        let fileManager = FileManager.default
        if let override = dshOverridePath,
           fileManager.isExecutableFile(atPath: override) {
            return LaunchCommand(
                executable: URL(fileURLWithPath: override),
                arguments: baseArguments
            )
        }
        if let global = locateExecutable(named: "dsh") {
            return LaunchCommand(executable: global, arguments: baseArguments)
        }
        if let cached = locateCachedDSH() {
            return LaunchCommand(executable: cached, arguments: baseArguments)
        }
        return nil
    }

    private func locateExecutable(named name: String) -> URL? {
        let fileManager = FileManager.default
        let home = fileManager.homeDirectoryForCurrentUser.path
        let fixedDirectories = [
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/usr/bin",
            "/bin",
            "\(home)/.volta/bin",
            "\(home)/.local/bin",
            "\(home)/.npm-global/bin",
            "\(home)/Library/pnpm"
        ]

        for directory in fixedDirectories {
            let path = "\(directory)/\(name)"
            if fileManager.isExecutableFile(atPath: path) {
                return URL(fileURLWithPath: path)
            }
        }

        if let viaWhich = locateViaWhich(name) {
            return viaWhich
        }

        for directory in (ProcessInfo.processInfo.environment["PATH"] ?? "").split(separator: ":") {
            let path = "\(directory)/\(name)"
            if fileManager.isExecutableFile(atPath: path) {
                return URL(fileURLWithPath: path)
            }
        }

        return nil
    }

    private func locateViaWhich(_ name: String) -> URL? {
        let task = Process()
        let pipe = Pipe()
        task.executableURL = URL(fileURLWithPath: "/usr/bin/which")
        task.arguments = ["-a", name]
        task.standardOutput = pipe
        task.standardError = FileHandle.nullDevice

        do {
            try task.run()
            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            task.waitUntilExit()
            guard let output = String(data: data, encoding: .utf8) else { return nil }
            let fileManager = FileManager.default
            for line in output.split(whereSeparator: \.isNewline) {
                let path = String(line)
                if fileManager.isExecutableFile(atPath: path) {
                    return URL(fileURLWithPath: path)
                }
            }
            return nil
        } catch {
            return nil
        }
    }

    private func locateCachedDSH() -> URL? {
        let fileManager = FileManager.default
        let cacheRoot = fileManager.homeDirectoryForCurrentUser
            .appendingPathComponent(".npm/_npx", isDirectory: true)
        guard let cacheDirectories = try? fileManager.contentsOfDirectory(
            at: cacheRoot,
            includingPropertiesForKeys: [.contentModificationDateKey],
            options: [.skipsHiddenFiles]
        ) else { return nil }

        let newestFirst = cacheDirectories.sorted {
            let left = (try? $0.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate
                ?? .distantPast
            let right = (try? $1.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate
                ?? .distantPast
            return left > right
        }

        for directory in newestFirst {
            let packageJSON = directory
                .appendingPathComponent("node_modules/@deepseek-ai/dsh/package.json")
            let executable = directory.appendingPathComponent("node_modules/.bin/dsh")
            guard fileManager.isExecutableFile(atPath: executable.path) else { continue }
            // In "latest" mode, accept the newest cached dsh regardless of
            // version; otherwise require an exact version match.
            if !usesLatestVersion {
                guard let data = try? Data(contentsOf: packageJSON),
                      let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                      object["version"] as? String == pinnedDSHVersion
                else { continue }
            }
            return executable
        }

        return nil
    }

    private func defaultWorkingDirectory() -> URL {
        FileManager.default.homeDirectoryForCurrentUser
    }

}
