# Generador de tests

Aplicación de escritorio para Windows que genera tests a partir de **tus propios apuntes**, usando un modelo de lenguaje que corre en tu equipo con [Ollama](https://ollama.com).

Importas tus apuntes por asignatura, la app los trocea, y genera preguntas de verdadero/falso, test, desarrollo y ejercicios prácticos. Cada pregunta lleva una cita que el código ha comprobado contra tus apuntes. Si no aparece, la pregunta se descarta.

> Cómo usarla paso a paso: [docs/GUIA_DE_USO.md](docs/GUIA_DE_USO.md).
> Cómo funciona por dentro: [docs/COMO_FUNCIONA.md](docs/COMO_FUNCIONA.md).

## Características

- **Asignaturas** separadas: apuntes, preguntas e historial no se mezclan.
- **Importación** de texto, Markdown, PDF con texto y fotos (OCR en español e inglés). El texto de una foto se revisa antes de guardarse.
- **Fotos desde el móvil**: un código QR abre un enlace temporal en tu wifi para subir fotos.
- **Tests** de verdadero/falso, test y desarrollo, con corrección y feedback. **Ejercicios prácticos** a partir de apuntes con datos o ejemplos resueltos.
- **Índice de conceptos** por asignatura, para elegir tema.
- **Historial** de intentos con su puntuación.

## La promesa y sus límites

Cada pregunta que ves lleva una **cita literal** de tus apuntes, y el código comprueba que esa cita aparece en el fragmento de origen. Si el modelo no consigue una cita válida tras tres intentos, la pregunta se descarta y el resumen te dice cuántas y por qué. Si tus apuntes no cubren un tema, la app lo dice en vez de inventar.

Lo que **no** garantiza:

- La comprobación prueba que el **pasaje existe** en tus apuntes, no que la pregunta esté bien planteada ni que el modelo lo haya entendido. Revisa las preguntas con criterio.
- Se **ignoran los símbolos** al comparar: `x = -5` y `x = 5` pueden darse por iguales, y también `2,5` y `2.5`. Es una debilidad conocida, sobre todo en ejercicios con números.
- La calidad depende del modelo. Con modelos pequeños se descartan más preguntas.

## Requisitos

- Windows 11 y 16 GB de RAM.
- [Ollama](https://ollama.com) instalado y en marcha, con el modelo por defecto:

  ```
  ollama pull qwen2.5:7b
  ```

  Para usar otro modelo, define `GT_MODEL` (por ejemplo `GT_MODEL=llama3.1:8b`) o crea un `config.json` con `{"model": "..."}` en la carpeta de datos de la app.
- Sin GPU, el modelo corre en CPU: generar un test puede tardar **minutos**.
- Para desarrollar: Node 24.

## Instalación y uso

```
npm install
npm run dev     # aplicación en modo desarrollo
npm test        # pruebas
npm run pack    # empaquetado en release/win-unpacked/ (sin instalador)
```

Pasos para usarla:

1. Crea una asignatura.
2. Importa apuntes: archivo de texto, PDF con texto, foto del PC o foto desde el móvil.
3. Revisa el texto de las fotos y confírmalo para trocearlo.
4. En **Test** o **Ejercicios**, elige el tipo, el número de preguntas y, si quieres, un tema o un concepto.
5. Responde; la corrección muestra el feedback y la cita, con el enlace «Ver en apuntes».

## Fotos desde el móvil

- El móvil debe estar en **la misma wifi** que el PC. Si no conecta, permite la app en el Firewall de Windows para redes privadas.
- La conexión es **HTTP sin cifrar**. Úsala solo en redes de confianza.
- La subida se desactiva sola a los **10 minutos** o al pulsar Detener.

## Datos

Todo se guarda en tu equipo, en la carpeta de datos de la app (normalmente `%APPDATA%\generador-tests`): la base de datos `apuntes.sqlite`, un `config.json` opcional y la caché del OCR. Copia `apuntes.sqlite` para hacer una copia de seguridad.

La compilación empaquetada incluye los datos de idioma del OCR (Tesseract, licencia Apache-2.0). En `npm run dev` el primer OCR descarga unos 5 MB y necesita internet.

## Limitaciones conocidas

- La escritura a mano se reconoce mal; puedes corregir el texto antes de confirmarlo.
- Las fotos HEIC/HEIF no se admiten: en el móvil elige JPG o expórtala a JPG/PNG.
- Las fotos subidas desde el móvil tienen un tope de unos 40 millones de píxeles.
- Los PDF escaneados, sin texto, no se leen: expórtalos como imágenes.
- Los conceptos en singular y plural no se unifican (`mitocondria` y `mitocondrias` son entradas distintas).
- El índice de conceptos es una instantánea: si cambias los apuntes, hay que reconstruirlo.
- Volver a confirmar el OCR de un documento reemplaza sus fragmentos y borra las preguntas y respuestas que dependían de ellos. La app lo avisa antes.
- Solo hay un proveedor de IA (Ollama) y la interfaz está solo en español.

## Estado de la verificación

Probado: las pruebas automáticas (Vitest) y el empaquetado, incluida una prueba automática del `.exe` que importa apuntes, hace OCR de una foto de ejemplo y comprueba que los archivos del motor se cargan desde el paquete.

Sin probar todavía: un modelo real de Ollama, un móvil real, una sesión gráfica completa y el instalador. No hay firma de código, así que Windows SmartScreen puede avisar al ejecutarla.

## Licencia

Pendiente de definir.
