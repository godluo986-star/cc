/**
 * Full vertical-slice smoke test. Usage:
 *   npm run build && npm start          (in one terminal)
 *   npm i --no-save playwright          (once; not a project dependency)
 *   node scripts/smoke.mjs              (in another terminal)
 * Two guests join, chat, tour café → lobby → elevator → personal room, and
 * place furniture with the editor. Exits non-zero if any check fails.
 */
/* Full vertical-slice smoke test: two players, chat, café, NPC dialogue,
 *  tower lobby, elevator, personal room, room editor. Screenshots each stop. */
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:8080';
const OUT = process.env.OUT_DIR ?? '.';
const errors = [];
let failures = 0;
const check = (label, ok) => {
  console.log(`${ok ? '✓' : '✗ FAIL'} ${label}`);
  if (!ok) failures++;
};

/** Get a token for a fixed test account (register once, then login). */
async function apiToken(name) {
  const body = { username: name, password: 'password123' };
  let res = await fetch(`${BASE}/api/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) {
    res = await fetch(`${BASE}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  }
  if (!res.ok) throw new Error(`auth failed for ${name}: ${res.status}`);
  return (await res.json()).token;
}

async function newPlayer(browser, name) {
  const token = await apiToken(name);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${name}] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[${name}] PAGEERROR ${e.message}`));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate((t) => localStorage.setItem('np_token', t), token);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!document.querySelector('canvas') && !!window.__nx, undefined, { timeout: 40000, polling: 500 });
  await page.waitForTimeout(800);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  return page;
}


const state = (page) => page.evaluate(() => ({
  pos: [Math.round(window.__nx.hot.local.x * 10) / 10, Math.round(window.__nx.hot.local.z * 10) / 10],
  space: window.__nx.world.getState().spaceKey,
  prompt: document.querySelector('.prompt')?.textContent ?? null,
}));

async function walkTo(page, tx, tz, timeoutMs = 45000) {
  const start = Date.now();
  await page.keyboard.down('KeyW');
  await page.keyboard.down('ShiftLeft');
  while (Date.now() - start < timeoutMs) {
    const d = await page.evaluate(([x, z]) => {
      const nx = window.__nx;
      const dx = x - nx.hot.local.x;
      const dz = z - nx.hot.local.z;
      nx.hot.camera.yaw = Math.atan2(-dx, -dz);
      return Math.hypot(dx, dz);
    }, [tx, tz]);
    if (d < 1.3) break;
    await page.waitForTimeout(110);
  }
  await page.keyboard.up('KeyW');
  await page.keyboard.up('ShiftLeft');
  await page.waitForTimeout(350);
}


/** Press E only when the interaction prompt matches; nudges closer if needed. */
async function interactWhenPrompt(page, substr, tx, tz) {
  for (let i = 0; i < 6; i++) {
    const s = await state(page);
    if (s.prompt && s.prompt.includes(substr)) {
      await page.keyboard.press('KeyE');
      await page.waitForTimeout(2000);
      return true;
    }
    await walkTo(page, tx, tz, 5000);
  }
  console.log('  never saw prompt', substr, JSON.stringify(await state(page)));
  return false;
}

const browser = await chromium.launch({
  // Set PW_CHROMIUM to reuse a system Chromium instead of Playwright's download
  ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}),
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});

const p1 = await newPlayer(browser, 'smokeS_p1');
await p1.waitForTimeout(2000);
check('webgl context', await p1.evaluate(() => {
  const c = document.querySelector('canvas');
  return !!(c?.getContext('webgl2') || c?.getContext('webgl'));
}));

const p2 = await newPlayer(browser, 'smokeS_p2');
await p2.waitForTimeout(1500);
await p2.keyboard.press('Enter');
await p2.keyboard.type('hello from dango two!');
await p2.keyboard.press('Enter');
await p2.waitForTimeout(1400);
check('cross-client chat', await p1.evaluate(() =>
  [...document.querySelectorAll('.chat-line')].some((el) => el.textContent?.includes('hello from dango two'))
));
await p1.screenshot({ path: `${OUT}/smoke-plaza.png` });
await p2.close();

// café
await walkTo(p1, -14, 8);
await walkTo(p1, -26, -8);
await walkTo(p1, -29.8, -15.4, 12000);
await interactWhenPrompt(p1, 'Café', -30, -15.6);
check('entered café', (await state(p1)).space === 'cafe');
await p1.screenshot({ path: `${OUT}/smoke-cafe.png` });

// barista dialogue
await walkTo(p1, -0.5, -3.2, 20000);
await p1.keyboard.press('KeyE');
await p1.waitForTimeout(900);
const dlg = await p1.evaluate(() => document.querySelector('.dialogue')?.textContent ?? '');
check('barista dialogue', dlg.includes('Daily Grind'));
await p1.screenshot({ path: `${OUT}/smoke-barista.png` });
await p1.keyboard.press('Escape');
await p1.waitForTimeout(300);

// exit café → tower → lobby
await walkTo(p1, 0, 4.6, 20000);
await interactWhenPrompt(p1, 'Exit', 0, 5.0);
check('back in plaza', (await state(p1)).space === 'plaza');
await walkTo(p1, -14, -8);
await walkTo(p1, -4, -22);
await walkTo(p1, 0, -31);
await walkTo(p1, 0, -35.5, 15000);
await interactWhenPrompt(p1, 'Tower', 0, -36.0);
check('entered lobby', (await state(p1)).space === 'lobby');
await p1.screenshot({ path: `${OUT}/smoke-lobby.png` });

// elevator → own room
await walkTo(p1, 0, -4.2, 20000);
await interactWhenPrompt(p1, 'Elevator', 0, -4.6);
await p1.waitForTimeout(600);
const rooms = await p1.locator('.inv-row').count();
check('elevator lists rooms', rooms > 0);
await p1.screenshot({ path: `${OUT}/smoke-elevator.png` });
await p1.locator('.inv-row', { hasText: '(you)' }).locator('button').click();
await p1.waitForTimeout(2500);
const roomState = await state(p1);
check('inside own room', roomState.space.startsWith('room:'));
await p1.screenshot({ path: `${OUT}/smoke-room.png` });

// room editor: place an armchair
await p1.click('.dock button[title="Room editor"]');
await p1.waitForTimeout(500);
await p1.getByText('🧰 Catalog').click();
await p1.waitForTimeout(400);
await p1.getByText('Armchair').click();
await p1.waitForTimeout(400);
const before = await p1.evaluate(() => window.__nx.world.getState().room?.objects.length ?? -1);
await p1.mouse.move(640, 420);
await p1.waitForTimeout(300);
await p1.mouse.click(640, 420);
await p1.waitForTimeout(1200);
const after = await p1.evaluate(() => window.__nx.world.getState().room?.objects.length ?? -1);
check(`editor placed furniture (${before} → ${after})`, after === before + 1);
await p1.screenshot({ path: `${OUT}/smoke-editor.png` });

console.log('CONSOLE ERRORS:', errors.length);
for (const e of errors.slice(0, 10)) console.log(' ', e.slice(0, 200));
console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECKS FAILED`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
