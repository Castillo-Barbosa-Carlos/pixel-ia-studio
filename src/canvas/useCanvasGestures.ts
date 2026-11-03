/**
 * Gestos de dibujo del lienzo.
 *
 * Los trazos de pincel/figuras trabajan sobre una copia de la matriz de la
 * capa activa y se confirman como UNA única entrada de historial al soltar el
 * ratón. La previsualización vive en un ref (`previewRef`) para no re-render
 * React en cada movimiento.
 */
import { useRef, type Dispatch, type MutableRefObject, type PointerEvent as ReactPointerEvent } from 'react';
import type { PaletteColor, Matrix, Point, Rect } from '../types/index.ts';
import { TRANSPARENT } from '../types/index.ts';
import type { EditorAction, EditorState } from '../state/editorStore.tsx';
import { mergeFloatingIntoDoc } from '../state/editorStore.tsx';
import { setCursor } from '../state/cursorStore.ts';
import { cloneMatrix, floodFill, matrixEquals, setAt } from '../core/matrix.ts';
import {
  computeShadeIndex,
  drawEllipse,
  drawGradient,
  drawLine,
  drawRect,
  floodFillTolerant,
  rectFromPoints,
  stampBrush,
} from '../core/raster.ts';
import { compositeToRgba, findLayer } from '../core/layers.ts';
import { nearestColorIndex } from '../core/color.ts';

export interface PreviewState {
  layerId: string | null;
  matrix: Matrix | null;
  palette: PaletteColor[] | null;
  version: number;
}

export interface ViewRef {
  zoom: number;
  pan: { x: number; y: number };
}

type StrokeKind =
  | 'paint'
  | 'shape'
  | 'gradient'
  | 'shade'
  | 'marquee'
  | 'move-float'
  | 'pan'
  | null;

interface Stroke {
  kind: StrokeKind;
  button: number;
  start: Point;
  last: Point;
  layerId: string;
  baseMatrix: Matrix;
  workMatrix: Matrix;
  workPalette: PaletteColor[] | null;
  value: number;
  moved: boolean;
  panStart: { x: number; y: number };
  panOrigin: { x: number; y: number };
  floatOffset: Point;
  shiftKey: boolean;
}

export interface GestureDeps {
  stateRef: MutableRefObject<EditorState>;
  dispatch: Dispatch<EditorAction>;
  previewRef: MutableRefObject<PreviewState>;
  viewRef: MutableRefObject<ViewRef>;
  requestDraw: () => void;
  screenToPixel: (clientX: number, clientY: number) => Point;
  clientDeltaToPan: (startClient: { x: number; y: number }, e: { clientX: number; clientY: number }) => { x: number; y: number };
}

function emptyStroke(): Stroke {
  return {
    kind: null,
    button: 0,
    start: { x: 0, y: 0 },
    last: { x: 0, y: 0 },
    layerId: '',
    baseMatrix: new Int16Array(0),
    workMatrix: new Int16Array(0),
    workPalette: null,
    value: TRANSPARENT,
    moved: false,
    panStart: { x: 0, y: 0 },
    panOrigin: { x: 0, y: 0 },
    floatOffset: { x: 0, y: 0 },
    shiftKey: false,
  };
}

