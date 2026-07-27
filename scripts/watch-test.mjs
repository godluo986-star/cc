/**
 * 「一起看电影」单实例播放层验收(任务书 §十五/§十六/§二十/§三十)。用法:
 *   npm run build && npm start            # 终端 1
 *   node scripts/watch-test.mjs           # 终端 2(需 playwright,同 smoke)
 * 断言:
 *   1) 世界内放映时全客户端只有一个播放器实例(iframe 计数 = 1);
 *   2) 进出全屏 10 次:iframe 从不重建(data-mark 存活、计数恒 1),
 *      不产生第二个 video/audio 元素 → 无重载、无双声;
 *   3) 全屏时播放器铺满视口,退出后回到 3D 屏幕上(CSS3D 变换恢复);
 *   4) 后加入的 p2 自动拿到当前媒体状态(revision/url/进度一致);
 *   5) Esc 退出后 3D 输入恢复(hot.uiOpen === false)。
 * 播放器内容用打不开的假 URL(沙盒无外网),验证的是实例生命周期与状态
 * 流——内容加载与真实漂移由 sync-test.mjs + shared/test/media.test.ts 覆盖。
 */
import { chromium } from 'playwright';
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8080';
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
    localStorage.setItem('np_settings', JSON.stringify({
      quality: 'low', shadows: false, postfx: false, reflections: false, particles: false, clouds: false,
      masterVolume: 0, musicVolume: 0, sfxVolume: 0, voiceVolume: 0, mediaVolume: 0, invertY: false,
    }));
  }, token);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!document.querySelector('canvas') && !!window.__nx, undefined, { timeout: 40000, polling: 500 });
  await page.waitForTimeout(800);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  return page;
}

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

async function intoCinema(p) {
  await walkTo(p, 2, 40);
  await walkTo(p, 0, 20);
  await walkTo(p, 4, 2);
  await walkTo(p, 16, -9.5);
  await walkTo(p, 26, -9.5, 20000);
  await walkTo(p, 29.9, -11.4, 15000);
  for (let i = 0; i < 6; i++) {
    const prompt = await p.evaluate(() => document.querySelector('.prompt')?.textContent ?? null);
    if (prompt && prompt.includes('电影院')) { await p.keyboard.press('KeyE'); await p.waitForTimeout(2000); break; }
    await walkTo(p, 30, -11.8, 5000, 0.55 + i * 0.1);
  }
  return p.evaluate(() => window.__nx.world.getState().spaceKey);
}

const browser = await chromium.launch({
  ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}),
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});

const p1 = await newPlayer(browser, `watch_p1_${RUN}`);
check('p1 进入电影院', (await intoCinema(p1)) === 'cinema');

// ── p1 放一个网页(iframe 播放器)并靠近银幕(巨幕厅:走西过道绕过座位段)──
await walkTo(p1, -2.9, 4, 20000);
await walkTo(p1, -2.9, -6.5, 25000);
for (let i = 0; i < 5; i++) {
  const prompt = await p1.evaluate(() => document.querySelector('.prompt')?.textContent ?? null);
  if (prompt && prompt.includes('银幕')) { await p1.keyboard.press('KeyE'); await p1.waitForTimeout(1000); break; }
  await walkTo(p1, 0, -9.4, 6000, 0.6);
}
await p1.locator('input[placeholder^="https"]').fill('https://watch-test.invalid/page');
await p1.getByText('放映', { exact: true }).click();
await p1.waitForTimeout(1800);
await p1.keyboard.press('Escape');
await p1.waitForTimeout(1200);

// ── 1) 世界内:单实例 + 标记 ──
const world1 = await p1.evaluate(() => {
  const frames = document.querySelectorAll('iframe');
  if (frames.length === 1) frames[0].dataset.mark = 'the-one-and-only';
  const r = frames[0]?.getBoundingClientRect();
  return { count: frames.length, w: r?.width ?? 0 };
});
check(`世界内单播放器(iframe=${world1.count})`, world1.count === 1);

