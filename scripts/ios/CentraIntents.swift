// "Hey Siri, husk i CENTRA": Siri asks what to remember, puts it in a small inbox in the app's own
// settings (it never leaves the phone) and opens CENTRA, where Assist puts it on the huskeliste with
// the right time (src/reminderAlerts.ts reads the inbox through the siri_inbox command).
// Copied into the generated Xcode project by scripts/ios-testflight.sh.
import AppIntents
import Foundation

@available(iOS 16.0, *)
struct HuskIntent: AppIntent {
    static var title: LocalizedStringResource = "Husk i CENTRA"
    static var description = IntentDescription("Sætter noget på din huskeliste i CENTRA, fx \"levere udstyr tilbage til Sigge kl. 12\".")
    static var openAppWhenRun: Bool = true

    @Parameter(title: "Hvad skal du huske?", requestValueDialog: IntentDialog("Hvad skal jeg huske?"))
    var tekst: String

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let defaults = UserDefaults.standard
        var inbox = defaults.stringArray(forKey: "centra.siri.inbox") ?? []
        inbox.append(tekst)
        defaults.set(inbox, forKey: "centra.siri.inbox")
        return .result(dialog: "Okay, det kommer på huskelisten.")
    }
}

@available(iOS 16.0, *)
struct CentraShortcuts: AppShortcutsProvider {
    @AppShortcutsBuilder
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: HuskIntent(), phrases: [
            "Husk i \(.applicationName)",
            "Husk med \(.applicationName)",
            "Tilføj til huskelisten i \(.applicationName)",
            "Mind mig om noget i \(.applicationName)",
        ])
    }
}
