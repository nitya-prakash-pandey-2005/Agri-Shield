"use client";

import { useRef, useEffect, useState } from "react";
import * as THREE from "three";

// Simplified Asia-centered globe using Three.js
export function HeroGlobe() {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<{
    renderer: THREE.WebGLRenderer;
    animId: number;
  } | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const width = mount.clientWidth || 600;
    const height = mount.clientHeight || 600;

    // Scene
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.z = 2.8;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);

    // Globe sphere
    const geometry = new THREE.SphereGeometry(1, 64, 64);

    // Ocean material
    const oceanMat = new THREE.MeshPhongMaterial({
      color: 0x0a2444,
      emissive: 0x001122,
      transparent: true,
      opacity: 0.95,
      shininess: 80,
    });
    const globe = new THREE.Mesh(geometry, oceanMat);
    scene.add(globe);

    // Atmosphere glow
    const atmGeo = new THREE.SphereGeometry(1.05, 64, 64);
    const atmMat = new THREE.MeshPhongMaterial({
      color: 0x22c55e,
      emissive: 0x16a34a,
      transparent: true,
      opacity: 0.05,
      side: THREE.BackSide,
    });
    scene.add(new THREE.Mesh(atmGeo, atmMat));

    // Outer glow ring
    const glowGeo = new THREE.SphereGeometry(1.12, 64, 64);
    const glowMat = new THREE.MeshPhongMaterial({
      color: 0x22c55e,
      emissive: 0x16a34a,
      transparent: true,
      opacity: 0.02,
      side: THREE.BackSide,
    });
    scene.add(new THREE.Mesh(glowGeo, glowMat));

    // Grid lines (lat/lon)
    const gridMat = new THREE.LineBasicMaterial({
      color: 0x22c55e,
      transparent: true,
      opacity: 0.12,
    });

    // Latitude lines
    for (let lat = -80; lat <= 80; lat += 20) {
      const latRad = (lat * Math.PI) / 180;
      const r = Math.cos(latRad);
      const y = Math.sin(latRad);
      const points: THREE.Vector3[] = [];
      for (let i = 0; i <= 64; i++) {
        const theta = (i / 64) * Math.PI * 2;
        points.push(new THREE.Vector3(r * Math.cos(theta), y, r * Math.sin(theta)));
      }
      scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), gridMat));
    }

    // Longitude lines
    for (let lon = 0; lon < 360; lon += 30) {
      const lonRad = (lon * Math.PI) / 180;
      const points: THREE.Vector3[] = [];
      for (let i = 0; i <= 64; i++) {
        const phi = ((i / 64) * Math.PI * 2) - Math.PI;
        const x = Math.cos(phi) * Math.cos(lonRad);
        const y = Math.sin(phi);
        const z = Math.cos(phi) * Math.sin(lonRad);
        points.push(new THREE.Vector3(x, y, z));
      }
      scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), gridMat));
    }

    // Risk pulse points (key Asia locations)
    const riskLocations = [
      // Bangladesh Ganges Delta
      { lat: 23.0, lon: 90.0, color: 0xef4444, intensity: 0.9, size: 0.025 },
      // Mekong Delta Vietnam
      { lat: 10.5, lon: 106.5, color: 0xf59e0b, intensity: 0.7, size: 0.022 },
      // Philippines Central Luzon
      { lat: 15.5, lon: 121.0, color: 0xef4444, intensity: 0.8, size: 0.020 },
      // Odisha India coast
      { lat: 20.5, lon: 85.5, color: 0x7c3aed, intensity: 0.85, size: 0.022 },
      // Java North coast
      { lat: -6.5, lon: 110.0, color: 0xf59e0b, intensity: 0.6, size: 0.018 },
      // Myanmar Delta
      { lat: 17.0, lon: 96.0, color: 0xef4444, intensity: 0.75, size: 0.020 },
      // Sri Lanka
      { lat: 8.0, lon: 80.5, color: 0xf59e0b, intensity: 0.65, size: 0.016 },
      // Pakistan Indus
      { lat: 25.0, lon: 68.0, color: 0x22c55e, intensity: 0.4, size: 0.018 },
    ];

    const pulseMeshes: { mesh: THREE.Mesh; phase: number; baseScale: number }[] = [];

    riskLocations.forEach(({ lat, lon, color, size }) => {
      const latRad = (lat * Math.PI) / 180;
      const lonRad = ((lon - 90) * Math.PI) / 180; // offset to center Asia

      const x = Math.cos(latRad) * Math.cos(lonRad);
      const y = Math.sin(latRad);
      const z = Math.cos(latRad) * Math.sin(lonRad);

      // Dot
      const dotGeo = new THREE.SphereGeometry(size, 16, 16);
      const dotMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 });
      const dot = new THREE.Mesh(dotGeo, dotMat);
      dot.position.set(x, y, z);
      scene.add(dot);

      // Pulse ring
      const ringGeo = new THREE.RingGeometry(size * 1.2, size * 2.5, 32);
      const ringMat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.4,
        side: THREE.DoubleSide,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.set(x * 1.002, y * 1.002, z * 1.002);
      // Orient ring to face outward from sphere center
      ring.lookAt(0, 0, 0);
      ring.rotateX(Math.PI / 2);
      scene.add(ring);

      pulseMeshes.push({
        mesh: ring,
        phase: Math.random() * Math.PI * 2,
        baseScale: 1,
      });
    });

    // Salinity intrusion lines (coastal Bangladesh + Vietnam)
    const salinityPaths = [
      // Bangladesh coast
      [
        [22.5, 91.5], [22.8, 91.0], [23.2, 90.5], [23.5, 90.0],
      ],
      // Vietnam Mekong
      [
        [10.0, 106.0], [10.2, 106.3], [10.5, 106.6], [10.8, 107.0],
      ],
    ];

    salinityPaths.forEach((path) => {
      const points = path.map(([lat, lon]) => {
        const latRad = (lat * Math.PI) / 180;
        const lonRad = ((lon - 90) * Math.PI) / 180;
        return new THREE.Vector3(
          Math.cos(latRad) * Math.cos(lonRad) * 1.002,
          Math.sin(latRad) * 1.002,
          Math.cos(latRad) * Math.sin(lonRad) * 1.002
        );
      });
      const salinityMat = new THREE.LineBasicMaterial({
        color: 0xf59e0b,
        transparent: true,
        opacity: 0.7,
        linewidth: 2,
      });
      scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), salinityMat));
    });

    // Lights
    scene.add(new THREE.AmbientLight(0xffffff, 0.3));
    const sunLight = new THREE.DirectionalLight(0xffffff, 1.2);
    sunLight.position.set(5, 3, 5);
    scene.add(sunLight);
    const fillLight = new THREE.DirectionalLight(0x22c55e, 0.3);
    fillLight.position.set(-5, -3, -5);
    scene.add(fillLight);

    // Rotate globe to center Asia
    globe.rotation.y = -1.1; // Center approx 100°E

    // Stars
    const starGeo = new THREE.BufferGeometry();
    const starCount = 2000;
    const starPositions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount * 3; i++) {
      starPositions[i] = (Math.random() - 0.5) * 100;
    }
    starGeo.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
    const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.08, transparent: true, opacity: 0.6 });
    scene.add(new THREE.Points(starGeo, starMat));

    // Animation loop
    let t = 0;
    const animate = () => {
      t += 0.005;
      globe.rotation.y += 0.0015;

      // Pulse rings
      pulseMeshes.forEach(({ mesh, phase }) => {
        const pulseFactor = 1 + 0.5 * Math.sin(t * 2 + phase);
        mesh.scale.setScalar(pulseFactor);
        (mesh.material as THREE.MeshBasicMaterial).opacity =
          0.4 * (1 - (pulseFactor - 1));
      });

      renderer.render(scene, camera);
      sceneRef.current!.animId = requestAnimationFrame(animate);
    };

    sceneRef.current = { renderer, animId: 0 };
    sceneRef.current.animId = requestAnimationFrame(animate);

    // Resize handler
    const handleResize = () => {
      if (!mount) return;
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      if (sceneRef.current) {
        cancelAnimationFrame(sceneRef.current.animId);
        sceneRef.current.renderer.dispose();
      }
      if (mount.contains(renderer.domElement)) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div
      ref={mountRef}
      className="w-full h-full"
      style={{ minHeight: 500 }}
      aria-label="3D globe showing climate risk zones across Asia"
    />
  );
}

