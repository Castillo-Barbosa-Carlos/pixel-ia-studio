/**
 * Tests unitarios de la lógica pura del editor.
 * Ejecutar con: npm test  (node --test)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  colorToHexAlpha,
  nearestColorIndex,
  parseHexColor,
  rgbaToHex,
  shadeColor,
  rgbToHsv,
  hsvToRgb,
  hexToHsv,
  hsvToHex,
} from '../../src/core/color.ts';
import {
  blitMatrix,
  cloneMatrix,
  createMatrix,
  extractRegion,
  floodFill,
  fromRows,
  replaceColor,
  toRows,
} from '../../src/core/matrix.ts';
import { drawEllipse, drawGradient, drawLine, drawRect, rectFromPoints } from '../../src/core/raster.ts';
import { compositeToRgba, removePaletteIndex, resizeDoc } from '../../src/core/layers.ts';
import { canRedo, canUndo, createHistory, pushHistory, redo, undo } from '../../src/core/history.ts';
import {
  detectPaletteFormat,
  parsePalette,
  serializePaletteGpl,
  serializePaletteHex,
  serializePaletteJson,
} from '../../src/core/palette.ts';
import { createEmptyDoc, docFromRows, parseProject, serializeProject } from '../../src/core/project.ts';
import { countPainted, matrixEquals } from '../../src/core/matrix.ts';

/* ----------------------------- color ----------------------------- */

test('parseHexColor acepta #rgb, #rrggbb y #rrggbbaa', () => {
  assert.deepEqual(parseHexColor('#F00'), { hex: '#ff0000', alpha: 255 });
  assert.deepEqual(parseHexColor('#00ff00'), { hex: '#00ff00', alpha: 255 });
  assert.deepEqual(parseHexColor('#11223380'), { hex: '#112233', alpha: 128 });
  assert.equal(parseHexColor('no-color'), null);
  assert.equal(parseHexColor('#12345'), null);
});

test('shadeColor aclara y oscurece', () => {
  assert.equal(shadeColor({ hex: '#808080', alpha: 255 }, 1).hex, '#ffffff');
  assert.equal(shadeColor({ hex: '#808080', alpha: 255 }, -1).hex, '#000000');
  const mid = shadeColor({ hex: '#000000', alpha: 255 }, 0.5);
  assert.equal(mid.hex, '#808080');
});

test('conversiones RGB a HSV y HSV a RGB', () => {
  // Rojo puro
  assert.deepEqual(rgbToHsv(255, 0, 0), [0, 100, 100]);
  assert.deepEqual(hsvToRgb(0, 100, 100), [255, 0, 0]);

  // Verde puro
  assert.deepEqual(rgbToHsv(0, 255, 0), [120, 100, 100]);
  assert.deepEqual(hsvToRgb(120, 100, 100), [0, 255, 0]);

  // Blanco y negro
  assert.deepEqual(rgbToHsv(255, 255, 255), [0, 0, 100]);
  assert.deepEqual(rgbToHsv(0, 0, 0), [0, 0, 0]);

  // Hex roundtrip
  assert.equal(hsvToHex(0, 100, 100), '#ff0000');
  assert.deepEqual(hexToHsv('#ff0000'), [0, 100, 100]);
});

test('nearestColorIndex encuentra el color más cercano', () => {
  const palette = [
    { hex: '#000000', alpha: 255 },
    { hex: '#ff0000', alpha: 255 },
    { hex: '#0000ff', alpha: 255 },
  ];
  assert.equal(nearestColorIndex(250, 10, 10, palette), 1);
  assert.equal(nearestColorIndex(0, 0, 200, palette), 2);
  assert.equal(colorToHexAlpha({ hex: '#112233', alpha: 128 }), '#11223380');
  assert.equal(rgbaToHex(255, 255, 255), '#ffffff');
});

/* ----------------------------- matrix ---------------------------- */

test('floodFill rellena un área 4-conectada', () => {
  const m = createMatrix(4, 4, -1);
  // un obstáculo vertical en x=2
  for (let y = 0; y < 4; y++) m[y * 4 + 2] = 5;
  floodFill(m, 4, 4, 0, 0, 3);
  assert.equal(m[0], 3);
  assert.equal(m[3], -1); // al otro lado de la barrera: no se rellena
  assert.equal(m[2], 5); // la barrera no se pinta
  assert.equal(m[4], 3); // fila 1, x=0
});

test('floodFill no cruza barreras ni cambia si el destino es igual', () => {
  const rows = [
    [1, 1, 2],
    [1, 2, 2],
    [1, 1, 1],
  ];
  const m = fromRows(rows, 3, 3);
  assert.equal(floodFill(m, 3, 3, 0, 0, 9), true);
  assert.deepEqual(toRows(m, 3, 3), [
    [9, 9, 2],
    [9, 2, 2],
    [9, 9, 9],
  ]);
  assert.equal(floodFill(m, 3, 3, 0, 0, 9), false); // sin cambios
});

