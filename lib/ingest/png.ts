/**
 * Minimal, dependency-free PNG encoder + nearest-neighbour downscaler.
 *
 * Dipakai untuk menyiapkan piksel halaman PDF sebelum dikirim ke OCR remote.
 * Tidak memakai `@napi-rs/canvas` / `canvas` (native, berat) — cukup
 * `CompressionStream` yang tersedia di Node 22. Diadaptasi dari encoder PNG
 * internal unpdf (MIT), dipangkas untuk RGBA 8-bit.
 */

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

let crcTable: Uint32Array | null = null;
function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  crcTable = table;
  return table;
}

function crc32(bytes: Uint8Array): number {
  const table = getCrcTable();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new CompressionStream('deflate');
  const writer = stream.writable.getWriter();
  const [compressed] = await Promise.all([
    new Response(stream.readable).arrayBuffer(),
    writer.write(data as unknown as BufferSource),
    writer.close(),
  ]);
  return new Uint8Array(compressed);
}

/** Encode RGBA (4 byte/piksel, row-major dari kiri-atas) menjadi PNG. */
export async function encodePng(rgba: Uint8Array, width: number, height: number): Promise<Uint8Array> {
  const rowLength = width * 4;
  const scanlines = new Uint8Array((rowLength + 1) * height);
  for (let y = 0; y < height; y += 1) {
    scanlines.set(rgba.subarray(y * rowLength, (y + 1) * rowLength), y * (rowLength + 1) + 1);
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const parts = [chunk('IHDR', header), chunk('IDAT', await deflate(scanlines)), chunk('IEND', new Uint8Array(0))];
  const total = PNG_SIGNATURE.length + parts.reduce((sum, p) => sum + p.length, 0);
  const png = new Uint8Array(total);
  png.set(PNG_SIGNATURE);
  let offset = PNG_SIGNATURE.length;
  for (const part of parts) {
    png.set(part, offset);
    offset += part.length;
  }
  return png;
}

export type RgbaImage = { rgba: Uint8Array; width: number; height: number };

/** Downscale nearest-neighbour; dipakai untuk menurunkan DPI bila PNG > 2 MB. */
export function downscaleRgba(image: RgbaImage, factor: number): RgbaImage {
  const width = Math.max(1, Math.round(image.width * factor));
  const height = Math.max(1, Math.round(image.height * factor));
  if (width === image.width && height === image.height) return image;
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sy = Math.min(image.height - 1, Math.floor((y / height) * image.height));
    for (let x = 0; x < width; x += 1) {
      const sx = Math.min(image.width - 1, Math.floor((x / width) * image.width));
      const src = (sy * image.width + sx) * 4;
      const dst = (y * width + x) * 4;
      out[dst] = image.rgba[src];
      out[dst + 1] = image.rgba[src + 1];
      out[dst + 2] = image.rgba[src + 2];
      out[dst + 3] = image.rgba[src + 3];
    }
  }
  return { rgba: out, width, height };
}
