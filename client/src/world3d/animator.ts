/**
 * Dango avatar animation: squishy steamed-bun dumpling characters. Every pose
 * is computed per-frame (squash & stretch, waddle, hop) and joints ease toward
 * it — no keyframe assets. 脚在新造型里不可见(空 group), 移动手感以身体
 * squash/rootY 的 Q 弹蹦跳为主, 脚部 shuffle 仅保留很弱的残量。
 */
import type * as THREE from 'three';
import { Anim } from '@nexuspark/shared';

export interface DangoRefs {
  root: THREE.Group;    // vertical bounce offset
  body: THREE.Group;    // squash/stretch + lean
  face: THREE.Group;    // face tilt
  armL: THREE.Group; armR: THREE.Group;
  footL: THREE.Group; footR: THREE.Group;
  eyes: THREE.Group;    // blink (scale y)
  mouth: THREE.Object3D;
  sprout: THREE.Group | null;
}

export interface AnimatorState {
  phase: number;
  blend: number;
  lastAnim: Anim;
  blinkAt: number;
}

export function createAnimatorState(): AnimatorState {
  return { phase: Math.random() * 10, blend: 1, lastAnim: Anim.Idle, blinkAt: performance.now() + 1500 + Math.random() * 3000 };
}

interface Pose {
  rootY: number;
  squash: number;       // 1 = round; >1 stretch tall; <1 squashed flat
  bodyRx: number; bodyRz: number;
  faceRx: number; faceRz: number;
  armL: [number, number]; // [raise (x-rot toward front), spread (z-rot)]
  armR: [number, number];
  footLz: number; footRz: number; // forward/back shuffle
  footLift: number;
  mouthScale: number;   // 1 = smile, >1 open (laugh)
}

const BASE: Pose = {
  rootY: 0, squash: 1, bodyRx: 0, bodyRz: 0, faceRx: 0, faceRz: 0,
  armL: [0, 0.25], armR: [0, -0.25],
  footLz: 0, footRz: 0, footLift: 0, mouthScale: 1,
};

function computePose(anim: Anim, phase: number, speedNorm: number, t: number): Pose {
  const p: Pose = { ...BASE, armL: [...BASE.armL] as [number, number], armR: [...BASE.armR] as [number, number] };
  const s = Math.sin(phase);
  const c = Math.cos(phase);
  switch (anim) {
    case Anim.Idle: {
      p.squash = 1 + Math.sin(t * 1.9) * 0.022;
      p.bodyRz = Math.sin(t * 0.7) * 0.02;
      p.armL = [Math.sin(t * 1.3) * 0.06, 0.3];
      p.armR = [Math.cos(t * 1.2) * 0.06, -0.3];
      p.faceRz = Math.sin(t * 0.5) * 0.03;
      break;
    }
    case Anim.Walk: {
      // boing boing: pronounced hops with squash-on-land, stretch-in-air
      const amp = 0.6 + 0.4 * Math.min(1, speedNorm * 2);
      const hop = Math.abs(s);
      p.rootY = hop * 0.16 * amp;
      p.squash = 1 + c * 0.12 * amp;                    // 脚不可见 → squash 更 Q 弹
      p.bodyRx = s * 0.07 * amp;                        // rock forward over each hop
      p.bodyRz = s * 0.08 * amp;                        // waddle
      p.footLz = s * 0.04; p.footRz = -s * 0.04;        // 弱化的残留 shuffle
      p.footLift = hop * 0.02;
      p.armL = [0.25 + s * 0.4, 0.45]; p.armR = [0.25 - s * 0.4, -0.45];
      p.faceRz = -s * 0.05 * amp;
      p.mouthScale = 1.1;
      break;
    }
    case Anim.Run: {
      const hop = Math.abs(s);
      p.rootY = hop * 0.26;                             // big happy bounds
      p.squash = 1 + c * 0.18;                          // 蹦跳主要靠身体拉伸
      p.bodyRx = 0.2 + s * 0.05;                        // eager forward lean
      p.bodyRz = s * 0.07;
      p.footLz = s * 0.05; p.footRz = -s * 0.05;
      p.footLift = hop * 0.03;
      p.armL = [1.2 + s * 0.35, 0.75]; p.armR = [1.2 - s * 0.35, -0.75]; // arms up, wheee
      p.mouthScale = 1.3;
      break;
    }
    case Anim.Jump: {
      p.squash = 1.16;                                  // full stretch
      p.armL = [1.6, 0.9]; p.armR = [1.6, -0.9];
      p.footLz = -0.02; p.footRz = -0.02;
      p.footLift = 0.02;
      p.mouthScale = 1.35;
      break;
    }
    case Anim.Sit: {
      p.squash = 0.9;                                   // settled blob
      p.rootY = 0.0;
      p.footLz = 0.04; p.footRz = 0.04;                 // (feet hidden) faint slide
      p.footLift = 0;
      p.armL = [0.25, 0.35]; p.armR = [0.25, -0.35];
      break;
    }
    case Anim.Wave: {
      p.armR = [2.1, -0.5 + Math.sin(t * 10) * 0.45];
      p.armL = [0.05, 0.3];
      p.bodyRz = Math.sin(t * 10) * 0.03;
      p.faceRz = 0.08;
      p.mouthScale = 1.2;
      break;
    }
    case Anim.Dance: {
      // the classic dango sway
      const b = Math.sin(t * 5.2);
      const hop = Math.abs(Math.sin(t * 10.4));
      p.rootY = hop * 0.07;
      p.squash = 1 + Math.cos(t * 10.4) * 0.05;
      p.bodyRz = b * 0.22;
      p.armL = [1.4 + b * 0.7, 0.8]; p.armR = [1.4 - b * 0.7, -0.8];
      p.footLz = b * 0.03; p.footRz = -b * 0.03;
      p.faceRz = b * 0.14;
      p.mouthScale = 1.3;
      break;
    }
    case Anim.Clap: {
      const cl = (Math.sin(t * 9) + 1) / 2;
      p.armL = [1.15, 1.15 - cl * 0.85];
      p.armR = [1.15, -1.15 + cl * 0.85];
      p.squash = 1 + Math.sin(t * 9) * 0.02;
      p.mouthScale = 1.15;
      break;
    }
    case Anim.Point: {
      p.armR = [1.65, -0.1];
      p.armL = [0.05, 0.3];
      p.bodyRx = 0.06;
      break;
    }
    case Anim.Laugh: {
      const l = Math.abs(Math.sin(t * 11));
      p.rootY = l * 0.05;
      p.squash = 1 - l * 0.07;
      p.faceRx = -0.18;
      p.armL = [0.8, 0.7]; p.armR = [0.8, -0.7];
      p.mouthScale = 1.6;
      break;
    }
  }
  return p;
}

