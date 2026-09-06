# Contributing

Open an issue for a significant provider or interface change. Small fixes can go straight to a pull request.

Use Bun 1.3.10 or later. Run `bun install --frozen-lockfile --ignore-scripts`, `bun run check`, and `bun run build`. Tests use temporary synthetic archives and mocked Google HTTP boundaries; they never require a real photo library or credentials. Do not commit private media, OAuth client JSON, tokens, or local indexes.

Preserve JSON envelope version 1, meaningful exit codes, opaque provider IDs, and bounded pagination. Reject options that a provider cannot honor. Native search claims must match the platform’s actual capability. Library mutations require a separate design discussion.

The release workflow checks that tags match `package.json`, builds macOS/Linux ARM64/x64 executables, and publishes a checksum manifest. Review the release notes and verification document before tagging. Public package-registry distribution is not configured; GitHub releases are the distribution channel.
