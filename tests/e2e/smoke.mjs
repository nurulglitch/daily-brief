import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const require = createRequire(path.join(process.env.PLAYWRIGHT_DIR || '/tmp/db-e2e', 'package.json'));
const { chromium } = require('playwright-core');
const base = (process.env.BASE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
const output = process.env.OUTPUT_DIR || '/tmp/daily-brief-shots3';
const panelOutput = process.env.PANEL_OUTPUT_DIR;
const themes = ['broadsheet', 'brief', 'review', 'glance', 'yorker', 'duan', 'espresso', 'terminal', 'today', 'signal', 'paper', 'pure'];
const newThemes = ['brief', 'review', 'glance', 'yorker', 'duan'];
const oldThemes = ['espresso', 'broadsheet', 'terminal', 'today', 'signal', 'paper', 'pure'];
const priorNewThemes = ['espresso', 'broadsheet', 'terminal', 'today'];
const root = fileURLToPath(new URL('../../', import.meta.url));
const daily = JSON.parse(await readFile(path.join(root, 'site/mock/2026-11-19.json')));
const weekly = JSON.parse(await readFile(path.join(root, 'site/mock/2026-11-15.json')));
await mkdir(output, { recursive: true });
if (panelOutput) await mkdir(panelOutput, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
let failures = 0;
async function check(name, fn) {
  if (process.env.CHECKS && !process.env.CHECKS.split(',').includes(name.split(' ')[0])) return;
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures++;
    console.error(`FAIL ${name}: ${error.stack || error}`);
  }
}
async function context(options = {}) {
  return browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, ...options });
}
async function visit(page, query = '?mock=1', hash = '') {
  await page.goto(`${base}/${query}${hash}`);
  await page.locator('.masthead').waitFor();
}
async function mark(page, index) {
  const card = page.locator('.news-card').nth(index);
  await card.locator('.card-header').click();
  await card.getByRole('button', { name: '读完了', exact: true }).click();
}
async function setRead(page, ids) {
  await page.evaluate(ids => localStorage.setItem('brief:mock:read:2026-11-19', JSON.stringify(ids)), ids);
  await page.reload();
  await page.locator('.masthead').waitFor();
}

