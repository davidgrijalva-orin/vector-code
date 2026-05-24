import SwiftUI

#if os(iOS) && canImport(AVFoundation)
@preconcurrency import AVFoundation
import UIKit

public struct VectorCodeQrScannerView: View {
    public let onScan: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var cameraState = VectorCodeCameraState.checking
    @State private var errorText: String?
    @State private var didScan = false

    public init(onScan: @escaping (String) -> Void) {
        self.onScan = onScan
    }

    public var body: some View {
        ZStack {
            switch cameraState {
            case .checking:
                VectorCodeScannerMessage(
                    icon: .deviceMobile,
                    title: "Preparing camera",
                    message: "VectorCode is checking camera access."
                )
            case .available:
                VectorCodeQrCameraView(
                    onScan: handleScan,
                    onFailure: { message in
                        errorText = message
                        cameraState = .unavailable
                    }
                )
                .ignoresSafeArea()
                VectorCodeScannerChrome(errorText: errorText) {
                    dismiss()
                }
            case .denied:
                VectorCodeScannerMessage(
                    icon: .close,
                    title: "Camera access is off",
                    message: "Allow camera access in Settings to scan the desktop pairing QR code.",
                    primaryTitle: "Open Settings",
                    primaryAction: openSettings
                )
            case .restricted:
                VectorCodeScannerMessage(
                    icon: .close,
                    title: "Camera unavailable",
                    message: "Camera access is restricted on this device. Paste the desktop pairing payload instead."
                )
            case .unavailable:
                VectorCodeScannerMessage(
                    icon: .deviceMobile,
                    title: "Scanner unavailable",
                    message: errorText ?? "The camera could not start. Paste the desktop pairing payload instead."
                )
            }
        }
        .background(VectorCodeTheme.background.ignoresSafeArea())
        .foregroundStyle(VectorCodeTheme.text)
        .task {
            await resolveCameraAccess()
        }
    }

    private func handleScan(_ value: String) {
        guard !didScan else {
            return
        }
        didScan = true
        onScan(value)
        dismiss()
    }

    private func resolveCameraAccess() async {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            cameraState = .available
        case .notDetermined:
            let granted = await AVCaptureDevice.requestVideoAccess()
            cameraState = granted ? .available : .denied
        case .denied:
            cameraState = .denied
        case .restricted:
            cameraState = .restricted
        @unknown default:
            cameraState = .unavailable
        }
    }

    private func openSettings() {
        guard let url = URL(string: UIApplication.openSettingsURLString) else {
            return
        }
        UIApplication.shared.open(url)
    }
}

private enum VectorCodeCameraState {
    case checking
    case available
    case denied
    case restricted
    case unavailable
}

private extension AVCaptureDevice {
    static func requestVideoAccess() async -> Bool {
        await withCheckedContinuation { continuation in
            requestAccess(for: .video) { granted in
                continuation.resume(returning: granted)
            }
        }
    }
}

private struct VectorCodeQrCameraView: UIViewControllerRepresentable {
    let onScan: (String) -> Void
    let onFailure: (String) -> Void

    public func makeCoordinator() -> Coordinator {
        Coordinator(onScan: onScan)
    }

    public func makeUIViewController(context: Context) -> ScannerController {
        let controller = ScannerController()
        controller.onFailure = onFailure
        controller.metadataOutput.setMetadataObjectsDelegate(context.coordinator, queue: .main)
        return controller
    }

    public func updateUIViewController(_ uiViewController: ScannerController, context: Context) {}

    final class Coordinator: NSObject, AVCaptureMetadataOutputObjectsDelegate {
        private let onScan: (String) -> Void

        init(onScan: @escaping (String) -> Void) {
            self.onScan = onScan
        }

        public func metadataOutput(
            _ output: AVCaptureMetadataOutput,
            didOutput metadataObjects: [AVMetadataObject],
            from connection: AVCaptureConnection
        ) {
            guard let object = metadataObjects.first as? AVMetadataMachineReadableCodeObject,
                  object.type == .qr,
                  let value = object.stringValue else {
                return
            }
            onScan(value)
        }
    }
}

