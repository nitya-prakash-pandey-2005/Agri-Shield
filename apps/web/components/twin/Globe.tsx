"use client";

/**
 * Earth Twin globe (react-three-fiber). Always load through next/dynamic({ ssr:false }).
 *
 * Layers (each one draw call or a handful):
 *  - Earth: shader sphere — NASA land mask, dot-matrix continents, real day/night from the sub-solar point,
 *    ocean glint, terminator glow; fresnel atmosphere; graticule; starfield
 *  - Assets: instanced glowing pillars (height = exposure, colour = composite risk at the scrubbed time);
 *    LOD — zoomed out they aggregate into one column per district
 *  - Districts: real admin boundaries as risk-coloured caps + outlines (merged geometry)
 *  - Hazards: instanced pulsing rings (GDACS / NASA EONET)
 *  - Cyclones: merged track lines coloured by Saffir-Simpson category, time-aware, animated shimmer + eyes
 *  - Flows: great-circle arcs with travelling particles (supply-chain tonnes/week)
 *
 * Author: Nitya Prakash Pandey
 */
import { memo, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls, PerformanceMonitor } from "@react-three/drei";
import * as THREE from "three";
import type { TwinScene } from "@/server/services/twin";
import { categoryColor, hazardColor, latLonToVec3, riskHexStr, slerpPath, sunPosition } from "./geo";

export type SelKind = "asset" | "district" | "hazard" | "cyclone" | "flow" | "cluster";
export interface Selection {
  kind: SelKind;
  id: string;
}
export interface FlyTarget {
  lat: number;
  lon: number;
  dist: number;
  key: number;
}
export interface HoverInfo {
  title: string;
  sub: string;
  x: number;
  y: number;
  color?: string;
}
export interface LayerState {
  assets: boolean;
  districts: boolean;
  hazards: boolean;
  cyclones: boolean;
  flows: boolean;
  terminator: boolean;
  graticule: boolean;
}

export interface GlobeProps {
  scene: TwinScene;
  /** composite score per asset at the scrubbed time (aligned with scene.assets) */
  assetScores: number[];
  /** composite score per district at the scrubbed time (aligned with scene.districts) */
  districtScores: number[];
  timeMs: number;
  layers: LayerState;
  selected: Selection | null;
  onSelect: (s: Selection | null) => void;
  onHover: (h: HoverInfo | null) => void;
  fly: FlyTarget | null;
  reducedMotion: boolean;
  autoRotate?: boolean;
  initialView: { lat: number; lon: number; dist: number };
  fpsRef?: MutableRefObject<HTMLElement | null>;
  className?: string;
}

const V = (lat: number, lon: number, r = 1) => new THREE.Vector3(...latLonToVec3(lat, lon, r));
const UP = new THREE.Vector3(0, 1, 0);
const TRACK_BASE_MS = Date.UTC(2023, 0, 1);
const toTrackHours = (ms: number) => (ms - TRACK_BASE_MS) / 3_600_000;
const fmtUsd = (v: number) => (v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${Math.round(v / 1e3)}k` : `$${Math.round(v)}`);

// ─── Shaders ──────────────────────────────────────────────────────────────

const EARTH_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vW;
void main() {
  vN = normalize(position);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const EARTH_FRAG = /* glsl */ `
uniform sampler2D uLand;
uniform float uHasLand;
uniform vec3 uSun;
uniform float uNight;
varying vec3 vN;
varying vec3 vW;
const float PI = 3.141592653589793;
void main() {
  vec3 n = normalize(vN);
  float theta = atan(n.z, -n.x);
  float u = fract(theta / (2.0 * PI) + 1.0);
  float lat = asin(clamp(n.y, -1.0, 1.0));
  float v = 0.5 + lat / PI;
  float land = uHasLand > 0.5 ? smoothstep(0.3, 0.7, texture2D(uLand, vec2(u, v)).r) : 0.0;
  float latDeg = lat * 57.29578;
  // constant x-scale within each latitude row (avoids shearing the dot grid)
  float cy = latDeg / 0.6;
  float rowLat = (floor(cy) + 0.5) * 0.6 * 0.0174533;
  vec2 cell = vec2(u * 360.0 * max(cos(rowLat), 0.2) / 0.6, cy);
  vec2 g = fract(cell) - 0.5;
  float d = length(g);
  float aa = clamp(fwidth(d) * 1.4, 0.0, 0.2);
  float dots = 1.0 - smoothstep(0.24 - aa, 0.24 + aa, d);
  vec3 ocean = vec3(0.010, 0.036, 0.080);
  vec3 landBase = vec3(0.028, 0.090, 0.100);
  vec3 col = mix(ocean, landBase, land);
  col += vec3(0.22, 0.80, 0.74) * dots * land * 0.42;
  vec3 s = normalize(uSun);
  float ndl = dot(n, s);
  float day = mix(1.0, smoothstep(-0.12, 0.22, ndl), uNight);
  vec3 viewDir = normalize(cameraPosition - vW);
  float fres = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0);
  vec3 dayCol = col * (1.0 + 0.55 * max(ndl, 0.0));
  vec3 nightCol = col * 0.55 + vec3(0.0, 0.014, 0.04);
  vec3 c = mix(nightCol, dayCol, day);
  vec3 r = reflect(-s, n);
  float spec = pow(max(dot(r, viewDir), 0.0), 70.0) * (1.0 - land) * day * uNight;
  c += vec3(0.30, 0.52, 0.70) * spec * 0.55;
  c += vec3(1.0, 0.55, 0.22) * exp(-abs(ndl) * 30.0) * 0.16 * uNight;
  c += vec3(0.08, 0.50, 0.58) * fres * 0.38;
  gl_FragColor = vec4(c, 1.0);
}`;

const ATMO_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vWN;
void main() {
  vN = normalize(normalMatrix * normal);
  vWN = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const ATMO_FRAG = /* glsl */ `
uniform vec3 uSun;
uniform float uNight;
varying vec3 vN;
varying vec3 vWN;
void main() {
  float i = pow(max(0.0, 0.68 - dot(vN, vec3(0.0, 0.0, 1.0))), 3.2);
  float lit = mix(1.0, 0.45 + 0.55 * smoothstep(-0.35, 0.35, dot(vWN, normalize(uSun))), uNight);
  gl_FragColor = vec4(vec3(0.16, 0.78, 0.86) * lit, 1.0) * i * 1.25;
}`;

const GLOW_VERT = /* glsl */ `
attribute vec3 aColor;
attribute float aSize;
varying vec3 vColor;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = min(48.0, aSize * (2.2 / -mv.z));
  gl_Position = projectionMatrix * mv;
}`;
const GLOW_FRAG = /* glsl */ `
varying vec3 vColor;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d);
  gl_FragColor = vec4(vColor, a * a * 0.7);
}`;

const RING_VERT = /* glsl */ `
attribute vec3 aColor;
attribute float aPhase;
attribute float aSpeed;
uniform float uTime;
varying vec3 vColor;
varying float vAlpha;
void main() {
  float p = fract(uTime * aSpeed + aPhase);
  vColor = aColor;
  vAlpha = 1.0 - p;
  vec3 pos = position * (0.35 + p * 1.65);
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(pos, 1.0);
}`;
const RING_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  gl_FragColor = vec4(vColor, vAlpha * 0.9);
}`;

