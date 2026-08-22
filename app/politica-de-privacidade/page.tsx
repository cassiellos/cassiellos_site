import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Política de Privacidade | Cassiellos' }

export default function PrivacyPage() {
  return (
    <main className="legalPage"><div className="legalWrap">
      <a className="legalBack" href="/">← Voltar para o site</a><span className="tag">Transparência e LGPD</span>
      <h1>Política de Privacidade</h1><p className="legalUpdated">Última atualização: 22 de agosto de 2026.</p>
      <div className="legalContent">
        <section><h2>1. Quem somos</h2><p>A Cassiellos é uma empresa de operações criativas sediada em Belo Horizonte, Minas Gerais. Esta política explica como tratamos dados pessoais recebidos pelo site cassiellos.com.br e por nossos canais de atendimento.</p></section>
        <section><h2>2. Dados que podemos coletar</h2><ul><li>dados de contato fornecidos voluntariamente, como nome, telefone, e-mail, empresa e cargo;</li><li>informações enviadas durante conversas, diagnósticos e solicitações comerciais;</li><li>dados técnicos de navegação, como dispositivo, navegador, páginas visitadas, origem do acesso e eventos de interação;</li><li>informações relacionadas a campanhas publicitárias, quando houver consentimento ou outra base legal aplicável.</li></ul></section>
        <section><h2>3. Como utilizamos os dados</h2><p>Utilizamos as informações para responder contatos, realizar diagnósticos, elaborar propostas, prestar e aprimorar serviços, proteger o site, medir desempenho, cumprir obrigações legais e aperfeiçoar nossas comunicações e campanhas.</p></section>
        <section><h2>4. Bases legais</h2><p>O tratamento pode ocorrer mediante consentimento, execução de procedimentos preliminares ou contrato, cumprimento de obrigação legal, exercício regular de direitos e legítimo interesse, sempre com avaliação de necessidade e proteção dos titulares.</p></section>
        <section><h2>5. Compartilhamento</h2><p>Os dados podem ser processados por fornecedores de hospedagem, análise, publicidade, atendimento, automação e armazenamento utilizados pela Cassiellos. Compartilhamos somente o necessário para cada finalidade e exigimos medidas adequadas de segurança e confidencialidade.</p></section>
        <section><h2>6. Armazenamento e segurança</h2><p>Adotamos controles técnicos e organizacionais compatíveis com a natureza dos dados. As informações são mantidas pelo período necessário às finalidades informadas, ao cumprimento de obrigações legais ou ao exercício de direitos.</p></section>
        <section><h2>7. Direitos do titular</h2><p>Nos termos da Lei nº 13.709/2018, você pode solicitar confirmação de tratamento, acesso, correção, anonimização, bloqueio, eliminação, portabilidade, informação sobre compartilhamento, revisão de consentimento e oposição quando aplicável.</p></section>
        <section><h2>8. Contato</h2><p>Solicitações sobre privacidade podem ser enviadas para <a href="mailto:contato@agenciacassiellos.com.br">contato@agenciacassiellos.com.br</a>. Poderemos solicitar informações adicionais para confirmar a identidade do solicitante.</p></section>
        <section><h2>9. Atualizações</h2><p>Esta política pode ser atualizada para refletir mudanças legais, tecnológicas ou operacionais. A versão vigente permanecerá publicada nesta página com a data da última atualização.</p></section>
      </div>
    </div></main>
  )
}
