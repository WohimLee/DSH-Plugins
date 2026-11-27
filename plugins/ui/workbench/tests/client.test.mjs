import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots';
import { panelSource } from '../lib/client/integration/panels.js';
import { installAppearance } from '../lib/client/appearance/install.js';
import { ActivityBar } from '../lib/client/navigation/ActivityBar.js';
import { AgentIcon, agentCatalog } from '../lib/client/panels/Subagents.js';
import { forgeConnectionSource, observeLocalChanges } from '../lib/client/panels/changes.js';
import { scheduleFrequency, summaryScheduledTasks, taskNextRunAt } from '../lib/client/panels/scheduled.js';
import { messages } from '../lib/client/messages.js';

test('navigation source follows panel registration, stable order, locale changes and removal', async () => {
  const core = new SlotCore();
  core.register({ name: 'root', children: { 'sidebar.panellist': { kind: 'list', scope: 'root' } } }, () => null);
  const localeListeners = new Set(), effects = [];
  let activeSlotSubscriptions = 0;
  const ctx = {
    slots: {
      entriesOfSlot: key => core.entriesOfSlot(key),
      subscribe(key, callback) {
        activeSlotSubscriptions++;
        const off = core.subscribe(key, callback);
        return () => { activeSlotSubscriptions--; off(); };
      },
    },
    locale: { subscribe(callback) { localeListeners.add(callback); return () => localeListeners.delete(callback); } },
    effect(callback) { const off = callback(); effects.push(off); return off; },
  };
  const source = panelSource(ctx);
  const empty = source.getSnapshot();
  assert.strictEqual(source.getSnapshot(), empty, 'unchanged snapshots must preserve identity for React subscriptions');
  let language = 'zh', notifications = 0;
  const offSource = source.subscribe(() => notifications++);
  const removeLate = core.register({ name: 'sidebar.panellist', id: 'late', order: 20, label: () => language === 'zh' ? '后项' : 'Later' }, () => null);
  core.register({ name: 'sidebar.panellist', id: 'first', order: -10, label: 'First' }, () => null);
  core.register({ name: 'sidebar.panellist', id: 'tie', order: 20 }, () => null);
  await Promise.resolve();
  assert.deepEqual(source.getSnapshot().map(entry => entry.id), ['first', 'late', 'tie']);
  assert.deepEqual(source.getSnapshot().map(entry => entry.label), ['First', '后项', 'tie']);
  assert.equal(notifications, 1, 'same-tick registry changes form one update');
  const beforeLocale = source.getSnapshot();
  localeListeners.forEach(fn => fn());
  assert.strictEqual(source.getSnapshot(), beforeLocale, 'a locale notification without changed labels must not replace the snapshot');
  assert.equal(notifications, 1);
  language = 'en';
  localeListeners.forEach(fn => fn());
  assert.equal(source.getSnapshot()[1].label, 'Later');
  assert.equal(notifications, 2);
  removeLate();
  await Promise.resolve();
  assert.deepEqual(source.getSnapshot().map(entry => entry.id), ['first', 'tie']);
  offSource();
  language = 'zh';
  localeListeners.forEach(fn => fn());
  const afterUnsubscribe = notifications;
  effects.reverse().forEach(off => off());
  assert.equal(activeSlotSubscriptions, 0);
  assert.equal(localeListeners.size, 0);
  core.register({ name: 'sidebar.panellist', id: 'after-dispose' }, () => null);
  await Promise.resolve();
  assert.equal(notifications, afterUnsubscribe);
  assert.deepEqual(source.getSnapshot().map(entry => entry.id), ['first', 'tie']);
});

function fakeDocument(initialValue) {
  const attributes = new Map(initialValue === undefined ? [] : [['data-dsh-workbench', initialValue]]);
  const styles = [{ existing: true }];
  return {
    styles,
    documentElement: {
      getAttribute: name => attributes.get(name) ?? null,
      setAttribute: (name, value) => attributes.set(name, value),
      removeAttribute: name => attributes.delete(name),
    },
    head: { append(style) { styles.push(style); } },
    createElement(name) {
      assert.equal(name, 'style');
      const style = { dataset: {}, textContent: '', remove() { const index = styles.indexOf(style); if (index !== -1) styles.splice(index, 1); } };
      return style;
    },
  };
}

