/**
 * 影院媒体同步自动化验证(设计文档 §9.1)。用法:
 *   npm run build && npm start            # 终端 1
 *   npm i --no-save playwright            # 一次性;不进入项目依赖
 *   node scripts/sync-test.mjs            # 终端 2
 * 两名玩家走进电影院;p1 对银幕放一个(故意打不开的)直链视频并
 * seek → 暂停 → 1.5 倍速。播放器本身会报"放不出来",但服务器只存
 * {url,kind,playing,position,rate,updatedAt},同步状态照常流动。断言:
 *   1) 两端 world.getState().media 完全一致;
 *   2) 两端按服务器时钟外推的播放位置(mediaPositionAt,shared/src/media.ts)
 *      偏差 < 0.5s;
 *   3) 暂停后两端冻结在同一位置;
 *   4) 1.5 倍速播放时两端推进速率一致(隔 3s 采样两次)。
 * 任一检查失败退出码非 0。可设 PW_CHROMIUM / BASE_URL,同 smoke.mjs。
 */
import { chromium } from 'playwright';
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8080';
// 每次跑用全新账号:老账号会"回到上次所在的空间",而测试假设从广场出生点开始
const RUN = `${Date.now() % 1000000}`;
const errors = [];
let failures = 0;
const check = (label, ok) => { console.log(`${ok ? '✓' : '✗ FAIL'} ${label}`); if (!ok) failures++; };

// 与 shared/src/media.ts 的 mediaPositionAt 同一公式(其数学由 vitest 单测
// shared/test/media.test.ts 覆盖;本脚本用它把两端采样换算成
// "服务器时钟下的应播位置"再互相对比,验证的是整条同步链路)。
const mediaPositionAt = (m, nowMs) => {
  if (!m || !m.url) return 0;
  return m.playing ? m.position + ((nowMs - m.updatedAt) / 1000) * m.rate : m.position;
};

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
    // 软渲染跑功能验证:锁最低画质(同 smoke.mjs)
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

/** 朝目标行走;卡住时自动侧移绕障(同 smoke.mjs)。 */
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

/** 提示词匹配后才按 E(必要时继续贴近,同 smoke.mjs)。 */
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

const p1 = await newPlayer(browser, `sync_p1_${RUN}`);
const p2 = await newPlayer(browser, `sync_p2_${RUN}`);

/** 同一瞬间在两个页面各采一份 {media, serverTimeOffset, 本地 now}。 */
const sample = (page) => page.evaluate(() => ({
  media: window.__nx.world.getState().media,
  offset: window.__nx.connection.serverTimeOffset,
  now: Date.now(),
}));
const sampleBoth = () => Promise.all([sample(p1), sample(p2)]);
const posOf = (s) => mediaPositionAt(s.media, s.now + s.offset);
const mediaKey = (m) => JSON.stringify(m && ['url', 'kind', 'playing', 'position', 'rate', 'loop', 'updatedAt', 'setBy'].map((k) => m[k]));
const send = (t, d) => p1.evaluate(([tt, dd]) => window.__nx.connection.send(tt, dd), [t, d]);

// ── 两人从广场出生点走进电影院(东路直达,咖啡馆路径的东侧镜像)──
for (const p of [p1, p2]) {
  await walkTo(p, 3, 7);        // 绕开出生点旁的长椅/留言板/路灯
  await walkTo(p, 12, 4);
  await walkTo(p, 20, -2);
  await walkTo(p, 26, -8);
  await walkTo(p, 30, -12.5, 20000);
  await walkTo(p, 29.9, -16.2, 15000);
  await interactWhenPrompt(p, '电影院', 30, -16.5);
}
check('两人都进入电影院', (await state(p1)).space === 'cinema' && (await state(p2)).space === 'cinema');

// ── p1 放一个假直链视频(播放器会报错,同步状态照常流动)并 seek 到 300s ──
await send('media_set', { url: 'https://sync-test.invalid/clip.mp4' });
await p1.waitForTimeout(1200);
await send('media_ctrl', { op: 'seek', value: 300 });
await p1.waitForTimeout(1200);

let [a, b] = await sampleBoth();
check(`两端 media 状态一致(kind=${a.media?.kind})`, !!a.media?.url && a.media.kind === 'video' && mediaKey(a.media) === mediaKey(b.media));
check('服务器权威 position 已 seek 到 300', a.media?.position === 300 && a.media?.playing === true);
{
  const pa = posOf(a), pb = posOf(b);
  check(`两端外推位置偏差 < 0.5s(p1=${pa.toFixed(3)} p2=${pb.toFixed(3)})`, Math.abs(pa - pb) < 0.5);
  check('外推位置落在 seek 点之后的合理区间', pa >= 299.5 && pa < 330 && pb >= 299.5 && pb < 330);
}

// ── p1 暂停 → 两端冻结在同一位置 ──
await send('media_ctrl', { op: 'pause' });
await p1.waitForTimeout(1000);
[a, b] = await sampleBoth();
const frozenA = posOf(a), frozenB = posOf(b);
check(`暂停后两端位置相同(p1=${frozenA.toFixed(3)} p2=${frozenB.toFixed(3)})`, a.media?.playing === false && b.media?.playing === false && Math.abs(frozenA - frozenB) < 0.001);
await p1.waitForTimeout(1500);
[a, b] = await sampleBoth();
check('暂停 1.5s 后位置不动', Math.abs(posOf(a) - frozenA) < 0.001 && Math.abs(posOf(b) - frozenB) < 0.001);

// ── p1 1.5 倍速并继续播放 → 两端推进速率一致(隔 3s 采样两次)──
await send('media_ctrl', { op: 'rate', value: 1.5 });
await p1.waitForTimeout(400);
await send('media_ctrl', { op: 'play' });
await p1.waitForTimeout(1000);
const [ra0, rb0] = await sampleBoth();
await p1.waitForTimeout(3000);
const [ra1, rb1] = await sampleBoth();
check('两端都在以 rate=1.5 播放', ra1.media?.playing === true && ra1.media?.rate === 1.5 && rb1.media?.rate === 1.5);
{
  const rateOf = (s0, s1) => (posOf(s1) - posOf(s0)) / ((s1.now - s0.now) / 1000);
  const va = rateOf(ra0, ra1), vb = rateOf(rb0, rb1);
  check(`两端推进速率一致且 ≈1.5(p1=${va.toFixed(3)}x p2=${vb.toFixed(3)}x)`, Math.abs(va - 1.5) < 0.05 && Math.abs(vb - 1.5) < 0.05 && Math.abs(va - vb) < 0.05);
  const pa = posOf(ra1), pb = posOf(rb1);
  check(`倍速播放中两端偏差仍 < 0.5s(p1=${pa.toFixed(3)} p2=${pb.toFixed(3)})`, Math.abs(pa - pb) < 0.5);
}

// ── 清屏还原(影院是持久化的公共空间,别把假链接留给真玩家)──
await send('media_ctrl', { op: 'clear' });
await p1.waitForTimeout(1000);
[a, b] = await sampleBoth();
check('清屏后两端银幕都空了', a.media?.url === null && b.media?.url === null);

// 假视频地址必然产生资源加载报错,这里只记录不判失败
console.log(`CONSOLE ERRORS(不计入失败,含预期的假视频加载错误):${errors.length}`);
for (const e of errors.slice(0, 5)) console.log(' ', e.slice(0, 160));
console.log(failures === 0 ? '✅ 影院同步验证全部通过' : `❌ ${failures} 项失败`);
await browser.close();
process.exit(failures ? 1 : 0);
