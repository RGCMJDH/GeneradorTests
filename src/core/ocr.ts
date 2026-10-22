import { open, readFile, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { createWorker } from 'tesseract.js'

export interface OcrOptions {
  /** Origen de los datos de idioma (por defecto el CDN de tesseract.js, solo para desarrollo/tests). */
  langPath?: string
  /** Carpeta donde se cachean los .traineddata; la app de Electron la apunta a userData. */
  cachePath?: string
  /** Idiomas de Tesseract, por defecto 'spa+eng'. */
  langs?: string
  /** Tiempo máximo (ms) para cargar el motor y los datos de idioma; por defecto 120 s (la primera vez se descargan ~20 MB). */
  timeoutMs?: number
  /** Tiempo máximo (ms) para reconocer el texto una vez cargado el motor; por defecto 180 s. */
  recognizeTimeoutMs?: number
}

const DEFAULT_LOAD_TIMEOUT_MS = 120_000
const DEFAULT_RECOGNIZE_TIMEOUT_MS = 180_000

const startsWith = (b: Buffer, sig: number[], at = 0): boolean => sig.every((v, i) => b[at + i] === v)

/** Cabeceras de los formatos que Tesseract/Leptonica sabe leer (PNG, JPEG, GIF, BMP, TIFF, WebP). */
function looksLikeImage(b: Buffer): boolean {
  return (
    startsWith(b, [0x89, 0x50, 0x4e, 0x47]) ||
    startsWith(b, [0xff, 0xd8, 0xff]) ||
    startsWith(b, [0x47, 0x49, 0x46, 0x38]) ||
    startsWith(b, [0x42, 0x4d]) ||
    startsWith(b, [0x49, 0x49, 0x2a, 0x00]) ||
    startsWith(b, [0x4d, 0x4d, 0x00, 0x2a]) ||
    (startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8))
  )
}

/** Contenedor ISO-BMFF de HEIC/HEIF: caja 'ftyp' en los bytes 4-8 y marca en los 8-12. */
function isHeic(b: Buffer): boolean {
  return startsWith(b, [0x66, 0x74, 0x79, 0x70], 4) && ['heic', 'heix', 'hevc', 'mif1', 'heif'].includes(b.toString('latin1', 8, 12))
}

/** Valida existencia y formato ANTES de arrancar el worker (que es caro y puede descargar datos de idioma). */
async function assertReadableImage(path: string): Promise<void> {
  const name = basename(path)
  const fail = (why: string): never => {
    throw new Error(`No se pudo leer la imagen «${name}»: ${why}.`)
  }
  let isFile: boolean
  try {
    isFile = (await stat(path)).isFile()
  } catch (e) {
    return fail((e as NodeJS.ErrnoException).code === 'ENOENT' ? 'el archivo no existe' : (e as Error).message)
  }
  if (!isFile) return fail('no es un archivo')
  const head = Buffer.alloc(12)
  let read = 0
  try {
    const fh = await open(path, 'r')
    try {
      read = (await fh.read(head, 0, head.length, 0)).bytesRead
    } finally {
      await fh.close()
    }
  } catch (e) {
    return fail((e as Error).message)
  }
  if (read >= 12 && isHeic(head)) throw new Error('Formato HEIC/HEIF no soportado: exporta la foto como JPG o PNG.')
  if (read < 4 || !looksLikeImage(head)) fail('no es una imagen válida (usa PNG, JPG, BMP, GIF, TIFF o WebP)')
}

type Worker = Awaited<ReturnType<typeof createWorker>>

const LANG_DATA_ERROR =
  'No se pudieron cargar los datos de idioma del OCR (¿sin conexión?). Revisa tu conexión o la carpeta de caché.'

/**
 * Crea el worker con espera acotada. tesseract.js solo rechaza la promesa si falla el arranque del motor;
 * si fallan los datos de idioma, el error llega únicamente a `errorHandler` y la promesa no se resuelve nunca.
 */
async function startWorker(opts: OcrOptions): Promise<Worker> {
  let failFirst: (e: Error) => void = () => undefined
  const firstError = new Promise<never>((_, reject) => {
    failFirst = reject
  })
  const creating = createWorker((opts.langs ?? 'spa+eng').split('+'), 1, {
    ...(opts.langPath ? { langPath: opts.langPath } : {}),
    ...(opts.cachePath ? { cachePath: opts.cachePath } : {}),
    // Sin errorHandler tesseract.js relanza el error del worker como excepción no capturada
    // (tumbaría el proceso principal): se registra el primero y se usa para abortar la espera.
    errorHandler: (e: unknown) => failFirst(new Error(String(e)))
  })
  let timer: NodeJS.Timeout | undefined
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('tiempo de espera agotado')), opts.timeoutMs ?? DEFAULT_LOAD_TIMEOUT_MS)
  })
  try {
    return await Promise.race([creating, firstError, timedOut])
  } catch (e) {
    // Si la carrera se pierde pero el worker llega a crearse más tarde, se cierra para no filtrarlo.
    creating.then((w) => w.terminate()).catch(() => undefined)
    throw new Error(`${LANG_DATA_ERROR} (${e instanceof Error ? e.message : String(e)})`)
  } finally {
    clearTimeout(timer)
  }
}

/** Reconoce el texto de una imagen. Siempre termina el worker, también si falla. */
export async function ocrImage(path: string, opts: OcrOptions = {}): Promise<string> {
  await assertReadableImage(path)
  const name = basename(path)
  const worker = await startWorker(opts)
  const limit = opts.recognizeTimeoutMs ?? DEFAULT_RECOGNIZE_TIMEOUT_MS
  let timer: NodeJS.Timeout | undefined
  try {
    // Se pasan los bytes (no la ruta): así tesseract.js no hace E/S asíncrona antes de enviar el trabajo
    // y terminar el worker por plazo no puede cruzarse con ese envío (daría un rechazo sin capturar interno).
    const recognizing = worker.recognize(await readFile(path))
    recognizing.catch(() => undefined) // si gana el temporizador, el rechazo tardío no debe quedar sin capturar
    const timedOut = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`El OCR tardó demasiado con «${name}» (más de ${Math.round(limit / 1000)} s). Prueba con una imagen más pequeña.`)),
        limit
      )
    })
    const { data } = await Promise.race([recognizing, timedOut])
    return data.text.replace(/\r\n?/g, '\n').trim()
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('El OCR tardó demasiado')) throw e
    throw new Error(`No se pudo reconocer el texto de «${name}»: ${e instanceof Error ? e.message : String(e)}.`)
  } finally {
    clearTimeout(timer)
    await worker.terminate().catch(() => undefined)
  }
}