await check('1 daily layout, progress, console and overflow', async () => {
  const ctx = await context();
  try {
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await visit(page);
    assert.equal(await page.locator('.news-card').count(), 9);
    assert.equal(await page.locator('.news-section').count(), 5);
    assert.equal(await page.locator('.progress-count').textContent(), '0 / 9');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    for (const width of [360, 430]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `overflow at ${width}px`);
    }
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});
await check('2 accordion', async () => {
  const ctx = await context();
  try {
    const page = await ctx.newPage();
    await visit(page);
    await page.locator('.card-header').nth(0).click();
    assert.equal(await page.locator('.card-header').nth(0).getAttribute('aria-expanded'), 'true');
    await page.locator('.card-header').nth(1).click();
    assert.equal(await page.locator('.card-header').nth(0).getAttribute('aria-expanded'), 'false');
    assert.equal(await page.locator('.card-header').nth(1).getAttribute('aria-expanded'), 'true');
  } finally { await ctx.close(); }
});
await check('3 read, persist and resume', async () => {
  const ctx = await context();
  try {
    const page = await ctx.newPage();
    await visit(page);
    await mark(page, 0);
    assert.equal(await page.locator('.news-card').nth(0).getAttribute('class'), 'news-card is-read');
    assert.equal(await page.locator('.card-header').nth(0).getAttribute('aria-expanded'), 'false');
    assert.equal(await page.locator('.progress-count').textContent(), '1 / 9');
    await page.reload();
    await page.waitForFunction(() => document.querySelector('.progress-count')?.textContent === '1 / 9');
    await page.waitForTimeout(150);
    const top = await page.locator('.news-card:not(.is-read)').first().evaluate(node => node.getBoundingClientRect().top);
    assert.ok(top >= 0 && top < 45, `first unread top: ${top}`);
    assert.equal(await page.locator('.news-card.is-read').count(), 1);
  } finally { await ctx.close(); }
});
await check('4 all read end marker', async () => {
  const ctx = await context();
  try {
    const page = await ctx.newPage();
    await visit(page);
    for (let i = 0; i < 9; i++) await mark(page, i);
    assert.equal(await page.locator('.end-title').textContent(), '今日已读完');
    assert.equal(await page.locator('.progress-count').textContent(), '9 / 9');
  } finally { await ctx.close(); }
});
await check('5 egg variants reveal', async () => {
  const ctx = await context();
  try {
    const page = await ctx.newPage();
    for (const type of ['thread', 'flaw', 'hunch']) {
      await visit(page, `?mock=1&egg=${type}`);
      const egg = daily._mock.egg_variants.find(item => item.type === type);
      assert.equal(await page.locator('.egg-reveal').isVisible(), false);
      await page.locator('.egg-controls button').first().click();
      assert.equal(await page.locator('.egg-reveal').isVisible(), true);
      assert.equal(await page.locator('.egg-reveal').innerText(), egg.reveal);
    }
  } finally { await ctx.close(); }
});
await check('6 reflection clipboard', async () => {
  const ctx = await context({ permissions: ['clipboard-read', 'clipboard-write'] });
  try {
    const page = await ctx.newPage();
    await visit(page);
    await page.getByRole('button', { name: '复制' }).click();
    await page.getByRole('button', { name: '已复制' }).waitFor();
    assert.equal(await page.getByRole('button', { name: '已复制' }).count(), 1);
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), `今日一念（11月19日）：${daily.reflection}`);
  } finally { await ctx.close(); }
});
await check('7 settings persist and URL override', async () => {
  const ctx = await context();
  try {
    const page = await ctx.newPage();
    await visit(page);
    await page.locator('.settings-toggle').click();
    await page.locator('.older-themes > summary').click();
    await page.getByRole('button', { name: '素笺' }).click();
    assert.equal(await page.locator('.settings').evaluate(node => node.open), true);
    await page.getByRole('button', { name: '深色' }).click();
    await page.reload();
    await page.locator('.news-card').first().waitFor();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'pure');
    assert.equal(await page.locator('html').getAttribute('data-appearance'), 'dark');
    await visit(page, '?mock=1&theme=signal&appearance=dark');
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'signal');
    assert.equal(await page.locator('html').getAttribute('data-appearance'), 'dark');
  } finally { await ctx.close(); }
});
await check('8 weekly refs and original URLs', async () => {
  const ctx = await context();
  try {
    const page = await ctx.newPage();
    await visit(page, '?mock=1', '#/2026-11-15');
    assert.equal(await page.locator('.masthead-title').textContent(), '周日慢读');
    assert.equal(await page.locator('.refs a').count(), 0);
    assert.deepEqual(await page.locator('.original-link').evaluateAll(nodes => nodes.map(node => node.href)), weekly.longreads.map(item => item.url));
  } finally { await ctx.close(); }
});
await check('9 archive and navigation', async () => {
  const ctx = await context();
  try {
    const page = await ctx.newPage();
    await visit(page);
    await page.getByRole('link', { name: '往期' }).click();
    await page.locator('.archive-entry').first().waitFor();
    assert.equal(await page.locator('.archive-entry').count(), 2);
    await page.locator('.archive-entry').nth(1).click();
    await page.waitForURL(/#\/2026-11-15$/);
    await page.locator('.weekly-review').waitFor();
    assert.equal(await page.locator('.masthead-title').textContent(), '周日慢读');
  } finally { await ctx.close(); }
});
await check('10 service worker offline reload', async () => {
  const ctx = await context();
  try {
    const page = await ctx.newPage();
    await visit(page, '?mock=1&sw=1');
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
    });
    await page.reload();
    await page.locator('.news-card').first().waitFor();
    await ctx.setOffline(true);
    await page.reload();
    await page.locator('.news-card').first().waitFor();
    assert.equal(await page.locator('.news-card').count(), 9);
  } finally { await ctx.close(); }
});
await check('11 missing data falls back to mock', async () => {
  const ctx = await context();
  try {
    const page = await ctx.newPage();
    await visit(page, '');
    await page.locator('.news-card').first().waitFor();
    assert.match(await page.locator('.mock-banner').innerText(), /^示例数据/);
  } finally { await ctx.close(); }
});
await check('12 untrusted text is not HTML', async () => {
  const ctx = await context({ serviceWorkers: 'block' });
  try {
    const page = await ctx.newPage();
    const payload = '<img src=x onerror=window.__xss=1>';
    await page.route('**/mock/2026-11-19.json', route => {
      const data = structuredClone(daily);
      data.items[0].title = payload;
      data.items[0].takes[0].text = payload;
      data.items[0].deep = { minutes: payload, background: payload, facts: [payload], voices: [{ who: payload, says: payload }],
        analysis: payload, takes: [{ label: payload, text: payload }], drill: { kind: payload, question: payload, reveal: payload } };
      return route.fulfill({ json: data });
    });
    await visit(page);
    assert.equal(await page.locator('.card-title').first().textContent(), payload);
    await page.locator('.card-header').first().click();
    assert.equal(await page.locator('.take p').first().textContent(), payload);
    assert.equal(await page.locator('.deep-toggle').textContent(), '细读');
    await page.locator('.deep-toggle').click();
    await page.locator('.deep-reveal').click();
    for (const selector of ['.deep-background p', '.deep-fact-list li', '.deep-who', '.deep-voice p', '.deep-analysis p',
      '.deep-takes .take-label', '.deep-takes p', '.deep-question', '.deep-answer p']) {
      assert.equal(await page.locator(selector).textContent(), payload, selector);
    }
    assert.equal(await page.locator('.deep-drill .block-label').textContent(), `想一想 · ${payload}`);
    assert.equal(await page.locator('.news-card img').count(), 0);
    assert.equal(await page.evaluate(() => window.__xss), undefined);
  } finally { await ctx.close(); }
});
await check('13 keyboard and next unread after nonsequential read', async () => {
  const ctx = await context();
  try {
    const page = await ctx.newPage();
    await visit(page);
    await page.keyboard.press('j');
    assert.equal(await page.locator('.card-header').nth(0).evaluate(node => node === document.activeElement), true);
    await page.keyboard.press('j');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('.card-header').nth(1).getAttribute('aria-expanded'), 'true');
    await page.keyboard.press('x');
    assert.equal(await page.locator('.news-card').nth(1).evaluate(node => node.classList.contains('is-read')), true);
    const top = await page.locator('.news-card').nth(2).evaluate(node => node.getBoundingClientRect().top);
    assert.ok(top >= 0 && top < 45, `next unread top: ${top}`);
    await page.keyboard.press('x');
    assert.equal(await page.locator('.news-card.is-read').count(), 0);
  } finally { await ctx.close(); }
});
await check('14 optional fields and unsafe links', async () => {
  const ctx = await context({ serviceWorkers: 'block' });
  try {
    const page = await ctx.newPage();
    await page.route('**/mock/2026-11-19.json', route => {
      const data = structuredClone(daily);
      delete data.read_minutes;
      delete data.reflection;
      delete data.egg;
      delete data.items[0].takes;
      delete data.items[0].craft;
      data.items[0].sources[0].url = 'javascript:alert(1)';
      return route.fulfill({ json: data });
    });
    await visit(page);
    await page.locator('.card-header').first().click();
    assert.equal(await page.locator('.takes, .craft, .egg, .reflection').count(), 0);
    assert.equal(await page.locator('.sources a').count(), 2);
    assert.equal(await page.locator('.sources span').first().textContent(), daily.items[0].sources[0].name);
    assert.equal((await page.locator('body').innerText()).includes('undefined'), false);
  } finally { await ctx.close(); }
});
await check('15 invalid index fallback and unknown date', async () => {
  const ctx = await context({ serviceWorkers: 'block' });
  try {
    const page = await ctx.newPage();
    await page.route('**/data/index.json', route => route.fulfill({ json: { issues: [] } }));
    await visit(page, '');
    await page.locator('.news-card').first().waitFor();
    assert.match(await page.locator('.mock-banner').textContent(), /^示例数据/);
    await page.goto(`${base}/#/2000-01-01`);
    await page.getByText('没有这一期').waitFor();
    await page.getByRole('link', { name: '← 返回最新一期' }).click();
    await page.locator('.news-card').first().waitFor();
  } finally { await ctx.close(); }
});
await check('16 settings stays open, Escape and outside close', async () => {
  const ctx = await context();
  try {
    const page = await ctx.newPage();
    await visit(page);
    await page.locator('.settings-toggle').click();
    await page.locator('.older-themes > summary').click();
    await page.getByRole('button', { name: '讯号' }).click();
    assert.equal(await page.locator('.settings').evaluate(node => node.open), true);
    await page.getByRole('button', { name: '深色' }).click();
    assert.equal(await page.locator('.settings').evaluate(node => node.open), true);
    await page.getByRole('button', { name: '找漏洞' }).click();
    assert.equal(await page.locator('.settings').evaluate(node => node.open), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.settings').evaluate(node => node.open), false);
    await page.locator('.settings-toggle').click();
    await page.locator('.brand').click();
    assert.equal(await page.locator('.settings').evaluate(node => node.open), false);
  } finally { await ctx.close(); }
});
await check('17 egg reveal and selection survive rerender per variant', async () => {
  const ctx = await context();
  try {
    const page = await ctx.newPage();
    await visit(page, '?mock=1&egg=hunch');
    await page.locator('.egg-controls button').nth(1).click();
    await page.locator('.card-header').first().click();
    assert.equal(await page.locator('.egg-reveal').isVisible(), true);
    assert.equal(await page.locator('.egg-controls button').nth(1).getAttribute('aria-pressed'), 'true');
    await page.locator('.settings-toggle').click();
    await page.getByRole('button', { name: '暗线' }).click();
    assert.equal(await page.locator('.egg-reveal').isVisible(), false);
    await page.getByRole('button', { name: '直觉推演' }).click();
    assert.equal(await page.locator('.egg-reveal').isVisible(), true);
    assert.equal(await page.locator('.egg-controls button').nth(1).getAttribute('aria-pressed'), 'true');
  } finally { await ctx.close(); }
});
await check('18 missing review and longread publication date', async () => {
  const ctx = await context({ serviceWorkers: 'block' });
  try {
    const page = await ctx.newPage();
    let emptyReview = false;
    await page.route('**/mock/2026-11-15.json', route => {
      const data = structuredClone(weekly);
      delete data.review;
      if (emptyReview) data.review = { lede: '不要显示', threads: [], closing: '不要显示' };
      data.longreads[0].published = '2026-11-12';
      return route.fulfill({ json: data });
    });
    await visit(page, '?mock=1', '#/2026-11-15');
    assert.equal(await page.locator('.weekly-review').count(), 0);
    assert.equal(await page.getByText('本周复盘', { exact: true }).count(), 0);
    assert.match(await page.locator('.longread-meta').first().innerText(), /11月12日/);
    assert.match(await page.locator('.longread-meta').nth(1).innerText(), /2002/);
    emptyReview = true;
    await page.reload();
    await page.locator('.longread').first().waitFor();
    assert.equal(await page.locator('.weekly-review').count(), 0);
  } finally { await ctx.close(); }
});
await check('19 index cache policy and phone completion controls', async () => {
  const ctx = await context({ serviceWorkers: 'block' });
  try {
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      const original = window.fetch;
      window.__fetches = [];
      window.fetch = (url, options) => {
        window.__fetches.push({ url, cache: options?.cache || null });
        return original(url, options);
      };
    });
    await visit(page);
    const calls = await page.evaluate(() => window.__fetches);
    assert.equal(calls.find(call => call.url.endsWith('index.json')).cache, 'no-cache');
    assert.equal(calls.find(call => call.url.endsWith('2026-11-19.json')).cache, null);
    await page.locator('.card-header').first().click();
    const button = page.getByRole('button', { name: '读完了', exact: true });
    const dimensions = await button.evaluate(node => ({ height: node.getBoundingClientRect().height, width: node.getBoundingClientRect().width, parent: node.parentElement.getBoundingClientRect().width }));
    assert.ok(dimensions.height >= 46 && dimensions.width === dimensions.parent);
    assert.equal(await page.locator('.source-count').first().evaluate(node => getComputedStyle(node).whiteSpace), 'nowrap');
    await setRead(page, daily.items.map(item => item.id));
    assert.equal(await page.locator('.end-block.is-done').count(), 1);
    await visit(page, '?mock=1', '#/2026-11-15');
    assert.equal(await page.locator('.end-block.is-done').count(), 1);
  } finally { await ctx.close(); }
});
await check('20 egg keeps only its top rule in every theme', async () => {
  const ctx = await context();
  try {
    const page = await ctx.newPage();
    for (const theme of oldThemes) {
      for (const appearance of ['light', 'dark']) {
        await visit(page, `?mock=1&theme=${theme}&appearance=${appearance}`);
        const borders = await page.locator('.egg').evaluate(node => {
          const style = getComputedStyle(node);
          return [style.borderTopWidth, style.borderBottomWidth];
        });
        assert.deepEqual(borders, ['1px', '0px'], `${theme}/${appearance}`);
      }
    }
  } finally { await ctx.close(); }
});

