# Stillport

Stillport is a local photo CLI, stdio MCP server, and portable skill plugin.
Use Bun 1.4.2+ and preserve JSON envelope version 1, exit codes, opaque IDs,
provider limits, private export folders, and cancellation cleanup.

Run `bun run check`, `bun run build`, and `bun run package:plugin` for a release.
Tests use synthetic archives and HTTP fixtures; do not require private libraries
or real Google credentials. For retrieval changes, exercise the public fixture
through the compiled CLI. Check `docs/verification.md` for observed limits.
Exercise new workflow shell steps in an empty workspace; ignored directories in
an existing checkout can hide missing setup such as extraction-parent creation.

Keep `package.json` and `plugin.json` versions aligned. The plugin ZIP uses an
explicit file list in `scripts/package-plugin.ts`; keep credentials, local state,
private media, development dependencies, and compiled binaries out of it.
The universal-directory package contains a skill for local shell environments.
Its stdio MCP server is a separate integration; do not claim hosted MCP access.

Preserve provider boundaries: Apple uses Photos scripting, Google requires user
selection in Picker, and Takeout searches only its local metadata. New library
editing/deletion behavior requires a separate design decision.
