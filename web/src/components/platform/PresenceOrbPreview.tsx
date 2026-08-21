"use client";

import { useEffect, useRef, useState } from "react";
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Points,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderer,
} from "three";

export type PresenceOrbVariant = "flow" | "ribbons" | "rings" | "bloom" | "particles";

export const PRESENCE_ORB_OPTIONS: ReadonlyArray<{
  id: PresenceOrbVariant;
  name: string;
  detail: string;
}> = [
  { id: "flow", name: "Aurora flow", detail: "Volumetric liquid currents" },
  { id: "ribbons", name: "Prismatic ribbons", detail: "Interlaced spectral waves" },
  { id: "rings", name: "Resonance lens", detail: "Refractive voice ripples" },
  { id: "bloom", name: "Chromatic bloom", detail: "A breathing energy flower" },
  { id: "particles", name: "Outward particles", detail: "400 GPU dots, sized from 1× to 5×" },
];

const variantNumber: Record<PresenceOrbVariant, number> = {
  flow: 0,
  ribbons: 1,
  rings: 2,
  bloom: 3,
  particles: 4,
};

const planeVertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

/** One fragment program draws all four fields plus the particle backdrop. */
const fieldFragmentShader = /* glsl */ `
  precision highp float;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uLevel;
  uniform float uVariant;
  varying vec2 vUv;
  #define PI 3.14159265359

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.52;
    mat2 turn = mat2(0.80, -0.60, 0.60, 0.80);
    for (int i = 0; i < 5; i++) {
      value += amplitude * noise(p);
      p = turn * p * 2.03 + 0.17;
      amplitude *= 0.49;
    }
    return value;
  }
  vec3 spectral(float t) {
    vec3 cyan = vec3(0.03, 0.83, 1.00);
    vec3 blue = vec3(0.14, 0.29, 1.00);
    vec3 violet = vec3(0.60, 0.12, 1.00);
    vec3 pink = vec3(1.00, 0.16, 0.72);
    vec3 gold = vec3(1.00, 0.62, 0.20);
    t = fract(t);
    if (t < 0.25) return mix(cyan, blue, t * 4.0);
    if (t < 0.50) return mix(blue, violet, (t - 0.25) * 4.0);
    if (t < 0.75) return mix(violet, pink, (t - 0.50) * 4.0);
    return mix(pink, gold, (t - 0.75) * 4.0);
  }
  vec3 flowField(vec2 p, float time, float energy) {
    float radius = length(p);
    float angle = atan(p.y, p.x);
    vec2 warp = p * (3.1 + energy * 0.55);
    float n1 = fbm(warp + vec2(time * 0.21, -time * 0.13));
    float n2 = fbm(warp * 1.33 + vec2(-time * 0.16, time * 0.18) + n1);
    float spiral = sin(angle * 4.0 - radius * 15.0 + time * 1.5 + n2 * 7.0);
    float filaments = pow(0.5 + 0.5 * spiral, 4.0);
    float clouds = smoothstep(0.18, 0.94, n1 + n2 * 0.72);
    vec3 color = spectral(n2 * 0.76 + angle / (2.0 * PI) + time * 0.035);
    color *= 0.18 + clouds * 0.92 + filaments * (0.55 + energy * 0.95);
    color += spectral(n1 + 0.18) * pow(filaments, 2.0) * 0.65;
    return color;
  }
  float ribbon(vec2 p, float offset, float phase, float time, float energy) {
    float wave = sin(p.x * (4.8 + phase) + time * (0.78 + phase * 0.08) + phase) * (0.16 + energy * 0.07);
    wave += sin(p.x * 9.0 - time * 0.46 + phase * 1.7) * 0.045;
    return smoothstep(0.045 + energy * 0.014, 0.004, abs(p.y - offset - wave));
  }
  vec3 ribbonField(vec2 p, float time, float energy) {
    vec3 color = vec3(0.0);
    for (int i = 0; i < 7; i++) {
      float index = float(i);
      float angle = -0.52 + index * 0.17 + sin(time * 0.19 + index) * 0.04;
      mat2 rotation = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
      vec2 q = rotation * p;
      float line = ribbon(q, (index - 3.0) * 0.115, index * 0.71, time, energy);
      float fine = ribbon(q, (index - 3.0) * 0.115 + 0.016, index * 0.71, time, energy);
      color += spectral(index * 0.135 + time * 0.025) * (line * 0.72 + fine * 0.24);
    }
    float crossing = ribbon(vec2(p.y, -p.x), 0.0, 2.7, -time * 0.72, energy);
    color += spectral(0.86 + time * 0.02) * crossing * 0.75;
    return color;
  }
  vec3 ringField(vec2 p, float time, float energy) {
    float angle = atan(p.y, p.x);
    float deformation = fbm(p * 5.0 + vec2(time * 0.17, -time * 0.12)) - 0.5;
    float radius = length(p * vec2(1.0, 1.08)) + deformation * (0.026 + energy * 0.024);
    float phase = radius * (54.0 + energy * 13.0) - time * (2.0 + energy * 2.7);
    float rings = pow(0.5 + 0.5 * cos(phase), 15.0);
    float secondary = pow(0.5 + 0.5 * cos(phase * 0.51 + angle * 2.0), 22.0);
    float center = exp(-radius * (5.4 - energy * 1.2));
    vec3 color = spectral(radius * 1.35 - time * 0.025) * rings * (0.48 + energy * 1.05);
    color += spectral(angle / (2.0 * PI) + 0.58) * secondary * 0.34;
    color += mix(vec3(0.08, 0.45, 1.0), vec3(0.88, 0.22, 1.0), radius) * center * 0.88;
    return color;
  }
  vec3 bloomField(vec2 p, float time, float energy) {
    float radius = length(p);
    float angle = atan(p.y, p.x);
    float rotation = time * (0.22 + energy * 0.36);
    float petalWave = sin(angle * 7.0 - rotation * 4.0 + radius * 9.0);
    float petalShape = 0.23 + (0.12 + energy * 0.045) * petalWave;
    float edge = smoothstep(0.045, 0.0, abs(radius - petalShape));
    float innerPetals = pow(max(0.0, cos(angle * 7.0 + rotation * 3.0 - radius * 7.0)), 4.0);
    float flowing = fbm(p * 5.3 + vec2(cos(rotation), sin(rotation)) * 0.8);
    float body = smoothstep(0.50, 0.05, radius) * (0.16 + innerPetals * 0.62 + flowing * 0.42);
    vec3 color = spectral(angle / (2.0 * PI) + radius * 0.75 - time * 0.025);
    color *= body + edge * (0.75 + energy * 0.9);
    color += spectral(flowing + 0.31) * exp(-radius * (7.5 - energy * 2.0)) * 1.4;
    return color;
  }
  vec3 particleBackdrop(vec2 p, float time, float energy) {
    float radius = length(p);
    float core = exp(-radius * (8.0 - energy * 2.4));
    float cycle = fract(time * 0.18);
    float pulse = exp(-abs(radius - cycle * 0.72) * 25.0) * (1.0 - cycle);
    return spectral(0.05 + radius * 0.8 + time * 0.02) * (core * 0.92 + pulse * energy * 0.18);
  }
  void main() {
    vec2 p = vUv - 0.5;
    p.x *= uResolution.x / max(uResolution.y, 1.0);
    float radius = length(p);
    float energy = clamp(uLevel, 0.0, 1.0);
    float time = uTime * (0.45 + energy * 1.35);
    vec3 color;
    if (uVariant < 0.5) color = flowField(p, time, energy);
    else if (uVariant < 1.5) color = ribbonField(p, time, energy);
    else if (uVariant < 2.5) color = ringField(p, time, energy);
    else if (uVariant < 3.5) color = bloomField(p, time, energy);
    else color = particleBackdrop(p, time, energy);
    float inner = smoothstep(0.51, 0.09, radius);
    float edge = smoothstep(0.018, 0.002, abs(radius - 0.455));
    float halo = smoothstep(0.52, 0.34, radius) * smoothstep(0.31, 0.47, radius);
    vec3 edgeColor = mix(vec3(0.03, 0.82, 1.0), vec3(0.86, 0.17, 1.0), 0.5 + 0.5 * sin(atan(p.y, p.x) * 2.0 + time));
    color += edgeColor * edge * (0.36 + energy * 0.72);
    color += edgeColor * halo * (0.025 + energy * 0.055);
    float highlight = exp(-length(p - vec2(-0.17, 0.20)) * 11.0);
    color += vec3(0.64, 0.90, 1.0) * highlight * (0.10 + energy * 0.10);
    color = pow(color, vec3(0.84));
    float alpha = smoothstep(0.515, 0.485, radius) * clamp(length(color) * 0.92 + inner * 0.15, 0.0, 1.0);
    gl_FragColor = vec4(color, alpha);
  }
`;

