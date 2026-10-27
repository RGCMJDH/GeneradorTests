# Cómo funciona

Este documento explica por dentro cómo llega un apunte a convertirse en una pregunta, qué comprueba el código en cada paso y dónde están los límites. Para uso general, ver el [README](../README.md).

## 1. Arquitectura

La app es una aplicación de escritorio de Electron con tres capas:

| Capa | Carpeta | Qué hace |
|---|---|---|
| Núcleo | `src/core/` | Lógica pura, sin Electron: troceado, verificación de citas, base de datos, cliente de Ollama, generación, corrección, OCR, conceptos, servidor de subida. Se prueba con Vitest. |
| Proceso principal | `src/main/` | Abre la base de datos, la ventana, el diálogo nativo de archivos y los servicios de red. Expone el núcleo por IPC. |
| Interfaz | `src/renderer/src/` | React. Solo habla con el proceso principal a través de `window.api`. |

Entre la interfaz y el proceso principal hay un **puente tipado**: `src/shared/api.ts` define cada canal, cada petición y cada respuesta. `src/preload/index.ts` expone solo esa API con `contextBridge`. La interfaz no tiene acceso a Node ni a `ipcRenderer`.

Todas las respuestas del puente son un `Result<T>`: `{ ok: true, value }` o `{ ok: false, error, code? }`. Los errores llegan con un mensaje en español y nunca con la pila de llamadas ni con rutas del sistema.

## 2. Datos

La base de datos es SQLite compilado a WebAssembly (`sql.js`). Se carga en memoria y se guarda en `apuntes.sqlite` en la carpeta de datos de la app después de cada escritura, mediante un archivo temporal y un renombrado, para que un fallo a mitad no deje el archivo corrupto.

Tablas principales:

- `subjects`: asignaturas.
- `documents`: cada apunte importado (texto, PDF, imagen).
- `chunks`: fragmentos de texto de cada documento. Es la unidad a la que apunta cada cita.
- `questions`: preguntas aceptadas, con su fragmento de origen y su cita.
- `attempts` y `answers`: intentos de test y respuestas, con la corrección.
- `concepts`: índice de conceptos por asignatura.

Todas las consultas que reciben un identificador filtran por asignatura. Escribir un fragmento en un documento de otra asignatura, o una pregunta con un fragmento ajeno, lanza un error y no escribe nada. Borrar un documento borra en cascada sus fragmentos, sus preguntas y las respuestas de esas preguntas.

## 3. De un apunte a fragmentos

### Texto y Markdown
Se leen como UTF-8, se quita el BOM y se normalizan los saltos de línea. El título es el nombre del archivo.

### PDF
Se extrae el texto con `pdf-parse`. Si no hay texto (un PDF escaneado), la app avisa de que no puede leerlo y sugiere exportar las páginas como imágenes. Comprobar que hay texto se hace **antes** de crear el documento, para no dejar documentos vacíos.

### Foto
1. Se comprueba el tipo de archivo por sus **primeros bytes**, no por la extensión. Se admiten PNG, JPEG, WebP, GIF, BMP y TIFF. HEIC/HEIF se rechaza con un mensaje que pide exportar a JPG o PNG.
2. Se reconoce el texto con Tesseract (español e inglés). El texto **no entra en los apuntes todavía**: aparece en una pantalla de revisión, donde puedes corregirlo, y solo al confirmar se trocea.
3. Volver a confirmar un documento reemplaza sus fragmentos, y por la cascada de la base de datos se borran las preguntas y respuestas de esos fragmentos. La interfaz lo avisa antes.

### Troceado
El texto se parte en fragmentos de como máximo 1200 caracteres: primero por párrafos, después por frases y, si una frase es enorme, por palabras. No se reescribe ninguna palabra; solo se decide dónde se corta.

## 4. Generar preguntas

Este es el paso donde la promesa «no se inventa nada» se aplica. El flujo está en `src/core/generate.ts`.

