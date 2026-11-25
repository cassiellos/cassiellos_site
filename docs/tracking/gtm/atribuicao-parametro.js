function () {
  // Variável "JS | atribuição <chave>" (GTM, JavaScript personalizado). Cole três vezes, mudando SÓ a linha KEY para
  // adset_id, ad_id e placement. Devolve o valor da URL no mesmo formato estrito usado no cadastro, ou undefined.
  // Espelha sanitizeExtendedValue (lib/privacy/url-sanitize.ts); conferida por lib/privacy/ga4-page-location.test.ts.
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
  if (!text || text.indexOf('@') >= 0 || /[^\s@\/?#&=]+@[^\s@\/?#&=]+\.[a-z]{2,}/i.test(text) || /%40/i.test(text)) { return undefined; }
  if (KEY === 'adset_id' || KEY === 'ad_id') { return /^(?:\d{15,20}|(?:cid|agid|asid|adid|ad|adset|cmp)-\d{8,20})$/.test(text) ? text : undefined; }
  if (KEY === 'placement') {
    if (!/^[A-Za-z][A-Za-z0-9 _.-]{1,59}$/.test(text)) { return undefined; }
    // Mesmo filtro de dados pessoais do page_location (F4): IDs com chave explícita são retirados antes dos testes.
    var rest = text.replace(/(^|[^a-z0-9])(?:cid|agid|asid|adid|ad|adset|cmp)-\d{6,20}(?!\d)/gi, '$1 ');
    if (/https?:|www\.|:\/\/|^\/\//i.test(rest) || /(?:^|\D)\d{1,3}(?:\.\d{1,3}){3}(?:\D|$)/.test(rest) || /(?=[A-Za-z0-9]*\d)(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{32,}/.test(rest) || /(?:^|\D)\d{9,14}(?:\D|$)|\d{21,}/.test(rest) || /\d{5}-\d{3,4}/.test(rest)) { return undefined; }
    var seq = rest.match(/\+?\d(?:[ ().\/-]{0,2}\d)*/g) || [];
    for (var s = 0; s < seq.length; s++) { if (!/^\+?\d+$/.test(seq[s]) && seq[s].replace(/\D/g, '').length >= 10) { return undefined; } }
    return text;
  }
  return undefined;
}