const particleVertexShader = /* glsl */ `
  precision highp float;
  attribute float aAngle;
  attribute float aSeed;
  attribute float aSpeed;
  attribute float aBaseSize;
  attribute float aHue;
  uniform float uTime;
  uniform float uLevel;
  uniform float uPixelRatio;
  uniform float uVoiceTravel;
  varying float vHue;
  varying float vAlpha;
  void main() {
    float energy = clamp(uLevel, 0.0, 1.0);
    float cycle = fract(aSeed + uVoiceTravel * aSpeed);
    float radius = 0.045 + cycle * (0.66 + energy * 0.25);
    float angle = aAngle + uTime * (aSeed - 0.5) * (0.05 + energy * 0.08);
    gl_Position = vec4(vec2(cos(angle), sin(angle)) * radius, 0.0, 1.0);
    gl_PointSize = aBaseSize * (1.0 + energy * 0.62) * uPixelRatio;
    vHue = aHue;
    vAlpha = (0.30 + energy * 0.70) * (1.0 - cycle * 0.58);
  }
`;

const particleFragmentShader = /* glsl */ `
  precision highp float;
  varying float vHue;
  varying float vAlpha;
  vec3 particleColor(float t) {
    vec3 cyan = vec3(0.10, 0.88, 1.0);
    vec3 violet = vec3(0.51, 0.24, 1.0);
    vec3 pink = vec3(1.0, 0.24, 0.78);
    return t < 0.5 ? mix(cyan, violet, t * 2.0) : mix(violet, pink, (t - 0.5) * 2.0);
  }
  void main() {
    float radius = length(gl_PointCoord - 0.5);
    float core = smoothstep(0.50, 0.10, radius);
    float glow = smoothstep(0.50, 0.0, radius) * 0.52;
    gl_FragColor = vec4(particleColor(vHue) * (core + glow), (core + glow) * vAlpha);
  }
`;

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const seeded = (value: number) => {
  const output = Math.sin(value * 917.23) * 43758.5453;
  return output - Math.floor(output);
};

