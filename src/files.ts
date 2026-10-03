import { open } from "node:fs/promises";
import { fail, throwIfCancelled } from "./core";

/** Bound output and check cancellation between chunks, without buffering a photo. */
export async function copyPreview(
  source: string,
  destination: string,
  max: number,
  signal?: AbortSignal,
) {
  throwIfCancelled(signal);
  const input = await open(source, "r");
  let output: Awaited<ReturnType<typeof open>> | undefined;
  try {
    if ((await input.stat()).size > max)
      fail(
        "PREVIEW_TOO_LARGE",
        "This still exceeds the gallery's remaining byte budget.",
      );
    output = await open(destination, "wx", 0o600);
    const buffer = Buffer.alloc(256 * 1024);
    let total = 0;
    while (true) {
      throwIfCancelled(signal);
      const { bytesRead } = await input.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > max)
        fail(
          "PREVIEW_TOO_LARGE",
          "This still exceeds the gallery's remaining byte budget.",
        );
      await output.writeFile(buffer.subarray(0, bytesRead));
    }
    throwIfCancelled(signal);
    return total;
  } finally {
    await input.close();
    await output?.close();
  }
}
