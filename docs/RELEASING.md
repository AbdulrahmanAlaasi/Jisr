# Releasing OrbitSend

OrbitSend uses a private GitHub repository and GitHub Actions to build Windows
and macOS packages on their correct operating systems.

## Normal update workflow

1. Make and test changes locally.
2. Update the version in `package.json` and `package-lock.json`.
3. Commit and push the changes to `main`.
4. Create and push a matching version tag, such as `v0.2.1`.
5. Open the repository's **Actions** page and wait for both platform builds.
6. Open **Releases**, select the new version, and download the macOS DMG.
7. On the Mac, open the DMG and replace the existing OrbitSend application.
8. Publish the same installers to the public `OrbitSend-Updates` repository so
   installed applications can detect the new version.

Settings and paired-device data live outside the application bundle and should
remain in place when the application is replaced.

## Commands

```sh
npm test
git add package.json package-lock.json src tests
git commit -m "Release 0.2.1"
git push origin main
git tag v0.2.1
git push origin v0.2.1
```

After the private build succeeds, download its assets and create the matching
public release:

```sh
gh release download v0.2.1 --repo AbdulrahmanAlaasi/OrbitSend --dir update-assets
gh release create v0.2.1 update-assets/* --repo AbdulrahmanAlaasi/OrbitSend-Updates --generate-notes --title "OrbitSend 0.2.1"
```

The public repository contains only installers and release notes. Never upload
source archives, signing credentials, or device data to the update channel.

Do not reuse or move an existing release tag. Every published build should have
a new version number and a new tag.

## Signing

The automated builds are currently unsigned development packages. For public
distribution, configure GitHub Actions secrets for a Windows code-signing
certificate and Apple Developer ID signing and notarization credentials. Never
commit certificates, passwords, API keys, or notarization credentials to the
repository.
