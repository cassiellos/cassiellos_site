import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Mini CRM Cassiellos | Agendamentos e gestão comercial',
  description: 'Informações sobre o Mini CRM Cassiellos, seu fluxo de agendamentos com Google Calendar e a proteção dos dados de usuários.',
  alternates: { canonical: '/mini-crm' },
}

export default function MiniCrmInformationPage() {
  return (
    <main className="legalPage">
      <div className="legalWrap">
        <a className="legalBack" href="/">← Voltar à Cassiellos</a>
        <span className="tag">Solução administrativa · Cassiellos</span>
        <h1>Mini CRM Cassiellos</h1>
        <p className="legalUpdated">Gestão comercial, acompanhamento de leads e agendamento de reuniões com segurança.</p>
        <div className="legalContent">
          <section>
            <h2>Sobre a aplicação</h2>
            <p>O Mini CRM Cassiellos é uma ferramenta de uso administrativo da Cassiellos para organizar solicitações comerciais, acompanhar oportunidades, registrar atividades e gerenciar reuniões de diagnóstico com potenciais clientes. O acesso aos dados internos requer autenticação de administrador.</p>
          </section>
          <section>
            <h2>Como funciona o agendamento</h2>
            <p>Após uma solicitação de reunião, a aplicação utiliza o Google Calendar autorizado pelo administrador para consultar a disponibilidade por intervalos ocupados, identificar horários livres e criar o compromisso escolhido. O Google Calendar pode enviar o convite ao e-mail informado pelo participante e gerar um link para reunião por Google Meet.</p>
            <p>Somente o administrador conecta a conta Google. Participantes não precisam conceder acesso ao próprio Google Calendar e não têm acesso à agenda interna da Cassiellos.</p>
          </section>
          <section>
            <h2>Permissões solicitadas ao Google</h2>
            <ul>
              <li><strong>Disponibilidade (<code>calendar.freebusy</code>):</strong> consultar intervalos livres ou ocupados para evitar conflitos de horário.</li>
              <li><strong>Eventos próprios (<code>calendar.events.owned</code>):</strong> criar eventos no calendário de propriedade do administrador, vinculados aos agendamentos solicitados.</li>
            </ul>
            <p>A integração utiliza OAuth 2.0 e armazena o token de atualização criptografado. Não solicitamos acesso ao conteúdo do Gmail ou do Google Drive.</p>
          </section>
          <section>
            <h2>Privacidade, transparência e contato</h2>
            <p>O tratamento de dados do Google é limitado às finalidades informadas. Informações detalhadas sobre dados acessados, armazenamento, compartilhamento, revogação da autorização e uso limitado estão disponíveis na nossa <a href="/politica-de-privacidade">Política de Privacidade</a>.</p>
            <p>Consulte também os <a href="/termos-de-uso">Termos de Uso</a>. Para dúvidas relacionadas à privacidade, entre em contato pelo e-mail <a href="mailto:contato@agenciacassiellos.com.br">contato@agenciacassiellos.com.br</a>.</p>
          </section>
        </div>
      </div>
    </main>
  )
}