test('appearance owns only its stylesheet and restores the prior document attribute', () => {
  for (const previous of [undefined, 'custom-value']) {
    const doc = fakeDocument(previous);
    const dispose = installAppearance(doc);
    assert.equal(doc.documentElement.getAttribute('data-dsh-workbench'), 'true');
    assert.equal(doc.styles.length, 2);
    assert.ok(doc.styles[1].textContent.length > 0);
    dispose();
    dispose();
    assert.deepEqual(doc.styles, [{ existing: true }]);
    assert.equal(doc.documentElement.getAttribute('data-dsh-workbench'), previous ?? null);
  }
  assert.doesNotThrow(() => installAppearance(undefined)());
});

test('appearance cleanup preserves a later attribute change owned by another caller', () => {
  const doc = fakeDocument();
  const dispose = installAppearance(doc);
  doc.documentElement.setAttribute('data-dsh-workbench', 'other-owner');
  dispose();
  assert.equal(doc.documentElement.getAttribute('data-dsh-workbench'), 'other-owner');
  assert.equal(doc.styles.length, 1);
});

function activityProps({ selected = null } = {}) {
  return {
    usePanels: selector => selector([{ id: 'plugins', label: '插件管理', order: 0 }, { id: 'third-party', label: 'Third party', order: 10 }]),
    usePanelInfo: selector => selector({ activePanelId: selected }),
    selectPanel() {},
    renderFactorySlot(name, props) {
      assert.equal(name, 'sidebar.panel.icon');
      return createElement('span', { 'data-test-icon': props.id });
    },
    t: key => messages.zh[key],
  };
}

test('activity navigation exposes native and third-party destinations with a single sidebar toggle owned by the host', () => {
  const html = renderToStaticMarkup(createElement(ActivityBar, activityProps({ selected: 'third-party' })));
  assert.match(html, /aria-label="工作台导航"/);
  for (const label of ['对话', '插件管理', 'Third party', '更多面板']) assert.ok(html.includes('aria-label="' + label + '"'));
  assert.match(html, /data-workbench-panel="third-party"[^>]+aria-current="page"/);
  assert.doesNotMatch(html, /切换项目侧栏/);
});

test('Home is selected in the conversation and the rail has no session creation action or divider', () => {
  const html = renderToStaticMarkup(createElement(ActivityBar, activityProps()));
  assert.doesNotMatch(html, /新建会话|dsh-workbench-divider/);
  assert.match(html, /aria-label="对话"[^>]+aria-current="page"/);
  assert.ok(html.includes('data-workbench-panel="third-party"'));
});

test('agent list follows only reachable catalogs, retains direct parents, and uses live activity', () => {
  const ready = entries => ({ state: 'ready', values: { subagentCatalog: entries } });
  const child = (id, mode = 'continuable') => ({ id, label: id, mode, createdAt: 100 });
  const state = {
    byId: { first: { running: false }, nested: { projectionValues: { subagentTiming: { lastTurnCompleted: true } } } },
    projectionsBySession: {
      root: ready([child('first'), child('external', 'external')]),
      first: ready([child('nested')]),
      nested: ready([child('root')]),
      unrelated: ready([child('outside')]),
    },
  };
  const result = agentCatalog(state, 'root', new Map([['first', { running: true }]]));
  assert.deepEqual(result.rows.map(row => [row.id, row.parent, row.group]), [
    ['first', 'root', 'active'], ['external', 'root', 'idle'], ['nested', 'first', 'done'],
  ]);
  assert.deepEqual(result.pending, []);
  const icons = ['first', 'external', 'nested'].map(id => renderToStaticMarkup(createElement(AgentIcon, { id })));
  assert.equal(new Set(icons).size, 3);
  assert.equal(renderToStaticMarkup(createElement(AgentIcon, { id: 'first' })), icons[0]);
});