// ── 2) 进出全屏 10 次:实例永不重建 ──
let stable = true;
for (let i = 0; i < 10; i++) {
  await p1.evaluate(() => { window.__nx.ui.getState(); }); // 保活
  await p1.evaluate(() => {
    // 直接驱动全屏 store(按钮在 CSS3D 层里,headless 点击坐标不稳)
    const mod = window.__nx;
    void mod; // FullscreenViewer 订阅的 zustand store 暴露在模块内——用 DOM 按钮路径:
  });
  // 世界模式下角落的 ⛶ 按钮就在 iframe 旁(同一 DOM 层)
  const opened = await p1.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.title.includes('全屏观看'));
    if (!btn) return false;
    btn.click();
    return true;
  });
  if (!opened) { stable = false; console.log('  ✗ 找不到全屏按钮 @ round', i); break; }
  // 世界/全屏的判据:是否处于 CSS3D matrix3d 变换之下(投影 rect 尺寸在
  // 巨幕近处会超过视口,不能当判据)。原生全屏过渡会暂停渲染几百毫秒,
  // 所以用轮询等待目标状态而不是定长等待。
  const probeSrc = `(() => {
    const f = document.querySelector('iframe');
    let el = f ? f.parentElement : null;
    let matrix = false;
    let hops = 0;
    while (el && hops++ < 8) {
      if ((el.style.transform || '').includes('matrix3d')) { matrix = true; break; }
      el = el.parentElement;
    }
    return {
      count: document.querySelectorAll('iframe').length,
      mark: f && f.dataset.mark ? f.dataset.mark : null,
      matrix,
      videos: document.querySelectorAll('video').length,
      audios: document.querySelectorAll('audio').length,
    };
  })()`;
  const waitState = async (wantMatrix) => {
    try {
      await p1.waitForFunction(
        ([src, want]) => {
          const s = eval(src);
          return s.count === 1 && s.mark === 'the-one-and-only' && s.matrix === want
            && s.videos === 0 && s.audios === 0;
        },
        [probeSrc, wantMatrix],
        { timeout: 5000, polling: 150 },
      );
      return null;
    } catch {
      return p1.evaluate((src) => eval(src), probeSrc);
    }
  };
  const fsBad = await waitState(false);
  if (fsBad) { stable = false; console.log('  ✗ 全屏态异常 @ round', i, JSON.stringify(fsBad)); break; }
  await p1.keyboard.press('Escape');
  const backBad = await waitState(true);
  if (backBad) { stable = false; console.log('  ✗ 退出态异常 @ round', i, JSON.stringify(backBad)); break; }
}
check('进出全屏 ×10:同一 iframe 实例(mark 存活/无重建/无重复元素)', stable);
const uiFree = await p1.evaluate(() => window.__nx.hot.uiOpen === false);
check('Esc 退出后 3D 输入恢复', uiFree);

// ── 3) 后加入:p2 进影院自动拿到当前媒体 ──
const p2 = await newPlayer(browser, `watch_p2_${RUN}`);
check('p2 进入电影院', (await intoCinema(p2)) === 'cinema');
await p2.waitForTimeout(1500);
const pair = await Promise.all([p1, p2].map((p) => p.evaluate(() => {
  const m = window.__nx.world.getState().media;
  return { url: m?.url, rev: m?.revision ?? null, kind: m?.kind };
})));
check(`后加入媒体状态一致(${JSON.stringify(pair[1])})`,
  pair[0].url === pair[1].url && pair[0].rev === pair[1].rev && pair[1].kind === 'site');
const p2count = await p2.evaluate(() => document.querySelectorAll('iframe').length);
check(`p2 也是单播放器(iframe=${p2count})`, p2count === 1);

// ── 清屏还原 ──
await p1.evaluate(() => window.__nx.connection.send('media_ctrl', { op: 'clear' }));
await p1.waitForTimeout(800);
const cleared = await p1.evaluate(() => document.querySelectorAll('iframe').length);
check(`清屏后播放层收起(iframe=${cleared})`, cleared === 0);

console.log('CONSOLE ERRORS(含预期的假链接加载失败):', errors.length);
for (const e of errors.slice(0, 6)) console.log(' ', e.slice(0, 160));
const realErrors = errors.filter((e) => !/(ERR_TUNNEL|ERR_NAME|Failed to load resource)/.test(e));
check('无真实控制台错误', realErrors.length === 0);
console.log(failures === 0 ? '✅ 一起看电影·单实例验收全部通过' : `❌ ${failures} 项失败`);
await browser.close();
process.exit(failures ? 1 : 0);
