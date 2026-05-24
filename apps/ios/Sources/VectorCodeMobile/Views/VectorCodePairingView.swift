import SwiftUI

public struct VectorCodePairingView: View {
    @ObservedObject var model: VectorCodeMobileWorkspaceModel
    @Environment(\.dismiss) private var dismiss
    @State private var payloadText = ""
    @State private var errorText: String?
    @State private var showingScanner = false

    public init(model: VectorCodeMobileWorkspaceModel) {
        self.model = model
    }

    public var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                VectorCodeBrandWordmark()
                Text("Phone Pairing")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(VectorCodeTheme.muted)
                Spacer()
                VectorCodeIconButton(icon: .close, size: 32) {
                    dismiss()
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .overlay(alignment: .bottom) {
                Rectangle()
                    .fill(VectorCodeTheme.line)
                    .frame(height: 1)
            }

            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    VectorCodeSectionSurface {
                        VStack(alignment: .leading, spacing: 12) {
                            HStack(spacing: 10) {
                                VectorCodeIconView(icon: .deviceMobile, size: 18)
                                    .foregroundStyle(VectorCodeTheme.accent)
                                    .frame(width: 36, height: 36)
                                    .background(VectorCodeTheme.accentSoft)
                                    .clipShape(RoundedRectangle(cornerRadius: VectorCodeTheme.compactRadius))
                                VStack(alignment: .leading, spacing: 3) {
                                    Text("Desktop connection")
                                        .font(.headline.weight(.semibold))
                                    Text(model.statusText)
                                        .font(.footnote)
                                        .foregroundStyle(model.isRemoteConnected ? VectorCodeTheme.accent : VectorCodeTheme.muted)
                                }
                                Spacer()
                            }
                            Button {
                                showingScanner = true
                            } label: {
                                HStack(spacing: 8) {
                                    VectorCodeIconView(icon: .deviceMobile, size: 16)
                                    Text("Scan QR")
                                }
                                .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(VectorCodePrimaryButtonStyle())

                            if model.relayConfiguration != nil {
                                Button {
                                    model.connectToDesktop()
                                } label: {
                                    HStack(spacing: 8) {
                                        VectorCodeIconView(icon: .refresh, size: 16)
                                        Text(model.isRemoteConnected ? "Refresh Workspace" : "Reconnect")
                                    }
                                    .frame(maxWidth: .infinity)
                                }
                                .buttonStyle(VectorCodeSecondaryButtonStyle())
                            }
                        }
                        .padding(14)
                    }

                    VStack(alignment: .leading, spacing: 8) {
                        Text("Pairing payload")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(VectorCodeTheme.muted)
                        ZStack(alignment: .topLeading) {
                            TextEditor(text: $payloadText)
                                .font(.system(.body, design: .monospaced))
                                .frame(minHeight: 154)
                                .scrollContentBackground(.hidden)
                                .padding(10)
                                .background(VectorCodeTheme.terminalBackground)
                            if payloadText.isEmpty {
                                Text("Paste QR payload")
                                    .font(.system(.body, design: .monospaced))
                                    .foregroundStyle(VectorCodeTheme.subtle)
                                    .padding(.horizontal, 15)
                                    .padding(.vertical, 18)
                                    .allowsHitTesting(false)
                            }
                        }
                        .overlay {
                            RoundedRectangle(cornerRadius: VectorCodeTheme.cornerRadius)
                                .stroke(VectorCodeTheme.line, lineWidth: 1)
                        }
                        .clipShape(RoundedRectangle(cornerRadius: VectorCodeTheme.cornerRadius))
                    }

                    if let errorText {
                        Text(errorText)
                            .font(.footnote)
                            .foregroundStyle(VectorCodeTheme.danger)
                    }

                    Button {
                        pair(payloadText)
                    } label: {
                        HStack(spacing: 8) {
                            VectorCodeIconView(icon: .link, size: 16)
                            Text("Use Payload")
                        }
                        .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(VectorCodeSecondaryButtonStyle())
                    .disabled(payloadText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    .opacity(payloadText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? 0.55 : 1)

                    if model.pairingPayload != nil {
                        Button {
                            model.clearPairing()
                            payloadText = ""
                            errorText = nil
                        } label: {
                            HStack(spacing: 8) {
                                VectorCodeIconView(icon: .close, size: 15)
                                Text("Forget Desktop")
                            }
                            .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(VectorCodeSecondaryButtonStyle())
                    }
                }
                .padding(16)
            }
        }
        .background(VectorCodeTheme.background.ignoresSafeArea())
        .foregroundStyle(VectorCodeTheme.text)
        .vectorCodeScannerPresentation(isPresented: $showingScanner) {
            VectorCodeQrScannerView { value in
                payloadText = value
                showingScanner = false
                pair(value)
            }
        }
    }

    private func pair(_ text: String) {
        do {
            try model.pair(from: text)
            model.connectToDesktop()
            errorText = nil
            dismiss()
        } catch {
            errorText = error.localizedDescription
        }
    }
}

private extension View {
    @ViewBuilder
    func vectorCodeScannerPresentation<Content: View>(
        isPresented: Binding<Bool>,
        @ViewBuilder content: @escaping () -> Content
    ) -> some View {
        #if os(iOS)
        self.fullScreenCover(isPresented: isPresented, content: content)
        #else
        self.sheet(isPresented: isPresented, content: content)
        #endif
    }
}

public struct VectorCodePrimaryButtonStyle: ButtonStyle {
    public init() {}

    public func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.callout.weight(.semibold))
            .padding(.vertical, 11)
            .padding(.horizontal, 14)
            .foregroundStyle(configuration.isPressed ? VectorCodeTheme.text : VectorCodeTheme.accent)
            .background(configuration.isPressed ? VectorCodeTheme.accentSoft : VectorCodeTheme.raised)
            .overlay {
                RoundedRectangle(cornerRadius: VectorCodeTheme.cornerRadius)
                    .stroke(VectorCodeTheme.accent.opacity(configuration.isPressed ? 0.62 : 0.36), lineWidth: 1)
            }
            .clipShape(RoundedRectangle(cornerRadius: VectorCodeTheme.cornerRadius))
    }
}

public struct VectorCodeSecondaryButtonStyle: ButtonStyle {
    public init() {}

    public func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.callout.weight(.semibold))
            .padding(.vertical, 11)
            .padding(.horizontal, 14)
            .foregroundStyle(VectorCodeTheme.text)
            .background(configuration.isPressed ? VectorCodeTheme.hover : Color.clear)
            .overlay {
                RoundedRectangle(cornerRadius: VectorCodeTheme.cornerRadius)
                    .stroke(VectorCodeTheme.line, lineWidth: 1)
            }
            .clipShape(RoundedRectangle(cornerRadius: VectorCodeTheme.cornerRadius))
    }
}
