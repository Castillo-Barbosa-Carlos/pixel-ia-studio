/**
 * Historial de deshacer/rehacer basado en snapshots del documento.
 *
 * Decisión: se guardan snapshots completos del `ProjectDoc` (con matrices
 * `Int16Array`) en lugar de parches. Las matrices confirmadas son inmutables
 * por convención (las herramientas trabajan sobre clones), por lo que las
 * entradas del historial comparten referencias de las capas no modificadas.
 * El coste es acotado: límite de 60 pasos y lienzo máximo de 256x256.
 */
import type { ProjectDoc } from '../types/index.ts';
import { LIMITS } from '../types/index.ts';

export interface HistoryState {
  past: ProjectDoc[];
  present: ProjectDoc;
  future: ProjectDoc[];
  limit: number;
  /** Etiqueta del último cambio (para depuración/UI). */
  label: string;
}

export function createHistory(present: ProjectDoc, limit: number = LIMITS.historyLimit): HistoryState {
  return { past: [], present, future: [], limit, label: 'inicio' };
}

/** Registra un nuevo estado del documento y limpia el futuro. */
export function pushHistory(
  history: HistoryState,
  next: ProjectDoc,
  label = 'cambio',
): HistoryState {
  const past = [...history.past, history.present];
  if (past.length > history.limit) past.splice(0, past.length - history.limit);
  return { ...history, past, present: next, future: [], label };
}

/** Sustituye el documento sin crear una entrada de historial (cargar proyecto). */
export function replaceHistory(history: HistoryState, doc: ProjectDoc): HistoryState {
  return { past: [], present: doc, future: [], limit: history.limit, label: 'cargar' };
}

export function canUndo(history: HistoryState): boolean {
  return history.past.length > 0;
}

export function canRedo(history: HistoryState): boolean {
  return history.future.length > 0;
}

export function undo(history: HistoryState): HistoryState {
  if (!canUndo(history)) return history;
  const past = history.past.slice();
  const present = past.pop() as ProjectDoc;
  return {
    ...history,
    past,
    present,
    future: [history.present, ...history.future],
    label: 'deshacer',
  };
}

export function redo(history: HistoryState): HistoryState {
  if (!canRedo(history)) return history;
  const [present, ...future] = history.future;
  return {
    ...history,
    past: [...history.past, history.present],
    present,
    future,
    label: 'rehacer',
  };
}
