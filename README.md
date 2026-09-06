<p align="center"><img src="brand/banner.svg" alt="Stillport. Your photos, within reach." width="100%"></p>

<p align="center">
<a href="https://github.com/baney75/stillport/actions/workflows/ci.yml"><img src="https://github.com/baney75/stillport/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
<a href="https://github.com/baney75/stillport/releases"><img src="https://img.shields.io/github/v/release/baney75/stillport?color=173e38" alt="Latest release"></a>
<a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-173e38" alt="MIT license"></a>
</p>

Stillport gives AI agents a CLI and an MCP server for Apple Photos, Google Photos Picker, and local Google Takeout archives. Search with the native Photos engine, inspect metadata, and export the photos an agent needs to see.

Built in TypeScript with Bun. Standalone releases require neither Node nor Bun. No hosted intermediary, telemetry, or AI API key.

## Install

macOS and Linux, Apple Silicon/ARM64 or Intel/x64:

```sh
curl -fsSL https://raw.githubusercontent.com/baney75/stillport/main/install.sh | sh
```

Installs into `~/.local/bin`. If needed, add `export PATH="$HOME/.local/bin:$PATH"` to your shell profile, then restart your shell. The installer verifies the release’s SHA-256 checksum and checks the binary before replacing an existing installation. It keeps the previous executable as `stillport.previous`.

