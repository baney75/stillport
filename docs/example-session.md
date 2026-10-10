# Example session

This is real output, not a mock-up. It was produced by the Stillport MCP
server (`stillport mcp`) against the synthetic harbor photo in
[`examples/takeout-demo`](../examples/takeout-demo/), on macOS. Paths are
shortened and item IDs are specific to the machine that made them. Regenerate
it with:

```sh
STILLPORT_WRITE_EXAMPLE=1 bun test tests/example-session.test.ts
```

Archive import is a CLI step, because the MCP server does not expose it:

```sh
stillport takeout import '/home/you/Downloads/Google Photos'
```

```json
{
  "indexed": 1,
  "ignoredSidecars": 0,
  "root": "/home/you/Downloads/Google Photos",
  "copiedMedia": false,
  "searchEngine": "takeout-metadata",
  "note": "Search covers filenames, captions and folder names. This index does not contain Google’s face, object or OCR search."
}
```

Then an agent asks: *find the harbor photo and show it to me.* It calls these
MCP tools in order.

## 1. `stillport_search`

Arguments:

```json
{
  "query": "fictional harbor",
  "source": "takeout",
  "limit": 1
}
```

Result:

```json
{
  "ok": true,
  "apiVersion": "1",
  "data": {
    "items": [
      {
        "id": "7d31c10419ad3b8f003e",
        "source": "takeout",
        "filename": "stillport-harbor.png",
        "title": "stillport-harbor.png",
        "description": "Quiet fictional harbor with a green rowboat. Synthetic public Stillport demo fixture.",
        "takenAt": "2026-09-07T04:00:00.000Z",
        "kind": "photo",
        "localPath": "/home/you/Downloads/Google Photos/Harbor/stillport-harbor.png"
      }
    ],
    "nextCursor": null,
    "searchEngine": "takeout-metadata",
    "order": "takenAt-desc-id"
  }
}
```

## 2. `stillport_albums`

Arguments:

```json
{
  "source": "takeout"
}
```

Result:

```json
{
  "ok": true,
  "apiVersion": "1",
  "data": {
    "items": [
      {
        "id": "Harbor",
        "name": "Harbor",
        "count": 1
      }
    ],
    "nextCursor": null
  }
}
```

## 3. `stillport_preview`

Arguments:

```json
{
  "id": "7d31c10419ad3b8f003e",
  "source": "takeout",
  "out": "/home/you/Downloads/previews"
}
```

Result:

```json
{
  "ok": true,
  "apiVersion": "1",
  "data": {
    "directory": "/home/you/Downloads/previews/stillport-1791672877707-2289655f",
    "files": [
      "/home/you/Downloads/previews/stillport-1791672877707-2289655f/stillport-harbor-preview.jpg"
    ],
    "note": "JPEG preview, correctly oriented by macOS and bounded to 1600 pixels per dimension."
  }
}
```

The agent now reads the preview file with its own image tool. The item ID (`7d31c10419ad…`) stays opaque; the original file in the archive is never modified.
