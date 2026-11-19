# Comunicações transacionais — Resend (e-mail) + WhatsApp

Estado em 18/11/2026: **código publicado, envios desligados.** Nenhuma mensagem sai até que as
variáveis abaixo sejam definidas na Vercel. O número comercial da Cassiellos **não foi tocado**.

## O que foi implementado

| Parte | Estado |
|---|---|
| Serviço de e-mail (Resend), modelos, confirmação e lembretes de 24 h e 1 h | implementado e testado com mocks; **aguardando credenciais e verificação de domínio** |
| Webhook de status da Resend (entregue, devolvido, spam, falhou) | implementado; aguardando `RESEND_WEBHOOK_SECRET` |
| Varredura dos envios fora da janela de 30 dias (Vercel Cron) | implementada; aguardando `CRON_SECRET` |
| Botão "Receber confirmação pelo WhatsApp" na confirmação (Modo A) | implementado; **aguardando o número comercial** |
| Cloud API da Meta (Modo B): webhook, identificação, validação do remetente, resposta automática | **preparado e desligado**; depende de homologação da coexistência e autorização |
| Histórico por reunião + reenvio administrativo | implementado |

## Variáveis de ambiente (somente no servidor, projeto `cassiellos-crm`)

### E-mail
| Variável | Para quê | Sem ela |
|---|---|---|
| `COMMS_RESEND_ENABLED` | chave geral do canal (`true`) | canal desligado |
| `RESEND_API_KEY` | credencial (marcar **Sensitive**) | canal desligado |
| `RESEND_FROM` | remetente; padrão `Agência Cassiellos <agendamentos@cassiellos.com.br>` | usa o padrão |
| `COMMS_EMAIL_CONFIRMATION` | liga o e-mail de confirmação (`true`) | não envia confirmação |
| `COMMS_EMAIL_REMINDERS` | liga os lembretes de 24 h e 1 h (`true`) | não envia lembretes |
| `RESEND_WEBHOOK_SECRET` | segredo Svix do webhook | estados param em "aceito", nunca viram "entregue" |
| `COMMS_EMAIL_DAILY_CAP` | trava diária; padrão e **teto** 100 | usa 100 |
| `COMMS_EMAIL_MONTHLY_CAP` | trava mensal; padrão e **teto** 3000 | usa 3000 |
| `CRON_SECRET` | autentica a varredura do Vercel Cron | rota responde 404 |

As travas só podem ser **reduzidas** por variável, nunca aumentadas: um valor maior que o teto é
ignorado. É o que impede uma variável mal digitada de virar cobrança.

### WhatsApp
| Variável | Para quê |
|---|---|
| `COMMS_WHATSAPP_NUMBER` | número comercial da Cassiellos (quem recebe a mensagem do lead) |
| `COMMS_WHATSAPP_BUTTON` | `true` liga o botão na confirmação (Modo A, sem API) |
| `COMMS_WHATSAPP_CLOUD` | `true` liga o Modo B — **só após homologação e autorização** |
| `COMMS_WHATSAPP_AUTO_REPLY` | `true` liga a resposta automática (exige o anterior) |
| `WHATSAPP_VERIFY_TOKEN` | handshake do webhook |
| `WHATSAPP_APP_SECRET` | confere a assinatura `X-Hub-Signature-256` (**Sensitive**) |
| `WHATSAPP_PHONE_NUMBER_ID` | id do número na Cloud API |
| `WHATSAPP_ACCESS_TOKEN` | token de envio (**Sensitive**) |
| `COMMS_WHATSAPP_FREE_TIER` | trava mensal de mensagens de serviço; padrão e teto 1000 |

O Modo A **não depende** do Modo B. Desligar a Cloud API não tira o botão do ar.

## DNS — a fazer no provedor do domínio

A Resend gera os valores **na própria conta**, ao adicionar o domínio `cassiellos.com.br`
(ou o subdomínio `agendamentos.cassiellos.com.br`, recomendado para isolar a reputação do envio
transacional do e-mail corporativo). Os valores **não estão escritos aqui de propósito**: inventar
SPF ou DKIM quebra a entrega.

Serão pedidos, tipicamente: um registro **TXT de verificação** do domínio, um **CNAME ou TXT de
DKIM** com o seletor que a Resend indicar, um **TXT de SPF** incluindo o mecanismo que a Resend
indicar e, opcionalmente, **MX + TXT** para o subdomínio de retorno (Return-Path). Copiar os
valores exatos do painel da Resend. Enquanto o domínio não estiver verificado, o envio real
**não deve ser ligado**.

