import { open, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { createWorker } from 'tesseract.js'

export interface OcrOptions {
  /** Origen de los datos de idioma (por defecto el CDN de tesseract.js, solo para desarrollo/tests). */
  langPath?: string
  /** Carpeta donde se cachean los .traineddata; la app de Electron la apunta a userData. */
  cachePath?: string
  /** Idiomas de Tesseract, por defecto 'spa+eng'. */
  langs?: string
}

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
  if (read < 4 || !looksLikeImage(head)) fail('no es una imagen válida (usa PNG, JPG, BMP, GIF, TIFF o WebP)')
}

/** Reconoce el texto de una imagen. Siempre termina el worker, también si falla. */
export async function ocrImage(path: string, opts: OcrOptions = {}): Promise<string> {
  await assertReadableImage(path)
  const name = basename(path)
  const worker = await createWorker((opts.langs ?? 'spa+eng').split('+'), 1, {
    ...(opts.langPath ? { langPath: opts.langPath } : {}),
    ...(opts.cachePath ? { cachePath: opts.cachePath } : {}),
    // Sin errorHandler tesseract.js relanza el error del worker como excepción no capturada
    // (tumbaría el proceso principal); la promesa de recognize() ya se rechaza por su cuenta.
    errorHandler: () => undefined
  })
  try {
    const { data } = await worker.recognize(path)
    return data.text.replace(/\r\n?/g, '\n').trim()
  } catch (e) {
    throw new Error(`No se pudo reconocer el texto de «${name}»: ${e instanceof Error ? e.message : String(e)}.`)
  } finally {
    await worker.terminate().catch(() => undefined)
  }
}
