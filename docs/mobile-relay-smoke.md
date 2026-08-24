# VectorCode Mobile Relay Smoke

Use this to verify the deployed relay path without opening the desktop or iOS app. The script mints short-lived desktop and phone relay tokens, opens both WebSocket roles, sends an encrypted `state.read` request from phone to desktop, then sends an encrypted workspace response back to phone.

Dry-run URL/config validation:

```sh
npm run smoke-vector-relay:dry-run
```

Local crypto/self-test validation:

```sh
npm run smoke-vector-relay:self-test
```

Live Railway/Cloudflare relay validation:

```sh
VECTOR_CODE_RELAY_ISSUER_TOKEN=<issuer-token> npm run smoke-vector-relay
```

For the Railway `relay` service, the issuer secret is stored as `ORIN_RELAY_ISSUER_TOKEN`. Map it into `VECTOR_CODE_RELAY_ISSUER_TOKEN` when running the smoke; do not echo the value into logs. The deployed `/relay/token` contract returns `{ token, expiresAt }`, and the smoke normalizes that into the app-facing `relayToken` / `relayTokenExpiresAt` fields.

Optional overrides:

```sh
VECTOR_CODE_RELAY_HOST=relay.vectorcode.app \
VECTOR_CODE_RELAY_USER_ID=default \
VECTOR_CODE_RELAY_SMOKE_TTL_SECONDS=300 \
VECTOR_CODE_RELAY_SMOKE_TIMEOUT_MS=10000 \
VECTOR_CODE_RELAY_ISSUER_TOKEN=<issuer-token> \
npm run smoke-vector-relay
```

Expected success output includes `ok: true`, the relay host, generated desktop/phone IDs, pairing ID, and token expiration timestamps.

To validate an actual QR session created by the desktop, pass the decoded QR JSON through standard input while the desktop pairing view is open:

```sh
node scripts/smoke-vector-code-relay.mjs --paired-desktop < pairing-payload.json
```

This mode connects as the QR's phone peer, sends an encrypted `state.read` request to the real desktop, validates its workspace response, and verifies that replaying the same encrypted frame is rejected. The QR payload contains short-lived credentials and pairing key material; keep it out of source control and delete it after the test.

In the desktop **Phone Connection** view, use **Configure Secure Relay** once to save the relay issuer token in encrypted desktop storage. A pairing QR is not shown until the relay has issued a valid phone credential.

The saved issuer credential is scoped to that relay origin and is never included in the QR or application logs. A QR can activate a phone only during its five-minute scan window; refreshing it retires the previous unclaimed session after the replacement bridge is ready. Once paired, desktop relay interruptions retry indefinitely with capped backoff, while iOS performs three automatic recovery attempts before leaving a visible manual **Reconnect** action.

Protocol version 2 authenticates the complete routing header as AES-GCM additional data. Any app update from protocol version 1 requires one fresh QR scan; changing the session, timestamp, direction, sequence, or action invalidates the encrypted frame.

This is not a substitute for a real device smoke. It proves the deployed relay token endpoint, WebSocket role routing, peer-online event, and encrypted frame round trip. After this passes, scan the desktop QR with iPhone and run the app-level visual QA in [visual-qa.md](./visual-qa.md).
