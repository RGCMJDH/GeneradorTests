# Generador de tests desde apuntes — Diseño

Fecha: 2026-10-22 · Estado: pendiente de revisión del usuario

## 1. Objetivo
App de escritorio (Electron) donde el usuario importa apuntes de sus asignaturas y una IA local genera tests interactivos, feedback y ejercicios prácticos **exclusivamente a partir de esos apuntes**. Un único usuario, uso personal, todo offline salvo la subida de fotos desde el móvil por la wifi local.

### Criterios de éxito
- Cada pregunta mostrada tiene una cita literal verificada en un fragmento de los apuntes, enlazable desde la UI.
- Si los apuntes no cubren un tema, la app lo indica y no genera contenido.
- Las asignaturas están separadas: apuntes, preguntas e historial no se mezclan entre ellas.
- Se pueden importar apuntes desde archivo (texto, markdown, PDF) y foto (PC o móvil).

### Fuera de alcance (v1)
- Cuentas, sincronización en la nube, multiusuario.
- App móvil nativa (el móvil solo sube fotos).
- Lectura fiable de escritura manuscrita (se avisa y se permite corregir el OCR a mano).
- Cambio de proveedor de IA en la UI (la interfaz queda preparada, solo se implementa Ollama).

## 2. Decisiones tomadas
| Tema | Decisión |
|---|---|
| IA | Ollama local, modelo de texto 3–8B configurable. CPU (16 GB RAM, GPU integrada). |
| Fotos | OCR con Tesseract.js (es+en); el texto OCR es editable. |
| Plataforma | Electron + React + Vite + TypeScript. |
| Datos | SQLite (better-sqlite3), un archivo en la carpeta de usuario. |
| Móvil | Servidor HTTP local efímero + QR; misma wifi; solo subida de imágenes. |
| Idioma | Español en UI, prompts y tests. |

## 3. Garantía de fidelidad a los apuntes
1. Los documentos se trocean en **fragmentos** (`chunks`) con id, asignatura, documento, posición y texto.
2. Para generar, se eligen fragmentos concretos y se envían al modelo pidiendo JSON con: `enunciado`, `respuesta`, `explicacion`, `chunkId`, `cita`.
3. **Verificador** (`verify.ts`): la `cita` normalizada (minúsculas, espacios, tildes, puntuación) debe ser subcadena del texto normalizado del chunk `chunkId`. Si falla: se reintenta hasta 2 veces; si sigue fallando, se descarta.
4. Si tras la generación quedan menos preguntas que las pedidas, se muestran las válidas y se informa de cuántas se descartaron y por qué ("sin material suficiente").
5. En preguntas de desarrollo y ejercicios, la **corrección** compara la respuesta del usuario con la cita; el feedback también cita fragmentos y pasa por el mismo verificador.
6. Ninguna pregunta se guarda ni se muestra sin cita válida.
7. Limitación asumida: el verificador garantiza que la cita existe, no que el modelo la interprete bien. Por eso la UI muestra siempre la cita y el enlace al fragmento original.

## 4. Arquitectura
Proceso principal de Electron (Node) con servicios; renderer React que habla con ellos por IPC.

| Módulo | Responsabilidad | Depende de |
|---|---|---|
| `ingest/` | Importar txt/md/PDF/imagen → texto → chunks | `store`, Tesseract, pdf-parse |
| `store/` | SQLite y consultas | better-sqlite3 |
| `llm/` | Interfaz `LlmProvider` + implementación Ollama (HTTP `localhost:11434`) | — |
| `generate/` | Prompts, esquemas JSON por tipo, orquestación, `verify.ts` | `llm`, `store` |
| `grade/` | Corrección y feedback de respuestas | `llm`, `verify` |
| `graph/` | Conceptos y relaciones por asignatura (Graphify) para elegir temas | `store` |
| `mobile/` | Servidor local de subida + QR | `ingest` |
| `ui/` | Vistas React | IPC |

### Modelo de datos
- `subjects(id, name, created_at)`
- `documents(id, subject_id, title, source_type, path, created_at)`
- `chunks(id, document_id, subject_id, position, text)`
- `questions(id, subject_id, chunk_id, type, prompt, options_json, answer, explanation, quote, created_at)`
- `attempts(id, subject_id, started_at, finished_at)`
- `answers(id, attempt_id, question_id, user_answer, correct, feedback, feedback_quote)`

### Tipos de ejercicio
- Verdadero/falso, tipo test (opciones), desarrollar, ejercicio práctico.
- Práctico: solo si el fragmento contiene datos y método (ejemplo resuelto o fórmula con ejemplo); si no, se omite.

## 5. Flujo de usuario
1. Crear asignatura.
2. Importar apuntes (archivo, foto del PC o foto del móvil vía QR). Revisar/corregir el texto OCR.
3. Dentro de la asignatura: pestañas **Apuntes · Test · Ejercicios · Historial**.
4. Test: elegir tipo, nº de preguntas y (opcional) tema/documento → generar → responder → corrección con feedback y cita → resultado guardado.

## 6. Errores y casos límite
- Ollama no está en ejecución o falta el modelo: pantalla de diagnóstico con instrucciones.
- Generación lenta: barra de progreso por pregunta, cancelable.
- JSON inválido del modelo: reintento; luego se descarta esa pregunta.
- OCR de baja calidad: aviso y edición manual antes de trocear.
- PDF escaneado sin texto: se ofrece pasarlo por OCR.
- Asignatura sin apuntes: la pestaña Test explica que primero hay que importar.

## 7. Pruebas
- Unitarias (Vitest): `verify.ts` (cita real pasa; cita alterada, inventada o de otro chunk falla), troceado, parser JSON, normalización.
- Integración: `generate` con un `LlmProvider` falso que devuelve citas válidas e inválidas.
- E2E manual: apuntes de ejemplo → test con citas; tema ausente → "sin material suficiente"; foto desde el móvil → texto OCR en la asignatura.

## 8. Herramientas de proceso
- Superpowers: spec → writing-plans → TDD → verification-before-completion.
- Graphify: grafo de conceptos de los apuntes y consulta del código del proyecto.
- REA: solo si hace falta analizar una app existente como referencia; requiere configurar antes un motor (Ghidra/jadx/IDA/Kuna), hoy ninguno lo está.

## 9. Riesgos
- Calidad del modelo 3–8B en español y su tendencia a alucinar: mitigado por citas verificadas, pero puede descartar muchas preguntas.
- Velocidad en CPU: generar un test puede tardar minutos.
- Escritura manuscrita con OCR: calidad baja.
- Instalación de Ollama y de los modelos: manual, fuera de la app (la app solo diagnostica).
