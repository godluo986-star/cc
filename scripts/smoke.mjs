/**
 * 端到端冒烟测试(无头浏览器,软渲染 WebGL)。用法:
 *   npm run build && npm start            # 终端 1
 *   npm i --no-save playwright            # 一次性;不进入项目依赖
 *   node scripts/smoke.mjs                # 终端 2
 * 两名玩家进入世界:聊天互通 → 咖啡馆(麻将开局/象棋走子/旁观脱敏)→
 * 团子塔电梯 → 自己的房间 → 编辑器摆家具 → 电视放网页。任一检查失败则退出码非 0。
 * 可设 PW_CHROMIUM 指向系统 Chromium,BASE_URL 指向其他服务器。
 */
import { chromium } from 'playwright';
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8080';
const OUT = process.env.OUT_DIR ?? '.';
// 每次跑用全新账号:老账号会"回到上次所在的空间",而测试假设从广场出生点开始
const RUN = `${Date.now() % 1000000}`;
const errors = [];
let failures = 0;
const check = (label, ok) => { console.log(`${ok ? '✓' : '✗ FAIL'} ${label}`); if (!ok) failures++; };

async function apiToken(name) {
  const body = { username: name, password: 'password123' };
  let res = await fetch(`${BASE}/api/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) res = await fetch(`${BASE}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
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
  await page.evaluate((t) => {
    localStorage.setItem('np_token', t);
    // 软渲染跑功能冒烟:锁最低画质,否则 swiftshader 只有 ~1 FPS,走路都走不动
    localStorage.setItem('np_settings', JSON.stringify({
      quality: 'low', shadows: false, postfx: false, reflections: false, particles: false, clouds: false,
      masterVolume: 0, musicVolume: 0, sfxVolume: 0, voiceVolume: 0, mediaVolume: 0, invertY: false,
    }));
  }, token);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!document.querySelector('canvas') && !!window.__nx, undefined, { timeout: 40000, polling: 500 });
  await page.waitForTimeout(800);
  await page.keyboard.press('Escape'); // 关掉首次帮助
  await page.waitForTimeout(300);
  return page;
}

const state = (page) => page.evaluate(() => ({
  pos: [Math.round(window.__nx.hot.local.x * 10) / 10, Math.round(window.__nx.hot.local.z * 10) / 10],
  space: window.__nx.world.getState().spaceKey,
  prompt: document.querySelector('.prompt')?.textContent ?? null,
}));

/** 朝目标行走;卡住时自动侧移绕障。 */
async function walkTo(page, tx, tz, timeoutMs = 45000, stopAt = 1.0) {
  const start = Date.now();
  let lastD = Infinity, stall = 0, side = 'KeyA', swaps = 0;
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
    if (d < stopAt) break;
    if (lastD - d < 0.05) {
      if (++stall > 6) {
        await page.keyboard.down(side);
        await page.waitForTimeout(950);
        await page.keyboard.up(side);
        if (++swaps % 2 === 0) side = side === 'KeyA' ? 'KeyD' : 'KeyA';
        stall = 0;
      }
    } else stall = 0;
    lastD = d;
    await page.waitForTimeout(110);
  }
  await page.keyboard.up('KeyW');
  await page.keyboard.up('ShiftLeft');
  await page.waitForTimeout(300);
}

/** 提示词匹配后才按 E(必要时继续贴近)。 */
async function interactWhenPrompt(page, substr, tx, tz) {
  for (let i = 0; i < 6; i++) {
    const s = await state(page);
    if (s.prompt && s.prompt.includes(substr)) {
      await page.keyboard.press('KeyE');
      await page.waitForTimeout(1800);
      return true;
    }
    await walkTo(page, tx, tz, 5000, 0.55 + i * 0.1);
  }
  console.log('  没等到提示', substr, JSON.stringify(await state(page)));
  return false;
}

const browser = await chromium.launch({
  ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}),
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});

const p1 = await newPlayer(browser, `smoke_p1_${RUN}`);
check('WebGL 上下文', await p1.evaluate(() => {
  const c = document.querySelector('canvas');
  return !!(c?.getContext('webgl2') || c?.getContext('webgl'));
}));

const p2 = await newPlayer(browser, `smoke_p2_${RUN}`);
await p2.waitForTimeout(1200);
await p2.keyboard.press('Enter');
await p2.keyboard.type('团子二号来啦!');
await p2.keyboard.press('Enter');
await p2.waitForTimeout(1400);
check('跨端聊天同步', await p1.evaluate(() =>
  [...document.querySelectorAll('.chat-line')].some((el) => el.textContent?.includes('团子二号来啦'))
));
await p1.screenshot({ path: `${OUT}/smoke-plaza.png` });

// ── 两人进咖啡馆(沿门前铺装带正南直进,避免蹭到咖啡馆东北墙角)──
for (const p of [p1, p2]) {
  await walkTo(p, -12, 4);
  await walkTo(p, -20, -2);
  await walkTo(p, -26, -8);
  await walkTo(p, -30, -12.5, 20000);
  await walkTo(p, -29.9, -15.2, 15000);
  await interactWhenPrompt(p, '咖啡馆', -30, -15.5);
}
check('两人都进入咖啡馆', (await state(p1)).space === 'cafe' && (await state(p2)).space === 'cafe');

