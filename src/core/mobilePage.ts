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
  var input = document.getElementById('foto');
  var estado = document.getElementById('estado');
  var barra = document.getElementById('barra');
  function decir(texto, clase) { estado.textContent = texto; estado.className = clase || ''; }
  function fin() { barra.hidden = true; input.disabled = false; input.value = ''; }
  input.addEventListener('change', function () {
    var f = input.files && input.files[0];
    if (!f) return;
    if (f.size > MAX) { decir('La foto es demasiado grande (máximo ' + Math.round(MAX / 1048576) + ' MB).', 'error'); input.value = ''; return; }
    decir('Enviando la foto…'); barra.hidden = false; input.disabled = true;
    fetch(UPLOAD, { method: 'POST', headers: { 'Content-Type': f.type || 'application/octet-stream', 'X-Filename': encodeURIComponent(f.name || 'foto') }, body: f })
      .then(function (r) { return r.text().then(function (t) { return { ok: r.ok, texto: t }; }); })
      .then(function (r) { decir(r.ok ? (r.texto || 'Foto recibida') + '. Ya puedes hacer otra.' : (r.texto || 'No se pudo enviar la foto.'), r.ok ? 'ok' : 'error'); })
      .catch(function () { decir('No se pudo conectar con el ordenador. Comprueba que sigas en la misma wifi y que la subida siga activa.', 'error'); })
      .then(fin);
  });
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
input[type=file]{display:block;width:100%;margin:1rem 0;padding:1rem;font-size:1rem;border:2px dashed #555;border-radius:.6rem;box-sizing:border-box}
progress{width:100%}
#estado{min-height:1.5rem;font-weight:600}
#estado.ok{color:#116611}
#estado.error{color:#a01010}
.pie{font-size:.85rem;color:#555;margin-top:2rem}
</style>
</head>
<body>
<h1>Enviar foto de apuntes</h1>
<p>Haz una foto del apunte (o elige una de la galería). Se enviará solo a tu ordenador, por esta wifi.</p>
<input id="foto" type="file" accept="image/*" capture="environment" aria-label="Hacer o elegir una foto">
<progress id="barra" hidden></progress>
<p id="estado" role="status" aria-live="polite"></p>
<p class="pie">Esta conexión no está cifrada (HTTP): la foto viaja sin cifrar por tu wifi. Úsala solo en redes wifi de confianza.</p>
<script nonce="${nonce}">${script}</script>
</body>
</html>
`
}
