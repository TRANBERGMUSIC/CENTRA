// Files from mail on the iPhone: Quick Look shows PowerPoint, Keynote, Word, Pages, Excel, Numbers,
// PDF, pictures, video and more inside CENTRA; the share sheet saves to Filer or opens in another
// app (PowerPoint, AirDrop …). Called from Rust (native.rs) with the path of a temporary copy.
// Copied into the generated Xcode project by scripts/ios-testflight.sh.
import Foundation
import UIKit
import QuickLook

@objc(CentraFiles) public class CentraFiles: NSObject, QLPreviewControllerDataSource {
    private static let shared = CentraFiles()
    private var url: URL?

    @objc public static func preview(_ path: NSString) {
        let url = URL(fileURLWithPath: path as String)
        DispatchQueue.main.async {
            guard let top = top() else { return }
            shared.url = url
            let q = QLPreviewController()
            q.dataSource = shared
            q.modalPresentationStyle = .fullScreen
            top.present(q, animated: true)
        }
    }

    @objc public static func share(_ path: NSString) {
        let url = URL(fileURLWithPath: path as String)
        DispatchQueue.main.async {
            guard let top = top() else { return }
            let s = UIActivityViewController(activityItems: [url], applicationActivities: nil)
            if let pop = s.popoverPresentationController {
                pop.sourceView = top.view
                pop.sourceRect = CGRect(x: top.view.bounds.midX, y: top.view.bounds.maxY - 80, width: 1, height: 1)
            }
            top.present(s, animated: true)
        }
    }

    public func numberOfPreviewItems(in controller: QLPreviewController) -> Int { url == nil ? 0 : 1 }
    public func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem {
        (url ?? URL(fileURLWithPath: "/")) as NSURL
    }

    /// The view controller on top (where a sheet can be shown from).
    private static func top() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let window = scenes.flatMap { $0.windows }.first { $0.isKeyWindow } ?? scenes.first?.windows.first
        var vc = window?.rootViewController
        while let next = vc?.presentedViewController, !next.isBeingDismissed { vc = next }
        return vc
    }
}