test('Changes waits for an actual Forge checkout and distinguishes missing from zero totals', async () => {
  const changes = [];
  let releases = 0;
  const root = '/fixture/checkout';
  const checkout = { state: 'ready', checkout: { root } };
  const panel = { follow: sessionId => ({
    async *[Symbol.asyncIterator]() {
      assert.equal(sessionId, 'session');
      yield { checkout: { state: 'pending' }, local: null };
      yield { checkout, local: null };
      yield { checkout, local: { files: [] } };
      yield { checkout, local: { files: [{ additions: 3, deletions: 1 }, { additions: 5, deletions: 2 }] } };
      yield { checkout: { state: 'none' }, local: null };
      yield { checkout: { state: 'failed' }, local: null };
    },
    dispose() { releases++; },
  }) };
  await observeLocalChanges({ panel }, 'session', new AbortController().signal, value => changes.push(value));
  assert.deepEqual(changes, [undefined, { root, counts: undefined }, { root, counts: { added: 0, deleted: 0 } },
    { root, counts: { added: 8, deleted: 3 } }, undefined, undefined]);
  assert.equal(releases, 1);
});

test('Forge connection invalidates on reset and abort prevents late cross-session publications', async () => {
  const contexts = [];
  const connection = forgeConnectionSource({ inject(deps, use) { assert.deepEqual(deps, ['remote.forgePanel']); contexts.push(use); } });
  assert.equal(connection.getSnapshot(), undefined);
  const root = '/fixture/old-checkout';
  let reset, disable, releases = 0;
  let resolveFrame;
  const panel = { follow: () => ({
    async *[Symbol.asyncIterator]() {
      await new Promise(resolve => { resolveFrame = resolve; });
      yield { checkout: { state: 'ready', checkout: { root } }, local: { files: [] } };
    },
    dispose() { releases++; },
  }) };
  contexts[0]({ get: () => panel, on(event, callback) { assert.equal(event, 'connection/reset'); reset = callback; return () => { reset = undefined; }; },
    effect(callback) { disable = callback(); } });
  const old = connection.getSnapshot();
  const request = new AbortController();
  const changes = [];
  const following = observeLocalChanges(old, 'old', request.signal, value => changes.push(value));
  reset();
  assert.notEqual(connection.getSnapshot(), old);
  assert.equal(connection.getSnapshot().panel, old.panel);
  request.abort();
  assert.equal(releases, 1);
  resolveFrame();
  await following;
  await observeLocalChanges(old, 'old', request.signal, value => changes.push(value));
  assert.deepEqual(changes, []);
  assert.equal(releases, 1);
  disable();
  assert.equal(connection.getSnapshot(), undefined);
  assert.equal(reset, undefined);
});

test('Summary schedule follows only fixed current delivery targets and keeps paused rules distinct', () => {
  const occurrence = '2030-01-15T12:00:00.000Z';
  const later = '2030-01-15T12:05:00.000Z';
  const task = (id, status, target, extra = {}) => ({ id, kind: 'at', status, target, scheduledAt: occurrence,
    involvedSessionIds: ['alpha'], lastDelivery: { targetSessionId: 'alpha' }, ...extra });
  const alpha = { kind: 'session', sessionId: 'alpha' };
  const beta = { kind: 'session', sessionId: 'beta' };
  const tasks = [task('paused', 'paused', alpha), task('history', 'active', { kind: 'new' }),
    task('ended', 'ended', alpha), task('rebound', 'active', beta), task('active', 'active', alpha, { deliveryFloorEndsAt: later }),
    task('reserved', 'active', { kind: 'new_once', sessionId: 'alpha' })];
  assert.deepEqual(summaryScheduledTasks(tasks, 'alpha').map(item => item.id), ['reserved', 'active', 'paused']);
  assert.deepEqual(summaryScheduledTasks(tasks, 'beta').map(item => item.id), ['rebound']);
  assert.deepEqual(summaryScheduledTasks(tasks, 'other'), []);
  assert.equal(taskNextRunAt(tasks[4]), later);
  assert.equal(taskNextRunAt(tasks[5]), occurrence);
  assert.equal(scheduleFrequency(tasks[0]), 'summaryFrequencyOnce');
  assert.equal(scheduleFrequency({ kind: 'rrule', rrule: 'DTSTART:20300115T120000Z\nRRULE:FREQ=WEEKLY' }), 'summaryFrequencyWeekly');
});
