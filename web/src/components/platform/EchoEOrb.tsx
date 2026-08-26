"use client";

import { useEffect, useRef } from "react";
import { useTheme } from "@/lib/useTheme";
import {
  AdditiveBlending,
  NormalBlending,
  BufferAttribute,
  BufferGeometry,
  OrthographicCamera,
  Points,
  Scene,
  ShaderMaterial,
  WebGLRenderer,
} from "three";

export type AuroraState = "idle" | "listening" | "speaking" | "muted";

const PARTICLE_COUNT = 300;

const vertexShader = /* glsl */ `
  precision highp float;
  attribute vec2 aDirection;
  attribute float aImpact;
  attribute float aPhase;
  attribute float aSpeed;
  attribute float aBaseSize;
  attribute float aHue;

  uniform float uPixelRatio;
  uniform float uBoundary;
  uniform float uMotion;

  varying float vAlpha;
  varying float vHue;

  void main() {
    vec2 direction = normalize(aDirection);
    vec2 perpendicular = vec2(-direction.y, direction.x);
    float offset = aImpact * uBoundary;
    float halfChord = sqrt(max(0.0001, uBoundary * uBoundary - offset * offset));
    float phase = fract(aPhase + uMotion * aSpeed);
    float bounce = 1.0 - 4.0 * abs(phase - 0.5);
    vec2 position = perpendicular * offset + direction * (bounce * halfChord);

    gl_Position = vec4(position, 0.0, 1.0);
    gl_PointSize = aBaseSize * uPixelRatio;

    vAlpha = 0.78 * (0.90 + 0.10 * sin(aPhase * 31.0));
    vHue = aHue;
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;
  varying float vAlpha;
  varying float vHue;

  /* the violet family left with the palette (user directive, 2026-08-26:
     "remove all purple"), and the first blue-only ramp ended on a near-white
     pale that read as grey specks rather than as colour ("give it more
     colour", same day). The ramp now stays SATURATED end to end — teal,
     cyan, azure, deep blue — so every particle carries hue instead of
     fading toward the background it sits on. */
  vec3 palette(float t) {
    vec3 teal  = vec3(0.00, 0.85, 0.78);
    vec3 cyan  = vec3(0.08, 0.72, 1.00);
    vec3 azure = vec3(0.16, 0.48, 1.00);
    vec3 deep  = vec3(0.25, 0.30, 0.95);
    if (t < 0.33) return mix(teal, cyan, t / 0.33);
    if (t < 0.68) return mix(cyan, azure, (t - 0.33) / 0.35);
    return mix(azure, deep, (t - 0.68) / 0.32);
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
 * The selected production identity: 300 transparent GPU particles.
 * Particles keep one constant footprint, brightness, color and dot size in
 * every state. Speaking changes movement speed only; the visible edge remains
 * capped below 85% of the circular footprint.
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
  /* the blending mode is chosen at build time for the material, so the
     field REBUILDS when the theme changes — it is in the effect's deps
     for that reason, not by habit */
  const dark = useTheme() !== "light";

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
      uBoundary: { value: 0.70 },
      uMotion: { value: 0 },
    };
    const material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      /*
       * ADDITIVE ONLY ON DARK (user report, 2026-08-26: "the orb colour is
       * not as designed in light"). Additive blending ADDS light to what is
       * behind it: on a near-black ground that is what makes the particles
       * glow, and on a white one it adds to white and returns white, so the
       * orb washed out to grey specks. Normal blending on light paints the
       * particle's own colour instead — the same design, arriving.
       */
      blending: dark ? AdditiveBlending : NormalBlending,
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
    let motion = 0;
    let motionRate = 0.035;
    let frame = 0;

    const render = (now: number) => {
      const delta = Math.min(0.05, Math.max(0, (now - previous) / 1000));
      previous = now;
      const currentState = stateRef.current;
      const currentLevel = levelRef.current;
      const speaking = currentState === "speaking";
      const muted = currentState === "muted";

      if (!reducedMotion && !muted) {
        const targetMotionRate = speaking ? 0.18 + currentLevel * 0.55 : 0.035;
        const easingSpeed = targetMotionRate > motionRate ? 1.6 : 1.1;
        const easing = 1 - Math.exp(-delta * easingSpeed);
        motionRate += (targetMotionRate - motionRate) * easing;
        motion += delta * motionRate;
      } else if (muted) {
        motionRate = 0;
      }

      uniforms.uBoundary.value = 0.70;
      uniforms.uMotion.value = motion;
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
  }, [dark]);

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
  const directions = new Float32Array(PARTICLE_COUNT * 2);
  const impacts = new Float32Array(PARTICLE_COUNT);
  const phases = new Float32Array(PARTICLE_COUNT);
  const speeds = new Float32Array(PARTICLE_COUNT);
  const sizes = new Float32Array(PARTICLE_COUNT);
  const hues = new Float32Array(PARTICLE_COUNT);

  for (let index = 0; index < PARTICLE_COUNT; index += 1) {
    const angle = seeded(index) * Math.PI * 2;
    directions[index * 2] = Math.cos(angle);
    directions[index * 2 + 1] = Math.sin(angle);
    impacts[index] = (seeded(index + 555) * 2 - 1) * 0.78;
    phases[index] = seeded(index + 111);
    speeds[index] = 0.45 + seeded(index + 222) * 0.55;
    // Coprime stepping covers every size bucket, including exact 1x and 5x.
    sizes[index] = 1 + (4 * ((index * 157) % PARTICLE_COUNT)) / (PARTICLE_COUNT - 1);
    hues[index] = seeded(index + 444);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("aDirection", new BufferAttribute(directions, 2));
  geometry.setAttribute("aImpact", new BufferAttribute(impacts, 1));
  geometry.setAttribute("aPhase", new BufferAttribute(phases, 1));
  geometry.setAttribute("aSpeed", new BufferAttribute(speeds, 1));
  geometry.setAttribute("aBaseSize", new BufferAttribute(sizes, 1));
  geometry.setAttribute("aHue", new BufferAttribute(hues, 1));
  return geometry;
}
