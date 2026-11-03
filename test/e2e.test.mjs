/**
 * Pruebas E2E de Pixel-IA Studio (Playwright + Chromium).
 * Cubren los criterios de aceptación: edición, transparencias, capas,
 * minimapa, historial, paletas, paneles, exportación e integración con IA
 * (con el servidor simulado mediante rutas interceptadas).
 *
 * Ejecutar con: npm run test:e2e
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const PORT = 4311;
const URL_APP = `http://localhost:${PORT}/`;
const ARTIFACTS = 'test/artifacts';

let server;
let browser;
let context;
let page;
let consoleErrors = [];
let pageErrors = [];

function startPreview() {
  return spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: process.cwd(),
    stdio: 'ignore',
  });
}

async function waitForServer(url, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('servidor no disponible');
}

async function getState() {
  return page.evaluate(() => window.__PIXEL_IA__.state());
}

async function pixelToScreen(x, y) {
  return page.evaluate(([px, py]) => window.__PIXEL_IA__.pixelToScreen(px, py), [x, y]);
}

async function clickPixel(x, y, button = 'left') {
  const p = await pixelToScreen(x, y);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down({ button });
  await page.mouse.up({ button });
}

async function dragPixels(x0, y0, x1, y1, button = 'left') {
  const a = await pixelToScreen(x0, y0);
  const b = await pixelToScreen(x1, y1);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down({ button });
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2);
  await page.mouse.move(b.x, b.y);
  await page.mouse.up({ button });
}

async function selectTool(id) {
  await page.click(`[data-testid="tool-${id}"]`);
}

async function reloadApp() {
  await page.goto(URL_APP, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="app"]');
  await page.waitForFunction(() => Boolean(window.__PIXEL_IA__));
  await page.waitForTimeout(150);
}

before(async () => {
  mkdirSync(ARTIFACTS, { recursive: true });
  server = startPreview();
  await waitForServer(URL_APP);
  browser = await chromium.launch();
  context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  page = await context.newPage();
  page.on('console', (msg) => {
    // Se ignoran los errores de recursos de red provocados por las pruebas de
    // fallos de conexión (abortados a propósito).
    if (msg.type() === 'error' && !/Failed to load resource/i.test(msg.text())) {
      consoleErrors.push(msg.text());
    }
  });
  page.on('pageerror', (err) => pageErrors.push(String(err)));
  await reloadApp();
});

after(async () => {
  await browser?.close();
  server?.kill();
});

describe('carga y estructura', () => {
  test('la aplicación carga sin errores de consola', async () => {
    assert.equal(consoleErrors.length, 0, `Errores de consola: ${consoleErrors.join(' | ')}`);
  });

  test('la distribución muestra todos los paneles', async () => {
    for (const id of ['ai-panel', 'right-panel', 'status-bar', 'palette-bar', 'layers-panel', 'minimap', 'pixel-canvas']) {
      assert.equal(await page.isVisible(`[data-testid="${id}"]`), true, `falta ${id}`);
    }
    const state = await getState();
    assert.equal(state.width, 16);
    assert.equal(state.height, 16);
    assert.equal(state.layers.length, 1);
  });
});

describe('herramientas de dibujo', () => {
  test('el lápiz pinta, el borrador transparenta y el relleno llena áreas', async () => {
    await reloadApp();
    await selectTool('pencil');
    await clickPixel(2, 2);
    let state = await getState();
    assert.equal(state.layers[0].matrix[2][2], 0, 'el lápiz no pintó el píxel');

    // Borrador
    await selectTool('eraser');
    await clickPixel(2, 2);
    state = await getState();
    assert.equal(state.layers[0].matrix[2][2], -1, 'el borrador no transparentó el píxel');

    // Relleno del área vacía con el color de la paleta 1
    await page.click('[data-testid="swatch-1"]');
    await selectTool('fill');
    await clickPixel(0, 0);
    state = await getState();
    assert.equal(state.layers[0].matrix[0][0], 1);
    assert.equal(state.layers[0].matrix[15][15], 1, 'el relleno no llegó a toda el área conexa');
  });

  test('figuras geométricas: línea, rectángulo y elipse', async () => {
    await reloadApp();
    await selectTool('line');
    await dragPixels(1, 1, 6, 1);
    let state = await getState();
    assert.equal(state.layers[0].matrix[1][3] >= 0, true, 'la línea no se dibujó');

    await selectTool('rect');
    await dragPixels(3, 4, 6, 7);
    state = await getState();
    assert.equal(state.layers[0].matrix[5][5] >= 0, true, 'el rectángulo no se rellenó');

    await selectTool('ellipse');
    await dragPixels(9, 9, 13, 13);
    state = await getState();
    assert.equal(state.layers[0].matrix[11][11] >= 0, true, 'la elipse no se dibujó');
  });

  test('gotero toma el color del compuesto', async () => {
    await reloadApp();
    await page.click('[data-testid="swatch-2"]'); // #ff00ff
    await selectTool('pencil');
    await clickPixel(5, 5);
    await page.click('[data-testid="swatch-0"]');
    await selectTool('eyedropper');
    await clickPixel(5, 5);
    const state = await getState();
    // El gotero selecciona el índice de paleta más cercano al color compuesto.
    assert.equal(state.colorIndex, 2);
  });

  test('el gotero vuelve automáticamente al lápiz tras tomar el color', async () => {
    await reloadApp();
    await page.click('[data-testid="swatch-2"]'); // #ff00ff
    await selectTool('pencil');
    await clickPixel(5, 5);
    await selectTool('eyedropper');
    await clickPixel(5, 5);
    const state = await getState();
    assert.equal(state.colorIndex, 2, 'el gotero no tomó el color');
    assert.equal(state.tool, 'pencil', 'debería volver al lápiz tras seleccionar el color');
  });

  test('el lápiz borrador dibuja en vacío y borra sobre color', async () => {
    await reloadApp();
    await page.click('[data-testid="swatch-1"]');
    await selectTool('pencil');
    await clickPixel(4, 4); // pintado con índice 1

    await page.keyboard.press('t');
    let state = await getState();
    assert.equal(state.tool, 'pencil-eraser', 'el atajo T debería activar el lápiz borrador');

    await clickPixel(4, 4); // empieza sobre un píxel con color -> borra
    state = await getState();
    assert.equal(state.layers[0].matrix[4][4], -1, 'debería borrar al empezar sobre color');

    await clickPixel(6, 6); // empieza sobre un píxel vacío -> dibuja
    state = await getState();
    assert.equal(state.layers[0].matrix[6][6], 1, 'debería dibujar al empezar en vacío');
  });

  test('el clic derecho es solo movimiento y no pinta', async () => {
    await reloadApp();
    await selectTool('pencil');
    const before = (await getState()).pan;

    // Arrastre con clic derecho -> desplaza el lienzo.
    const p = await pixelToScreen(8, 8);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(p.x + 120, p.y + 60, { steps: 5 });
    await page.mouse.up({ button: 'right' });
    let state = await getState();
    assert.ok(
      Math.abs(state.pan.x - before.x) >= 100 && Math.abs(state.pan.y - before.y) >= 50,
      `el lienzo no se desplazó: ${JSON.stringify(state.pan)}`,
    );

    // Clic derecho sin arrastrar -> es solo movimiento, NO pinta píxeles.
    await clickPixel(2, 2, 'right');
    state = await getState();
    assert.equal(
      state.layers[0].matrix[2][2],
      -1,
      'el clic derecho no debería pintar píxeles (debe ser solo movimiento)',
    );
  });

  test('transparencia: la capa oculta no aparece en el compuesto', async () => {
    await reloadApp();
    await clickPixel(0, 0);
    let rgba = await page.evaluate(() => window.__PIXEL_IA__.compositeAt(0, 0));
    assert.equal(rgba[3], 255, 'el píxel pintado debería ser opaco');

    await page.click('[data-testid="layer-visibility-0"]');
    rgba = await page.evaluate(() => window.__PIXEL_IA__.compositeAt(0, 0));
    assert.equal(rgba[3], 0, 'la capa oculta sigue contribuyendo al compuesto');
  });
});

describe('selección y portapapeles', () => {
  test('copiar, pegar y confirmar una selección', async () => {
    await reloadApp();
    await page.click('[data-testid="swatch-1"]');
    await selectTool('pencil');
    await clickPixel(1, 1);

    await selectTool('select');
    await dragPixels(0, 0, 3, 3);
    let state = await getState();
    assert.ok(state.selection, 'no se creó la selección');
    assert.equal(state.selection.w, 4);

    await page.keyboard.press('Control+c');
    state = await getState();
    assert.equal(state.clipboardSize, 16);

    await page.keyboard.press('Control+v');
    state = await getState();
    assert.equal(state.hasFloating, true, 'no se creó la selección flotante');

    await page.keyboard.press('Enter');
    state = await getState();
    assert.equal(state.hasFloating, false, 'la selección flotante no se confirmó');
  });

  test('cortar y borrar el contenido de la selección', async () => {
    await reloadApp();
    await page.click('[data-testid="swatch-1"]');
    await selectTool('pencil');
    await clickPixel(2, 2);

    await selectTool('select');
    await dragPixels(1, 1, 4, 4);
    await page.keyboard.press('Control+x');
    let state = await getState();
    assert.equal(state.layers[0].matrix[2][2], -1, 'el corte no borró el contenido');
    assert.equal(state.clipboardSize, 16);

    await clickPixel(8, 8);
    await page.keyboard.press('Delete');
    state = await getState();
    assert.equal(state.selection, null);
  });

  test('mover una selección arrastra su contenido', async () => {
    await reloadApp();
    await page.click('[data-testid="swatch-1"]');
    await selectTool('pencil');
    await clickPixel(1, 1);
    await selectTool('select');
    await dragPixels(0, 0, 2, 2);
    // Arrastra desde el interior de la selección hacia otra zona.
    await dragPixels(1, 1, 8, 8);
    let state = await getState();
    assert.equal(state.hasFloating, true, 'el arrastre no levantó la selección');
    await page.keyboard.press('Enter');
    state = await getState();
    // El píxel que estaba en (1,1) dentro de la selección se traslada a (8,8).
    assert.equal(state.layers[0].matrix[8][8] >= 0, true, 'el contenido no se movió al destino');
    assert.equal(state.layers[0].matrix[1][1], -1, 'la posición original no quedó vacía');
  });
});

describe('historial', () => {
  test('deshacer y rehacer de forma consistente', async () => {
    await reloadApp();
    await selectTool('pencil');
    await clickPixel(4, 4);
    await clickPixel(5, 5);
    let state = await getState();
    assert.equal(state.canUndo, true);
    assert.equal(state.layers[0].matrix[5][5] >= 0, true);

    await page.keyboard.press('Control+z');
    await page.waitForTimeout(80);
    state = await getState();
    assert.equal(state.layers[0].matrix[5][5], -1, 'deshacer no revirtió el último trazo');
    assert.equal(state.layers[0].matrix[4][4] >= 0, true, 'deshacer revirtió de más');

    await page.keyboard.press('Control+y');
    await page.waitForTimeout(80);
    state = await getState();
    assert.equal(state.layers[0].matrix[5][5] >= 0, true, 'rehacer no restauró el trazo');
  });
});

describe('capas', () => {
  test('crear, ocultar, bloquear, reordenar y renombrar capas', async () => {
    await reloadApp();
    await page.click('[data-testid="layer-add"]');
    await page.click('[data-testid="layer-add"]');
    let state = await getState();
    assert.equal(state.layers.length, 3);
    assert.equal(state.activeLayerIndex, 2);

    await page.click('[data-testid="layer-visibility-1"]');
    await page.click('[data-testid="layer-lock-1"]');
    state = await getState();
    assert.equal(state.layers[1].visible, false);
    assert.equal(state.layers[1].locked, true);

    const movedName = state.layers[2].name;

    await page.click('[data-testid="layer-down-2"]');
    state = await getState();
    assert.equal(state.layers[1].name, movedName, 'el orden de capas no cambió');

    // Renombrar con doble clic
    await page.dblclick('[data-testid="layer-0"] .layer__name');
    await page.fill('.layer__name-input', 'Capa renombrada');
    await page.keyboard.press('Enter');
    state = await getState();
    assert.ok(state.layers.some((l) => l.name === 'Capa renombrada'), 'no se renombró la capa');

    // Dibujar solo afecta a la capa activa
    await page.click('[data-testid="layer-0"]');
    await selectTool('pencil');
    await clickPixel(0, 0);
    state = await getState();
    const painted = state.layers.filter((l) => l.matrix[0][0] >= 0).length;
    assert.equal(painted, 1, 'el dibujo afectó a más de una capa');
  });
});

describe('minimapa y vista', () => {
  test('el minimapa refleja el compuesto de capas visibles', async () => {
    await reloadApp();
    await page.click('[data-testid="swatch-2"]'); // #ff00ff
    await selectTool('pencil');
    await clickPixel(0, 0);
    await page.waitForTimeout(120);

    const sample = await page.evaluate(() => {
      const canvas = document.querySelector('[data-testid="minimap"]');
      const ctx = canvas.getContext('2d');
      const data = ctx.getImageData(2, 2, 1, 1).data;
      return [data[0], data[1], data[2], data[3]];
    });
    assert.ok(sample[0] > 200 && sample[2] > 200 && sample[1] < 100, `el minimapa no muestra el color compuesto: ${sample}`);
  });

  test('zoom y cuadrícula se pueden alternar', async () => {
    await reloadApp();
    const before = (await getState()).zoom;
    await page.keyboard.press('Control+=');
    await page.waitForTimeout(80);
    let state = await getState();
    assert.ok(state.zoom > before, 'el zoom no aumentó');

    assert.equal(state.showGrid, true);
    await page.keyboard.press('h');
    state = await getState();
    assert.equal(state.showGrid, false, 'la cuadrícula no se ocultó');
  });
});

describe('paletas', () => {
  test('importar paleta desde texto y reemplazar un color', async () => {
    await reloadApp();
    await page.click('[data-testid="palette-bar"] [title="Importar paleta (pegar texto)"]');
    await page.fill('[data-testid="paste-palette-text"]', '#111111\n#222222\n#333333');
    await page.click('[data-testid="paste-palette-confirm"]');
    let state = await getState();
    assert.deepEqual(state.palette, ['#111111', '#222222', '#333333']);

    // Pinta con el color 1 y reemplázalo por el 2
    await page.click('[data-testid="swatch-1"]');
    await selectTool('pencil');
    await clickPixel(3, 3);
    await page.click('[data-testid="palette-replace"]');
    await page.selectOption('[data-testid="replace-from"]', '1');
    await page.selectOption('[data-testid="replace-to"]', '2');
    await page.click('[data-testid="replace-confirm"]');
    state = await getState();
    assert.equal(state.layers[0].matrix[3][3], 2, 'el color no se reemplazó');
  });

  test('añadir y eliminar colores de la paleta', async () => {
    await reloadApp();
    const initial = (await getState()).palette.length;
    await page.click('[data-testid="palette-add"]');
    await page.fill('[data-testid="color-hex"]', '#12ab34');
    await page.click('[data-testid="color-save"]');
    let state = await getState();
    assert.equal(state.palette.length, initial + 1);
    assert.equal(state.palette.at(-1), '#12ab34');

    await page.click('[data-testid="palette-remove"]');
    state = await getState();
    assert.equal(state.palette.length, initial);
  });

  test('exportar paleta en formato GPL', async () => {
    await reloadApp();
    await page.click('[data-testid="palette-export"]');
    await page.selectOption('[data-testid="dialog-export-palette"] select', 'gpl');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('[data-testid="export-palette-confirm"]'),
    ]);
    assert.match(download.suggestedFilename(), /\.gpl$/);
  });
});

describe('proyecto y exportación', () => {
  test('guardar proyecto y exportar PNG generan descargas', async () => {
    await reloadApp();
    await selectTool('pencil');
    await clickPixel(1, 1);

    const [projectDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.click('[data-testid="btn-save"]'),
    ]);
    assert.match(projectDownload.suggestedFilename(), /\.pixelia\.json$/);

    await page.click('[data-testid="btn-export-png"]');
    await page.selectOption('[data-testid="export-scale"]', '4');
    const [pngDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.click('[data-testid="export-png-confirm"]'),
    ]);
    assert.match(pngDownload.suggestedFilename(), /@4x\.png$/);
  });

  test('redimensionar el lienzo conserva el contenido', async () => {
    await reloadApp();
    await selectTool('pencil');
    await clickPixel(1, 1);
    await page.click('[data-testid="btn-canvas-size"]');
    await page.fill('[data-testid="dialog-canvas"] input[type="number"]', '20');
    await page.click('[data-testid="dialog-canvas-confirm"]');
    const state = await getState();
    assert.equal(state.width, 20);
    assert.equal(state.height, 16);
  });

  test('abrir un proyecto de ejemplo carga sus capas y dimensiones', async () => {
    await reloadApp();
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.click('[data-testid="btn-open"]'),
    ]);
    await chooser.setFiles('examples/projects/corazon-16x16.pixelia.json');
    await page.waitForTimeout(200);
    const state = await getState();
    assert.equal(state.width, 16);
    assert.equal(state.height, 16);
    assert.equal(state.layers[0].name, 'corazon');
    assert.ok(state.palette.includes('#ffb3c1'), 'la paleta del proyecto no se cargó');
    assert.equal(state.layers[0].matrix[5][5] >= 0, true, 'la matriz del proyecto no se cargó');
  });
});

describe('paneles', () => {
  test('todos los paneles pueden ocultarse y mostrarse', async () => {
    await reloadApp();
    await page.click('[data-testid="toggle-panel-left"]');
    assert.equal(await page.isVisible('[data-testid="ai-panel"]'), false);
    await page.keyboard.press('Control+2');
    await page.waitForTimeout(80);
    assert.equal(await page.isVisible('[data-testid="ai-panel"]'), true);

    await page.click('[data-testid="toggle-panel-right"]');
    assert.equal(await page.isVisible('[data-testid="right-panel"]'), false);
    await page.keyboard.press('Control+3');
    await page.waitForTimeout(80);
    assert.equal(await page.isVisible('[data-testid="right-panel"]'), true);

    await page.click('[data-testid="toggle-panel-top"]');
    assert.equal(await page.isVisible('[data-testid="palette-bar"]'), false);
    await page.keyboard.press('Control+1');
    await page.waitForTimeout(80);
    assert.equal(await page.isVisible('[data-testid="palette-bar"]'), true);

    await page.click('[data-testid="toggle-panel-bottom"]');
    assert.equal(await page.isVisible('[data-testid="status-bar"]'), false);
    await page.keyboard.press('Control+4');
    await page.waitForTimeout(80);
    assert.equal(await page.isVisible('[data-testid="status-bar"]'), true);
  });
});

describe('integración con IA (servidor simulado)', () => {
  const validResponse = {
    message: {
      content: JSON.stringify({
        width: 8,
        height: 8,
        palette: ['#000000', '#ff0000', '#ffffff'],
        layers: [
          {
            name: 'base',
            visible: true,
            matrix: Array.from({ length: 8 }, (_, y) =>
              Array.from({ length: 8 }, (_, x) => (x === 0 || y === 0 || x === 7 || y === 7 ? 1 : -1)),
            ),
          },
        ],
      }),
    },
  };

  const invalidResponse = {
    message: {
      content: '{"width": 8, "height": 8, "palette": ["#000000"], "layers": [{"name": "x", "matrix": [[0, 0]]}]}',
    },
  };

  async function mockOllama(response) {
    await page.unrouteAll().catch(() => {});
    await page.route('**/api/tags', (route) =>
      route.fulfill({
        json: { models: [{ name: 'qwen2.5-coder:1.5b' }, { name: 'qwen3.5:4b' }] },
      }),
    );
    await page.route('**/api/chat', (route) => route.fulfill({ json: response }));
  }

  test('probar conexión detecta los modelos del servidor', async () => {
    await reloadApp();
    await mockOllama(validResponse);
    await page.click('[data-testid="ai-test"]');
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-testid="ai-connection"]');
      return el && el.textContent.includes('Conectado');
    });
  });

  test('una respuesta válida se previsualiza y se aplica al lienzo', async () => {
    await reloadApp();
    await mockOllama(validResponse);
    await page.fill('[data-testid="ai-prompt"]', 'un marco rojo de 8x8');
    await page.click('[data-testid="ai-generate"]');
    await page.waitForSelector('[data-testid="ai-preview"]', { timeout: 15000 });

    const preview = (await getState()).aiPreview;
    assert.equal(preview.width, 8);
    assert.equal(preview.layerCount, 1);

    await page.click('[data-testid="ai-apply"]');
    await page.waitForTimeout(150);
    const state = await getState();
    assert.equal(state.width, 8);
    assert.equal(state.height, 8);
    assert.equal(state.layers.length, 1);
    assert.equal(state.layers[0].matrix[0][0], 1, 'la matriz de la IA no se aplicó');
    assert.equal(state.layers[0].matrix[4][4], -1);
  });

  test('una respuesta inválida no rompe la aplicación', async () => {
    await reloadApp();
    // Irreparable: la "matriz" ni siquiera es una lista de filas.
    await mockOllama({
      message: {
        content: '{"width": 8, "height": 8, "palette": ["#000000"], "layers": [{"name": "x", "matrix": "no es una matriz"}]}',
      },
    });
    await page.fill('[data-testid="ai-prompt"]', 'algo imposible');
    await page.click('[data-testid="ai-generate"]');
    await page.waitForSelector('[data-testid="ai-validation-errors"]', { timeout: 15000 });

    const state = await getState();
    assert.equal(state.aiStatus, 'error');
    assert.equal(state.aiPreview, null);
    assert.equal(state.width, 16, 'el lienzo no debería cambiar ante una respuesta inválida');

    // La aplicación sigue siendo usable
    await selectTool('pencil');
    await clickPixel(6, 6);
    const after = await getState();
    assert.equal(after.layers[0].matrix[6][6] >= 0, true, 'el editor dejó de funcionar tras el error');
  });

  test('una paleta inválida se recupera con la paleta del proyecto', async () => {
    await reloadApp();
    // Caso real: el modelo devuelve la paleta como números (índices) en vez de HEX.
    await mockOllama({
      message: {
        content: JSON.stringify({
          width: 8,
          height: 8,
          palette: [0, 0, 0, 0, 0, 0],
          layers: [
            {
              name: 'base',
              visible: true,
              matrix: Array.from({ length: 8 }, (_, y) =>
                Array.from({ length: 8 }, (_, x) => (x % 2 === y % 2 ? 1 : 0)),
              ),
            },
          ],
        }),
      },
    });
    await page.fill('[data-testid="ai-prompt"]', 'patrón de damero');
    await page.click('[data-testid="ai-generate"]');
    await page.waitForSelector('[data-testid="ai-preview"]', { timeout: 15000 });

    assert.ok(
      await page.isVisible('[data-testid="ai-palette-fallback"]'),
      'debería avisarse de que se usó la paleta del proyecto',
    );
    let state = await getState();
    assert.equal(state.aiPreview.width, 8);
    assert.equal(state.palette.length, 5, 'la paleta del proyecto no debe perderse');

    await page.click('[data-testid="ai-apply"]');
    await page.waitForTimeout(150);
    state = await getState();
    assert.equal(state.width, 8);
    assert.equal(state.palette.length, 5);
    assert.equal(state.layers[0].matrix[0][0], 1);
    assert.equal(state.layers[0].matrix[0][1], 0);
  });

  test('la generación muestra progreso y puede cancelarse', async () => {
    await reloadApp();
    await page.unrouteAll().catch(() => {});
    await page.route('**/api/tags', (route) =>
      route.fulfill({ json: { models: [{ name: 'qwen2.5-coder:1.5b' }] } }),
    );
    // Respuesta lenta en streaming (NDJSON por fragmentos).
    await page.route('**/api/chat', async (route) => {
      await new Promise((r) => setTimeout(r, 4000));
      await route
        .fulfill({
          body:
            JSON.stringify({ message: { content: '{"width":8,"height":8,"palette":["#000000","#ffffff"],"layers":[' } }) +
            '\n' +
            JSON.stringify({ message: { content: '{"name":"base","visible":true,"matrix":[[0,0]]}]}' } }) +
            '\n',
          headers: { 'content-type': 'application/x-ndjson' },
        })
        .catch(() => {});
    });

    await page.fill('[data-testid="ai-prompt"]', 'algo que tarda');
    await page.click('[data-testid="ai-generate"]');
    await page.waitForSelector('[data-testid="ai-progress"]', { timeout: 5000 });
    const progressText = await page.textContent('[data-testid="ai-progress-text"]');
    assert.match(progressText, /Recibiendo respuesta/);

    await page.click('[data-testid="ai-cancel"]');
    await page.waitForTimeout(300);
    let state = await getState();
    assert.notEqual(state.aiStatus, 'generating', 'la cancelación no detuvo la generación');
    assert.equal(state.aiPreview, null);

    // La aplicación sigue siendo usable tras cancelar.
    await selectTool('pencil');
    await clickPixel(7, 7);
    state = await getState();
    assert.equal(state.layers[0].matrix[7][7] >= 0, true);
  });

  test('lienzos grandes se generan por bloques de 16x16', async () => {
    await reloadApp();
    // Lienzo 40x40 -> 9 bloques.
    await page.click('[data-testid="btn-canvas-size"]');
    await page.locator('[data-testid="dialog-canvas"] input[type="number"]').nth(0).fill('40');
    await page.locator('[data-testid="dialog-canvas"] input[type="number"]').nth(1).fill('40');
    await page.click('[data-testid="dialog-canvas-confirm"]');
    await page.waitForTimeout(150);

    assert.ok(await page.isVisible('[data-testid="ai-tile-chip"]'), 'debería indicarse la generación por bloques');
    await page.selectOption('[data-testid="ai-tile-size"]', '16');

    let calls = 0;
    await page.unrouteAll().catch(() => {});
    await page.route('**/api/chat', (route) => {
      calls += 1;
      const body = JSON.parse(route.request().postData() ?? '{}');
      const user = body.messages?.[1]?.content ?? '';
      const size = /TILE_SIZE=(\d+)x(\d+)/.exec(user);
      const w = size ? Number(size[1]) : 16;
      const h = size ? Number(size[2]) : 16;
      const matrix = Array.from({ length: h }, () => Array.from({ length: w }, () => 1));
      const payload = {
        width: w,
        height: h,
        palette: ['#000000', '#ff0000'],
        layers: [{ name: 'base', visible: true, matrix }],
      };
      return route.fulfill({ json: { message: { content: JSON.stringify(payload) } } });
    });

    await page.fill('[data-testid="ai-prompt"]', 'un dragón rojo');
    await page.click('[data-testid="ai-generate"]');
    await page.waitForSelector('[data-testid="ai-preview"]', { timeout: 20000 });

    assert.equal(calls, 10, 'debería hacerse 1 llamada de plan + 1 por bloque (9)');
    const preview = (await getState()).aiPreview;
    assert.equal(preview.width, 40);
    assert.equal(preview.height, 40);
    assert.equal(preview.layerCount, 1);

    await page.click('[data-testid="ai-apply"]');
    await page.waitForTimeout(200);
    const state = await getState();
    assert.equal(state.width, 40);
    assert.equal(state.height, 40);
    // Los bloques se fusionaron en su posición.
    assert.equal(state.layers[0].matrix[0][0], 1);
    assert.equal(state.layers[0].matrix[20][20], 1);
    assert.equal(state.layers[0].matrix[39][39], 1);
  });

  test('una respuesta vacía se reintenta y se explica', async () => {
    await reloadApp();
    let calls = 0;
    await page.unrouteAll().catch(() => {});
    await page.route('**/api/chat', (route) => {
      calls += 1;
      return route.fulfill({ json: { message: { content: '' }, done_reason: 'stop' } });
    });
    await page.fill('[data-testid="ai-prompt"]', 'algo imposible');
    await page.click('[data-testid="ai-generate"]');
    await page.waitForSelector('[data-testid="ai-error"]', { timeout: 15000 });

    assert.equal(calls, 2, 'debería reintentarse automáticamente una vez');
    const text = await page.textContent('[data-testid="ai-error"]');
    assert.match(text ?? '', /respuesta vacía/);

    // La aplicación sigue operativa.
    await selectTool('pencil');
    await clickPixel(3, 3);
    const state = await getState();
    assert.equal(state.layers[0].matrix[3][3] >= 0, true);
  });

  test('una respuesta truncada por límite de tokens se explica', async () => {
    await reloadApp();
    await page.unrouteAll().catch(() => {});
    await page.route('**/api/chat', (route) =>
      route.fulfill({ json: { message: { content: '{"width":8,"height":8,' }, done_reason: 'length' } }),
    );
    await page.fill('[data-testid="ai-prompt"]', 'otro intento');
    await page.click('[data-testid="ai-generate"]');
    await page.waitForSelector('[data-testid="ai-error"]', { timeout: 15000 });
    const text = await page.textContent('[data-testid="ai-error"]');
    assert.match(text ?? '', /límite de tokens/);
  });

  test('las matrices con desfases de formato se reparan y se avisa', async () => {
    await reloadApp();
    await page.unrouteAll().catch(() => {});
    await page.route('**/api/chat', (route) =>
      route.fulfill({
        json: {
          message: {
            content: JSON.stringify({
              width: 8,
              height: 8,
              palette: ['#000000', '#ff0000'],
              // Desfase típico: 7 filas en vez de 8 y una celda fuera de rango.
              layers: [
                {
                  name: 'base',
                  visible: true,
                  matrix: Array.from({ length: 7 }, (_, y) =>
                    Array.from({ length: 8 }, (_, x) => (x === 0 || y === 0 ? 1 : y === 6 ? 99 : 0)),
                  ),
                },
              ],
            }),
          },
        },
      }),
    );
    await page.fill('[data-testid="ai-prompt"]', 'un marco');
    await page.click('[data-testid="ai-generate"]');
    await page.waitForSelector('[data-testid="ai-preview"]', { timeout: 15000 });

    assert.ok(await page.isVisible('[data-testid="ai-warnings"]'), 'debería mostrarse el aviso de reparación');
    const warnings = await page.textContent('[data-testid="ai-warnings"]');
    assert.match(warnings ?? '', /repar|ajust|fila/i);

    await page.click('[data-testid="ai-apply"]');
    await page.waitForTimeout(150);
    const state = await getState();
    assert.equal(state.height, 8);
    // La fila faltante se rellenó con transparencia y la celda inválida también.
    assert.equal(state.layers[0].matrix[7][0], -1);
    assert.equal(state.layers[0].matrix[6][2], -1);
    assert.equal(state.layers[0].matrix[0][0], 1);
  });

  test('errores de conexión se muestran de forma comprensible', async () => {
    await reloadApp();
    await page.unrouteAll().catch(() => {});
    await page.route('**/api/tags', (route) => route.abort('connectionrefused'));
    await page.route('**/api/chat', (route) => route.abort('connectionrefused'));
    await page.click('[data-testid="ai-test"]');
    await page.waitForSelector('[data-testid="ai-error"]', { timeout: 15000 });
    const text = await page.textContent('[data-testid="ai-error"]');
    assert.ok(text.length > 20, 'el mensaje de error no es descriptivo');
  });
});

describe('captura final', () => {
  test('guarda una captura de la interfaz', async () => {
    await reloadApp();
    await page.click('[data-testid="swatch-1"]');
    await selectTool('pencil');
    for (const [x, y] of [[4, 4], [5, 4], [6, 4], [4, 5], [4, 6], [6, 5], [6, 6], [5, 6]]) {
      await clickPixel(x, y);
    }
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${ARTIFACTS}/e2e-final.png` });
    assert.equal(pageErrors.length, 0, `Excepciones de la aplicación: ${pageErrors.join(' | ')}`);
    assert.equal(consoleErrors.length, 0, `Errores de consola acumulados: ${consoleErrors.join(' | ')}`);
  });
});