const TRACK_VERT = /* glsl */ `
attribute vec3 color;
attribute float aTime;
attribute float aAlong;
attribute float aTrack;
varying vec3 vColor;
varying float vTime;
varying float vAlong;
varying float vTrack;
void main() {
  vColor = color;
  vTime = aTime;
  vAlong = aAlong;
  vTrack = aTrack;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const TRACK_FRAG = /* glsl */ `
uniform float uNow;
uniform float uClock;
uniform float uSel;
uniform float uHover;
varying vec3 vColor;
varying float vTime;
varying float vAlong;
varying float vTrack;
void main() {
  float age = uNow - vTime;
  float future = step(age, 0.0);
  float recent = exp(-max(age, 0.0) / 240.0);
  float a = mix(0.24 + 0.7 * recent, 0.05, future);
  float shimmer = 0.72 + 0.28 * sin(vAlong * 90.0 - uClock * 2.4);
  float sel = (abs(vTrack - uSel) < 0.5 || abs(vTrack - uHover) < 0.5) ? 1.0 : 0.0;
  a = mix(a * shimmer, 1.0, sel);
  vec3 c = mix(vColor, vColor * 1.4 + 0.1, sel);
  gl_FragColor = vec4(c, a);
}`;

const ARC_VERT = /* glsl */ `
attribute float aT;
attribute vec3 aColor;
varying float vT;
varying vec3 vColor;
void main() {
  vT = aT;
  vColor = aColor;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const ARC_FRAG = /* glsl */ `
varying float vT;
varying vec3 vColor;
void main() {
  float edge = smoothstep(0.0, 0.08, vT) * smoothstep(1.0, 0.92, vT);
  gl_FragColor = vec4(vColor, 0.22 * edge + 0.06);
}`;

// ─── Helpers ──────────────────────────────────────────────────────────────

function useLandTexture() {
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    let alive = true;
    new THREE.TextureLoader().load(
      "/globe/land-mask.png",
      (t) => {
        if (!alive) return t.dispose();
        t.generateMipmaps = false;
        t.minFilter = THREE.LinearFilter;
        t.magFilter = THREE.LinearFilter;
        t.wrapS = THREE.RepeatWrapping;
        t.needsUpdate = true;
        setTex(t);
      },
      undefined,
      () => undefined
    );
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => () => tex?.dispose(), [tex]);
  return tex;
}

function useDisposable<T extends { dispose: () => void }>(factory: () => T, deps: unknown[]): T {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const obj = useMemo(factory, deps);
  useEffect(() => () => obj.dispose(), [obj]);
  return obj;
}

function screenXY(e: ThreeEvent<PointerEvent> | ThreeEvent<MouseEvent>) {
  const r = (e.nativeEvent.target as HTMLElement | null)?.getBoundingClientRect?.();
  return { x: e.nativeEvent.clientX - (r?.left ?? 0), y: e.nativeEvent.clientY - (r?.top ?? 0) };
}

// ─── Earth & sky ──────────────────────────────────────────────────────────

function Earth({ sun, night, onEmpty, onHoverNone }: { sun: THREE.Vector3; night: boolean; onEmpty: () => void; onHoverNone: () => void }) {
  const land = useLandTexture();
  const invalidate = useThree((s) => s.invalidate);
  const geo = useDisposable(() => new THREE.SphereGeometry(1, 128, 96), []);
  const hitGeo = useDisposable(() => new THREE.SphereGeometry(1, 40, 30), []);
  const mat = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uLand: { value: null }, uHasLand: { value: 0 }, uSun: { value: new THREE.Vector3(1, 0, 0) }, uNight: { value: 1 } },
        vertexShader: EARTH_VERT,
        fragmentShader: EARTH_FRAG,
      }),
    []
  );
  const atmoGeo = useDisposable(() => new THREE.SphereGeometry(1.14, 64, 48), []);
  const atmo = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uSun: { value: new THREE.Vector3(1, 0, 0) }, uNight: { value: 1 } },
        vertexShader: ATMO_VERT,
        fragmentShader: ATMO_FRAG,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
      }),
    []
  );
  useEffect(() => {
    if (land) {
      mat.uniforms.uLand!.value = land;
      mat.uniforms.uHasLand!.value = 1;
      invalidate();
    }
  }, [land, mat, invalidate]);
  useEffect(() => {
    mat.uniforms.uSun!.value.copy(sun);
    atmo.uniforms.uSun!.value.copy(sun);
    mat.uniforms.uNight!.value = night ? 1 : 0;
    atmo.uniforms.uNight!.value = night ? 1 : 0;
    invalidate();
  }, [sun, night, mat, atmo, invalidate]);
  const down = useRef<{ x: number; y: number } | null>(null);
  return (
    <group>
      <mesh geometry={geo} material={mat} raycast={() => null} />
      {/* low-poly occluder for picking: blocks markers on the far side */}
      <mesh
        geometry={hitGeo}
        onPointerDown={(e) => {
          e.stopPropagation();
          down.current = { x: e.nativeEvent.clientX, y: e.nativeEvent.clientY };
        }}
        onPointerMove={(e) => {
          e.stopPropagation();
          onHoverNone();
        }}
        onClick={(e) => {
          e.stopPropagation();
          const d = down.current;
          if (!d || Math.hypot(e.nativeEvent.clientX - d.x, e.nativeEvent.clientY - d.y) < 5) onEmpty();
        }}
      >
        <meshBasicMaterial visible={false} />
      </mesh>
      <mesh geometry={atmoGeo} material={atmo} raycast={() => null} />
    </group>
  );
}