1. **Selección de fragmentos.** Se toman los fragmentos de la asignatura, filtrados opcionalmente por documento o por tema. Para ejercicios prácticos solo entran los fragmentos que contienen números, un signo `=` o palabras como «ejemplo», «problema» o «fórmula». Si no queda ningún fragmento, la generación termina con «sin material suficiente» **sin llamar al modelo**.
2. **Petición al modelo.** Cada pregunta se pide con **un único fragmento** en el mensaje. El texto de los apuntes va entre delimitadores aleatorios, por si contiene instrucciones, y el mensaje de sistema dice al modelo que trate ese texto como datos y no como órdenes. El modelo debe responder en JSON, con el enunciado, la respuesta, la explicación, el `chunkId` del fragmento y una `cita` literal.
3. **Validación de la forma.** La respuesta se trata como texto no fiable: se comprueba que es un objeto, que cada campo tiene el tipo esperado, que el `chunkId` es exactamente el del fragmento enviado, y que las opciones de un test son cuatro y distintas, con la respuesta entre ellas.
4. **Verificación de la cita.** Esta es la comprobación central: la cita se busca **en el texto guardado del fragmento**, nunca en el texto que devuelve el modelo. Ver la sección 5.
5. **Números de los ejercicios prácticos.** En un práctico, los datos y el resultado no son una cita literal. Por eso cada número del enunciado (los datos) y de la respuesta (el resultado) tiene que aparecer en el fragmento tal cual, con el mismo signo y el mismo separador decimal. La explicación no se comprueba, porque suele traer pasos numerados y cálculos intermedios. En verdadero/falso y en test no se exige, porque una afirmación falsa o una opción incorrecta pueden cambiar una cifra a propósito.
6. **Reintentos.** Si algo falla (forma inválida, cita no encontrada, número inventado, pregunta repetida), se vuelve a pedir, como máximo dos veces más.
7. **Guardado.** Solo las preguntas que pasan todas las comprobaciones se guardan. El resumen indica cuántas se descartaron y por qué. Si un guardado falla, la generación se detiene y devuelve lo que ya estaba guardado.
8. **Modelo no disponible.** Si no se llega al modelo en ningún intento (Ollama apagado o el modelo sin descargar), el resultado lo dice así, con `modelUnavailable`, y no como «sin material suficiente». Si el modelo sí contesta pero con una respuesta que no sirve, cuenta como descarte normal. Un fallo al guardar tampoco se presenta como falta de material.

Cancelar una generación es seguro: las preguntas ya validadas se conservan y el resto no se guarda.

## 5. La verificación de la cita

Está en `src/core/verify.ts`.

- Cita y fragmento se dividen en **piezas**: palabras, números (con su signo y su separador decimal, como `-5` o `2,5`) y operadores (`=`, `<`, `>`, `≠`, `+`, `·`…).
- Se toleran las diferencias que no cambian el sentido: mayúsculas, tildes, ligaduras de PDF (`ﬁ` → `fi`), espacios, la puntuación de la prosa y las distintas variantes Unicode del signo menos.
- Los superíndices son exponentes: `3²` equivale a `3^2` (no a `32`) y `10⁻³` a `10^-3`. Las fracciones como `½` equivalen a `1/2`.
- La cita debe tener al menos **8 caracteres**. Esto evita que una palabra suelta pase como respaldo.
- La cita es válida si sus piezas aparecen **seguidas y completas** en el fragmento. No puede empezar ni acabar a mitad de una palabra o de un número.

Lo que esto **prueba**: que ese pasaje existe en tus apuntes. Lo que **no prueba**:

- que la pregunta esté bien planteada ni que la respuesta sea la correcta;
- que el modelo haya entendido el pasaje.

Sí distingue `x = -5` de `x = 5`, `2,5` de `2.5`, `a < b` de `a > b` y `=` de `≠`.

## 6. Corrección y feedback

Está en `src/core/grade.ts`.

- **Verdadero/falso y test**: la corrección es determinista, sin modelo. El feedback es la explicación guardada con la pregunta.
- **Desarrollo y ejercicios**: el modelo compara tu respuesta con la referencia y da un veredicto y una cita. Si la cita no se puede verificar, se usa la cita original de la pregunta, que sí fue verificada al crearla, y el texto del feedback lo indica con la marca «(cita del modelo no verificada)».
- En los **ejercicios**, si el feedback trae números que no están ni en el fragmento, ni en la pregunta guardada, ni en tu respuesta, se marca con «(cifras del modelo no verificadas…)». La cita del modelo se verifica igualmente.
- La interfaz solo muestra la insignia «Cita verificada en tus apuntes» en el bloque de la cita y solo cuando la verificación fue correcta. El texto del feedback nunca lleva esa insignia.