// ── 福州麻将:入座开局 ──
await walkTo(p1, 4.6, 4.6, 20000);
await p1.evaluate(() => window.__nx.ui.getState().openPanel({ kind: 'mahjong', tableId: 'cafe-mj' }));
await p1.waitForTimeout(500);
await p1.getByText('入座', { exact: true }).click();
await p1.waitForTimeout(600);
await p1.getByText('开局(空位由🤖陪打)').click();
await p1.waitForTimeout(1500);
const mj = await p1.evaluate(() => {
  const v = window.__nx.world.getState().mj['cafe-mj'];
  return { phase: v?.pub.phase, gold: v?.pub.goldFace, hand: v?.priv?.hand.length ?? 0 };
});
check(`麻将开局(${JSON.stringify(mj)})`, (mj.phase === 'playing' && mj.gold >= 0 && mj.hand >= 13) || mj.phase === 'finished');
await p1.screenshot({ path: `${OUT}/smoke-mahjong.png` });
await p1.keyboard.press('Escape');
const spec = await p2.evaluate(() => window.__nx.world.getState().mj['cafe-mj']?.priv ?? null);
check('麻将旁观只见公开信息', spec === null);
await p1.evaluate(() => window.__nx.connection.send('mj_action', { tableId: 'cafe-mj', action: 'leave' }));

// ── 象棋:两人入座 + 红兵进一 ──
await walkTo(p1, -3.0, 3.2, 20000);
await walkTo(p2, -2.6, 3.8, 20000);
for (const p of [p1, p2]) {
  await p.evaluate(() => window.__nx.ui.getState().openPanel({ kind: 'xiangqi', tableId: 'cafe-xq' }));
  await p.waitForTimeout(400);
}
await p1.getByText('入座对弈').click();
await p1.waitForTimeout(500);
await p2.getByText('入座对弈').click();
await p1.waitForTimeout(700);
await p1.evaluate(() => window.__nx.connection.send('xq_move', { tableId: 'cafe-xq', from: 27, to: 36 }));
await p1.waitForTimeout(800);
const xq = await p2.evaluate(() => {
  const g = window.__nx.world.getState().xq['cafe-xq'];
  return { turn: g?.turn, pawn: g?.board[36] };
});
check('象棋走子同步到对手', xq.pawn === 'P' && xq.turn === 1);
await p1.keyboard.press('Escape');
await p2.keyboard.press('Escape');
await p2.close();

// ── 回广场 → 团子塔 → 电梯 → 自己的房间 ──
await walkTo(p1, 0, 4.6, 20000);
await interactWhenPrompt(p1, '返回', 0, 5.0);
check('回到广场', (await state(p1)).space === 'plaza');
await walkTo(p1, -14, -8);
await walkTo(p1, -4, -22);
await walkTo(p1, 0, -31);
await walkTo(p1, 0, -35.5, 15000);
await interactWhenPrompt(p1, '团子塔', 0, -36.0);
check('进入大堂', (await state(p1)).space === 'lobby');
await walkTo(p1, 0, -4.2, 25000);
await interactWhenPrompt(p1, '电梯', 0, -4.6);
await p1.waitForTimeout(700);
await p1.locator('.inv-row', { hasText: '(我)' }).locator('button').click();
await p1.waitForTimeout(2500);
check('回到自己的房间', (await state(p1)).space.startsWith('room:'));
await p1.screenshot({ path: `${OUT}/smoke-room.png` });

// ── 房间编辑器摆一件家具 ──
await p1.click('.dock button[title="房间编辑器"]');
await p1.waitForTimeout(500);
await p1.getByText('🧰 家具目录').click();
await p1.waitForTimeout(400);
await p1.getByText('单人沙发').click();
await p1.waitForTimeout(400);
const before = await p1.evaluate(() => window.__nx.world.getState().room?.objects.length ?? -1);
await p1.mouse.move(640, 430);
await p1.waitForTimeout(300);
await p1.mouse.click(640, 430);
await p1.waitForTimeout(1200);
const after = await p1.evaluate(() => window.__nx.world.getState().room?.objects.length ?? -1);
check(`编辑器放置家具(${before} → ${after})`, after === before + 1);
await p1.keyboard.press('Escape');
await p1.click('.dock button[title="房间编辑器"]'); // 退出编辑模式

// ── 电视放网页 ──
await walkTo(p1, -0.2, 1.5, 25000);
await interactWhenPrompt(p1, '电视', -0.2, 1.7);
await p1.locator('input[placeholder^="https"]').fill('https://example.com');
await p1.getByText('放映', { exact: true }).click();
await p1.waitForTimeout(2500);
await p1.keyboard.press('Escape');
await p1.waitForTimeout(1500);
const iframes = await p1.evaluate(() => document.querySelectorAll('iframe').length);
check(`电视出现网页 iframe(${iframes})`, iframes >= 1);
await p1.screenshot({ path: `${OUT}/smoke-tv.png` });

console.log('CONSOLE ERRORS:', errors.length);
for (const e of errors.slice(0, 10)) console.log(' ', e.slice(0, 200));
console.log(failures === 0 ? '✅ 全部通过' : `❌ ${failures} 项失败`);
await browser.close();
process.exit(failures ? 1 : 0);
