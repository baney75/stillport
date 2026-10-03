/** Read dimensions from supported still containers; this is not a pixel decoder. */
export function previewImage(
  bytes: Uint8Array,
): { format: "jpg" | "png" | "webp"; width: number; height: number } | null {
  const b = Buffer.from(bytes);
  if (b.length < 24) return null;
  const valid = (
    format: "jpg" | "png" | "webp",
    width: number,
    height: number,
  ) => (width > 0 && height > 0 ? { format, width, height } : null);
  if (
    b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    b.readUInt32BE(8) === 13 &&
    b.toString("ascii", 12, 16) === "IHDR" &&
    b.toString("ascii", b.length - 8, b.length - 4) === "IEND"
  ) {
    return valid("png", b.readUInt32BE(16), b.readUInt32BE(20));
  }
  if (
    b[0] === 0xff &&
    b[1] === 0xd8 &&
    b[b.length - 2] === 0xff &&
    b[b.length - 1] === 0xd9
  ) {
    let p = 2;
    while (p + 4 <= b.length) {
      if (b[p++] !== 0xff) return null;
      while (b[p] === 0xff) p++;
      const marker = b[p++];
      if (marker === undefined || marker === 0xda || marker === 0xd9)
        return null;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
      if (p + 2 > b.length) return null;
      const size = b.readUInt16BE(p);
      if (size < 2 || p + size > b.length) return null;
      if (
        [
          0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
          0xce, 0xcf,
        ].includes(marker)
      ) {
        if (size < 8) return null;
        return valid("jpg", b.readUInt16BE(p + 5), b.readUInt16BE(p + 3));
      }
      p += size;
    }
  }
  if (
    b.toString("ascii", 0, 4) === "RIFF" &&
    b.readUInt32LE(4) + 8 === b.length &&
    b.toString("ascii", 8, 12) === "WEBP"
  ) {
    const chunk = b.toString("ascii", 12, 16);
    if (
      chunk === "VP8 " &&
      b.length >= 30 &&
      b.subarray(23, 26).equals(Buffer.from([0x9d, 0x01, 0x2a]))
    )
      return valid(
        "webp",
        b.readUInt16LE(26) & 0x3fff,
        b.readUInt16LE(28) & 0x3fff,
      );
    if (chunk === "VP8L" && b.length >= 25 && b[20] === 0x2f) {
      const bits = b.readUInt32LE(21);
      return valid("webp", (bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
    }
    if (chunk === "VP8X" && b.length >= 30 && !(b[20]! & 0x02))
      return valid("webp", b.readUIntLE(24, 3) + 1, b.readUIntLE(27, 3) + 1);
  }
  return null;
}
