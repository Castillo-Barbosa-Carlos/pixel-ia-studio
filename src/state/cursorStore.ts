/**
 * Store mínimo de posición de cursor (X/Y) fuera del ciclo de React.
 * La barra de estado se suscribe con `useSyncExternalStore` para que mover el
 * ratón no re-renderice el árbol completo de la aplicación.
 */
import { useSyncExternalStore } from 'react';

export interface CursorState {
  x: number;
  y: number;
  inside: boolean;
}

let state: CursorState = { x: -1, y: -1, inside: false };
const listeners = new Set<() => void>();

export function setCursor(next: Partial<CursorState>): void {
  const merged = { ...state, ...next };
  if (merged.x === state.x && merged.y === state.y && merged.inside === state.inside) return;
  state = merged;
  for (const listener of listeners) listener();
}

export function getCursor(): CursorState {
  return state;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useCursor(): CursorState {
  return useSyncExternalStore(subscribe, getCursor, getCursor);
}
