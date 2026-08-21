"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import {
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderer,
} from "three";

export type AuroraState = "idle" | "listening" | "speaking" | "muted";

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position, 1.0); }
`;

/* A signed-distance E plus audio-driven refraction, ribbons and particles.
   This shader is the visual source of truth for the compact dock renderer. */
const fragmentShader = /* glsl */ `
  precision highp float;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uLevel;
  uniform float uState;
  varying vec2 vUv;

  float box(vec2 p, vec2 b) {
    vec2 d = abs(p) - b;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
  }
  float glyphE(vec2 p) {
    float stem = box(p - vec2(-0.19, 0.0), vec2(0.11, 0.48));
    float top = box(p - vec2(0.07, 0.38), vec2(0.37, 0.105));
    float mid = box(p - vec2(0.02, 0.0), vec2(0.32, 0.10));
    float bottom = box(p - vec2(0.07, -0.38), vec2(0.37, 0.105));
    return min(min(stem, top), min(mid, bottom));
  }
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
  vec3 colors(float t) {
    vec3 cyan = vec3(0.10, 0.86, 1.0);
    vec3 blue = vec3(0.16, 0.29, 1.0);
    vec3 violet = vec3(0.79, 0.24, 1.0);
    return mix(mix(cyan, blue, smoothstep(0.13, 0.57, t)), violet, smoothstep(0.57, 1.0, t));
  }
  void main() {
    vec2 p = vUv - 0.5;
    p.x *= uResolution.x / max(uResolution.y, 1.0);
    float speaking = step(1.5, uState) * (1.0 - step(2.5, uState));
    float listening = step(0.5, uState) * (1.0 - step(1.5, uState));
    float muted = step(2.5, uState);
    float energy = mix(0.16, 0.42 + uLevel * 0.58, speaking);
    energy = mix(energy, 0.34 + uLevel * 0.24, listening);
    energy *= 1.0 - muted;
    float time = uTime * (0.38 + energy * 1.55);

    float radius = length(p);
    vec2 glass = p + vec2(sin(p.y * 10.0 + time * 1.8), cos(p.x * 11.0 - time * 1.4)) * (0.010 + energy * 0.020);
    float signedE = glyphE(glass);
    float mark = smoothstep(0.020, -0.014, signedE);
    float edge = smoothstep(0.052, 0.004, abs(signedE));
    float field = 0.5 + 0.5 * sin(glass.x * 7.0 - glass.y * 5.0 + time * 1.8 + sin(glass.x * 8.0 + time) * 1.4);
    vec3 markColor = colors(field);
    markColor += vec3(0.56, 0.86, 1.0) * pow(max(0.0, 1.0 - length(glass - vec2(-0.20, 0.27)) * 2.8), 4.0);

    float aura = smoothstep(0.78, 0.05, radius) * (0.10 + energy * 0.28);
    vec3 color = colors(0.18 + field * 0.62) * aura;

    float streamA = abs(p.y + sin(p.x * 7.0 + time * 2.3) * (0.07 + energy * 0.050));
    float streamB = abs(p.y - 0.12 + sin(p.x * 8.5 - time * 1.55) * (0.055 + energy * 0.036));
    float streams = smoothstep(0.031 + energy * 0.012, 0.002, streamA) + smoothstep(0.021 + energy * 0.009, 0.002, streamB);
    color += colors(0.10 + field * 0.86) * streams * smoothstep(0.72, 0.15, abs(p.x)) * (0.18 + energy * 0.64);

    float halo = smoothstep(0.022 + energy * 0.010, 0.003, abs(radius - (0.43 + sin(time * 1.7) * 0.016))) * (0.08 + energy * 0.28);
    color += mix(vec3(0.28, 0.94, 1.0), vec3(0.78, 0.30, 1.0), field) * halo;

    for (int i = 0; i < 16; i++) {
      float seed = float(i) + 1.0;
      float angle = seed * 2.39996 + time * (0.34 + mod(seed, 3.0) * 0.10);
      float orbit = 0.34 + hash(vec2(seed, 4.0)) * 0.29 + energy * 0.07;
      vec2 spark = vec2(cos(angle), sin(angle * 1.21)) * orbit;
      float light = smoothstep(0.024 + energy * 0.014, 0.0, length(p - spark));
      color += colors(fract(seed * 0.17 + field)) * light * (0.14 + energy * 0.58);
    }

    float scan = smoothstep(0.085, 0.0, abs(sin(atan(p.y, p.x) - time * 2.3))) * listening * smoothstep(0.62, 0.22, radius);
    color += vec3(0.42, 0.96, 1.0) * scan * 0.22;
    color = mix(color, markColor, mark);
    color += vec3(0.72, 0.94, 1.0) * edge * (0.18 + energy * 0.56);
    float opacity = clamp(aura + mark * 0.96 + streams * 0.23 + halo + edge * 0.38, 0.0, 1.0);
    gl_FragColor = vec4(color, opacity * (1.0 - muted * 0.38));
  }
