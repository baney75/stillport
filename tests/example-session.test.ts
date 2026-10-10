import { test, expect } from "bun:test";
import { cp, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { dispatch } from "../src/dispatch";
import { McpServer } from "../src/mcp";

// Drives the public harbor fixture through the real MCP server. Set
// STILLPORT_WRITE_EXAMPLE=1 to regenerate docs/example-session.md from the
// actual tool output; the test always checks the session still works.
test("example session: Takeout fixture through MCP tools", async () => {
  const root = await mkdtemp(join(tmpdir(), "stillport-example-"));
  const previous = process.env.STILLPORT_HOME;
  process.env.STILLPORT_HOME = join(root, "state");
  const real = await realpath(root);
  const archive = join(root, "Google Photos");
  await cp(
    resolve(import.meta.dir, "../examples/takeout-demo/Harbor"),
    join(archive, "Harbor"),
    {
      recursive: true,
    },
  );
  try {
    const server = new McpServer();
    const call = (method: string, params: unknown = {}) =>
      server.handle({ jsonrpc: "2.0", id: 1, method, params });
    const scrub = (value: unknown) =>
      JSON.stringify(value, null, 2)
        .split(real)
        .join("/home/you/Downloads")
        .split(root)
        .join("/home/you/Downloads");
    const steps: { tool: string; args: unknown; output: unknown }[] = [];
    const invoke = async (name: string, args: Record<string, unknown>) => {
      const reply = await call("tools/call", { name, arguments: args });
      const output = JSON.parse(reply.result.content[0].text);
      steps.push({ tool: name, args, output });
      return output;
    };
    await call("initialize", { protocolVersion: "2025-03-26" });
    // Archive import is a CLI step; MCP does not expose it.
    const imported = await dispatch("takeout import", archive, {});
    const search = await invoke("stillport_search", {
      query: "fictional harbor",
      source: "takeout",
      limit: 1,
    });
    expect(search.ok).toBe(true);
    const id = search.data.items[0].id;
    expect(typeof id).toBe("string");
    const albums = await invoke("stillport_albums", { source: "takeout" });
    expect(albums.ok).toBe(true);
    const preview = await invoke("stillport_preview", {
      id,
      source: "takeout",
      out: join(root, "previews"),
    });
    expect(preview.ok).toBe(true);

    if (process.env.STILLPORT_WRITE_EXAMPLE) {
      const idText = id as string;
      const fence = (text: string) => "```json\n" + text + "\n```\n";
      const body = [
        "# Example session",
        "",
        "This is real output, not a mock-up. It was produced by the Stillport MCP",
        "server (`stillport mcp`) against the synthetic harbor photo in",
        "[`examples/takeout-demo`](../examples/takeout-demo/), on macOS. Paths are",
        "shortened and item IDs are specific to the machine that made them. Regenerate",
        "it with:",
        "",
        "```sh",
        "STILLPORT_WRITE_EXAMPLE=1 bun test tests/example-session.test.ts",
        "```",
        "",
        "Archive import is a CLI step, because the MCP server does not expose it:",
        "",
        "```sh",
        "stillport takeout import '/home/you/Downloads/Google Photos'",
        "```",
        "",
        fence(scrub(imported)),
        "Then an agent asks: *find the harbor photo and show it to me.* It calls these",
        "MCP tools in order.",
        "",
        ...steps.flatMap(({ tool, args, output }, index) => [
          `## ${index + 1}. \`${tool}\``,
          "",
          "Arguments:",
          "",
          fence(scrub(args)),
          "Result:",
          "",
          fence(scrub(output)),
        ]),
        `The agent now reads the preview file with its own image tool. The item ID (\`${idText.slice(0, 12)}…\`) stays opaque; the original file in the archive is never modified.`,
        "",
      ].join("\n");
      await writeFile(
        resolve(import.meta.dir, "../docs/example-session.md"),
        body,
      );
    }
  } finally {
    if (previous === undefined) delete process.env.STILLPORT_HOME;
    else process.env.STILLPORT_HOME = previous;
    await rm(root, { recursive: true, force: true });
  }
});
