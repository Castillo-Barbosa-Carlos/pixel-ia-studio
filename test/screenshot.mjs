/**
 * Captura la interfaz de Pixel-IA Studio para revisión visual.
 * Ejecutar con: npm run screenshot  (compila y abre la app con Playwright)
 */
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = 4310;
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
  throw new Error('servidor no disponible');
}

const server = startPreview();
let browser;
try {
  await waitForServer(URL_APP);
  browser = await chromium.launch();
  const page = await browser.newContext({ viewport: { width: 1500, height: 950 } }).then((c) => c.newPage());
  await page.goto(URL_APP, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="app"]');
  await page.waitForFunction(() => Boolean(window.__PIXEL_IA__));

  // Dibuja un pequeño sprite de demostración con la herramienta lápiz.
  const drawPixel = async (x, y) => {
    const p = await page.evaluate(([px, py]) => window.__PIXEL_IA__.pixelToScreen(px, py), [x, y]);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.up();
  };

  // Marco y relleno sencillos para verificar las herramientas en la captura.
  for (let x = 3; x <= 12; x++) {
    await drawPixel(x, 3);
    await drawPixel(x, 12);
  }
  for (let y = 3; y <= 12; y++) {
    await drawPixel(3, y);
    await drawPixel(12, y);
  }
  await page.click('[data-testid="swatch-1"]');
  for (let x = 5; x <= 10; x++) {
    await drawPixel(x, 6);
    await drawPixel(x, 9);
  }

  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test/artifacts/interfaz.png', fullPage: false });
  console.log('Captura guardada en test/artifacts/interfaz.png');
} finally {
  await browser?.close();
  server.kill();
}
