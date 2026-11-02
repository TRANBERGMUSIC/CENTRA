// Push from the sync server (Apple's push service): asks iOS for this phone's push token and keeps it
// in the app's settings, where the app reads it (push_token) and hands it to the relay, which then
// sends reminders, event alerts and new-mail notices at their time, also when CENTRA is closed.
// Tauri's app delegate doesn't answer the token callbacks, so they are added to its class here.
// Copied into the generated Xcode project by scripts/ios-testflight.sh.
import UIKit
import ObjectiveC

@objc(CentraPush) public class CentraPush: NSObject {
    private static var installed = false

    /// Asks iOS for the token (again on every launch: it can change).
    @objc public static func register() {
        DispatchQueue.main.async {
            install()
            UIApplication.shared.registerForRemoteNotifications()
        }
    }

    /// The token as hex ("" until iOS has answered).
    @objc public static func token() -> NSString {
        (UserDefaults.standard.string(forKey: "centra.push.token") ?? "") as NSString
    }

    /// Why there is no token, if iOS said why.
    @objc public static func problem() -> NSString {
        (UserDefaults.standard.string(forKey: "centra.push.error") ?? "") as NSString
    }

    private static func install() {
        guard !installed, let delegate = UIApplication.shared.delegate else { return }
        installed = true
        let cls: AnyClass = type(of: delegate)
        let ok: @convention(block) (AnyObject, UIApplication, NSData) -> Void = { _, _, data in
            let hex = (data as Data).map { String(format: "%02x", $0) }.joined()
            UserDefaults.standard.set(hex, forKey: "centra.push.token")
            UserDefaults.standard.removeObject(forKey: "centra.push.error")
        }
        let fail: @convention(block) (AnyObject, UIApplication, NSError) -> Void = { _, _, err in
            UserDefaults.standard.set(err.localizedDescription, forKey: "centra.push.error")
        }
        add(cls, #selector(UIApplicationDelegate.application(_:didRegisterForRemoteNotificationsWithDeviceToken:)), imp_implementationWithBlock(unsafeBitCast(ok, to: AnyObject.self)))
        add(cls, #selector(UIApplicationDelegate.application(_:didFailToRegisterForRemoteNotificationsWithError:)), imp_implementationWithBlock(unsafeBitCast(fail, to: AnyObject.self)))
    }

    private static func add(_ cls: AnyClass, _ sel: Selector, _ imp: IMP) {
        if !class_addMethod(cls, sel, imp, "v@:@@"), let m = class_getInstanceMethod(cls, sel) {
            method_setImplementation(m, imp)
        }
    }
}
