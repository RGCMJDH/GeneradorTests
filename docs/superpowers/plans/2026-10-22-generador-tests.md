# Generador de tests desde apuntes — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** App de escritorio que importa apuntes por asignatura y genera tests, feedback y ejercicios prácticos solo a partir de ellos, con cada pregunta respaldada por una cita literal verificada.

**Architecture:** Lógica pura en `src/core` (sin Electron, 100 % testable con Vitest); `src/main` la expone por IPC; `src/renderer` es la UI React. La IA entra por la interfaz `LlmProvider` (Ollama). Toda salida del modelo pasa por `verifyQuote` antes de guardarse o mostrarse.

**Tech Stack:** Electron, electron-vite, React, TypeScript, Vitest, sql.js, Tesseract.js, pdf-parse, Ollama (HTTP local), qrcode.

**Spec:** `docs/superpowers/specs/2026-10-22-generador-tests-design.md`

## Global Constraints
- Español en UI, prompts y tests; OCR `spa+eng`.
- Ninguna pregunta/feedback se guarda ni se muestra sin cita que pase `verifyQuote` (spec §3.6).
- Reintentos de generación por pregunta: máximo 2 (spec §3.3).
- Ollama en `http://localhost:11434`, modelo configurable (por defecto `qwen2.5:7b`).
- Asignaturas aisladas: toda consulta de chunks/preguntas/intentos filtra por `subject_id`.
- **Desviación del spec §2:** se usa `sql.js` (WASM) en vez de `better-sqlite3`, porque este último exige binarios distintos para Node (tests) y Electron y rompe uno de los dos. El archivo `.sqlite` se persiste al disco tras cada escritura. Si no te parece bien, avísame antes de ejecutar.
- Commits frecuentes; mensajes `feat:`/`test:`/`chore:`.

## Review Focus
1. Cita con tildes, mayúsculas o espacios distintos al original → debe aceptarse (Task 1).
2. Cita correcta pero con `chunkId` de otra asignatura/fragmento → debe rechazarse (Task 1, 5).
3. Asignatura sin apuntes o tema ausente → `insufficient: true`, cero preguntas, sin llamar al modelo si no hay chunks (Task 5).
4. Respuesta JSON del modelo con basura, campos faltantes o texto fuera del JSON → pregunta descartada, no crash (Task 4, 5).
5. Ollama apagado o modelo no descargado → `health()` devuelve mensaje accionable; la UI no se queda colgada (Task 4, 9).

---

## File Structure
```
package.json, electron.vite.config.ts, vitest.config.ts, tsconfig*.json
src/core/types.ts          tipos compartidos
src/core/normalize.ts      normalización de texto
src/core/verify.ts         verifyQuote
src/core/chunker.ts        chunkText
src/core/store.ts          SQLite (sql.js)
src/core/llm.ts            LlmProvider + OllamaProvider
src/core/generate.ts       generateQuestions
src/core/grade.ts          gradeAnswer
src/core/ingest.ts         importText / importPdf / importImage
src/core/ocr.ts            ocrImage (Tesseract)
src/core/graph.ts          extractConcepts
src/core/mobile.ts         startUploadServer
src/main/index.ts, ipc.ts  ventana + handlers IPC
src/preload/index.ts       API segura para el renderer
src/renderer/...           React: Subjects, Notes, Quiz, Exercises, History, Diagnostics
tests/core/*.test.ts       un archivo por módulo core
tests/fixtures/            apuntes de ejemplo
```

---

### Task 0: Scaffold y herramientas
**Files:** Create todo el árbol base; `.gitignore`, `tests/fixtures/apuntes-ejemplo.md`.
**Interfaces:** Produces: scripts `npm run dev`, `npm test`, `npm run build`.