function Graticule() {
  const obj = useMemo(() => {
    const pts: number[] = [];
    for (let lat = -75; lat <= 75; lat += 15)
      for (let lon = -180; lon < 180; lon += 3) {
        const a = V(lat, lon, 1.0012);
        const b = V(lat, lon + 3, 1.0012);
        pts.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    for (let lon = -180; lon < 180; lon += 15)
      for (let lat = -84; lat < 84; lat += 3) {
        const a = V(lat, lon, 1.0012);
        const b = V(lat + 3, lon, 1.0012);
        pts.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    const m = new THREE.LineBasicMaterial({ color: 0x5eead4, transparent: true, opacity: 0.07, depthWrite: false });
    const l = new THREE.LineSegments(g, m);
    l.raycast = () => null;
    return l;
  }, []);
  useEffect(() => () => {
    obj.geometry.dispose();
    (obj.material as THREE.Material).dispose();
  }, [obj]);
  return <primitive object={obj} />;
}

function Stars() {
  const obj = useMemo(() => {
    const n = 1800;
    const pos = new Float32Array(n * 3);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    for (let i = 0; i < n; i++) {
      const u = rnd() * 2 - 1;
      const t = rnd() * Math.PI * 2;
      const r = 40 + rnd() * 40;
      const s = Math.sqrt(1 - u * u);
      pos.set([r * s * Math.cos(t), r * u, r * s * Math.sin(t)], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({ color: 0xaac4dd, size: 1.3, sizeAttenuation: false, transparent: true, opacity: 0.55, depthWrite: false });
    const p = new THREE.Points(g, m);
    p.raycast = () => null;
    return p;
  }, []);
  useEffect(() => () => {
    obj.geometry.dispose();
    (obj.material as THREE.Material).dispose();
  }, [obj]);
  return <primitive object={obj} />;
}

// ─── Pillars (assets / clusters / district columns) ───────────────────────

export interface PillarItem {
  id: string;
  kind: SelKind;
  lat: number;
  lon: number;
  height: number;
  width: number;
  score: number;
  title: string;
  sub: string;
}

function Pillars({ items, onSelect, onHover, selectedId, heightScale = 1 }: { items: PillarItem[]; onSelect: (s: Selection) => void; onHover: (h: HoverInfo | null) => void; selectedId: string | null; heightScale?: number }) {
  const invalidate = useThree((s) => s.invalidate);
  const count = Math.max(1, items.length);
  const geo = useDisposable(() => new THREE.CylinderGeometry(1, 1, 1, 8, 1, false).translate(0, 0.5, 0), []);
  const hitGeo = useDisposable(() => new THREE.CylinderGeometry(1, 1, 1, 6, 1, false).translate(0, 0.5, 0), []);
  const mat = useDisposable(() => new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, opacity: 0.92 }), []);
  const hitMat = useDisposable(() => new THREE.MeshBasicMaterial({ visible: false }), []);
  const mesh = useMemo(() => {
    const m = new THREE.InstancedMesh(geo, mat, count);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false;
    m.raycast = () => null;
    return m;
  }, [geo, mat, count]);
  const hit = useMemo(() => {
    const m = new THREE.InstancedMesh(hitGeo, hitMat, count);
    m.frustumCulled = false;
    return m;
  }, [hitGeo, hitMat, count]);
  useEffect(() => () => {
    mesh.dispose();
    hit.dispose();
  }, [mesh, hit]);

  // glow tops
  const glow = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array(count), 1));
    const m = new THREE.ShaderMaterial({ vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const p = new THREE.Points(g, m);
    p.frustumCulled = false;
    p.raycast = () => null;
    return p;
  }, [count]);
  useEffect(() => () => {
    glow.geometry.dispose();
    (glow.material as THREE.Material).dispose();
  }, [glow]);

  // geometry (positions) — depends on items identity/height
  useEffect(() => {
    const o = new THREE.Object3D();
    const pos = glow.geometry.getAttribute("position") as THREE.BufferAttribute;
    const size = glow.geometry.getAttribute("aSize") as THREE.BufferAttribute;
    items.forEach((it, i) => {
      const n = V(it.lat, it.lon).normalize();
      o.position.copy(n).multiplyScalar(1.0005);
      o.quaternion.setFromUnitVectors(UP, n);
      const sel = it.id === selectedId;
      const h = it.height * heightScale;
      o.scale.set(it.width * (sel ? 1.6 : 1), h, it.width * (sel ? 1.6 : 1));
      o.updateMatrix();
      mesh.setMatrixAt(i, o.matrix);
      o.scale.set(Math.max(it.width * 3, 0.005), h, Math.max(it.width * 3, 0.005));
      o.updateMatrix();
      hit.setMatrixAt(i, o.matrix);
      const top = n.clone().multiplyScalar(1.0005 + h);
      pos.setXYZ(i, top.x, top.y, top.z);
      size.setX(i, sel ? 26 : it.width > 0.002 ? 13 : 8);
    });
    mesh.count = items.length;
    hit.count = items.length;
    glow.geometry.setDrawRange(0, items.length);
    mesh.instanceMatrix.needsUpdate = true;
    hit.instanceMatrix.needsUpdate = true;
    pos.needsUpdate = true;
    size.needsUpdate = true;
    hit.computeBoundingSphere();
    invalidate();
  }, [items, selectedId, heightScale, mesh, hit, glow, invalidate]);

  // colours — depend on scores
  useEffect(() => {
    const c = new THREE.Color();
    const col = glow.geometry.getAttribute("aColor") as THREE.BufferAttribute;
    items.forEach((it, i) => {
      c.set(riskHexStr(it.score));
      mesh.setColorAt(i, c);
      col.setXYZ(i, c.r, c.g, c.b);
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    col.needsUpdate = true;
    invalidate();
  }, [items, mesh, glow, invalidate]);

  const pick = (e: ThreeEvent<PointerEvent> | ThreeEvent<MouseEvent>) => (e.instanceId != null ? items[e.instanceId] : undefined);
  return (
    <group>
      <primitive object={mesh} />
      <primitive object={glow} />
      <primitive
        object={hit}
        onPointerMove={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          const it = pick(e);
          if (it) onHover({ title: it.title, sub: it.sub, color: riskHexStr(it.score), ...screenXY(e) });
        }}
        onPointerOut={() => onHover(null)}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          const it = pick(e);
          if (it) onSelect({ kind: it.kind, id: it.id });
        }}
      />
    </group>
  );
}

// ─── District caps ────────────────────────────────────────────────────────

