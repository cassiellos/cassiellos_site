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
| `COMMS_SWEEP_SECRET` | autentica a varredura (mín. 32 caracteres) | rota responde 404 |
| `COMMS_PREVIEW_ENABLED` | **só em Preview**: libera teste controlado | Preview não envia nada |

As travas só podem ser **reduzidas** por variável, nunca aumentadas: um valor maior que o teto é
ignorado. É o que impede uma variável mal digitada de virar cobrança.

**Preview nunca envia por conta própria.** `COMMS_PREVIEW_ENABLED=true`, definida naquele ambiente,
é uma trava independente de todas as outras: sem ela, um deploy de Preview não dispara e-mail nem
exibe o botão de WhatsApp, mesmo com a Resend ligada e a credencial presente no projeto.

### Agendamento da varredura

O `vercel.json` é **compartilhado** pelos dois projetos Vercel (site institucional e CRM), então um
Cron declarado nele criaria um agendamento também no site institucional. Por isso o repositório
**não declara Cron nenhum** — a mesma convenção já adotada por `/api/crm/push/process`. A varredura
é chamada por um agendador externo, ou por um Cron criado no painel do projeto `cassiellos-crm`,
com `Authorization: Bearer <COMMS_SWEEP_SECRET>`.

Com a janela de agendamento padrão do CRM (3 dias), a varredura não chega a ser necessária para os
lembretes: ela serve para janelas maiores que 31 dias e para repetir envios que falharam de forma
retriável.

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

**Decisão do titular (18/11/2026): usar o domínio raiz `cassiellos.com.br`**, com o remetente
`agendamentos@cassiellos.com.br`. A zona é administrada na **Cloudflare**.

Os valores exatos saem do painel da Resend ao adicionar o domínio. **Não estão escritos aqui de
propósito**: inventar SPF ou DKIM quebra a entrega. Serão pedidos, tipicamente, um TXT de
verificação, um CNAME ou TXT de DKIM com o seletor que a Resend indicar, um TXT de SPF com o
mecanismo que ela indicar e, opcionalmente, MX + TXT do subdomínio de retorno.

### Conferência de conflito ANTES de mexer na zona

Não tenho acesso à Cloudflare e o ambiente onde rodo bloqueia consulta de DNS, então **não pude
verificar a zona**. O que já se sabe pelo repositório: existe pelo menos um **TXT no apex (`@`)**,
usado para verificar o domínio junto à Meta (`docs/crm/meta-pixel.md`). Conferir, na Cloudflare,
antes de criar qualquer registro:

| Verificar | Por que importa | O que fazer se houver conflito |
|---|---|---|
| Já existe um TXT `v=spf1…` no apex? | **Só pode existir UM registro SPF por domínio.** Dois quebram a autenticação do domínio inteiro, inclusive do e-mail que já funciona | **Editar o existente**, acrescentando o mecanismo da Resend antes do `~all` — nunca criar um segundo |
| Quantos `include:` o SPF teria? | O SPF estoura em **10 consultas de DNS**; acima disso o resultado é `permerror` | Reduzir includes não usados, ou usar o subdomínio de envio |
| Já existe MX no apex? | Se o domínio recebe e-mail hoje, o MX **não pode ser alterado** | Pedir à Resend só o MX do subdomínio de retorno (ex.: `send.`), nunca do apex |
| O seletor DKIM que a Resend indicar já existe? | Colidir com um seletor de outro provedor invalida a assinatura dele | Usar seletor distinto |
| Existe `_dmarc`? Com `p=reject` ou `p=quarantine`? | Com DMARC restritivo, e-mail sem SPF/DKIM alinhados **é descartado** | Verificar o domínio na Resend **antes** de ligar o envio |
| O TXT de verificação da Meta no apex está preservado? | Criar registros no apex sem cuidado pode sobrescrevê-lo e derrubar a verificação do domínio na Meta | Adicionar, nunca substituir |
| A Cloudflare está em modo proxy (nuvem laranja) nos registros de e-mail? | Registros de e-mail precisam ficar **DNS only** | Desligar o proxy nesses registros |

O envio real **não deve ser ligado** enquanto o domínio não estiver verificado na Resend.

Observação sobre a escolha do apex: ele concentra a reputação de envio do domínio principal. Um
problema de entrega no transacional passa a afetar também o e-mail corporativo. Foi a decisão do
titular; se o volume crescer, migrar para um subdomínio de envio continua possível.

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
2b. Definir `COMMS_SWEEP_SECRET` e criar o agendamento da varredura no projeto `cassiellos-crm`.
3. Aplicar a migration 0021 no banco de destino.
4. Informar o número comercial para `COMMS_WHATSAPP_NUMBER` e ligar `COMMS_WHATSAPP_BUTTON`.
5. Ligar `COMMS_RESEND_ENABLED` + `COMMS_EMAIL_CONFIRMATION`, observar, e só depois os lembretes.
6. Modo B: confirmar a elegibilidade de coexistência na documentação oficial da Meta e decidir
   sobre provedor antes de qualquer configuração. Nada deve ser feito no número sem autorização.
