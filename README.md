<p align="center"><img src="brand/banner.svg" alt="Stillport. Your photos, within reach." width="100%"></p>

<p align="center">
<a href="https://github.com/baney75/stillport/actions/workflows/ci.yml"><img src="https://github.com/baney75/stillport/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
<a href="https://github.com/baney75/stillport/releases"><img src="https://img.shields.io/github/v/release/baney75/stillport?color=173e38" alt="Latest release"></a>
<a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-173e38" alt="MIT license"></a>
</p>

Stillport gives AI agents a CLI and an MCP server for Apple Photos, Google Photos Picker, and local Google Takeout archives. Search with the native Photos engine, inspect metadata, and export the photos an agent needs to see.

Built with TypeScript and Bun. Standalone releases require neither Node nor Bun. No hosted intermediary, telemetry, or AI API key.

## Install in Codex

Add the repository marketplace and install the Stillport skill:

```sh
codex plugin marketplace add baney75/stillport --ref v0.2.0
codex plugin add stillport@stillport-marketplace
```

Start a new chat and ask Stillport to set up the CLI and test the included public
photo fixture. The plugin contains the skill, installer, setup guide, and fixture;
it needs a local macOS, Windows or Linux shell. Apple Photos requires a Mac and Automation
permission. Google requires your own OAuth Desktop client and selection in Picker.
The CLI installation below supplies the executable the skill uses.

