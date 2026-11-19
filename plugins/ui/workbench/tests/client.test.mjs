import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots';
import { panelSource } from '../lib/client/integration/panels.js';
import { installAppearance } from '../lib/client/appearance/install.js';
import { ActivityBar } from '../lib/client/navigation/ActivityBar.js';
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