function DistrictCaps({ scene, scores, onSelect, onHover, selectedId }: { scene: TwinScene; scores: number[]; onSelect: (s: Selection) => void; onHover: (h: HoverInfo | null) => void; selectedId: string | null }) {
  const invalidate = useThree((s) => s.invalidate);
  const built = useMemo(() => {
    const pos: number[] = [];
    const idx: number[] = [];
    const owner: number[] = []; // triangle → district index
    const vOwner: number[] = []; // vertex → district index
    const line: number[] = [];
    const lOwner: number[] = [];
    scene.districts.forEach((d, di) => {
      const ring = d.ring.length > 3 ? d.ring.slice(0, -1) : [];
      if (ring.length < 3) return;
      const contour = ring.map(([x, y]) => new THREE.Vector2(x, y));
      let tris: number[][] = [];
      try {
        tris = THREE.ShapeUtils.triangulateShape(contour, []);
      } catch {
        tris = [];
      }
      const base = pos.length / 3;
      for (const [x, y] of ring) {
        const v = V(y, x, 1.0016);
        pos.push(v.x, v.y, v.z);
        vOwner.push(di);
      }
      for (const t of tris) {
        idx.push(base + t[0]!, base + t[1]!, base + t[2]!);
        owner.push(di);
      }
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i]!;
        const b = ring[(i + 1) % ring.length]!;
        const va = V(a[1], a[0], 1.0022);
        const vb = V(b[1], b[0], 1.0022);
        line.push(va.x, va.y, va.z, vb.x, vb.y, vb.z);
        lOwner.push(di, di);
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(pos.length), 3));
    g.setIndex(idx);
    g.computeBoundingSphere();
    const fill = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.34, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    const lg = new THREE.BufferGeometry();
    lg.setAttribute("position", new THREE.Float32BufferAttribute(line, 3));
    lg.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(line.length), 3));
    const outline = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false }));
    outline.raycast = () => null;
    return { fill, outline, owner, vOwner, lOwner };
  }, [scene.districts]);
  useEffect(() => () => {
    built.fill.geometry.dispose();
    (built.fill.material as THREE.Material).dispose();
    built.outline.geometry.dispose();
    (built.outline.material as THREE.Material).dispose();
  }, [built]);

  useEffect(() => {
    const c = new THREE.Color();
    const fc = built.fill.geometry.getAttribute("color") as THREE.BufferAttribute;
    const selIdx = scene.districts.findIndex((d) => d.id === selectedId);
    built.vOwner.forEach((di, i) => {
      c.set(riskHexStr(scores[di] ?? 0));
      if (di === selIdx) c.multiplyScalar(1.5);
      fc.setXYZ(i, c.r, c.g, c.b);
    });
    fc.needsUpdate = true;
    const lc = built.outline.geometry.getAttribute("color") as THREE.BufferAttribute;
    built.lOwner.forEach((di, i) => {
      c.set(riskHexStr(scores[di] ?? 0));
      if (di === selIdx) c.set("#ffffff");
      lc.setXYZ(i, c.r, c.g, c.b);
    });
    lc.needsUpdate = true;
    invalidate();
  }, [built, scores, scene.districts, selectedId, invalidate]);

  const pick = (e: ThreeEvent<PointerEvent> | ThreeEvent<MouseEvent>) => {
    const f = e.faceIndex;
    return f != null ? scene.districts[built.owner[f] ?? -1] : undefined;
  };
  return (
    <group>
      <primitive
        object={built.fill}
        onPointerMove={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          const d = pick(e);
          if (d) {
            const i = scene.districts.indexOf(d);
            onHover({ title: d.name, sub: `District · risk ${Math.round(scores[i] ?? d.composite)}/100${d.assets ? ` · ${d.assets} in portfolio` : ` · ${d.farms.toLocaleString("en-US")} farms`}`, color: riskHexStr(scores[i] ?? d.composite), ...screenXY(e) });
          }
        }}
        onPointerOut={() => onHover(null)}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          const d = pick(e);
          if (d) onSelect({ kind: "district", id: d.id });
        }}
      />
      <primitive object={built.outline} />
    </group>
  );
}

// ─── Hazards ──────────────────────────────────────────────────────────────

function Hazards({ scene, visibleIds, onSelect, onHover, reduced }: { scene: TwinScene; visibleIds: Set<string>; onSelect: (s: Selection) => void; onHover: (h: HoverInfo | null) => void; reduced: boolean }) {
  const invalidate = useThree((s) => s.invalidate);
  const list = useMemo(() => scene.hazards.filter((h) => visibleIds.has(h.id)), [scene.hazards, visibleIds]);
  const n = Math.max(1, list.length);
  const ringGeo = useDisposable(() => new THREE.RingGeometry(0.86, 1, 48), []);
  const coreGeo = useDisposable(() => new THREE.CircleGeometry(0.3, 24), []);
  const ringMat = useDisposable(() => new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 } }, vertexShader: RING_VERT, fragmentShader: RING_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }), []);
  const coreMat = useDisposable(() => new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false }), []);
  const objs = useMemo(() => {
    const rings = new THREE.InstancedMesh(ringGeo, ringMat, n * 2);
    const core = new THREE.InstancedMesh(coreGeo, coreMat, n);
    rings.frustumCulled = false;
    core.frustumCulled = false;
    rings.raycast = () => null;
    const col = new Float32Array(n * 2 * 3);
    const ph = new Float32Array(n * 2);
    const sp = new Float32Array(n * 2);
    ringGeo.setAttribute("aColor", new THREE.InstancedBufferAttribute(col, 3));
    ringGeo.setAttribute("aPhase", new THREE.InstancedBufferAttribute(ph, 1));
    ringGeo.setAttribute("aSpeed", new THREE.InstancedBufferAttribute(sp, 1));
    return { rings, core };
  }, [ringGeo, coreGeo, ringMat, coreMat, n]);
  useEffect(() => () => {
    objs.rings.dispose();
    objs.core.dispose();
  }, [objs]);
  useEffect(() => {
    const o = new THREE.Object3D();
    const c = new THREE.Color();
    const col = ringGeo.getAttribute("aColor") as THREE.InstancedBufferAttribute;
    const ph = ringGeo.getAttribute("aPhase") as THREE.InstancedBufferAttribute;
    const sp = ringGeo.getAttribute("aSpeed") as THREE.InstancedBufferAttribute;
    list.forEach((h, i) => {
      const nrm = V(h.lat, h.lon).normalize();
      const size = h.alertLevel === "red" ? 0.024 : h.alertLevel === "orange" ? 0.019 : 0.014;
      o.position.copy(nrm).multiplyScalar(1.003);
      o.lookAt(nrm.clone().multiplyScalar(2));
      o.scale.setScalar(size);
      o.updateMatrix();
      objs.rings.setMatrixAt(i * 2, o.matrix);
      objs.rings.setMatrixAt(i * 2 + 1, o.matrix);
      o.scale.setScalar(size * (h.nearby ? 1.1 : 0.8));
      o.updateMatrix();
      objs.core.setMatrixAt(i, o.matrix);
      c.set(hazardColor(h.alertLevel, h.type));
      objs.core.setColorAt(i, c);
      for (const k of [0, 1]) {
        col.setXYZ(i * 2 + k, c.r, c.g, c.b);
        ph.setX(i * 2 + k, ((i * 0.37) % 1) + k * 0.5);
        sp.setX(i * 2 + k, reduced ? 0 : h.alertLevel === "red" ? 0.55 : 0.35);
      }
    });
    objs.rings.count = list.length * 2;
    objs.core.count = list.length;
    objs.rings.instanceMatrix.needsUpdate = true;
    objs.core.instanceMatrix.needsUpdate = true;
    if (objs.core.instanceColor) objs.core.instanceColor.needsUpdate = true;
    col.needsUpdate = true;
    ph.needsUpdate = true;
    sp.needsUpdate = true;
    objs.core.computeBoundingSphere();
    invalidate();
  }, [list, objs, ringGeo, reduced, invalidate]);
  useFrame((st) => {
    if (!reduced) ringMat.uniforms.uTime!.value = st.clock.elapsedTime;
  });
  return (
    <group>
      <primitive object={objs.rings} />
      <primitive
        object={objs.core}
        onPointerMove={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          const h = e.instanceId != null ? list[e.instanceId] : undefined;
          if (h) onHover({ title: h.title, sub: `${h.source} · ${h.type}${h.alertLevel ? ` · ${h.alertLevel} alert` : ""}${h.nearestKm != null ? ` · ${h.nearestKm} km from ${h.nearestName}` : ""}`, color: hazardColor(h.alertLevel, h.type), ...screenXY(e) });
        }}
        onPointerOut={() => onHover(null)}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          const h = e.instanceId != null ? list[e.instanceId] : undefined;
          if (h) onSelect({ kind: "hazard", id: h.id });
        }}
      />
    </group>
  );
}

