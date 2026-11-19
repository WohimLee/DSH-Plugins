import { access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { ROOT, isDshPackage, readJson, shapes } from './plugin-lib.mjs';

export function assertDshBaseline(rootPackage, templates, desktopVersion) {
  const baseline = rootPackage.devDependencies?.['@deepseek-ai/dsh'];
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(baseline ?? '')) throw new Error('DSH baseline must be an exact version.');
  if (desktopVersion !== undefined && desktopVersion !== baseline) {
    throw new Error(`Desktop ${desktopVersion} differs from scaffold ${baseline}; synchronize DSH dependencies, templates and lockfile, then validate compatibility.`);
  }
  for (const [label, pkg] of [['root', rootPackage], ...templates]) {
    if (label !== 'root' && pkg.engines?.dsh !== baseline) throw new Error(`${label}: engines.dsh differs from ${baseline}`);
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
      for (const [name, version] of Object.entries(pkg[field] ?? {})) {
        if (isDshPackage(name) && version !== baseline) throw new Error(`${label}: ${field}.${name} differs from ${baseline}`);
      }
    }
  }
  return baseline;
}

async function localDesktopVersion() {
  const explicitApp = process.env.DSH_DESKTOP_APP;
  if (process.platform !== 'darwin') {
    if (explicitApp) throw new Error('DSH_DESKTOP_APP automatic inspection currently requires macOS; use --desktop-version elsewhere.');
    return undefined;
  }
  const candidates = explicitApp ? [explicitApp] : ['/Applications/DeepSeek Harness.app', resolve(homedir(), 'Applications/DeepSeek Harness.app')];
  for (const app of candidates) {
    const plist = resolve(app, 'Contents/Info.plist');
    try { await access(plist); }
    catch (error) {
      if (error.code === 'ENOENT' && !explicitApp) continue;
      throw error;
    }
    return execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', plist], { encoding: 'utf8' }).trim();
  }
  return undefined;
}

export async function checkDshVersion({ desktopVersion, requireDesktop = false } = {}) {
  const desktop = desktopVersion ?? (requireDesktop ? await localDesktopVersion() : undefined);
  if (requireDesktop && !desktop) throw new Error('Desktop version unavailable; set DSH_DESKTOP_APP on macOS or pass --desktop-version <actual-version>.');
  const pkg = await readJson(resolve(ROOT, 'package.json'));
  const templates = await Promise.all(shapes.map(async shape => [shape, await readJson(resolve(ROOT, 'templates', shape, 'package.json'))]));
  const baseline = assertDshBaseline(pkg, templates, desktop);
  for (const [name, version] of Object.entries(pkg.devDependencies).filter(([name]) => isDshPackage(name))) {
    const installed = await readJson(resolve(ROOT, 'node_modules', name, 'package.json'));
    if (installed.version !== version) throw new Error(`${name}: installed ${installed.version} differs from ${version}; run pnpm install.`);
  }
  console.log(`PASS DSH scaffold/dependency baseline ${baseline}; ${desktop ? `Desktop ${desktop} matches` : 'repository consistency only; pass --require-desktop to compare with installed Desktop'}.`);
  return baseline;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(ROOT, 'scripts/check-dsh-version.mjs')) {
  try {
    const args = process.argv.slice(2);
    let desktopVersion, requireDesktop = false;
    while (args.length) {
      const arg = args.shift();
      if (arg === '--require-desktop') requireDesktop = true;
      else if (arg === '--desktop-version' && args[0] && !args[0].startsWith('--')) desktopVersion = args.shift();
      else throw new Error('Usage: check-dsh-version.mjs [--require-desktop] [--desktop-version <actual-version>]');
    }
    await checkDshVersion({ desktopVersion, requireDesktop });
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