/** Texture-free WebGL presence; this exact component can move into the dock. */
export function PresenceOrbPreview({
  level,
  variant,
  className = "",
}: {
  level: number;
  variant: PresenceOrbVariant;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const levelRef = useRef(clamp(level));
  const [rendererStatus, setRendererStatus] = useState<"gpu-webgl" | "gpu-unavailable">("gpu-webgl");
  levelRef.current = clamp(level);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "high-performance" });
    } catch {
      setRendererStatus("gpu-unavailable");
      return;
    }
    setRendererStatus("gpu-webgl");

    const scene = new Scene();
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const planeGeometry = new PlaneGeometry(2, 2);
    const fieldUniforms = {
      uResolution: { value: new Vector2(1, 1) },
      uTime: { value: 0 },
      uLevel: { value: 0 },
      uVariant: { value: variantNumber[variant] },
    };
    const fieldMaterial = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: fieldUniforms,
      vertexShader: planeVertexShader,
      fragmentShader: fieldFragmentShader,
    });
    scene.add(new Mesh(planeGeometry, fieldMaterial));

    let particleGeometry: BufferGeometry | null = null;
    let particleMaterial: ShaderMaterial | null = null;
    let particleUniforms: {
      uTime: { value: number };
      uLevel: { value: number };
      uPixelRatio: { value: number };
      uVoiceTravel: { value: number };
    } | null = null;
    if (variant === "particles") {
      particleGeometry = createPresenceParticleGeometry();
      particleUniforms = {
        uTime: { value: 0 },
        uLevel: { value: 0 },
        uPixelRatio: { value: 1 },
        uVoiceTravel: { value: 0 },
      };
      particleMaterial = new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        uniforms: particleUniforms,
        vertexShader: particleVertexShader,
        fragmentShader: particleFragmentShader,
      });
      scene.add(new Points(particleGeometry, particleMaterial));
    }

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const width = Math.max(1, bounds.width);
      const height = Math.max(1, bounds.height);
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      renderer.setPixelRatio(pixelRatio);
      renderer.setSize(width, height, false);
      fieldUniforms.uResolution.value.set(width, height);
      if (particleUniforms) particleUniforms.uPixelRatio.value = pixelRatio;
    };
    resize();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    observer?.observe(canvas);
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const origin = performance.now();
    let previous = origin;
    let voiceTravel = 0;
    let frame = 0;
    const render = (now: number) => {
      const time = reducedMotion ? 0 : (now - origin) / 1000;
      const delta = Math.min(0.05, Math.max(0, (now - previous) / 1000));
      previous = now;
      if (!reducedMotion) voiceTravel += delta * (0.025 + levelRef.current * 0.55);
      fieldUniforms.uTime.value = time;
      fieldUniforms.uLevel.value = levelRef.current;
      if (particleUniforms) {
        particleUniforms.uTime.value = time;
        particleUniforms.uLevel.value = levelRef.current;
        particleUniforms.uVoiceTravel.value = voiceTravel;
      }
      renderer.render(scene, camera);
      canvas.dataset.gpuDrawCalls = String(renderer.info.render.calls);
      canvas.dataset.gpuPoints = String(renderer.info.render.points);
      frame = requestAnimationFrame(render);
    };
    frame = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      particleGeometry?.dispose();
      particleMaterial?.dispose();
      planeGeometry.dispose();
      fieldMaterial.dispose();
      renderer.dispose();
    };
  }, [variant]);

  const label = PRESENCE_ORB_OPTIONS.find((option) => option.id === variant)?.name ?? "Assistant";
  return (
    <canvas
      ref={canvasRef}
      data-orb-variant={variant}
      data-renderer={rendererStatus}
      data-particle-count={variant === "particles" ? "400" : undefined}
      className={`aspect-square w-full rounded-full bg-[#03040d] ${className}`}
      aria-label={`${label} GPU presence preview`}
      role="img"
    />
  );
}

export function createPresenceParticleGeometry() {
  const count = 400;
  const positions = new Float32Array(count * 3);
  const angles = new Float32Array(count);
  const seeds = new Float32Array(count);
  const speeds = new Float32Array(count);
  const sizes = new Float32Array(count);
  const hues = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    angles[index] = seeded(index) * Math.PI * 2;
    seeds[index] = seeded(index + 111);
    speeds[index] = 0.18 + seeded(index + 222) * 0.72;
    sizes[index] = 1 + (4 * ((index * 157) % count)) / (count - 1);
    hues[index] = seeded(index + 444);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("aAngle", new BufferAttribute(angles, 1));
  geometry.setAttribute("aSeed", new BufferAttribute(seeds, 1));
  geometry.setAttribute("aSpeed", new BufferAttribute(speeds, 1));
  geometry.setAttribute("aBaseSize", new BufferAttribute(sizes, 1));
  geometry.setAttribute("aHue", new BufferAttribute(hues, 1));
  return geometry;
}
