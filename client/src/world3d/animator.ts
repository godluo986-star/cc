/**
 * Dango animation — 缓慢、柔软、有重量的年糕手感 (规范要求):
 *  - 移动 = 身体整体轻微上下浮沉 + 少量延迟软形变 (禁止高频弹跳/橡皮球)
 *  - 起步身体略向后拉伸, 停步略向前压缩 (由平滑加速度项驱动)
 *  - 落地宽 +3~6% / 高 -3~6%, 平滑缓动恢复
 *  - 待机 = 极轻呼吸起伏 + 偶尔 1~2° 左右晃动
 * 所有姿态逐帧计算并向目标缓动, 无关键帧资产.
 * 造型无手/脚/嘴 (契约空组), 对应字段仍驱动以保持接口稳定.
 */
import type * as THREE from 'three';
import { Anim } from '@nexuspark/shared';

export interface DangoRefs {
  root: THREE.Group;    // vertical bounce offset
  body: THREE.Group;    // squash/stretch + lean
  face: THREE.Group;    // face tilt
  armL: THREE.Group; armR: THREE.Group;   // 空组 (契约保留)
  footL: THREE.Group; footR: THREE.Group; // 空组 (契约保留)
  eyes: THREE.Group;    // blink (scale y)
  mouth: THREE.Object3D; // 空组 (契约保留)
  sprout: THREE.Group | null; // 已无小芽, 恒 null
}

export interface AnimatorState {
  phase: number;
  blend: number;
  lastAnim: Anim;
  blinkAt: number;
  /** 平滑后的水平速度 (驱动起步拉伸/停步压缩). */
  speedSmooth: number;
  /** 落地软压计时终点 (time 秒). */
  landUntil: number;
  /** 待机偶发晃动的下一次触发时刻. */
  swayAt: number;
}

export function createAnimatorState(): AnimatorState {
  return {
    phase: Math.random() * 10, blend: 1, lastAnim: Anim.Idle,
    blinkAt: performance.now() + 1500 + Math.random() * 3000,
    speedSmooth: 0, landUntil: -1, swayAt: Math.random() * 6,
  };
}

interface Pose {
  rootY: number;
  squash: number;       // 1 = 原状; >1 竖向拉伸; <1 压扁
  bodyRx: number; bodyRz: number;
  faceRx: number; faceRz: number;
  armL: [number, number];
  armR: [number, number];
  footLz: number; footRz: number;
  footLift: number;
  mouthScale: number;
}

const BASE: Pose = {
  rootY: 0, squash: 1, bodyRx: 0, bodyRz: 0, faceRx: 0, faceRz: 0,
  armL: [0, 0], armR: [0, 0],
  footLz: 0, footRz: 0, footLift: 0, mouthScale: 1,
};

function computePose(anim: Anim, phase: number, speedNorm: number, t: number, st: AnimatorState): Pose {
  const p: Pose = { ...BASE, armL: [...BASE.armL] as [number, number], armR: [...BASE.armR] as [number, number] };
  const s = Math.sin(phase);
  const c = Math.cos(phase);
  switch (anim) {
    case Anim.Idle: {
      // 极轻呼吸 (慢) + 偶尔 1~2° 侧晃
      p.squash = 1 + Math.sin(t * 2.0) * 0.012;
      if (t > st.swayAt) {
        const k = t - st.swayAt;
        if (k < 2.2) p.bodyRz = Math.sin(k * Math.PI / 2.2) * 0.028; // ~1.6°, 一次柔和往返
        else st.swayAt = t + 5 + Math.random() * 6;
      }
      break;
    }
    case Anim.Walk: {
      // 柔软浮沉: 低频, 小振幅; 侧向少量延迟摆动
      const amp = 0.55 + 0.45 * Math.min(1, speedNorm * 2);
      p.rootY = Math.abs(s) * 0.042 * amp;
      p.squash = 1 + c * 0.04 * amp;
      p.bodyRx = 0.05 * amp + s * 0.018;
      p.bodyRz = s * 0.03 * amp;
      p.faceRz = -s * 0.02 * amp;
      break;
    }
    case Anim.Run: {
      // 大一点的浮沉, 依旧柔和 (不弹飞)
      p.rootY = Math.abs(s) * 0.075;
      p.squash = 1 + c * 0.06;
      p.bodyRx = 0.13 + s * 0.025;
      p.bodyRz = s * 0.04;
      break;
    }
    case Anim.Jump: {
      p.squash = 1.07;          // 温和的空中拉伸
      p.bodyRx = -0.04;
      break;
    }
    case Anim.Sit: {
      p.squash = 0.92;          // 坐下略压扁
      p.faceRx = 0.03;
      break;
    }
    case Anim.Wave: {
      // 无手臂: 用身体侧倾点头代替挥手
      p.bodyRz = Math.sin(t * 4.2) * 0.09;
      p.faceRz = Math.sin(t * 4.2) * 0.05;
      p.squash = 1 + Math.sin(t * 4.2) * 0.02;
      break;
    }
    case Anim.Dance: {
      const b = Math.sin(t * 3.0);
      p.rootY = Math.abs(Math.sin(t * 6.0)) * 0.035;
      p.squash = 1 + Math.cos(t * 6.0) * 0.03;
      p.bodyRz = b * 0.14;
      p.faceRz = b * 0.08;
      break;
    }
    case Anim.Clap: {
      p.squash = 1 + Math.sin(t * 5.5) * 0.028;  // 轻点头节拍
      p.bodyRx = 0.05 + Math.sin(t * 5.5) * 0.03;
      break;
    }
    case Anim.Point: {
      p.bodyRx = 0.08;          // 朝前欠身示意
      p.faceRx = -0.04;
      break;
    }
    case Anim.Laugh: {
      const l = Math.abs(Math.sin(t * 6.5));
      p.rootY = l * 0.022;
      p.squash = 1 - l * 0.04;
      p.faceRx = -0.1;
      break;
    }
  }
  return p;
}

