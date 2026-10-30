# Política de Privacidade — proposta para o agendamento sem convite (N5)

**RASCUNHO PARA REVISÃO. NÃO PUBLICADO.** A página publicada (`app/politica-de-privacidade/page.tsx`) não foi alterada.

Regras para publicar:
- só depois da sua revisão;
- junto com a publicação da funcionalidade. Enquanto o Preview cria convites, o texto atual continua correto;
- a data "Última atualização" deve ser a data real da publicação.

Integração: a versão D5 v2 da política, que está na branch `local/meta-pixel-prep`, tem a mesma seção 9 com o mesmo texto.
O ajuste abaixo deve ser aplicado à versão que for publicada, sem misturar branches agora.

## Seção 9 — Integração com Google Calendar

### Trecho 1 (finalidade)

**Atual:**
> A finalidade é impedir conflitos de horários, confirmar agendamentos e gerar convites com Google Meet.

**Proposto:**
> A finalidade é impedir conflitos de horários, confirmar agendamentos e gerar o link da reunião no Google Meet.

### Trecho 2 (dados enviados ao Google)

**Atual:**
> O sistema pode enviar ao Google Calendar o título e a descrição da reunião, as datas e horários e o e-mail informado pelo
> participante para criar o convite. O Mini CRM armazena o identificador do evento, o horário agendado, o estado da reunião e
> o link do Google Meet, quando disponível.

**Proposto:**
> O sistema envia ao Google Calendar apenas o título da reunião, uma referência interna sem dados pessoais, as datas e os
> horários. O nome, o e-mail e o telefone informados pelo visitante não são enviados ao Google Calendar, e o visitante não é
> adicionado como convidado; por isso, nenhum convite automático é enviado ao endereço informado. O link do Google Meet é
> exibido na tela de confirmação, e o visitante pode, se desejar e por iniciativa própria, copiá-lo ou salvá-lo na sua
> agenda (Google Agenda ou arquivo .ics gerado no próprio navegador). O Mini CRM armazena o identificador do evento, o
> horário agendado, o estado da reunião e o link do Google Meet, quando disponível.

### Trecho 3 (processamento pelo Google)

**Atual:**
> O processamento técnico necessário ocorre por meio dos provedores de infraestrutura e do próprio Google para criar e
> enviar convites.

**Proposto:**
> O processamento técnico necessário ocorre por meio dos provedores de infraestrutura e do próprio Google para criar o
> evento na agenda da Cassiellos e a sala do Google Meet.

### Trecho 4 (opcional: contato operacional, N2/N3)

**Proposto (inserir ao fim da seção 9):**
> Em caso de cancelamento, alteração ou preparação do link da reunião, nossa equipe poderá entrar em contato pelo WhatsApp
> ou pelo e-mail informados no formulário, exclusivamente para tratar do agendamento.

Pontos para a revisão jurídica:
1. Conferir se o Trecho 4 já está coberto pela finalidade de contato descrita em outra seção (evitar duplicidade).
2. A declaração sobre uso limitado de dados das APIs do Google (não venda, não publicidade, não treino de IA) permanece igual.
3. Os escopos OAuth citados (`calendar.freebusy`, `calendar.events.owned`) não mudam.
