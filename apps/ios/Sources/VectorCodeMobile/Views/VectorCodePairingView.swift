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
            VectorCodeSheetHeader(title: "Phone Pairing", showsDivider: true)

            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    VectorCodeSectionSurface {
                        VStack(alignment: .leading, spacing: 12) {
                            HStack(spacing: 10) {
                                VectorCodeIconTile(
                                    icon: .deviceMobile,
                                    iconSize: 18,
                                    tileSize: 36,
                                    cornerRadius: VectorCodeTheme.compactRadius
                                )
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
                            if payloadText.isEmpty {
                                Text("Paste QR payload")
                                    .font(.system(.body, design: .monospaced))
                                    .foregroundStyle(VectorCodeTheme.subtle)
                                    .padding(.horizontal, 15)
                                    .padding(.vertical, 18)
                                    .allowsHitTesting(false)
                            }
                        }
                        .vectorCodeOutlinedSurface(background: VectorCodeTheme.terminalBackground)
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
