// Builds the copy of Code Scout that is shared with other people: release/code-scout-v<version>.zip,
// to attach to a GitHub release. People drop the zip on chrome://extensions (Developer mode on), and
// drop a later version the same way to update; or unzip it and pick the folder with "Load unpacked".
// Built in release mode (the manifest then carries the fixed key: see manifest.config.ts) and into
// release/, so dist/ (the folder a developer has loaded in Chrome) is left alone.
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const FOLDER = 'code-scout';
const out = join(root, 'release');
const zip = `code-scout-v${version}.zip`;

const run = (command, args, cwd = root) => execFileSync(command, args, { cwd, stdio: 'inherit' });
const bin = (name) => join(root, 'node_modules/.bin', name);

rmSync(out, { recursive: true, force: true });
run('node', ['scripts/prepare-ocr.mjs']);
run(bin('tsc'), ['--noEmit']);
run(bin('vite'), ['build', '--mode', 'release', '--outDir', join(out, FOLDER), '--emptyOutDir']);

const manifest = JSON.parse(readFileSync(join(out, FOLDER, 'manifest.json'), 'utf8'));
if (!manifest.key) throw new Error('The release manifest has no "key": people would lose their data when they move the folder.');
if (manifest.version !== version) throw new Error(`The manifest says ${manifest.version}, package.json says ${version}.`);

// manifest.json at the top level of the zip (no folder around it): that is what Chrome wants when the
// zip is dropped on chrome://extensions. -X: no macOS extras in the archive.
run('zip', ['-r', '-q', '-X', join(out, zip), '.', '-x', '*.DS_Store'], join(out, FOLDER));

const mb = (statSync(join(out, zip)).size / 1e6).toFixed(1);
console.log(`\nrelease/${zip} (${mb} MB)`);
console.log(`Publish it:  gh release create v${version} release/${zip} --title "Code Scout ${version}" --notes "What changed"`);
