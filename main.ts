// token-radar-01 entrypoint: snapshot in, ranked board + dashboard out.
// Node 22, stdlib only: MAKEFUN_OUTPUT_DIR=out node main.ts --input snapshot.json
// (no flags: /input -> /output). Parse + score via lib/model.ts, check the
// board against the gate, write board.json/data.js, copy dashboard/ and
// screenshots/ flat, then build dossier.json from the finished output so the
// judge's rebuild matches byte for byte. No network, no clock: deterministic.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

// Folder this file lives in: where dashboard/ and screenshots/ are found.
const rootDir = fileURLToPath(new URL('.', import.meta.url));

// Limits the scorer enforces. The text limit shapes the dossier; the other
// two only refuse a submission that goes past them, they never change bytes.
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

// Smallest useful screenshot set: the whole board, one detail, one filter.
const MIN_SHOTS = 3;

/** Print a message and stop with the given status. */
function fail(message: string, code: number): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(code);
}

/** Value of `--name value` or `--name=value` on the command line, else `fallback`. */
function flagValue(name: string, fallback: string): string {
  const argv = process.argv;
  const plain = argv.indexOf(`--${name}`);
  if (plain >= 0 && plain + 1 < argv.length) return argv[plain + 1]!;
  const joined = argv.find((item) => item.startsWith(`--${name}=`));
  if (joined !== undefined) return joined.slice(name.length + 3);
  return fallback;
}

/** A snapshot path from the --input flag: a .json file as given, else <dir>/snapshot.json. */
function snapshotPath(input: string): string {
  return input.endsWith('.json') ? input : join(input, 'snapshot.json');
}

/**
 * Copy the regular files of one flat folder into another, leaving out
 * dotfiles. Names are handled in sorted order so the copy (and the log
 * line that counts it) is the same on every run. Returns the copied names.
 */
function copyFlat(source: string, target: string): string[] {
  if (!existsSync(source)) return [];
  mkdirSync(target, { recursive: true });
  const names: string[] = [];
  for (const name of readdirSync(source).sort()) {
    if (name.startsWith('.')) continue;
    const from = join(source, name);
    if (!statSync(from).isFile()) continue;
    copyFileSync(from, join(target, name));
    names.push(name);
  }
  return names;
}

const snapshotFile = snapshotPath(flagValue('input', '/input'));
if (!existsSync(snapshotFile)) {
  fail(`no snapshot at ${snapshotFile}: pass --input <snapshot.json|directory> or mount the sealed /input`, 2);
}
const outDir = flagValue('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(snapshotFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const problem = boardIssue(board, snapshot);
if (problem !== null) {
  fail(`the model wrote a board the gate refuses: ${problem}`, 1);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outDir, 'data.js'), dataScript(radar));

const dashboardFiles = copyFlat(join(rootDir, 'dashboard'), join(outDir, 'dashboard'));
const shotNames = copyFlat(join(rootDir, 'screenshots'), join(outDir, 'screenshots'));
if (shotNames.length < MIN_SHOTS) {
  const word = shotNames.length === 1 ? 'image' : 'images';
  fail(`screenshots/ holds ${shotNames.length} ${word}: hand in 3, the board, a detail view and a filtered view`, 1);
}
for (const name of shotNames) {
  if (!IMAGE_NAME.test(name)) {
    fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`, 1);
  }
}

// Dossier last, from the finished output, so the scorer's rebuild matches.
writeFileSync(
  join(outDir, 'dossier.json'),
  buildDossier(outDir, {
    text_max_bytes: TEXT_MAX_BYTES,
    screenshots: SCREENSHOT_CAPS,
    dashboard: { max_files: 400, max_bytes: 4_194_304 },
  }),
);

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: wrote ${join(outDir, 'board.json')}, ${join(outDir, 'data.js')}, ${join(outDir, 'dashboard')} (${dashboardFiles.length} files), ${join(outDir, 'screenshots')} (${shotNames.length} images) and ${join(outDir, 'dossier.json')}\n`,
);
