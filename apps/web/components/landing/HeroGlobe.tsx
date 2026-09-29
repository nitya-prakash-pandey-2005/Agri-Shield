"use client";

/**
 * Asia-centred operations globe (three.js, no r3f to keep the chunk lean).
 *  - dot-matrix continents sampled from a NASA GIBS land mask (/globe/land-mask.png)
 *  - one beacon per monitored district, coloured + sized by LIVE risk (public.riskMap)
 *  - flowing amber "salinity creep" arcs from the sea into salt-exposed districts
 *  - fresnel atmosphere, gentle auto-yaw around Asia, drag to rotate, hover to inspect
 * Always load through next/dynamic({ ssr:false }); GlobeStage handles reduced motion.
 */
import { useEffect, useRef } from "react";
import * as THREE from "three";

export interface GlobeMarker {
  id: string;
  name: string;
  country: string;
  countryCode: string;
  lat: number;
  lon: number;
  flood: number;
  salinity: number;
}

const DEG = Math.PI / 180;
export const GLOBE_CENTER = { lat: 15, lon: 100 };

/** Offshore direction (Δlat, Δlon) per coast, used to start salinity arcs at sea. */
const SEAWARD: Record<string, [number, number]> = {
  BD: [-1.6, 0.2],
  VN: [-1.0, 1.1],
  PH: [-0.9, -0.6],
  IN: [-1.1, 1.3],
  ID: [1.3, 0.1],
};

function toVec(lat: number, lon: number, r = 1) {
  const phi = (90 - lat) * DEG;
  const theta = (lon + 180) * DEG;
  return new THREE.Vector3(-r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
}

export function riskHex(score: number) {
  return score >= 80 ? 0xa78bfa : score >= 60 ? 0xf87171 : score >= 35 ? 0xfbbf24 : 0x4ade80;
}

async function loadLandMask(): Promise<((lat: number, lon: number) => boolean) | null> {
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = "/globe/land-mask.png";
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
    return (lat, lon) => {
      const x = Math.min(width - 1, Math.floor(((lon + 180) / 360) * width));
      const y = Math.min(height - 1, Math.floor(((90 - lat) / 180) * height));
      return data[(y * width + x) * 4]! > 127;
    };
  } catch {
    return null;
  }
}

const ATMOSPHERE_VERT = `
varying vec3 vNormal;
void main() {
  vNormal = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const ATMOSPHERE_FRAG = `