- [ ] **Step 1:** `git init` en la carpeta del proyecto; `.gitignore` con `node_modules`, `out`, `dist`, `*.sqlite`, `graphify-out` no (se versiona).
- [ ] **Step 2:** Crear proyecto electron-vite React+TS en la raíz (sin tocar `rea/`; añadirla a `.gitignore`). Instalar dependencias de la tabla Tech Stack.
- [ ] **Step 3:** Configurar Vitest (`environment: node`, `include: tests/**/*.test.ts`) y un test trivial `tests/core/smoke.test.ts` que haga `expect(1+1).toBe(2)`.
- [ ] **Step 4:** Run `npm test` → PASS; `npm run dev` abre ventana Electron vacía.
- [ ] **Step 5:** Crear `tests/fixtures/apuntes-ejemplo.md` con ~6 párrafos reales y verificables (p. ej. "La mitocondria produce ATP mediante la fosforilación oxidativa.") para usar en todos los tests.
- [ ] **Step 6:** Commit `chore: scaffold electron-vite + vitest`.

### Task 1: normalize + verifyQuote
**Files:** Create `src/core/normalize.ts`, `src/core/verify.ts`, `src/core/types.ts`; Test `tests/core/verify.test.ts`.
**Interfaces:** Produces: `normalize(s: string): string`; `verifyQuote(quote: string, chunkText: string): boolean`; tipos `QuestionType = 'vf'|'test'|'desarrollo'|'practico'`, `Question`, `Chunk`, `Subject`.

- [ ] **Step 1: tests** (fallan primero):
  - `acepta cita literal`
  - `acepta cita con distintas mayúsculas, tildes y espacios múltiples` (Review Focus 1)
  - `rechaza cita inventada`
  - `rechaza cita alterada en una palabra`
  - `rechaza cita vacía o de menos de 8 caracteres normalizados`
- [ ] **Step 2:** Run `npx vitest run tests/core/verify.test.ts` → FAIL.
- [ ] **Step 3:** Implementar `normalize` (NFD sin diacríticos, minúsculas, puntuación→espacio, espacios colapsados, trim) y `verifyQuote` (subcadena de normalizados; mínimo 8 caracteres). Definir los tipos en `types.ts`.
- [ ] **Step 4:** Run → PASS. **Step 5:** Commit `feat: quote verification`.

### Task 2: chunker
**Files:** Create `src/core/chunker.ts`; Test `tests/core/chunker.test.ts`.
**Interfaces:** Produces: `chunkText(text: string, opts?: { maxChars?: number }): string[]` (por defecto 1200).

- [ ] **Step 1: tests:** `divide por párrafos sin superar maxChars`; `un párrafo mayor que maxChars se parte por frases`; `no pierde ni duplica texto (concatenar chunks normalizados == texto normalizado)`; `texto vacío → []`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implementar: agrupar párrafos hasta `maxChars`, partir por frases cuando un párrafo no cabe. **Step 4:** PASS. **Step 5:** Commit `feat: chunker`.

### Task 3: store (sql.js)
**Files:** Create `src/core/store.ts`; Test `tests/core/store.test.ts`.
**Interfaces:** Produces: `openStore(filePath?: string): Promise<Store>` (sin ruta = en memoria) con:
`createSubject(name): Subject`, `listSubjects(): Subject[]`, `addDocument({subjectId,title,sourceType,path?}): Doc`, `addChunks(documentId, subjectId, texts: string[]): Chunk[]`, `listChunks(subjectId, documentId?): Chunk[]`, `getChunk(id): Chunk|undefined`, `updateChunkText(id, text)`, `deleteDocument(id)`, `saveQuestion(q): Question`, `listQuestions(subjectId): Question[]`, `startAttempt(subjectId): number`, `saveAnswer({attemptId,questionId,userAnswer,correct,feedback,feedbackQuote})`, `finishAttempt(id)`, `listAttempts(subjectId)`. Esquema de tablas según spec §4.