await check('21 twelve themes render daily and weekly without errors or overflow', async () => {
  const ctx = await context({ serviceWorkers: 'block' });
  try {
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    for (const width of [360, 390, 430, 1440]) {
      await page.setViewportSize({ width, height: width <= 430 ? 844 : 900 });
      for (const theme of (process.env.THEME_FILTER ? process.env.THEME_FILTER.split(',') : themes)) {
        for (const appearance of ['light', 'dark']) {
          for (const weeklyView of [false, true]) {
            const query = `?mock=1&theme=${theme}&appearance=${appearance}`;
            await visit(page, query, weeklyView ? '#/2026-11-15' : '');
            assert.equal(await page.locator(weeklyView ? '.weekly-review' : '.news-card').count() > 0, true);
            assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true,
              `${theme}/${appearance}/${weeklyView ? 'weekly' : 'daily'} at ${width}px`);
          }
        }
      }
    }
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

await check('22 edition hooks, ordering and desktop grid', async () => {
  const ctx = await context({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  try {
    const page = await ctx.newPage();
    await visit(page, '?mock=1&theme=broadsheet&appearance=light');
    assert.deepEqual(await page.locator('.card-index').allTextContents(), ['01', '02', '03', '04', '05', '06', '07', '08', '09']);
    assert.deepEqual(await page.locator('.news-section').evaluateAll(nodes => nodes.map(node => node.dataset.section)), ['world', 'security', 'macro', 'tech', 'bio']);
    assert.deepEqual(await page.locator('.section-code').allTextContents(), ['WORLD', 'SECURITY', 'MACRO', 'TECH', 'BIO']);
    assert.equal(await page.locator('.masthead-long-date').textContent(), '2026年11月19日 星期四');
    assert.equal(await page.locator('.end-mark').count(), 1);
    const directory = page.locator('.front-page-index');
    assert.equal(await directory.isVisible(), true);
    assert.equal(await directory.locator('.front-page-row').count(), 5);
    const secondStory = await page.locator('.news-section').first().locator('.news-card').nth(1).boundingBox();
    const directoryBox = await directory.boundingBox();
    assert.ok(Math.abs(secondStory.y - directoryBox.y) < 1 && directoryBox.x > secondStory.x, 'front-page index fills the second column');
    const cards = page.locator('.news-section[data-section="macro"] .news-card');
    const left = await cards.nth(0).boundingBox(), right = await cards.nth(1).boundingBox();
    assert.ok(Math.abs(left.y - right.y) < 1 && left.x < right.x && left.width < 520, 'two-column front page');
    await cards.nth(1).locator('.card-header').click();
    const open = await page.locator('.news-card.is-open').boundingBox();
    assert.ok(open.width > 900, 'expanded card spans both columns');
    await page.locator('.settings-toggle').click();
    assert.deepEqual(await page.locator('.settings-row').first().locator('button').allTextContents(), ['大报 · 纽约时报', '简报 · 经济学人', '书评 · 伦敦书评', '要览 · Semafor', '周刊 · 纽约客', '端 · 端传媒']);
  } finally { await ctx.close(); }
});

await check('23 new theme contrast, settings and automatic appearance', async () => {
  const ctx = await context({ serviceWorkers: 'block' });
  try {
    const page = await ctx.newPage();
    for (const theme of priorNewThemes) {
      for (const appearance of ['light', 'dark']) {
        await visit(page, `?mock=1&theme=${theme}&appearance=${appearance}`);
        await page.locator('.settings-toggle').click();
        const panel = await page.locator('.settings-panel').boundingBox();
        assert.ok(panel.x >= 0 && panel.x + panel.width <= 390 && panel.y >= 0 && panel.y + panel.height <= 844, `${theme}/${appearance} settings bounds`);
        if (panelOutput) await page.screenshot({ path: path.join(panelOutput, `${theme}-${appearance}-settings.png`) });
        const ratios = await page.evaluate(() => {
          function rgb(value) {
            const probe = document.createElement('span');
            probe.style.color = value;
            document.body.append(probe);
            const normalized = getComputedStyle(probe).color;
            probe.remove();
            return normalized.match(/[\d.]+/g).slice(0, 3).map(Number);
          }
          function contrast(fg, bg) {
            const luminance = color => rgb(color).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
              .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
            const [a, b] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
            return (a + .05) / (b + .05);
          }
          const style = node => getComputedStyle(node);
          const bg = style(document.documentElement).backgroundColor;
          const panel = document.querySelector('.settings-panel');
          const result = { body: contrast(style(document.body).color, bg) };
          for (const button of panel.querySelectorAll('button')) {
            result[`settings ${button.textContent}`] = contrast(style(button).color, style(panel).backgroundColor);
          }
          document.querySelectorAll('.news-section').forEach(section => {
            const label = section.querySelector('.section-label');
            const card = section.querySelector('.news-card');
            const cardBg = style(card).backgroundColor === 'rgba(0, 0, 0, 0)' ? bg : style(card).backgroundColor;
            const labelBg = style(label).backgroundColor === 'rgba(0, 0, 0, 0)' ? bg : style(label).backgroundColor;
            result[`${section.dataset.section} section`] = contrast(style(label).color, labelBg);
            const overline = card.querySelector('.card-section');
            if (style(overline).display !== 'none') result[`${section.dataset.section} overline`] = contrast(style(overline).color, cardBg);
            const update = card.querySelector('.update-label');
            if (update) result[`${section.dataset.section} update`] = contrast(style(update).color, cardBg);
            const gist = card.querySelector('.card-gist');
            if (gist) result[`${section.dataset.section} gist`] = contrast(style(gist).color, cardBg);
          });
          return result;
        });
        for (const [label, ratio] of Object.entries(ratios)) {
          assert.ok(ratio >= 4.5, `${theme}/${appearance} ${label}: ${ratio.toFixed(2)}`);
        }
        await page.keyboard.press('Escape');
        for (const section of ['world', 'security', 'macro', 'tech', 'bio']) {
          await page.locator(`.news-section[data-section="${section}"] .card-header`).first().click();
          const expanded = await page.evaluate(() => {
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = 1;
            const context = canvas.getContext('2d');
            function rgba(color) {
              context.clearRect(0, 0, 1, 1);
              context.fillStyle = color;
              context.fillRect(0, 0, 1, 1);
              return [...context.getImageData(0, 0, 1, 1).data];
            }
            function background(node) {
              for (let current = node; current; current = current.parentElement) {
                const color = getComputedStyle(current).backgroundColor;
                if (rgba(color)[3]) return color;
              }
              return '#fff';
            }
            function luminance(color) {
              return rgba(color).slice(0, 3).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
                .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
            }
            return [...document.querySelectorAll('.news-card.is-open .block-label, .news-card.is-open .take-label, .news-card.is-open .craft summary, .news-card.is-open .read-button')]
              .map(node => {
                const [a, b] = [luminance(getComputedStyle(node).color), luminance(background(node))].sort((x, y) => y - x);
                return [node.textContent.trim(), (a + .05) / (b + .05)];
              });
          });
          for (const [label, ratio] of expanded) {
            assert.ok(ratio >= 4.5, `${theme}/${appearance}/${section} ${label}: ${ratio.toFixed(2)}`);
          }
        }
        await page.emulateMedia({ colorScheme: appearance });
        const expected = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());
        await visit(page, `?mock=1&theme=${theme}&appearance=auto`);
        assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()), expected,
          `${theme}/${appearance} auto appearance`);
      }
    }
  } finally { await ctx.close(); }
});

await check('24 unknown section labels remain literal and numbered', async () => {
  const ctx = await context({ serviceWorkers: 'block' });
  try {
    const page = await ctx.newPage();
    await page.route('**/mock/2026-11-19.json', route => {
      const data = structuredClone(daily);
      data.items[0].section = '<custom&section>';
      return route.fulfill({ json: data });
    });
    await visit(page, '?mock=1&theme=terminal&appearance=dark');
    const section = page.locator('.news-section').last();
    assert.equal(await section.getAttribute('data-section'), '<custom&section>');
    assert.equal(await section.locator('.section-code').textContent(), '<CUSTOM&SECTION>');
    assert.equal(await section.locator('.card-index').textContent(), '09');
    assert.equal(await section.locator('img, custom').count(), 0);
  } finally { await ctx.close(); }
});

await check('25 brief pager, read progress, keyboard, egg and resume', async () => {
  const ctx = await context({ serviceWorkers: 'block' });
  try {
    const page = await ctx.newPage();
    await visit(page, '?mock=1&theme=brief&appearance=light');
    assert.equal(await page.locator('.pager-title').textContent(), daily.items[0].title);
    assert.equal(await page.locator('.pager-position').textContent(), '1 / 9');
    await page.getByRole('button', { name: '下一条 →' }).click();
    assert.equal(await page.locator('.progress-count').textContent(), '1 / 9');
    assert.equal(await page.locator('.pager-title').textContent(), daily.items[1].title);
    await page.locator('.pager-next').click();
    assert.equal(await page.locator('.pager-title').textContent(), daily.items[2].title);
    assert.equal(await page.locator('.progress-count').textContent(), '1 / 9');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await page.locator('.pager-title').textContent(), daily.items[1].title);
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('.pager-title').textContent(), daily.items[2].title);
    await page.keyboard.press('k');
    assert.equal(await page.locator('.pager-title').textContent(), daily.items[1].title);
    await page.keyboard.press('j');
    await page.keyboard.press('x');
    assert.equal(await page.locator('.progress-count').textContent(), '2 / 9');
    await page.getByRole('button', { name: '标为未读' }).click();
    assert.equal(await page.locator('.progress-count').textContent(), '1 / 9');
    await page.reload();
    await page.locator('.pager-title').waitFor();
    assert.equal(await page.locator('.pager-title').textContent(), daily.items[1].title);
    for (let i = 1; i < daily.items.length; i++) await page.locator('.pager-next').click();
    assert.equal(await page.locator('.pager-position').textContent(), '彩蛋');
    assert.equal(await page.locator('.egg').isVisible(), true);
    await page.locator('.pager-prev').click();
    assert.equal(await page.getByRole('button', { name: '读完了 →' }).isVisible(), true);
    await page.getByRole('button', { name: '读完了 →' }).click();
    assert.equal(await page.locator('.pager-position').textContent(), '彩蛋');
    await page.locator('.pager-next').click();
    assert.equal(await page.locator('.pager-position').textContent(), '完');
    assert.equal(await page.locator('.end-title').textContent(), '还剩 7 条');
    await page.getByRole('button', { name: '跳转第一条未读' }).click();
    assert.equal(await page.locator('.pager-title').textContent(), daily.items[1].title);
    await setRead(page, daily.items.map(item => item.id));
    assert.equal(await page.locator('.pager-position').textContent(), '完');
    assert.equal(await page.locator('.end-title').textContent(), '今日已读完');
    await visit(page, '?mock=1&theme=brief', '#/2026-11-15');
    assert.equal(await page.locator('.pager-controls').count(), 0);
    assert.equal(await page.locator('.brief-bar-label').textContent(), '周日慢读');
    await page.evaluate(() => localStorage.removeItem('brief:mock:read:2026-11-19'));
    await page.route('**/mock/2026-11-19.json', route => {
      const data = structuredClone(daily);
      delete data.egg;
      data.items[0].title = '<img src=x onerror=window.__xss=1>';
      data.items[0].sources[0].url = 'javascript:alert(1)';
      return route.fulfill({ json: data });
    });
    await visit(page, '?mock=1&theme=brief');
    assert.equal(await page.locator('.pager-title').textContent(), '<img src=x onerror=window.__xss=1>');
    assert.equal(await page.locator('.news-card img').count(), 0);
    assert.equal(await page.evaluate(() => window.__xss), undefined);
    assert.equal(await page.locator('.sources a').count(), 2);
    for (let i = 0; i < daily.items.length; i++) await page.locator('.pager-next').click();
    assert.equal(await page.locator('.pager-position').textContent(), '完');
    assert.equal(await page.locator('.egg').count(), 0);
    assert.equal(await page.locator('.end-title').textContent(), '还剩 9 条');
  } finally { await ctx.close(); }
});