`;

const stateNumber: Record<AuroraState, number> = { idle: 0, listening: 1, speaking: 2, muted: 3 };

export function EchoEOrb({ state, level = 0 }: { state: AuroraState; level?: number }) {
  const clamped = Math.max(0, Math.min(1, level));
  return (
    <span
      className={`aurora-root relative block h-full w-full ${state === "muted" ? "" : "aurora-float"}`}
      data-state={state}
      style={{ "--audio-level": String(clamped) } as CSSProperties}
    >
      <EchoEShader state={state} level={clamped} />
    </span>
  );
}

function EchoEShader({ state, level }: { state: AuroraState; level: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(state);
  const levelRef = useRef(level);
  stateRef.current = state;
  levelRef.current = level;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (typeof WebGLRenderingContext === "undefined") {
      drawFallback(canvas);
      return;
    }
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "high-performance" });
    } catch {
      drawFallback(canvas);
      return;
    }

    const scene = new Scene();
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const geometry = new PlaneGeometry(2, 2);
    const uniforms = {
      uResolution: { value: new Vector2(1, 1) },
      uTime: { value: 0 },
      uLevel: { value: 0 },
      uState: { value: 0 },
    };
    const material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms,
      vertexShader,
      fragmentShader,
    });
    scene.add(new Mesh(geometry, material));
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(width, height, false);
      uniforms.uResolution.value.set(width, height);
    };
    resize();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    observer?.observe(canvas);
    const origin = performance.now();
    let frame = 0;
    const render = (now: number) => {
      uniforms.uTime.value = reducedMotion || stateRef.current === "muted" ? 0 : (now - origin) / 1000;
      uniforms.uLevel.value = levelRef.current;
      uniforms.uState.value = stateNumber[stateRef.current];
      renderer.render(scene, camera);
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

  return <canvas ref={canvasRef} aria-hidden data-renderer="webgl-e" data-render-state={state} className="aurora-canvas pointer-events-none absolute -inset-[45%] h-[190%] w-[190%]" />;
}

function drawFallback(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d");
  if (!context) return;
  const width = Math.max(1, canvas.clientWidth || 80);
  const height = Math.max(1, canvas.clientHeight || 80);
  canvas.width = width;
  canvas.height = height;
  const radius = Math.min(width, height);
  const glow = context.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, radius * 0.52);
  glow.addColorStop(0, "rgba(80, 223, 255, 0.46)");
  glow.addColorStop(0.5, "rgba(130, 72, 255, 0.2)");
  glow.addColorStop(1, "rgba(0, 0, 0, 0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, width, height);
  context.font = `900 ${radius * 0.74}px system-ui, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.shadowColor = "rgba(57, 214, 255, 0.82)";
  context.shadowBlur = radius * 0.16;
  context.fillStyle = "#b8f7ff";
  context.fillText("E", width / 2, height / 2 + radius * 0.02);
}
