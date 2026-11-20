import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots';
import * as plugin from '../lib/index.js';

test('Host service declares its required host dependencies', () => {
  assert.deepEqual(plugin.inject, ['typert', 'sessionController', 'workingDirectory', 'sessionPersistence', 'agents', 'sessions', 'workspaceRegistry']);
  assert.equal(typeof plugin.apply, 'function');
});

test('Client factory adds navigation without replacing native slot owners; disposal restores the brand', async () => {
  let record;
  vm.runInNewContext(await readFile(new URL('../lib/client.js', import.meta.url), 'utf8'), {
    AbortController,
    window: { __ModuleLoader__: { load(value) { record = value; } }, addEventListener() {}, removeEventListener() {} },
  });
  assert.equal(record.id, 'dsh-workbench');
  const client = record.factory(createRequire(import.meta.url));
  const core = new SlotCore();
  const NativeFrame = () => null, NativeSidebar = () => null, NativeBrand = () => null;
  const NativeSettings = () => null, NativeWorkspace = () => null;
  core.register({ name: 'root', children: {
    sidebar: { kind: 'single', scope: 'root' },
    'shell.overlay': { kind: 'list', scope: 'root' },
    'conversation.session.header.utilities': { kind: 'list', scope: 'session' },
    'sidebar.right.pane.tab': { kind: 'keyed', scope: 'session' },
    'sidebar.right.tab.guide': { kind: 'chain', scope: 'session' },
    'sidebar.right.pane.tab.title': { kind: 'keyed', scope: 'session' },
  } }, NativeFrame);
  core.register({ name: 'sidebar', children: {
    'sidebar.brand.name': { kind: 'single', scope: 'root' },
    'sidebar.workspaces': { kind: 'single', scope: 'root' },
    'sidebar.settings': { kind: 'single', scope: 'root' },
    'sidebar.panellist': { kind: 'list', scope: 'root' },
    'sidebar.session.action': { kind: 'hoc', scope: 'root' },
    'sidebar.footer.action': { kind: 'list', scope: 'root' },
  } }, NativeSidebar);
  core.register({ name: 'sidebar.brand.name' }, NativeBrand);
  core.register({ name: 'sidebar.settings' }, NativeSettings);
  core.register({ name: 'sidebar.workspaces' }, NativeWorkspace);
  const list = { getSnapshot: () => ({ ids: [], byId: {} }), subscribe: () => () => {} };
  const cleanups = [];
  const ctx = {
    uiSession: { sessionStatus: { getSnapshot: () => new Map(), subscribe: () => () => {} } },
    inject(names, callback) {
      if (names.includes('remote.workbenchSessions')) callback(ctx);
      return { async dispose() {} };
    },
    remote: { $mount: async () => async () => {} },
    effect(fn) { const off = fn(); if (typeof off === 'function') cleanups.push(off); return off; },
    slots: {
      entriesOfSlot: name => core.entriesOfSlot(name),
      subscribe: (name, fn) => core.subscribe(name, fn),
      inject(_name, fn) { fn(); },
      register(options, component) { const off = core.register(options, component); cleanups.push(off); return off; },
    },
    locale: { register: () => () => {}, subscribe: () => () => {} },
    layout: { selectPanel() {} },
    sidebarRightTabs: { register: () => () => {}, entries: () => [], guide: () => [], subscribe: () => () => {} },
    uiWorkspace: { startSession() {}, openSession() {} },
    workspaces: { list },
    sessions: { list },
  };
  try {
    const off = await client.apply(ctx);
    cleanups.push(off);
    assert.equal(core.entriesOfSlot('root')[0].component, NativeFrame);
    assert.equal(core.entriesOfSlot('sidebar')[0].component, NativeSidebar);
    assert.equal(core.entriesOfSlot('sidebar.settings')[0].component, NativeSettings);
    assert.notEqual(core.entriesOfSlot('sidebar.workspaces')[0].component, NativeWorkspace);
    assert.notEqual(core.entriesOfSlot('sidebar.brand.name')[0].component, NativeBrand);
    assert.equal(core.entriesOfSlot('shell.overlay').length, 1);
  } finally { for (const off of cleanups.reverse()) await off(); }
  for (const slot of ['shell.overlay', 'sidebar.session.action', 'conversation.session.header.utilities', 'sidebar.right.tab.guide', 'sidebar.right.pane.tab.title']) {
    assert.equal(core.entriesOfSlot(slot).length, 0);
  }
  assert.equal(core.entriesOfSlot('sidebar.brand.name')[0].component, NativeBrand);
  assert.equal(core.entriesOfSlot('sidebar.workspaces')[0].component, NativeWorkspace);
  assert.equal(core.entriesOfSlot('sidebar.settings')[0].component, NativeSettings);
});
