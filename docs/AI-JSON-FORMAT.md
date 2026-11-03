# Formato JSON de la integración con IA

Pixel-IA Studio no pide imágenes a los modelos: pide **paletas de color** y
**matrices numéricas de píxeles** en JSON. Este documento define el contrato
entre la aplicación y el modelo.

## 1. Esquema de la respuesta

```json
{
  "width": 8,
  "height": 8,
  "palette": ["#000000", "#ffffff", "#00ff00"],
  "layers": [
    {
      "name": "base",
      "visible": true,
      "matrix": [
        [-1, 0, 0, -1, -1, 0, 0, -1],
        [ 0, 1, 1,  0,  0, 1, 1,  0],
        [ 0, 1, 1,  0,  0, 1, 1,  0],
        [-1, 0, 0, -1, -1, 0, 0, -1]
      ]
    }
  ]
}
```

### Campos

| Campo | Tipo | Reglas |
| --- | --- | --- |
| `width` | entero | 1–256. Ancho exacto de cada fila |
| `height` | entero | 1–256. Número exacto de filas |
| `palette` | array de string | 2–256 colores HEX `#rrggbb` (también se aceptan `#rgb` y `#rrggbbaa`) |
| `layers` | array | 1–32 capas |
| `layers[].name` | string | Nombre descriptivo (máx. 64 caracteres) |
| `layers[].visible` | boolean | Opcional; por defecto `true` |
| `layers[].grid` | array de string | **Recomendado (ASCII Grid)**: exactamente `height` strings de longitud `width` (`.` = transparencia, `0`, `1`, `2`... = índices de paleta) |
| `layers[].matrix` | array de arrays | Formato alternativo numérico: exactamente `height` filas de exactamente `width` enteros (`-1` = transparencia) |

### Valores de la cuadrícula (String Grid / ASCII y Matriz)

- **Grid ASCII (`grid`)**: cada fila es un string compacto. El carácter `.` representa transparencia (`-1`). Los caracteres `0`–`9` y `A`–`Z` representan índices de la paleta (base 0: `0` = primer color).
- **Matriz numérica (`matrix`)**: un entero `>= 0` es un índice de la paleta (base 0); `-1` representa transparencia.
- El formato ASCII Grid reduce el consumo de tokens de salida en un 70% y alinea la coherencia espacial para el modelo.

### Orden de las capas

`layers[0]` es la capa **inferior**; las siguientes se componen encima.

## 2. Modos de generación

La aplicación envía un `system prompt` fijo y un mensaje de usuario con el modo
elegido:

| Modo | Debe incluir | Opcional |
| --- | --- | --- |
| `pipeline` (Multi-etapa) | 3 fases automáticas: Paleta → Silueta base → Detalle | — |
| `inpaint` (edición local) | `width`, `height`, `layers` (de la región seleccionada) | — |
| `full` (paleta + grid/matriz) | `width`, `height`, `palette`, `layers` | — |
| `palette` (solo paleta) | `palette` | `width`, `height`, `layers` |
| `matrix` (solo matriz) | `width`, `height`, `layers` | `palette` (se usa la del proyecto) |

### 2a. Pipeline Multi-Etapa
Diseñado para máxima estabilidad en modelos locales pequeños:
1. **Etapa 1 (Paleta & Concepto)**: Genera 4–8 colores armoniosos y un concepto conciso.
2. **Etapa 2 (Silueta & Estructura)**: Genera la masa y contorno del sprite en grid ASCII con 2 colores base (`.` y `0`).
3. **Etapa 3 (Detalles & Shading)**: Transforma la silueta previa aplicando luces, sombras y los índices completos de la paleta.

En el modo `matrix` la petición incluye la paleta actual del proyecto y se
exige usar solo esos índices.

## 3. Reglas que se le exigen al modelo

Resumen del system prompt enviado (`src/ai/prompts.ts`):

- Responder **únicamente con JSON válido**, sin explicaciones ni fences de
  Markdown.
- Cada fila de `matrix` debe tener longitud `width` y debe haber `height` filas.
- Usar solo índices de la paleta indicada o `-1`.
- Respetar el tamaño de lienzo solicitado (máx. 256×256).

## 4. Validación (estricta)

Antes de mostrar la vista previa, `src/ai/schema.ts` verifica:

1. Que exista un objeto JSON (se extrae de entre fences de Markdown o texto
   extra si el modelo no obedece).
2. Tipos y rangos de `width`/`height`.
3. Que cada color de `palette` sea HEX válido y haya 1–256 colores.
4. Que cada matriz tenga exactamente `height × width` celdas enteras.
5. Que cada índice esté en `-1 .. palette.length - 1`.

Si algo falla, **el documento no se modifica** y el panel muestra los errores
concretos, por ejemplo:

```
"layers[0].matrix[3][2]" = 9 está fuera de rango (paleta: 3, -1 = transparente).
"layers[0].matrix" tiene 4 filas y se esperaban 8.
```

### Tolerancia y recuperación

Los modelos pequeños incumplen el formato de formas previsibles; el validador
las gestiona sin romper la app:

- **Colores en otros formatos**: además de `"#rrggbb"` se aceptan `[r, g, b]`,
  `[r, g, b, a]` y `{r, g, b}` (se convierten a HEX). Un número suelto **no** se
  acepta porque es ambiguo (podría ser un índice).
- **Errores agrupados**: si varios colores fallan se muestran en una sola línea
  (`"palette" contiene N color(es) inválido(s): palette[1]=0, …`).
- **Reparación de formato** (`normalizeAiResult`): los desfases típicos se
  corrigen automáticamente **con aviso visible** en la vista previa:
  - filas de más/menos (p. ej. 15 filas en vez de 16 → se rellena con
    transparencia),
  - celdas de más o faltantes en una fila,
  - índices fuera de rango o no enteros → transparente.
  El resultado reparado **siempre pasa después la validación estricta**: nunca
  se aplica al lienzo nada inválido.
- **Recuperación automática de paleta**: si la única parte inválida es la
  paleta y las matrices son correctas, la aplicación **usa la paleta del
  proyecto** y lo advierte en la vista previa (etiqueta amarilla) antes de
  aplicar.
- **Modo `matrix`**: la paleta de la respuesta es opcional; si llega y no es
  válida se ignora, y los índices se validan contra la paleta del proyecto.
- Si nada es recuperable, los errores se listan por campo y basta pulsar
  **Regenerar** (los modelos de 1–4B aciertan la mayoría de intentos, pero no
  todos).

## 2b. Generación por bloques (lienzos grandes)

Para lienzos mayores de 24×24 la app no pide el sprite completo: lo divide en
bloques (8×8 por defecto, configurable hasta 24×24) y genera cada bloque con
una llamada independiente:

1. **Fase de plan**: se pide un plan espacial del sprite completo
   (`{"plan": "texto"}`) que se inyecta en todos los bloques.
2. **Primer bloque**: genera la paleta (3–12 colores) y su matriz.
3. **Bloques siguientes**: usan la paleta fija y reciben **los bordes ya
   generados** de los vecinos (última columna del bloque izquierdo y última
   fila del superior) para que las costuras casen. La petición incluye el
   marcador `TILE_SIZE=anchoxalto` para automatizar pruebas.
4. Cada bloque se valida/repara por separado; los bloques fallidos se
   descartan con aviso y el resto se fusiona en una única capa
   *IA (por bloques)*.

Ejemplo de prompt de un bloque (resumido):

```
Genera el bloque en la posición (16, 0) de un sprite de pixel art de 32x32 píxeles.
TILE_SIZE=16x16
Devuelve "width": 16, "height": 16 y 1 capa(s) con la matriz de 16x16.
Usa SOLO estos índices de la paleta: ["#8b4513","#c0c0c0","#4169e1"].
Descripción del sprite completo: una espada con hoja azul y empuñadura marrón.
[…bordes ya generados…]
Responde solo con el objeto JSON, sin explicaciones.
```

## 5. Transporte

| Proveedor | Endpoint de modelos | Endpoint de generación |
| --- | --- | --- |
| Ollama | `GET {base}/api/tags` | `POST {base}/api/chat` con `format: "json"`, `stream: false` |
| OpenAI-compatible | `GET {base}/v1/models` | `POST {base}/v1/chat/completions` con `response_format: {type: "json_object"}` |

- `{base}` es la URL configurada en el panel (para APIs OpenAI puede incluir
  `/v1`; la app lo detecta).
- Autenticación opcional con `Authorization: Bearer <api key>`.
- Timeout configurable (por defecto 120 s) mediante `AbortController`.

## 6. Consejos para obtener buenos resultados

- Modelos pequeños (0.5B–4B) funcionan mejor con **lienzos pequeños**
  (8×8 a 32×32) y **1–2 capas**.
- **Desactiva el razonamiento** (`think: false`, opción por defecto en el
  panel). Medido con `qwen3.5:4b`: con razonamiento activo la petición agotaba
  los 180 s; sin él responde en 20–40 s.
- Descripciones concretas: *“cofre del tesoro de 16x16, madera marrón, cierre
  dorado, fondo transparente”*.
- Si un modelo pequeño devuelve una matriz mal formada (filas de más, índices
  fuera de rango), la validación la rechaza y basta con **Regenerar**:
  `qwen3.5:4b` produce resultados válidos 2 de cada 3 intentos y
  `qwen2.5-coder:1.5b` con más frecuencia.
- El modo `matrix` con la paleta fijada da los resultados más consistentes para
  reutilizar la paleta del proyecto.

## 7. Ejemplo de respuesta válida completa

```json
{
  "width": 4,
  "height": 4,
  "palette": ["#1b1b2f", "#e94560", "#f5f5f5"],
  "layers": [
    {
      "name": "corazon",
      "visible": true,
      "matrix": [
        [-1, 1, 1, -1],
        [ 1, 2, 2,  1],
        [ 1, 2, 2,  1],
        [-1, 1, 1, -1]
      ]
    }
  ]
}
```