- [ ] **Step 1: tests:** `crea y lista asignaturas`; `chunks de una asignatura no aparecen en otra` (aislamiento); `borrar documento borra sus chunks`; `persiste a disco y reabre con los mismos datos` (archivo temporal).
- [ ] **Step 2:** FAIL. **Step 3:** Implementar con sql.js; exportar la BD a `filePath` tras cada escritura. **Step 4:** PASS. **Step 5:** Commit `feat: sqlite store`.

### Task 4: LlmProvider + Ollama
**Files:** Create `src/core/llm.ts`; Test `tests/core/llm.test.ts`.
**Interfaces:** Produces:
```ts
interface LlmProvider {
  generateJson(p: { system: string; user: string }): Promise<unknown>;
  health(): Promise<{ ok: boolean; message: string }>;
}
class OllamaProvider implements LlmProvider { constructor(opts?: { baseUrl?: string; model?: string; fetchImpl?: typeof fetch }) }
function extractJson(raw: string): unknown   // lanza Error si no hay JSON válido
```
- [ ] **Step 1: tests (con `fetchImpl` falso):** `generateJson envía format json y stream false`; `extractJson tolera texto antes/después y bloques \`\`\`json` ; `extractJson lanza con basura` (Review Focus 4); `health: Ollama apagado → ok false y mensaje que dice cómo arrancarlo`; `health: modelo ausente → ok false y mensaje con 'ollama pull <modelo>'` (Review Focus 5).
- [ ] **Step 2:** FAIL. **Step 3:** Implementar con `fetch` a `/api/chat` y `/api/tags`. **Step 4:** PASS. **Step 5:** Commit `feat: ollama provider`.

### Task 5: generateQuestions (núcleo anti-invención)
**Files:** Create `src/core/generate.ts`; Test `tests/core/generate.test.ts`.
**Interfaces:** Consumes: `LlmProvider`, `Store`, `verifyQuote`. Produces:
```ts
generateQuestions(
  deps: { llm: LlmProvider; store: Store },
  req: { subjectId: number; type: QuestionType; count: number; documentId?: number; topic?: string },
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal
): Promise<{ questions: Question[]; discarded: number; reasons: string[]; insufficient: boolean }>
```
Reglas: elegir chunks de la asignatura (filtrados por `documentId`/`topic` por coincidencia de texto normalizado); si no hay ninguno → `insufficient: true` y **no** llamar al LLM; por cada pregunta pedir JSON `{enunciado, opciones?, respuesta, explicacion, chunkId, cita}`; validar forma; `chunkId` debe ser un chunk enviado en ese prompt; `verifyQuote(cita, chunk.text)`; hasta 2 reintentos; guardar solo las válidas.

- [ ] **Step 1: tests con `FakeLlm` (secuencia de respuestas):** `devuelve preguntas con cita válida y las guarda`; `descarta cita inventada tras 2 reintentos y cuenta discarded=1` ; `descarta chunkId de otra asignatura o no enviado` (Review Focus 2); `asignatura sin chunks → insufficient true y FakeLlm no es llamado` (Review Focus 3); `topic ausente en apuntes → insufficient true`; `JSON inválido/campos faltantes → descartada sin lanzar` (Review Focus 4); `tipo test exige 4 opciones y la respuesta es una de ellas`; `vf: respuesta es 'verdadero'|'falso'`; `AbortSignal cancela`; `onProgress se llama una vez por pregunta`.
- [ ] **Step 2:** FAIL. **Step 3:** Implementar; prompts en español en el mismo archivo, con instrucción explícita "usa solo el texto dado; si no hay base, responde {\"sin_material\":true}"; tratar `sin_material` como descarte con razón. **Step 4:** PASS. **Step 5:** Commit `feat: grounded question generation`.