## 7. Índice de conceptos

Está en `src/core/graph.ts` y `src/core/conceptMerge.ts`.

- Se analizan como mucho 60 fragmentos por pasada, repartidos a partes iguales entre documentos.
- Para cada fragmento, el modelo propone hasta 8 términos. Un término se conserva solo si aparece **literalmente** en el texto guardado del fragmento, con los límites de palabra correctos.
- Se descartan términos de menos de 3 o más de 80 caracteres, sin letras, o formados solo por palabras vacías del español.
- Los **relacionados** de un concepto se calculan a partir de los fragmentos donde aparecen juntos, no se toman de lo que dice el modelo.
- Si todos los fragmentos fallan, no se guarda nada y se avisa. Si solo fallan algunos, se fusiona con el índice anterior en vez de reemplazarlo.

## 8. Ollama

Está en `src/core/llm.ts`. La app habla con Ollama en `http://localhost:11434` mediante `/api/chat`, sin streaming y pidiendo JSON. El modelo por defecto es `qwen2.5:7b`; se puede cambiar con `GT_MODEL` o con `config.json`. Antes de generar, la app comprueba con un tiempo máximo de 3 segundos si Ollama responde y si el modelo está descargado, y muestra los pasos para resolverlo si no.

Las llamadas no tienen tiempo máximo propio, porque un modelo local en CPU puede tardar minutos. Se pueden cancelar con la señal de cancelación que atraviesa generación, corrección y conceptos.

## 9. Subida desde el móvil

Está en `src/core/mobile.ts` y `src/main/ipc/mobile.ts`. Es lo único de la app que escucha en la red.

- Se abre un servidor HTTP en la **IP de la wifi** (nunca en todas las interfaces) en un puerto aleatorio, con una ruta que lleva un token aleatorio de 128 bits. Cualquier otra ruta, un token incorrecto o una petición con un `Host` distinto del anunciado recibe un 404 vacío, igual en todos los casos.
- La foto se lee en streaming con un tope de 15 MB: al superarlo se corta la conexión. Se verifica el tipo por los bytes y se rechazan las resoluciones mayores de 40 millones de píxeles.
- Como máximo hay 20 subidas por sesión y la sesión dura 10 minutos.
- La foto se guarda en una carpeta temporal con un nombre generado, se reconoce en una cola que procesa **una cada vez** (hasta 5 pendientes), y el archivo se borra al terminar. Al cerrar la app, las fotos en cola se borran sin procesarse.
- La conexión es **HTTP sin cifrar**. Por eso la sesión es corta y el enlace no debe compartirse.

## 10. Seguridad de la aplicación

- La ventana tiene `contextIsolation` y `sandbox` activados y `nodeIntegration` desactivado.
- La política de contenido (CSP) de la interfaz es estricta. La versión de desarrollo añade lo necesario para la recarga en caliente, solo en desarrollo.
- La navegación se limita a la propia aplicación; los `window.open` se niegan.
- Todo el texto que viene de los apuntes, del modelo o del OCR se muestra como texto plano. No hay ningún uso de `dangerouslySetInnerHTML` ni de HTML construido con datos.
- En la app empaquetada, la variable `ELECTRON_RENDERER_URL` se ignora: no puede redirigir la ventana.
- El modo de prueba `GT_SMOKE` solo escribe en la carpeta temporal y usa una carpeta de datos temporal.

## 11. Pruebas

- `npm test` ejecuta Vitest sobre el núcleo, el puente IPC, la interfaz (jsdom) y los scripts de empaquetado.
- El núcleo se prueba con un modelo simulado (`FakeLlm`) que devuelve respuestas válidas e inválidas a propósito. Las pruebas comprueban, por ejemplo, que una cita inventada se descarta, que un fragmento de otra asignatura se rechaza y que un modelo caído no borra el índice guardado.
- El empaquetado se prueba arrancando el `.exe` con `GT_SMOKE=1`.

Lo que **no** cubren las pruebas: un modelo real de Ollama, un móvil real, una sesión gráfica completa, y la calidad de las preguntas que genera un modelo concreto.