await check('26 glance directory opens cards and reflects read state', async () => {
  const ctx = await context({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  try {
    const page = await ctx.newPage();
    await visit(page, '?mock=1&theme=glance&appearance=light');
    assert.equal(await page.locator('.glance-list li').count(), 9);
    assert.equal(await page.locator('.glance-time').textContent(), '更新于 06:12');
    assert.match(await page.locator('.progress-count').evaluate(node => getComputedStyle(node, '::before').content), /· 已读/);
    await page.locator('.glance-jump').nth(5).click();
    assert.equal(await page.locator('.news-card.is-open').getAttribute('data-id'), daily.items[5].id);
    await page.locator('.news-card.is-open .read-button').click();
    assert.equal(await page.locator('.glance-list li').nth(5).getAttribute('class'), 'is-read');
    assert.equal(await page.locator('.glance-list li').nth(5).locator('strong').evaluate(node => getComputedStyle(node).textDecorationLine), 'none');
  } finally { await ctx.close(); }
});

await check('27 review article sidebar and contents band', async () => {
  const ctx = await context({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  try {
    const page = await ctx.newPage();
    await visit(page, '?mock=1&theme=review&appearance=light');
    const arrows = await page.locator('.news-section').first().locator('.card-chevron').all();
    const firstArrow = await arrows[0].boundingBox(), secondArrow = await arrows[1].boundingBox();
    assert.ok(Math.abs(firstArrow.y - secondArrow.y) < 1, 'arrows align at the bottom of their cells');
    const index = daily.items.findIndex(item => item.craft && item.takes?.length && item.sources?.length);
    await page.locator('.news-card').nth(index).locator('.card-header').click();
    const open = page.locator('.news-card.is-open');
    assert.equal(await open.locator('.review-sidebar .takes, .review-sidebar .craft, .review-sidebar .sources').count(), 3);
    assert.equal(await open.locator('.craft').evaluate(node => node.tagName), 'DIV');
    const prose = await open.locator('.review-prose').boundingBox(), sidebar = await open.locator('.review-columns > .review-sidebar').boundingBox();
    assert.ok(sidebar.x > prose.x + prose.width && Math.abs(sidebar.y - prose.y) < 2);
    assert.equal(await page.locator('.review-index-list button').count(), 9);
    await page.locator('.review-index-list button').nth(7).click();
    assert.equal(await page.locator('.news-card.is-open').getAttribute('data-id'), daily.items[7].id);
  } finally { await ctx.close(); }
});

await check('28 settings reference themes, old themes and default', async () => {
  const ctx = await context();
  try {
    const page = await ctx.newPage();
    await visit(page);
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'broadsheet');
    await page.locator('.settings-toggle').click();
    assert.equal(await page.locator('.settings-row').first().locator('.settings-label').textContent(), '参考报刊');
    assert.deepEqual(await page.locator('.settings-row').first().locator('button').allTextContents(), ['大报 · 纽约时报', '简报 · 经济学人', '书评 · 伦敦书评', '要览 · Semafor', '周刊 · 纽约客', '端 · 端传媒']);
    assert.equal(await page.locator('.older-themes').evaluate(node => node.open), false);
    await page.locator('.older-themes > summary').click();
    assert.deepEqual(await page.locator('.older-themes button').allTextContents(), ['红刊', '终端', '今日', '讯号', '纸刊', '素笺']);
    await page.getByRole('button', { name: '纸刊' }).click();
    assert.equal(await page.locator('.older-themes').evaluate(node => node.open), true);
  } finally { await ctx.close(); }
});

await check('29 five new themes contrast and automatic appearance', async () => {
  const ctx = await context({ serviceWorkers: 'block' });
  try {
    const page = await ctx.newPage();
    const violations = [];
    async function audit(theme, appearance, view) {
      const ratios = await page.evaluate(() => {
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 1;
          const context = canvas.getContext('2d');
          function rgba(color) {
            context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1);
            return [...context.getImageData(0, 0, 1, 1).data];
          }
          function background(node) {
            for (let current = node; current; current = current.parentElement) {
              const color = getComputedStyle(current).backgroundColor;
              if (rgba(color)[3] === 255) return color;
            }
            return '#fff';
          }
          function luminance(color) {
            return rgba(color).slice(0, 3).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
              .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
          }
          const selectors = ['.mock-banner', '.stale-note', '.duan-status', '.nav-link', '.settings-toggle', '.settings-label', '.settings-panel button',
            '.section-label', '.card-section', '.update-label', '.card-title', '.card-gist', '.card-byline', '.review-author',
            '.pager-section', '.pager-title', '.pager-lede', '.card-body p', '.block-label', '.take-label', '.craft summary',
            '.read-button', '.pager-primary', '.pager-back', '.pager-unmark', '.glance-jump', '.review-index-list button',
            '.egg p', '.egg-button', '.end-title', '.end-note', '.reflection p', '.copy-button',
            '.essay-title', '.weekly-review p', '.thread h2', '.longread p', '.longread-title', '.tags', '.original-link',
            '.archive-entry', '.back-link'];
          return [...document.querySelectorAll(selectors.join(','))].filter(node => node.getClientRects().length && !node.disabled).map(node => {
            const [a, b] = [luminance(getComputedStyle(node).color), luminance(background(node))].sort((x, y) => y - x);
            return [node.className || node.tagName, node.textContent.trim().slice(0, 20), (a + .05) / (b + .05)];
          });
      });
      for (const [label, text, ratio] of ratios) {
        if (ratio < 4.5) violations.push(`${theme}/${appearance}/${view} ${label} ${text}: ${ratio.toFixed(2)}`);
      }
    }
    for (const theme of newThemes) {
      for (const appearance of ['light', 'dark']) {
        const query = `?mock=1&theme=${theme}&appearance=${appearance}`;
        await visit(page, query);
        if (theme !== 'brief') {
          await page.locator('.card-header').first().click();
          await page.locator('.egg-controls button').first().click();
        }
        await page.locator('.settings-toggle').click();
        const panel = await page.locator('.settings-panel').boundingBox();
        assert.ok(panel.x >= 0 && panel.x + panel.width <= 390 && panel.y >= 0 && panel.y + panel.height <= 844, `${theme}/${appearance} settings bounds`);
        await audit(theme, appearance, 'daily');
        await page.keyboard.press('Escape');
        if (theme === 'brief') {
          for (let i = 0; i < daily.items.length; i++) await page.locator('.pager-next').click();
          await page.locator('.egg-controls button').first().click();
          await audit(theme, appearance, 'egg');
        }
        await setRead(page, daily.items.map(item => item.id));
        await audit(theme, appearance, 'end');
        await page.evaluate(() => localStorage.removeItem('brief:mock:read:2026-11-19'));
        await page.emulateMedia({ colorScheme: appearance });
        const expected = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());
        await visit(page, `?mock=1&theme=${theme}&appearance=auto`);
        assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()), expected);
        await visit(page, query, '#/2026-11-15');
        await audit(theme, appearance, 'weekly');
        await visit(page, query, '#/archive');
        await audit(theme, appearance, 'archive');
        await page.route('**/mock/2026-11-19.json', route => {
          const data = structuredClone(daily);
          data.mock = false;
          data.date = '2001-01-01';
          return route.fulfill({ json: data });
        });
        await visit(page, query);
        await page.locator('.stale-note').waitFor();
        await audit(theme, appearance, 'stale');
        await page.unroute('**/mock/2026-11-19.json');
      }
    }
    assert.deepEqual(violations, []);
  } finally { await ctx.close(); }
});

