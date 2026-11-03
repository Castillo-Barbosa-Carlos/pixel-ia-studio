# Pixel-IA Studio

Estudio de **pixel art** para visualizar, editar y generar sprites mediante
modelos de IA **locales y pequeños** (Ollama, APIs compatibles con OpenAI, etc.).
La IA **no genera imágenes**: genera *paletas de color* y *matrices numéricas*
de píxeles que el editor valida, previsualiza y aplica al lienzo.

<p align="center">
  <img src="docs/images/preview-interfaz.png" alt="Pixel-IA Studio - Interfaz Principal" width="100%" />
</p>

```
paleta = ["#000000", "#ffffff", "#00ff00"]
matriz = [[0, 1, 1, 0], [1, 2, 2, 1], ...]   // -1 = transparencia
```

---

## 1. Instalación y ejecución

Requisitos: **Node.js 20+** (probado con Node 26) y npm.

```bash
cd pixel-ia-studio
npm install
npm run dev        # servidor de desarrollo en http://localhost:5173
```

Otros scripts:

| Comando | Descripción |
| --- | --- |
| `npm run build` | Comprueba tipos (TypeScript) y compila `dist/` |
| `npm run preview` | Sirve la compilación de producción |
| `npm test` | Tests unitarios de la lógica (`node --test`) |
| `npm run test:e2e` | Tests E2E con Playwright + Chromium |
| `npm run test:all` | Unitarios + E2E |
| `npm run test:ai` | Prueba la IA contra un Ollama real (opcional) |
| `npm run screenshot` | Genera `test/artifacts/interfaz.png` |
| `npm run previews` | Genera capturas de alta resolución para la documentación (`docs/images/`) |

## 2. Distribución de la interfaz

| Zona | Contenido |
| --- | --- |
| **Barra superior** | Archivo (nuevo, abrir, guardar, exportar PNG/proyecto, tamaño del lienzo), deshacer/rehacer, cuadrícula, estado del proyecto y alternado de paneles |
| **Barra de paleta** | Color activo y secundario con HEX/RGBA, swatches, transparencia, añadir/editar/eliminar/reemplazar colores, importar/exportar paletas |
| **Panel izquierdo** | Conexión con IA local, generación (paleta / matriz / ambos), vista previa y aplicación de resultados |
| **Panel derecho** | Minimapa (parte superior), herramientas, atributos y capas |
| **Barra inferior** | Coordenadas X/Y, tamaño de selección, herramienta activa y sus atributos, datos del proyecto, zoom y estado de la IA |

Todos los paneles pueden ocultarse con los botones de la barra superior o con
`Ctrl+1` (paleta), `Ctrl+2` (IA), `Ctrl+3` (herramientas) y `Ctrl+4` (estado).

## 3. Herramientas

| Herramienta | Atajo | Descripción |
| --- | --- | --- |
| Lápiz | `B` | Dibuja con el color activo |
| Lápiz borrador | `T` | Si el píxel donde empiezas está vacío dibuja; si tiene color, borra. La elección se toma al empezar el trazo |
| Borrador | `E` | Escribe transparencia (`-1`) |
| Gotero | `I` | Toma el color del compuesto y **vuelve al lápiz** (con `Alt`, de la capa activa) |
| Relleno | `G` | Rellena un área conexa (con tolerancia de color ajustable) |
| Línea | `L` | Línea recta; `Shift` restringe a ángulos de 45° |
| Rectángulo | `R` | Relleno o contorno; `Shift` = cuadrado |
| Elipse | `O` | Relleno o contorno; `Shift` = círculo |
| Degradado | `D` | Degradado lineal entre color activo y secundario |
| Sombreado | `S` | Aclara los píxeles; `Shift` + arrastrar oscurece |
| Selección | `M` | Selección rectangular para copiar/cortar/mover/borrar |

**Clic derecho**: reservado **única y exclusivamente para movimiento y desplazamiento del lienzo** (sin pintar ni modificar píxeles accidentalmente). También se puede desplazar con el botón central del ratón.

Atajos adicionales: `Ctrl+Z` / `Ctrl+Y` deshacer/rehacer, `Ctrl+C` / `Ctrl+X` /
`Ctrl+V` portapapeles, `Ctrl+A` seleccionar todo, `Supr` borrar selección,
`Enter` confirmar y `Esc` cancelar la selección flotante, `Ctrl+S` guardar,
`Ctrl+E` exportar PNG, `Ctrl+G` o `H` cuadrícula, `Ctrl++` / `Ctrl+-` zoom,
`Ctrl+0` o `0` ajustar a pantalla, `[` / `]` tamaño de pincel y
**clic der. + arrastrar** (o botón central) para desplazar el lienzo. La lista
completa está en el botón **Atajos** de la barra superior.

### Capas

