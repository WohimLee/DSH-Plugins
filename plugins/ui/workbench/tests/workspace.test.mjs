import test from 'node:test';
import assert from 'node:assert/strict';
import { createTreeStore } from '../lib/client/workspace/store.js';
import { defaultSection, emptyTree, moveProject, moveSession, placeSession, projectGroups, readTree, sessionGroups }
  from '../lib/client/workspace/tree.js';

test('moving a project preserves nested children across sections and rejects ancestry loops', () => {
  const second = 'section:second';
  const ids = ['root', 'child', 'grandchild', 'peer'];
  const initial = emptyTree();
  initial.sections.push({ id: second, title: 'Second' });
  let tree = moveProject(initial, 'child', 'root', ids);
  tree = moveProject(tree, 'grandchild', 'child', ids);
  assert.equal(moveProject(tree, 'root', 'grandchild', ids), tree);
  tree = moveProject(tree, 'root', second, ids);
  const restored = projectGroups(readTree(JSON.parse(JSON.stringify(tree))), ids);
  assert.deepEqual(restored.get(defaultSection), ['peer']);
  assert.deepEqual(restored.get(second), ['root']);
  assert.deepEqual(restored.get('root'), ['child']);
  assert.deepEqual(restored.get('child'), ['grandchild']);
});

test('cross-project chat placement is unique and unpin leads only the non-pinned group', () => {
  const projects = [{ id: 'one', sessionIds: ['one-a', 'one-b'] }, { id: 'two', sessionIds: ['two-a', 'two-b'] }];
  const sessions = [{ id: 'one-a', updatedAt: 1 }, { id: 'one-b', updatedAt: 2 }, { id: 'two-a', updatedAt: 3 }, { id: 'two-b', updatedAt: 4 }];
  const pinned = new Set(['two-a', 'two-b']);
  let tree = moveSession(emptyTree(), 'one-a', 'two', ['two-b', 'two-a'], pinned);
  assert.deepEqual(sessionGroups(tree, projects, sessions, pinned).get('one'), ['one-b']);
  assert.deepEqual(sessionGroups(tree, projects, sessions, pinned).get('two'), ['two-b', 'two-a', 'one-a']);
  pinned.delete('two-a');
  tree = placeSession(tree, 'two-a', 'two', ['two-b', 'two-a', 'one-a'], pinned, undefined, true);
  assert.deepEqual(sessionGroups(tree, projects, sessions, pinned).get('two'), ['two-b', 'two-a', 'one-a']);
});

test('live user activity advances only the affected chat within its pin group and survives reopening the store', () => {
  const storage = new Map();
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value),
  } });
  const ids = ['p1', 'p2', 'a', 'b', 'c'];
  let byId = Object.fromEntries(ids.map((id, updatedAt) => [id, { id, updatedAt }]));
  const listeners = new Set();
  const disposers = [];
  const project = { id: 'group', sessionIds: ids };
  const pins = new Set(['p1', 'p2']);
  const statusListeners = new Set();
  let status = new Map();
  const changeStatus = (id, running, completionUnread) => {
    status = new Map(status).set(id, { running, completionUnread });
    for (const listener of statusListeners) listener();
  };
  const ctx = {
    uiSession: { sessionStatus: { getSnapshot: () => status, subscribe: fn => {
      statusListeners.add(fn);
      return () => statusListeners.delete(fn);
    } } },
    sessions: { list: { getSnapshot: () => ({ ids, byId }),
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); } } },
    workspaces: { list: { getSnapshot: () => ({ items: [{ workspaceId: project.id, sessionIds: ids }], pinnedSessionIds: [...pins] }) } },
    effect(run) { disposers.push(run()); },
  };
  const update = (id, patch) => {
    byId = { ...byId, [id]: { ...byId[id], ...patch } };
    for (const listener of listeners) listener();
  };
  const order = store => sessionGroups(store.getSnapshot(), [project], Object.values(byId), pins).get('group');
  try {
    const store = createTreeStore(ctx);
    store.update(state => ({ ...state, sessions: { group: ['p1', 'p2', 'a', 'b', 'c'] } }));
    update('c', { retainedBy: { mainView: 1 }, title: 'Retained and renamed' });
    assert.deepEqual(order(store), ['p1', 'p2', 'a', 'b', 'c']);
    changeStatus('b', false, false);
    assert.deepEqual(store.getSnapshot().unread ?? [], []);
    changeStatus('b', true, false);
    changeStatus('b', false, true);
    assert.deepEqual(store.getSnapshot().unread, ['b']);
    changeStatus('b', false, false);
    assert.deepEqual(store.getSnapshot().unread, []);
    update('c', { updatedAt: 20 });
    assert.deepEqual(order(store), ['p1', 'p2', 'c', 'a', 'b']);
    update('p2', { updatedAt: 21 });
    assert.deepEqual(order(store), ['p2', 'p1', 'c', 'a', 'b']);
    for (const dispose of disposers.splice(0).reverse()) dispose();
    assert.equal(listeners.size, 0);
    assert.deepEqual(order(createTreeStore(ctx)), ['p2', 'p1', 'c', 'a', 'b']);
  } finally {
    for (const dispose of disposers) dispose();
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  }
});
