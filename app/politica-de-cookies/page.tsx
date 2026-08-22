import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Política de Cookies | Cassiellos' }

export default function CookiesPage() {
  return (
    <main className="legalPage"><div className="legalWrap">
      <a className="legalBack" href="/">← Voltar para o site</a><span className="tag">Tecnologias de navegação</span>
      <h1>Política de Cookies</h1><p className="legalUpdated">Última atualização: 22 de agosto de 2026.</p>
      <div className="legalContent">
        <section><h2>1. O que são cookies</h2><p>Cookies são pequenos arquivos ou identificadores utilizados por sites e serviços digitais para manter funcionalidades, lembrar preferências, compreender a navegação e medir resultados.</p></section>
        <section><h2>2. Categorias utilizadas</h2><ul><li><strong>necessários:</strong> sustentam segurança, navegação e funcionamento técnico;</li><li><strong>desempenho e análise:</strong> ajudam a entender páginas visitadas, origem do acesso e qualidade da experiência;</li><li><strong>publicidade:</strong> podem medir campanhas, limitar repetições e apoiar anúncios mais relevantes quando essas tecnologias estiverem habilitadas.</li></ul></section>
        <section><h2>3. Tecnologias de terceiros</h2><p>Podemos utilizar serviços de hospedagem, análise e publicidade, incluindo soluções da Vercel e do Google. Esses fornecedores podem tratar informações conforme suas próprias políticas e configurações de privacidade.</p></section>
        <section><h2>4. Controle pelo usuário</h2><p>Você pode excluir ou bloquear cookies nas configurações do navegador. O bloqueio de tecnologias necessárias pode afetar algumas funcionalidades. Quando uma ferramenta exigir consentimento específico, apresentaremos controles adequados antes da ativação.</p></section>
        <section><h2>5. Dados e direitos</h2><p>Informações associadas a identificadores digitais são tratadas conforme nossa <a href="/politica-de-privacidade">Política de Privacidade</a> e a legislação aplicável.</p></section>
        <section><h2>6. Contato</h2><p>Dúvidas podem ser encaminhadas para <a href="mailto:contato@agenciacassiellos.com.br">contato@agenciacassiellos.com.br</a>.</p></section>
      </div>
    </div></main>
  )
}
