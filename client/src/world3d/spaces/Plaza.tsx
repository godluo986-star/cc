/** The outdoor plaza: terrain, paths, all layout props and interactables. */
import { useMemo } from 'react';
import { LAYOUTS, SPACE } from '@nexuspark/shared';
import { renderProp, renderInteractable, BeachBall } from './registry';
import { grassTexture, pavingTexture } from './textures';

export default function Plaza() {
  const layout = LAYOUTS[SPACE.PLAZA];
  const grass = useMemo(() => grassTexture(), []);
  const paving = useMemo(() => pavingTexture(), []);

  return (
    <group>
      {/* grass base */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
        <circleGeometry args={[62, 48]} />
        <meshStandardMaterial map={grass} roughness={0.95} />
      </mesh>
      {/* plaza center paving */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.0, 0]} receiveShadow>
        <circleGeometry args={[13.5, 40]} />
        <meshStandardMaterial map={paving} roughness={0.85} />
      </mesh>
      {/* paths: N-S and E-W cross + building aprons */}
      {[
        { x: 0, z: -25, w: 5, d: 24 },
        { x: 0, z: 34, w: 5, d: 44 },
        { x: -22, z: 0, w: 20, d: 5 },
        { x: 22, z: 0, w: 20, d: 5 },
        { x: -30, z: -13, w: 8, d: 5 },
        { x: 30, z: -14, w: 8, d: 5 },
        { x: 32, z: 10, w: 6, d: 5 },
        { x: -32, z: 10, w: 6, d: 5 },
        { x: 16, z: 22, w: 5, d: 14 },
        { x: -16, z: 24, w: 5, d: 16 },
      ].map((p, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[p.x, 0.005, p.z]} receiveShadow>
          <planeGeometry args={[p.w, p.d]} />
          <meshStandardMaterial map={paving} roughness={0.85} />
        </mesh>
      ))}

      {layout.props.map((p, i) => renderProp(p, i))}
      {layout.interactables.map((it) => renderInteractable(it, it.id))}
      <BeachBall />
    </group>
  );
}
