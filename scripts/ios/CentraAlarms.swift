// The alarm clock: CENTRA's vækkeure as real iPhone alarms (AlarmKit, iOS 26), so they ring on time
// also on silent, in a Focus and with CENTRA closed. The app hands over the whole list
// (alarms_sync); alarms that are no longer on the list are taken off.
// Copied into the generated Xcode project by scripts/ios-testflight.sh.
import Foundation
import SwiftUI
#if canImport(AlarmKit)
import AlarmKit
#endif

@objc(CentraAlarms) public class CentraAlarms: NSObject {
    struct Spec: Codable { let id: String; let hour: Int; let minute: Int; let days: [Int]; let label: String; let on: Bool }

    /// json: [{"id":"<uuid>","hour":7,"minute":0,"days":[1,2,3,4,5],"label":"Vækkeur","on":true}]
    /// (days: 0 = søndag … 6 = lørdag; none = once). Returns "ok" or "unavailable" (before iOS 26).
    @objc public static func sync(_ json: NSString) -> NSString {
        #if canImport(AlarmKit)
        if #available(iOS 26.0, *) {
            let list = (try? JSONDecoder().decode([Spec].self, from: Data((json as String).utf8))) ?? []
            Task { await apply(list) }
            return "ok"
        }
        #endif
        return "unavailable"
    }

    /// How the last sync went: "ok", "denied" (no permission) or "error: …".
    @objc public static func status() -> NSString {
        (UserDefaults.standard.string(forKey: "centra.alarms.status") ?? "") as NSString
    }

    private static func save(_ s: String) { UserDefaults.standard.set(s, forKey: "centra.alarms.status") }

    #if canImport(AlarmKit)
    struct Meta: AlarmMetadata {}

    @available(iOS 26.0, *)
    private static func weekday(_ d: Int) -> Locale.Weekday? {
        [.sunday, .monday, .tuesday, .wednesday, .thursday, .friday, .saturday][safe: d]
    }

    @available(iOS 26.0, *)
    private static func apply(_ list: [Spec]) async {
        let m = AlarmManager.shared
        do {
            if m.authorizationState != .authorized {
                guard try await m.requestAuthorization() == .authorized else { save("denied"); return }
            }
            let wanted = Set(list.filter { $0.on }.compactMap { UUID(uuidString: $0.id) })
            for a in try m.alarms where !wanted.contains(a.id) { try? m.cancel(id: a.id) }
            for s in list where s.on {
                guard let id = UUID(uuidString: s.id) else { continue }
                try? m.cancel(id: id)
                let stop = AlarmButton(text: "Stop", textColor: .white, systemImageName: "stop.circle")
                let alert = AlarmPresentation.Alert(title: "\(s.label)", stopButton: stop)
                let attributes = AlarmAttributes<Meta>(presentation: AlarmPresentation(alert: alert), tintColor: .orange)
                let days = s.days.compactMap(weekday)
                let time = Alarm.Schedule.Relative.Time(hour: s.hour, minute: s.minute)
                let schedule = Alarm.Schedule.relative(.init(time: time, repeats: days.isEmpty ? .never : .weekly(days)))
                _ = try await m.schedule(id: id, configuration: .alarm(schedule: schedule, attributes: attributes))
            }
            save("ok")
        } catch {
            save("error: \(error.localizedDescription)")
        }
    }
    #endif
}

private extension Array {
    subscript(safe i: Int) -> Element? { indices.contains(i) ? self[i] : nil }
}
