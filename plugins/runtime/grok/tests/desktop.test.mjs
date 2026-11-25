import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { detectGrokDesktop } from '../lib/desktop.js';

test('detects installed Grok Bot bundles and reports missing or unavailable checks', async () => {
  const signal = new AbortController().signal;
  if (process.platform !== 'darwin') {
    assert.equal(await detectGrokDesktop(signal), null);
    return;
  }
  const directory = await mkdtemp(join(tmpdir(), 'grok-desktop-test-'));
  const noIndexedApps = async () => [];
  try {
    assert.equal(await detectGrokDesktop(signal, [directory], noIndexedApps), false);
    const app = join(directory, 'Grok Bot.app');
    const content = join(app, 'Contents');
    await mkdir(join(content, 'MacOS'), { recursive: true });
    const plist = join(content, 'Info.plist');
    const manifest = id => `<?xml version="1.0" encoding="UTF-8"?>
      <plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${id}</string>
      <key>CFBundleExecutable</key><string>Grok Bot</string></dict></plist>`;
    await writeFile(join(content, 'MacOS', 'Grok Bot'), '', { mode: 0o700 });
    await writeFile(plist, manifest('example.invalid'));
    assert.equal(await detectGrokDesktop(signal, [directory], noIndexedApps), false);
    await writeFile(plist, manifest('com.anysphere.sand'));
    assert.equal(await detectGrokDesktop(signal, [directory], noIndexedApps), true);
    assert.equal(await detectGrokDesktop(signal, [], async () => [app]), true);
    assert.equal(await detectGrokDesktop(signal, [], async () => { throw new Error('index unavailable'); }), null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