### Task 6: ingesta de texto y PDF
**Files:** Create `src/core/ingest.ts`; Test `tests/core/ingest.test.ts`; fixture `tests/fixtures/apuntes.pdf` (generado con texto conocido).
**Interfaces:** Produces: `importTextFile(deps: { store }, subjectId: number, filePath: string): Promise<{ document: Doc; chunks: Chunk[] }>` y `importPdf(...)` con la misma firma. PDF sin texto → lanza `NoTextError` (para ofrecer OCR).

- [ ] **Step 1: tests:** `importa markdown y crea chunks en la asignatura correcta`; `importa PDF con texto`; `PDF sin texto lanza NoTextError`; `archivo vacío → documento sin chunks y aviso`.
- [ ] **Step 2:** FAIL. **Step 3:** Implementar con `chunkText` + `pdf-parse`. **Step 4:** PASS. **Step 5:** Commit `feat: text and pdf ingest`.

### Task 7: OCR de fotos
**Files:** Create `src/core/ocr.ts`; extend `src/core/ingest.ts`; Test `tests/core/ocr.test.ts`; fixture `tests/fixtures/foto-apuntes.png` (texto impreso).
**Interfaces:** Produces: `ocrImage(path: string): Promise<string>`; `importImage(deps, subjectId, filePath): Promise<{ document: Doc; ocrText: string }>` — **no trocea todavía**; `confirmOcr(deps, documentId, correctedText: string): Chunk[]` trocea el texto corregido y guarda los chunks.

- [ ] **Step 1: tests:** `ocrImage lee una frase conocida del fixture (contiene 'mitocondria')`; `importImage devuelve ocrText y no crea chunks`; `confirmOcr crea chunks con el texto corregido`.
- [ ] **Step 2:** FAIL. **Step 3:** Implementar con Tesseract.js (`spa+eng`), idiomas cacheados en userData. **Step 4:** PASS. **Step 5:** Commit `feat: image ocr ingest`.

### Task 8: corrección y feedback
**Files:** Create `src/core/grade.ts`; Test `tests/core/grade.test.ts`.
**Interfaces:** Produces: `gradeAnswer(deps: { llm; store }, q: Question, userAnswer: string): Promise<{ correct: boolean; feedback: string; quote: string }>`. `vf`/`test`: comparación determinista, feedback = `q.explanation`, quote = `q.quote`. `desarrollo`/`practico`: LLM recibe el chunk y la respuesta; debe devolver `{correcta, feedback, cita}`; si la cita no pasa `verifyQuote`, se usa `q.quote` como cita y se marca el feedback como "sin verificar" (nunca se muestra una cita falsa).

- [ ] **Step 1: tests:** `vf correcto/incorrecto sin llamar al LLM`; `test compara opción elegida`; `desarrollo: cita válida del LLM se acepta`; `desarrollo: cita inventada → se sustituye por q.quote y feedback lleva marca 'sin verificar'`; `LLM falla → correct:false con mensaje de error legible, sin lanzar`.
- [ ] **Step 2:** FAIL. **Step 3:** Implementar. **Step 4:** PASS. **Step 5:** Commit `feat: grading with grounded feedback`.

### Task 9: IPC, preload y diagnóstico
**Files:** Create `src/main/index.ts`, `src/main/ipc.ts`, `src/preload/index.ts`; Test `tests/core/ipc-contract.test.ts` (tipos de canal).
**Interfaces:** Produces: `window.api` con métodos tipados: `subjects.list/create`, `notes.import(subjectId, kind: 'text'|'pdf'|'image')`, `notes.confirmOcr`, `notes.list`, `quiz.generate(req)` (emite progreso por evento), `quiz.cancel`, `quiz.submit(attemptId, questionId, answer)`, `history.list`, `system.health()`. El main abre la BD en `app.getPath('userData')/apuntes.sqlite`. `contextIsolation: true`, sin `nodeIntegration`.