// Lightweight fallback for when Three.js is loading
export function GlobeFallback() {
  return (
    <div className="w-full h-full flex items-center justify-center">
      <div className="relative w-96 h-96">
        <div className="absolute inset-0 rounded-full border border-green-500/20 animate-spin-slow" />
        <div className="absolute inset-4 rounded-full border border-green-500/15 animate-spin-slow" style={{ animationDirection: "reverse", animationDuration: "12s" }} />
        <div className="absolute inset-8 rounded-full border border-green-500/10 animate-spin-slow" style={{ animationDuration: "20s" }} />
        <div className="absolute inset-0 rounded-full"
          style={{
            background: "radial-gradient(ellipse at 35% 35%, rgba(34,197,94,0.15), rgba(10,15,30,0.8))",
          }}
        />
        {/* Risk pulse dots */}
        {[
          { top: "35%", left: "65%", color: "#ef4444" },
          { top: "55%", left: "72%", color: "#f59e0b" },
          { top: "45%", left: "78%", color: "#7c3aed" },
          { top: "60%", left: "55%", color: "#ef4444" },
        ].map((dot, i) => (
          <span
            key={i}
            className="absolute flex h-3 w-3"
            style={{ top: dot.top, left: dot.left }}
          >
            <span
              className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
              style={{ background: dot.color, animationDelay: `${i * 0.5}s` }}
            />
            <span
              className="relative inline-flex rounded-full h-3 w-3"
              style={{ background: dot.color }}
            />
          </span>
        ))}
      </div>
    </div>
  );
}
