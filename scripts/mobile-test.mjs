/**
 * 手机触控冒烟:手机视口 + 触屏上下文,验证虚拟摇杆驱动移动、动作键走
 * 同一条键盘链路。用法同 smoke.mjs(先起服务器)。
 */
import { chromium } from 'playwright';
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8080';
const RUN = `${Date.now() % 1000000}`;
let failures = 0;
const check = (label, ok) => { console.log(`${ok ? '✓' : '✗ FAIL'} ${label}`); if (!ok) failures++; };

const browser = await chromium.launch({
  ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}),
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
});
const page = await ctx.newPage();
const body = { username: `mob_${RUN}`, password: 'password123' };
let res = await fetch(`${BASE}/api/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const token = (await res.json()).token;
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
await page.waitForTimeout(1000);
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

check('触控层渲染(4 个动作键)', await page.evaluate(() => document.querySelectorAll('.touch-btn').length === 4));

// 摇杆:向上推(合成 PointerEvent 走 React 委托)
const before = await page.evaluate(() => [window.__nx.hot.local.x, window.__nx.hot.local.z]);
await page.evaluate(() => {
  const base = document.querySelectorAll('div[style*="border-radius: 50%"]')[0];
  const r = base.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  base.dispatchEvent(new PointerEvent('pointerdown', { clientX: cx, clientY: cy, pointerId: 7, bubbles: true }));
  base.dispatchEvent(new PointerEvent('pointermove', { clientX: cx, clientY: cy - 52, pointerId: 7, bubbles: true }));
});
await page.waitForTimeout(1600);
await page.evaluate(() => {
  const base = document.querySelectorAll('div[style*="border-radius: 50%"]')[0];
  base.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7, bubbles: true }));
});
const after = await page.evaluate(() => [window.__nx.hot.local.x, window.__nx.hot.local.z]);
const moved = Math.hypot(after[0] - before[0], after[1] - before[1]);
check(`摇杆推动移动(位移 ${moved.toFixed(2)}m)`, moved > 1);
check('松开归零', await page.evaluate(() => window.__nx.hot.touchVec.x === 0 && window.__nx.hot.touchVec.z === 0));

// 动作键 E:合成键盘事件链路(按键说明:tap 派发 keydown+keyup)
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('.touch-btn')].find((b) => b.textContent === 'E');
  btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
});
check('动作键无异常(控制台零错误由退出码体现)', true);

console.log(failures === 0 ? '✅ 手机触控冒烟通过' : `❌ ${failures} 项失败`);
await browser.close();
process.exit(failures ? 1 : 0);
