/**
 * Estado global del editor.
 *
 * Dos dominios separados:
 *  - Documento (`history.present`): lienzo, paleta y capas. Todo cambio es
 *    deshacer/rehacer.
 *  - Sesión/UI: herramienta, color activo, zoom, selección, paneles, IA y
 *    avisos. No entra en el historial.
 *
 * El documento se trata como inmutable: cada operación construye un
 * `ProjectDoc` nuevo reutilizando las matrices de las capas no tocadas.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type ReactNode,
} from 'react';
import type {
  AiMode,
  AiPreview,
  AiProgress,
  AiSettings,
  AiStatus,
  ClipboardData,
  FloatingSelection,
  Layer,
  PaletteColor,
  ProjectDoc,
  Rect,
  ToolId,
  ToolOptions,
} from '../types/index.ts';
import { LIMITS, TRANSPARENT } from '../types/index.ts';
import {
  canRedo,
  canUndo,
  createHistory,
  pushHistory,
  redo,
  replaceHistory,
  undo,
  type HistoryState,
} from '../core/history.ts';
import {
  cloneLayer,
  createLayer,
  findLayer,
  mergeFloating,
  nextLayerId,
  removePaletteIndex,
  resizeDoc,
} from '../core/layers.ts';
import {
  cloneMatrix,
  extractRegion,
  fillRect,
  replaceColor as replaceMatrixColor,
} from '../core/matrix.ts';
import { addColor, updateColor } from '../core/palette.ts';
import { createEmptyDoc } from '../core/project.ts';

export type PanelId = 'top' | 'left' | 'right' | 'bottom';

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'error';
  message: string;
}

export interface AiState {
  settings: AiSettings;
  mode: AiMode;
  prompt: string;
  status: AiStatus;
  error: string | null;
  validationErrors: string[];
  preview: AiPreview | null;
  models: string[];
  connectionInfo: string | null;
  /** Progreso de la generación en curso (streaming). */
  progress: AiProgress | null;
  /** Avisos no bloqueantes (p. ej. bloques descartados). */
  warnings: string[];
}

export interface EditorState {
  history: HistoryState;
  activeLayerId: string;
  tool: ToolId;
  toolOptions: ToolOptions;
  colorIndex: number;
  secondaryIndex: number;
  zoom: number;
  pan: { x: number; y: number };
  showGrid: boolean;
  selection: Rect | null;
  floating: FloatingSelection | null;
  clipboard: ClipboardData | null;
  panels: Record<PanelId, boolean>;
  ai: AiState;
  project: { modified: boolean; fileName: string | null };
  toasts: Toast[];
  /** Incremento para pedir al lienzo que ajuste el zoom a la pantalla. */
  fitNonce: number;
}

