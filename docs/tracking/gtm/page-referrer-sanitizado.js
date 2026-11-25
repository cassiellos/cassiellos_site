function () {
  // Variável "JS | page_referrer sanitizado" (GTM, JavaScript personalizado). Origem + caminho, sem consulta nem fragmento
  // (o referenciador pode trazer tokens de redirecionamento ou dados pessoais). Espelha ga4PageReferrer.
  var ref = document.referrer;
  if (!ref) { return undefined; }
  var match = /^(https?:\/\/[^\/?#]+)([^?#]*)/i.exec(ref);
  return match ? match[1].toLowerCase() + match[2] : undefined;
}