Cada capa tiene nombre (doble clic para renombrar), visibilidad, bloqueo y
opacidad. La capa activa está resaltada y **todas las operaciones de edición
actúan solo sobre ella** (salvo el reemplazo global de color y la
composición/exportación). El minimapa siempre muestra el compuesto de las
capas visibles.

### Selección y portapapeles

Con la herramienta de selección se arrastra un marco rectangular. Arrastrar
*dentro* de la selección **levanta el contenido** (se convierte en una
selección flotante que se puede mover); `Enter` la fusiona con la capa activa y
`Esc` cancela el movimiento. `Ctrl+C/X/V` copian, cortan y pegan regiones.

## 4. Paletas y Selector de Color

- **Selector de color profesional**: herramienta integrada con gradiente visual de matiz/saturación/luminosidad (HSV), deslizadores numéricos RGB/HSV, barra de canal alfa para transparencia, visor hexadecimal directo con botón para copiar, chips de colores preestablecidos y cuentagotas nativo del sistema.
- **Formatos**: JSON (`["#rrggbb", ...]`), HEX (una línea por color) y GPL
  (GIMP Palette). La importación detecta el formato automáticamente.
- El color se edita con HEX + alfa; **editar un color cambia todos los píxeles
  que usan su índice** (paleta indexada).
- **Reemplazar color** cambia los píxeles de un índice por otro en la capa
  activa o en todas.
- **Eliminar un color** deja transparentes sus píxeles y reordena los índices.
- La casilla **Transparente** activa el borrador (la transparencia es `-1`,
  no un color de la paleta).

<p align="center">
  <img src="docs/images/preview-color-picker.png" alt="Selector de Color Integrado" width="80%" />
</p>

## 5. Integración con IA local

1. En el panel izquierdo elige el proveedor: **Ollama** o **API compatible con
   OpenAI**.
2. Indica la URL del servidor (por defecto `http://localhost:11434` para
   Ollama; para APIs OpenAI-compatibles incluye `/v1` si aplica) y el nombre
   del modelo (p. ej. `qwen2.5-coder:1.5b`, `qwen3.5:4b`).
3. Pulsa **Probar conexión** (verifica el servidor y lista los modelos) o
   **Detectar modelos**.
4. Elige el tipo de generación (*paleta + matriz*, *solo paleta* o *solo
   matriz*), escribe la descripción del sprite y pulsa **Generar**.
5. Mientras el modelo escribe verás el **progreso en vivo** (segundos
   transcurridos y caracteres recibidos) y podrás **Cancelar** en cualquier
   momento.
6. El resultado se **valida con un esquema estricto** (reparando los desfases
   de formato típicos, con aviso) y se muestra en vista previa con sus capas y
   paleta. Puedes **Aplicar al lienzo** (sustituye el documento, deshacer para
   volver), **Solo paleta**, **Añadir capas**, **Regenerar** o **Descartar**.

### Lienzos grandes (32×32, 64×64…)

Los modelos pequeños no pueden escribir el JSON completo de un sprite grande
en una sola respuesta. La app lo divide automáticamente en **bloques** (8×8 por
defecto, configurable hasta 24×24) cuando el lienzo supera 24×24:

- Fase previa de **plan espacial** común a todos los bloques.
- Cada bloque se genera con los **bordes ya generados** de sus vecinos para que
  las costuras casen; el primer bloque fija la paleta.
- Se ve el avance como *"Bloque 3/9 · 45 s"* y puede cancelarse.
- Los bloques que fallan se descartan con aviso; el resultado se fusiona en una
  capa *IA (por bloques)*.
- Si el resultado queda plano (un solo color dominante), la app lo advierte:
  es límite del modelo, y conviene probar un modelo más capaz, bloques de 8×8
  o un lienzo menor.

### Inpainting y Selección de Región

Permite seleccionar un área rectangular específica del lienzo para que la IA modifique o genere contenido exclusivamente dentro de esa región, conservando intacto el resto del sprite. La IA recibe el contexto circundante de los píxeles adyacentes y su paleta para asegurar una integración visual perfecta.

<p align="center">
  <img src="docs/images/preview-inpainting.png" alt="Inpainting y Selección de Región" width="100%" />
</p>

### Reescalado Piramidal para Sprites Grandes (≥ 64×64)

Para sprites complejos y de alta resolución (como la espada 64×64), el editor incorpora un algoritmo de generación piramidal:
1. Generación de la silueta base y composición en baja resolución (16×16 o 32×32).
2. Reescalado sin pérdida al tamaño objetivo con suavizado de bordes (*pixel-art edge smoothing*).
3. Refinamiento iterativo de detalles, sombreado y textura preservando la estructura global.

### Formato String Grid / ASCII y Esquema Estricto

