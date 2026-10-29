import type { Metadata } from 'next'
import { LEGAL_CONTROLLER, formatPolicyDate } from '@/lib/legal/policy'

export const metadata: Metadata = { title: 'Política de Cookies | Cassiellos' }

export default function CookiesPage() {
  const channel = LEGAL_CONTROLLER.privacyChannel
  return (
    <main className="legalPage"><div className="legalWrap">
      <a className="legalBack" href="/">← Voltar para o site</a><span className="tag">Tecnologias de navegação</span>
      <h1>Política de Cookies</h1><p className="legalUpdated">Última atualização: {formatPolicyDate()}.</p>
      <div className="legalContent">
        <section><h2>1. O que são cookies</h2><p>Cookies são pequenos arquivos ou identificadores utilizados por sites e serviços digitais para manter funcionalidades, lembrar preferências, compreender a navegação e medir resultados.</p></section>
        <section><h2>2. Categorias utilizadas</h2><ul>
          <li><strong>necessários:</strong> sustentam segurança, navegação e funcionamento técnico, como o registro da sua escolha de cookies (<code>cassiellos_consent</code>, por até 180 dias) e a tecnologia de verificação de segurança dos formulários (Cloudflare Turnstile). Não dependem de consentimento;</li>
          <li><strong>desempenho e análise:</strong> ajudam a entender páginas visitadas, origem do acesso e qualidade da experiência, com ferramentas da Vercel e medição própria, que não utilizam cookies e não identificam você pelo nome;</li>
          <li><strong>marketing:</strong> medem as visitas, os cadastros e os agendamentos e ajudam a otimizar nossos anúncios. Nas páginas de agendamento, o Meta Pixel só é carregado depois que você autoriza no aviso de cookies e pode criar neste site os cookies <code>_fbp</code> e <code>_fbc</code> (identificadores de navegador e de clique em anúncio, com validade de cerca de 90 dias). Se você estiver conectado a uma conta da Meta, o navegador também pode enviar à Meta cookies mantidos por ela. Os cookies <code>_fbp</code> e <code>_fbc</code> não são guardados no nosso sistema de atendimento (CRM), e o identificador de clique da Meta presente no link (<code>fbclid</code>) só é guardado no CRM com a sua autorização.</li>
        </ul></section>
        <section><h2>3. Tecnologias de terceiros</h2><p>Utilizamos serviços de hospedagem, segurança, análise e publicidade, incluindo soluções da Vercel, da Cloudflare e, quando autorizado, da Meta. Esses fornecedores tratam informações conforme suas próprias políticas de privacidade. Detalhes sobre a medição de anúncios estão na <a href="/politica-de-privacidade">Política de Privacidade</a>.</p></section>
        <section><h2>4. Sua escolha</h2><p>Nas páginas de agendamento, um aviso permite aceitar ou recusar os cookies de marketing, com as duas opções em igual destaque e nenhuma pré-selecionada. Enquanto você não escolher, nenhum cookie de marketing é usado. A recusa não impede o preenchimento do formulário nem o agendamento. Você pode mudar a escolha a qualquer momento em &quot;Preferências de cookies&quot;, no rodapé dessas páginas; ao recusar, novas medições deixam de ser feitas no seu navegador e os cookies <code>_fbp</code> e <code>_fbc</code> deste site são removidos. Também é possível excluir ou bloquear cookies nas configurações do navegador; o bloqueio de cookies necessários pode afetar funcionalidades.</p></section>
        <section><h2>5. Dados e direitos</h2><p>Informações associadas a identificadores digitais são tratadas conforme nossa <a href="/politica-de-privacidade">Política de Privacidade</a> e a legislação aplicável.</p></section>
        <section><h2>6. Contato</h2><p>Dúvidas podem ser encaminhadas para <a href={'mailto:' + channel}>{channel}</a>.</p></section>
      </div>
    </div></main>
  )
}
