# Guía de uso

Esta guía explica paso a paso cómo usar la app: desde instalarla hasta hacer tu primer test. Para lo que hay detrás de cada función, ver [COMO_FUNCIONA.md](COMO_FUNCIONA.md).

## Antes de empezar

1. **Instala Ollama** desde [ollama.com](https://ollama.com) y ábrelo. Se queda en segundo plano.
2. **Descarga el modelo.** En una terminal:

   ```bash
   ollama pull qwen2.5:7b
   ```

   Tarda un rato: el modelo ocupa unos 4,7 GB.
3. **Abre la app.** Si Ollama no está listo, verás un aviso con los pasos. Pulsa **Reintentar** cuando lo hayas arreglado.

La app te deja importar y leer apuntes aunque Ollama esté apagado. Solo hace falta Ollama para generar tests, ejercicios y conceptos.

## 1. Crear una asignatura

En la barra lateral, escribe el nombre de la asignatura y pulsa **Crear asignatura**. Cada asignatura tiene sus propios apuntes, tests, ejercicios e historial, y no se mezclan.

Para cambiar de asignatura, haz clic en su nombre. Si tienes algo en marcha (una importación, una revisión de OCR, una generación o un test a medias), la app te preguntará antes: si confirmas, se pierde o se cancela.

## 2. Importar apuntes

Dentro de una asignatura, en la pestaña **Apuntes**, sección **Importar apuntes**, elige el tipo:

- **Importar texto o Markdown**: archivos `.txt` o `.md`. Se leen directamente.
- **Importar PDF**: solo PDF con texto seleccionable. Si el PDF es un escaneo y no tiene texto, la app te lo dirá; en ese caso exporta las páginas como imágenes y usa **Importar foto**.
- **Importar foto**: fotos de tus apuntes (JPG, PNG, WebP, GIF, BMP o TIFF). Pasan por reconocimiento de texto (OCR).

Consejos para las fotos:

- Buena luz, sin sombras, papel plano y letra clara. La escritura a mano se reconoce mal.
- Si el móvil guarda las fotos en HEIC, expórtalas a JPG antes de importarlas.

### Revisar el texto de una foto

Tras importar una foto aparece **Texto reconocido (OCR), editable**. Revísalo y corrígelo si hace falta, y después pulsa **Confirmar y trocear**. Hasta que confirmes, el texto no entra en tus apuntes.

Si cierras la revisión sin confirmar, el documento queda como «Sin trocear». Para retomarlo, usa **Reanudar revisión**. Como el texto original no se guarda, la revisión empieza vacía: pega o escribe el texto de nuevo.

Si vuelves a confirmar un documento ya trozado, sus fragmentos se reemplazan. La app te avisará si eso borra preguntas ya generadas.

### Subir fotos desde el móvil

En la pestaña **Apuntes**, sección **Fotos desde el móvil**, pulsa **Subir desde el móvil**.

1. Aparece un código QR y un enlace. Escanea el QR con el móvil.
2. El móvil y el PC deben estar en **la misma wifi**. Si no conecta, permite la app en el Firewall de Windows para redes privadas.
3. Haz la foto desde el móvil en la página que se abre y envíala.
4. La foto aparece en el PC para revisar el texto, igual que las importadas desde el archivo.

Ten en cuenta:

- La conexión no va cifrada. Úsala solo en redes de confianza y no compartas el enlace.
- La subida se desactiva sola a los 10 minutos o cuando pulses **Detener**.
- Si llega una foto mientras estás en otra asignatura, quedará guardada en la asignatura a la que pertenece, como «Sin trocear».

## 3. Ver tus apuntes

En la misma pestaña **Apuntes** verás la lista de documentos, con su título, su tipo y cuántos fragmentos tiene. Cada documento se puede abrir para ver sus fragmentos.

Para borrar un documento, usa **Eliminar documento**. Se borran también sus fragmentos y las preguntas que se generaron a partir de ellos. La app lo confirma antes.

## 4. Extraer conceptos (opcional)

En la sección **Conceptos** pulsa **Extraer conceptos**. La app recorre tus fragmentos y propone términos clave que aparecen literalmente en el texto.

- Puede tardar varios minutos en un equipo sin tarjeta gráfica. Puedes cancelar en cualquier momento.
- Si tienes muchos documentos, puedes elegir uno concreto en lugar de todos.
- Al pulsar un concepto verás sus términos relacionados y el botón **Ver fragmento** para ir al texto de origen.

Los conceptos se guardan. Si cambias tus apuntes después, vuelve a extraerlos.

## 5. Hacer un test

Pestaña **Test**.

1. **Tipo de pregunta**: verdadero/falso, test o desarrollo.
2. **Número de preguntas**: entre 1 y 20.
3. **Documento (opcional)**: limita las preguntas a un documento concreto.
4. **Tema (opcional)**: escribe un tema o elige uno de los conceptos extraídos.
5. Pulsa **Generar**.

Mientras se genera verás una barra de progreso. Puedes pulsar **Cancelar** en cualquier momento: las preguntas ya generadas se conservan.

Al terminar, el resumen te dice cuántas preguntas se han generado y, si alguna se descartó, cuántas y por qué. Si tus apuntes no cubren el tema, verás «No hay material suficiente en tus apuntes para ese tema». En ese caso importa más apuntes o cambia el tema. Si en cambio ves «No se pudo contactar con el modelo de IA», el problema no son tus apuntes: Ollama no está en marcha o le falta el modelo.

### Responder

Cada pregunta aparece sola, con su número («Pregunta 3 de 5»).

- **Verdadero/falso** y **test**: elige una opción.
- **Desarrollo**: escribe tu respuesta en el cuadro de texto.

Al responder aparece la corrección: correcto o incorrecto, la explicación y el **fragmento de origen**. La insignia **Cita verificada en tus apuntes** aparece solo cuando la cita se ha comprobado en tus apuntes. El botón **Ver en apuntes** te lleva al fragmento original.

Si una corrección de desarrollo dice «(cita del modelo no verificada)», la explicación del modelo no tiene respaldo en tus apuntes. Revísala con cuidado. En los ejercicios, la marca «(cifras del modelo no verificadas…)» avisa de que el feedback usa números que no están en tus apuntes ni en tu respuesta.

### Terminar

Cuando acabes, el test muestra tu puntuación. Desde ahí puedes:

- **Repetir con otras preguntas**: genera un test nuevo con el mismo ajuste.
- **Ver historial**: revisa este intento.

Si quieres parar antes, pulsa **Terminar el test aquí** y confirma. Si una pregunta no te interesa o no se puede responder, pulsa **Saltar esta pregunta**: cuenta como no respondida.

## 6. Hacer ejercicios prácticos

Pestaña **Ejercicios**. Funciona igual que el test, pero solo genera **ejercicios prácticos**, basados en fragmentos con datos, cálculos o ejemplos resueltos.

Si tus apuntes no tienen ejemplos de ese tipo, la app te lo dirá en lugar de inventar ejercicios. Los ejercicios se corrigen con el modelo, así que la corrección es más flexible que la de un test; revisa también el razonamiento, no solo el resultado.

## 7. Revisar el historial

Pestaña **Historial**. Cada intento aparece con su fecha, su puntuación y su número de preguntas. Si un intento no se terminó, aparece como **Sin terminar**. Pulsa un intento para ver sus preguntas y respuestas.

## Qué hacer si algo falla

- **«Ollama no está disponible»** o **«No se pudo contactar con el modelo de IA»**: comprueba que Ollama está abierto y que el modelo está descargado (`ollama list`). Luego pulsa **Reintentar**.
- **La generación tarda mucho**: es normal en CPU. Usa menos preguntas, o cancela y prueba con un tema más concreto.
- **Muchas preguntas descartadas**: el modelo no encontró citas válidas en el fragmento. Prueba con un tema más concreto o con apuntes mejor escritos.
- **Una foto sale mal reconocida**: corrige el texto en la revisión antes de confirmar. Para mejorar el resultado, haz la foto con más luz y más cerca.
- **El móvil no conecta**: confirma que está en la misma wifi y que el Firewall de Windows permite la app en redes privadas.

## Dónde están tus datos

Todo se guarda en tu equipo, en `%APPDATA%\generador-tests` (`apuntes.sqlite` es la base de datos). Para hacer una copia de seguridad, cierra la app y copia ese archivo.