export type EditorAction =
  | { type: 'doc/commit'; doc: ProjectDoc; label?: string }
  | { type: 'doc/replace'; doc: ProjectDoc; fileName?: string | null }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'tool/set'; tool: ToolId }
  | { type: 'tool/options'; patch: Partial<ToolOptions> }
  | { type: 'color/set'; index: number; secondary?: boolean }
  | { type: 'palette/add'; color: PaletteColor }
  | { type: 'palette/update'; index: number; color: PaletteColor }
  | { type: 'palette/remove'; index: number }
  | { type: 'palette/replace'; from: number; to: number; scope: 'active' | 'all' }
  | { type: 'palette/import'; colors: PaletteColor[]; mode: 'replace' | 'append' }
  | { type: 'layers/add' }
  | { type: 'layers/duplicate'; id: string }
  | { type: 'layers/remove'; id: string }
  | { type: 'layers/rename'; id: string; name: string }
  | { type: 'layers/move'; id: string; direction: -1 | 1 }
  | { type: 'layers/visibility'; id: string }
  | { type: 'layers/lock'; id: string }
  | { type: 'layers/opacity'; id: string; opacity: number }
  | { type: 'layers/select'; id: string }
  | { type: 'canvas/resize'; width: number; height: number; anchor: 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' }
  | { type: 'view/zoom'; zoom: number; pan?: { x: number; y: number } }
  | { type: 'view/pan'; x: number; y: number }
  | { type: 'view/grid' }
  | { type: 'view/fit' }
  | { type: 'selection/set'; rect: Rect | null }
  | { type: 'selection/lift'; rect: Rect }
  | { type: 'floating/set'; floating: FloatingSelection | null }
  | { type: 'floating/commit' }
  | { type: 'floating/cancel' }
  | { type: 'clipboard/copy' }
  | { type: 'clipboard/cut' }
  | { type: 'clipboard/paste' }
  | { type: 'selection/delete' }
  | { type: 'selection/selectAll' }
  | { type: 'ai/patch'; patch: Partial<AiState> }
  | { type: 'ai/settings'; patch: Partial<AiSettings> }
  | { type: 'panels/toggle'; panel: PanelId }
  | { type: 'project/patch'; patch: Partial<EditorState['project']> }
  | { type: 'toast/push'; toast: Omit<Toast, 'id'> }
  | { type: 'toast/dismiss'; id: number };

let toastCounter = 0;

export const ZOOM_LEVELS = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64];
export const MIN_ZOOM = ZOOM_LEVELS[0];
export const MAX_ZOOM = ZOOM_LEVELS[ZOOM_LEVELS.length - 1];

export function snapZoom(zoom: number): number {
  let best = ZOOM_LEVELS[0];
  for (const level of ZOOM_LEVELS) {
    if (Math.abs(level - zoom) < Math.abs(best - zoom)) best = level;
  }
  return best;
}

function newDoc(history: HistoryState, doc: ProjectDoc, label: string): HistoryState {
  return pushHistory(history, doc, label);
}

function activeLayerOf(state: EditorState): Layer | undefined {
  return findLayer(state.history.present, state.activeLayerId);
}

/** Fusiona la selección flotante pendiente antes de otra operación de documento. */
function withFloatingMerged(state: EditorState, doc: ProjectDoc): ProjectDoc {
  if (!state.floating) return doc;
  const layer = findLayer(doc, state.activeLayerId);
  if (!layer) return doc;
  return {
    ...doc,
    layers: doc.layers.map((l) =>
      l.id === layer.id ? mergeFloating(l, doc.width, doc.height, state.floating as FloatingSelection) : l,
    ),
  };
}

/**
 * Documento con la selección flotante ya fusionada en la capa activa.
 * Los gestos de dibujo lo usan para trabajar sobre el estado real sin
 * depender del ciclo de render de React.
 */
export function mergeFloatingIntoDoc(state: EditorState): ProjectDoc {
  return withFloatingMerged(state, state.history.present);
}

