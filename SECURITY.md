# Security policy

Security and privacy are core requirements for Jisr. The project welcomes
responsible reports that help keep local transfers and paired-device data safe.

## Supported versions

Security fixes are provided for the latest published Jisr release. Please
confirm that a report still applies to the newest version before submitting it.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability.

Use GitHub's private vulnerability reporting on the Jisr repository when it is
available. If that option is unavailable, use the contact information at
[abdulrahman.alaasi.dev](https://abdulrahman.alaasi.dev) and clearly mark the
message as a private Jisr security report.

Include:

- The affected Jisr version and operating system
- A clear description of the issue and its impact
- Reproduction steps or a minimal proof of concept
- Any suggested mitigation, if known

Do not include private files, active pairing codes, private keys, IP addresses,
or identity-store contents. Use synthetic test data whenever possible.

The maintainer will acknowledge a usable report, investigate it privately, and
coordinate disclosure after a fix or mitigation is available.

## Security design summary

- Pairing uses a short-lived code mixed into the X25519 key exchange.
- Post-pairing commands and content use AES-256-GCM authenticated encryption.
- File transfers are verified with SHA-256 before completion.
- Destination paths are sanitized and never silently overwrite existing files.
- Long-term key material uses DPAPI on Windows and Keychain on macOS when
  available.

Jisr is intended for trusted devices on a private local network. It has not yet
received an independent security audit, so public claims should not imply a
formal certification or audit.
