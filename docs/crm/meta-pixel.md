# Mini CRM Cassiellos — Meta Pixel e preparação da Conversions API

Estado: código pronto e **desligado por padrão**. Nada é enviado à Meta enquanto
`META_PIXEL_ENABLED` não for `true` **e** `META_PIXEL_ID` não estiver configurado.
A Conversions API **não** está ativa (sem token, sem rotina de envio).

## Arquitetura

| Peça | Onde | Regra |
|---|---|---|
| Consentimento | `lib/marketing/consent.ts`, aviso em `components/marketing/meta-pixel.tsx` | Cookie `cassiellos_consent` (só a escolha, 180 dias). Sem escolha = sem marketing. Recusar não afeta formulário nem agendamento |
| Pixel | `components/marketing/meta-pixel.tsx` (montado uma vez no layout raiz) | Só em `META_TRACKED_PATH_PREFIXES` (`/agendar/`). Nunca em `/crm` ou `/api`. Script e `init` uma vez; `autoConfig` desligado; sem correspondência avançada |
| PageView | mesmo componente | Uma vez por página do funil, depois do consentimento |
| Lead | servidor: `lib/crm/lead-intake.ts` → `crm.tracking_events` (`event_name = 'Lead'`, `event_id = lead_<id>`) | Um por lead (o primeiro envio válido). O navegador só recebe o `event_id` para lead **novo e real** |
| Schedule | servidor: `finalizeBookingReservation` → evento interno `Chronos_Scheduled` (`event_id = chronos_scheduled_<reserva>`) | Mapeado para `Schedule` (`lib/marketing/meta.ts`). O navegador só recebe o `event_id` **depois** da confirmação real no Google, e só para lead real |
| Envio no navegador | `lib/marketing/meta-client.ts` → `trackMetaConversion` | Exige Pixel carregado + consentimento; `eventID` do CRM; deduplicação na sessão; parâmetros só `content_name` (slug do formulário) |
| fbp / fbc | `readMarketingSignals` → `form_submissions.answers.marketing` | Somente com consentimento. `fbc` também a partir do `fbclid` |
| Evidência LGPD | `crm.consents` (`purpose = marketing_measurement`) | Gravado quando o visitante aceita |
| CAPI (preparo) | `lib/crm/meta-events.ts` → `buildMetaServerEvent` | Mesmo `event_name` e `event_id` do Pixel. Só `isTest === false` e com consentimento. Sem e-mail ou telefone. A fila `crm.meta_deliveries` continua sem uso |

## Ativação (cada passo exige autorização)

1. ✅ Dataset **"Cassiellos | CRM & Conversões"** criado em 29/10/2026. Dados:
   - ID **28992534033707610**;
   - pertence ao portfólio **Cassiellos (880054796119648)**;
   - vinculado só à conta de anúncios **Cassiellos 01 (368622509235308)**;
   - conexão automática à API de Conversões da Meta **desmarcada**;
   - sem categoria e sem integração Shopify;
   - nenhum evento recebido.
2. Verificar o domínio `cassiellos.com.br` no portfólio. O portfólio ainda não tem domínios.
3. Configurar `META_PIXEL_ID=28992534033707610` e `META_PIXEL_ENABLED=true` (Preview, branch) e fazer um novo deploy.
4. Validar com a ferramenta "Testar eventos" do Gerenciador de Eventos e com a extensão Meta Pixel Helper,
   usando apenas leads de teste. Leads de teste **não** disparam Lead nem Schedule; só aparecem PageViews.
5. CAPI (etapa futura):
   - token de usuário do sistema guardado só no servidor;
   - rotina de envio lendo `tracking_events` e `meta_deliveries`;
   - `test_event_code` antes do envio real.
