# Stillport privacy

Updated October 2, 2026. Stillport is maintained by Donovan Baney.

Stillport runs on your computer. The project operates no photo-hosting service,
telemetry endpoint, analytics, or advertising system. It does not send your media
or photo metadata to its maintainer.

## Data used for your task

- **Apple Photos:** queries, selected item IDs, album names, and returned metadata
  pass between Stillport and the open Photos library through macOS scripting.
  Preview and export create local files. Original downloads may use iCloud through
  Photos. Stillport does not read the library's private database or expose deletion.
- **Google Photos:** OAuth and Picker requests go to Google. Google receives the
  client authorization, session requests, and requests for selected media. Tokens
  and OAuth client details are stored in the OS credential store unless you use
  the documented environment-variable route. Only items selected by a person in
  Picker are available to Stillport. Downloads are written locally.
- **Google Takeout:** filenames, paths, captions, folder names, and available dates
  are indexed in `takeout.sqlite` under `~/.local/share/stillport`, or the directory
  you choose with `STILLPORT_HOME`. Import does not copy media or upload the archive.
- **Installation and updates:** release downloads contact GitHub. GitHub receives
  ordinary network request information under its own privacy policy.

CLI output and MCP responses return requested metadata and local output paths to
the calling agent or application. If that host sends the results or an image you
ask it to inspect to an AI provider, that provider receives the supplied content
under the host's settings and policies. Stillport's local design does not make
the surrounding agent host local or private. Share only the photos your task needs.

## Retention and controls

The Takeout index remains until you remove it; re-importing the same archive
replaces that archive's rows and removes entries for missing files. Exported and
previewed files remain in the output directory until you remove them. Failed or
cancelled exports remove their staging folders.

Google credentials remain in the credential store until logout or removal.
`stillport auth logout --profile NAME` removes the local stored credentials for
that profile. Revoke the authorization in your Google account to remove Google's
grant as well. An access token supplied through the environment is controlled by
you and is not erased by credential-store logout. Close Picker sessions after
retrieval; session availability and expiry are controlled by Google.

You can revoke Photos Automation permission in macOS settings. Removing Stillport
does not remove your photo library, archive, generated outputs, or index. Remove
the local index and outputs separately when you no longer want them retained.

## Contact

Use [the issue tracker](https://github.com/baney75/stillport/issues) for questions.
Do not attach personal photos, local indexes, passwords, tokens, or OAuth client
files to a public issue. Report security concerns through [SECURITY.md](SECURITY.md).
