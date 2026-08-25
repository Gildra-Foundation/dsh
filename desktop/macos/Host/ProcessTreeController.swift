import Darwin
import Foundation

enum ProcessTreeController {
    static func stop(rootPID: pid_t, completion: (() -> Void)?) {
        let pids = descendantPIDs(of: rootPID) + [rootPID]
        let signals: [Int32] = [SIGINT, SIGTERM, SIGKILL]
        var signalIndex = 0

        func escalateOrFinish() {
            guard signalIndex < signals.count else {
                completion?()
                return
            }

            let signal = signals[signalIndex]
            signalIndex += 1
            for pid in pids.reversed() where kill(pid, 0) == 0 {
                kill(pid, signal)
            }

            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                if pids.contains(where: { kill($0, 0) == 0 }) {
                    escalateOrFinish()
                } else {
                    completion?()
                }
            }
        }

        escalateOrFinish()
    }

    private static func descendantPIDs(of rootPID: pid_t) -> [pid_t] {
        let task = Process()
        let pipe = Pipe()
        task.executableURL = URL(fileURLWithPath: "/bin/ps")
        task.arguments = ["-axo", "pid=,ppid="]
        task.standardOutput = pipe
        task.standardError = FileHandle.nullDevice

        do {
            try task.run()
            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            task.waitUntilExit()
            guard let output = String(data: data, encoding: .utf8) else { return [] }

            let pairs: [(pid_t, pid_t)] = output.split(whereSeparator: \.isNewline).compactMap { line in
                let fields = line.split(whereSeparator: \.isWhitespace)
                guard fields.count == 2,
                      let pid = pid_t(fields[0]),
                      let parentPID = pid_t(fields[1])
                else { return nil }
                return (pid, parentPID)
            }

            var descendants: [pid_t] = []
            var parents: Set<pid_t> = [rootPID]
            while true {
                let children = pairs
                    .filter { parents.contains($0.1) && !descendants.contains($0.0) }
                    .map(\.0)
                guard !children.isEmpty else { break }
                descendants.append(contentsOf: children)
                parents = Set(children)
            }
            return descendants
        } catch {
            return []
        }
    }
}