test('replaceColor y blitMatrix funcionan sobre copias', () => {
  const m = fromRows([[0, 1], [1, 0]], 2, 2);
  replaceColor(m, 1, 7);
  assert.deepEqual(toRows(m, 2, 2), [[0, 7], [7, 0]]);

  const dst = createMatrix(3, 3, -1);
  const src = fromRows([[1, 2], [-1, 4]], 2, 2);
  blitMatrix(dst, 3, 3, src, 2, 2, 1, 1);
  assert.deepEqual(toRows(dst, 3, 3), [
    [-1, -1, -1],
    [-1, 1, 2],
    [-1, -1, 4],
  ]);
});

test('extractRegion recorta respetando límites', () => {
  const m = fromRows([[1, 2, 3], [4, 5, 6]], 3, 2);
  const region = extractRegion(m, 3, { x: 1, y: 0, w: 2, h: 2 });
  assert.deepEqual(toRows(region, 2, 2), [[2, 3], [5, 6]]);
  const outside = extractRegion(m, 3, { x: -1, y: 0, w: 2, h: 1 });
  assert.deepEqual(toRows(outside, 2, 1), [[-1, 1]]);
});

/* ----------------------------- raster ---------------------------- */

test('drawLine dibuja una línea de Bresenham', () => {
  const m = createMatrix(5, 5, -1);
  drawLine(m, 5, 5, 0, 0, 4, 4, 2);
  assert.deepEqual(toRows(m, 5, 5), [
    [2, -1, -1, -1, -1],
    [-1, 2, -1, -1, -1],
    [-1, -1, 2, -1, -1],
    [-1, -1, -1, 2, -1],
    [-1, -1, -1, -1, 2],
  ]);
});

test('drawRect relleno y contorno', () => {
  const filled = createMatrix(4, 4, -1);
  drawRect(filled, 4, 4, 0, 0, 2, 2, 1, true);
  assert.deepEqual(toRows(filled, 4, 4), [
    [1, 1, 1, -1],
    [1, 1, 1, -1],
    [1, 1, 1, -1],
    [-1, -1, -1, -1],
  ]);

  const outline = createMatrix(4, 4, -1);
  drawRect(outline, 4, 4, 0, 0, 2, 2, 1, false);
  assert.deepEqual(toRows(outline, 4, 4), [
    [1, 1, 1, -1],
    [1, -1, 1, -1],
    [1, 1, 1, -1],
    [-1, -1, -1, -1],
  ]);
});

test('drawEllipse dibuja dentro de su caja', () => {
  const m = createMatrix(5, 5, -1);
  drawEllipse(m, 5, 5, 0, 0, 4, 4, 1, true);
  const rows = toRows(m, 5, 5);
  assert.equal(rows[2][2], 1); // centro pintado
  assert.equal(rows[0][0], -1); // esquinas fuera de la elipse
  assert.equal(countPainted(m) >= 17, true);
});

test('drawGradient interpola entre dos índices de paleta', () => {
  const palette = [
    { hex: '#000000', alpha: 255 },
    { hex: '#ffffff', alpha: 255 },
  ];
  const m = createMatrix(4, 1, -1);
  drawGradient(m, 4, 1, { x: 0, y: 0, w: 4, h: 1 }, { x: 0, y: 0 }, { x: 3, y: 0 }, 0, 1, palette);
  const row = toRows(m, 4, 1)[0];
  assert.equal(row[0], 0);
  assert.equal(row[3], 1);
  assert.equal(row[1] === 0 || row[1] === 1, true);
});

test('rectFromPoints normaliza el rectángulo del arrastre', () => {
  assert.deepEqual(rectFromPoints(3, 3, 1, 1), { x: 1, y: 1, w: 3, h: 3 });
  assert.deepEqual(rectFromPoints(0, 0, 2, 0), { x: 0, y: 0, w: 3, h: 1 });
});

/* ----------------------------- layers ---------------------------- */

test('compositeToRgba compone capas visibles con transparencia', () => {
  const result = docFromRows(
    ['#ff0000', '#0000ff'],
    [
      [0, -1],
      [-1, 1],
    ],
    'base',
  );
  assert.equal(result.ok, true);
  const doc = result.ok ? result.value : createEmptyDoc(2, 2);
  const rgba = compositeToRgba(doc);
  assert.deepEqual([rgba[0], rgba[1], rgba[2], rgba[3]], [255, 0, 0, 255]);
  assert.equal(rgba[7], 0); // píxel transparente
  assert.deepEqual([rgba[12], rgba[13], rgba[14], rgba[15]], [0, 0, 255, 255]);

  // capa oculta no contribuye
  const hidden = { ...doc, layers: [{ ...doc.layers[0], visible: false }] };
  const empty = compositeToRgba(hidden);
  assert.equal(empty.every((v) => v === 0), true);
});

