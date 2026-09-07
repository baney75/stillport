import { test, expect } from "bun:test";
import { McpServer } from "../src/mcp";
import { cancellationError } from "../src/core";
test("MCP handshake, discovery, strict validation, tool results and notifications", async () => {
  const server = new McpServer();
  const call = (method: string, params?: unknown) =>
    server.handle({ jsonrpc: "2.0", id: 1, method, params });
  expect((await call("tools/list")).error.code).toBe(-32002);
  expect(
    (await call("initialize", { protocolVersion: "2025-03-26" })).result
      .protocolVersion,
  ).toBe("2025-03-26");
  expect(
    await server.handle({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    }),
  ).toBeUndefined();
  const tools = (await call("tools/list")).result.tools;
  expect(tools.length).toBeGreaterThan(8);
  expect(
    tools.find((t: any) => t.name === "stillport_export").annotations
      .readOnlyHint,
  ).toBe(false);
  const result = await call("tools/call", {
    name: "stillport_capabilities",
    arguments: {},
  });
  expect(
    JSON.parse(result.result.content[0].text).data.apple.nativeSearch,
  ).toBe(true);
  expect(
    (
      await call("tools/call", {
        name: "stillport_search",
        arguments: { query: "test", favorite: "yes" },
      })
    ).error.code,
  ).toBe(-32602);
  expect(
    (
      await call("tools/call", {
        name: "stillport_search",
        arguments: { query: "test", unknown: true },
      })
    ).error.code,
  ).toBe(-32602);
  const interactive = await call("tools/call", {
    name: "stillport_search",
    arguments: { query: "test", source: "google" },
  });
  expect(interactive.result.isError).toBe(true);
});

test("MCP cancels an active tool call without relaxing schema validation", async () => {
  let started!: () => void;
  const running = new Promise<void>((resolve) => (started = resolve));
  const server = new McpServer(
    "default",
    async (_command, _argument, _options, _notify, signal) => {
      started();
      await new Promise<void>((resolve) =>
        signal?.addEventListener("abort", () => resolve(), { once: true }),
      );
      cancellationError();
    },
  );
  await server.handle({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {},
  });
  const request = server.handle({
    jsonrpc: "2.0",
    id: "active-search",
    method: "tools/call",
    params: { name: "stillport_search", arguments: { query: "beach" } },
  });
  await running;
  expect(
    await server.handle({
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: { requestId: "active-search" },
    }),
  ).toBeUndefined();
  const response = await request;
  const payload = JSON.parse(response.result.content[0].text);
  expect(payload.error.code).toBe("CANCELLED");
  expect(
    (
      await server.handle({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "stillport_search",
          arguments: { query: "x", unknown: true },
        },
      })
    ).error.code,
  ).toBe(-32602);
});