private struct VectorCodeScannerChrome: View {
    let errorText: String?
    let close: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                VectorCodeBrandWordmark()
                Spacer()
                VectorCodeIconButton(icon: .close, foreground: VectorCodeTheme.text, background: Color.black.opacity(0.38)) {
                    close()
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 14)
            .padding(.bottom, 8)
            Spacer()
            VectorCodeScanFrame()
                .frame(width: 256, height: 256)
            Spacer()
            VStack(spacing: 8) {
                Text("Scan desktop QR")
                    .font(.headline.weight(.semibold))
                Text(errorText ?? "Point your camera at the QR code shown in VectorCode on desktop.")
                    .font(.footnote)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(VectorCodeTheme.muted)
                    .frame(maxWidth: 280)
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 32)
        }
        .background {
            LinearGradient(
                colors: [Color.black.opacity(0.52), Color.clear, Color.black.opacity(0.68)],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()
        }
    }
}

private struct VectorCodeScanFrame: View {
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 22)
                .stroke(VectorCodeTheme.accent.opacity(0.72), lineWidth: 1.5)
            RoundedRectangle(cornerRadius: 16)
                .stroke(VectorCodeTheme.text.opacity(0.20), lineWidth: 1)
                .padding(18)
            VectorCodeMark()
                .fill(VectorCodeTheme.accent.opacity(0.16), style: FillStyle(eoFill: true))
                .frame(width: 54, height: 54)
        }
        .background(Color.black.opacity(0.16))
        .clipShape(RoundedRectangle(cornerRadius: 22))
    }
}

private struct VectorCodeScannerMessage: View {
    let icon: VectorCodeIcon
    let title: String
    let message: String
    var primaryTitle: String?
    var primaryAction: (() -> Void)?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                VectorCodeBrandWordmark()
                Spacer()
                VectorCodeIconButton(icon: .close, size: 32) {
                    dismiss()
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            Spacer()
            VStack(spacing: 14) {
                VectorCodeIconView(icon: icon, size: 28)
                    .foregroundStyle(VectorCodeTheme.accent)
                    .frame(width: 56, height: 56)
                    .background(VectorCodeTheme.accentSoft)
                    .clipShape(RoundedRectangle(cornerRadius: VectorCodeTheme.cornerRadius))
                Text(title)
                    .font(.title3.weight(.semibold))
                Text(message)
                    .font(.callout)
                    .foregroundStyle(VectorCodeTheme.muted)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 300)
                if let primaryTitle, let primaryAction {
                    Button(action: primaryAction) {
                        Text(primaryTitle)
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(VectorCodePrimaryButtonStyle())
                    .frame(maxWidth: 260)
                    .padding(.top, 4)
                }
            }
            .padding(22)
            Spacer()
        }
    }
}

public final class ScannerController: UIViewController {
    let session = AVCaptureSession()
    let metadataOutput = AVCaptureMetadataOutput()
    var onFailure: ((String) -> Void)?
    private let sessionQueue = DispatchQueue(label: "com.orintech.vectorcode.qr-session")
    private let previewLayer = AVCaptureVideoPreviewLayer()

    public override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black

        guard let device = AVCaptureDevice.default(for: .video),
              let input = try? AVCaptureDeviceInput(device: device),
              session.canAddInput(input),
              session.canAddOutput(metadataOutput) else {
            onFailure?("VectorCode could not access a usable camera.")
            return
        }

        session.addInput(input)
        session.addOutput(metadataOutput)
        metadataOutput.metadataObjectTypes = [.qr]

        previewLayer.session = session
        previewLayer.videoGravity = .resizeAspectFill
        view.layer.addSublayer(previewLayer)

        sessionQueue.async { [session] in
            session.startRunning()
        }
    }

    public override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        previewLayer.frame = view.bounds
    }

    public override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        sessionQueue.async { [session] in
            session.stopRunning()
        }
    }
}
#else
public struct VectorCodeQrScannerView: View {
    public let onScan: (String) -> Void

    public init(onScan: @escaping (String) -> Void) {
        self.onScan = onScan
    }

    public var body: some View {
        VStack(spacing: 12) {
            VectorCodeMark()
                .fill(VectorCodeTheme.accent, style: FillStyle(eoFill: true))
                .frame(width: 42, height: 42)
            Text("QR scanning runs on iPhone.")
                .font(.headline)
            Text("Paste the desktop QR payload while running on macOS.")
                .font(.footnote)
                .foregroundStyle(VectorCodeTheme.muted)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(VectorCodeTheme.background)
        .foregroundStyle(VectorCodeTheme.text)
    }
}
#endif
