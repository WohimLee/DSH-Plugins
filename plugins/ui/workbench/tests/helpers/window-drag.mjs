import assert from 'node:assert/strict';

const endpoints = [
  ['Home', 'Conversation', '[data-slot="conversation.header"] header'],
  ['Plugins', 'Plugins', '[data-plugin-panel]'],
  ['Scheduled', 'Scheduled', '[data-testid="task-manager-page"]'],
  ['Models', 'Model management fixture', '[data-workbench-models-fixture]'],
];

// Headless Chromium checks the real host composition and app-region CSS. Only
// the native Desktop can confirm movement of the system window.
export async function checkWindowDrag(page) {
  const root = page.locator('#root');
  const rail = page.locator('[data-workbench-rail]');
  const navigate = async (label, surface) => {
    await rail.getByRole('button', { name: label, exact: true }).click();
    await page.locator(surface).waitFor({ state: 'visible' });
  };
  const readRegion = () => root.evaluate(node => {
    // The pseudo-element precedes all host children, including their no-drag holes.
    const css = getComputedStyle(node, '::before');
    return {
      content: css.content,
      display: css.display,
      position: css.position,
      region: css.getPropertyValue('-webkit-app-region') || css.getPropertyValue('app-region'),
      pointerEvents: css.pointerEvents,
      top: css.top,
      left: css.left,
      right: css.right,
      height: css.blockSize,
      remainingWidth: document.documentElement.clientWidth - parseFloat(css.width),
    };
  });
  const disabled = async label => {
    const { content, display, region } = await readRegion();
    assert.ok(content === 'none' || content === 'normal' || display === 'none', `${label}: no Workbench drag box`);
    assert.notEqual(region, 'drag', `${label}: no Workbench drag style`);
  };
  const enabled = async label => {
    const { display, remainingWidth, ...actual } = await readRegion();
    assert.notEqual(display, 'none', `${label}: the drag surface is rendered`);
    assert.deepEqual(actual, {
      content: '""', position: 'fixed', region: 'drag', pointerEvents: 'none',
      top: '0px', left: '0px', right: '0px', height: '48px',
    }, `${label}: shared 48px drag surface should touch both window edges`);
    assert.ok(Math.abs(remainingWidth) < 1, `${label}: the box spans the viewport width (${remainingWidth}px remaining)`);
  };
  const noDrag = async (locator, label) => {
    assert.equal(await locator.evaluate(node => {
      const css = getComputedStyle(node);
      return css.getPropertyValue('-webkit-app-region') || css.getPropertyValue('app-region');
    }), 'no-drag', `${label}: native window dragging must not claim this control`);
  };

  for (const [name, label, surface] of endpoints) {
    await navigate(label, surface);
    await disabled(`Web ${name}`);
  }
  const viewport = page.viewportSize();
  const frame = page.locator('[data-slot="root"] > div');
  const reducedMotion = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => { document.documentElement.dataset.platform = 'darwin'; });
  try {
    for (const [name, label, surface] of endpoints) {
      await navigate(label, surface);
      await enabled(`macOS ${name}`);
    }
    const modelButton = page.locator(endpoints[3][2]).getByRole('button', { name: 'Fixture provider' });
    const buttonTop = () => modelButton.evaluate(node => node.getBoundingClientRect().top);
    assert.ok(await buttonTop() >= 48, 'Models control starts below the window band');
    await modelButton.evaluate(node => { node.parentElement.scrollTop += node.getBoundingClientRect().top - 12; });
    const scrolled = await modelButton.boundingBox();
    assert.ok(scrolled && scrolled.y >= 0 && scrolled.y + scrolled.height <= 48,
      `Models control scrolls inside the window band (${JSON.stringify(scrolled)})`);
    await noDrag(modelButton, 'scrolled Models control');
    await modelButton.click();
    assert.equal(await modelButton.getAttribute('aria-pressed'), 'true');
    await navigate('Workbench probe', '[data-workbench-probe]');
    await disabled('unrelated macOS panel');
    await navigate(endpoints[0][1], endpoints[0][2]);
    const closeSidebar = frame.locator('[data-slot="sidebar"] [data-sidebar-toggle]:visible');
    const openSidebar = frame.locator('[data-shell-leading]:visible [data-sidebar-opener]');
    const divider = frame.locator(':scope > [data-side="sidebar"]:visible');
    const left = () => divider.evaluate(node => node.getBoundingClientRect().x);
    const settleTracks = () => frame.and(page.locator('[data-animating]')).waitFor({ state: 'detached' });
    await settleTracks();
    const leftBefore = await left();
    await noDrag(closeSidebar, 'expanded sidebar toggle');
    await closeSidebar.click();
    await openSidebar.waitFor();
    await noDrag(frame.locator('[data-shell-leading]:visible'), 'collapsed sidebar controls');
    await enabled('collapsed Home sidebar');
    await openSidebar.click();
    await closeSidebar.waitFor();
    await settleTracks();
    assert.equal(await left(), leftBefore, 'reopening the sidebar restores its initial width');

    await noDrag(divider, 'sidebar divider');
    const width = (await divider.boundingBox()).width;
    const moveDivider = async (from, to) => {
      await page.mouse.move(from + width / 2, 24);
      await page.mouse.down();
      await page.mouse.move(to + width / 2, 24, { steps: 5 });
      await page.mouse.up();
    };
    await moveDivider(leftBefore, leftBefore + 20);
    assert.equal(await left(), leftBefore + 20, 'the divider still resizes from inside the drag band');
    await moveDivider(await left(), leftBefore);
    assert.equal(await left(), leftBefore, 'restoring the width moves the divider back');

    await frame.getByRole('button', { name: 'Search sessions', exact: true }).click();
    const modal = page.locator('dialog:modal').filter({ has: page.getByRole('searchbox', { name: 'Search sessions' }) });
    await modal.waitFor();
    await disabled('native modal dialog');
    await modal.getByRole('button', { name: 'Close', exact: true }).click();
    await modal.waitFor({ state: 'hidden' });
    await enabled('Home after closing the native modal');

    await page.evaluate(() => { document.documentElement.dataset.fullscreen = ''; });
    await disabled('fullscreen Home');
    await page.evaluate(() => { delete document.documentElement.dataset.fullscreen; });
    await enabled('restored Home');

    await page.setViewportSize({ width: 700, height: viewport.height });
    await rail.waitFor({ state: 'hidden' });
    const closed = frame.and(page.locator('[data-sidebar-drawer][data-sidebar-collapsed]'));
    const opened = frame.and(page.locator('[data-sidebar-drawer]:not([data-sidebar-collapsed])'));
    await closed.waitFor();
    await enabled('narrow Home with closed drawer');
    await closed.locator('[data-sidebar-opener]').click();
    await opened.waitFor();
    await disabled('narrow Home with open drawer');
    await opened.locator('[data-sidebar-mask]').click({ position: { x: 600, y: 24 } });
    await closed.waitFor();
    await enabled('narrow Home after clicking the top of the drawer mask');
    await closed.locator('[data-sidebar-opener]').click();
    await opened.locator('[data-sidebar-scrollport] > nav').getByRole('button', { name: 'Plugins', exact: true }).click();
    await page.locator('[data-plugin-panel]').waitFor();
    await closed.waitFor();
    await enabled('narrow Plugins with closed drawer');
    await closed.locator('[data-sidebar-opener]').click();
    await opened.locator('[data-workbench-home-fallback]').click();
    await page.locator(endpoints[0][2]).waitFor();
  } finally {
    await page.evaluate(() => {
      delete document.documentElement.dataset.fullscreen;
      delete document.documentElement.dataset.platform;
    });
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: reducedMotion ? 'reduce' : 'no-preference' });
  }
  await rail.waitFor();
  await disabled('Web after restoring ordinary platform');
  console.log('PASS Chromium window chrome: Home, Plugins, Scheduled and Models fixture share a 48px macOS drag band; native controls, divider, fullscreen, drawer and ordinary Web behavior are preserved.');
}
