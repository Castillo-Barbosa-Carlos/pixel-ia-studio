/**
 * Lienzo principal de edición.
 *
 * Render escalado sin suavizado (pixel-perfect), damero de transparencia,
 * cuadrícula opcional, selección con "marching ants" y previsualización de
 * trazos no confirmados (vía ref para no re-render React).
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { Point } from '../types/index.ts';
import type { ProjectDoc } from '../types/index.ts';
import { compositeToRgba, layerToRgba } from '../core/layers.ts';
import { aiResultToRgba } from '../ai/preview.ts';
import { toImageData } from '../utils/canvas.ts';
import {
  MAX_ZOOM,
  MIN_ZOOM,
  ZOOM_LEVELS,
  snapZoom,
  useEditor,
} from '../state/editorStore.tsx';
import { useCanvasGestures, type PreviewState, type ViewRef } from './useCanvasGestures.ts';
import { compositeAt, summarizeState } from '../utils/testHook.ts';

const CHECKER_LIGHT = '#3a3a42';
const CHECKER_DARK = '#2c2c33';

/** Compuesto RGBA en caché por identidad de documento + versión de preview. */
interface CompositeCache {
  doc: ProjectDoc;
  previewVersion: number;
  canvas: HTMLCanvasElement;
}

export function PixelCanvas(): JSX.Element {
  const { state, dispatch, stateRef } = useEditor();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewRef = useRef<PreviewState>({ layerId: null, matrix: null, palette: null, version: 0 });
  const viewRef = useRef<ViewRef>({ zoom: state.zoom, pan: { ...state.pan } });
  const compositeCache = useRef<CompositeCache | null>(null);
  const antsRef = useRef(0);
  const frameRef = useRef<number | null>(null);

  // Sincroniza la vista con el store (zoom/pan externos: botones, minimapa).
  viewRef.current.zoom = state.zoom;
  viewRef.current.pan = state.pan;

  const requestDraw = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      draw();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const screenToPixel = useCallback((clientX: number, clientY: number): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const { zoom, pan } = viewRef.current;
    return {
      x: Math.floor((clientX - rect.left - pan.x) / zoom),
      y: Math.floor((clientY - rect.top - pan.y) / zoom),
    };
  }, []);

  const clientDeltaToPan = useCallback(
    (startClient: { x: number; y: number }, e: { clientX: number; clientY: number }) => ({
      x: e.clientX - startClient.x,
      y: e.clientY - startClient.y,
    }),
    [],
  );

  const gestures = useCanvasGestures({
    stateRef,
    dispatch,
    previewRef,
    viewRef,
    requestDraw,
    screenToPixel,
    clientDeltaToPan,
  });

  /* ---------------------------- dibujo ---------------------------- */

  const getCompositeCanvas = useCallback((doc: ProjectDoc): HTMLCanvasElement => {
    const preview = previewRef.current;
    const cache = compositeCache.current;
    if (cache && cache.doc === doc && cache.previewVersion === preview.version) return cache.canvas;

    const canvas = document.createElement('canvas');
    canvas.width = doc.width;
    canvas.height = doc.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;
    const override =
      preview.matrix && preview.layerId
        ? { layerId: preview.layerId, matrix: preview.matrix, palette: preview.palette ?? undefined }
        : undefined;
    const rgba = compositeToRgba(doc, override);
    ctx.putImageData(toImageData(rgba, doc.width, doc.height), 0, 0);
    compositeCache.current = { doc, previewVersion: preview.version, canvas };
    return canvas;
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const stateNow = stateRef.current;
    const doc = stateNow.history.present;
    const dpr = window.devicePixelRatio || 1;
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width === 0 || height === 0) return;

    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;

    const { zoom, pan } = viewRef.current;
    const docW = doc.width * zoom;
    const docH = doc.height * zoom;

    // Fondo de la aplicación
    ctx.fillStyle = '#141419';
    ctx.fillRect(0, 0, width, height);

    // Damero de transparencia (patrón de 16px en coordenadas de pantalla)
    const patternCanvas = document.createElement('canvas');
    patternCanvas.width = 16;
    patternCanvas.height = 16;
    const pctx = patternCanvas.getContext('2d');
    if (pctx) {
      pctx.fillStyle = CHECKER_LIGHT;
      pctx.fillRect(0, 0, 16, 16);
      pctx.fillStyle = CHECKER_DARK;
      pctx.fillRect(0, 0, 8, 8);
      pctx.fillRect(8, 8, 8, 8);
      const pattern = ctx.createPattern(patternCanvas, 'repeat');
      if (pattern) {
        ctx.fillStyle = pattern;
        ctx.fillRect(pan.x, pan.y, docW, docH);
      }
    }

    // Composición de capas
    const composite = getCompositeCanvas(doc);
    ctx.drawImage(composite, pan.x, pan.y, docW, docH);

    // Previsualización en vivo mientras la IA genera
    if (stateNow.ai.status === 'generating' && stateNow.ai.preview) {
      const pResult = stateNow.ai.preview.result;
      if (stateNow.ai.preview.mode === 'inpaint' && stateNow.ai.preview.selectionRect) {
        const sel = stateNow.ai.preview.selectionRect;
        const liveCanvas = document.createElement('canvas');
        liveCanvas.width = sel.w;
        liveCanvas.height = sel.h;
        const lctx = liveCanvas.getContext('2d');
        if (lctx) {
          lctx.putImageData(toImageData(aiResultToRgba(pResult), sel.w, sel.h), 0, 0);
          ctx.save();
          ctx.drawImage(liveCanvas, pan.x + sel.x * zoom, pan.y + sel.y * zoom, sel.w * zoom, sel.h * zoom);
          ctx.restore();
        }
      } else if (pResult.width === doc.width && pResult.height === doc.height) {
        const liveCanvas = document.createElement('canvas');
        liveCanvas.width = doc.width;
        liveCanvas.height = doc.height;
        const lctx = liveCanvas.getContext('2d');
        if (lctx) {
          lctx.putImageData(toImageData(aiResultToRgba(pResult), doc.width, doc.height), 0, 0);
          ctx.save();
          ctx.drawImage(liveCanvas, pan.x, pan.y, docW, docH);
          ctx.restore();
        }
      }
    }

    // Selección flotante
    const floating = stateNow.floating;
    if (floating) {
      const floatCanvas = document.createElement('canvas');
      floatCanvas.width = floating.width;
      floatCanvas.height = floating.height;
      const fctx = floatCanvas.getContext('2d');
      if (fctx) {
        const layerLike = {
          id: 'floating',
          name: 'floating',
          visible: true,
          locked: false,
          opacity: 1,
          matrix: floating.matrix,
        };
        fctx.putImageData(toImageData(layerToRgba(layerLike, doc.palette), floating.width, floating.height), 0, 0);
        ctx.drawImage(
          floatCanvas,
          pan.x + floating.x * zoom,
          pan.y + floating.y * zoom,
          floating.width * zoom,
          floating.height * zoom,
        );
      }
    }

    // Cuadrícula
    if (stateNow.showGrid && zoom >= 6) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= doc.width; x++) {
        const sx = Math.round(pan.x + x * zoom) + 0.5;
        ctx.moveTo(sx, pan.y);
        ctx.lineTo(sx, pan.y + docH);
      }
      for (let y = 0; y <= doc.height; y++) {
        const sy = Math.round(pan.y + y * zoom) + 0.5;
        ctx.moveTo(pan.x, sy);
        ctx.lineTo(pan.x + docW, sy);
      }
      ctx.stroke();
      ctx.restore();
    }

    // Selección (marching ants)
    const selection = stateNow.selection;
    if (selection) {
      ctx.save();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.lineDashOffset = -antsRef.current;
      ctx.strokeRect(
        Math.round(pan.x + selection.x * zoom) + 0.5,
        Math.round(pan.y + selection.y * zoom) + 0.5,
        selection.w * zoom - 1,
        selection.h * zoom - 1,
      );
      ctx.strokeStyle = '#000000';
      ctx.lineDashOffset = -antsRef.current + 4;
      ctx.strokeRect(
        Math.round(pan.x + selection.x * zoom) + 0.5,
        Math.round(pan.y + selection.y * zoom) + 0.5,
        selection.w * zoom - 1,
        selection.h * zoom - 1,
      );
      ctx.restore();
    }

    // Borde del lienzo
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(pan.x + 0.5, pan.y + 0.5, docW - 1, docH - 1);
    ctx.restore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getCompositeCanvas, stateRef]);

  /* ------------------------ efectos de render ------------------------ */

  useEffect(() => {
    requestDraw();
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => requestDraw());
    observer.observe(container);
    return () => observer.disconnect();
  }, [state, requestDraw]);

  // Marching ants animados mientras hay selección.
  useEffect(() => {
    if (!state.selection && !state.floating) return;
    const timer = setInterval(() => {
      antsRef.current = (antsRef.current + 1) % 8;
      requestDraw();
    }, 120);
    return () => clearInterval(timer);
  }, [state.selection, state.floating, requestDraw]);

  /* ----------------------------- rueda ----------------------------- */

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const { zoom, pan } = viewRef.current;
      if (e.shiftKey || e.altKey) {
        const dx = e.shiftKey ? e.deltaY : e.deltaX;
        const dy = e.shiftKey ? 0 : e.deltaY;
        viewRef.current.pan = { x: pan.x - dx, y: pan.y - dy };
        dispatch({ type: 'view/pan', x: viewRef.current.pan.x, y: viewRef.current.pan.y });
        requestDraw();
        return;
      }
      const levels = ZOOM_LEVELS;
      const index = levels.findIndex((l) => l === snapZoom(zoom));
      const nextIndex = Math.max(0, Math.min(levels.length - 1, index + (e.deltaY < 0 ? 1 : -1)));
      const nextZoom = levels[nextIndex];
      if (nextZoom === zoom) return;
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const nextPan = {
        x: cx - ((cx - pan.x) / zoom) * nextZoom,
        y: cy - ((cy - pan.y) / zoom) * nextZoom,
      };
      viewRef.current.zoom = nextZoom;
      viewRef.current.pan = nextPan;
      dispatch({ type: 'view/zoom', zoom: nextZoom, pan: nextPan });
      requestDraw();
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [dispatch, requestDraw]);

  /* ------------------------ ajustar a pantalla ----------------------- */

  const fitToScreen = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const stateNow = stateRef.current;
    const doc = stateNow.history.present;
    const padding = 48;
    const scaleX = (container.clientWidth - padding) / doc.width;
    const scaleY = (container.clientHeight - padding) / doc.height;
    const target = Math.min(scaleX, scaleY);
    let zoom = ZOOM_LEVELS[0];
    for (const level of ZOOM_LEVELS) {
      if (level <= target) zoom = level;
    }
    zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
    const pan = {
      x: Math.round((container.clientWidth - doc.width * zoom) / 2),
      y: Math.round((container.clientHeight - doc.height * zoom) / 2),
    };
    viewRef.current.zoom = zoom;
    viewRef.current.pan = pan;
    dispatch({ type: 'view/zoom', zoom, pan });
    requestDraw();
  }, [dispatch, requestDraw, stateRef]);

  const lastDims = useRef({ w: 0, h: 0 });
  useEffect(() => {
    const doc = state.history.present;
    const dimsChanged = lastDims.current.w !== doc.width || lastDims.current.h !== doc.height;
    lastDims.current = { w: doc.width, h: doc.height };
    if (dimsChanged || state.fitNonce > 0) fitToScreen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.fitNonce, state.history.present.width, state.history.present.height]);

  // Ganchos de inspección para las pruebas E2E (ver docs/DECISIONS.md).
  useEffect(() => {
    const hook = {
      state: () => summarizeState(stateRef.current),
      compositeAt: (x: number, y: number) => compositeAt(stateRef.current, x, y),
      pixelToScreen: (x: number, y: number) => {
        const canvas = canvasRef.current;
        if (!canvas) return { x: 0, y: 0 };
        const rect = canvas.getBoundingClientRect();
        const { zoom, pan } = viewRef.current;
        return {
          x: rect.left + pan.x + x * zoom + zoom / 2,
          y: rect.top + pan.y + y * zoom + zoom / 2,
        };
      },
      fit: () => fitToScreen(),
      dispatch: (action: unknown) => dispatch(action as Parameters<typeof dispatch>[0]),
    };
    (window as unknown as Record<string, unknown>).__PIXEL_IA__ = hook;
    return () => {
      delete (window as unknown as Record<string, unknown>).__PIXEL_IA__;
    };
  }, [fitToScreen, stateRef]);

  const cursorClass = useMemo(() => {
    switch (state.tool) {
      case 'select':
        return 'canvas--crosshair';
      case 'eyedropper':
        return 'canvas--eyedropper';
      case 'fill':
        return 'canvas--fill';
      default:
        return 'canvas--crosshair';
    }
  }, [state.tool]);

  return (
    <div className="canvas-area" ref={containerRef} data-testid="canvas-area">
      <canvas
        ref={canvasRef}
        className={`canvas ${cursorClass}`}
        data-testid="pixel-canvas"
        onPointerDown={gestures.onPointerDown}
        onPointerMove={gestures.onPointerMove}
        onPointerUp={gestures.onPointerUp}
        onPointerCancel={gestures.onPointerUp}
        onPointerLeave={gestures.onPointerLeave}
        onContextMenu={(e) => e.preventDefault()}
      />
    </div>
  );
}
