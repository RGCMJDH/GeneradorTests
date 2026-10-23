// Hook afterPack de electron-builder: la app empaquetada NO se da por buena si los datos de idioma
// de resources/tessdata faltan o no coinciden con scripts/tessdata.sha256.json.
const { join } = require('node:path')
const { readFileSync } = require('node:fs')

exports.default = async function afterPack(context) {
  const { verifyBundle } = await import('./tessdata-lib.mjs')
  const hashes = JSON.parse(readFileSync(join(__dirname, 'tessdata.sha256.json'), 'utf8'))
  const problems = verifyBundle(join(context.appOutDir, 'resources', 'tessdata'), hashes, ['spa', 'eng'])
  if (problems.length) {
    throw new Error('Datos de idioma ausentes o corruptos en el paquete (ejecuta «npm run pack»):\n  ' + problems.join('\n  '))
  }
}
