#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { API_VERSION, VERSION, asError, fail } from "./core";
import { commands, optionTypes } from "./commands";
import { dispatch } from "./dispatch";
import { serveMcp } from "./mcp";
function help(command?: string) {
  const selected = command && commands[command];
  if (selected)
    return `Stillport · ${command}\n\n${selected.description}\n\nUsage: stillport ${command}${selected.positional ? ` <${selected.positional}>` : ""}\n${selected.options.map((key) => `  --${key}${optionTypes[key] === "string" ? " <value>" : ""}`).join("\n")}\n\nOutput: JSON by default. --human for indented output.\n`;
  return `STILLPORT\nYour photos, within reach.\n\nUsage: stillport <command> [options]\n\n${Object.entries(
    commands,
  )
    .map(([name, cmd]) => `  ${name.padEnd(19)} ${cmd.description}`)
    .join(
      "\n",
    )}\n\nStart here:\n  stillport doctor\n  stillport search "dogs at the beach" --source apple\n  stillport auth google --client-json ./desktop-client.json\n  stillport google pick --open\n  stillport takeout import /path/to/Google-Photos\n\nJSON is the default. --human indents it. Dates use UTC.\nFull contract: stillport schema\nDocumentation: https://github.com/baney75/stillport\n`;
}
async function main() {
  let human = false;
  try {
    let parsed;
    try {
      parsed = parseArgs({
        args: process.argv.slice(2),
        options: Object.fromEntries(
          Object.entries(optionTypes).map(([key, type]) => [key, { type }]),
        ),
        allowPositionals: true,
        strict: true,
      });
    } catch {
      fail(
        "INVALID_ARGUMENT",
        "Unknown option or missing option value.",
        "Run stillport --help.",
        2,
      );
    }
    const { values, positionals } = parsed;
    human = values.human === true;
    if (values.version) {
      console.log(VERSION);
      return;
    }
    let command = positionals[0] || "help";
    const pair = positionals.slice(0, 2).join(" ");
    const consumed = commands[pair] ? 2 : 1;
    if (consumed === 2) command = pair;
    if (command === "help" || values.help) {
      console.log(help(command));
      return;
    }
    const arguments_ = positionals.slice(consumed);
    if (arguments_.length > 1)
      fail(
        "INVALID_ARGUMENT",
        "Too many arguments. Quote multiword queries.",
        undefined,
        2,
      );
    const options = Object.fromEntries(
      Object.entries(values).filter(
        ([key]) => !["help", "version"].includes(key),
      ),
    );
    if (command === "mcp") {
      if (arguments_.length)
        fail(
          "INVALID_ARGUMENT",
          "mcp does not accept positional arguments.",
          undefined,
          2,
        );
      for (const key of Object.keys(options))
        if (key !== "profile")
          fail(
            "INVALID_ARGUMENT",
            `--${key} does not apply to MCP mode.`,
            undefined,
            2,
          );
      await serveMcp(
        typeof options.profile === "string" ? options.profile : undefined,
      );
      return;
    }
    const result = await dispatch(command, arguments_[0], options, (value) =>
      process.stderr.write(JSON.stringify(value) + "\n"),
    );
    console.log(
      JSON.stringify(
        { ok: true, apiVersion: API_VERSION, data: result },
        null,
        human ? 2 : undefined,
      ),
    );
  } catch (e) {
    const error = asError(e);
    console.log(
      JSON.stringify(
        {
          ok: false,
          apiVersion: API_VERSION,
          error: { code: error.code, message: error.message, hint: error.hint },
        },
        null,
        human ? 2 : undefined,
      ),
    );
    process.exitCode = error.exitCode;
  }
}
await main();