export function useCanvasGestures(deps: GestureDeps): {
  onPointerDown: (e: ReactPointerEvent<HTMLCanvasElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLCanvasElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLCanvasElement>) => void;
  onPointerLeave: () => void;
} {
  const strokeRef = useRef<Stroke>(emptyStroke());

  function setPreview(layerId: string | null, matrix: Matrix | null, palette: PaletteColor[] | null): void {
    deps.previewRef.current = { layerId, matrix, palette, version: deps.previewRef.current.version + 1 };
    deps.requestDraw();
  }

  function commitStroke(label: string): void {
    const stroke = strokeRef.current;
    const state = deps.stateRef.current;
    const baseDoc = mergeFloatingIntoDoc(state);
    const palette = stroke.workPalette ?? baseDoc.palette;
    const paletteChanged = stroke.workPalette !== null && stroke.workPalette !== baseDoc.palette;
    const layerChanged = !matrixEquals(stroke.workMatrix, stroke.baseMatrix);
    if (!layerChanged && !paletteChanged) {
      setPreview(null, null, null);
      return;
    }
    const nextDoc = {
      ...baseDoc,
      palette,
      layers: baseDoc.layers.map((l) => (l.id === stroke.layerId ? { ...l, matrix: stroke.workMatrix } : l)),
    };
    deps.dispatch({ type: 'doc/commit', doc: nextDoc, label });
    setPreview(null, null, null);
  }

  function onPointerDown(e: ReactPointerEvent<HTMLCanvasElement>): void {
    const state = deps.stateRef.current;
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    const point = deps.screenToPixel(e.clientX, e.clientY);
    const button = e.button;

    /* -------- desplazamiento con botón central o botón derecho -------- */
    if (button === 1 || button === 2) {
      strokeRef.current = {
        ...emptyStroke(),
        kind: 'pan',
        panStart: { ...deps.viewRef.current.pan },
        panOrigin: { x: e.clientX, y: e.clientY },
      };
      return;
    }

    /* -------- gotero -------- */
    if (state.tool === 'eyedropper') {
      pickColor(point, e.altKey, false);
      return;
    }

    /* -------- selección -------- */
    if (state.tool === 'select') {
      handleSelectDown(point, button);
      return;
    }

    beginDrawingStroke(point, e);
  }

  /**
   * Prepara el trazo de dibujo sobre una copia de la capa activa.
   */
  function beginDrawingStroke(
    point: Point,
    e: { shiftKey: boolean; altKey: boolean },
  ): void {
    const state = deps.stateRef.current;
    const doc = state.history.present;
    const baseDoc = mergeFloatingIntoDoc(state);
    const layer = findLayer(baseDoc, state.activeLayerId);
    if (!layer) return;
    if (layer.locked) {
      deps.dispatch({ type: 'toast/push', toast: { kind: 'error', message: `La capa "${layer.name}" está bloqueada.` } });
      return;
    }

    const baseMatrix = layer.matrix;
    const workMatrix = cloneMatrix(baseMatrix);
    const stroke = emptyStroke();
    stroke.button = 0;
    stroke.start = point;
    stroke.last = point;
    stroke.layerId = layer.id;
    stroke.baseMatrix = baseMatrix;
    stroke.workMatrix = workMatrix;
    stroke.shiftKey = e.shiftKey;
    strokeRef.current = stroke;

    const paintValue = state.colorIndex;

    if (state.tool === 'pencil' || state.tool === 'pencil-eraser' || state.tool === 'eraser') {
      stroke.kind = 'paint';
      if (state.tool === 'eraser') {
        stroke.value = TRANSPARENT;
      } else if (state.tool === 'pencil-eraser') {
        // Decide al empezar el trazo: píxel vacío dibuja, píxel con color borra.
        const cell = baseMatrix[point.y * doc.width + point.x];
        stroke.value = cell === undefined || cell === TRANSPARENT ? paintValue : TRANSPARENT;
      } else {
        stroke.value = paintValue;
      }
      const size = state.toolOptions.brushSize;
      stampBrush(workMatrix, doc.width, doc.height, point.x, point.y, stroke.value, size);
      setPreview(layer.id, workMatrix, null);
    } else if (state.tool === 'fill') {
      const value = paintValue;
      const tolerance = state.toolOptions.fillTolerance;
      if (tolerance > 0) {
        floodFillTolerant(workMatrix, doc.width, doc.height, point.x, point.y, value, baseDoc.palette, tolerance);
      } else {
        floodFill(workMatrix, doc.width, doc.height, point.x, point.y, value);
      }
      stroke.kind = 'paint';
      stroke.value = value;
      stroke.workMatrix = workMatrix;
      setPreview(layer.id, workMatrix, null);
    } else if (state.tool === 'line' || state.tool === 'rect' || state.tool === 'ellipse') {
      stroke.kind = 'shape';
      stroke.value = paintValue;
    } else if (state.tool === 'gradient') {
      stroke.kind = 'gradient';
    } else if (state.tool === 'shade') {
      stroke.kind = 'shade';
      stroke.workPalette = [...baseDoc.palette];
      applyShade(point);
    }

    if (stroke.kind === 'shape' || stroke.kind === 'gradient') {
      // La vista previa se dibuja en el primer movimiento.
      updateShapePreview();
    }
  }

  function updateShapePreview(): void {
    const stroke = strokeRef.current;
    const state = deps.stateRef.current;
    const doc = state.history.present;
    const work = cloneMatrix(stroke.baseMatrix);
    const options = state.toolOptions;
    const { start, last } = stroke;

    if (stroke.kind === 'shape') {
      const constrain = stroke.shiftKey;
      if (state.tool === 'line') {
        const end = constrainAngle(start, last);
        drawLine(work, doc.width, doc.height, start.x, start.y, end.x, end.y, stroke.value, options.brushSize);
      } else {
        const rect = rectFromPoints(start.x, start.y, last.x, last.y, constrain && state.tool === 'rect');
        const end = { x: rect.x + rect.w - 1, y: rect.y + rect.h - 1 };
        const drawFn = state.tool === 'rect' ? drawRect : drawEllipse;
        drawFn(
          work,
          doc.width,
          doc.height,
          rect.x,
          rect.y,
          end.x,
          end.y,
          stroke.value,
          options.shapeFilled,
          options.outlineWidth,
        );
      }
    } else if (stroke.kind === 'gradient') {
      const rect = rectFromPoints(start.x, start.y, last.x, last.y, stroke.shiftKey);
      drawGradient(
        work,
        doc.width,
        doc.height,
        rect,
        start,
        last,
        state.colorIndex,
        state.secondaryIndex,
        state.history.present.palette,
      );
    }

    stroke.workMatrix = work;
    setPreview(stroke.layerId, work, stroke.workPalette);
  }

  function applyShade(point: Point): void {
    const stroke = strokeRef.current;
    const state = deps.stateRef.current;
    const doc = state.history.present;
    const options = state.toolOptions;
    const palette = stroke.workPalette ?? doc.palette;
    const darken = stroke.shiftKey;
    const size = options.brushSize;
    const half = Math.floor((size - 1) / 2);

    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size; dx++) {
        const x = point.x - half + dx;
        const y = point.y - half + dy;
        const cell = stroke.baseMatrix[y * doc.width + x];
        if (cell === undefined) continue;
        const result = computeShadeIndex(cell, palette, darken ? 'darken' : 'lighten', options.shadeStrength, true);
        if (result.newColor && stroke.workPalette) {
          stroke.workPalette.push(result.newColor);
        }
        setAt(stroke.workMatrix, doc.width, doc.height, x, y, result.index);
      }
    }
    setPreview(stroke.layerId, stroke.workMatrix, stroke.workPalette);
  }

  function handleSelectDown(point: Point, button: number): void {
    const state = deps.stateRef.current;
    const selection = state.selection;
    const floating = state.floating;

    if (floating) {
      const inside =
        point.x >= floating.x &&
        point.x < floating.x + floating.width &&
        point.y >= floating.y &&
        point.y < floating.y + floating.height;
      if (inside) {
        strokeRef.current = {
          ...emptyStroke(),
          kind: 'move-float',
          button,
          start: point,
          floatOffset: { x: point.x - floating.x, y: point.y - floating.y },
        };
        return;
      }
      deps.dispatch({ type: 'floating/commit' });
    }

    const insideSelection =
      selection &&
      point.x >= selection.x &&
      point.x < selection.x + selection.w &&
      point.y >= selection.y &&
      point.y < selection.y + selection.h;

    if (insideSelection && selection) {
      const layer = findLayer(mergeFloatingIntoDoc(state), state.activeLayerId);
      if (!layer || layer.locked) {
        deps.dispatch({ type: 'toast/push', toast: { kind: 'error', message: 'La capa activa está bloqueada.' } });
        return;
      }
      deps.dispatch({ type: 'selection/lift', rect: selection });
      strokeRef.current = {
        ...emptyStroke(),
        kind: 'move-float',
        button,
        start: point,
        floatOffset: { x: point.x - selection.x, y: point.y - selection.y },
      };
      return;
    }

    strokeRef.current = {
      ...emptyStroke(),
      kind: 'marquee',
      button,
      start: point,
      last: point,
    };
    deps.dispatch({ type: 'selection/set', rect: { x: point.x, y: point.y, w: 1, h: 1 } });
  }

  function pickColor(point: Point, activeLayerOnly: boolean, secondary: boolean): void {
    const state = deps.stateRef.current;
    const doc = state.history.present;
    const { width, height } = doc;
    if (point.x < 0 || point.y < 0 || point.x >= width || point.y >= height) return;

    let r = 0;
    let g = 0;
    let b = 0;
    let a = 255;
    if (activeLayerOnly) {
      const layer = findLayer(doc, state.activeLayerId);
      const value = layer ? layer.matrix[point.y * width + point.x] : TRANSPARENT;
      if (value === TRANSPARENT) {
        deps.dispatch({ type: 'toast/push', toast: { kind: 'info', message: 'El píxel es transparente en la capa activa.' } });
        return;
      }
      const color = doc.palette[value];
      if (!color) return;
      r = parseInt(color.hex.slice(1, 3), 16);
      g = parseInt(color.hex.slice(3, 5), 16);
      b = parseInt(color.hex.slice(5, 7), 16);
      a = color.alpha;
    } else {
      const rgba = compositeToRgba(doc);
      const o = (point.y * width + point.x) * 4;
      r = rgba[o];
      g = rgba[o + 1];
      b = rgba[o + 2];
      a = rgba[o + 3];
    }
    if (a < 128) {
      deps.dispatch({ type: 'toast/push', toast: { kind: 'info', message: 'El píxel compuesto es transparente.' } });
      return;
    }
    const index = nearestColorIndex(r, g, b, doc.palette);
    deps.dispatch({ type: 'color/set', index, secondary });
    // Comodidad: tras tomar un color se vuelve al lápiz para seguir dibujando.
    deps.dispatch({ type: 'tool/set', tool: 'pencil' });
  }

  function onPointerMove(e: ReactPointerEvent<HTMLCanvasElement>): void {
    const point = deps.screenToPixel(e.clientX, e.clientY);
    setCursor({ x: point.x, y: point.y, inside: true });

    const stroke = strokeRef.current;
    if (!stroke.kind) return;
    stroke.shiftKey = e.shiftKey;

    if (stroke.kind === 'pan') {
      const delta = deps.clientDeltaToPan(stroke.panOrigin, e);
      deps.viewRef.current.pan = { x: stroke.panStart.x + delta.x, y: stroke.panStart.y + delta.y };
      deps.requestDraw();
      return;
    }

    if (stroke.kind === 'marquee') {
      stroke.last = point;
      stroke.moved = true;
      const rect = normalizeRect(stroke.start, point);
      deps.dispatch({ type: 'selection/set', rect });
      return;
    }

    if (stroke.kind === 'move-float') {
      const state = deps.stateRef.current;
      const floating = state.floating;
      if (!floating) return;
      deps.dispatch({
        type: 'floating/set',
        floating: {
          ...floating,
          x: point.x - stroke.floatOffset.x,
          y: point.y - stroke.floatOffset.y,
        },
      });
      return;
    }

    if (point.x === stroke.last.x && point.y === stroke.last.y) return;
    stroke.moved = true;

    const state = deps.stateRef.current;
    const doc = state.history.present;

    if (stroke.kind === 'paint') {
      drawLine(
        stroke.workMatrix,
        doc.width,
        doc.height,
        stroke.last.x,
        stroke.last.y,
        point.x,
        point.y,
        stroke.value,
        state.toolOptions.brushSize,
      );
      stroke.last = point;
      setPreview(stroke.layerId, stroke.workMatrix, stroke.workPalette);
      return;
    }

    if (stroke.kind === 'shade') {
      // Dibuja segmentos completos para no dejar huecos al mover rápido.
      const steps = Math.max(Math.abs(point.x - stroke.last.x), Math.abs(point.y - stroke.last.y));
      for (let i = 1; i <= steps; i++) {
        const x = Math.round(stroke.last.x + ((point.x - stroke.last.x) * i) / steps);
        const y = Math.round(stroke.last.y + ((point.y - stroke.last.y) * i) / steps);
        applyShade({ x, y });
      }
      applyShade(point);
      stroke.last = point;
      return;
    }

    stroke.last = point;
    updateShapePreview();
  }

  function onPointerUp(e: ReactPointerEvent<HTMLCanvasElement>): void {
    const stroke = strokeRef.current;
    if (!stroke.kind) return;

    if (stroke.kind === 'pan') {
      deps.dispatch({ type: 'view/pan', x: deps.viewRef.current.pan.x, y: deps.viewRef.current.pan.y });
    } else if (stroke.kind === 'paint') {
      commitStroke('dibujar');
    } else if (stroke.kind === 'shape') {
      updateShapePreview();
      commitStroke('figura');
    } else if (stroke.kind === 'gradient') {
      updateShapePreview();
      commitStroke('degradado');
    } else if (stroke.kind === 'shade') {
      commitStroke('sombreado');
    } else if (stroke.kind === 'marquee') {
      const rect = normalizeRect(stroke.start, stroke.last);
      if (rect.w <= 1 && rect.h <= 1 && !stroke.moved) {
        deps.dispatch({ type: 'selection/set', rect: null });
      }
    }

    strokeRef.current = emptyStroke();
    (e.target as HTMLCanvasElement).releasePointerCapture?.(e.pointerId);
  }

  function onPointerLeave(): void {
    setCursor({ inside: false });
  }

  return { onPointerDown, onPointerMove, onPointerUp, onPointerLeave };
}

function normalizeRect(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x) + 1,
    h: Math.abs(b.y - a.y) + 1,
  };
}

/** Restringe la línea a ángulos de 45° cuando se pulsa Shift. */
function constrainAngle(start: Point, end: Point): Point {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  const length = Math.sqrt(dx * dx + dy * dy);
  return {
    x: Math.round(start.x + Math.cos(angle) * length),
    y: Math.round(start.y + Math.sin(angle) * length),
  };
}