function initialState(): EditorState {
  const doc = createEmptyDoc(16, 16);
  return {
    history: createHistory(doc),
    activeLayerId: doc.layers[0].id,
    tool: 'pencil',
    toolOptions: {
      brushSize: 1,
      shapeFilled: true,
      outlineWidth: 1,
      shadeStrength: 0.2,
      fillTolerance: 0,
    },
    colorIndex: 0,
    secondaryIndex: 1,
    zoom: 16,
    pan: { x: 0, y: 0 },
    showGrid: true,
    selection: null,
    floating: null,
    clipboard: null,
    panels: { top: true, left: true, right: true, bottom: true },
    ai: {
      settings: {
        provider: 'ollama',
        baseUrl: 'http://localhost:11434',
        model: 'qwen2.5-coder:1.5b',
        apiKey: '',
        temperature: 0.2,
        timeoutMs: 300000,
        maxTokens: 8192,
        tileSize: 8,
        reasoning: 'off',
      },
      mode: 'full',
      prompt: '',
      status: 'idle',
      error: null,
      validationErrors: [],
      preview: null,
      models: [],
      connectionInfo: null,
      progress: null,
      warnings: [],
    },
    project: { modified: false, fileName: null },
    toasts: [],
    fitNonce: 0,
  };
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  const doc = state.history.present;

  switch (action.type) {
    case 'doc/commit': {
      const next = action.doc;
      const layerIds = new Set(next.layers.map((l) => l.id));
      return {
        ...state,
        history: newDoc(state.history, next, action.label ?? 'cambio'),
        activeLayerId: layerIds.has(state.activeLayerId) ? state.activeLayerId : next.layers[next.layers.length - 1].id,
        selection: null,
        floating: null,
        project: { ...state.project, modified: true },
      };
    }

    case 'doc/replace': {
      const next = action.doc;
      return {
        ...state,
        history: replaceHistory(state.history, next),
        activeLayerId: next.layers[next.layers.length - 1].id,
        selection: null,
        floating: null,
        project: { modified: false, fileName: action.fileName ?? null },
      };
    }

    case 'undo': {
      if (!canUndo(state.history)) return state;
      const history = undo(state.history);
      const next = history.present;
      return {
        ...state,
        history,
        activeLayerId: findLayer(next, state.activeLayerId) ? state.activeLayerId : next.layers[next.layers.length - 1].id,
        selection: null,
        floating: null,
        project: { ...state.project, modified: true },
      };
    }

    case 'redo': {
      if (!canRedo(state.history)) return state;
      const history = redo(state.history);
      const next = history.present;
      return {
        ...state,
        history,
        activeLayerId: findLayer(next, state.activeLayerId) ? state.activeLayerId : next.layers[next.layers.length - 1].id,
        selection: null,
        floating: null,
        project: { ...state.project, modified: true },
      };
    }

    case 'tool/set':
      return { ...state, tool: action.tool };

    case 'tool/options':
      return { ...state, toolOptions: { ...state.toolOptions, ...action.patch } };

    case 'color/set': {
      const max = Math.max(0, doc.palette.length - 1);
      const index = Math.max(0, Math.min(max, action.index));
      return action.secondary
        ? { ...state, secondaryIndex: index }
        : { ...state, colorIndex: index };
    }

    case 'palette/add': {
      if (doc.palette.length >= LIMITS.maxPalette) return state;
      const nextDoc = { ...doc, palette: addColor(doc.palette, action.color) };
      return {
        ...state,
        history: newDoc(state.history, nextDoc, 'añadir color'),
        colorIndex: nextDoc.palette.length - 1,
        project: { ...state.project, modified: true },
      };
    }

    case 'palette/update': {
      const nextDoc = {
        ...doc,
        palette: updateColor(doc.palette, action.index, action.color),
      };
      return {
        ...state,
        history: newDoc(state.history, nextDoc, 'editar color'),
        project: { ...state.project, modified: true },
      };
    }

    case 'palette/remove': {
      if (doc.palette.length <= 1) return state;
      const nextDoc = removePaletteIndex(doc, action.index);
      const clampIndex = (i: number) => Math.max(0, Math.min(nextDoc.palette.length - 1, i - (i > action.index ? 1 : 0)));
      return {
        ...state,
        history: newDoc(state.history, nextDoc, 'eliminar color'),
        colorIndex: clampIndex(state.colorIndex),
        secondaryIndex: clampIndex(state.secondaryIndex),
        project: { ...state.project, modified: true },
      };
    }

    case 'palette/replace': {
      if (action.from === action.to) return state;
      const layers = doc.layers.map((layer) => {
        if (action.scope === 'active' && layer.id !== state.activeLayerId) return layer;
        const matrix = cloneMatrix(layer.matrix);
        replaceMatrixColor(matrix, action.from, action.to);
        return { ...layer, matrix };
      });
      const nextDoc = withFloatingMerged(state, { ...doc, layers });
      return {
        ...state,
        history: newDoc(state.history, nextDoc, 'reemplazar color'),
        floating: null,
        project: { ...state.project, modified: true },
      };
    }

    case 'palette/import': {
      const palette =
        action.mode === 'append'
          ? [...doc.palette, ...action.colors].slice(0, LIMITS.maxPalette)
          : action.colors;
      const nextDoc = { ...doc, palette };
      return {
        ...state,
        history: newDoc(state.history, nextDoc, 'importar paleta'),
        colorIndex: 0,
        secondaryIndex: Math.min(1, palette.length - 1),
        project: { ...state.project, modified: true },
      };
    }

    case 'layers/add': {
      if (doc.layers.length >= LIMITS.maxLayers) return state;
      const layer = createLayer(doc.width, doc.height, `Capa ${doc.layers.length + 1}`);
      const nextDoc = withFloatingMerged(state, { ...doc, layers: [...doc.layers, layer] });
      return {
        ...state,
        history: newDoc(state.history, nextDoc, 'crear capa'),
        activeLayerId: layer.id,
        floating: null,
        project: { ...state.project, modified: true },
      };
    }

    case 'layers/duplicate': {
      const index = doc.layers.findIndex((l) => l.id === action.id);
      if (index < 0 || doc.layers.length >= LIMITS.maxLayers) return state;
      const source = doc.layers[index];
      const copy: Layer = {
        ...cloneLayer(source),
        id: nextLayerId(),
        name: `${source.name} copia`,
      };
      const layers = [...doc.layers];
      layers.splice(index + 1, 0, copy);
      return {
        ...state,
        history: newDoc(state.history, { ...doc, layers }, 'duplicar capa'),
        activeLayerId: copy.id,
        project: { ...state.project, modified: true },
      };
    }

    case 'layers/remove': {
      if (doc.layers.length <= 1) return state;
      const layers = doc.layers.filter((l) => l.id !== action.id);
      const nextActive = state.activeLayerId === action.id ? layers[layers.length - 1].id : state.activeLayerId;
      return {
        ...state,
        history: newDoc(state.history, { ...doc, layers }, 'eliminar capa'),
        activeLayerId: nextActive,
        project: { ...state.project, modified: true },
      };
    }

    case 'layers/rename': {
      const name = action.name.trim().slice(0, 40);
      if (!name) return state;
      return {
        ...state,
        history: newDoc(
          state.history,
          { ...doc, layers: doc.layers.map((l) => (l.id === action.id ? { ...l, name } : l)) },
          'renombrar capa',
        ),
        project: { ...state.project, modified: true },
      };
    }

    case 'layers/move': {
      const index = doc.layers.findIndex((l) => l.id === action.id);
      const target = index + action.direction;
      if (index < 0 || target < 0 || target >= doc.layers.length) return state;
      const layers = [...doc.layers];
      const [moved] = layers.splice(index, 1);
      layers.splice(target, 0, moved);
      return {
        ...state,
        history: newDoc(state.history, { ...doc, layers }, 'reordenar capa'),
        project: { ...state.project, modified: true },
      };
    }

    case 'layers/visibility':
    case 'layers/lock':
    case 'layers/opacity': {
      const layers = doc.layers.map((l) => {
        if (l.id !== action.id) return l;
        if (action.type === 'layers/visibility') return { ...l, visible: !l.visible };
        if (action.type === 'layers/lock') return { ...l, locked: !l.locked };
        return { ...l, opacity: Math.max(0, Math.min(1, action.opacity)) };
      });
      return {
        ...state,
        history: newDoc(state.history, { ...doc, layers }, 'propiedades de capa'),
        project: { ...state.project, modified: true },
      };
    }

    case 'layers/select': {
      if (!findLayer(doc, action.id)) return state;
      return { ...state, activeLayerId: action.id, selection: null, floating: null };
    }

    case 'canvas/resize': {
      const width = Math.max(LIMITS.minSize, Math.min(LIMITS.maxSize, Math.round(action.width)));
      const height = Math.max(LIMITS.minSize, Math.min(LIMITS.maxSize, Math.round(action.height)));
      const merged = withFloatingMerged(state, doc);
      const nextDoc = resizeDoc(merged, width, height, action.anchor);
      return {
        ...state,
        history: newDoc(state.history, nextDoc, 'redimensionar lienzo'),
        selection: null,
        floating: null,
        project: { ...state.project, modified: true },
      };
    }

    case 'view/zoom':
      return {
        ...state,
        zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, action.zoom)),
        pan: action.pan ?? state.pan,
      };

    case 'view/pan':
      return { ...state, pan: { x: action.x, y: action.y } };

    case 'view/grid':
      return { ...state, showGrid: !state.showGrid };

    case 'view/fit':
      return { ...state, fitNonce: state.fitNonce + 1 };

    case 'selection/set':
      return {
        ...state,
        selection: action.rect,
        floating: action.rect ? state.floating : null,
      };

    case 'selection/lift': {
      const layer = activeLayerOf(state);
      if (!layer || layer.locked) return state;
      const matrix = cloneMatrix(layer.matrix);
      fillRect(matrix, doc.width, doc.height, action.rect, TRANSPARENT);
      return {
        ...state,
        history: newDoc(state.history, { ...doc, layers: doc.layers.map((l) => (l.id === layer.id ? { ...l, matrix } : l)) }, 'levantar selección'),
        floating: {
          x: action.rect.x,
          y: action.rect.y,
          width: action.rect.w,
          height: action.rect.h,
          matrix: extractRegion(layer.matrix, doc.width, action.rect),
          source: { x: action.rect.x, y: action.rect.y },
        },
        selection: action.rect,
        project: { ...state.project, modified: true },
      };
    }

    case 'floating/set':
      return {
        ...state,
        floating: action.floating,
        selection: action.floating
          ? { x: action.floating.x, y: action.floating.y, w: action.floating.width, h: action.floating.height }
          : state.selection,
      };

    case 'floating/commit': {
      if (!state.floating) return state;
      const layer = activeLayerOf(state);
      if (!layer) return state;
      const merged = mergeFloating(layer, doc.width, doc.height, state.floating);
      const nextDoc = {
        ...doc,
        layers: doc.layers.map((l) => (l.id === layer.id ? merged : l)),
      };
      return {
        ...state,
        history: newDoc(state.history, nextDoc, 'pegar selección'),
        floating: null,
        project: { ...state.project, modified: true },
      };
    }

    case 'floating/cancel': {
      const floating = state.floating;
      if (!floating) return state;
      if (!floating.source) return { ...state, floating: null, selection: null };
      const layer = activeLayerOf(state);
      if (!layer) return { ...state, floating: null, selection: null };
      const restored = mergeFloating(layer, doc.width, doc.height, {
        ...floating,
        x: floating.source.x,
        y: floating.source.y,
      });
      return {
        ...state,
        history: newDoc(state.history, { ...doc, layers: doc.layers.map((l) => (l.id === layer.id ? restored : l)) }, 'cancelar movimiento'),
        floating: null,
        selection: null,
        project: { ...state.project, modified: true },
      };
    }

    case 'clipboard/copy': {
      const layer = activeLayerOf(state);
      const rect = state.selection;
      if (!layer || !rect) return state;
      return {
        ...state,
        clipboard: {
          width: rect.w,
          height: rect.h,
          matrix: extractRegion(layer.matrix, doc.width, rect),
        },
      };
    }

    case 'clipboard/cut': {
      const layer = activeLayerOf(state);
      const rect = state.selection;
      if (!layer || !rect || layer.locked) return state;
      const clipboard: ClipboardData = {
        width: rect.w,
        height: rect.h,
        matrix: extractRegion(layer.matrix, doc.width, rect),
      };
      const matrix = cloneMatrix(layer.matrix);
      fillRect(matrix, doc.width, doc.height, rect, TRANSPARENT);
      return {
        ...state,
        clipboard,
        history: newDoc(state.history, withFloatingMerged(state, { ...doc, layers: doc.layers.map((l) => (l.id === layer.id ? { ...l, matrix } : l)) }), 'cortar'),
        floating: null,
        project: { ...state.project, modified: true },
      };
    }

    case 'selection/delete': {
      const layer = activeLayerOf(state);
      const rect = state.selection;
      if (!layer || !rect || layer.locked) return state;
      const matrix = cloneMatrix(layer.matrix);
      fillRect(matrix, doc.width, doc.height, rect, TRANSPARENT);
      return {
        ...state,
        history: newDoc(state.history, withFloatingMerged(state, { ...doc, layers: doc.layers.map((l) => (l.id === layer.id ? { ...l, matrix } : l)) }), 'borrar selección'),
        floating: null,
        project: { ...state.project, modified: true },
      };
    }

    case 'clipboard/paste': {
      const clipboard = state.clipboard;
      if (!clipboard) return state;
      const nextDoc = withFloatingMerged(state, doc);
      const x = state.selection
        ? state.selection.x
        : Math.round((doc.width - clipboard.width) / 2);
      const y = state.selection
        ? state.selection.y
        : Math.round((doc.height - clipboard.height) / 2);
      return {
        ...state,
        history: state.floating ? newDoc(state.history, nextDoc, 'pegar') : state.history,
        floating: {
          x,
          y,
          width: clipboard.width,
          height: clipboard.height,
          matrix: cloneMatrix(clipboard.matrix),
          source: null,
        },
        selection: { x, y, w: clipboard.width, h: clipboard.height },
        project: state.floating ? { ...state.project, modified: true } : state.project,
      };
    }

    case 'selection/selectAll':
      return {
        ...state,
        selection: state.selection ? null : { x: 0, y: 0, w: doc.width, h: doc.height },
      };

    case 'ai/patch':
      return { ...state, ai: { ...state.ai, ...action.patch } };

    case 'ai/settings':
      return { ...state, ai: { ...state.ai, settings: { ...state.ai.settings, ...action.patch } } };

    case 'panels/toggle':
      return { ...state, panels: { ...state.panels, [action.panel]: !state.panels[action.panel] } };

    case 'project/patch':
      return { ...state, project: { ...state.project, ...action.patch } };

    case 'toast/push': {
      toastCounter += 1;
      return {
        ...state,
        toasts: [...state.toasts, { ...action.toast, id: toastCounter }].slice(-5),
      };
    }

    case 'toast/dismiss':
      return { ...state, toasts: state.toasts.filter((t) => t.id !== action.id) };

    default:
      return state;
  }
}

