// Puts the subtitle reader's OCR models into public/ocr/ (copied into the extension as they are):
// the PP-OCRv6 tiny text detector, the small recogniser (Chinese + Japanese) and its dictionary,
// downloaded once from the ppu-paddle-ocr model repository (or copied from its local cache).
// Runs before `npm run dev` and `npm run build`. The folder is git-ignored.
import { copyFile, mkdir, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'https://huggingface.co/snowfluke/ppu-paddle-ocr-models/resolve/main';
const MODELS = [
  { file: 'det.ort', url: `${BASE}/detection/ort/PP-OCRv6_tiny_det.ort`, minBytes: 1_000_000 },
  { file: 'rec.ort', url: `${BASE}/recognition/ort/PP-OCRv6_small_rec.ort`, minBytes: 10_000_000 },
  { file: 'dict.txt', url: `${BASE}/recognition/ppocrv6_dict.txt`, minBytes: 50_000 },
];

const exists = (path) => stat(path).then((s) => s.size, () => 0);

/** A copy ppu-paddle-ocr already downloaded (~/.cache/ppu-paddle-ocr/<hash>/<name>), if any. */
async function cached(name) {
  const dir = join(homedir(), '.cache/ppu-paddle-ocr');
  const hashes = await readdir(dir).catch(() => []);
  for (const hash of hashes) {
    const path = join(dir, hash, name);
    if (await exists(path)) return path;
  }
  return null;
}

async function getModels() {
  const to = join(root, 'public/ocr');
  await mkdir(to, { recursive: true });
  for (const { file, url, minBytes } of MODELS) {
    const target = join(to, file);
    if ((await exists(target)) >= minBytes) continue;
    const local = await cached(url.split('/').pop());
    if (local && (await exists(local)) >= minBytes) {
      await copyFile(local, target);
      continue;
    }
    console.log(`Downloading ${url.split('/').pop()} for the subtitle reader…`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < minBytes) throw new Error(`${url}: only ${bytes.length} bytes`);
    await writeFile(`${target}.part`, bytes);
    await rename(`${target}.part`, target);
  }
}

await getModels();
