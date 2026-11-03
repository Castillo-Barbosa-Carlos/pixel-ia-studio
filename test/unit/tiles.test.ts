/**
 * Tests de la generación por bloques (funciones puras).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  TILE_SIZE,
  buildPlanPrompt,
  buildTilePrompt,
  createEmptyGrid,
  estimateTokens,
  extractTileContext,
  isDegenerateMatrix,
  mergeTileMatrix,
  needsTiling,
  planTiles,
} from '../../src/ai/tiles.ts';
import { TRANSPARENT } from '../../src/types/index.ts';

test('needsTiling activa bloques solo en lienzos grandes', () => {
  assert.equal(needsTiling(16, 16), false);
  assert.equal(needsTiling(24, 24), false);
  assert.equal(needsTiling(32, 32), true);
  assert.equal(needsTiling(64, 64), true);
  assert.equal(needsTiling(64, 16), true);
});

test('planTiles cubre el lienzo completo sin solaparse', () => {
  const plan = planTiles(40, 40);
  assert.equal(plan.length, 9);
  assert.equal(plan[0].total, 9);
  // El primer bloque mide 16x16 y el último 8x8.
  assert.deepEqual(
    { w: plan[0].width, h: plan[0].height, x: plan[0].x, y: plan[0].y },
    { w: TILE_SIZE, h: TILE_SIZE, x: 0, y: 0 },
  );
  const last = plan[plan.length - 1];
  assert.deepEqual({ w: last.width, h: last.height, x: last.x, y: last.y }, { w: 8, h: 8, x: 32, y: 32 });

  // Cobertura total
  let covered = 0;
  for (const tile of plan) covered += tile.width * tile.height;
  assert.equal(covered, 40 * 40);

  // Sin solapes: cada celda una sola vez
  const grid = createEmptyGrid(40, 40);
  for (const tile of plan) {
    for (let y = 0; y < tile.height; y++) {
      for (let x = 0; x < tile.width; x++) {
        assert.equal(grid[tile.y + y][tile.x + x], TRANSPARENT);
        grid[tile.y + y][tile.x + x] = 1;
      }
    }
  }
  assert.ok(grid.flat().every((v) => v === 1));
});

test('mergeTileMatrix coloca cada bloque en su posición', () => {
  const merged = createEmptyGrid(20, 20);
  const plan = planTiles(20, 20);
  // Bloque 0: 16x16 lleno de 3
  mergeTileMatrix(merged, plan[0], Array.from({ length: 16 }, () => Array.from({ length: 16 }, () => 3)));
  assert.equal(merged[0][0], 3);
  assert.equal(merged[15][15], 3);
  assert.equal(merged[16][0], TRANSPARENT);

  // Bloque 1 (x=16): 4x16 lleno de 5
  mergeTileMatrix(merged, plan[1], Array.from({ length: 16 }, () => Array.from({ length: 4 }, () => 5)));
  assert.equal(merged[0][16], 5);
  assert.equal(merged[0][19], 5);
  assert.equal(merged[0][15], 3);
});

test('extractTileContext devuelve los bordes de los vecinos', () => {
  const merged = createEmptyGrid(20, 20);
  const plan = planTiles(20, 20);
  // Vecino izquierdo: última columna (x=15) con valores 7 en las 16 filas del bloque.
  for (let y = 0; y < 16; y++) merged[y][15] = 7;
  // Vecino superior: última fila (y=15) con valores 9.
  for (let x = 0; x < 16; x++) merged[15][x] = 9;

  const first = extractTileContext(merged, plan[0]);
  assert.equal(first.leftColumn, null);
  assert.equal(first.topRow, null);

  const right = extractTileContext(merged, plan[1]);
  assert.ok(right.leftColumn);
  assert.equal(right.leftColumn?.length, 16);
  // Las 15 primeras celdas vienen del borde izquierdo; la esquina (15,15)
  // pertenece también al borde superior.
  assert.ok(right.leftColumn?.slice(0, 15).every((v) => v === 7));
  assert.equal(right.leftColumn?.[15], 9);
  assert.equal(right.topRow, null);

  const below = extractTileContext(merged, plan[2]);
  assert.ok(below.topRow);
  assert.ok(below.topRow?.every((v) => v === 9));
});

test('buildTilePrompt incluye tamaño, posición y bordes', () => {
  const plan = planTiles(32, 32);
  const first = buildTilePrompt({
    description: 'un dragón rojo',
    tile: plan[0],
    canvasWidth: 32,
    canvasHeight: 32,
  });
  assert.match(first, /TILE_SIZE=16x16/);
  assert.match(first, /32x32/);
  assert.match(first, /dragón rojo/);
  assert.match(first, /paleta de 3 a 12 colores/);

  const context = { leftColumn: [1, 2, 3], topRow: null };
  const second = buildTilePrompt({
    description: 'un dragón rojo',
    tile: plan[1],
    canvasWidth: 32,
    canvasHeight: 32,
    palette: ['#000000', '#ffffff'],
    context,
  });
  assert.match(second, /posición \(16, 0\)/);
  assert.match(second, /#000000/);
  assert.match(second, /costuras/);
  assert.match(second, /\[1,2,3\]/);
});

test('isDegenerateMatrix detecta bloques de un solo color plano', () => {
  const flat = Array.from({ length: 16 }, () => Array.from({ length: 16 }, () => 0));
  assert.equal(isDegenerateMatrix(flat), true);

  const empty = Array.from({ length: 16 }, () => Array.from({ length: 16 }, () => TRANSPARENT));
  assert.equal(isDegenerateMatrix(empty), true);

  const detailed = Array.from({ length: 16 }, (_, y) =>
    Array.from({ length: 16 }, (_, x) => (x % 3 === 0 ? 1 : y % 2 === 0 ? 2 : TRANSPARENT)),
  );
  assert.equal(isDegenerateMatrix(detailed), false);

  // Un bloque pequeño de fondo con dos colores también es válido.
  const corner = [
    [0, 0, 0, 0],
    [0, 1, 1, 0],
    [0, 1, 1, 0],
    [0, 0, 0, 0],
  ];
  assert.equal(isDegenerateMatrix(corner), false);
});

test('buildPlanPrompt y el refuerzo de reintentos', () => {
  const plan = buildPlanPrompt('un mago oscuro', 64, 64);
  assert.match(plan, /64x64/);
  assert.match(plan, /mago oscuro/);
  assert.match(plan, /\{"plan"/);

  const tiles = planTiles(32, 32);
  const base = buildTilePrompt({
    description: 'un mago oscuro',
    tile: tiles[1],
    canvasWidth: 32,
    canvasHeight: 32,
    plan: 'la capa va arriba, el cetro a la derecha',
  });
  assert.match(base, /Plan de distribución/);
  assert.match(base, /NO rellenes el bloque entero/);
  assert.equal(base.includes('IMPORTANTE: tu intento anterior'), false);

  const reinforced = buildTilePrompt({
    description: 'un mago oscuro',
    tile: tiles[1],
    canvasWidth: 32,
    canvasHeight: 32,
    reinforce: true,
  });
  assert.match(reinforced, /IMPORTANTE: tu intento anterior/);
});

test('estimateTokens crece con el área del lienzo', () => {
  const small = estimateTokens(16, 16, 1);
  const big = estimateTokens(64, 64, 1);
  assert.ok(small > 300);
  assert.ok(big > small * 8);
  assert.ok(estimateTokens(32, 32, 2) > estimateTokens(32, 32, 1));
});
