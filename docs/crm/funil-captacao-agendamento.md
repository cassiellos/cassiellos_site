# Mini CRM Cassiellos — requisitos aprovados para o funil de captação
Data: 28/10/2026
Ambiente autorizado: branch `feature/mini-crm-shark-scale`, Vercel Preview e Neon Preview. NÃO alterar Production ou `main`.

## Decisões do usuário
- Referência funcional: jornada de formulário e agendamento do Chronos mostrada pelo usuário em vídeo; reproduzir o caminho funcional, respeitando a identidade Cassiellos.
- Campanhas e formulários altamente nichados (exemplo inicial: clínicas odontológicas; outros nichos futuramente).
- Uma pergunta por tela; fluxo responsivo, rápido e simples, com voltar/continuar e barra de progresso.
- Perguntas configuráveis por nicho e versão de formulário.
- **Incluir pergunta de faturamento da empresa** na qualificação; faixas de faturamento e obrigatoriedade ainda precisam ser definidas por nicho. Preferir alternativas selecionáveis.
- Captar nome, e-mail, WhatsApp, dados da empresa, respostas de qualificação e identificadores de origem/campanha de maneira adequada e transparente.
- Agendamento: escolher dia/horário entre disponibilidades reais via Google Calendar API no servidor Next.js (não incorporar interface Google); confirmar e guardar reunião no Neon, com Google Meet/convites quando habilitado.
- Evento-chave de otimização inicial Meta Ads: `Chronos_Scheduled`, apenas após confirmação real da reunião; não disparar em mero clique ou envio do formulário.
- Confirmações e notificações serão integradas depois, sem custos adicionais não aprovados.

## Estado verificado em 28/10/2026
- Frontend progressivo em `app/agendar/[slug]/booking-experience.tsx` funciona em modo Preview.
- Respostas mantidas apenas no state React: **não são salvas no Neon**; serão perdidas com recarregamento.
- `GET /api/booking/availability` consulta Google Calendar e reservas internas; apenas consulta e incrementa limitador antiabuso. Não cria leads nem eventos.
- `crm.booking_requests` já existe no Neon Preview e está vazia; confirmação real NÃO ativada.
- Não enviar mensagens/e-mails nem eventos Meta enquanto a funcionalidade de agendamento real não for concluída, validada e aprovada.

## Próxima implementação — persistência e agendamento
1. Registrar novo lead no Neon ao completar etapa de dados, após validação e informações de privacidade/consentimento pertinentes; evitar cadastro duplicado de mesma pessoa.
2. Gravar `form_submissions` com versão e perguntas/respostas, incluindo faturamento, e trilha de origem dos anúncios.
3. Implementar agendamento com validação no servidor e proteção transacional contra reserva dupla, rechecagem de disponibilidade Google e idempotência do pedido.
4. Criar evento Google Calendar/Meet e convite, persistir `appointments` e `lead_activities`, definir recuperação segura em falhas parciais.
5. Gerar `Chronos_Scheduled` apenas em confirmação, com `event_id` estável/deduplicação; envio Meta posterior e separado.
6. Testes em Preview com contas/dados de teste e autorização específica antes de criar eventos reais.