- [ ] **Step 1:** Test: los nombres de canal exportados desde un único `channels.ts` coinciden entre `ipc.ts` y `preload` (evita deriva).
- [ ] **Step 2:** FAIL → implementar handlers que delegan en `src/core`; `system.health()` llama a `OllamaProvider.health()` con timeout de 3 s (Review Focus 5). **Step 3:** PASS. **Step 4:** `npm run dev`, abrir DevTools y comprobar `await window.api.system.health()` responde sin colgarse con Ollama apagado. **Step 5:** Commit `feat: ipc bridge and health check`.

### Task 10: UI — asignaturas, apuntes y diagnóstico
**Files:** Create `src/renderer/App.tsx`, `views/Subjects.tsx`, `views/Notes.tsx`, `views/Diagnostics.tsx`, `views/OcrReview.tsx`.
**Interfaces:** Consumes `window.api`. Produces: layout lateral con asignaturas; dentro de una, pestañas **Apuntes · Test · Ejercicios · Historial**.

- [ ] **Step 1:** Implementar crear/listar asignaturas, importar archivo/PDF/foto, lista de documentos y visor de fragmentos con id navegable (`#chunk-<id>`).
- [ ] **Step 2:** `OcrReview`: tras importar foto, mostrar texto OCR editable y botón "Confirmar y trocear"; aviso fijo sobre manuscrita.
- [ ] **Step 3:** `Diagnostics`: si `health().ok` es false, pantalla con el mensaje y pasos (instalar Ollama, `ollama pull qwen2.5:7b`), botón "Reintentar".
- [ ] **Step 4:** Verificar a mano con `npm run dev`: crear asignatura "Biología", importar el fixture, ver fragmentos; subir el PNG y corregir OCR. Evidencia: captura de pantalla.
- [ ] **Step 5:** Commit `feat: subjects and notes UI`.

### Task 11: UI — test interactivo y feedback
**Files:** Create `views/Quiz.tsx`, `components/QuestionCard.tsx`, `components/QuoteLink.tsx`, `views/History.tsx`.
**Interfaces:** Consumes `quiz.*`, `history.list`.

- [ ] **Step 1:** Formulario (tipo, nº de preguntas, documento/tema opcional) con barra de progreso y botón Cancelar.
- [ ] **Step 2:** `QuestionCard` por tipo (V/F, opciones, textarea); al enviar muestra corrección, `feedback` y `QuoteLink` ("ver en apuntes" abre el chunk).
- [ ] **Step 3:** Si `insufficient` o `discarded > 0`, mostrar aviso con razones (spec §3.4). **Step 4:** Historial por intento con nota.
- [ ] **Step 5:** Verificar a mano con Ollama real y el fixture: generar 5 V/F; cada pregunta enseña cita y el enlace abre el fragmento; pedir tema ausente ("física cuántica") → aviso "sin material suficiente". Commit `feat: interactive quiz UI`.

### Task 12: ejercicios prácticos
**Files:** Modify `src/core/generate.ts` (rama `practico`); Test `tests/core/generate.test.ts`; Create `views/Exercises.tsx`.
**Interfaces:** Consumes `generateQuestions` con `type: 'practico'`. Regla: solo se envían al modelo chunks que contengan dígitos o un patrón de fórmula/ejemplo (`=`, "ejemplo", "por ejemplo", números); sin ellos → `insufficient: true`.

- [ ] **Step 1: tests:** `practico con chunks sin datos numéricos → insufficient true y sin llamar al LLM`; `practico con chunk con ejemplo → pregunta con cita válida`.
- [ ] **Step 2:** FAIL → implementar filtro y prompt de práctico. **Step 3:** PASS. **Step 4:** Vista `Exercises` reutilizando `QuestionCard`. **Step 5:** Commit `feat: practical exercises`.

