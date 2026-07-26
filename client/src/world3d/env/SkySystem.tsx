/** Sky dome + sun/moon lights + stars + drifting clouds + fog, driven by the
 *  server world clock and weather. */
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useWorld, useSettings } from '../../state/stores';
import { sampleEnv, currentTod } from './daynight';
import { hot } from '../../state/hot';
import { audio } from '../../audio/engine';

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_Position.z = gl_Position.w; // pin to far plane
}
`;
const SKY_FRAG = /* glsl */ `
varying vec3 vDir;
uniform vec3 topColor;
uniform vec3 horizonColor;
uniform vec3 sunDir;
uniform vec3 sunColor;
uniform float sunAmount;
void main() {
  float h = clamp(vDir.y, 0.0, 1.0);
  vec3 sky = mix(horizonColor, topColor, pow(h, 0.62));
  float sunDot = max(dot(normalize(vDir), normalize(sunDir)), 0.0);
  vec3 halo = sunColor * pow(sunDot, 90.0) * sunAmount * 0.85;
  vec3 disc = sunColor * smoothstep(0.9993, 0.9997, sunDot) * sunAmount * 3.0;
  gl_FragColor = vec4(sky + halo + disc, 1.0);
}
`;

function Stars({ opacityRef }: { opacityRef: React.MutableRefObject<number> }) {
  const matRef = useRef<THREE.PointsMaterial>(null);
  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const n = 700;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * Math.PI * 2;
      const v = Math.acos(Math.random() * 0.95);
      const r = 430;
      pos[i * 3] = Math.sin(v) * Math.cos(u) * r;
      pos[i * 3 + 1] = Math.cos(v) * r * 0.9 + 20;
      pos[i * 3 + 2] = Math.sin(v) * Math.sin(u) * r;
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return g;
  }, []);
  useFrame(() => {
    if (matRef.current) {
      matRef.current.opacity = opacityRef.current;
      matRef.current.visible = opacityRef.current > 0.02;
    }
  });
  return (
    <points geometry={geom} frustumCulled={false}>
      <pointsMaterial ref={matRef} color="#dfe8ff" size={1.4} sizeAttenuation={false} transparent depthWrite={false} />
    </points>
  );
}

let cloudTexCache: THREE.Texture | null = null;
function cloudTexture(): THREE.Texture {
  if (cloudTexCache) return cloudTexCache;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createRadialGradient(64, 64, 8, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  cloudTexCache = new THREE.CanvasTexture(c);
  return cloudTexCache;
}

function Clouds({ tintRef, coverRef }: {
  tintRef: React.MutableRefObject<THREE.Color>;
  coverRef: React.MutableRefObject<number>;
}) {
  const group = useRef<THREE.Group>(null);
  const sprites = useMemo(() => {
    const arr: { x: number; y: number; z: number; s: number; speed: number }[] = [];
    for (let i = 0; i < 14; i++) {
      arr.push({
        x: (Math.random() - 0.5) * 500,
        y: 70 + Math.random() * 55,
        z: (Math.random() - 0.5) * 500,
        s: 55 + Math.random() * 70,
        speed: 1.1 + Math.random() * 1.6,
      });
    }
    return arr;
  }, []);
  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    g.children.forEach((child, i) => {
      const c = sprites[i];
      child.position.x += c.speed * dt;
      if (child.position.x > 280) child.position.x = -280;
      const mat = (child as THREE.Sprite).material as THREE.SpriteMaterial;
      mat.color.copy(tintRef.current);
      mat.opacity = coverRef.current * (0.45 + (i % 3) * 0.12);
    });
  });
  return (
    <group ref={group}>
      {sprites.map((c, i) => (
        <sprite key={i} position={[c.x, c.y, c.z]} scale={[c.s, c.s * 0.42, 1]}>
          <spriteMaterial map={cloudTexture()} transparent depthWrite={false} opacity={0.5} />
        </sprite>
      ))}
    </group>
  );
}

function Rain({ activeRef }: { activeRef: React.MutableRefObject<boolean> }) {
  const count = 900;
  const mesh = useRef<THREE.InstancedMesh>(null);
  const drops = useMemo(() => {
    const arr: { x: number; y: number; z: number; v: number }[] = [];
    for (let i = 0; i < count; i++) {
      arr.push({ x: (Math.random() - 0.5) * 55, y: Math.random() * 26, z: (Math.random() - 0.5) * 55, v: 17 + Math.random() * 7 });
    }
    return arr;
  }, []);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  useFrame((_, dt) => {
    const m = mesh.current;
    if (!m) return;
    m.visible = activeRef.current;
    if (!m.visible) return;
    const cx = hot.local.x, cz = hot.local.z;
    for (let i = 0; i < count; i++) {
      const d = drops[i];
      d.y -= d.v * dt;
      if (d.y < 0) {
        d.y = 20 + Math.random() * 8;
        d.x = (Math.random() - 0.5) * 55;
        d.z = (Math.random() - 0.5) * 55;
      }
      dummy.position.set(cx + d.x, d.y, cz + d.z);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, count]} frustumCulled={false}>
      <boxGeometry args={[0.015, 0.55, 0.015]} />
      <meshBasicMaterial color="#9fb8d8" transparent opacity={0.5} depthWrite={false} />
    </instancedMesh>
  );
}

export default function SkySystem({ indoor }: { indoor: boolean }) {
  const env = useWorld((s) => s.env);
  const settings = useSettings();
  const { scene } = useThree();
  const sunRef = useRef<THREE.DirectionalLight>(null);
  const moonRef = useRef<THREE.DirectionalLight>(null);
  const hemiRef = useRef<THREE.HemisphereLight>(null);
  const skyMat = useRef<THREE.ShaderMaterial>(null);
  const starOpacity = useRef(0);
  const cloudTint = useRef(new THREE.Color('#ffffff'));
  const cloudCover = useRef(0.5);
  const rainActive = useRef(false);
  const fog = useMemo(() => new THREE.Fog('#bcd8f0', 60, 240), []);

  const uniforms = useMemo(() => ({
    topColor: { value: new THREE.Color('#3d7edb') },
    horizonColor: { value: new THREE.Color('#c3ddf2') },
    sunDir: { value: new THREE.Vector3(0, 1, 0) },
    sunColor: { value: new THREE.Color('#fff4e0') },
    sunAmount: { value: 1 },
  }), []);

  useFrame(() => {
    const tod = currentTod(env);
    const s = sampleEnv(tod, env.weather);

    uniforms.topColor.value.copy(s.skyTop);
    uniforms.horizonColor.value.copy(s.skyHorizon);
    uniforms.sunDir.value.copy(s.sunDir);
    uniforms.sunColor.value.copy(s.sunColor);
    uniforms.sunAmount.value = Math.min(1, s.sunIntensity * 0.6 + 0.12);

    if (sunRef.current) {
      const sun = sunRef.current;
      sun.color.copy(s.sunColor);
      sun.intensity = indoor ? 0 : s.sunIntensity;
      sun.position.set(
        hot.local.x + s.sunDir.x * 90,
        Math.max(6, s.sunDir.y * 110),
        hot.local.z + s.sunDir.z * 90
      );
      sun.target.position.set(hot.local.x, 0, hot.local.z);
      sun.target.updateMatrixWorld();
      sun.castShadow = settings.shadows && !indoor && s.sunIntensity > 0.05;
    }
    if (moonRef.current) {
      moonRef.current.intensity = indoor ? 0 : s.moonIntensity;
      moonRef.current.position.set(hot.local.x - s.sunDir.x * 80, 60, hot.local.z - 30);
      moonRef.current.target.position.set(hot.local.x, 0, hot.local.z);
      moonRef.current.target.updateMatrixWorld();
    }
    if (hemiRef.current) {
      hemiRef.current.intensity = indoor ? s.hemiIntensity * 0.55 : s.hemiIntensity;
      hemiRef.current.color.copy(s.hemiSky);
      hemiRef.current.groundColor.copy(s.hemiGround);
    }
    starOpacity.current = indoor ? 0 : s.starOpacity;
    cloudTint.current.copy(s.cloudTint);
    cloudCover.current = env.weather === 'clear' ? 0.4 : env.weather === 'cloudy' ? 0.85 : 1;
    rainActive.current = env.weather === 'rain' && settings.particles && !indoor;

    if (!indoor) {
      fog.color.copy(s.fogColor);
      fog.near = 60 / s.fogDensityMul;
      fog.far = 260 / s.fogDensityMul;
      scene.fog = fog;
    } else {
      scene.fog = null;
    }

    const night = tod < 0.23 || tod > 0.84;
    audio.setAmbient(!indoor, env.weather, night);
  });

  const shadowSize = settings.quality === 'ultra' ? 4096 : settings.quality === 'high' ? 2048 : 1024;

  return (
    <>
      <mesh frustumCulled={false} renderOrder={-100}>
        <sphereGeometry args={[450, 32, 20]} />
        <shaderMaterial
          ref={skyMat}
          side={THREE.BackSide}
          depthWrite={false}
          vertexShader={SKY_VERT}
          fragmentShader={SKY_FRAG}
          uniforms={uniforms}
        />
      </mesh>
      <Stars opacityRef={starOpacity} />
      {settings.clouds && !indoor && <Clouds tintRef={cloudTint} coverRef={cloudCover} />}
      {!indoor && <Rain activeRef={rainActive} />}
      <hemisphereLight ref={hemiRef} intensity={0.6} />
      <directionalLight
        ref={sunRef}
        intensity={2}
        castShadow={settings.shadows && !indoor}
        shadow-mapSize={[shadowSize, shadowSize]}
        shadow-camera-left={-42}
        shadow-camera-right={42}
        shadow-camera-top={42}
        shadow-camera-bottom={-42}
        shadow-camera-near={1}
        shadow-camera-far={220}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
      />
      <directionalLight ref={moonRef} intensity={0} color="#7d92c8" />
    </>
  );
}