varying vec3 vNormal;
uniform vec3 uColor;
void main() {
  float i = pow(0.62 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 4.0);
  gl_FragColor = vec4(uColor, 1.0) * i * 0.9;
}`;

const ARC_VERT = `
attribute float aT;
varying float vT;
void main() {
  vT = aT;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const ARC_FRAG = `
uniform float uTime;
uniform float uOffset;
uniform vec3 uColor;
varying float vT;
void main() {
  float head = fract(uTime * 0.28 + uOffset);
  float d = head - vT;
  if (d < 0.0) d += 1.0;
  float trail = smoothstep(0.45, 0.0, d);
  float base = 0.14;
  gl_FragColor = vec4(uColor, base + trail * 0.95);
}`;

export default function HeroGlobe({
  markers,
  onHover,
  className,
}: {
  markers: GlobeMarker[];
  onHover?: (m: GlobeMarker | null, pos: { x: number; y: number } | null) => void;
  className?: string;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<{ setMarkers: (m: GlobeMarker[]) => void } | null>(null);
  const hoverRef = useRef(onHover);
  hoverRef.current = onHover;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let disposed = false;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.style.touchAction = "pan-y";
    renderer.domElement.setAttribute("aria-hidden", "true");
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
    camera.position.set(0, 0, 4.1);

    const tilt = new THREE.Group();
    tilt.rotation.x = GLOBE_CENTER.lat * DEG;
    scene.add(tilt);
    const spin = new THREE.Group();
    const baseYaw = (-90 - GLOBE_CENTER.lon) * DEG;
    spin.rotation.y = baseYaw;
    tilt.add(spin);

    // Ocean
    const ocean = new THREE.Mesh(
      new THREE.SphereGeometry(1, 72, 72),
      new THREE.MeshBasicMaterial({ color: 0x07182b })
    );
    spin.add(ocean);

    // Atmosphere (fresnel, additive)
    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(1.12, 64, 64),
      new THREE.ShaderMaterial({
        vertexShader: ATMOSPHERE_VERT,
        fragmentShader: ATMOSPHERE_FRAG,
        uniforms: { uColor: { value: new THREE.Color(0x2dd4bf) } },
        blending: THREE.AdditiveBlending,
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
      })
    );
    scene.add(atmosphere);

    // Graticule
    const gratMat = new THREE.LineBasicMaterial({ color: 0x34d399, transparent: true, opacity: 0.07 });
    for (let lat = -60; lat <= 60; lat += 30) {
      const pts: THREE.Vector3[] = [];
      for (let lon = -180; lon <= 180; lon += 4) pts.push(toVec(lat, lon, 1.002));
      spin.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), gratMat));
    }
    for (let lon = -180; lon < 180; lon += 30) {
      const pts: THREE.Vector3[] = [];
      for (let lat = -90; lat <= 90; lat += 4) pts.push(toVec(lat, lon, 1.002));
      spin.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), gratMat));
    }

    // Land dots (async)
    let landGeo: THREE.BufferGeometry | null = null;
    const landMat = new THREE.PointsMaterial({ color: 0x5eead4, size: 0.0125, sizeAttenuation: true, transparent: true, opacity: 0.75, depthWrite: false });
    loadLandMask().then((isLand) => {
      if (disposed || !isLand) return;
      const N = 52_000;
      const pos: number[] = [];
      const golden = Math.PI * (3 - Math.sqrt(5));
      for (let i = 0; i < N; i++) {
        const y = 1 - (i / (N - 1)) * 2;
        const r = Math.sqrt(1 - y * y);
        const th = golden * i;
        const x = Math.cos(th) * r;
        const z = Math.sin(th) * r;
        const lat = Math.asin(y) / DEG;
        // invert toVec: theta = atan2(z, -x)
        let lon = Math.atan2(z, -x) / DEG - 180;
        if (lon < -180) lon += 360;
        if (isLand(lat, lon)) pos.push(x * 1.004, y * 1.004, z * 1.004);
      }
      landGeo = new THREE.BufferGeometry();
      landGeo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      spin.add(new THREE.Points(landGeo, landMat));
    });

    // Stars
    const starPos = new Float32Array(900 * 3);
    for (let i = 0; i < 900; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(18 + Math.random() * 20);
      starPos.set([v.x, v.y, v.z], i * 3);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
    const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0x9fb4cc, size: 0.05, transparent: true, opacity: 0.5, depthWrite: false }));
    scene.add(stars);

    // ── Markers + arcs (rebuilt when live data changes) ──────────────────────
    const markerGroup = new THREE.Group();
    spin.add(markerGroup);
    let rings: { mesh: THREE.Mesh; phase: number; speed: number }[] = [];
    let arcMats: THREE.ShaderMaterial[] = [];
    let hitMeshes: THREE.Mesh[] = [];
    const ringGeo = new THREE.RingGeometry(0.018, 0.024, 40);
    const coreGeo = new THREE.SphereGeometry(0.011, 12, 12);
    const hitGeo = new THREE.SphereGeometry(0.045, 8, 8);
    const hitMat = new THREE.MeshBasicMaterial({ visible: false });
    const Z = new THREE.Vector3(0, 0, 1);

    const clearMarkers = () => {
      markerGroup.children.slice().forEach((c) => {
        markerGroup.remove(c);
        const m = c as THREE.Mesh;
        if (m.geometry && m.geometry !== ringGeo && m.geometry !== coreGeo && m.geometry !== hitGeo) m.geometry.dispose();
        const mat = m.material as THREE.Material | undefined;
        if (mat && mat !== hitMat) mat.dispose();
      });
      rings = [];
      arcMats = [];
      hitMeshes = [];
    };

    const setMarkers = (list: GlobeMarker[]) => {
      clearMarkers();
      list.forEach((m, idx) => {
        const score = Math.max(m.flood, m.salinity);
        const color = riskHex(score);
        const n = toVec(m.lat, m.lon, 1).normalize();

        const core = new THREE.Mesh(coreGeo, new THREE.MeshBasicMaterial({ color }));
        core.position.copy(n.clone().multiplyScalar(1.006));
        markerGroup.add(core);

        const hit = new THREE.Mesh(hitGeo, hitMat);
        hit.position.copy(core.position);
        hit.userData.marker = m;
        markerGroup.add(hit);
        hitMeshes.push(hit);

        const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
        ring.position.copy(n.clone().multiplyScalar(1.007));
        ring.quaternion.setFromUnitVectors(Z, n);
        markerGroup.add(ring);
        rings.push({ mesh: ring, phase: (idx * 0.37) % 1, speed: 0.45 + (score / 100) * 0.6 });

        // risk beam: taller = riskier
        const h = 0.04 + (score / 100) * 0.22;
        const beamGeo = new THREE.BufferGeometry().setFromPoints([n.clone().multiplyScalar(1.004), n.clone().multiplyScalar(1 + h)]);
        const beam = new THREE.Line(beamGeo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
        markerGroup.add(beam);

        // salinity creep arc from the sea
        const sw = SEAWARD[m.countryCode];
        if (sw && m.salinity >= 30) {
          const from = toVec(m.lat + sw[0], m.lon + sw[1], 1.003);
          const to = toVec(m.lat, m.lon, 1.003);
          const mid = from.clone().add(to).multiplyScalar(0.5).normalize().multiplyScalar(1.03 + from.distanceTo(to) * 0.35);
          const curve = new THREE.QuadraticBezierCurve3(from, mid, to);
          const pts = curve.getPoints(48);
          const g = new THREE.BufferGeometry().setFromPoints(pts);
          g.setAttribute("aT", new THREE.Float32BufferAttribute(pts.map((_, i) => i / (pts.length - 1)), 1));
          const mat = new THREE.ShaderMaterial({
            vertexShader: ARC_VERT,
            fragmentShader: ARC_FRAG,
            uniforms: { uTime: { value: 0 }, uOffset: { value: (idx * 0.21) % 1 }, uColor: { value: new THREE.Color(m.salinity >= 60 ? 0xfb923c : 0xfbbf24) } },
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          });
          arcMats.push(mat);
          markerGroup.add(new THREE.Line(g, mat));
        }
      });
    };
    apiRef.current = { setMarkers };

    // ── Interaction ──────────────────────────────────────────────────────────
    let dragYaw = 0;
    let dragPitch = 0;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let hovered: GlobeMarker | null = null;

    const onDown = (e: PointerEvent) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const onUp = () => (dragging = false);
    const onMove = (e: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      if (dragging) {
        dragYaw = Math.max(-1.3, Math.min(1.3, dragYaw + (e.clientX - lastX) * 0.005));
        dragPitch = Math.max(-0.35, Math.min(0.35, dragPitch + (e.clientY - lastY) * 0.003));
        lastX = e.clientX;
        lastY = e.clientY;
      }
      pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(hitMeshes, false)[0];
      // ignore markers on the far side (occluded by ocean)
      const oceanHit = raycaster.intersectObject(ocean, false)[0];
      const m = hit && (!oceanHit || hit.distance <= oceanHit.distance + 0.02) ? (hit.object.userData.marker as GlobeMarker) : null;
      if (m !== hovered) {
        hovered = m;
        renderer.domElement.style.cursor = m ? "pointer" : dragging ? "grabbing" : "grab";
      }
      hoverRef.current?.(m, m ? { x: e.clientX - rect.left, y: e.clientY - rect.top } : null);
    };
    const onLeave = () => {
      dragging = false;
      hovered = null;
      hoverRef.current?.(null, null);
    };
    renderer.domElement.style.cursor = "grab";
    renderer.domElement.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);
    renderer.domElement.addEventListener("pointermove", onMove);
    renderer.domElement.addEventListener("pointerleave", onLeave);

    // ── Sizing & visibility ──────────────────────────────────────────────────
    const resize = () => {
      const w = mount.clientWidth || 600;
      const h = mount.clientHeight || 600;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      camera.aspect = w / h;
      // keep the globe fully in frame on narrow screens
      camera.position.z = w / h < 0.9 ? 4.1 / Math.max(0.62, w / h) : 4.1;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(mount);
    resize();

    let visible = true;
    const io = new IntersectionObserver(([e]) => (visible = !!e?.isIntersecting), { threshold: 0 });
    io.observe(mount);

    // ── Loop ─────────────────────────────────────────────────────────────────
    const clock = new THREE.Clock();
    let raf = 0;
    let entrance = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (!visible || document.hidden) return;
      const t = clock.getElapsedTime();
      entrance = Math.min(1, entrance + 0.012);
      const ease = 1 - Math.pow(1 - entrance, 3);
      const autoYaw = Math.sin(t * 0.07) * 0.42;
      const targetYaw = baseYaw + autoYaw + dragYaw + (1 - ease) * 1.6;
      spin.rotation.y += (targetYaw - spin.rotation.y) * 0.08;
      tilt.rotation.x += (GLOBE_CENTER.lat * DEG + dragPitch - tilt.rotation.x) * 0.08;
      if (!dragging) {
        dragPitch *= 0.985;
      }
      const s = 0.86 + 0.14 * ease;
      tilt.scale.setScalar(s);
      atmosphere.scale.setScalar(s);

      for (const r of rings) {
        const p = (t * r.speed + r.phase) % 1;
        r.mesh.scale.setScalar(1 + p * 2.6);
        (r.mesh.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - p);
      }
      for (const m of arcMats) m.uniforms.uTime!.value = t;
      stars.rotation.y = t * 0.004;
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      window.removeEventListener("pointerup", onUp);
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointermove", onMove);
      renderer.domElement.removeEventListener("pointerleave", onLeave);
      clearMarkers();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose?.();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose?.();
      });
      landGeo?.dispose();
      ringGeo.dispose();
      coreGeo.dispose();
      hitGeo.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
      apiRef.current = null;
    };
  }, []);

  useEffect(() => {
    apiRef.current?.setMarkers(markers);
  }, [markers]);

  return <div ref={mountRef} className={className ?? "h-full w-full"} />;
}
