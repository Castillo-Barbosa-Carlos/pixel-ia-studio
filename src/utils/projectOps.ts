/**
 * Operaciones de archivo del proyecto: nuevo, abrir, guardar, exportar PNG,
 * importar/exportar paletas. Funciones puras sobre el estado del editor.
 */
import type { Dispatch } from 'react';
import type { PaletteFormat } from '../core/palette.ts';
import {
  serializePaletteGpl,
  serializePaletteHex,
  serializePaletteJson,
  parsePalette,
} from '../core/palette.ts';
import { parseProject, serializeProject, createEmptyDoc } from '../core/project.ts';
import { compositeToRgba, layerToRgba } from '../core/layers.ts';
import { toImageData } from './canvas.ts';
import type { EditorAction, EditorState, Toast } from '../state/editorStore.tsx';
import { downloadCanvasPng, downloadText, readTextFile } from './files.ts';

type Notify = (message: string, kind?: Toast['kind']) => void;

export function newProject(
  dispatch: Dispatch<EditorAction>,
  width: number,
  height: number,
  notify: Notify,
): void {
  const doc = createEmptyDoc(width, height);
  dispatch({ type: 'doc/replace', doc, fileName: null });
  notify(`Proyecto nuevo de ${width}x${height} creado.`, 'success');
}

export async function openProject(dispatch: Dispatch<EditorAction>, notify: Notify): Promise<void> {
  const file = await readTextFile('.json,application/json');
  if (!file) return;
  const result = parseProject(file.text);
  if (!result.ok) {
    notify(`No se pudo abrir el proyecto: ${result.errors[0]}`, 'error');
    return;
  }
  dispatch({ type: 'doc/replace', doc: result.value, fileName: file.name });
  notify(`Proyecto "${file.name}" cargado.`, 'success');
}

export function saveProject(state: EditorState, dispatch: Dispatch<EditorAction>, notify: Notify): void {
  const doc = state.history.present;
  const name = (state.project.fileName ?? 'proyecto').replace(/\.json$/i, '');
  downloadText(`${name}.pixelia.json`, serializeProject(doc));
  dispatch({ type: 'project/patch', patch: { modified: false } });
  notify('Proyecto guardado como JSON.', 'success');
}

export function exportProject(state: EditorState, notify: Notify): void {
  const doc = state.history.present;
  const name = (state.project.fileName ?? 'proyecto').replace(/\.json$/i, '');
  downloadText(`${name}.pixelia.json`, serializeProject(doc));
  notify('Proyecto exportado.', 'success');
}

/** Exporta el compuesto de capas visibles como PNG con escala de píxeles. */
export function exportPng(state: EditorState, scale: number, notify: Notify): void {
  const doc = state.history.present;
  const source = document.createElement('canvas');
  source.width = doc.width;
  source.height = doc.height;
  const ctx = source.getContext('2d');
  if (!ctx) return;
  ctx.putImageData(toImageData(compositeToRgba(doc), doc.width, doc.height), 0, 0);

  const target = document.createElement('canvas');
  target.width = doc.width * scale;
  target.height = doc.height * scale;
  const tctx = target.getContext('2d');
  if (!tctx) return;
  tctx.imageSmoothingEnabled = false;
  tctx.drawImage(source, 0, 0, target.width, target.height);

  const name = (state.project.fileName ?? 'pixel-art').replace(/\.(json|png)$/i, '');
  downloadCanvasPng(`${name}${scale > 1 ? `@${scale}x` : ''}.png`, target);
  notify(`PNG exportado (${doc.width * scale}x${doc.height * scale}).`, 'success');
}

/** Exporta solo la capa activa como PNG. */
export function exportActiveLayerPng(state: EditorState, scale: number, notify: Notify): void {
  const doc = state.history.present;
  const layer = doc.layers.find((l) => l.id === state.activeLayerId);
  if (!layer) return;
  const source = document.createElement('canvas');
  source.width = doc.width;
  source.height = doc.height;
  const ctx = source.getContext('2d');
  if (!ctx) return;
  ctx.putImageData(toImageData(layerToRgba(layer, doc.palette), doc.width, doc.height), 0, 0);

  const target = document.createElement('canvas');
  target.width = doc.width * scale;
  target.height = doc.height * scale;
  const tctx = target.getContext('2d');
  if (!tctx) return;
  tctx.imageSmoothingEnabled = false;
  tctx.drawImage(source, 0, 0, target.width, target.height);

  downloadCanvasPng(`${layer.name.replace(/\s+/g, '-').toLowerCase()}.png`, target);
  notify(`Capa "${layer.name}" exportada.`, 'success');
}

export async function importPalette(
  dispatch: Dispatch<EditorAction>,
  mode: 'replace' | 'append',
  notify: Notify,
): Promise<void> {
  const file = await readTextFile('.json,.gpl,.hex,.txt,application/json,text/plain');
  if (!file) return;
  try {
    const colors = parsePalette(file.text);
    dispatch({ type: 'palette/import', colors, mode });
    notify(`Paleta importada (${colors.length} colores).`, 'success');
  } catch (e) {
    notify(`No se pudo importar la paleta: ${(e as Error).message}`, 'error');
  }
}

export function exportPalette(state: EditorState, format: PaletteFormat, notify: Notify): void {
  const palette = state.history.present.palette;
  const name = 'paleta';
  if (format === 'json') {
    downloadText(`${name}.json`, serializePaletteJson(palette), 'application/json');
  } else if (format === 'gpl') {
    downloadText(`${name}.gpl`, serializePaletteGpl(palette), 'text/plain');
  } else {
    downloadText(`${name}.hex`, serializePaletteHex(palette), 'text/plain');
  }
  notify(`Paleta exportada (${format.toUpperCase()}).`, 'success');
}

/** Exporta el resultado de la IA como JSON (para compartir/reutilizar). */
export function exportAiResult(json: string, notify: Notify): void {
  downloadText('resultado-ia.json', json, 'application/json');
  notify('Resultado de la IA exportado.', 'success');
}
