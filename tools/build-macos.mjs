#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
if (args.has('--help')) {
  console.log('Usage: bash build-macos.sh [--app-only] [--skip-install]');
  console.log('Builds a local ad-hoc signed app/DMG. Runs frontend/Rust checks; no updater signing or publishing.');
  process.exit(0);
}
for (const arg of args) {
  if (!['--app-only', '--skip-install'].includes(arg)) throw new Error(`Unknown option: ${arg}`);
}
if (process.platform !== 'darwin') throw new Error('A macOS host is required.');
if (Number(process.versions.node.split('.')[0]) < 20) throw new Error('Node.js 20+ is required.');

function run(command, argv) {
  console.log(`==> ${command} ${argv.join(' ')}`);
  const result = spawnSync(command, argv, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (exit ${result.status}, signal ${result.signal})`);
}
run('cargo', ['--version']);
run('xcode-select', ['-p']);
if (!args.has('--skip-install')) run('npm', ['--prefix', 'web', 'ci']);
const cli = path.join(root, 'web/node_modules/@tauri-apps/cli/tauri.js');
if (!existsSync(cli)) throw new Error('Run npm --prefix web ci first.');
if (!existsSync(path.join(root, 'icons/icon.icns'))) throw new Error('Missing tracked icons/icon.icns.');
run('python3', ['tools/check_release.py']);
run('npm', ['run', 'typecheck']);
run('npm', ['test']);
run('npm', ['run', 'build']);
run('cargo', ['test', '--locked']);
// Local candidates do not require updater secrets and must not rotate any keys.
// Tauri 1 rewrites Cargo.toml features and Cargo.lock when updater is disabled.
// Preserve exact pre-build contents (including local changes), even on failure.
// Disk copies also support recovery after a forced kill, when finally cannot run.
const backupDir = path.join(root, 'target/local-builds', `build-inputs-${Date.now()}`);
mkdirSync(backupDir, { recursive: true });
const inputs = ['Cargo.toml', 'Cargo.lock'].map(name => {
  const file = path.join(root, name);
  const content = readFileSync(file);
  writeFileSync(path.join(backupDir, name), content);
  return { file, content };
});
try {
  run(process.execPath, [cli, 'build', '--bundles', args.has('--app-only') ? 'app' : 'app,dmg', '--config', JSON.stringify({ tauri: { updater: { active: false } } })]);
} finally {
  for (const { file, content } of inputs) writeFileSync(file, content);
}
run('python3', ['tools/check_release.py']);
console.log('Local build complete: target/release/bundle/macos/Clavis.app');
if (!args.has('--app-only')) console.log('Installer: target/release/bundle/dmg/');
console.log('Ad-hoc signed, not Apple-notarized. No remote release was created.');
