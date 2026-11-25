function () {
  // Variável "JS | atribuição <chave>" (GTM, JavaScript personalizado). Cole três vezes, mudando SÓ a linha KEY para
  // adset_id, ad_id e placement. Devolve o valor da URL no mesmo formato estrito usado no cadastro, ou undefined.
  var KEY = 'adset_id';
  var query = (window.location.search || '').replace(/^\?/, '');
  var raw = null;
  var parts = query ? query.split('&') : [];
  for (var i = 0; i < parts.length && raw === null; i++) {
    var eq = parts[i].indexOf('=');
    var name = eq < 0 ? parts[i] : parts[i].slice(0, eq);
    try { name = decodeURIComponent(name.replace(/\+/g, ' ')); } catch (e) { continue; }
    if (name === KEY) {
      try { raw = decodeURIComponent((eq < 0 ? '' : parts[i].slice(eq + 1)).replace(/\+/g, ' ')); } catch (e2) { return undefined; }
    }
  }
  if (typeof raw !== 'string') { return undefined; }
  var text = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/^\s+|\s+$/g, '').slice(0, 200);
  if (!text || /[^\s@\/?#&=]+@[^\s@\/?#&=]+\.[a-z]{2,}/i.test(text) || /%40/i.test(text)) { return undefined; }
  if (KEY === 'adset_id' || KEY === 'ad_id') { return /^(?:\d{15,20}|[a-z]{1,8}-\d{8,20})$/.test(text) ? text : undefined; }
  if (KEY === 'placement') { return /^[A-Za-z][A-Za-z0-9 _.-]{1,59}$/.test(text) ? text : undefined; }
  return undefined;
}
