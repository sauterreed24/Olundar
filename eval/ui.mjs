#!/usr/bin/env node
// Scripted menu playthrough in a real browser: New, Save, Load, End Turn, restart.
// Needs Chromium + Playwright (preinstalled in the cloud container). Starts its own
// static server on a free port.
//
//   node eval/ui.mjs            # exits non-zero if any step fails
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.log('SKIP ui: playwright is not installed here. Run on a machine with Playwright + Chromium.');
  process.exit(0);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp' };
const server = createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = path.join(root, url === '/' ? 'index.html' : url);
  if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream' });
  createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(0, resolve));
const base = `http://localhost:${server.address().port}/`;

const results = [];
const step = async (name, fn) => {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, why: error.message.split('\n')[0] });
  }
};
const assert = (cond, why) => {
  if (!cond) throw new Error(why);
};

// The element a real pointer would hit at the centre of `selector`.
async function hittable(page, selector) {
  return page.$eval(selector, (el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return Boolean(hit && (hit === el || el.contains(hit)));
  });
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(base, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

await step('board renders with the turn label', async () => {
  assert((await page.textContent('#turnLabel')).includes('Turn 1'), 'Turn label should read Turn 1.');
});

await step('New campaign dialog sits above the board and its buttons can be clicked', async () => {
  await page.click('#newTop');
  await page.waitForSelector('#modal:not([hidden])');
  const buttons = await page.$$('#modal button');
  assert(buttons.length > 0, 'The dialog should offer buttons.');
  assert(await hittable(page, '#modal button'), 'A pointer at the dialog button hits something else (the board is drawn over the dialog).');
});

await step('Starting a new campaign from the dialog works by pointer', async () => {
  const start = await page.$('#modal button.primary, #modal button[data-cmd="start"], #modal button:has-text("Begin"), #modal button:has-text("Start")');
  assert(start, 'The New dialog should have a start button.');
  await start.click({ timeout: 3000 });
  await page.waitForTimeout(600);
  assert(await page.$eval('#modal', (el) => el.hidden), 'The dialog should close after starting.');
});

await step('End turn advances the turn (twice, confirming idle units)', async () => {
  await page.keyboard.press('e');
  await page.keyboard.press('e');
  await page.waitForTimeout(1500);
  assert((await page.textContent('#turnLabel')).includes('Turn 2'), `Expected Turn 2, saw ${await page.textContent('#turnLabel')}.`);
});

await step('Save then Load restores the campaign by pointer', async () => {
  await page.click('#saveTop');
  await page.waitForTimeout(400);
  const modalOpen = await page.$eval('#modal', (el) => !el.hidden);
  if (modalOpen) {
    const confirm = await page.$('#modal button.primary, #modal button:has-text("Save")');
    if (confirm) await confirm.click({ timeout: 3000 });
    await page.waitForTimeout(300);
  }
  await page.keyboard.press('e');
  await page.keyboard.press('e');
  await page.waitForTimeout(1500);
  await page.click('#loadTop');
  await page.waitForSelector('#modal:not([hidden])');
  const slot = await page.$('#modal button[data-slot]');
  assert(slot, 'The Load dialog should list the saved slot.');
  await slot.click({ timeout: 3000 });
  await page.waitForTimeout(800);
  assert((await page.textContent('#turnLabel')).includes('Turn 2'), `Loading should restore Turn 2, saw ${await page.textContent('#turnLabel')}.`);
});

await step('No page errors', async () => {
  assert(!errors.length, errors.join(' | '));
});

await browser.close();
server.close();
let failed = 0;
for (const r of results) {
  if (!r.ok) failed += 1;
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `\n      ${r.why}`}`);
}
console.log(failed ? `${failed} UI step(s) failed.` : 'All UI steps passed.');
process.exit(failed ? 1 : 0);
