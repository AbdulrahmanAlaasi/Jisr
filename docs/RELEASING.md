# Releasing Jisr

Jisr uses a private GitHub repository and GitHub Actions to build Windows
and macOS packages on their correct operating systems.

## Normal update workflow

1. Make and test changes locally.
2. Update the version in `package.json` and `package-lock.json`.
3. Commit and push the changes to `main`.
4. Create and push a matching version tag, such as `v0.2.1`.
5. Open the repository's **Actions** page and wait for both platform builds.
6. Open **Releases**, select the new version, and download the macOS DMG.
7. On the Mac, open the DMG and replace the existing Jisr application.
8. Publish the same installers to the legacy public `OrbitSend-Updates`
   repository so
   installed applications can detect the new version.

Jisr uses a new application identity and storage location. The first Jisr 0.4.0
installation is intentionally separate from OrbitSend 0.3.x, so devices must be
paired once under the new name. Later Jisr updates preserve Jisr settings and
paired-device data outside the application bundle.

## Commands

```sh
npm test
git add package.json package-lock.json src tests
git commit -m "Release 0.4.1"
git push origin main
git tag v0.4.1
git push origin v0.4.1
```

After the private build succeeds, download its assets and create the matching
public release:

```sh
gh release download v0.4.1 --repo AbdulrahmanAlaasi/Jisr --dir update-assets
gh release create v0.4.1 update-assets/* --repo AbdulrahmanAlaasi/OrbitSend-Updates --generate-notes --title "Jisr 0.4.1"
```

The public repository contains only installers and release notes. Never upload
source archives, signing credentials, or device data to the update channel.

Do not rename or delete `OrbitSend-Updates` while OrbitSend 0.3.x clients are
still supported. Their updater verifies that exact repository path. Jisr 0.4.0
accepts the legacy path as well as future `Jisr` and `Jisr-Updates` release
paths, which makes a later migration possible.

Do not reuse or move an existing release tag. Every published build should have
a new version number and a new tag.

## Signing

The automated builds are currently unsigned development packages. For public
distribution, configure GitHub Actions secrets for a Windows code-signing
certificate and Apple Developer ID signing and notarization credentials. Never
commit certificates, passwords, API keys, or notarization credentials to the
repository.
