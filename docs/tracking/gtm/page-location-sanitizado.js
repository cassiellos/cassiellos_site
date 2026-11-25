function () {
  // Variável "JS | page_location sanitizado" (GTM, tipo JavaScript personalizado). Texto espelhado em
  // lib/privacy/url-sanitize.ts (ga4PageLocation) e conferido por lib/privacy/ga4-page-location.test.ts.
  // Mantém origem + caminho e SOMENTE as chaves de atribuição válidas. Remove fbclid, gclid, msclkid, _gl, qualquer outro
  // parâmetro, o fragmento e todo valor com formato de dado pessoal (telefone, CPF, CNPJ, CEP, IP, URL, código opaco, e-mail). Parâmetro repetido: vale o primeiro.
  var ALLOW_GOOGLE_CLICK_IDS = false; // futuro: ligar só com consentimento de anúncios do Google (ver padrao-utm-v2.md, seção 6.4)
  var UTM = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
  var EXT = ['utm_id', 'utm_source_platform', 'adset_id', 'ad_id', 'placement'];
  var GOOGLE = ['gclid', 'gbraid', 'wbraid', 'gad_source', 'gad_campaignid'];
  var loc = window.location;
  if (loc.protocol !== 'https:' && loc.protocol !== 'http:') { return loc.href; }
  function first(name) {
    var query = (loc.search || '').replace(/^\?/, '');
    if (!query) { return null; }
    var parts = query.split('&');
    for (var i = 0; i < parts.length; i++) {
      var eq = parts[i].indexOf('=');
      var key = eq < 0 ? parts[i] : parts[i].slice(0, eq);
      try { key = decodeURIComponent(key.replace(/\+/g, ' ')); } catch (e) { continue; }
      if (key === name) {
        var value = eq < 0 ? '' : parts[i].slice(eq + 1);
        try { return decodeURIComponent(value.replace(/\+/g, ' ')); } catch (e2) { return null; }
      }
    }
    return null;
  }
  var ID_KEYS = 'cid|agid|asid|adid|ad|adset|cmp';
  var KEYED_ID = new RegExp('(^|[^a-z0-9])(?:' + ID_KEYS + ')-\\d{6,20}(?!\\d)', 'gi');
  var PLATFORM_ID = new RegExp('^(?:\\d{15,20}|(?:' + ID_KEYS + ')-\\d{8,20})$');
  var TOKEN = /^[A-Za-z][A-Za-z0-9_.-]{0,39}$/;
  var KNOWN_SOURCES = ['meta', 'facebook', 'instagram', 'google', 'whatsapp', 'email', 'site', 'direct', 'youtube', 'linkedin', 'tiktok', 'bing'];
  var KNOWN_MEDIUMS = ['paid_social', 'cpc', 'organic_social', 'referral', 'email', 'messaging', 'organic', 'social', 'display', 'video'];
  function known(list, text) { for (var k = 0; k < list.length; k++) { if (list[k] === text) { return true; } } return false; }
  var EMAIL = /[^\s@\/?#&=]+@[^\s@\/?#&=]+\.[a-z]{2,}/i;
  function basic(value) {
    if (typeof value !== 'string') { return ''; }
    var text = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/^\s+|\s+$/g, '');
    if (!text || text.indexOf('@') >= 0 || EMAIL.test(text) || /%40/i.test(text)) { return ''; }
    return text.slice(0, 200);
  }
  // Dados pessoais reconhecíveis por formato (F4): telefone, CPF, CNPJ, CEP, IP, URL, código opaco, sequência numérica sem chave de ID.
  function personal(text) {
    var rest = text.replace(KEYED_ID, '$1 ');
    if (/https?:|www\.|:\/\/|^\/\//i.test(rest) || /(?:^|\D)\d{1,3}(?:\.\d{1,3}){3}(?:\D|$)/.test(rest) || /(?=[A-Za-z0-9]*\d)(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{32,}/.test(rest) || /(?:^|\D)\d{9,14}(?:\D|$)|\d{21,}/.test(rest) || /\d{5}-\d{3,4}/.test(rest)) { return true; }
    var seq = rest.match(/\+?\d(?:[ ().\/-]{0,2}\d)*/g) || [];
    for (var s = 0; s < seq.length; s++) { if (!/^\+?\d+$/.test(seq[s]) && seq[s].replace(/\D/g, '').length >= 10) { return true; } }
    return false;
  }
  function clean(value) { var text = basic(value); return text && !personal(text) ? text : ''; }
  function utm(key, value) {
    var text = clean(value);
    if (!text) { return ''; }
    if (key === 'utm_source') { return known(KNOWN_SOURCES, text) || TOKEN.test(text) ? text : ''; }
    if (key === 'utm_medium') { return known(KNOWN_MEDIUMS, text) || TOKEN.test(text) ? text : ''; }
    return text;
  }
  function ext(key, value) {
    var base = basic(value);
    if (!base) { return ''; }
    if (key === 'utm_id' || key === 'adset_id' || key === 'ad_id') { return PLATFORM_ID.test(base) ? base : ''; }
    if (key === 'utm_source_platform') { var lower = base.toLowerCase(); return /^[a-z][a-z0-9_-]{1,29}$/.test(lower) ? lower : ''; }
    if (key === 'placement') { return /^[A-Za-z][A-Za-z0-9 _.-]{1,59}$/.test(base) && !personal(base) ? base : ''; }
    return '';
  }
  function enc(text) {
    // Mesma codificação de URLSearchParams.toString(): espaço vira "+", o resto como application/x-www-form-urlencoded.
    return encodeURIComponent(text).replace(/%20/g, '+').replace(/[!'()~]/g, function (c) { return '%' + c.charCodeAt(0).toString(16).toUpperCase(); });
  }
  var pairs = [];
  var i;
  for (i = 0; i < UTM.length; i++) { var u = utm(UTM[i], first(UTM[i])); if (u) { pairs.push(UTM[i] + '=' + enc(u.slice(0, 180))); } }
  for (i = 0; i < EXT.length; i++) { var e = ext(EXT[i], first(EXT[i])); if (e) { pairs.push(EXT[i] + '=' + enc(e)); } }
  if (ALLOW_GOOGLE_CLICK_IDS) {
    for (i = 0; i < GOOGLE.length; i++) { var g = first(GOOGLE[i]); if (g && /^[A-Za-z0-9_-]{6,200}$/.test(g)) { pairs.push(GOOGLE[i] + '=' + enc(g)); } }
  }
  return loc.protocol + '//' + loc.host + loc.pathname + (pairs.length ? '?' + pairs.join('&') : '');
}
