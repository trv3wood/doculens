import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function crc32(buffer: Buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(name: string, data: Buffer) {
  const type = Buffer.from(name, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([type, data])));
  return Buffer.concat([length, type, data, checksum]);
}

/** 生成带文字状矩形的 RGBA PNG，不依赖 native canvas 或 Pillow。 */
export function createPng(width: number, height: number) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height, 255);
  for (let y = 0; y < height; y++) raw[y * (stride + 1)] = 0;
  for (let line = 0; line < 14; line++) {
    const top = Math.floor(height * (0.1 + line * 0.05));
    const bottom = Math.min(height, top + Math.max(2, Math.floor(height * 0.012)));
    const right = Math.floor(width * (line % 3 === 0 ? 0.72 : 0.86));
    for (let y = top; y < bottom; y++) {
      for (let x = Math.floor(width * 0.1); x < right; x++) {
        const offset = y * (stride + 1) + 1 + x * 4;
        raw[offset] = raw[offset + 1] = raw[offset + 2] = 0;
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 6 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export function writeFixtures(directory: string) {
  mkdirSync(directory, { recursive: true });
  const small = join(directory, "document-640x480.png");
  const large = join(directory, "document-4000x3000.png");
  writeFileSync(small, createPng(640, 480));
  writeFileSync(large, createPng(4000, 3000));
  return { small, large };
}