Prefer to inspect first? [Read the installer](install.sh), download it, and run `sh install.sh`. Override the destination with `STILLPORT_INSTALL_DIR`; pin a release with `STILLPORT_VERSION=v0.1.0`. [Manual downloads](https://github.com/baney75/stillport/releases) include `SHA256SUMS`.

```sh
stillport doctor
stillport update --check
stillport update
```

The updater verifies checksums, validates the new version, and replaces the binary atomically. It does not change your credentials or photo index. Checksums verify release integrity; they are not independent publisher signatures. The initial macOS binaries are not Developer ID notarized.

## Apple Photos: native search

```sh
stillport search "dogs at the beach" --source apple --limit 10
stillport search "July 2026" --source apple
stillport list --source apple --after 2026-07-01 --before 2026-08-01
stillport list --source apple --favorite
stillport albums --source apple
stillport selection
stillport get 'PHOTO_ID' --source apple
stillport preview 'PHOTO_ID' --source apple --out ./previews
stillport export 'PHOTO_ID' --source apple --original --out ./photos
stillport reveal 'PHOTO_ID'
```

Queries go directly to Apple Photos’ `search` scripting command. This uses the search index maintained by Photos; results depend on macOS, Photos, language, and indexing progress. People, places, subjects, and text may be available through that engine. Stillport does not invent a separate semantic index or guarantee a specific match. Date, favorites, and album filters can narrow results.

Requires a Mac with Photos and its scripting search command. On first access, macOS may ask you to allow your terminal or agent host to control Photos. Grant that in **System Settings → Privacy & Security → Automation**. This is access to the currently open library, including items synced through iCloud. Stillport never reads or modifies Photos’ private database. It exposes no library editing or deletion commands. Its Automation permission is broader than the operations it exposes.

`preview` makes a still image up to 1600 pixels. `export --original` asks Photos for original files, which may include more than one file per item and may need an iCloud download. Without `--original`, Photos exports its rendered representation. Hidden, Recently Deleted, smart album access, and original availability are not guaranteed.

## Google Photos: search and choose

Google removed general access to users’ existing libraries from the Library API in 2025. The supported route is the **Photos Picker API**: a person uses Google Photos’ native search and chooses what the agent can access. Stillport does not scrape a signed-in browser or ask for Google passwords.

One-time setup requires your own Google Cloud OAuth **Desktop app** client with the Photos Picker API enabled. [Setup guide](docs/google-setup.md).

```sh
stillport auth google --client-json ./desktop-client.json
stillport google pick --open
# Open the returned pickerUri, search in Google Photos, select photos, finish.
stillport google session 'SESSION_ID'
stillport google items 'SESSION_ID'
stillport preview 'PHOTO_ID' --source google --session 'SESSION_ID' --out ./previews
stillport export 'PHOTO_ID' --source google --session 'SESSION_ID' --out ./photos
stillport google close 'SESSION_ID'
```

Agents should pass the Picker URL to the user and honor the session’s `pollingConfig`. There is no unattended native Google library search. Sessions expire, and only selected items are accessible. Google’s image downloads omit location metadata; its video download is a high-quality transcode. Downloads are capped at 1 GiB per item. Credentials use the OS credential store; `--profile NAME` separates Google authorizations. See the setup guide for headless tokens and revocation.

## Google Takeout: local archive search

```sh
stillport takeout import '/path/to/extracted/Takeout/Google Photos'
stillport search 'beach' --source takeout
stillport albums --source takeout
stillport get 'PHOTO_ID' --source takeout
stillport export 'PHOTO_ID' --source takeout --out ./photos
```

Imports metadata from extracted media and JSON sidecars, including supplemental metadata files. Search covers filenames, captions, and folder names. It cannot reproduce Google’s private people, object, or OCR index. The archive stays where it is; Stillport keeps a private SQLite index. Re-import the same directory to update it and remove stale entries. Separate archive copies are separate items; there is no content-based deduplication.

## Built for agents

- JSON by default, including errors. `--human` pretty-prints; `--json` is explicit JSON mode.
- `stillport schema` describes commands and options. `stillport capabilities` explains each provider’s limits.
- Bounded pages, opaque IDs, and `nextCursor`. Reuse the same query and filters with `--cursor`.
- `--after` includes its timestamp; `--before` excludes it. Date-only values mean midnight UTC.
- Each export creates a new private folder and returns its real paths. No overwrites or automatic uploads.
- Exit codes: `0` success, `1` failure, `2` input, `3` permission/platform, `4` not found, `5` temporary provider failure.
- Help and version are plain text. OAuth progress goes to stderr; stdout contains the final JSON result.

```json
{"ok":true,"apiVersion":"1","data":{"items":[],"nextCursor":null,"searchEngine":"apple-photos-native"}}
```

The example is illustrative. A returned page may include other documented metadata.

### MCP

Use the absolute path printed by `command -v stillport` in your MCP client’s config. Claude Desktop and clients using the `mcpServers` format:

```json
{
  "mcpServers": {
    "stillport": {
      "command": "/absolute/path/to/stillport",
      "args": ["mcp"]
    }
  }
}
```

The stdio server exposes provider discovery, search, listing, albums, selection, metadata, previews, exports, and Google Picker sessions. Authenticate Google once using the CLI before starting the server. Use `args: ["mcp", "--profile", "personal"]` for a named profile. MCP does not expose credential management, self-update, or archive import.

Prefer shell tools? Read the portable [agent skill](skills/stillport/SKILL.md), or run `stillport agent skill` to retrieve its contents as JSON. The agent can then use its own image-reading tool on an exported preview.

## Development

```sh
git clone https://github.com/baney75/stillport.git
cd stillport
bun install --frozen-lockfile --ignore-scripts
bun run check
bun run dev -- capabilities
bun run build
# Cross-compile all four release binaries:
bun scripts/build.ts --all
```

Bun 1.3.10+; releases build with 1.3.14. Runtime code has no npm dependencies. TypeScript and Bun types are development dependencies. CI tests macOS and Linux and checks a compiled executable. Tagging `vX.Y.Z` builds all release binaries and publishes their checksums, provided the tag matches `package.json`.

For source installs, update with `git pull --ff-only && bun install --frozen-lockfile --ignore-scripts`. `stillport update` manages standalone binaries.

## Project

[Verification and limits](docs/verification.md) · [Security](SECURITY.md) · [Contributing](CONTRIBUTING.md) · [Brand assets](brand/) · [MIT license](LICENSE)

Stillport is an independent project, not affiliated with Apple or Google. Platform names identify the services it connects to.
