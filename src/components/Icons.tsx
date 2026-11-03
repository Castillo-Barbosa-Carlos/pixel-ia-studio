/**
 * Iconos SVG en línea (trazo de 1.5px sobre rejilla de 16x16).
 * Sin dependencias de iconografía externa.
 */
import type { CSSProperties } from 'react';

export type IconName =
  | 'pencil'
  | 'pencil-eraser'
  | 'eraser'
  | 'eyedropper'
  | 'fill'
  | 'line'
  | 'rect'
  | 'ellipse'
  | 'gradient'
  | 'shade'
  | 'select'
  | 'undo'
  | 'redo'
  | 'eye'
  | 'eye-off'
  | 'lock'
  | 'unlock'
  | 'plus'
  | 'trash'
  | 'copy'
  | 'duplicate'
  | 'up'
  | 'down'
  | 'grid'
  | 'save'
  | 'folder'
  | 'image'
  | 'palette'
  | 'settings'
  | 'sparkles'
  | 'check'
  | 'x'
  | 'refresh'
  | 'panel-left'
  | 'panel-right'
  | 'panel-top'
  | 'panel-bottom';

const PATHS: Record<IconName, string> = {
  pencil: 'M2 14l1-3L11 3l2 2L5 13l-3 1z M10 4l2 2',
  'pencil-eraser': 'M1 10l1-2.5L7.5 2l2 2-5.5 5.5L3 10z M7.5 3.5l2 2 M7 13.5l2.5-2.5 3 3-2.5 2.5z M6 15.5h8.5',
  eraser: 'M6 14h8 M3 11l6-6 4 4-6 6H5l-2-2z',
  eyedropper: 'M3 13l1-3 6-6 2 2-6 6-3 1z M10 4l2-2 2 2-2 2',
  fill: 'M8 2l5 5-5 5-5-5z M13 11c0 1.5 1 2 1 2s1-.5 1-2-1-2-1-2',
  line: 'M3 13L13 3',
  rect: 'M2 4h12v8H2z',
  ellipse: 'M8 2c3.5 0 6 2.5 6 6s-2.5 6-6 6-6-2.5-6-6 2.5-6 6-6z',
  gradient: 'M2 2h12v12H2z M2 8h12 M8 2v12',
  shade: 'M8 2v12 M4 5h8 M4 11h8 M2 8h12',
  select: 'M2 5V2h3 M11 2h3v3 M14 11v3h-3 M5 14H2v-3',
  undo: 'M6 4L2 8l4 4 M2 8h7a4 4 0 010 8',
  redo: 'M10 4l4 4-4 4 M14 8H7a4 4 0 000 8',
  eye: 'M1 8s3-5 7-5 7 5 7 5-3 5-7 5-7-5-7-5z M8 6a2 2 0 100 4 2 2 0 000-4z',
  'eye-off': 'M2 2l12 12 M6 6a3 3 0 004 4 M1 8s3-5 7-5 7 5 7 5-3 5-7 5',
  lock: 'M4 7h8v7H4z M6 7V5a2 2 0 014 0v2',
  unlock: 'M4 7h8v7H4z M6 7V5a2 2 0 014 0',
  plus: 'M8 3v10 M3 8h10',
  trash: 'M3 4h10 M6 4V2h4v2 M5 4l1 10h4l1-10',
  copy: 'M5 5h8v8H5z M3 11V3h8',
  duplicate: 'M5 5h8v8H5z M3 11V3h8 M9 8h2 M10 7v2',
  up: 'M8 13V3 M4 7l4-4 4 4',
  down: 'M8 3v10 M4 9l4 4 4-4',
  grid: 'M2 2h12v12H2z M2 6h12 M2 10h12 M6 2v12 M10 2v12',
  save: 'M3 3h8l2 2v8H3z M5 3v4h5V3 M5 13v-4h6v4',
  folder: 'M2 4h5l1 2h6v8H2z',
  image: 'M2 3h12v10H2z M5 6a1 1 0 100-2 1 1 0 000 2z M2 11l4-4 3 3 2-2 3 3',
  palette: 'M8 2a6 6 0 100 12c1 0 1-1 0-1s-1-2 1-2h2a3 3 0 003-3c0-3-3-6-6-6z M5 6h.01 M8 4h.01 M11 6h.01',
  settings: 'M8 5a3 3 0 100 6 3 3 0 000-6z M8 1v2 M8 13v2 M1 8h2 M13 8h2 M3 3l1.5 1.5 M11.5 11.5L13 13 M13 3l-1.5 1.5 M4.5 11.5L3 13',
  sparkles: 'M6 2l1 3 3 1-3 1-1 3-1-3-3-1 3-1z M12 8l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z',
  check: 'M3 8l3 3 7-7',
  x: 'M4 4l8 8 M12 4l-8 8',
  refresh: 'M13 7a5 5 0 10-1 4 M13 3v4h-4',
  'panel-left': 'M2 2h12v12H2z M6 2v12',
  'panel-right': 'M2 2h12v12H2z M10 2v12',
  'panel-top': 'M2 2h12v12H2z M2 6h12',
  'panel-bottom': 'M2 2h12v12H2z M2 10h12',
};

export function Icon({
  name,
  size = 16,
  style,
  className,
}: {
  name: IconName;
  size?: number;
  style?: CSSProperties;
  className?: string;
}): JSX.Element {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
