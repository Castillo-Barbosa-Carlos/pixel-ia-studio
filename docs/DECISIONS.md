# Decisiones técnicas

Resumen de las decisiones de diseño e implementación de Pixel-IA Studio y su
justificación. Las funcionalidades no bloqueantes resueltas “a criterio” se
documentan aquí.

## Stack y dependencias

- **Vite + React 18 + TypeScript** y **CSS puro** (tokens + 4 hojas de estilo).
  Sin librerías de UI, de estado ni de utilidades: el alcance no las justifica y
  el proyecto se mantiene fácil de leer y auditar.
- Tests con `node --test` (Node 26 ejecuta TypeScript nativamente) y
  **Playwright** para E2E. Sin frameworks de test adicionales.
- `esbuild` requiere aprobar su script de instalación (`npm install-scripts
  approve esbuild`), ya que npm 12 bloquea scripts postinstall por defecto.

## Modelo de datos

- **Matrices `Int16Array`** fila-major (`índice = y * width + x`), `-1` =
  transparencia, resto = índice de paleta. Compacto, rápido y directamente
  alineado con el formato de la IA.
- **Paleta indexada** (`PaletteColor { hex, alpha }`): editar un color recolorea
  todos sus píxeles (semántica de sprites indexados) y la IA solo necesita
  índices.
- **Orden de capas**: `layers[0]` es la capa inferior (la UI la muestra abajo),
  coherente con el orden de composición del JSON de la IA.

## Estado e historial

- Store propio con `useReducer` + Context. Se separan **documento** (con
  historial) y **sesión/UI** (herramienta, zoom, selección, paneles, IA).
- **Historial por snapshots** (límite 60) en lugar de parches: los trazos
  trabajan sobre clones de la matriz y las capas no tocadas comparten
  referencias, por lo que el coste es acotado (máx. 256×256) y el comportamiento
  es predecible incluso en operaciones globales (paleta, capas, redimensionado,
  aplicación de resultados de IA).
- Las propiedades de capa (visibilidad, bloqueo, opacidad, nombre, orden) forman
  parte del documento y **son deshacerables**; el zoom, el paneo y la cuadrícula
  no lo son.
- Las posiciones de cursor y los trazos en curso se mantienen en **refs y un
  store externo mínimo** (`cursorStore`) para no re-renderizar React a 60 Hz.

## Lienzo y herramientas

- Render **Canvas 2D** con `imageSmoothingEnabled = false` y snapping entero
  (pixel-perfect). El compuesto de capas se cachea en un canvas offscreen por
  identidad de documento + versión de previsualización.
- Cada gesto = **una entrada de historial** (clone al pulsar, commit al soltar),
  incluso para trazos largos o figuras.
- **Selección flotante**: arrastrar dentro de la selección *levanta* el
  contenido (recortándolo de la capa); `Enter` fusiona, `Esc` restaura la
  posición original. `Ctrl+X/C/V` operan sobre el rectángulo seleccionado.
- **Degradado**: interpola entre color activo y secundario a lo largo del
  arrastre y mapea cada píxel al color de paleta más cercano (sin ampliar la
  paleta). Alternativa considerada: tramado Bayer; descartada por mantener la
  paleta cerrada y el resultado simple de ajustar.
- **Sombreado**: aclara/oscurece el color original del píxel (no el acumulado
  del trazo) y lo mapea al color de paleta más cercano; si ningún color está
  cerca (distancia > 12), **añade el nuevo tono a la paleta** (máx. 256). Es el
  comportamiento de “dodge/burn” esperable en un editor indexado.
- **Relleno con tolerancia**: con tolerancia 0 rellena por igualdad exacta de
  índice; con tolerancia > 0 compara distancia euclidiana en RGB (×4) para
  incluir tonos próximos.

## Integración con IA

- Dos adaptadores (`ollama` y `openai`) sobre `fetch` + `AbortController`, sin
  SDKs. Endpoints y detalles en `docs/AI-JSON-FORMAT.md`.
- **`think: false` por defecto** en Ollama (opción visible en el panel).
  Medido con `qwen3.5:4b`: con el modo razonamiento activo la generación agotaba
  el timeout de 180 s; desactivado responde en 20–40 s. El cuerpo de la petición
  se construye con `buildChatBody` (función pura testeada).
- **Streaming (NDJSON en Ollama, SSE en OpenAI)** con progreso visible
  (segundos y caracteres), botón de **Cancelar** (`AbortController`) y
  **límite de tokens** (`num_predict`/`max_tokens`, 8192 por defecto). El
  timeout por defecto sube a 300 s. Decisión: mostrar progreso real en lugar de
  un spinner ciego; con modelos locales de 1–3 min de generación, la espera sin
  feedback parecía un bloqueo (y los timeouts a 120 s cortaban trabajos
  legítimos).