### Task 13: grafo de conceptos
**Files:** Create `src/core/graph.ts`; Test `tests/core/graph.test.ts`; `views/Concepts.tsx` (lista simple dentro de Apuntes).
**Interfaces:** Produces: `extractConcepts(deps: { llm; store }, subjectId: number): Promise<Array<{ term: string; chunkIds: number[]; related: string[] }>>`. Un concepto solo se conserva si `normalize(term)` aparece en el texto normalizado de cada chunk citado. Se usa para el selector de temas del Test (sustituye el `topic` libre).

- [ ] **Step 1: tests:** `descarta conceptos que no aparecen en el chunk`; `agrupa el mismo término en varios chunks`; `sin chunks → []`.
- [ ] **Step 2:** FAIL → implementar. **Step 3:** PASS. **Step 4:** Conectar selector de temas en `Quiz.tsx`. **Step 5:** Commit `feat: concept index`.
- [ ] **Step 6 (Graphify, desarrollo):** ejecutar `/graphify` sobre `src/` y `docs/` una vez terminada la tarea y guardar `graphify-out/` para consultar la arquitectura en tareas siguientes.

### Task 14: subida desde el móvil
**Files:** Create `src/core/mobile.ts`; Test `tests/core/mobile.test.ts`; `views/MobileUpload.tsx`.
**Interfaces:** Produces: `startUploadServer(opts: { onImage: (data: Buffer, filename: string) => Promise<void>; port?: number }): Promise<{ url: string; stop(): Promise<void> }>`. Página HTML mínima con `<input type="file" accept="image/*" capture="environment">`, `POST /upload`, token aleatorio en la URL, límite 15 MB, solo `image/*`, escucha en la IP LAN. Se apaga a los 10 min o con `stop()`.

- [ ] **Step 1: tests (HTTP real en puerto 0):** `POST con token correcto llama a onImage`; `sin token o token erróneo → 403 y onImage no se llama`; `archivo no imagen → 415`; `archivo >15 MB → 413`; `stop() cierra el puerto`.
- [ ] **Step 2:** FAIL → implementar con `http` nativo. **Step 3:** PASS.
- [ ] **Step 4:** Vista `MobileUpload`: botón "Subir desde el móvil" que arranca el servidor, muestra el QR (`qrcode`) y, al recibir la foto, abre `OcrReview` para esa asignatura.
- [ ] **Step 5:** Verificar a mano: abrir la URL desde el móvil en la misma wifi, hacer una foto de un apunte impreso, ver el texto OCR. Nota para el usuario: el cortafuegos de Windows pedirá permiso. Commit `feat: phone photo upload`.

### Task 15: verificación final y empaquetado
**Files:** Modify `package.json` (electron-builder), `README.md` (requisitos: Ollama, modelo).

- [ ] **Step 1:** `npm test` → todos PASS; `npm run build` sin errores de tipos.
- [ ] **Step 2:** Recorrido manual completo del spec §1 (criterios de éxito): citas visibles y enlazables, tema ausente, aislamiento entre dos asignaturas, foto PC y móvil.
- [ ] **Step 3:** `npx electron-builder --win dir` genera una app que arranca y abre la BD en `userData`.
- [ ] **Step 4:** Aplicar `superpowers:verification-before-completion` y reportar qué se verificó y qué no (p. ej. velocidad real en tu CPU).
- [ ] **Step 5:** Commit `chore: release build and docs`.

---

## Self-review
- **Cobertura del spec:** §3 → Tasks 1, 5, 8; §4 módulos → Tasks 2–7, 13, 14; §5 flujo → 10–11; §6 errores → 4, 6, 7, 9, 10; §7 pruebas → en cada task; REA no aparece porque no hay análisis de app externa (solo se activa si lo pides).
- **Tipos coherentes:** `Question`, `Chunk`, `Store`, `LlmProvider`, `verifyQuote` definidos en Tasks 1, 3, 4 y consumidos con la misma firma después.
- **Riesgo conocido:** las tareas 5 y 11 dependen de la calidad real del modelo local; los tests usan un LLM falso, así que la tasa de descarte con Ollama real solo se ve en la verificación manual.