await check('30 duan section links and weekly status', async () => {
  const ctx = await context();
  try {
    const page = await ctx.newPage();
    await visit(page, '?mock=1&theme=duan&appearance=light');
    assert.equal(await page.locator('.duan-sections a').count(), 5);
    await page.locator('.duan-sections a').nth(3).click();
    assert.equal(await page.evaluate(() => location.hash), '');
    const top = await page.locator('#section-tech').evaluate(node => node.getBoundingClientRect().top);
    assert.ok(top >= 0 && top < 40, `tech section top: ${top}`);
    await visit(page, '?mock=1&theme=duan&appearance=light', '#/2026-11-15');
    const status = await page.locator('.duan-status').textContent();
    assert.equal(status.split('11月15日 周日').length - 1, 1);
  } finally { await ctx.close(); }
});

await check('31 review continuous grid fits and preserves issue order', async () => {
  const ctx = await context({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
  try {
    const page = await ctx.newPage();
    let items = [];
    await page.route('**/mock/2026-11-19.json', route => {
      const data = structuredClone(daily);
      data.items = items;
      return route.fulfill({ json: data });
    });
    const expectedSpans = {
      8: [2, 1, 1, 1, 1, 2, 2, 2],
      9: [2, 1, 1, 1, 1, 2, 2, 1, 1],
      10: [2, 1, 1, 1, 1, 2, 2, 1, 1, 4],
    };
    async function checkGrid(openIndex = -1, expected = null) {
      const layout = await page.locator('.review-grid').evaluate(grid => {
        const rect = node => {
          const r = node.getBoundingClientRect();
          return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width };
        };
        const borders = node => {
          const s = getComputedStyle(node);
          return [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth];
        };
        return {
          grid: rect(grid), gridBorders: borders(grid),
          cards: [...grid.querySelectorAll('.news-card')].map(node => ({
            ...rect(node), id: node.dataset.id, n: Number(node.dataset.n),
            span: Number(node.style.getPropertyValue('--review-span')),
            open: node.classList.contains('is-open'), borders: borders(node),
            section: node.querySelector('.review-author').textContent,
          })),
        };
      });
      assert.deepEqual(layout.gridBorders, ['1px', '0px', '0px', '1px']);
      assert.deepEqual(layout.cards.map(card => card.id), items.map(item => item.id));
      assert.deepEqual(layout.cards.map(card => card.n), items.map((_, index) => index + 1));
      if (expected) assert.deepEqual(layout.cards.map(card => card.span), expected);
      const column = (layout.grid.width - 1) / 4;
      let used = 0, rowTop = layout.grid.y + 1, rowBottom = null;
      for (const [index, card] of layout.cards.entries()) {
        assert.ok(card.section, `card ${index + 1} retains its section line`);
        assert.deepEqual(card.borders, ['0px', '1px', '1px', '0px']);
        assert.equal(card.open, index === openIndex);
        if (card.open) assert.equal(card.span, 4);
        assert.ok(Math.abs(card.x - (layout.grid.x + 1 + column * used)) < 1, `card ${index + 1} starts in reading order`);
        assert.ok(Math.abs(card.y - rowTop) < 1, `card ${index + 1} starts at row top`);
        assert.ok(Math.abs(card.width - column * card.span) < 1, `card ${index + 1} width`);
        if (rowBottom === null) rowBottom = card.bottom;
        else assert.ok(Math.abs(card.bottom - rowBottom) < 1, `card ${index + 1} shares row bottom`);
        used += card.span;
        assert.ok(used <= 4);
        if (used === 4) {
          assert.ok(Math.abs(card.right - layout.grid.right) < 1, `row ends at right edge`);
          rowTop = rowBottom; rowBottom = null; used = 0;
        }
      }
      assert.equal(used, 0, 'last row fills all four columns');
      assert.ok(Math.abs(rowTop - layout.grid.bottom) < 1, 'no gap at grid bottom');
      assert.equal(await page.locator('.review-grid .news-section > .section-label:visible').count(), 0);
    }
    for (const count of [8, 9, 10]) {
      items = structuredClone(daily.items.slice(0, count));
      if (count === 10) items.push({ ...structuredClone(daily.items[8]), id: 'extra-review-story' });
      await visit(page, '?mock=1&theme=review&appearance=light');
      await checkGrid(-1, expectedSpans[count]);
      for (let index = 0; index < count; index++) {
        await page.locator('.review-grid .card-header').nth(index).click();
        await checkGrid(index);
      }
    }
    items = [0, 2, 1, 3, 5, 4, 6, 8, 7].map(index => structuredClone(daily.items[index]));
    await visit(page, '?mock=1&theme=review&appearance=light');
    await checkGrid(-1, expectedSpans[9]);
    await page.locator('.review-grid .card-header').nth(2).click();
    await checkGrid(2);
    await page.setViewportSize({ width: 899, height: 900 });
    assert.ok(await page.locator('.review-grid .news-section > .section-label:visible').count() > 0);
    const mobile = await page.locator('.review-grid .news-card').evaluateAll(nodes => nodes.map(node => {
      const { x, y, width } = node.getBoundingClientRect();
      return { x, y, width };
    }));
    for (let i = 1; i < mobile.length; i++) {
      assert.ok(mobile[i].y > mobile[i - 1].y && Math.abs(mobile[i].x - mobile[0].x) < 1 && Math.abs(mobile[i].width - mobile[0].width) < 1);
    }
    await page.setViewportSize({ width: 900, height: 900 });
    await checkGrid(2);
  } finally { await ctx.close(); }
});

await check('32 deep toggle, session state, drill and optional fields', async () => {
  const ctx = await context({ serviceWorkers: 'block' });
  try {
    const page = await ctx.newPage();
    await visit(page, '?mock=1&theme=broadsheet&appearance=light');
    await page.locator('.card-header').first().click();
    assert.equal(await page.locator('.deep-toggle').textContent(), `细读 · 约 ${daily.items[0].deep.minutes} 分钟`);
    assert.equal(await page.locator('.deep-toggle').getAttribute('aria-expanded'), 'false');
    await page.locator('.deep-toggle').click();
    assert.equal(await page.locator('.deep-toggle').getAttribute('aria-expanded'), 'true');
    assert.deepEqual(await page.locator('.deep-content > * > .block-label').allTextContents(),
      ['来龙去脉', '事实与数字', '各方怎么说', '往深处想', '补充旁批', `想一想 · ${daily.items[0].deep.drill.kind}`]);
    assert.equal(await page.locator('.news-card.is-open').evaluate(node =>
      Boolean(node.querySelector('.deep-section').compareDocumentPosition(node.querySelector('.sources')) & Node.DOCUMENT_POSITION_FOLLOWING)), true);
    assert.equal(await page.locator('.progress-count').textContent(), '0 / 9');
    assert.equal(await page.locator('.deep-answer').isVisible(), false);
    await page.locator('.deep-reveal').click();
    assert.equal(await page.locator('.deep-answer').isVisible(), true);
    await page.locator('.card-header').first().click();
    await page.locator('.card-header').first().click();
    assert.equal(await page.locator('.deep-toggle').getAttribute('aria-expanded'), 'true');
    assert.equal(await page.locator('.deep-answer').isVisible(), true);
    await page.locator('.card-header').nth(1).click();
    assert.equal(await page.locator('.deep-toggle').getAttribute('aria-expanded'), 'false');
    await page.locator('.card-header').first().click();
    assert.equal(await page.locator('.deep-toggle').getAttribute('aria-expanded'), 'true');
    assert.equal(await page.locator('.deep-answer').isVisible(), true);
    await page.locator('.deep-toggle').click();
    assert.equal(await page.locator('.deep-content').count(), 0);
    await page.locator('.deep-toggle').click();
    assert.equal(await page.locator('.deep-answer').isVisible(), true);
    assert.equal(await page.locator('.progress-count').textContent(), '0 / 9');
    await page.reload();
    await page.locator('.card-header').first().click();
    assert.equal(await page.locator('.deep-toggle').getAttribute('aria-expanded'), 'false');
    await page.route('**/mock/2026-11-19.json', route => {
      const data = structuredClone(daily);
      delete data.items[0].deep;
      data.items[1].deep = { facts: [], voices: [{ who: '缺内容' }], drill: { question: '问题' } };
      return route.fulfill({ json: data });
    });
    await visit(page, '?mock=1&theme=broadsheet&appearance=light');
    await page.locator('.card-header').first().click();
    assert.equal(await page.locator('.deep-toggle').count(), 0);
    await page.locator('.card-header').nth(1).click();
    assert.equal(await page.locator('.deep-toggle').textContent(), '细读');
    await page.locator('.deep-toggle').click();
    assert.equal(await page.locator('.deep-facts, .deep-voices, .deep-reveal').count(), 0);
    assert.equal(await page.locator('.deep-drill .block-label').textContent(), '想一想');
    await visit(page, '?mock=1&theme=brief&appearance=light');
    assert.equal(await page.locator('.deep-toggle').count(), 0);
  } finally { await ctx.close(); }
});

await check('33 deep layout in all themes and appearances', async () => {
  const ctx = await context({ serviceWorkers: 'block' });
  try {
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.route('**/mock/2026-11-19.json', route => {
      const data = structuredClone(daily);
      data.items[0].deep.voices[0].who = 'LongUnbrokenLabel'.repeat(25);
      return route.fulfill({ json: data });
    });
    for (const width of [360, 390, 430, 1440]) {
      await page.setViewportSize({ width, height: width < 500 ? 844 : 1000 });
      for (const theme of themes) for (const appearance of ['light', 'dark']) {
        await visit(page, `?mock=1&theme=${theme}&appearance=${appearance}`);
        if (theme !== 'brief') await page.locator('.card-header').first().click();
        await page.locator('.deep-toggle').click();
        await page.locator('.deep-reveal').click();
        assert.equal(await page.locator('.progress-count').textContent(), '0 / 9', `${theme}/${appearance}/${width}`);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true,
          `${theme}/${appearance}/${width} overflow`);
      }
    }
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

await check('34 brief deep state survives pager navigation', async () => {
  const ctx = await context();
  try {
    const page = await ctx.newPage();
    await visit(page, '?mock=1&theme=brief&appearance=light');
    await page.locator('.deep-toggle').click();
    await page.locator('.deep-reveal').click();
    assert.equal(await page.locator('.pager-story').evaluate(node =>
      Boolean(node.querySelector('.deep-section').compareDocumentPosition(node.querySelector('.sources')) & Node.DOCUMENT_POSITION_FOLLOWING)), true);
    await page.locator('.pager-next').click();
    assert.equal(await page.locator('.deep-toggle').getAttribute('aria-expanded'), 'false');
    await page.locator('.pager-prev').click();
    assert.equal(await page.locator('.deep-toggle').getAttribute('aria-expanded'), 'true');
    assert.equal(await page.locator('.deep-answer').isVisible(), true);
    assert.equal(await page.locator('.progress-count').textContent(), '0 / 9');
  } finally { await ctx.close(); }
});

await check('35 deep text contrast across themes', async () => {
  const ctx = await context({ serviceWorkers: 'block' });
  try {
    const page = await ctx.newPage();
    const violations = [];
    for (const theme of themes) for (const appearance of ['light', 'dark']) {
      await visit(page, `?mock=1&theme=${theme}&appearance=${appearance}`);
      let pagerPosition = 0;
      for (const sectionName of ['world', 'security', 'macro', 'tech', 'bio']) {
      if (theme === 'brief') {
        const target = daily.items.findIndex(item => item.section === sectionName);
        while (pagerPosition < target) { await page.locator('.pager-next').click(); pagerPosition++; }
      } else await page.locator(`.news-card[data-section="${sectionName}"]`).first().locator('.card-header').click();
      await page.locator('.deep-toggle').click();
      await page.locator('.deep-reveal').click();
      const results = await page.locator('.deep-section').evaluate(section => {
        const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
        function rgba(color) {
          ctx.clearRect(0, 0, 1, 1);
          ctx.fillStyle = color;
          ctx.fillRect(0, 0, 1, 1);
          return [...ctx.getImageData(0, 0, 1, 1).data];
        }
        function background(node) {
          const layers = [];
          for (let current = node; current; current = current.parentElement) {
            const layer = rgba(getComputedStyle(current).backgroundColor);
            if (layer[3]) layers.push(layer);
          }
          return layers.reverse().reduce((base, layer) => layer.slice(0, 3).map((v, i) => v * layer[3] / 255 + base[i] * (1 - layer[3] / 255)), [255, 255, 255]);
        }
        function luminance(rgb) {
          return rgb.slice(0, 3).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
            .reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
        }
        return [...section.querySelectorAll('.deep-toggle, .block-label, .take-label, .deep-who, .deep-reveal, p, li')]
          .filter(node => node.getClientRects().length)
          .map(node => {
            const values = [luminance(rgba(getComputedStyle(node).color)), luminance(background(node))].sort((a, b) => b - a);
            return [node.className, node.textContent.trim().slice(0, 15), (values[0] + .05) / (values[1] + .05)];
          });
      });
      for (const [cls, text, ratio] of results) if (ratio < 4.5) violations.push(`${theme}/${appearance}/${sectionName} ${cls} ${text}: ${ratio.toFixed(2)}`);
      }
    }
    assert.deepEqual(violations, []);
  } finally { await ctx.close(); }
});

await check('deep-screenshots: requested views', async () => {
  const deepOutput = process.env.DEEP_OUTPUT_DIR || '/tmp/daily-brief-shots4';
  await mkdir(deepOutput, { recursive: true });
  for (const [theme, appearance, views] of [
    ...['broadsheet', 'brief', 'review', 'glance', 'yorker', 'duan'].map(theme => [theme, 'light', ['desk', 'phone']]),
    ['broadsheet', 'dark', ['desk']], ['signal', 'light', ['phone']],
  ]) for (const view of views) {
    if (process.env.DEEP_SCREENSHOT_THEMES && !process.env.DEEP_SCREENSHOT_THEMES.split(',').includes(theme)) continue;
    const ctx = await context(view === 'desk' ? { viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 } : {});
    try {
      const page = await ctx.newPage();
      await visit(page, `?mock=1&theme=${theme}&appearance=${appearance}`);
      if (theme === 'brief') {
        for (let index = 0; index < 7; index++) await page.locator('.pager-next').click();
      } else await page.locator('.news-card[data-section="bio"]').first().locator('.card-header').click();
      await page.locator('.deep-toggle').click();
      if (view === 'desk') {
        await page.locator('.deep-section').evaluate(node => window.scrollTo(0, window.scrollY + node.getBoundingClientRect().top - 25));
      } else {
        await page.locator('.deep-reveal').click();
        await page.locator('.deep-voices').evaluate(node => window.scrollTo(0, window.scrollY + node.getBoundingClientRect().top - 20));
        await page.screenshot({ path: path.join(deepOutput, `${theme}-${appearance}-phone-voices.png`) });
        await page.locator('.deep-drill').evaluate(node => {
          const drillBottom = window.scrollY + node.getBoundingClientRect().bottom;
          window.scrollTo(0, Math.max(0, drillBottom - innerHeight + 20));
        });
      }
      await page.screenshot({ path: path.join(deepOutput, `${theme}-${appearance}-${view}-deep.png`) });
    } finally { await ctx.close(); }
  }
});

await check('screenshots: theme, appearance and view matrix', async () => {
  const views = process.env.SCREENSHOT_VIEWS?.split(',');
  const wants = view => !views || views.includes(view);
  for (const theme of (process.env.SCREENSHOT_THEMES ? process.env.SCREENSHOT_THEMES.split(',') : newThemes)) {
    for (const appearance of ['light', 'dark']) {
      const query = `?mock=1&theme=${theme}&appearance=${appearance}`;
      if (['phone-top', 'phone-open', 'phone-end'].some(wants)) {
      const phone = await context();
      try {
        const page = await phone.newPage();
        await visit(page, query);
        if (wants('phone-top')) await page.screenshot({ path: path.join(output, `${theme}-${appearance}-phone-top.png`) });
        if (appearance === 'light' && (wants('phone-open') || wants('phone-end'))) {
          await setRead(page, daily.items.slice(0, 2).map(item => item.id));
          if (theme === 'brief') {
            for (let i = 2; i < 7; i++) await page.locator('.pager-next').click();
          } else await page.locator('.news-card[data-section="bio"]').first().locator('.card-header').click();
          await page.locator('.news-card.is-open .takes').evaluate(node => window.scrollTo(0, window.scrollY + node.getBoundingClientRect().top - 180));
          if (wants('phone-open')) await page.screenshot({ path: path.join(output, `${theme}-${appearance}-phone-open.png`) });
          if (wants('phone-end')) {
            await setRead(page, daily.items.map(item => item.id));
            await page.locator('.end-block').scrollIntoViewIfNeeded();
            await page.screenshot({ path: path.join(output, `${theme}-${appearance}-phone-end.png`) });
          }
        }
      } finally { await phone.close(); }
      }
      if (['desk-top', 'desk-open', 'desk-weekly-top'].some(wants)) {
      const desktop = await context({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
      try {
        const page = await desktop.newPage();
        await visit(page, query);
        if (wants('desk-top')) await page.screenshot({ path: path.join(output, `${theme}-${appearance}-desk-top.png`) });
        if (appearance === 'light' && wants('desk-open')) {
          if (theme === 'brief') {
            for (let i = 0; i < 5; i++) await page.locator('.pager-next').click();
          } else {
            const tech = page.locator('.news-card[data-section="tech"]').first();
            await tech.locator('.card-header').click();
            await page.locator('.news-card.is-open').evaluate(node => window.scrollTo(0, window.scrollY + node.getBoundingClientRect().top - 80));
          }
          await page.screenshot({ path: path.join(output, `${theme}-${appearance}-desk-open.png`) });
        }
        if (appearance === 'light' && wants('desk-weekly-top')) {
          await visit(page, query, '#/2026-11-15');
          await page.locator('.weekly-review').waitFor();
          await page.screenshot({ path: path.join(output, `${theme}-${appearance}-desk-weekly-top.png`) });
        }
      } finally { await desktop.close(); }
      }
    }
  }
  if (!process.env.SKIP_BASELINES) {
  const ctx = await context({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  try {
    const page = await ctx.newPage();
    await visit(page, '?mock=1&theme=broadsheet&appearance=light');
    await page.screenshot({ path: path.join(output, 'broadsheet-light-desk-top.png') });
    await page.locator('.settings-toggle').click();
    await page.screenshot({ path: path.join(output, 'settings.png') });
  } finally { await ctx.close(); }
  }
});
await browser.close();
if (failures) process.exitCode = 1;
