/**
 * Página estática que ve el móvil. Sin dependencias, sin recursos externos y sin manejadores inline:
 * el script y el estilo llevan el nonce de la respuesta, que es lo único que permite la CSP.
 * Todo el texto dinámico se escribe con textContent (nunca innerHTML).
 */
export function renderUploadPage(opts: { uploadPath: string; nonce: string; maxBytes: number }): string {
  const { uploadPath, nonce, maxBytes } = opts
  // uploadPath solo contiene `/u/<hex>/upload`; JSON.stringify lo deja entre comillas para el script.
  const script = `(function () {
  var UPLOAD = ${JSON.stringify(uploadPath)};
  var MAX = ${Math.trunc(maxBytes)};
  // Si el ordenador pide esperar (Retry-After: su cola de OCR está llena), se reenvía la misma foto; ~5 min como mucho.
  var REINTENTOS = 60;
  var camara = document.getElementById('foto');
  var galeria = document.getElementById('galeria');
  var estado = document.getElementById('estado');
  var barra = document.getElementById('barra');
  function decir(texto, clase) { estado.textContent = texto; estado.className = clase || ''; }
  function bloquear(si) { camara.disabled = si; galeria.disabled = si; barra.hidden = !si; }
  function esperar(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function nombre(f) { return f.name || 'foto'; }
  function subir(f, intento) {
    return fetch(UPLOAD, { method: 'POST', headers: { 'Content-Type': f.type || 'application/octet-stream', 'X-Filename': encodeURIComponent(nombre(f)) }, body: f })
      .then(function (r) {
        var espera = Number(r.headers.get('Retry-After'));
        if (r.status === 429 && espera > 0 && intento < REINTENTOS) {
          return esperar(espera * 1000).then(function () { return subir(f, intento + 1); });
        }
        return r.text().then(function (t) { return { ok: r.ok, texto: t }; });
      });
  }
  // Las fotos se envían de una en una: el ordenador las pasa por OCR en orden.
  function enviar(lista) {
    var fotos = Array.prototype.slice.call(lista || []);
    if (!fotos.length) return;
    var total = fotos.length, bien = 0, fallos = [];
    bloquear(true);
    var cadena = Promise.resolve();
    fotos.forEach(function (f, i) {
      cadena = cadena.then(function () {
        if (f.size > MAX) { fallos.push(nombre(f) + ': es demasiado grande (máximo ' + Math.round(MAX / 1048576) + ' MB)'); return; }
        decir(total > 1 ? 'Enviando foto ' + (i + 1) + ' de ' + total + '…' : 'Enviando la foto…');
        return subir(f, 0).then(function (r) {
          if (r.ok) bien++;
          else fallos.push(nombre(f) + ': ' + (r.texto || 'no se pudo enviar').replace(/\\.+$/, ''));
        });
      });
    });
    cadena
      .then(function () {
        if (!fallos.length) decir(total > 1 ? bien + ' fotos recibidas. Ya puedes enviar más.' : 'Foto recibida. Ya puedes hacer otra.', 'ok');
        else decir((bien ? bien + ' de ' + total + ' fotos recibidas. ' : '') + 'No se enviaron: ' + fallos.join('; ') + '.', 'error');
      }, function () {
        decir((bien ? bien + ' de ' + total + ' fotos recibidas. ' : '') + 'No se pudo conectar con el ordenador. Comprueba que sigas en la misma wifi y que la subida siga activa.', 'error');
      })
      .then(function () { bloquear(false); camara.value = ''; galeria.value = ''; });
  }
  camara.addEventListener('change', function () { enviar(camara.files); });
  galeria.addEventListener('change', function () { enviar(galeria.files); });
})();`

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Enviar foto de apuntes</title>
<style nonce="${nonce}">
body{font:18px/1.45 system-ui,sans-serif;margin:0;padding:1.25rem;max-width:34rem;margin-inline:auto;color:#1b1b1b;background:#fff}
h1{font-size:1.4rem;margin:0 0 .5rem}
p{margin:.5rem 0}
label{display:block;font-weight:600;margin-top:1rem}
input[type=file]{display:block;width:100%;margin:.4rem 0 1rem;padding:1rem;font-size:1rem;border:2px dashed #555;border-radius:.6rem;box-sizing:border-box}
progress{width:100%}
#estado{min-height:1.5rem;font-weight:600}
#estado.ok{color:#116611}
#estado.error{color:#a01010}
.pie{font-size:.85rem;color:#555;margin-top:2rem}
</style>
</head>
<body>
<h1>Enviar foto de apuntes</h1>
<p>Haz una foto del apunte o elige varias de la galería. Se envían solo a tu ordenador, por esta wifi.</p>
<label for="foto">Hacer una foto</label>
<input id="foto" type="file" accept="image/*" capture="environment">
<label for="galeria">Elegir varias de la galería</label>
<input id="galeria" type="file" accept="image/*" multiple>
<progress id="barra" hidden></progress>
<p id="estado" role="status" aria-live="polite"></p>
<p class="pie">Esta conexión no está cifrada (HTTP): la foto viaja sin cifrar por tu wifi. Úsala solo en redes wifi de confianza.</p>
<script nonce="${nonce}">${script}</script>
</body>
</html>
`
}