- **Ahorro de ~70% de tokens**: soporte para representación por cadenas ASCII (un carácter por píxel) que reduce drásticamente el consumo de tokens y el tiempo de respuesta frente a arrays numéricos JSON.
- **Esquema JSON Estricto**: compatibilidad nativa con `response_format: json_schema` (OpenAI / Ollama) para forzar respuestas 100% conformes y libres de alucinaciones sintácticas.
- **Recuperación parcial**: si la generación se corta por límite de tokens o interrupción de red, el sistema rescata las filas completadas en lugar de descartar todo el trabajo.

Notas:

- La IA debe responder **JSON puro** (sin Markdown). El formato exacto está
  documentado en [`docs/AI-JSON-FORMAT.md`](docs/AI-JSON-FORMAT.md).
- **Razonamiento del modelo**: por defecto se envía `think: false` a Ollama.
  Los modelos "thinking" tipo Qwen3 dedican un tiempo enorme a razonar antes de
  emitir JSON (con `qwen3.5:4b` se agotaba el timeout de 180 s); con el
  razonamiento desactivado responden en 20–40 s. El control está en el panel.
- **Streaming con progreso y cancelación**: la respuesta se recibe por
  fragmentos y la interfaz muestra los segundos y caracteres recibidos, con un
  botón de **Cancelar**. El timeout por defecto es de **300 s** (ajustable) y
  hay un **límite de tokens de salida** (8192 por defecto) para cortar
  generaciones interminables.
- **Lienzos grandes**: un lienzo de 32x32 con 2 capas requiere ~2500 tokens de
  salida. Con modelos de 0.5B–1.5B usa lienzos ≤ 32x32 (la app muestra un aviso
  si el lienzo es grande) o el modo *Solo paleta*.
- Si un modelo pequeño devuelve una matriz mal formada, la validación la
  rechaza con el error concreto y puedes pulsar **Regenerar** (es lo habitual
  con modelos de 1–4B: `qwen3.5:4b` acierta 2 de cada 3 intentos y
  `qwen2.5-coder:0.5b` también falla a veces).
- Si el modelo envuelve la respuesta en ```json o añade texto, se extrae el
  primer objeto JSON válido; si aun así no supera la validación, **nunca se
  toca el documento** y se muestran los errores por campo.
- **CORS**: si el navegador bloquea la petición a Ollama, arráncalo con
  `OLLAMA_ORIGINS=*` (o con el origen de la app) y reinícialo.
- No se usan APIs de pago ni modelos de difusión: todo el procesamiento ocurre
  en tu máquina.

## 6. Proyecto y exportación

- **Guardar / Abrir**: proyecto `.pixelia.json` (formato legible con matrices
  como arrays de filas; se valida estrictamente al cargar).
- **Exportar PNG**: compuesto de capas visibles con escala 1x/2x/4x/8x sin
  suavizado (pixel-perfect) o solo la capa activa.
- **Exportar proyecto**: mismo JSON, para compartir o versionar.
- Ejemplos incluidos en [`examples/`](examples/): paletas (`gameboy.gpl`,
  `pico8.json`, `cga.hex`) y proyectos de prueba (`espada-64x64.pixelia.json`, `cofre-8x8.pixelia.json`,
  `corazon-16x16.pixelia.json`).

## 7. Estructura del código

```
src/
├── types/        Tipos centrales (documento, capas, herramientas, IA)
├── core/         Lógica pura: matrices, raster, capas, historial, paletas,
│                 proyecto (sin dependencias del DOM → testeable)
├── state/        Store global (useReducer + Context) y cursor
├── tools/        Catálogo de herramientas y atajos
├── canvas/       Lienzo principal, gestos de dibujo y minimapa
├── ai/           Cliente (Ollama/OpenAI), prompts, validador y vista previa
├── components/   Paneles, barra superior, barra de estado, diálogos, iconos
├── utils/        Archivos, color, teclado, gancho de pruebas
└── styles/       Tokens de diseño y estilos (CSS puro)
```

Decisiones técnicas relevantes en [`docs/DECISIONS.md`](docs/DECISIONS.md).

## 8. Pruebas

```bash
npm test            # 55 tests unitarios (core, validador IA, streaming, bloques, reescalado, inpainting)
npm run test:e2e    # 34 tests E2E (Playwright) sobre la build de producción
npm run test:ai     # generación real contra Ollama (requiere servidor en marcha)
npm run test:ai:tiles  # generación por bloques real (32x32) contra Ollama
npm run previews    # genera las capturas de alta resolución para la documentación
```

Los E2E cubren los criterios de aceptación: dibujo, borrado, relleno, figuras,
selección/copiar/pegar/mover, transparencias, capas, minimapa, historial,
paletas, paneles, exportaciones e integración con IA (con el servidor simulado
mediante rutas interceptadas, incluida la respuesta inválida que no debe romper
la aplicación).
