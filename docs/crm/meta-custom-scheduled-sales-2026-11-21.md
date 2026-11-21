# Meta Ads — evento independente de reunião confirmada (Vendas)
Data: 21/11/2026 · Branch de revisão: `fix/meta-custom-scheduled-sales-20261121`

## Problema comprovado
Na Meta Ads, `Schedule` (evento padrão) só pode ser otimizado com Leads/Engajamento. Uma **conversão personalizada baseada em Schedule** herda a restrição. O erro não significa que o Pixel tenha parado.

O CRM já envia o evento interno `Chronos_Scheduled` como **Schedule** ao Pixel e à CAPI. Precisamos de um **novo evento de navegador e servidor** com nome independente para testar o objetivo Vendas, sem alterar o legado.

## Alteração (NÃO está ativada)
- Nome do novo evento: `Cassiellos_Scheduled`, enviado por Pixel com `fbq('trackCustom', ...)` e pela CAPI (`event_name` igual).
- `event_id` novo e determinístico: `cassiellos_scheduled_<bookingId_sem_hifens>`.
- Evento padrão `Schedule` continua exatamente como antes, com ID `chronos_scheduled_<bookingId_sem_hifens>`.
- Um lote CAPI contém os dois eventos quando a flag está ativada, sem alterar a fila única `crm.meta_deliveries`. Em caso de resposta parcial, a entrega não é marcada como aceita.
- Consentimento de marketing, confirmação real do Google/CRM, teste vs. real, idempotência e privacidade permanecem obrigatórios. Testes de homologação não geram o novo evento comercial na CAPI.
- `META_CUSTOM_SCHEDULE_ENABLED`: **default OFF**. Somente o literal `true` habilita a adição. Não acrescenta dados pessoais, segredos ou cookies.

## Como validar SEM publicar a campanha
1. Revisar o PR, executar `npm test` (ou comando padrão do projeto), `npx tsc --noEmit` e `npm run build` em branch de Preview. Não fazer deploy de produção sem aprovação.
2. Ativar `META_CUSTOM_SCHEDULE_ENABLED=true` apenas no Preview e fazer redeploy. Mantê-la ausente na produção.
3. Em Meta Eventos de Teste, confirmar um agendamento autorizado no modo de homologação que não crie lead comercial falso. Se o modo atual não suporta testar o evento personalizado sem dados reais, **não forçar** um teste artificial; primeiro preparar homologação isolada.
4. Num teste autorizado de produção com consentimento e agendamento real, conferir eventos `Schedule` e `Cassiellos_Scheduled`, origem navegador e servidor, com IDs próprios idênticos em cada par; verificar a deduplicação.
5. Voltar ao conjunto da campanha **em rascunho** e testar se `Cassiellos_Scheduled` fica selecionável em **Vendas > Site**. A Meta pode exigir um evento real recebido e/ou algum prazo de propagação.
6. Se aceito, salvar o conjunto sem publicar. Se bloqueado, anotar a mensagem exata. **Nunca** trocar para `Purchase` sem uma compra real ou escolher outro objetivo por conta própria.
7. Só após validação técnica e comercial, habilitar a flag em produção em mudança separada aprovada pelo titular.

## Rollback
Remover `META_CUSTOM_SCHEDULE_ENABLED` ou definir `false` e redeploy. O `Schedule` padrão continuará funcionando.

## Observações operacionais
- A conversão personalizada antiga `Cassiellos | Reunião Agendada | Schedule` (ID `1830828814858022`) permanece intacta, sem aplicação na campanha Vendas.
- O rascunho da campanha (ID `120261270577160456`) e seu conjunto (ID `120261270577140456`) não foram modificados.
- O nome de evento independente **não garante** aceitação pela Meta até que seja confirmado na UI real; é a hipótese documentada mais alinhada à aula.
- NÃO publicar, não alterar campanha existente, não executar comandos de produção neste PR.
