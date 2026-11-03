/**
 * Atajos de teclado de la aplicación.
 * Los atajos se ignoran cuando el foco está en un campo de texto.
 */
import { useEffect } from 'react';
import type { Dispatch } from 'react';
import type { ToolId } from '../types/index.ts';
import type { EditorAction, EditorState } from '../state/editorStore.tsx';
import { MAX_ZOOM, MIN_ZOOM, ZOOM_LEVELS, snapZoom } from '../state/editorStore.tsx';
import { isTypingTarget } from './keys.ts';

const TOOL_KEYS: Record<string, ToolId> = {
  b: 'pencil',
  t: 'pencil-eraser',
  e: 'eraser',
  i: 'eyedropper',
  g: 'fill',
  l: 'line',
  r: 'rect',
  o: 'ellipse',
  d: 'gradient',
  s: 'shade',
  m: 'select',
};

export interface KeyboardHandlers {
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onExportPng: () => void;
  onFit: () => void;
}

export function useKeyboard(handlers: KeyboardHandlers): void {
  const { state, dispatch, onNew, onOpen, onSave, onExportPng, onFit } = handlers;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const key = e.key.toLowerCase();

      const ctrl = e.ctrlKey || e.metaKey;

      if (ctrl) {
        switch (key) {
          case 'z':
            e.preventDefault();
            dispatch({ type: e.shiftKey ? 'redo' : 'undo' });
            return;
          case 'y':
            e.preventDefault();
            dispatch({ type: 'redo' });
            return;
          case 'c':
            e.preventDefault();
            dispatch({ type: 'clipboard/copy' });
            return;
          case 'x':
            e.preventDefault();
            dispatch({ type: 'clipboard/cut' });
            return;
          case 'v':
            e.preventDefault();
            dispatch({ type: 'clipboard/paste' });
            return;
          case 'a':
            e.preventDefault();
            dispatch({ type: 'selection/selectAll' });
            return;
          case 's':
            e.preventDefault();
            onSave();
            return;
          case 'o':
            e.preventDefault();
            onOpen();
            return;
          case 'n':
            e.preventDefault();
            onNew();
            return;
          case 'e':
            e.preventDefault();
            onExportPng();
            return;
          case 'g':
            e.preventDefault();
            dispatch({ type: 'view/grid' });
            return;
          case '1':
          case '2':
          case '3':
          case '4': {
            e.preventDefault();
            const panels = ['top', 'left', 'right', 'bottom'] as const;
            dispatch({ type: 'panels/toggle', panel: panels[Number(key) - 1] });
            return;
          }
          case '+':
          case '=':
            e.preventDefault();
            dispatch({ type: 'view/zoom', zoom: nextZoom(state.zoom, 1) });
            return;
          case '-':
            e.preventDefault();
            dispatch({ type: 'view/zoom', zoom: nextZoom(state.zoom, -1) });
            return;
          case '0':
            e.preventDefault();
            onFit();
            return;
          default:
            return;
        }
      }

      // Herramientas
      const tool = TOOL_KEYS[key];
      if (tool) {
        e.preventDefault();
        dispatch({ type: 'tool/set', tool });
        return;
      }

      switch (e.key) {
        case 'Delete':
        case 'Backspace':
          e.preventDefault();
          dispatch({ type: 'selection/delete' });
          break;
        case 'Enter':
          if (state.floating) {
            e.preventDefault();
            dispatch({ type: 'floating/commit' });
          }
          break;
        case 'Escape':
          e.preventDefault();
          if (state.floating) dispatch({ type: 'floating/cancel' });
          else if (state.selection) dispatch({ type: 'selection/set', rect: null });
          break;
        case 'h':
        case 'H':
          e.preventDefault();
          dispatch({ type: 'view/grid' });
          break;
        case '[':
          e.preventDefault();
          dispatch({
            type: 'tool/options',
            patch: { brushSize: Math.max(1, state.toolOptions.brushSize - 1) },
          });
          break;
        case ']':
          e.preventDefault();
          dispatch({
            type: 'tool/options',
            patch: { brushSize: Math.min(16, state.toolOptions.brushSize + 1) },
          });
          break;
        case '0':
          e.preventDefault();
          onFit();
          break;
        case '+':
        case '=':
          e.preventDefault();
          dispatch({ type: 'view/zoom', zoom: nextZoom(state.zoom, 1) });
          break;
        case '-':
          e.preventDefault();
          dispatch({ type: 'view/zoom', zoom: nextZoom(state.zoom, -1) });
          break;
        default:
          break;
      }
    };

    const onKeyUp = () => {};
    const onBlur = () => {};

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [state, dispatch, onNew, onOpen, onSave, onExportPng, onFit]);
}

function nextZoom(zoom: number, direction: 1 | -1): number {
  const current = snapZoom(zoom);
  const index = ZOOM_LEVELS.indexOf(current);
  const next = ZOOM_LEVELS[Math.max(0, Math.min(ZOOM_LEVELS.length - 1, index + direction))];
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next));
}