const ease = (cur: number, target: number, k: number) => cur + (target - cur) * k;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function applyPose(
  refs: DangoRefs,
  st: AnimatorState,
  anim: Anim,
  horizontalSpeed: number,
  dt: number,
  time: number
): void {
  if (anim !== st.lastAnim) {
    // 落地: 从跳跃回到地面姿态 → 触发一次软压 (宽+~4.5%, 高-~5%)
    if (st.lastAnim === Anim.Jump && anim !== Anim.Jump) st.landUntil = time + 0.3;
    st.lastAnim = anim;
    st.blend = 0;
  }
  st.blend = Math.min(1, st.blend + dt * 5);
  // 低频步态节拍 (缓慢柔软)
  const cycleRate = anim === Anim.Run ? 8 : anim === Anim.Walk ? 5.6 : 2;
  st.phase += dt * cycleRate * (anim === Anim.Walk || anim === Anim.Run ? Math.max(0.5, horizontalSpeed / 3.4) : 1);

  // 平滑加速度 → 起步略后仰拉伸 / 停步略前倾压缩
  const prev = st.speedSmooth;
  st.speedSmooth = ease(st.speedSmooth, horizontalSpeed, Math.min(1, dt * 6));
  const accel = dt > 0 ? (st.speedSmooth - prev) / dt : 0;
  const accelLean = clamp(accel * 0.014, -0.07, 0.07);     // + 加速 → 后仰为负方向处理见下
  const accelSquash = clamp(-accel * 0.006, -0.03, 0.03);  // 减速 → 略压缩

  const p = computePose(anim, st.phase, horizontalSpeed / 7, time, st);
  const k = Math.min(1, dt * 9) * (0.4 + 0.6 * st.blend);  // 整体缓动更慢更软

  refs.root.position.y = ease(refs.root.position.y, p.rootY, k);

  // 落地软压 (ease-out 回弹)
  let landMul = 1;
  if (time < st.landUntil) {
    const u = (st.landUntil - time) / 0.3;   // 1 → 0
    landMul = 1 - 0.05 * Math.sin(u * Math.PI); // 中段最深 -5%
  }
  // 体积近似守恒: 高度压低 → 宽度自动增加
  const sy = ease(refs.body.scale.y, (p.squash + accelSquash) * landMul, k);
  const sxz = 1 / Math.sqrt(Math.max(0.5, sy));
  refs.body.scale.set(sxz, sy, sxz);
  refs.body.rotation.x = ease(refs.body.rotation.x, p.bodyRx - accelLean, k);
  refs.body.rotation.z = ease(refs.body.rotation.z, p.bodyRz, k);
  refs.face.rotation.x = ease(refs.face.rotation.x, p.faceRx, k);
  refs.face.rotation.z = ease(refs.face.rotation.z, p.faceRz, k);
  // 契约空组: 仍然缓动 (未来若恢复可见部件, 行为不变)
  refs.armL.rotation.x = ease(refs.armL.rotation.x, -p.armL[0], k);
  refs.armL.rotation.z = ease(refs.armL.rotation.z, p.armL[1], k);
  refs.armR.rotation.x = ease(refs.armR.rotation.x, -p.armR[0], k);
  refs.armR.rotation.z = ease(refs.armR.rotation.z, p.armR[1], k);
  refs.footL.position.z = ease(refs.footL.position.z, 0.1 + p.footLz, k);
  refs.footR.position.z = ease(refs.footR.position.z, 0.1 + p.footRz, k);
  const ms = ease(refs.mouth.scale.y, p.mouthScale, k);
  refs.mouth.scale.setY(ms);

  // 眨眼: 竖线眼纵向压短
  const now = performance.now();
  if (now > st.blinkAt) {
    const sinceBlink = now - st.blinkAt;
    if (sinceBlink < 120) {
      refs.eyes.scale.y = 0.22;
    } else {
      refs.eyes.scale.y = 1;
      st.blinkAt = now + 2200 + Math.random() * 3600;
    }
  } else {
    refs.eyes.scale.y = ease(refs.eyes.scale.y, 1, k);
  }
}
