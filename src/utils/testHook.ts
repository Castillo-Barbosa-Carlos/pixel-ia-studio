/**
 * Ganchos de inspección para pruebas E2E (`window.__PIXEL_IA__`).
 * Expone un resumen plano del documento y utilidades de coordenadas para que
 * los tests puedan verificar el estado sin depender del DOM interno.
 */
import type { EditorState } from '../state/editorStore.tsx';
import { compositeToRgba } from '../core/layers.ts';
import { toRows } from '../core/matrix.ts';
import { canRedo, canUndo } from '../core/history.ts';

export interface TestStateSummary {
  width: number;
  height: number;
  palette: string[];
  layers: Array<{
    id: string;
    name: string;
    visible: boolean;
    locked: boolean;
    opacity: number;
    matrix: number[][];
  }>;
  activeLayerIndex: number;
  tool: string;
  colorIndex: number;
  secondaryIndex: number;
  zoom: number;
  pan: { x: number; y: number };
  showGrid: boolean;
  panels: Record<string, boolean>;
  selection: { x: number; y: number; w: number; h: number } | null;
  hasFloating: boolean;
  clipboardSize: number | null;
  canUndo: boolean;
  canRedo: boolean;
  modified: boolean;
  aiStatus: string;
  aiPreview: {
    width: number;
    height: number;
    paletteCount: number;
    layerCount: number;
  } | null;
  aiErrors: string[];
}

export function summarizeState(state: EditorState): TestStateSummary {
  const doc = state.history.present;
  return {
    width: doc.width,
    height: doc.height,
    palette: doc.palette.map((c) => (c.alpha >= 255 ? c.hex : `${c.hex}${c.alpha.toString(16).padStart(2, '0')}`)),
    layers: doc.layers.map((layer) => ({
      id: layer.id,
      name: layer.name,
      visible: layer.visible,
      locked: layer.locked,
      opacity: layer.opacity,
      matrix: toRows(layer.matrix, doc.width, doc.height),
    })),
    activeLayerIndex: doc.layers.findIndex((l) => l.id === state.activeLayerId),
    tool: state.tool,
    colorIndex: state.colorIndex,
    secondaryIndex: state.secondaryIndex,
    zoom: state.zoom,
    pan: { ...state.pan },
    showGrid: state.showGrid,
    panels: { ...state.panels },
    selection: state.selection ? { ...state.selection } : null,
    hasFloating: state.floating !== null,
    clipboardSize: state.clipboard ? state.clipboard.width * state.clipboard.height : null,
    canUndo: canUndo(state.history),
    canRedo: canRedo(state.history),
    modified: state.project.modified,
    aiStatus: state.ai.status,
    aiPreview: state.ai.preview
      ? {
          width: state.ai.preview.result.width,
          height: state.ai.preview.result.height,
          paletteCount: state.ai.preview.result.palette.length,
          layerCount: state.ai.preview.result.layers.length,
        }
      : null,
    aiErrors: state.ai.validationErrors,
  };
}

/** RGBA compuesto en una coordenada del lienzo (para verificar la composición). */
export function compositeAt(state: EditorState, x: number, y: number): [number, number, number, number] {
  const doc = state.history.present;
  const rgba = compositeToRgba(doc);
  const o = (y * doc.width + x) * 4;
  return [rgba[o], rgba[o + 1], rgba[o + 2], rgba[o + 3]];
}