// ─── Cyclone tracks ───────────────────────────────────────────────────────

function trackPos(t: TwinScene["tracks"][number], ms: number): THREE.Vector3 | null {
  const start = Date.parse(t.start);
  const h = (ms - start) / 3_600_000;
  const p = t.points;
  if (h < p[0]![0] || h > p[p.length - 1]![0] + 12) return null;
  for (let i = 1; i < p.length; i++) {
    if (h <= p[i]![0]) {
      const a = p[i - 1]!;
      const b = p[i]!;
      const k = (h - a[0]) / Math.max(1e-6, b[0] - a[0]);
      const va = V(a[1], a[2]).normalize();
      const vb = V(b[1], b[2]).normalize();
      return va.lerp(vb, k).normalize();
    }
  }
  const l = p[p.length - 1]!;
  return V(l[1], l[2]).normalize();
}

function Cyclones({ scene, timeMs, selectedId, onSelect, onHover, reduced }: { scene: TwinScene; timeMs: number; selectedId: string | null; onSelect: (s: Selection) => void; onHover: (h: HoverInfo | null) => void; reduced: boolean }) {
  const invalidate = useThree((s) => s.invalidate);
  const [hoverIdx, setHoverIdx] = useState(-1);
  const built = useMemo(() => {
    const pos: number[] = [];
    const col: number[] = [];
    const time: number[] = [];
    const along: number[] = [];
    const tid: number[] = [];
    const c = new THREE.Color();
    scene.tracks.forEach((t, ti) => {
      const start = Date.parse(t.start);
      const pts = t.points;
      const total = pts.length - 1;
      for (let i = 0; i < total; i++) {
        const a = pts[i]!;
        const b = pts[i + 1]!;
        const seg = slerpPath({ lat: a[1], lon: a[2] }, { lat: b[1], lon: b[2] }, 4);
        for (let k = 0; k < seg.length - 1; k++) {
          const f0 = k / (seg.length - 1);
          const f1 = (k + 1) / (seg.length - 1);
          for (const [v, f] of [[seg[k]!, f0], [seg[k + 1]!, f1]] as const) {
            const cat = f < 0.5 ? a[4] : b[4];
            const lift = 1.004 + Math.max(0, cat) * 0.0012;
            pos.push(v[0] * lift, v[1] * lift, v[2] * lift);
            c.set(categoryColor(cat));
            col.push(c.r, c.g, c.b);
            time.push(toTrackHours(start + (a[0] + (b[0] - a[0]) * f) * 3_600_000));
            along.push((i + f) / Math.max(1, total));
            tid.push(ti);
          }
        }
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute("aTime", new THREE.Float32BufferAttribute(time, 1));
    g.setAttribute("aAlong", new THREE.Float32BufferAttribute(along, 1));
    g.setAttribute("aTrack", new THREE.Float32BufferAttribute(tid, 1));
    g.computeBoundingSphere();
    const m = new THREE.ShaderMaterial({ uniforms: { uNow: { value: 0 }, uClock: { value: 0 }, uSel: { value: -1 }, uHover: { value: -1 } }, vertexShader: TRACK_VERT, fragmentShader: TRACK_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const lines = new THREE.LineSegments(g, m);
    return { lines, tid };
  }, [scene.tracks]);
  useEffect(() => () => {
    built.lines.geometry.dispose();
    (built.lines.material as THREE.Material).dispose();
  }, [built]);
  const mat = built.lines.material as THREE.ShaderMaterial;
  useEffect(() => {
    mat.uniforms.uNow!.value = toTrackHours(timeMs);
    mat.uniforms.uSel!.value = scene.tracks.findIndex((t) => t.id === selectedId);
    mat.uniforms.uHover!.value = hoverIdx;
    invalidate();
  }, [mat, timeMs, selectedId, hoverIdx, scene.tracks, invalidate]);

  // eyes of storms in progress at the scrubbed time
  const eyes = useMemo(() => scene.tracks.map((t, i) => ({ t, i, p: trackPos(t, timeMs) })).filter((e) => e.p), [scene.tracks, timeMs]);
  const eyeGroup = useRef<THREE.Group>(null);
  useFrame((st) => {
    if (!reduced) {
      mat.uniforms.uClock!.value = st.clock.elapsedTime;
      eyeGroup.current?.children.forEach((c) => {
        c.rotateZ(-0.05);
      });
    }
  });
  return (
    <group>
      <primitive
        object={built.lines}
        onPointerMove={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          const ti = e.index != null ? built.tid[e.index] : undefined;
          const t = ti != null ? scene.tracks[ti] : undefined;
          if (t) {
            setHoverIdx(ti!);
            onHover({ title: `${t.name.startsWith("Unnamed") ? t.name : `Cyclone ${t.name}`} (${t.season})`, sub: `max ${t.maxWindKt} kt · closest ${t.closestKm} km to ${t.closestTo}${t.active ? " · ACTIVE" : ""}`, color: categoryColor(t.maxCategory), ...screenXY(e) });
          }
        }}
        onPointerOut={() => {
          setHoverIdx(-1);
          onHover(null);
        }}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          const ti = e.index != null ? built.tid[e.index] : undefined;
          if (ti != null && scene.tracks[ti]) onSelect({ kind: "cyclone", id: scene.tracks[ti]!.id });
        }}
      />
      <group ref={eyeGroup}>
        {eyes.map(({ t, p }) => (
          <mesh
            key={t.id}
            position={p!.clone().multiplyScalar(1.012)}
            quaternion={new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), p!)}
            onClick={(e) => {
              e.stopPropagation();
              onSelect({ kind: "cyclone", id: t.id });
            }}
          >
            <torusGeometry args={[0.022, 0.004, 8, 32, Math.PI * 1.6]} />
            <meshBasicMaterial color={categoryColor(t.maxCategory)} toneMapped={false} transparent opacity={0.95} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

// ─── Flows ────────────────────────────────────────────────────────────────

const COMMODITY_COLORS: Record<string, string> = { rice: "#fde68a", jute: "#86efac", vegetables: "#6ee7b7", sugarcane: "#f9a8d4", wheat: "#fcd34d", maize: "#fdba74" };

function Flows({ scene, reduced, onSelect, onHover }: { scene: TwinScene; reduced: boolean; onSelect: (s: Selection) => void; onHover: (h: HoverInfo | null) => void }) {
  const invalidate = useThree((s) => s.invalidate);
  const built = useMemo(() => {
    const arcs: THREE.Vector3[][] = [];
    const pos: number[] = [];
    const ts: number[] = [];
    const cols: number[] = [];
    const owner: number[] = [];
    const c = new THREE.Color();
    const maxT = Math.max(1, ...scene.flows.map((f) => f.tonnesPerWeek));
    scene.flows.forEach((f, fi) => {
      const N = 48;
      const path = slerpPath(f.from, f.to, N);
      const va = V(f.from.lat, f.from.lon).normalize();
      const vb = V(f.to.lat, f.to.lon).normalize();
      const ang = va.angleTo(vb);
      const lift = 0.006 + ang * 0.35;
      const arc = path.map((v, i) => {
        const t = i / (N - 1);
        return new THREE.Vector3(...v).multiplyScalar(1.002 + Math.sin(Math.PI * t) * lift);
      });
      arcs.push(arc);
      c.set(COMMODITY_COLORS[f.commodity] ?? "#e2e8f0");
      for (let i = 0; i < N - 1; i++) {
        for (const k of [i, i + 1]) {
          pos.push(arc[k]!.x, arc[k]!.y, arc[k]!.z);
          ts.push(k / (N - 1));
          cols.push(c.r, c.g, c.b);
          owner.push(fi);
        }
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("aT", new THREE.Float32BufferAttribute(ts, 1));
    g.setAttribute("aColor", new THREE.Float32BufferAttribute(cols, 3));
    g.computeBoundingSphere();
    const lines = new THREE.LineSegments(g, new THREE.ShaderMaterial({ vertexShader: ARC_VERT, fragmentShader: ARC_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    // particles: count ∝ tonnes
    const parts: { arc: number; phase: number; speed: number }[] = [];
    scene.flows.forEach((f, fi) => {
      const k = 3 + Math.round((f.tonnesPerWeek / maxT) * 11);
      for (let j = 0; j < k; j++) parts.push({ arc: fi, phase: j / k, speed: 0.08 + 0.04 * ((fi * 7) % 5) / 5 });
    });
    const pg = new THREE.BufferGeometry();
    pg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(Math.max(1, parts.length) * 3), 3));
    const pc = new Float32Array(Math.max(1, parts.length) * 3);
    const psz = new Float32Array(Math.max(1, parts.length));
    parts.forEach((p, i) => {
      c.set(COMMODITY_COLORS[scene.flows[p.arc]!.commodity] ?? "#e2e8f0");
      pc.set([c.r, c.g, c.b], i * 3);
      psz[i] = 11;
    });
    pg.setAttribute("aColor", new THREE.BufferAttribute(pc, 3));
    pg.setAttribute("aSize", new THREE.BufferAttribute(psz, 1));
    const points = new THREE.Points(pg, new THREE.ShaderMaterial({ vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    points.frustumCulled = false;
    points.raycast = () => null;
    return { lines, points, arcs, parts, owner };
  }, [scene.flows]);
  useEffect(() => () => {
    built.lines.geometry.dispose();
    (built.lines.material as THREE.Material).dispose();
    built.points.geometry.dispose();
    (built.points.material as THREE.Material).dispose();
  }, [built]);
  const place = (time: number) => {
    const attr = built.points.geometry.getAttribute("position") as THREE.BufferAttribute;
    built.parts.forEach((p, i) => {
      const arc = built.arcs[p.arc]!;
      const t = (time * p.speed + p.phase) % 1;
      const f = t * (arc.length - 1);
      const a = Math.floor(f);
      const b = Math.min(arc.length - 1, a + 1);
      const k = f - a;
      const pa = arc[a]!;
      const pb = arc[b]!;
      attr.setXYZ(i, pa.x + (pb.x - pa.x) * k, pa.y + (pb.y - pa.y) * k, pa.z + (pb.z - pa.z) * k);
    });
    attr.needsUpdate = true;
  };
  useEffect(() => {
    place(0.35);
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [built]);
  useFrame((st) => {
    if (!reduced) place(st.clock.elapsedTime);
  });
  return (
    <group>
      <primitive
        object={built.lines}
        onPointerMove={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          const f = e.index != null ? scene.flows[built.owner[e.index] ?? -1] : undefined;
          if (f) onHover({ title: `${f.from.name} → ${f.to.name}`, sub: `${f.commodity} · ${f.tonnesPerWeek.toLocaleString("en-US")} t/week`, color: COMMODITY_COLORS[f.commodity] ?? "#e2e8f0", ...screenXY(e) });
        }}
        onPointerOut={() => onHover(null)}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          const f = e.index != null ? scene.flows[built.owner[e.index] ?? -1] : undefined;
          if (f) onSelect({ kind: "flow", id: f.id });
        }}
      />
      <primitive object={built.points} />
    </group>
  );
}

// ─── Selection beacon ─────────────────────────────────────────────────────

function Beacon({ at, reduced }: { at: { lat: number; lon: number } | null; reduced: boolean }) {
  const ref = useRef<THREE.Mesh>(null);
  const ref2 = useRef<THREE.Mesh>(null);
  useFrame((st) => {
    if (!ref.current || !ref2.current) return;
    const p = reduced ? 0.4 : (st.clock.elapsedTime * 0.8) % 1;
    ref.current.scale.setScalar(0.01 + p * 0.03);
    (ref.current.material as THREE.MeshBasicMaterial).opacity = 1 - p;
    const p2 = reduced ? 0.8 : (p + 0.5) % 1;
    ref2.current.scale.setScalar(0.01 + p2 * 0.03);
    (ref2.current.material as THREE.MeshBasicMaterial).opacity = 1 - p2;
  });
  if (!at) return null;
  const n = V(at.lat, at.lon).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
  const p = n.clone().multiplyScalar(1.004);
  return (
    <group>
      {[ref, ref2].map((r, i) => (
        <mesh key={i} ref={r} position={p} quaternion={q} raycast={() => null}>
          <ringGeometry args={[0.9, 1, 64]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.8} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

// ─── Camera rig: initial view, fly-to, LOD, auto-rotate, fps ──────────────

function CameraRig({ initial, fly, reduced, autoRotate, onLod, fpsRef }: { initial: { lat: number; lon: number; dist: number }; fly: FlyTarget | null; reduced: boolean; autoRotate: boolean; onLod: (near: boolean) => void; fpsRef?: MutableRefObject<HTMLElement | null> }) {
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const controls = useRef<{ enabled: boolean; rotateSpeed: number; update: () => void } | null>(null);
  const flight = useRef<{ from: THREE.Vector3; to: THREE.Vector3; d0: number; d1: number; t0: number; dur: number } | null>(null);
  const lod = useRef<boolean | null>(null);
  const frames = useRef({ n: 0, t: performance.now() });
  const idleSince = useRef(performance.now());

  const size = useThree((s) => s.size);
  // narrow (portrait) viewports need to stand further back to frame the same region
  const aspectK = (d: number) => {
    const a = size.width / Math.max(1, size.height);
    return a < 1 ? 1 + (d - 1) * Math.min(1.9, 1 / Math.pow(Math.max(0.35, a), 0.85)) : d;
  };
  useEffect(() => {
    camera.position.copy(V(initial.lat, initial.lon).normalize().multiplyScalar(aspectK(initial.dist)));
    camera.lookAt(0, 0, 0);
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!fly) return;
    const to = V(fly.lat, fly.lon).normalize();
    const from = camera.position.clone().normalize();
    const d0 = camera.position.length();
    if (reduced) {
      camera.position.copy(to.multiplyScalar(aspectK(fly.dist)));
      camera.lookAt(0, 0, 0);
      controls.current?.update();
      invalidate();
      return;
    }
    const ang = from.angleTo(to);
    flight.current = { from, to, d0, d1: aspectK(fly.dist), t0: performance.now(), dur: 900 + Math.min(1600, ang * 1100) };
    if (controls.current) controls.current.enabled = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fly?.key]);

  useFrame((_, delta) => {
    const f = flight.current;
    if (f) {
      const t = Math.min(1, (performance.now() - f.t0) / f.dur);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      const dir = f.from.clone().lerp(f.to, e);
      if (dir.lengthSq() < 1e-6) dir.copy(f.to);
      dir.normalize();
      // rise a little mid-flight for long hops
      const hop = Math.sin(Math.PI * e) * Math.min(0.9, f.from.angleTo(f.to) * 0.6);
      const d = f.d0 + (f.d1 - f.d0) * e + hop;
      camera.position.copy(dir.multiplyScalar(d));
      camera.lookAt(0, 0, 0);
      if (t >= 1) {
        flight.current = null;
        if (controls.current) {
          controls.current.enabled = true;
          controls.current.update();
        }
      }
      invalidate();
    } else if (autoRotate && !reduced && performance.now() - idleSince.current > 4000) {
      // slow drift around the polar axis
      const p = camera.position;
      const a = delta * 0.03;
      const x = p.x * Math.cos(a) - p.z * Math.sin(a);
      const z = p.x * Math.sin(a) + p.z * Math.cos(a);
      p.set(x, p.y, z);
      camera.lookAt(0, 0, 0);
    }
    const dist = camera.position.length();
    if (controls.current) controls.current.rotateSpeed = Math.max(0.08, Math.min(0.6, (dist - 1) * 0.35));
    const near = lod.current ? dist < 2.15 : dist < 1.9;
    if (near !== lod.current) {
      lod.current = near;
      onLod(near);
    }
    const fr = frames.current;
    fr.n++;
    const now = performance.now();
    if (now - fr.t >= 1000) {
      const fps = Math.round((fr.n * 1000) / (now - fr.t));
      if (fpsRef?.current) fpsRef.current.textContent = `${fps} fps`;
      (window as unknown as { __twinFps?: number }).__twinFps = fps;
      fr.n = 0;
      fr.t = now;
    }
  });

  return (
    <OrbitControls
      ref={controls as never}
      makeDefault
      enablePan={false}
      enableDamping={!reduced}
      dampingFactor={0.08}
      minDistance={1.16}
      maxDistance={6}
      zoomSpeed={0.7}
      rotateSpeed={0.5}
      onStart={() => {
        idleSince.current = performance.now();
        flight.current = null;
        if (controls.current) controls.current.enabled = true;
      }}
      onEnd={() => {
        idleSince.current = performance.now();
      }}
    />
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────

function GlobeInner(p: GlobeProps & { dprSet: (d: number) => void }) {
  const { scene, assetScores, districtScores, timeMs, layers, selected, onSelect, onHover, fly, reducedMotion, autoRotate, initialView, fpsRef } = p;
  const [near, setNear] = useState(false);
  const sun = useMemo(() => {
    const s = sunPosition(timeMs);
    return V(s.lat, s.lon).normalize();
  }, [timeMs]);

  const hasAssets = scene.assets.length > 0;
  const maxVal = useMemo(() => Math.max(1, ...scene.assets.map((a) => a.valueUsd)), [scene.assets]);
  const noun = scene.org.assetNoun;

  const assetItems: PillarItem[] = useMemo(
    () =>
      scene.assets.map((a, i) => ({
        id: a.id,
        kind: "asset" as const,
        lat: a.lat,
        lon: a.lon,
        height: 0.012 + 0.13 * Math.sqrt(a.valueUsd / maxVal),
        width: 0.0014,
        score: assetScores[i] ?? a.score,
        title: a.name,
        sub: `${a.type.replace(/_/g, " ")} · risk ${Math.round(assetScores[i] ?? a.score)}/100 · ${fmtUsd(a.valueUsd)}`,
      })),
    [scene.assets, assetScores, maxVal]
  );

  const clusterItems: PillarItem[] = useMemo(() => {
    if (!hasAssets) {
      const maxF = Math.max(1, ...scene.districts.map((d) => d.farms));
      return scene.districts.map((d, i) => ({
        id: d.id,
        kind: "district" as const,
        lat: d.lat,
        lon: d.lon,
        height: 0.02 + 0.16 * Math.sqrt(d.farms / maxF),
        width: 0.0026,
        score: districtScores[i] ?? d.composite,
        title: d.name,
        sub: `${d.farms.toLocaleString("en-US")} farms · risk ${Math.round(districtScores[i] ?? d.composite)}/100`,
      }));
    }
    const groups = new Map<string, { lat: number; lon: number; exp: number; ws: number; n: number; name: string }>();
    scene.assets.forEach((a, i) => {
      const key = a.districtId ?? `x:${Math.round(a.lat)}:${Math.round(a.lon)}`;
      const d = a.districtId ? scene.districts.find((x) => x.id === a.districtId) : null;
      const g = groups.get(key) ?? { lat: 0, lon: 0, exp: 0, ws: 0, n: 0, name: d?.name ?? a.country };
      g.lat += a.lat;
      g.lon += a.lon;
      g.exp += a.valueUsd;
      g.ws += (assetScores[i] ?? a.score) * Math.max(1, a.valueUsd);
      g.n++;
      groups.set(key, g);
    });
    const maxE = Math.max(1, ...[...groups.values()].map((g) => g.exp));
    return [...groups.entries()].map(([key, g]) => {
      const score = g.ws / Math.max(1, g.exp || g.n);
      return {
        id: key,
        kind: "cluster" as const,
        lat: g.lat / g.n,
        lon: g.lon / g.n,
        height: 0.02 + 0.2 * Math.sqrt(g.exp / maxE),
        width: 0.0036,
        score,
        title: g.name,
        sub: `${g.n} ${noun} · ${fmtUsd(g.exp)} · avg risk ${Math.round(score)}/100`,
      };
    });
  }, [hasAssets, scene.assets, scene.districts, assetScores, districtScores, noun]);

  const visibleHazards = useMemo(() => new Set(scene.hazards.filter((h) => Date.parse(h.date) <= timeMs + 86_400_000).map((h) => h.id)), [scene.hazards, timeMs]);

  const beaconAt = useMemo(() => {
    if (!selected) return null;
    const { kind, id } = selected;
    if (kind === "asset") return scene.assets.find((a) => a.id === id) ?? null;
    if (kind === "district") return scene.districts.find((d) => d.id === id) ?? null;
    if (kind === "hazard") return scene.hazards.find((h) => h.id === id) ?? null;
    if (kind === "cluster") {
      const c = clusterItems.find((x) => x.id === id);
      return c ? { lat: c.lat, lon: c.lon } : null;
    }
    if (kind === "cyclone") {
      const t = scene.tracks.find((x) => x.id === id);
      if (!t) return null;
      const p = trackPos(t, timeMs);
      if (p) {
        const r = Math.hypot(p.x, p.y, p.z);
        return { lat: 90 - (Math.acos(p.y / r) * 180) / Math.PI, lon: ((Math.atan2(p.z, -p.x) * 180) / Math.PI - 180 + 540) % 360 - 180 };
      }
      const pk = t.points.reduce((b, q) => ((q[3] ?? -1) > (b[3] ?? -1) ? q : b), t.points[0]!);
      return { lat: pk[1], lon: pk[2] };
    }
    if (kind === "flow") {
      const f = scene.flows.find((x) => x.id === id);
      return f ? f.to : null;
    }
    return null;
  }, [selected, scene, clusterItems, timeMs]);

  const selId = selected?.id ?? null;
  const pillars = hasAssets ? (near ? assetItems : clusterItems) : clusterItems;

  return (
    <>
      <PerformanceMonitor onDecline={() => p.dprSet(1)} onIncline={() => p.dprSet(Math.min(1.75, window.devicePixelRatio || 1))} />
      <Stars />
      <Earth sun={sun} night={layers.terminator} onEmpty={() => onSelect(null)} onHoverNone={() => onHover(null)} />
      {layers.graticule && <Graticule />}
      {layers.districts && <DistrictCaps scene={scene} scores={districtScores} onSelect={onSelect} onHover={onHover} selectedId={selected?.kind === "district" ? selId : null} />}
      {layers.assets && pillars.length > 0 && <Pillars items={pillars} onSelect={onSelect} onHover={onHover} selectedId={selId} heightScale={near ? 0.45 : 1} />}
      {layers.hazards && scene.hazards.length > 0 && <Hazards scene={scene} visibleIds={visibleHazards} onSelect={onSelect} onHover={onHover} reduced={reducedMotion} />}
      {layers.cyclones && scene.tracks.length > 0 && <Cyclones scene={scene} timeMs={timeMs} selectedId={selected?.kind === "cyclone" ? selId : null} onSelect={onSelect} onHover={onHover} reduced={reducedMotion} />}
      {layers.flows && scene.flows.length > 0 && <Flows scene={scene} reduced={reducedMotion} onSelect={onSelect} onHover={onHover} />}
      <Beacon at={beaconAt} reduced={reducedMotion} />
      <CameraRig initial={initialView} fly={fly} reduced={reducedMotion} autoRotate={!!autoRotate} onLod={setNear} fpsRef={fpsRef} />
    </>
  );
}

function Globe(props: GlobeProps) {
  const [dpr, setDpr] = useState(() => (typeof window === "undefined" ? 1 : Math.min(1.75, window.devicePixelRatio || 1)));
  return (
    // theme-island: the 3D scene is space-dark in every theme, so its in-scene labels keep Mission Control ink
    <div className={`theme-island ${props.className ?? "absolute inset-0"}`} data-testid="twin-globe">
      <Canvas
        dpr={dpr}
        frameloop={props.reducedMotion ? "demand" : "always"}
        camera={{ fov: 40, near: 0.01, far: 200, position: [0, 0, 3] }}
        gl={{ antialias: true, powerPreference: "high-performance", alpha: false }}
        raycaster={{ params: { Line: { threshold: 0.006 }, Points: { threshold: 0.01 }, Mesh: {}, LOD: {}, Sprite: {} } }}
        onCreated={({ gl, scene: s3 }) => {
          gl.setClearColor("#01040c");
          // diagnostics hook (renderer stats for ops/QA tooling)
          (window as unknown as { __twin?: unknown }).__twin = { gl, scene: s3 };
        }}
        onPointerMissed={() => props.onHover(null)}
        aria-label="3D globe of your workspace"
        role="img"
      >
        <GlobeInner {...props} dprSet={setDpr} />
      </Canvas>
    </div>
  );
}

export default memo(Globe);
