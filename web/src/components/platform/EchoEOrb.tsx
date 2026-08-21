"use client";

import { useEffect, useRef } from "react";
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  OrthographicCamera,
  Points,
  Scene,
  ShaderMaterial,
  WebGLRenderer,
} from "three";

export type AuroraState = "idle" | "listening" | "speaking" | "muted";

const PARTICLE_COUNT = 400;

const vertexShader = /* glsl */ `
  precision highp float;
  attribute float aAngle;
  attribute float aPhase;
  attribute float aSpeed;
  attribute float aBaseSize;
  attribute float aHue;

  uniform float uPixelRatio;
  uniform float uSpread;
  uniform float uTime;
  uniform float uVoiceTravel;
  uniform float uLevel;

  varying float vAlpha;
  varying float vHue;

  void main() {
    float phase = fract(aPhase + uVoiceTravel * aSpeed);
    float radius = mix(0.025, uSpread, phase);
    float drift = sin(uTime * 0.16 + aPhase * 18.0) * 0.025;
    float angle = aAngle + drift + uTime * (aPhase - 0.5) * 0.018;
    vec2 position = vec2(cos(angle), sin(angle)) * radius;

    gl_Position = vec4(position, 0.0, 1.0);
    gl_PointSize = aBaseSize * (0.82 + uLevel * 0.18) * uPixelRatio;

    float outerFade = smoothstep(1.0, 0.70, phase);
    float innerFade = smoothstep(0.0, 0.09, phase);
    vAlpha = (0.32 + uLevel * 0.62) * outerFade * innerFade;
    vHue = aHue;
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;
  varying float vAlpha;
  varying float vHue;

  vec3 palette(float t) {
    vec3 cyan = vec3(0.10, 0.88, 1.00);
    vec3 blue = vec3(0.18, 0.38, 1.00);
    vec3 violet = vec3(0.55, 0.25, 1.00);
    vec3 pink = vec3(1.00, 0.27, 0.80);
    if (t < 0.33) return mix(cyan, blue, t / 0.33);
    if (t < 0.68) return mix(blue, violet, (t - 0.33) / 0.35);
    return mix(violet, pink, (t - 0.68) / 0.32);
  }

  void main() {
    float radius = length(gl_PointCoord - 0.5);
    float body = smoothstep(0.50, 0.13, radius);
    float glow = smoothstep(0.50, 0.0, radius) * 0.42;
    float light = body + glow;
    gl_FragColor = vec4(palette(vHue) * light, light * vAlpha);
  }
`;

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const seeded = (value: number) => {
  const output = Math.sin(value * 917.23) * 43758.5453;
  return output - Math.floor(output);
};

/**
 * The selected production identity: 400 transparent GPU particles.
 * Idle points travel slowly inside a tight field. Speaking accelerates their
 * outward travel and expands the field, with the visible edge capped below
 * 85% of the available circular footprint.
 */
export function EchoEOrb({ state, level = 0 }: { state: AuroraState; level?: number }) {
  const clamped = clamp(level);
  return (
    <span className="relative block h-full w-full" data-state={state} data-audio-level={clamped}>
      <ParticleField state={state} level={clamped} />
    </span>
  );
}

function ParticleField({ state, level }: { state: AuroraState; level: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(state);
  const levelRef = useRef(level);
  stateRef.current = state;
  levelRef.current = level;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        powerPreference: "high-performance",
        premultipliedAlpha: false,
      });
    } catch {
      canvas.dataset.gpuStatus = "unavailable";
      return;
    }
    renderer.setClearColor(0x000000, 0);

    const scene = new Scene();
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const geometry = createOrbParticleGeometry();
    const uniforms = {
      uPixelRatio: { value: 1 },
      uSpread: { value: 0.36 },
      uTime: { value: 0 },
      uVoiceTravel: { value: 0 },
      uLevel: { value: 0 },
    };
    const material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms,
      vertexShader,
      fragmentShader,
    });
    scene.add(new Points(geometry, material));

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const width = Math.max(1, bounds.width);
      const height = Math.max(1, bounds.height);
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      renderer.setPixelRatio(pixelRatio);
      renderer.setSize(width, height, false);
      uniforms.uPixelRatio.value = pixelRatio;
    };
    resize();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    observer?.observe(canvas);

    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let previous = performance.now();
    let motionTime = 0;
    let voiceTravel = 0;
    let spread = 0.36;
    let frame = 0;

    const render = (now: number) => {
      const delta = Math.min(0.05, Math.max(0, (now - previous) / 1000));
      previous = now;
      const currentState = stateRef.current;
      const currentLevel = levelRef.current;
      const speaking = currentState === "speaking";
      const muted = currentState === "muted";

      // Close and calm when idle/listening; speaking expands only modestly.
      const targetSpread = muted ? 0.29 : speaking ? 0.54 + currentLevel * 0.16 : 0.36;
      spread += (targetSpread - spread) * Math.min(1, delta * 4.8);

      if (!reducedMotion && !muted) {
        motionTime += delta;
        const travelRate = muted ? 0 : speaking ? 0.12 + currentLevel * 0.40 : 0.014;
        voiceTravel += delta * travelRate;
      }

      uniforms.uSpread.value = Math.min(0.70, spread);
      uniforms.uTime.value = motionTime;
      uniforms.uVoiceTravel.value = voiceTravel;
      uniforms.uLevel.value = muted ? 0.08 : speaking ? 0.35 + currentLevel * 0.65 : 0.24;
      renderer.render(scene, camera);
      canvas.dataset.gpuStatus = "active";
      canvas.dataset.gpuPoints = String(renderer.info.render.points);
      frame = requestAnimationFrame(render);
    };
    frame = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      data-renderer="webgl-particles"
      data-gpu-status="initializing"
      data-render-state={state}
      data-particle-count={PARTICLE_COUNT}
      className="pointer-events-none absolute inset-0 h-full w-full"
    />
  );
}

export function createOrbParticleGeometry() {
  const positions = new Float32Array(PARTICLE_COUNT * 3);
  const angles = new Float32Array(PARTICLE_COUNT);
  const phases = new Float32Array(PARTICLE_COUNT);
  const speeds = new Float32Array(PARTICLE_COUNT);
  const sizes = new Float32Array(PARTICLE_COUNT);
  const hues = new Float32Array(PARTICLE_COUNT);

  for (let index = 0; index < PARTICLE_COUNT; index += 1) {
    angles[index] = seeded(index) * Math.PI * 2;
    phases[index] = seeded(index + 111);
    speeds[index] = 0.45 + seeded(index + 222) * 0.55;
    // Coprime stepping covers every size bucket, including exact 1x and 5x.
    sizes[index] = 1 + (4 * ((index * 157) % PARTICLE_COUNT)) / (PARTICLE_COUNT - 1);
    hues[index] = seeded(index + 444);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("aAngle", new BufferAttribute(angles, 1));
  geometry.setAttribute("aPhase", new BufferAttribute(phases, 1));
  geometry.setAttribute("aSpeed", new BufferAttribute(speeds, 1));
  geometry.setAttribute("aBaseSize", new BufferAttribute(sizes, 1));
  geometry.setAttribute("aHue", new BufferAttribute(hues, 1));
  return geometry;
}