/* ------------------------------------------------------------------ */
/* Contexto                                                            */
/* ------------------------------------------------------------------ */

interface EditorContextValue {
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
  stateRef: MutableRefObject<EditorState>;
  toast: (message: string, kind?: Toast['kind']) => void;
}

const EditorContext = createContext<EditorContextValue | null>(null);

export function EditorProvider({ children }: { children: ReactNode }): JSX.Element {
  const [state, dispatch] = useReducer(editorReducer, undefined, initialState);
  const stateRef = useRef(state);
  stateRef.current = state;

  const toast = useCallback((message: string, kind: Toast['kind'] = 'info') => {
    dispatch({ type: 'toast/push', toast: { kind, message } });
  }, []);

  const value = useMemo(() => ({ state, dispatch, stateRef, toast }), [state, toast]);

  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>;
}

export function useEditor(): EditorContextValue {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error('useEditor debe usarse dentro de <EditorProvider>.');
  return ctx;
}

/** Lanza un aviso y lo descarta automáticamente. */
export function useAutoToasts(): void {
  const { state, dispatch } = useEditor();
  useEffect(() => {
    if (state.toasts.length === 0) return;
    const timer = setTimeout(() => {
      dispatch({ type: 'toast/dismiss', id: state.toasts[0].id });
    }, 5000);
    return () => clearTimeout(timer);
  }, [state.toasts, dispatch]);
}

/* ---------------------------- selectores ---------------------------- */

export function selectDoc(state: EditorState): ProjectDoc {
  return state.history.present;
}

export function selectActiveLayer(state: EditorState): Layer | undefined {
  return findLayer(state.history.present, state.activeLayerId);
}

export function selectCanUndo(state: EditorState): boolean {
  return canUndo(state.history);
}

export function selectCanRedo(state: EditorState): boolean {
  return canRedo(state.history);
}
