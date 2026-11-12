// Builds Code Scout as a Safari Web Extension for iPhone and iPad: the same extension, inside the small
// app that Safari needs around it (ios/Code Scout/, an Xcode project).
//
//   npm run ios        build the extension and put it in the Xcode project (made on the first run)
//   npm run ios:sim    the same, then build the app and start it in the booted iPhone simulator
//
// To put it on a real iPhone: open ios/Code Scout/Code Scout.xcodeproj in Xcode, pick your team under
// Signing & Capabilities for both targets, pick the phone, and press Run. Then on the phone, in
// Settings > Apps > Safari > Extensions, switch Code Scout on.
//
// What's left out of the Safari build: the EN subs reader's models (ocr/, 22 MB), which need Chrome's
// offscreen page and translator, and the permissions Safari doesn't have. The extension's own files
// in the project (Code Scout Extension/Resources) are replaced on every run: never edit them there.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = 'Code Scout';
// The extension's identifier has to begin with the app's: <BUNDLE_ID>.Extension.
// Apple gives an identifier to one developer only, so each person building this needs their own:
// by default it ends in the Mac's user name.
const BUNDLE_ID = process.env.IOS_BUNDLE_ID || `dev.codescout.${userInfo().username.toLowerCase().replace(/[^a-z0-9]/g, '') || 'me'}`;
const ios = join(root, 'ios');
const staging = join(ios, '.staging');
const project = join(ios, APP);
const xcodeproj = join(project, `${APP}.xcodeproj`);
const resources = join(project, `${APP} Extension`, 'Resources');
/** Permissions Safari doesn't know (it warns about each, and they do nothing there). */
const NOT_IN_SAFARI = ['proxy', 'bookmarks', 'favicon', 'offscreen', 'webRequestAuthProvider', 'history'];

const run = (command, args, options = {}) => execFileSync(command, args, { cwd: root, stdio: 'inherit', ...options });
const read = (command, args) => execFileSync(command, args, { cwd: root, encoding: 'utf8' });
const bin = (name) => join(root, 'node_modules/.bin', name);

// 1. The extension, built apart from dist/ (the folder a developer has loaded in Chrome).
run(bin('tsc'), ['--noEmit']);
rmSync(staging, { recursive: true, force: true });
run(bin('vite'), ['build', '--outDir', staging, '--emptyOutDir']);
rmSync(join(staging, 'ocr'), { recursive: true, force: true });
rmSync(join(staging, '.vite'), { recursive: true, force: true });
const manifestPath = join(staging, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.permissions = manifest.permissions.filter((p) => !NOT_IN_SAFARI.includes(p));
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

// 2. Into the Xcode project: made by Apple's converter the first time, refreshed after that.
if (!existsSync(xcodeproj)) {
  run('xcrun', [
    'safari-web-extension-converter', staging,
    '--project-location', ios,
    '--app-name', APP,
    '--bundle-identifier', BUNDLE_ID,
    '--ios-only', '--swift', '--copy-resources', '--no-open', '--no-prompt', '--force',
  ]);
  // The converter names the app's identifier after the app ("….Code-Scout"), which the extension's
  // ("<BUNDLE_ID>.Extension") then doesn't begin with, and Xcode refuses to build.
  const settingsFile = ['project.pbxproj', 'project.xcproj'].map((f) => join(xcodeproj, f)).find(existsSync);
  const settings = readFileSync(settingsFile, 'utf8');
  const fixed = settings.replace(/(PRODUCT_BUNDLE_IDENTIFIER"?\s*[:=]\s*"?)([\w.-]+)("?)/g, (line, before, id, after) =>
    id.endsWith('.Extension') ? `${before}${BUNDLE_ID}.Extension${after}` : `${before}${BUNDLE_ID}${after}`,
  );
  writeFileSync(settingsFile, fixed);
  console.log(`\nMade ${xcodeproj}`);
} else {
  // The project lists the extension's top-level files and folders by name: a new one needs adding there.
  const had = new Set(readdirSync(resources));
  const added = readdirSync(staging).filter((name) => !had.has(name));
  rmSync(resources, { recursive: true, force: true });
  cpSync(staging, resources, { recursive: true });
  if (added.length) {
    console.warn(`\nNew in the extension since the Xcode project was made: ${added.join(', ')}.`);
    console.warn('Add them to the "Code Scout Extension" target in Xcode, or delete ios/Code Scout and run this again.');
  }
}
rmSync(staging, { recursive: true, force: true });

if (!process.argv.includes('--sim')) {
  console.log(`\nOpen it in Xcode to run it on an iPhone:  open "${xcodeproj}"`);
  process.exit(0);
}

// 3. Build the app for the simulator that's running, install it and start it.
const booted = /\(([0-9A-F-]{36})\) \(Booted\)/.exec(read('xcrun', ['simctl', 'list', 'devices', 'booted']))?.[1];
if (!booted) {
  console.error('\nNo iPhone simulator is running. Start one (Xcode > Open Developer Tool > Simulator), then run this again.');
  process.exit(1);
}
const derived = join(ios, 'build');
run('xcodebuild', [
  '-project', xcodeproj, '-scheme', APP, '-configuration', 'Debug',
  '-destination', `platform=iOS Simulator,id=${booted}`,
  '-derivedDataPath', derived, '-quiet', 'build',
]);
const app = join(derived, 'Build/Products/Debug-iphonesimulator', `${APP}.app`);
run('xcrun', ['simctl', 'install', booted, app]);
run('xcrun', ['simctl', 'launch', booted, BUNDLE_ID]);
console.log('\nInstalled. In the simulator: Safari > page menu > Manage Extensions > switch Code Scout on.');
