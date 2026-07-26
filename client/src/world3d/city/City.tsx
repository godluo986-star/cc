/**
 * 「黄昏街区」户外总装(工单 P3-5,替代旧 Plaza;总纲 §4)。
 *
 * - 地面:方形铺装底板(替换旧大地色圆盘),在地铁口处用 Shape 挖下沉坑洞;
 * - streets(路网)+ buildings(建筑群)+ foreground(前景遮挡)经共享 BuildQueue
 *   分帧构建(每帧 ≤ 8ms,出生点 80m 半径优先,§10),进度先经 console.info 报告
 *   (正式加载界面由 P4 接管);
 * - 地铁口 / 高架天桥直接挂载(轻量);
 * - layout props / interactables 走 spaces/registry(c_* 分支在 registry 中);
 * - BeachBall 保留;雾由 SkySystem 管理(P4 调),本组件不动 fog。
 */
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { LAYOUTS, SPACE } from '@nexuspark/shared';
import { CITY_BOUNDS, STATION } from '@nexuspark/shared/src/cityplan';
import { renderProp, renderInteractable, BeachBall } from '../spaces/registry';
import { ENV } from './palette';
import { toonMat } from './toon';
import { BuildQueue } from './progressive';
import { Streets, shade } from './streets';
import { Buildings } from './buildings';
import { Foreground } from './foreground';
import { StationEntrance, Overpass, STATION_PIT } from './props2';

// 共享构建队列(模块级:重进户外不重复构建,streets/buildings/foreground 幂等)
let cityQueue: BuildQueue | null = null;
function getCityQueue(): BuildQueue {
  if (!cityQueue) cityQueue = new BuildQueue();
  return cityQueue;
}

/** 地面底板:方形(覆盖到背景剪影脚下)+ 地铁口下沉坑洞。 */
let _groundGeo: THREE.BufferGeometry | null = null;
function groundGeometry(): THREE.BufferGeometry {
  if (_groundGeo) return _groundGeo;
  const R = Math.max(CITY_BOUNDS.maxX, CITY_BOUNDS.maxZ) + 260; // 视觉城市延伸(§4 尺度)
  const shape = new THREE.Shape();
  shape.moveTo(-R, -R);
  shape.lineTo(R, -R);
  shape.lineTo(R, R);
  shape.lineTo(-R, R);
  shape.closePath();
  // 地铁口坑洞:局部坑范围旋转后取轴对齐包围盒(Shape 坐标 y = -世界 z)
  const hw = STATION_PIT.w / 2, hd = STATION_PIT.d / 2;
  const c = Math.cos(STATION.ry), s = Math.sin(STATION.ry);
  // 坑中心的局部 z 偏移(楼梯向局部 -z 下行)→ 世界坐标
  const cx = STATION.x + STATION_PIT.cz * s;
  const cz = STATION.z + STATION_PIT.cz * c;
  const ex = Math.abs(hw * c) + Math.abs(hd * s);
  const ez = Math.abs(hw * s) + Math.abs(hd * c);
  const hole = new THREE.Path();
  hole.moveTo(cx - ex, -cz - ez);
  hole.lineTo(cx + ex, -cz - ez);
  hole.lineTo(cx + ex, -cz + ez);
  hole.lineTo(cx - ex, -cz + ez);
  hole.closePath();
  shape.holes.push(hole);
  const geo = new THREE.ShapeGeometry(shape, 1);
  geo.rotateX(-Math.PI / 2);
  _groundGeo = geo;
  return _groundGeo;
}

let _groundMat: THREE.MeshToonMaterial | null = null;
function groundMat(): THREE.MeshToonMaterial {
  if (!_groundMat) _groundMat = toonMat(shade(ENV.roadAsphalt, -0.018));
  return _groundMat;
}

export default function City() {
  const layout = LAYOUTS[SPACE.PLAZA];
  const queue = useMemo(() => getCityQueue(), []);
  const spawn = useMemo<[number, number]>(
    () => [layout.spawn[0], layout.spawn[2]],
    [layout]
  );

  // 分帧构建 + 进度报告(§10 加载:布局→贴图→建筑→道具→灯光;正式界面 P4 接)
  useEffect(() => {
    let lastLabel = '';
    const off = queue.onProgress((p) => {
      if (p.label !== lastLabel || p.done === p.total) {
        lastLabel = p.label;
        console.info(`[黄昏街区] 场景构建 ${p.done}/${p.total} · ${p.label}`);
      }
    });
    void queue.run();
    return off;
  }, [queue]);

  return (
    <group>
      {/* 地面底板(方形铺装,含地铁口坑洞) */}
      <mesh geometry={groundGeometry()} material={groundMat()} position={[0, -0.02, 0]} receiveShadow />

      {/* 路网 / 建筑 / 前景(BuildQueue 分帧) */}
      <Streets queue={queue} />
      <Buildings queue={queue} spawn={spawn} />
      <Foreground queue={queue} />

      {/* 封闭地铁口 + 高架天桥(§4.1) */}
      <StationEntrance />
      <Overpass />

      {/* 布局道具与交互物(c_* 分支见 spaces/registry) */}
      {layout.props.map((p, i) => renderProp(p, i))}
      {layout.interactables.map((it) => renderInteractable(it, it.id))}
      <BeachBall />
    </group>
  );
}
