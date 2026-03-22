"use client";

import { useEffect, useEffectEvent, useRef } from "react";

type PointerState = {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  glow: number;
  targetGlow: number;
};

const DEFAULT_STATE: PointerState = {
  x: 50,
  y: 18,
  targetX: 50,
  targetY: 18,
  glow: 0.22,
  targetGlow: 0.22,
};

export function AmbientGrid() {
  const frameRef = useRef<number | null>(null);
  const stateRef = useRef<PointerState>({ ...DEFAULT_STATE });

  const syncVars = useEffectEvent((state: PointerState) => {
    const root = document.documentElement;
    root.style.setProperty("--ambient-focus-x", `${state.x.toFixed(2)}%`);
    root.style.setProperty("--ambient-focus-y", `${state.y.toFixed(2)}%`);
    root.style.setProperty("--ambient-active", state.glow.toFixed(3));
  });

  useEffect(() => {
    const state = stateRef.current;

    const step = () => {
      frameRef.current = null;

      state.x += (state.targetX - state.x) * 0.14;
      state.y += (state.targetY - state.y) * 0.14;
      state.glow += (state.targetGlow - state.glow) * 0.12;

      syncVars(state);

      const keepAnimating =
        Math.abs(state.targetX - state.x) > 0.04 ||
        Math.abs(state.targetY - state.y) > 0.04 ||
        Math.abs(state.targetGlow - state.glow) > 0.01;

      if (keepAnimating) {
        frameRef.current = window.requestAnimationFrame(step);
      }
    };

    const queueFrame = () => {
      if (frameRef.current !== null) {
        return;
      }

      frameRef.current = window.requestAnimationFrame(step);
    };

    const handlePointerMove = (event: PointerEvent) => {
      state.targetX = (event.clientX / window.innerWidth) * 100;
      state.targetY = (event.clientY / window.innerHeight) * 100;
      state.targetGlow = 1;
      queueFrame();
    };

    const resetPointer = () => {
      state.targetX = 50;
      state.targetY = 18;
      state.targetGlow = 0.22;
      queueFrame();
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        resetPointer();
      }
    };

    syncVars(state);

    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("pointerleave", resetPointer);
    window.addEventListener("blur", resetPointer);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerleave", resetPointer);
      window.removeEventListener("blur", resetPointer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);

      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
      }
    };
  }, []);

  return (
    <div className="ambient-grid" aria-hidden="true">
      <div className="ambient-grid__mesh" />
      <div className="ambient-grid__micro" />
      <div className="ambient-grid__focus" />
      <div className="ambient-grid__pulse" />
    </div>
  );
}