## Migration

`db/migrations/0021_comms_resend_whatsapp.sql` — aditiva, reexecutável, sem backfill.
**Não foi aplicada.** Cria `crm.comms_messages` e `crm.comms_whatsapp_refs`.

Nenhum e-mail ou telefone em claro é gravado nessas tabelas: fica só o destinatário **mascarado**
(`jo***@gmail.com`), para o administrador reconhecer a linha. O endereço real é lido de `crm.leads`
no momento do envio.

## Decisões que valem registrar

1. **Agendamento nativo até 30 dias.** A Resend aceita `scheduled_at` com até 30 dias de
   antecedência (não 72 h). Com a janela de agendamento padrão do CRM (3 dias), os dois lembretes
   cabem no agendamento nativo e a varredura nem chega a ser usada. Ela existe para o caso de
   `windowDays` ser elevado (o limite do CRM é 90).
2. **A varredura diária basta.** Ela entrega ao provedor tudo que já cabe na janela de 30 dias, não
   só o que venceu. Assim uma reunião marcada para daqui a 80 dias tem o lembrete de 1 h entregue à
   Resend bem antes da hora, sem precisar de varredura de minuto em minuto.
3. **Aceito ≠ entregue.** `sent`/`scheduled` é o que a API respondeu. Só `email.delivered` no
   webhook vira `delivered`.
4. **O clique no botão não é envio.** No Modo A o estado real é "aguardando o lead". Só o webhook
   oficial do Modo B poderá dizer que a mensagem chegou.
5. **A referência não autoriza nada.** Ela aparece na tela do WhatsApp antes do envio e pode ser
   repassada. Por isso o Modo B só responde quando o número do remetente bate com o contato daquela
   reunião; divergência não recebe o link do Meet.
6. **Fora da janela de 24 h não respondemos.** Só caberia template, que é pago.
7. **Rota separada para o botão.** O link do WhatsApp é pedido em `/api/booking/whatsapp`, depois da
   confirmação, para não acrescentar nenhuma consulta ao caminho crítico do agendamento.

## WhatsApp: situação da coexistência (a confirmar antes de qualquer ação)

As páginas oficiais da Meta sobre coexistência não abriram na consulta de 18/11/2026. O que segue
vem de documentação de provedores (360dialog, WATI) e **precisa ser confirmado na fonte oficial**:

- a coexistência existe e serve justamente a um número **já em uso no app WhatsApp Business**;
- a elegibilidade é decidida pela Meta (tempo de conta e qualidade de atendimento); contas recém-criadas não são elegíveis;
- o onboarding descrito passa por **Embedded Signup de um provedor**; não encontrei confirmação de que dê para fazer com app próprio;
- ao conectar, os **dispositivos companheiros são desvinculados** e só os suportados podem ser religados (Windows e WearOS constam como não suportados);
- o histórico pode ser sincronizado: conversas individuais dos últimos ~6 meses, mídia ~2 semanas, grupos não;
- **Verificação Clássica de Negócio e selo OBA não são suportados** em contas de coexistência;
- o app precisa ser aberto ao menos a cada ~13 dias e **não pode ser desinstalado**, sob pena de desconectar a conta.

Riscos que retirariam o número do app, pelo que apurei: desinstalar o aplicativo, passar do prazo de
inatividade, registrar o número no WhatsApp pessoal, ou desconectar da API sem orientação. Nenhum
deles é causado por este código — ele não registra, não migra e não desconecta número algum.

## Pendências para ativação real

1. Verificar o domínio na Resend e publicar os registros DNS que ela gerar.
2. Criar a `RESEND_API_KEY` e o webhook (1 endpoint no plano Free) apontando para
   `/api/crm/comms/resend-webhook`; guardar o segredo em `RESEND_WEBHOOK_SECRET`.
3. Aplicar a migration 0021 no banco de destino.
4. Informar o número comercial para `COMMS_WHATSAPP_NUMBER` e ligar `COMMS_WHATSAPP_BUTTON`.
5. Ligar `COMMS_RESEND_ENABLED` + `COMMS_EMAIL_CONFIRMATION`, observar, e só depois os lembretes.
6. Modo B: confirmar a elegibilidade de coexistência na documentação oficial da Meta e decidir
   sobre provedor antes de qualquer configuração. Nada deve ser feito no número sem autorização.
