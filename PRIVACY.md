# Privacy

Jisr is designed to share content directly between computers without an
account or cloud file storage.

## Data Jisr does not collect

Jisr does not include advertising, analytics, behavioral tracking, or a Jisr
account service. File contents are not uploaded to a Jisr-operated server.

## Data stored on your computer

Jisr stores its device identity, paired-device public information, settings,
and transfer history in Electron's per-user application data directory.
Transfer history can include file names, device names, status, size, and time,
but it does not store transferred file contents.

Long-term private key material is protected by DPAPI on Windows and Keychain on
macOS when those facilities are available.

## Data shared on the local network

While discovery is enabled, Jisr broadcasts a small local-network beacon with
the device name, platform, public key, protocol version, and listening port.
After pairing, commands and transferred content are encrypted and
authenticated between the paired computers.

Anyone who can see the local network may be able to observe that a Jisr device
is available, but they cannot complete pairing without the short-lived code.

## Update checks

Jisr checks GitHub Releases for updates. GitHub may receive standard connection
information such as your IP address and user agent under GitHub's own privacy
terms. Jisr does not attach account or transfer data to update requests.

## Your control

You can pause receiving, forget paired devices, clear transfer history, disable
launch at login, or remove Jisr and its local application data at any time.
