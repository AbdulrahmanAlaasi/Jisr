<p align="center">
  <a href="https://jisr.alaasi.dev">
    <img src="build/icon.png" alt="Jisr bridge logo" width="112">
  </a>
</p>

<h1 align="center">Jisr · جسر</h1>

<p align="center">
  <strong>Private, direct sharing between your computers.</strong><br>
  Send files, folders, videos, links, text, and clipboard content without an account or cloud upload.
</p>

<p align="center">
  <a href="https://jisr.alaasi.dev">Website</a> ·
  <a href="https://github.com/AbdulrahmanAlaasi/OrbitSend-Updates/releases/latest">Download</a> ·
  <a href="SECURITY.md">Security</a> ·
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

<p align="center">
  <a href="https://github.com/AbdulrahmanAlaasi/Jisr/actions/workflows/ci.yml"><img alt="CI status" src="https://github.com/AbdulrahmanAlaasi/Jisr/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/AbdulrahmanAlaasi/OrbitSend-Updates/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/AbdulrahmanAlaasi/OrbitSend-Updates?label=release&color=6c5ce7"></a>
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-6c5ce7"></a>
  <img alt="Windows and macOS" src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS-171426">
</p>

## What is Jisr?

Jisr is an open-source Electron desktop app that creates a private bridge
between computers on the same local network. Devices discover each other,
pair with a short-lived code, and exchange content directly through an
authenticated encrypted channel.

Jisr works with **any pair of supported computers**:

| From | To | Supported |
| --- | --- | :---: |
| Windows | Windows | ✅ |
| macOS | macOS | ✅ |
| Windows | macOS | ✅ |
| macOS | Windows | ✅ |

Jisr currently supports desktop Windows and macOS. iPhone, iPad, Android, and
Linux are not supported yet.

The project is in active early development. The current release is **Jisr
0.4.3**.

## Features

- Automatic device discovery on the same Wi-Fi or wired local network
- Manual IP connection for networks that block multicast discovery
- One-time pairing with a six-digit code or QR code
- X25519 key agreement and AES-256-GCM authenticated encryption
- Files, multiple files, complete folders, videos, links, text, and clipboard content
- Chunked large-file transfers with progress and SHA-256 verification
- Accept or decline controls, trusted-device auto-accept, and receiving pause
- Safe, non-overwriting destination names and path-traversal protection
- Transfer history that never stores file contents
- Background tray mode, native notifications, and launch-at-login support
- Verified in-app update downloads with platform-specific installation

## Install

| Computer | Download |
| --- | --- |
| Windows x64 or ARM64 | [Jisr Setup 0.4.4.exe](https://github.com/AbdulrahmanAlaasi/OrbitSend-Updates/releases/download/v0.4.4/Jisr.Setup.0.4.4.exe) |
| Apple Silicon Mac (M1, M2, M3, M4, or newer) | [Jisr 0.4.4 arm64.dmg](https://github.com/AbdulrahmanAlaasi/OrbitSend-Updates/releases/download/v0.4.4/Jisr-0.4.4-arm64.dmg) |
| Intel Mac | [Jisr 0.4.4.dmg](https://github.com/AbdulrahmanAlaasi/OrbitSend-Updates/releases/download/v0.4.4/Jisr-0.4.4.dmg) |

The macOS ZIP files on the complete
[releases page](https://github.com/AbdulrahmanAlaasi/OrbitSend-Updates/releases/latest)
are not required for a normal installation.

> **Early-access note:** Current builds are unsigned. Windows SmartScreen or
> macOS Gatekeeper may show a warning until code signing and Apple notarization
> are configured. See [Known limitations](#known-limitations).

## Quick start

1. Install and open Jisr on any two supported computers.
2. Keep both computers on the same Wi-Fi or wired local network.
3. On one computer, choose **Pair a device**.
4. Select it on the other computer and confirm the six-digit code.
5. Choose the paired device and drop files into the Send panel.

Pairing is required only once unless the application identity changes or a
device is forgotten.

## How it works

Jisr broadcasts a small discovery beacon on the local subnet. After pairing,
transfer commands and content are encrypted and authenticated. Files are sent
in chunks, verified with SHA-256, and written using non-overwriting names.

The default transfer port is TCP `53318`. Discovery uses UDP multicast and
broadcast on port `43891`. If a firewall asks for permission, allow Jisr on
private networks only.

Long-term private key material is protected by DPAPI on Windows and Keychain
on macOS when available. Jisr has not yet received an independent security
audit; please report vulnerabilities privately as described in
[`SECURITY.md`](SECURITY.md).

## Development

Requirements:

- Node.js 22 or newer
- Windows or macOS for running and packaging the desktop app

```sh
npm install
npm start
```

Run the full automated test suite and syntax checks:

```sh
npm test
npm run check
```

Build on the current operating system:

```sh
npm run dist:win
npm run dist:mac
```

macOS packages must be built on macOS. GitHub Actions builds and tests Jisr on
Windows and macOS whenever a release tag is pushed.

## Releases and updates

The complete maintainer workflow is documented in
[`docs/RELEASING.md`](docs/RELEASING.md).

Jisr currently uses the public
[`OrbitSend-Updates`](https://github.com/AbdulrahmanAlaasi/OrbitSend-Updates)
repository for installers and update metadata. The legacy repository name is
temporarily retained so older OrbitSend installations can discover the Jisr
transition release.

Normal Jisr updates preserve settings, history, and paired devices. On Windows,
**Restart and install** starts the verified installer. On macOS, **Open
installer** opens the downloaded DMG for user-approved replacement.

## Known limitations

- Devices must currently be reachable on the same local network.
- Automatic discovery can be blocked by restrictive firewall or Wi-Fi settings;
  manual IP connection is available as a fallback.
- Builds are not yet code-signed or Apple-notarized.
- Fully unattended macOS updates are intentionally disabled until signing and
  notarization are configured.
- Mobile devices and Linux are not supported yet.

## Contributing

Contributions are welcome. Read [`CONTRIBUTING.md`](CONTRIBUTING.md) before
opening an issue or pull request. By participating, you agree to follow the
[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).

## Privacy

Jisr has no accounts, advertising, analytics, or cloud file storage. See
[`PRIVACY.md`](PRIVACY.md) for the complete data-handling summary.

## Created by

[Abdulrahman Alaasi](https://abdulrahman.alaasi.dev)

## License

Jisr is available under the [MIT License](LICENSE).
