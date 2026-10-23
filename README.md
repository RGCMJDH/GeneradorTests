# Generador de tests

Aplicación de escritorio para Windows 11 que genera tests a partir de **tus propios apuntes**, con un modelo de lenguaje local (Ollama). Todo funciona en tu equipo; la única salida a la red es la subida opcional de fotos desde el móvil por la wifi local (y la descarga del modelo de Ollama y, en una compilación sin datos de idioma incluidos, de los datos de OCR).

## Qué hace

- Organiza el material por **asignaturas** (apuntes, preguntas e historial no se mezclan entre ellas).
- Importa apuntes desde texto/Markdown, PDF con texto y fotos (OCR con Tesseract, español + inglés; el texto reconocido se puede corregir antes de confirmarlo).
- Genera tests de varios tipos y ejercicios prácticos, los corrige y guarda el historial.
- Construye un índice de conceptos por asignatura para elegir tema.

## La promesa y sus límites

**Cada pregunta mostrada lleva una cita que se comprueba contra los apuntes.** El modelo debe devolver el fragmento de origen y una cita literal; la app comprueba que esa cita aparece en ese fragmento (tras normalizar mayúsculas, tildes, espacios y puntuación). Si no aparece, se reintenta y, si sigue fallando, la pregunta se descarta y se te informa. Si los apuntes no cubren el tema, la app lo dice en vez de inventar. La cita y el enlace al fragmento original se ven siempre en la interfaz.

Lo que la comprobación **no** garantiza:

- Prueba que el pasaje **existe** en tus apuntes, no que la pregunta o la respuesta estén bien planteadas ni que el modelo haya entendido el pasaje. Revisa las preguntas con criterio.
- La comparación **ignora los símbolos** (`+ - = , .`): una cita con el signo cambiado (`x = -5` frente a `x = 5`) o con otro separador decimal (`2,5` frente a `2.5`) puede darse por válida. Es una debilidad conocida, especialmente en ejercicios con fórmulas y números.
- La calidad real depende del modelo local; con modelos pequeños es normal que se descarten preguntas.

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
npm test        # pruebas (vitest); las de OCR descargan datos de idioma la primera vez
npm run pack    # build + empaquetado sin instalador en release/win-unpacked/
```

`npm run pack` ejecuta primero `scripts/prepare-tessdata.mjs`, que deja en `build/tessdata` los datos de idioma `spa` y `eng` (de `.cache/tessdata` si ya existen, y si no los descarga del CDN que usa tesseract.js) para incluirlos en la app. Hace falta conexión en esa máquina la primera vez. El ejecutable queda en `release/win-unpacked/Generador de tests.exe`. La configuración de `electron-builder` incluye también un objetivo `nsis`, pero solo se ha construido y probado el directorio sin empaquetar; no hay firma de código, así que Windows SmartScreen puede avisar.

## Subir fotos desde el móvil

1. En la pestaña Apuntes, en la sección «Fotos desde el móvil», inicia la subida: aparece un código QR y un enlace.
2. El móvil debe estar en **la misma wifi** que el PC. Windows pedirá permiso en el Firewall la primera vez que se abra el puerto.
3. La conexión es **HTTP sin cifrar**: cualquiera en tu red con el enlace podría enviar fotos mientras esté activo. Úsalo solo en redes de confianza.
4. La subida se desactiva sola a los **10 minutos** o al pulsar Detener.
5. Cada foto pasa por el mismo OCR y se revisa antes de convertirse en apuntes.

## Datos y OCR

- Los datos están en la carpeta de usuario de la app (normalmente `%APPDATA%\generador-tests`): base de datos `apuntes.sqlite`, `config.json` opcional y la caché de OCR `tessdata/`. Copia `apuntes.sqlite` para hacer una copia de seguridad.
- La compilación empaquetada incluye los datos de idioma `spa` y `eng` (Tesseract `tessdata_best`, licencia Apache-2.0, aviso en `resources/tessdata/NOTICE.txt`) y el OCR funciona sin conexión. En desarrollo (`npm run dev`) y en una compilación hecha sin esos archivos, el **primer OCR descarga unos 5 MB comprimidos** de datos de idioma y los guarda en la caché; hasta entonces necesita internet.

## Limitaciones conocidas

- La escritura manuscrita se reconoce mal; se avisa y se puede corregir el texto a mano.
- No se admite HEIC/HEIF: en el móvil elige JPG ("más compatible") o exporta la foto a JPG/PNG.
- Las imágenes tienen un tope de unos 40 millones de píxeles.
- Los PDF escaneados (sin texto) no se leen: expórtalos como imágenes y súbelos como fotos.
- Los conceptos en plural y singular no se unifican (`mitocondria` y `mitocondrias` son entradas distintas).
- El índice de conceptos es una instantánea: no avisa cuando los apuntes cambian después; hay que reconstruirlo.
- Confirmar de nuevo el texto de una foto ya procesada borra las preguntas guardadas a partir de ese documento.
- Solo se ha implementado Ollama como proveedor de IA y solo la interfaz en español.
