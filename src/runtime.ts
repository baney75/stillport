export const MIN_BUN = "1.4.2";

export function bunIsSupported(version: string, minimum = MIN_BUN) {
  const parse = (value: string) =>
    value
      .split("-")[0]!
      .split(".")
      .map((part) => Number.parseInt(part, 10) || 0);
  const have = parse(version);
  const need = parse(minimum);
  for (let i = 0; i < 3; i++) {
    const a = have[i] ?? 0;
    const b = need[i] ?? 0;
    if (a !== b) return a > b;
  }
  return true;
}

// Imported first by the CLI so an old Bun stops with one clear line instead of
// failing later with SQLite errors such as "database is locked".
const running = (globalThis as { Bun?: { version: string } }).Bun?.version;
if (running && !bunIsSupported(running)) {
  console.error(
    `Stillport needs Bun >= ${MIN_BUN} (found ${running}). Run: bun upgrade`,
  );
  process.exit(1);
}
