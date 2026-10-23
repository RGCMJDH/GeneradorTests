# Generador de tests

Aplicación de escritorio para Windows 11 que genera tests a partir de **tus propios apuntes**, con un modelo de lenguaje local (Ollama). El modelo corre en tu equipo (Ollama); la app solo habla con él en `localhost`. La única entrada desde la red es la subida opcional de fotos desde el móvil por la wifi local. (Ollama descarga el modelo una vez; en `npm run dev` el primer OCR descarga datos de idioma, ver «Datos y OCR».)

## Qué hace

- Organiza el material por **asignaturas** (apuntes, preguntas e historial no se mezclan entre ellas).
- Importa apuntes desde texto/Markdown, PDF con texto y fotos (OCR con Tesseract, español + inglés; el texto reconocido se puede corregir antes de confirmarlo).
- Genera preguntas de tipo verdadero/falso, test y desarrollo, y ejercicios prácticos; las corrige y guarda el historial de intentos.
- Construye un índice de conceptos por asignatura para elegir tema.

## La promesa y sus límites

**Cada pregunta que se guarda y se te muestra lleva una cita que se ha comprobado contra los apuntes.** El modelo debe devolver el fragmento de origen y una cita literal; la app comprueba que esa cita aparece en ese fragmento (tras normalizar mayúsculas, tildes, espacios y puntuación; `src/core/generate.ts`, `verify.ts`). Si no aparece, se reintenta hasta 2 veces más y, si sigue fallando, la pregunta se descarta y el resumen de la generación te cuenta cuántas y por qué. Si los apuntes no cubren el tema, la app lo dice en vez de inventar. Al responder una pregunta, la corrección muestra la cita y un botón «Ver en apuntes» que lleva al fragmento original; el historial también muestra la cita guardada (`QuoteLink.tsx`). La cita no se enseña antes de responder.

Lo que la comprobación **no** garantiza:

- Prueba que el pasaje **existe** en tus apuntes, no que la pregunta o la respuesta estén bien planteadas ni que el modelo haya entendido el pasaje. Revisa las preguntas con criterio.
- La comparación **ignora los símbolos** (`+ - = , .`): una cita con el signo cambiado (`x = -5` frente a `x = 5`) o con otro separador decimal (`2,5` frente a `2.5`) puede darse por válida. Es una debilidad conocida, especialmente en ejercicios con fórmulas y números.
- La calidad real depende del modelo local; con modelos pequeños pueden descartarse más preguntas.

## Requisitos

- Windows 11, 16 GB de RAM.
- [Ollama](https://ollama.com) instalado y en marcha, con el modelo por defecto:

  ```
  ollama pull qwen2.5:7b
  ```

  Para usar otro modelo, define la variable de entorno `GT_MODEL` (por ejemplo `GT_MODEL=llama3.1:8b`) o crea `config.json` con `{"model": "..."}` en la carpeta de datos de la app.
- Sin GPU, el modelo se ejecuta en CPU: generar un test lleva **minutos**, no segundos.
- Para desarrollar: Node 24.

## Uso y desarrollo

```
npm install
npm run dev     # app en modo desarrollo
npm test        # pruebas (vitest); las de OCR descargan datos de idioma la primera vez (necesitan internet)
npm run pack    # build + empaquetado sin instalador en release/win-unpacked/
```

`npm run pack` ejecuta, en este orden: `scripts/prepare-tessdata.mjs`, `electron-vite build` y `electron-builder --win dir`. El primer paso copia los datos de idioma `spa` y `eng` desde los paquetes npm fijados `@tesseract.js-data/spa@1.0.0` y `@tesseract.js-data/eng@1.0.0` a `build-tessdata/`, comprueba tamaño, firma gzip y SHA-256 (`scripts/tessdata.sha256.json`) y aborta si algo no coincide; un hook `afterPack` repite la comprobación sobre el paquete resultante. No usa red más allá del `npm install`. El resultado queda en `release/win-unpacked/Generador de tests.exe`.

Qué se ha verificado del empaquetado: el `.exe` de `release/win-unpacked` arranca en modo sin ventana (`GT_SMOKE=1`) y completa una prueba automática de extremo a extremo (importar texto y PDF, OCR de una foto de ejemplo con los idiomas incluidos, comprobar que el wasm de sql.js y el worker de Tesseract se cargan desde `app.asar.unpacked`). **No** se ha probado con una sesión gráfica real, ni con un Ollama real, ni subiendo una foto desde un móvil, y el instalador `nsis` (configurado, no construido) no se ha generado. No hay firma de código, así que Windows SmartScreen puede avisar.

## Subir fotos desde el móvil

1. En la pestaña Apuntes, en la sección «Fotos desde el móvil», inicia la subida: aparece un código QR y un enlace.
2. El móvil debe estar en **la misma wifi** que el PC. Si el móvil no conecta, permite la app en el Firewall de Windows (redes privadas).
3. La conexión es **HTTP sin cifrar**: cualquiera en tu red con el enlace podría enviar fotos mientras esté activo. Úsalo solo en redes de confianza.
4. La subida se desactiva sola a los **10 minutos** o al pulsar Detener.
5. Cada foto pasa por el mismo OCR que las del PC y su texto queda pendiente de que lo revises y confirmes antes de convertirse en apuntes.

## Datos y OCR

- Los datos están en la carpeta de usuario de la app (normalmente `%APPDATA%\generador-tests`): base de datos `apuntes.sqlite`, `config.json` opcional y la caché de OCR `tessdata/`. Copia `apuntes.sqlite` para hacer una copia de seguridad.
- La compilación empaquetada incluye los datos de idioma `spa` y `eng` (Tesseract `tessdata_best`, licencia Apache-2.0, aviso en `resources/tessdata/NOTICE.txt`) y los lee de ahí, sin descargar nada. En `npm run dev` no se incluyen: el **primer OCR descarga unos 5 MB comprimidos** del CDN de tesseract.js y los guarda en la caché de la carpeta de datos; hasta entonces necesita internet. La lectura desde los archivos incluidos se ha comprobado en el smoke del `.exe`; el funcionamiento sin conexión en sí no se ha probado cortando la red.

## Limitaciones conocidas

- La escritura manuscrita se reconoce mal; se avisa y se puede corregir el texto a mano.
- No se admite HEIC/HEIF: en el móvil elige JPG («más compatible») o exporta la foto a JPG/PNG.
- Las fotos subidas desde el móvil tienen un tope de unos 40 millones de píxeles (`src/core/mobile.ts`); para las elegidas en el PC no hay un tope equivalente en el código.
- Los PDF escaneados (sin texto) no se leen: expórtalos como imágenes y súbelos como fotos.
- Los conceptos en plural y singular no se unifican (`mitocondria` y `mitocondrias` son entradas distintas).
- El índice de conceptos es una instantánea que se guarda al construirlo; la interfaz no avisa de que los apuntes hayan cambiado después, hay que reconstruirlo tú.
- Volver a confirmar el texto OCR de un documento reemplaza sus fragmentos (`confirmOcr` → `deleteChunks`) y, por `ON DELETE CASCADE` en la base de datos, borra las preguntas guardadas de esos fragmentos y las respuestas de esas preguntas en el historial.
- Solo se ha implementado Ollama como proveedor de IA y solo la interfaz en español.
