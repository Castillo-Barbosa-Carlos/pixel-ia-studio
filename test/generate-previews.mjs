import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const PORT = 4315;
const URL_APP = `http://localhost:${PORT}/`;

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
  throw new Error('Servidor no disponible');
}

const server = startPreview();
let browser;

try {
  await waitForServer(URL_APP);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1560, height: 950 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await page.goto(URL_APP, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="app"]');
  await page.waitForFunction(() => Boolean(window.__PIXEL_IA__));

  // Cargar proyecto de la espada 64x64
  const projectJson = JSON.parse(
    readFileSync('examples/projects/espada-64x64.pixelia.json', 'utf8')
  );

  await page.evaluate((proj) => {
    // Reemplaza doc actual
    window.__PIXEL_IA__.dispatch({
      type: 'doc/replace',
      doc: {
        width: proj.width,
        height: proj.height,
        palette: proj.palette.map((hex) => ({ hex, alpha: 255 })),
        layers: proj.layers.map((l, i) => ({
          id: `layer-${i + 1}`,
          name: l.name,
          visible: l.visible,
          locked: l.locked,
          opacity: l.opacity,
          matrix: l.matrix.flat(),
        })),
      },
      fileName: 'espada-64x64.pixelia.json',
    });
    // Configura color y herramienta
    window.__PIXEL_IA__.dispatch({ type: 'tool/select', tool: 'pencil' });
    window.__PIXEL_IA__.dispatch({ type: 'palette/select', index: 0 });
  }, projectJson);

  // Centrar en pantalla
  await page.evaluate(() => {
    window.__PIXEL_IA__.fit();
    window.__PIXEL_IA__.dispatch({ type: 'view/zoom', zoom: 8 });
  });

  await page.waitForTimeout(400);

  // Captura 1: Interfaz principal con espada 64x64
  await page.screenshot({
    path: 'docs/images/preview-interfaz.png',
    fullPage: false,
  });
  console.log('Generado: docs/images/preview-interfaz.png');

  // Abrir selector de color haciendo clic en el botón de la paleta
  await page.click('[data-testid="palette-picker"]');
  await page.waitForSelector('[data-testid="dialog-color-edit"]');
  await page.waitForTimeout(400);

  // Captura 2: Selector de color profesional integrado
  await page.screenshot({
    path: 'docs/images/preview-color-picker.png',
    fullPage: false,
  });
  console.log('Generado: docs/images/preview-color-picker.png');

  // Cerrar el modal de color
  await await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // Seleccionar región para mostrar capacidad de inpainting / selección
  await page.evaluate(() => {
    window.__PIXEL_IA__.dispatch({ type: 'tool/select', tool: 'select' });
    window.__PIXEL_IA__.dispatch({
      type: 'selection/set',
      rect: { x: 20, y: 12, w: 24, h: 26 },
    });
  });
  await page.waitForTimeout(300);

  // Captura 3: Selección de región para inpainting
  await page.screenshot({
    path: 'docs/images/preview-inpainting.png',
    fullPage: false,
  });
  console.log('Generado: docs/images/preview-inpainting.png');

} catch (err) {
  console.error('Error generando previews:', err);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
}
