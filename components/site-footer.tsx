export default function SiteFooter() {
  return (
    <footer className="foot">
      <div className="wrap footin">
        <div className="footerBrand"><span className="footerMark">∞</span><strong>Cassiellos</strong></div>
        <nav className="footerLegal" aria-label="Políticas e termos">
          <a href="/politica-de-privacidade">Privacidade</a>
          <a href="/termos-de-uso">Termos de Uso</a>
          <a href="/politica-de-cookies">Cookies</a>
        </nav>
        <div className="footerMeta">
          <span>Operações criativas · Belo Horizonte / MG</span>
          <span>© 2026</span>
        </div>
      </div>
    </footer>
  )
}