- **Generación por bloques** para lienzos > 24×24 (`ai/tiles.ts`): plan espacial
  previo + bloques de 8×8/16×16 con bordes vecinos como contexto + fusión en
  una capa. Un sprite de 32×32 o 64×64 no cabe en la salida de un modelo
  pequeño; dividirlo en llamadas cortas lo hace viable (verificado en vivo con
  `qwen2.5-coder:1.5b` y `qwen3.5:4b`: 4 bloques de 16×16 en ~3 min).
- **Reparación de formato con aviso** (`normalizeAiResult`): los modelos
  locales cometen errores sistemáticos —`qwen3.5:4b` produce **15 filas en vez
  de 16** casi siempre—. En lugar de descartar todo, se repara (relleno con
  transparencia, recorte de sobras, celdas inválidas → transparente) y se
  muestra cada reparación en la vista previa. El resultado reparado se valida
  de nuevo con el esquema estricto antes de ofrecerlo.
- **Detección de bloques planos y resultados planos**: si el modelo devuelve
  un color único para todo, se avisa con recomendaciones (modelo más capaz,
  bloques de 8×8, lienzo menor, regenerar) en lugar de reintentar en bucle
  (las mediciones mostraron que el reintento no mejora la calidad: es límite
  del modelo, no del pipeline).
- **Validación estricta propia** (sin zod/ajv): validador manual con errores
  por campo, pensado para mensajes claros ante modelos pequeños que se
  equivocan de formato (p. ej. matrices con filas de más). Incluye coerción de
  formatos habituales (`[r,g,b]`, `{r,g,b}` → HEX), agrupación de errores
  repetidos y **recuperación**: si solo la paleta es inválida se reutiliza la
  del proyecto (con aviso) y, en modo `matrix`, la paleta de la respuesta se
  ignora.
- La respuesta **nunca muta el documento** sin pasar por la vista previa y una
  acción explícita del usuario; aplicar el resultado es una operación
  deshacerable. Los resultados inválidos se rechazan y el usuario puede
  regenerar (`qwen3.5:4b` acierta 2 de cada 3 intentos; `qwen2.5-coder:1.5b`
  fue validado a la primera en ~10 s).
- **CORS**: la app habla directamente con el servidor local. Si el navegador lo
  bloquea, Ollama debe arrancarse con `OLLAMA_ORIGINS` (documentado en README).
- Verificación real durante el desarrollo: `npm run test:ai` contra Ollama local
  con `qwen2.5-coder:1.5b` (fallback `qwen3.5:4b`).

## Persistencia

- Proyecto `.pixelia.json` legible (matrices como arrays de filas) y versionado
  (`format: "pixel-ia-studio"`, `version: 1`), con validación completa al cargar
  (dimensiones, índices, límites) y mensajes de error específicos.
- PNG exportado a escala 1x–8x con `drawImage` sin suavizado. Extra: exportar
  solo la capa activa.
- Paletas en JSON, HEX y GPL con detección automática de formato al importar.

## Accesibilidad y ergonomía

- Todos los controles críticos tienen **atajo** y **title** explicativo; la
  barra de estado muestra siempre herramienta, atributos, coordenadas y estado.
- Los avisos (toasts) confirman acciones y explican errores sin bloquear.
- Desktop-first: la disposición está pensada para ≥1280 px de ancho.
- **Navegación del lienzo**: arrastrar con el **clic derecho** desplaza (o el
  botón central). Como el clic derecho también tiene acciones secundarias
  (color secundario, oscurecer, tomar color), se discrimina por gesto: un
  **clic sin arrastrar** (umbral de 4 px) ejecuta la acción y un **arrastre**
  desplaza. Decisión tomada a petición del usuario, que sustituyó el
  desplazamiento con `Espacio`.
- **Gotero**: al tomar un color se vuelve automáticamente al lápiz para
  encadenar muestreo y dibujo sin cambiar de herramienta.
- **Lápiz borrador** (`T`): decide al empezar el trazo entre dibujar (píxel
  inicial vacío) y borrar (píxel inicial con color), de modo que un mismo
  trazo limpia y rellena sin alternar herramientas.

## Gancho de pruebas

`window.__PIXEL_IA__` expone un resumen plano del documento y conversiones de
coordenadas para los tests E2E. Es mínimo, no interfiere con el uso normal y
evita acoplar los tests al DOM interno.
