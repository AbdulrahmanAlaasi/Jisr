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

Do not reuse or move an existing release tag. Every published build should have
a new version number and a new tag.

## Signing

The automated builds are currently unsigned development packages. For public
distribution, configure GitHub Actions secrets for a Windows code-signing
certificate and Apple Developer ID signing and notarization credentials. Never
commit certificates, passwords, API keys, or notarization credentials to the
repository.