const ease = (cur: number, target: number, k: number) => cur + (target - cur) * k;

export function applyPose(
  refs: DangoRefs,
  st: AnimatorState,
  anim: Anim,
  horizontalSpeed: number,
  dt: number,
  time: number
): void {
  if (anim !== st.lastAnim) { st.lastAnim = anim; st.blend = 0; }
  st.blend = Math.min(1, st.blend + dt * 6);
  const cycleRate = anim === Anim.Run ? 13 : anim === Anim.Walk ? 9 : 2;
  st.phase += dt * cycleRate * (anim === Anim.Walk || anim === Anim.Run ? Math.max(0.5, horizontalSpeed / 3) : 1);

  const p = computePose(anim, st.phase, horizontalSpeed / 6.4, time);
  const k = Math.min(1, dt * 14) * (0.4 + 0.6 * st.blend);

  refs.root.position.y = ease(refs.root.position.y, p.rootY, k);
  // volume-ish preserving squash & stretch
  const sy = ease(refs.body.scale.y, p.squash, k);
  const sxz = 1 / Math.sqrt(Math.max(0.5, sy));
  refs.body.scale.set(sxz, sy, sxz);
  refs.body.rotation.x = ease(refs.body.rotation.x, p.bodyRx, k);
  refs.body.rotation.z = ease(refs.body.rotation.z, p.bodyRz, k);
  refs.face.rotation.x = ease(refs.face.rotation.x, p.faceRx, k);
  refs.face.rotation.z = ease(refs.face.rotation.z, p.faceRz, k);
  refs.armL.rotation.x = ease(refs.armL.rotation.x, -p.armL[0], k);
  refs.armL.rotation.z = ease(refs.armL.rotation.z, p.armL[1], k);
  refs.armR.rotation.x = ease(refs.armR.rotation.x, -p.armR[0], k);
  refs.armR.rotation.z = ease(refs.armR.rotation.z, p.armR[1], k);
  // feet are hidden empty groups on the bun-shaped dango; keep easing so the
  // ref contract (and any future visible feet) still works
  refs.footL.position.z = ease(refs.footL.position.z, 0.1 + p.footLz, k);
  refs.footR.position.z = ease(refs.footR.position.z, 0.1 + p.footRz, k);
  refs.footL.position.y = ease(refs.footL.position.y, 0.02 + (p.footLz > 0.01 ? p.footLift : 0), k);
  refs.footR.position.y = ease(refs.footR.position.y, 0.02 + (p.footRz > 0.01 ? p.footLift : 0), k);
  const ms = ease(refs.mouth.scale.y, p.mouthScale, k);
  refs.mouth.scale.setY(ms);

  // blink + sprout sway
  const now = performance.now();
  if (now > st.blinkAt) {
    const sinceBlink = now - st.blinkAt;
    if (sinceBlink < 130) {
      refs.eyes.scale.y = 0.35; // 线眼本来就细, 眨眼只需再压扁一点
    } else {
      refs.eyes.scale.y = 1;
      st.blinkAt = now + 1800 + Math.random() * 3400;
    }
  } else {
    refs.eyes.scale.y = ease(refs.eyes.scale.y, 1, k);
  }
  if (refs.sprout) {
    refs.sprout.rotation.z = Math.sin(time * 2.1 + st.phase * 0.15) * 0.14;
    refs.sprout.rotation.x = Math.cos(time * 1.7) * 0.08;
  }
}
