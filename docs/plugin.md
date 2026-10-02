# Stillport plugin

Stillport's portable `plugin.json` packages one skill for a local macOS or Linux
shell. The skill uses the standalone CLI and includes setup instructions,
the checksum-verifying installer, Google setup, and a public synthetic fixture.
It does not install the CLI automatically when loaded. Provider consent and
task authorization still apply.

## Install from GitHub in Codex

```sh
codex plugin marketplace add baney75/stillport --ref v0.1.3
codex plugin add stillport@stillport-marketplace
```

Start a new chat so the installed skill is discovered. Ask:

> Help me set up Stillport and test it with the included public photo fixture.

The success check is a real import and search result, followed by a viewable
preview. The fixture uses an isolated temporary index and leaves personal photos
untouched. Apple Photos then requires macOS Automation permission; Google Picker
requires an OAuth Desktop client and a person to select items. Takeout needs an
extracted local archive.

## Build the submission ZIP

```sh
bun install --frozen-lockfile --ignore-scripts
bun run check
bun run package:plugin
unzip -l dist/stillport-plugin-v0.1.3.zip
```

The packager uses an explicit file list, rejects symlinks and missing referenced
resources, checks release-version agreement, and produces reproducible ZIP bytes
with a SHA-256 sidecar. It excludes the source checkout's dependencies, compiled
executables, private indexes, environment files, and credentials. `zip` is required
for packaging; it is present on the GitHub macOS and Linux runners.

For local authoring, extract the ZIP into a separate marketplace directory and
add a `.agents/plugins/marketplace.json` there with its plugin source pointing at
the extracted folder. Run `codex plugin marketplace add /path/to/marketplace`,
then install `stillport@stillport-marketplace`. This keeps ignored build outputs
and local development state out of Codex's installed copy. The GitHub marketplace
uses a clean checkout of the published source. To check the package itself,
run its included fixture with the compiled CLI from the extracted folder.

## Upload to the universal directory

Use [OpenAI Plugins](https://platform.openai.com/plugins), choose the intended
developer identity, and upload the ZIP. Inspect metadata and skill scan findings
and resolve required errors before submitting. A successful upload creates a
draft; it does not establish approval or public publication.

This package has no hosted MCP connection. Stillport's existing stdio MCP server
can be configured separately in a local MCP client. The public skill listing
should describe its local shell requirement. Cloud and mobile chats without that
environment cannot use the local photo library.

Format and workflow sources, checked October 2, 2026:
[Package your plugin](https://developers.openai.com/plugins/build/plugins),
[Upload and submit](https://developers.openai.com/plugins/deploy/submission), and
[Plugin guidelines](https://developers.openai.com/plugins/plugin-guidelines).