test('resizeDoc preserva el contenido centrado', () => {
  const result = docFromRows(['#ff0000', '#000000'], [[1, 0], [0, 0]], 'base');
  const doc = result.ok ? result.value : createEmptyDoc(2, 2);
  const bigger = resizeDoc(doc, 4, 4, 'center');
  assert.equal(bigger.width, 4);
  assert.deepEqual(toRows(bigger.layers[0].matrix, 4, 4), [
    [-1, -1, -1, -1],
    [-1, 1, 0, -1],
    [-1, 0, 0, -1],
    [-1, -1, -1, -1],
  ]);
});

test('removePaletteIndex remapea índices en todas las capas', () => {
  const result = docFromRows(['#ff0000', '#00ff00'], [[0, 1], [1, 0]], 'base');
  const doc = result.ok ? result.value : createEmptyDoc(2, 2);
  const next = removePaletteIndex(doc, 0);
  assert.equal(next.palette.length, 1);
  assert.deepEqual(toRows(next.layers[0].matrix, 2, 2), [[-1, 0], [0, -1]]);
});

/* ---------------------------- history ---------------------------- */

test('historial deshace y rehace de forma consistente', () => {
  const docA = createEmptyDoc(2, 2);
  const docB = { ...docA, palette: [...docA.palette, { hex: '#123456', alpha: 255 }] };
  const docC = { ...docB, width: 3 };

  let h = createHistory(docA);
  assert.equal(canUndo(h), false);
  h = pushHistory(h, docB, 'paleta');
  h = pushHistory(h, docC, 'resize');
  assert.equal(h.present.width, 3);

  h = undo(h);
  assert.equal(h.present.width, 2);
  assert.equal(canRedo(h), true);
  h = undo(h);
  assert.equal(h.present.palette.length, docA.palette.length);
  assert.equal(canUndo(h), false);

  h = redo(h);
  assert.equal(h.present.palette.length, docB.palette.length);
  h = redo(h);
  assert.equal(h.present.width, 3);
  assert.equal(canRedo(h), false);
});

test('el historial respeta su límite', () => {
  let h = createHistory(createEmptyDoc(1, 1), 3);
  for (let i = 0; i < 6; i++) h = pushHistory(h, createEmptyDoc(1, 1), `cambio ${i}`);
  assert.equal(h.past.length, 3);
});

/* ---------------------------- palettes --------------------------- */

test('paletas: detección, parseo y exportación', () => {
  const colors = parsePalette('#ff0000\n#00ff00\n');
  assert.equal(colors.length, 2);
  assert.equal(detectPaletteFormat('#fff'), 'hex');
  assert.equal(detectPaletteFormat('["#fff"]'), 'json');
  assert.equal(detectPaletteFormat('GIMP Palette\nName: x'), 'gpl');

  const gpl = serializePaletteGpl(colors, 'prueba');
  assert.match(gpl, /^GIMP Palette/);
  const roundtrip = parsePalette(gpl);
  assert.deepEqual(roundtrip.map((c) => c.hex), ['#ff0000', '#00ff00']);

  const json = serializePaletteJson(colors);
  assert.equal(JSON.parse(json).length, 2);
  assert.deepEqual(parsePalette(json).map((c) => c.hex), ['#ff0000', '#00ff00']);

  const hex = serializePaletteHex(colors);
  assert.equal(parsePalette(hex).length, 2);

  assert.throws(() => parsePalette('esto no es una paleta'), /HEX no válida/);
  assert.throws(() => parsePalette('{'), /JSON/);
});

/* ---------------------------- projects --------------------------- */

test('proyecto: serialización y parseo con validación', () => {
  const doc = createEmptyDoc(4, 2);
  const text = serializeProject(doc);
  const parsed = parseProject(text);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.value.width, 4);
    assert.equal(parsed.value.height, 2);
    assert.equal(parsed.value.layers.length, 1);
    assert.deepEqual(
      toRows(parsed.value.layers[0].matrix, 4, 2),
      toRows(doc.layers[0].matrix, 4, 2),
    );
    assert.equal(matrixEquals(parsed.value.layers[0].matrix, doc.layers[0].matrix), true);
  }
});

test('proyecto: los archivos inválidos no rompen la carga', () => {
  assert.equal(parseProject('no json').ok, false);
  assert.equal(parseProject('{"format":"otro"}').ok, false);

  const bad = parseProject(
    JSON.stringify({
      format: 'pixel-ia-studio',
      version: 1,
      width: 2,
      height: 2,
      palette: ['#000000'],
      layers: [{ name: 'x', matrix: [[0, 0], [0]] }],
    }),
  );
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.match(bad.errors.join(' '), /columnas/);

  const outOfRange = parseProject(
    JSON.stringify({
      format: 'pixel-ia-studio',
      version: 1,
      width: 1,
      height: 1,
      palette: ['#000000'],
      layers: [{ name: 'x', matrix: [[9]] }],
    }),
  );
  assert.equal(outOfRange.ok, false);
  if (!outOfRange.ok) assert.match(outOfRange.errors.join(' '), /fuera de rango/);
});

test('cloneMatrix crea copias independientes', () => {
  const a = createMatrix(2, 2, 1);
  const b = cloneMatrix(a);
  b[0] = 9;
  assert.equal(a[0], 1);
  assert.equal(b[0], 9);
});
