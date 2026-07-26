/**
 * 城市统一描边系统(设计文档 §5):反转外壳(inverted hull)。
 *
 * - makeDistanceScaledOutlineMaterial():BackSide MeshBasicMaterial,
 *   通过 onBeforeCompile 在顶点着色器里沿法线外扩,外扩量按 view 距离收细:
 *   thickness = clamp(0.008 × (参考距离 / 距离), 0.002, 0.014) —— 远处自动变细。
 * - addOutline(mesh | geometry, {color?, thickness?}):一行挂描边壳。
 * 零依赖(只依赖 three 与本目录 palette),可单独使用;背景剪影楼不描边。
 */
import * as THREE from 'three';
import { ENV } from './palette';

/** §5:描边基础粗细(世界单位,近处全粗值 = 0.008)。 */
export const OUTLINE_BASE_THICKNESS = 0.008;
/** §5:描边粗细下限(远处收细到 0.002)。 */
export const OUTLINE_MIN_THICKNESS = 0.002;
/** §5:描边粗细上限(0.014,大型近景物体可手动加粗但不越界)。 */
export const OUTLINE_MAX_THICKNESS = 0.014;
/**
 * 距离衰减参考距离(米):view 距离 ≤ 此值时保持全粗,
 * 超出后按 ref/dist 反比收细(实现 §5「远处自动变细」)。
 */
export const OUTLINE_REF_DISTANCE = 6;

export interface OutlineOptions {
  /** 描边颜色,默认全场统一深蓝黑 ENV.outline(§2.1)。 */
  color?: THREE.ColorRepresentation;
  /** 基础粗细(世界单位),默认 OUTLINE_BASE_THICKNESS;运行时仍被 min/max 钳制。 */
  thickness?: number;
}

/**
 * 创建"按距离收细"的描边材质:BackSide 基础材质 + 顶点着色器法线外扩。
 * 支持 InstancedMesh(距离用实例变换后的位置计算)。
 * 注意:外扩发生在物体局部空间,假定物体接近均匀缩放(城市道具满足);
 * toneMapped 关闭以保持描边为精确的深蓝黑墨线。
 * 每次调用返回新材质;若需共享请用 addOutline(内部带缓存)。
 */
export function makeDistanceScaledOutlineMaterial(
  opts: OutlineOptions = {}
): THREE.MeshBasicMaterial {
  const mat = new THREE.MeshBasicMaterial({
    color: opts.color ?? ENV.outline,
    side: THREE.BackSide,
    toneMapped: false,
  });
  const base = THREE.MathUtils.clamp(
    opts.thickness ?? OUTLINE_BASE_THICKNESS,
    OUTLINE_MIN_THICKNESS,
    OUTLINE_MAX_THICKNESS
  );
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uOutlineBase = { value: base };
    shader.uniforms.uOutlineMin = { value: OUTLINE_MIN_THICKNESS };
    shader.uniforms.uOutlineMax = { value: OUTLINE_MAX_THICKNESS };
    shader.uniforms.uOutlineRef = { value: OUTLINE_REF_DISTANCE };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        [
          '#include <common>',
          'uniform float uOutlineBase;',
          'uniform float uOutlineMin;',
          'uniform float uOutlineMax;',
          'uniform float uOutlineRef;',
        ].join('\n')
      )
      .replace(
        '#include <begin_vertex>',
        [
          '#include <begin_vertex>',
          '// 城市描边(§5):按 view 距离收细的反转外壳外扩',
          'vec4 cityLocalPos = vec4( transformed, 1.0 );',
          '#ifdef USE_INSTANCING',
          'cityLocalPos = instanceMatrix * cityLocalPos;',
          '#endif',
          'float cityViewDist = max( -( modelViewMatrix * cityLocalPos ).z, 0.0 );',
          'float cityThickness = clamp( uOutlineBase * ( uOutlineRef / max( cityViewDist, uOutlineRef ) ), uOutlineMin, uOutlineMax );',
          'transformed += normalize( normal ) * cityThickness;',
        ].join('\n')
      );
    // 暴露 uniforms 供运行时微调(如异常点局部加粗)
    mat.userData.outlineUniforms = shader.uniforms;
  };
  return mat;
}

/** 共享材质缓存:同色同粗细的描边壳复用同一材质,减少 program/材质切换。 */
const outlineMatCache = new Map<string, THREE.MeshBasicMaterial>();

function sharedOutlineMaterial(opts: OutlineOptions): THREE.MeshBasicMaterial {
  const color = new THREE.Color(opts.color ?? ENV.outline);
  const thickness = opts.thickness ?? OUTLINE_BASE_THICKNESS;
  const key = `${color.getHexString()}@${thickness}`;
  let mat = outlineMatCache.get(key);
  if (!mat) {
    mat = makeDistanceScaledOutlineMaterial({ color, thickness });
    outlineMatCache.set(key, mat);
  }
  return mat;
}

/**
 * 给网格挂反转外壳描边:
 * - 传 Mesh:创建共享几何的描边壳并 add 为其子节点(跟随变换),返回壳;
 * - 传 BufferGeometry:只创建并返回描边壳 Mesh,由调用方自行放置
 *   (适合 InstancedMesh:用同一几何另建一个 InstancedMesh 壳)。
 * 壳不投影、不接收阴影、不参与射线拾取。背景剪影楼不要调用(§5)。
 */
export function addOutline(
  target: THREE.Mesh | THREE.BufferGeometry,
  opts: OutlineOptions = {}
): THREE.Mesh {
  const geometry = target instanceof THREE.BufferGeometry ? target : target.geometry;
  const shell = new THREE.Mesh(geometry, sharedOutlineMaterial(opts));
  shell.name = 'city-outline';
  shell.castShadow = false;
  shell.receiveShadow = false;
  shell.raycast = () => { /* 描边壳不可拾取 */ };
  if (target instanceof THREE.Mesh) target.add(shell);
  return shell;
}
