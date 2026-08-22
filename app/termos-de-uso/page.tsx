import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Termos de Uso | Cassiellos' }

export default function TermsPage() {
  return (
    <main className="legalPage"><div className="legalWrap">
      <a className="legalBack" href="/">← Voltar para o site</a><span className="tag">Condições de acesso</span>
      <h1>Termos de Uso</h1><p className="legalUpdated">Última atualização: 22 de agosto de 2026.</p>
      <div className="legalContent">
        <section><h2>1. Aceitação</h2><p>Ao acessar cassiellos.com.br, você declara que leu e concorda com estes Termos de Uso e com a Política de Privacidade. Caso não concorde, interrompa a navegação.</p></section>
        <section><h2>2. Finalidade do site</h2><p>O site apresenta a Cassiellos, sua atuação, metodologia e canais de contato. As informações possuem caráter institucional e comercial. Condições específicas de serviços serão formalizadas em proposta ou contrato próprio.</p></section>
        <section><h2>3. Uso permitido</h2><p>Você se compromete a utilizar o site de forma lícita, sem tentar comprometer sua segurança, disponibilidade ou integridade, coletar dados indevidamente, disseminar códigos maliciosos ou praticar atos que violem direitos de terceiros.</p></section>
        <section><h2>4. Propriedade intelectual</h2><p>Marcas, logotipos, textos, interfaces, sistemas visuais, métodos, ilustrações, vídeos e demais conteúdos pertencem à Cassiellos ou são utilizados mediante autorização. A reprodução, adaptação ou exploração comercial depende de autorização prévia e expressa.</p></section>
        <section><h2>5. Informações e resultados</h2><p>Empregamos cuidado na apresentação das informações, mas conteúdos podem ser atualizados. Exemplos, processos e resultados dependem do contexto de cada projeto e não representam garantia automática de desempenho futuro.</p></section>
        <section><h2>6. Links e serviços externos</h2><p>O site pode direcionar para WhatsApp, plataformas de hospedagem, análise ou outros serviços. Esses ambientes possuem termos e políticas próprios, pelos quais seus respectivos responsáveis respondem.</p></section>
        <section><h2>7. Disponibilidade</h2><p>Buscamos manter o site seguro e acessível, mas podem ocorrer interrupções para manutenção, atualização ou por fatores fora do nosso controle.</p></section>
        <section><h2>8. Legislação e contato</h2><p>Estes termos são regidos pela legislação brasileira. Dúvidas podem ser enviadas para <a href="mailto:contato@agenciacassiellos.com.br">contato@agenciacassiellos.com.br</a>.</p></section>
      </div>
    </div></main>
  )
}
