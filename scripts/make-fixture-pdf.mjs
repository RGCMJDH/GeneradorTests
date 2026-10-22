// Genera los PDF de prueba de tests/fixtures (PDF mínimo escrito a mano, Helvetica + WinAnsi).
// Uso: node scripts/make-fixture-pdf.mjs
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures')

function buildPdf(contentText) {
  const content = contentText // latin1 == WinAnsi para los caracteres usados
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
  ]
  let out = '%PDF-1.4\n'
  const offsets = []
  objs.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'))
    out += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = Buffer.byteLength(out, 'latin1')
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

mkdirSync(outDir, { recursive: true })
writeFileSync(
  join(outDir, 'apuntes.pdf'),
  buildPdf('BT /F1 14 Tf 50 780 Td (La mitocondria produce ATP mediante la fosforilaci\\363n oxidativa.) Tj ET')
)
writeFileSync(join(outDir, 'sin-texto.pdf'), buildPdf('0.8 g 50 700 200 100 re f'))
console.log('PDF de prueba generados en', outDir)
