# Checklist de prontidão de rastreamento — campanha Hamburguerias (18/11/2026)

## Escopo implementado

- Páginas públicas **publicadas** em `/formularios/[slug]` agora recebem o mesmo `MetaPixel` de `/agendar`; `/crm` e APIs nunca carregam o script.
- O Pixel só é inicializado depois de consentimento de **marketing** no cookie válido. PageView apenas para visitantes que optam por marketing. Consentimento revogável; `_fbp`/`_fbc` removidos em revogação.
- Nova integração do formulário editável com `ConsentNotice` e `Preferências de cookies`, mantendo a estrutura de perguntas, respostas, identidade e textos do formulário intactos.
- Formulário público repassa ao backend a escolha atual de marketing; `fbclid` é descartado quando marketing não é autorizado, inclusive pelo servidor.
- Somente o **novo lead real** após resposta de sucesso do servidor retorna `tracking.lead.eventId`. Cadastros repetidos, leads existentes, tests e recusa não disparam o Lead no Pixel.
- A CAPI também envia **Lead** para novos cadastros com consentimento atual, por `after()`, em ambos os fluxos `/agendar` e `/formularios`. Usa exatamente `event_name='Lead'` e o mesmo `event_id` do Pixel para deduplicação.
- A CAPI mantém a entrega `Schedule` preexistente e o modo `live` configurado na Vercel. Fila `crm.meta_deliveries` única por tracking event, no máximo três tentativas, revogação revalidada antes de retry; nada de nome, email, telefone, IP, user-agent, token, `fbp`, `fbc` na persistência ou logs. IP/UA só durante o envio à Meta.
- Toda a rota `/formularios` agora integra a política CRM de consentimento de Vercel Analytics/Speed Insights e minimização da URL. Isto evita que métricas institucionais rodeiem o consentimento do formulário.
- Texto sobre CAPI Lead ajustado no banner e nas políticas de privacidade e cookies. Revisão jurídica dos textos continua recomendada antes da campanha.

## Conferências técnicas

- A Vercel possui `META_PIXEL_ENABLED=true`, `META_CAPI_MODE=live`, Pixel ID válido e token CAPI secreto cadastrado.
- Leitura de Meta Ads conectada pela Supermetrics confirma que a conta **Cassiellos 01** disponibiliza o mesmo pixel do CRM, domínio `crm.cassiellos.com.br`. Isso **não substitui** o teste de eventos/deduplicação no Events Manager.
- Testes automatizados do projeto: 751 aprovados, 0 falhas na primeira execução; `tsc --noEmit` e `next build` sem erros. Reexecutar após alterações finais.
- Esta implementação não insere leads nem eventos falsos no banco de produção e não envia eventos comerciais artificiais à Meta.
- Nenhum conteúdo de formulário foi publicado/alterado no banco.

## Pendências comerciais para liberar anúncios

1. **Concluir a copy** do formulário `hamburguerias` no editor do CRM e publicá-lo. Em 18/11, está como `draft`, `revision=1`, `published_version=0`. A rota pública retorna 404 enquanto não publicado.
2. **Corrigir o destino da CTA qualificada.** O rascunho usa `actionHref='/agendar'` e o `/agendar` existente usa cópia e campos de **odontologia**. Não enviar tráfego para esse desvio. Ajustar a jornada de agendamento da hamburgueria (copy, campos, segmentação) antes de publicar.
3. Na conta de anúncios certa, conferir que o evento de otimização é **Lead** e que o mesmo Pixel/dataset do CRM está associado e com permissões adequadas.
4. Realizar um teste real autorizado com consentimento de marketing em Eventos de Teste da Meta: PageView → envio novo real → 1 único Lead contabilizado após deduplicação browser + servidor. Testar recusa (0 eventos), reutilização de email (0 novo Lead), `Schedule` somente após confirmação e `fbclid`/UTMs sem exposição a ferramentas alheias.
5. Confirmar diagnóstico/qualidade de correspondência na Meta após o tráfego inicial. Por política de minimização, a CAPI só usa IP e user agent em memória; ausência de `fbp`/`fbc` e PII limita a taxa de correspondência.
6. Alinhar juridicamente a política e o consentimento com a finalidade real antes da ativação.

## Não alterado

- Rascunhos, fluxos, copies e CTA armazenados no banco; criativos e anúncios; dados financeiros; configurações do Pixel existente; status de campanhas; flags comerciais do Chronos.
