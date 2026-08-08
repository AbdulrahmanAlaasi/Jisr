# Contributing to Jisr

Thank you for helping improve Jisr. Small, focused contributions with clear
tests are the easiest to review.

## Before you start

- Search existing issues before opening a new one.
- Use a public issue for bugs and feature ideas.
- Use the private process in [`SECURITY.md`](SECURITY.md) for vulnerabilities.
- Keep pull requests focused on one change whenever possible.

## Local development

Jisr requires Node.js 22 or newer.

```sh
npm install
npm start
```

Before submitting a change, run:

```sh
npm test
npm run check
```

Changes that affect packaging should also be tested on the target operating
system. Windows packages must be built on Windows and macOS packages must be
built on macOS.

## Pull requests

1. Fork the repository and create a short, descriptive branch.
2. Make the smallest complete change that solves the problem.
3. Add or update tests for behavioral changes.
4. Update documentation when user-visible behavior changes.
5. Describe what changed, why it changed, and how it was verified.

Pull requests must not include generated installers, `node_modules`, local
settings, device identities, pairing codes, private files, or credentials.

## Project expectations

- Preserve compatibility between Windows and macOS unless the change is
  explicitly platform-specific.
- Treat incoming network data and filesystem paths as untrusted.
- Keep the app account-free and local-first.
- Avoid adding telemetry or external services without prior discussion.
- Follow the existing CommonJS style and keep user-facing text clear.

By contributing, you agree that your contribution is licensed under the MIT
License and that you will follow the project
[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).
