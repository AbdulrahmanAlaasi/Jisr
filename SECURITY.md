# Security policy

Jisr is designed for trusted devices on a private local network. Pairing
requires a short-lived code displayed out of band, and all post-pairing content
is encrypted and authenticated.

Please do not include private files, pairing codes, IP addresses, or identity
files in a public security report. The identity store lives in Electron's
per-user application data directory and should never be copied between devices.

Security-sensitive implementation areas are covered by automated tests for key
agreement symmetry, pairing-code separation, authenticated-encryption tamper
detection, path sanitization, full pairing, link exchange, chunked transfer,
hash verification, and byte-for-byte destination integrity.
