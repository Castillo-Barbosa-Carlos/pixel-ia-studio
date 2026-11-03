/**
 * Catálogo de herramientas: etiquetas, atajos e iconos.
 * La lógica de dibujo vive en `src/canvas/useCanvasGestures.ts`.
 */
import type { ToolId } from '../types/index.ts';
import type { IconName } from '../components/Icons.tsx';

export interface ToolDef {
  id: ToolId;
  label: string;
  /** Atajo de teclado (letra sola, salvo indicación). */
  shortcut: string;
  icon: IconName;
  hint: string;
}

export const TOOLS: ToolDef[] = [
  { id: 'pencil', label: 'Lápiz', shortcut: 'B', icon: 'pencil', hint: 'Dibuja píxeles con el color activo.' },
  { id: 'pencil-eraser', label: 'Lápiz borrador', shortcut: 'T', icon: 'pencil-eraser', hint: 'Si el píxel donde empiezas está vacío dibuja; si tiene color, borra. La elección se toma al empezar el trazo.' },
  { id: 'eraser', label: 'Borrador', shortcut: 'E', icon: 'eraser', hint: 'Borra píxeles (transparencia) en la capa activa.' },
  { id: 'eyedropper', label: 'Gotero', shortcut: 'I', icon: 'eyedropper', hint: 'Toma el color del píxel bajo el cursor y vuelve al lápiz (Alt: capa activa).' },
  { id: 'fill', label: 'Relleno', shortcut: 'G', icon: 'fill', hint: 'Rellena un área conexa con el color activo.' },
  { id: 'line', label: 'Línea', shortcut: 'L', icon: 'line', hint: 'Dibuja una línea recta. Shift restringe el ángulo.' },
  { id: 'rect', label: 'Rectángulo', shortcut: 'R', icon: 'rect', hint: 'Rectángulo relleno o contorno. Shift: cuadrado.' },
  { id: 'ellipse', label: 'Elipse', shortcut: 'O', icon: 'ellipse', hint: 'Elipse rellena o contorno. Shift: círculo.' },
  { id: 'gradient', label: 'Degradado', shortcut: 'D', icon: 'gradient', hint: 'Degradado lineal entre el color activo y el secundario.' },
  { id: 'shade', label: 'Sombreado', shortcut: 'S', icon: 'shade', hint: 'Aclara los píxeles (Shift: oscurece). El color original del píxel se aclara u oscurece.' },
  { id: 'select', label: 'Selección', shortcut: 'M', icon: 'select', hint: 'Selecciona un área rectangular para copiar, cortar, mover o borrar.' },
];

export function toolById(id: ToolId): ToolDef {
  return TOOLS.find((t) => t.id === id) ?? TOOLS[0];
}

/** Atajos de la interfaz (fuera del catálogo de herramientas). */
export const SHORTCUTS: Array<{ keys: string; description: string }> = [
  { keys: 'B / T / E / I / G', description: 'Lápiz, lápiz borrador, borrador, gotero, relleno' },
  { keys: 'L / R / O / D / S / M', description: 'Línea, rectángulo, elipse, degradado, sombreado, selección' },
  { keys: 'Ctrl+Z / Ctrl+Y', description: 'Deshacer / rehacer' },
  { keys: 'Ctrl+C / Ctrl+X / Ctrl+V', description: 'Copiar / cortar / pegar selección' },
  { keys: 'Ctrl+A', description: 'Seleccionar todo / cancelar selección' },
  { keys: 'Supr / Retroceso', description: 'Borrar selección' },
  { keys: 'Enter / Esc', description: 'Confirmar / cancelar selección flotante' },
  { keys: 'Ctrl+S', description: 'Guardar proyecto (JSON)' },
  { keys: 'Ctrl+E', description: 'Exportar PNG' },
  { keys: 'Ctrl+1..4', description: 'Mostrar/ocultar paneles (superior, izquierdo, derecho, inferior)' },
  { keys: 'Ctrl+ + / - / 0', description: 'Acercar, alejar, ajustar a pantalla' },
  { keys: 'Clic der. + arrastrar', description: 'Desplazar el lienzo (también con botón central)' },
  { keys: '[ / ]', description: 'Reducir / aumentar tamaño de pincel' },
];