The plugin uses local shell commands. Its stdio MCP integration is documented
[below](#mcp). A cloud or mobile chat without a suitable local execution environment
cannot reach your computer's photo library. See [plugin packaging](docs/plugin.md)
for ZIP builds and the universal-directory submission workflow.

## Install

macOS and Linux, Apple Silicon/ARM64 or Intel/x64:

```sh
curl -fsSL https://raw.githubusercontent.com/baney75/stillport/main/install.sh | sh
```

Installs into `~/.local/bin`. If needed, add `export PATH="$HOME/.local/bin:$PATH"` to your shell profile, then restart your shell. The installer verifies the release’s SHA-256 checksum and checks the binary before replacing an existing installation. It keeps the previous executable as `stillport.previous`.

Prefer to inspect first? [Read the installer](install.sh), download it, and run `sh install.sh`. Override the destination with `STILLPORT_INSTALL_DIR`; pin a release with `STILLPORT_VERSION=vX.Y.Z`. [Manual downloads](https://github.com/baney75/stillport/releases) include `SHA256SUMS`.

```sh
stillport --version
stillport doctor
stillport capabilities
stillport update --check
stillport update
```

The updater verifies checksums, validates the new version, and replaces the binary atomically. It does not change your credentials or photo index. Checksums verify release integrity; they are not independent publisher signatures. The initial macOS binaries are not Developer ID notarized.

If an update fails before replacement, the installed binary stays in place. After a successful update, the prior executable is `stillport.previous`. To roll back without losing the newer file:

```sh
cp ~/.local/bin/stillport ~/.local/bin/stillport.failed
cp ~/.local/bin/stillport.previous ~/.local/bin/stillport
stillport --version
```

### Windows

Download and inspect [install.ps1](install.ps1), then run it from PowerShell:

```powershell
Invoke-WebRequest https://raw.githubusercontent.com/baney75/stillport/v0.2.0/install.ps1 -OutFile install.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Version v0.2.0
```

The installer chooses x64 or ARM64, verifies the release checksum and version,
installs into `%LOCALAPPDATA%\Programs\Stillport`, and adds that directory to your
user PATH. Open a new terminal and run `stillport doctor`. It needs no administrator
rights. Use `-InstallDir 'D:\My tools\Stillport'` for another location or `-NoPath`
to leave PATH unchanged. See [Windows setup and recovery](docs/windows.md).

Windows updates return `pending: true` and a status-file path. A helper waits for
the running executable to exit, verifies the staged checksum again, and replaces
it. Read the status file to confirm `applied`; the response includes the rollback
executable's path. Apple Photos remains available only on a Mac.

## Choose a provider

| Your photos are…                       | Start with                                          | What Stillport can do                                                              |
| -------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------- |
| In the open Photos library on a Mac    | `stillport status --source apple`                   | Use Apple’s native search, preview a still, or export a rendered copy or original. |
| In Google Photos                       | `stillport google pick --open`                      | Let a person search and select in Google’s Picker, then retrieve only those items. |
| In an extracted Google Takeout archive | `stillport takeout import '/path/to/Google Photos'` | Index local filenames, captions, dates, and folders without copying the archive.   |

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

`preview` makes JPEG still images up to 1600 pixels, so an image-reading tool can inspect previews exported from HEIC and supported RAW formats. `export --original` asks Photos for original files, which may include more than one file per item and may need an iCloud download. Without `--original`, Photos exports its rendered representation. Hidden, Recently Deleted, smart album access, and original availability are not guaranteed.

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
stillport preview 'PHOTO_ID' --source takeout --out ./previews
stillport export 'PHOTO_ID' --source takeout --out ./photos
```

Imports metadata from extracted media and JSON sidecars, including supplemental metadata files. Search covers filenames, captions, and folder names. It cannot reproduce Google’s private people, object, or OCR index. The archive stays where it is; Stillport keeps a private SQLite index. Re-import the same directory to update it and remove stale entries. Separate archive copies are separate items; there is no content-based deduplication.

On macOS, `preview` asks `sips` for a correctly oriented JPEG with a maximum edge of 1600 pixels. On Windows, the system decoder makes an EXIF-oriented JPEG bounded to 1600 pixels for JPEG, PNG, GIF, TIFF and BMP. WebP and AVIF are copied unchanged. On Linux, it copies JPEG, PNG, GIF, WebP, or AVIF stills into a new private folder without resizing; HEIC, RAW, and TIFF previews need macOS or an external viewer. `export` always copies the indexed file unchanged. Neither command edits the archive.

Browse one result page as an offline gallery:

```sh
stillport gallery --source takeout --query "harbor" --limit 40 --out ./galleries
```

Open the returned `indexHtml` locally, or add `--open` to open it from the CLI.
The gallery shows local still previews, titles, dates, captions and opaque IDs;
its search field filters the current page. Each image is limited to 20 MiB, and
the gallery keeps at most 200 MiB of previews. `nextCursor` retrieves the next page.
Video and unavailable previews remain visible as placeholders. It loads no remote
assets and includes no original source paths. Galleries contain personal metadata
and remain on disk until you remove them.

If an archive moves, run `stillport takeout archives` to see unavailable indexed
folders. `stillport takeout forget ARCHIVE_ID` removes that archive's index entries
only. Import its new folder to restore retrieval. This never deletes source media.

To exercise the full Takeout path without using a personal library, clone the repository and run its [synthetic public harbor fixture](examples/takeout-demo/):

```sh
./examples/takeout-demo/run.sh ./stillport-demo-output
```

The script prints the real import, search, and preview results, leaves the source fixture unchanged, and deletes its temporary index.

## Built for agents

- JSON by default, including errors. `--human` pretty-prints; `--json` is explicit JSON mode.
- `stillport schema` describes commands and options. `stillport capabilities` explains each provider’s limits.
- Bounded pages, opaque IDs, and `nextCursor`. Reuse the same query and filters with `--cursor`.
- `--after` includes its timestamp; `--before` excludes it. Date-only values mean midnight UTC.
- Each export creates a new private folder and returns its real paths. No overwrites or automatic uploads.
- MCP clients can cancel an active request; Stillport returns a structured `CANCELLED` result and removes partial staging folders.
- Exit codes: `0` success, `1` failure, `2` input, `3` permission/platform, `4` not found, `5` temporary provider failure.
- Help and version are plain text. OAuth progress goes to stderr; stdout contains the final JSON result.

```json
{
  "ok": true,
  "apiVersion": "1",
  "data": {
    "items": [],
    "nextCursor": null,
    "searchEngine": "apple-photos-native"
  }
}
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

The stdio server exposes provider discovery, search, listing, albums, selection, metadata, previews, exports, offline galleries, archive recovery, and Google Picker sessions. Authenticate Google once using the CLI before starting the server. Use `args: ["mcp", "--profile", "personal"]` for a named profile. MCP does not expose credential management, self-update, or archive import.

Prefer shell tools? Read the portable [agent skill](skills/stillport/SKILL.md), or run `stillport agent skill` to retrieve its contents as JSON. The agent can then use its own image-reading tool on an exported preview.

## Development

```sh
git clone https://github.com/baney75/stillport.git
cd stillport
bun install --frozen-lockfile --ignore-scripts
bun run check
bun run dev -- capabilities
bun run build
bun run package:plugin
# Cross-compile all six release binaries:
bun scripts/build.ts --all
```

Bun 1.4.2+; CI and releases use 1.4.2. Runtime code has no npm dependencies. TypeScript and Bun types are development dependencies. CI tests macOS, Linux, Windows x64 and Windows ARM64, including native executable checks. Tagging `vX.Y.Z` builds all release binaries, the plugin ZIP, and their checksums, provided the tag matches `package.json` and `plugin.json`.

For source installs, update with `git pull --ff-only && bun install --frozen-lockfile --ignore-scripts`. `stillport update` manages standalone binaries.

## Project

[Verification and limits](docs/verification.md) · [Google setup](docs/google-setup.md) · [Product review brief](docs/product-review.md) · [Security](SECURITY.md) · [Contributing](CONTRIBUTING.md) · [Brand and product page](brand/) · [MIT license](LICENSE)

Stillport is an independent project, not affiliated with Apple or Google. Platform names identify the services it connects to.
