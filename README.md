# OrbitSend

OrbitSend is a private, cross-platform desktop app for sending files, folders,
videos, links, and text directly between your own computers. It is designed as
an AirDrop-like bridge between Windows and macOS without accounts, cloud
storage, or upload limits.

## What it includes

- Automatic discovery on the same local network
- One-time pairing with a six-digit code or QR code
- X25519 key agreement and AES-256-GCM authenticated encryption
- Chunked large-file transfers with progress and SHA-256 verification
- Files, multi-file selections, complete folders, videos, links, and text
- One-click clipboard sharing and optional copy-on-receive
- Accept/decline controls, trusted-device auto-accept, and receiving pause
- Transfer history that never stores file contents
- Safe, non-overwriting destination names and path-traversal protection
- Background tray mode, native notifications, and launch-at-login support
- Manual IP connection for networks that block multicast discovery
- In-app update-available indicator with platform-specific installer download

## Install on both computers

Download and install the Windows `.exe` on the PC and the macOS `.dmg` on the
Mac. Keep both devices on the same Wi-Fi or wired local network.

1. Open OrbitSend on both computers.
2. On one computer, choose **Pair a device**.
3. Select that computer on the other device and enter the displayed code.
4. Select the paired device and drop files into the Send panel.

Unsigned development builds can trigger Windows SmartScreen or a macOS
Gatekeeper warning. Production releases should be signed with a Windows code
signing certificate and an Apple Developer ID, then notarized by Apple.

## Development

Requires Node.js 22 or newer.

```sh
npm install
npm start
```

Run the security and transfer tests:

```sh
npm test
```

Build for the current platform:

```sh
npm run dist:win
npm run dist:mac
```

macOS packages must be built on macOS. The included GitHub Actions workflow
builds both platforms independently when run manually or when a `v*` tag is
pushed.

## Updates

OrbitSend checks the public installer-only
[`OrbitSend-Updates`](https://github.com/AbdulrahmanAlaasi/OrbitSend-Updates)
channel at launch and every six hours. When a newer semantic version is
published, an update card appears in the sidebar. It opens a release dialog and
downloads the correct DMG or Windows installer when selected.

The current development builds are not Apple-notarized, so the update is
downloaded for user-approved installation instead of silently replacing the
application. Fully unattended macOS installation should only be enabled after
consistent Apple Developer ID signing and notarization are configured.

## Network and security notes

OrbitSend broadcasts a small discovery beacon only on the local subnet. File
names, content, and transfer commands are sent through an authenticated
encrypted channel. The pairing code is mixed into the initial X25519 key
exchange, so it is not transmitted over the network. Long-term private key
material is protected by DPAPI on Windows and Keychain on macOS when available.

The default transfer port is TCP `53318`. Discovery uses UDP multicast and
broadcast on port `43891`. If a firewall asks for permission, allow OrbitSend on
private networks only.

## License

MIT
