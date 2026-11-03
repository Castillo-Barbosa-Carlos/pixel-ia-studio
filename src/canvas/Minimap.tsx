/**
 * Minimapa: muestra el resultado compuesto de todas las capas visibles y el
 * rectángulo de la vista actual. Al hacer clic o arrastrar se desplaza el
 * lienzo para centrar esa zona.
 */
import { useCallback, useEffect, useMemo, useRef, type MouseEvent as ReactMouseEvent } from 'react';
import { compositeToRgba } from '../core/layers.ts';
import { toImageData } from '../utils/canvas.ts';
import { useEditor } from '../state/editorStore.tsx';

const MAX_WIDTH = 216;

export function Minimap(): JSX.Element {
  const { state, dispatch, stateRef } = useEditor();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const doc = state.history.present;

  const scale = Math.min(MAX_WIDTH / doc.width, 160 / doc.height);
  const displayW = Math.max(1, Math.round(doc.width * scale));
  const displayH = Math.max(1, Math.round(doc.height * scale));

  const rgba = useMemo(() => compositeToRgba(doc), [doc]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(displayW * dpr);
    canvas.height = Math.round(displayH * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;

    // Damero de fondo
    ctx.fillStyle = '#2c2c33';
    ctx.fillRect(0, 0, displayW, displayH);
    ctx.fillStyle = '#3a3a42';
    const cell = Math.max(2, Math.round(scale * 2));
    for (let y = 0; y < displayH; y += cell) {
      for (let x = 0; x < displayW; x += cell) {
        if (((x / cell) | 0) % 2 === ((y / cell) | 0) % 2) ctx.fillRect(x, y, cell, cell);
      }
    }

    const off = document.createElement('canvas');
    off.width = doc.width;
    off.height = doc.height;
    const offCtx = off.getContext('2d');
    if (offCtx) {
      offCtx.putImageData(toImageData(rgba, doc.width, doc.height), 0, 0);
      ctx.drawImage(off, 0, 0, displayW, displayH);
    }

    // Rectángulo de la vista actual
    const container = document.querySelector('[data-testid="canvas-area"]') as HTMLElement | null;
    if (container) {
      const { zoom, pan } = stateRef.current;
      const x = (-pan.x / zoom) * scale;
      const y = (-pan.y / zoom) * scale;
      const w = (container.clientWidth / zoom) * scale;
      const h = (container.clientHeight / zoom) * scale;
      ctx.strokeStyle = '#4da3ff';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x + 0.5, y + 0.5, Math.max(2, w), Math.max(2, h));
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, displayW - 1, displayH - 1);
  }, [displayW, displayH, doc, rgba, scale, stateRef]);

  useEffect(() => {
    draw();
    const onResize = () => draw();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [draw, state.pan, state.zoom]);

  const panToPoint = useCallback(
    (e: ReactMouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      const container = document.querySelector('[data-testid="canvas-area"]') as HTMLElement | null;
      if (!canvas || !container) return;
      const rect = canvas.getBoundingClientRect();
      const px = ((e.clientX - rect.left) / rect.width) * doc.width;
      const py = ((e.clientY - rect.top) / rect.height) * doc.height;
      const { zoom } = stateRef.current;
      dispatch({
        type: 'view/pan',
        x: container.clientWidth / 2 - px * zoom,
        y: container.clientHeight / 2 - py * zoom,
      });
    },
    [dispatch, doc.width, doc.height, stateRef],
  );

  return (
    <div className="minimap">
      <canvas
        ref={canvasRef}
        style={{ width: displayW, height: displayH }}
        data-testid="minimap"
        onPointerDown={(e) => {
          (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
          panToPoint(e);
        }}
        onPointerMove={(e) => {
          if (e.buttons === 1) panToPoint(e);
        }}
      />
    </div>
  );
}
