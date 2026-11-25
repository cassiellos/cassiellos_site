# Camadas de medição do formulário `/formularios/hamburguerias`

Revisão prioritária de mensuração e consentimento, empilhada sobre o patch 0007 (`docs/tracking/funil-formularios.md`).
Objetivo: enxergar o funil sem prejudicar a experiência do visitante nem desrespeitar sua escolha de privacidade, e
distinguir **falta de consentimento**, **abandono real** e **falha técnica**.

> Este documento organiza análise técnica e jurídica para validação. **Não é parecer jurídico.** Tudo o que depende de
> advogado está marcado como "a validar". Nenhuma tag foi publicada, a política de privacidade não foi alterada e nada
> foi implantado.

## 1. Resumo

| Camada | O que é | Estado |
| --- | --- | --- |
| 1. Diagnóstico sem cookies opcionais | Contagens agregadas por etapa e indicadores de erro, sem cookie, sem identificador e sem correlação individual | **Analisada, não implementada.** Fundamento jurídico insuficiente sem teste de legitimidade (LIA), política atualizada e canal de oposição |
| 2. GTM, GA4 e Meta sob consentimento | Análise detalhada por sessão, só para quem aceitou; aviso na primeira visita | **Implementada**, desligada por padrão (`TRACKING_GTM_ENABLED`, `META_PIXEL_ENABLED`) |

Mudanças deste PR em relação ao patch 0007:

1. Aviso de entrada na primeira visita: **Recusar**, **Aceitar métricas** e **Personalizar**, com o mesmo peso visual.
2. `step_order`: posição fixa da etapa no desenho do fluxo (a ordem do funil), além de `step_index` (caminho do visitante).
3. Falha do Turnstile deixa de ser invisível: `TURNSTILE_ERROR`, `TURNSTILE_TIMEOUT` e `SECURITY_CHECK_UNAVAILABLE`.
4. Roteiro de teste em navegador real (`scripts/tracking/e2e-formulario-navegador.cjs`) e esta documentação.

## 2. Camada 1: diagnóstico sem cookies opcionais

**Conclusão: não implementar agora.**

### 2.1 O que seria coletado (hipótese)

Um contador agregado por dia, formulário, `step_id` e tipo de evento, gravado no banco do CRM por endpoint próprio.
Sem cookie, sem `localStorage`/`sessionStorage`, sem identificador de visitante, sem IP e user agent gravados, sem
respostas, sem correlação entre etapas da mesma pessoa.

Consequência técnica: **não é possível contar visitantes únicos nem seguir uma jornada.** Seriam contagens de eventos;
o abandono por etapa seria uma razão entre contagens, com repetição por recarregamento.

### 2.2 Análise (rascunho para validação jurídica)

| Item | Análise |
| --- | --- |
| Finalidade | Saber em que pergunta o formulário perde gente e separar falta de consentimento, abandono e falha técnica |
| Base legal proposta | Legítimo interesse (LGPD, art. 7º, IX), **somente se** o jurídico validar. Consentimento é descartado para esta camada, pois o objetivo é medir quem não consentiu |
| Necessidade | Parcial. A perda **depois** do cadastro já sai do banco do CRM sem coleta nova. Só a perda **antes** do cadastro não tem outra fonte |
| Minimização | Data, formulário, etapa e evento; contador numérico; nenhum dado por visitante |
| Retenção proposta | 14 meses para os contadores agregados (compatível com o GA4); nada por visitante para reter |
| Riscos | A requisição carrega IP e user agent até o servidor e a Vercel mantém logs de requisição; contagem repetida por recarregamento; reidentificação em base pequena (poucos acessos por dia); percepção de rastreamento por quem recusou cookies |

### 2.3 Rascunho do teste de legítimo interesse (LIA), em três fases

1. **Legitimidade e finalidade.** Melhorar o formulário e diagnosticar falhas técnicas é finalidade legítima e
   específica. A pergunta aberta é se ela exige contagem **antes** do cadastro ou se basta o que o CRM já registra.
2. **Necessidade (art. 10, §1º).** Dados mínimos: contagem por etapa. Alternativa menos intrusiva existente: dados do
   CRM (pós-cadastro) e logs operacionais de erro. A lacuna restante é só a perda pré-cadastro.
3. **Balanceamento.** Expectativa do visitante que recusou cookies de métricas: razoavelmente espera não ser medido.
   Salvaguardas necessárias: aviso claro, canal de oposição, retenção curta, sem identificador. **Inconclusivo sem
   validação.** O guia da ANPD manda adotar outra base se o teste for inconclusivo.

### 2.4 O que a ANPD diz (e o que não diz)

* *Guia Orientativo: Cookies e proteção de dados pessoais* (ANPD, v1.0, out. 2022): cookies de análise são não
  necessários; a p. 24 admite que medição de audiência pode ser amparada em legítimo interesse em certos contextos
  (dados agregados, sem combinação com outros rastreadores, sem perfis). O Exemplo 4 (pp. 26 e 27) aceita estatísticas
  agregadas com aviso no banner e na política e possibilidade de oposição. A p. 6 diz que as orientações valem para
  tecnologias similares: trocar cookie por outro mecanismo não escapa da análise.
* *Guia Orientativo: Hipóteses legais, Legítimo Interesse* (ANPD, v1.0, fev. 2024): exige finalidade legítima,
  necessidade, transparência e balanceamento em três fases; na dúvida, usar outra base.
* **Isso não autoriza rastreamento por si só.** Não presumo que legítimo interesse cobre a coleta.

### 2.5 Limites desta verificação

Li o guia de cookies até a p. 28; as pp. 28 a 38 (regras de banner) vieram só resumidas e não são citadas como
literais. Não consegui abrir a página do Mattos Filho nem os votos do Conselho Diretor da ANPD, e o art. 12 da LGPD
(dados anonimizados) não foi lido: se uma contagem sem identificador deixa de ser dado pessoal é exatamente a pergunta
para o jurídico.

### 2.6 O que fica preservado

Só o que o sistema já produz para funcionar: dados que o visitante envia ao pedir contato (banco do CRM), logs de erro do
servidor e logs de requisição da plataforma. **Nenhuma coleta nova entra neste PR.**

### 2.7 Limite de medição que isso impõe

Sem consentimento, o funil é visível **a partir do cadastro**; antes dele não há contagem por etapa. A taxa de aceite do
aviso também não é medida (registrá-la no servidor seria coleta nova).

### 2.8 O que só entraria após validação (proposta, não implementada)

* Endpoint de contagem agregada com `INSERT ... ON CONFLICT DO UPDATE` por dia/formulário/etapa/evento, sem log de
  IP, e lista fechada de `step_id` validada no servidor.
* Texto de transparência na política de privacidade e canal de oposição.
* Retenção de 14 meses com expurgo automático.

## 3. Camada 2: GTM, GA4 e Meta sob consentimento

* **Aviso de entrada** (`components/privacy/consent-entry-banner.tsx`): aparece na primeira visita (a escolha fica no
  cookie próprio `cassiellos_consent`, 180 dias). Três botões de mesmo tamanho, cor e peso: Recusar, Aceitar métricas,
  Personalizar. Não é modal, não toma o foco, não marca nada, só grava depois de um clique e nunca reabre sozinho.
  Não bloqueia o formulário nem o agendamento.
* **Chave exclusiva do aviso (`CONSENT_ENTRY_NOTICE_ENABLED`).** O aviso só é renderizado com `CONSENT_ENTRY_NOTICE_ENABLED=true`
  (exatamente "true"); **desligada por padrão**, de modo que publicar o código não exibe um aviso ainda não aprovado pelo jurídico.
  A chave controla só a **exibição**: não concede nem dispensa consentimento, não toca no cookie `cassiellos_consent`, nos sinais do
  Consent Mode, no GTM, no Meta Pixel nem na API de Conversões. Com a chave desligada, o consentimento continua só pelo botão
  "Preferências de cookies" do rodapé e nada é rastreado sem ele. Ligar ou desligar exige novo deploy (variável da Vercel);
  o desligamento mais rápido de emergência continua sendo o Instant Rollback.
* **Métricas × marketing separados.** "Aceitar métricas" liga só GTM/GA4. Meta Pixel e API de Conversões só ligam com
  marketing aceito em "Personalizar" ou em "Preferências de cookies" (rodapé). "Recusar" recusa ambos.
* **Consent Mode v2, modo básico.** Quatro sinais `denied` antes de qualquer script do Google; o GTM só carrega depois
  do aceite de métricas. Mesmo com marketing aceito, `ad_*` continuam negados enquanto a política não citar o Google.
  O modo avançado (pings sem cookies enviados ao Google mesmo sem consentimento) **não** foi adotado: depende de parecer.
* **Revogação.** Pelo rodapé, vale na hora: coleta para, `update` volta para `denied`, cookies do Google são apagados.
* **Falha do Turnstile.** Para quem consentiu, `lead_submit_error` com `TURNSTILE_ERROR`, `TURNSTILE_TIMEOUT` (20 s)
  ou `SECURITY_CHECK_UNAVAILABLE`, uma vez por código. Sem consentimento: nenhum evento.
* Texto do aviso: proposta sujeita à aprovação jurídica. **A política de privacidade não foi alterada** e precisa citar
  Google Analytics/Tag Manager antes de qualquer ativação.

## 4. Com × sem consentimento

| Métrica | Sem consentimento | Com métricas aceitas | Onde fica | Retenção | Base a validar |
| --- | --- | --- | --- | --- | --- |
| Cliques no anúncio | Sim (contados pela Meta) | Igual | Meta Ads | Política da Meta | Não é coleta do site |
| Visita, etapa vista/concluída, voltou, abandono por pergunta | **Não** | Sim, por sessão | GA4 | 14 meses (proposta) | Consentimento; política cita GA4/GTM |
| Erros (validação, Turnstile, calendário, confirmação) | **Não** | Sim, só código técnico | GA4 | 14 meses (proposta) | Consentimento |
| Origem, dispositivo, período da jornada | **Não** | Sim | GA4 | 14 meses (proposta) | Consentimento |
| Calendário aberto, dia e horário escolhidos | **Não** | Sim | GA4 | 14 meses (proposta) | Consentimento |
| Lead criado | Sim | Sim | Banco do CRM (Neon) | Regra do CRM | Confirmar na política vigente |
| Desfecho e UTMs do lead | Sim, só de quem cadastrou | Sim | Banco do CRM | Regra do CRM | Idem |
| Reunião confirmada; perda pós-cadastro | Sim | Sim | Banco do CRM | Regra do CRM | Idem |
| Erros de servidor (timeout do Neon, falha de banco) | Sim | Sim | Logs da Vercel | Conforme plano | Registro operacional; confirmar |
| Conversões Meta (Lead, Schedule) | **Não** | **Não** (exige marketing aceito à parte) | Meta (Pixel e CAPI) | Política da Meta | Consentimento de marketing |
| Taxa de aceite do aviso | Não medida | Não medida | Cookie no navegador | 180 dias | Registrar no servidor seria coleta nova |

Consequências: a pergunta "em qual pergunta mais gente desiste?" só tem resposta confiável entre quem aceitou métricas,
e não se sabe se esse grupo é representativo. Cliques da Meta, GA4 e CRM **não são equivalentes**: a diferença entre eles
é cobertura de consentimento mais robôs, não erro a corrigir. A razão cliques da Meta × leads do CRM é a referência que
não identifica ninguém.

## 5. Auditoria dos testes

| Camada de teste | O que é | O que prova | O que **não** prova |
| --- | --- | --- | --- |
| `npm test` (964 testes; 950 no patch 0007) | Testes unitários com `window`/`document` simulados e verificações no código-fonte | Contrato dos 19 eventos, sanitização, regras de consentimento, ausência de dados pessoais, ordem de `step_order` | Comportamento em navegador real, rede, GTM ou GA4 |
| Navegador real (Playwright, Chromium, 80 verificações, `scripts/tracking/e2e-formulario-navegador.cjs`) | Formulário real servido localmente, banco local descartável; GTM, Meta, Turnstile e APIs de envio/agenda **simulados** | `dataLayer` real, cookies, banner, revogação, nenhum evento sem consentimento, caminho até a reunião confirmada, erros, ramificação `limited`, Turnstile | Recebimento pelo GA4; integração real com Neon/Google/Meta/Turnstile |
| GTM Preview e GA4 DebugView | **Não executados** | n/d | Desde 25/11/2026 existem a propriedade GA4 e o contêiner GTM da Cassiellos (rascunho importado, **sem publicar**; ver `evidencias-simulado-x-ga4.md`), mas ainda não há URL de preview com `TRACKING_GTM_ENABLED` e `GTM_FORM_CONTAINER_ID` (ramos ainda não publicados no GitHub: token inválido na sessão) |

**Os 950 (agora 964) testes automatizados não são testes de navegador, consentimento real ou recebimento pelo GA4.**
Nenhum evento chegou ao GA4 nesta entrega.

## 6. Investigação dos pontos de perda

Evidências coletadas: logs de execução da Vercel (7 dias), uso do Neon, dados do CRM (somente leitura, agregados) e
leitura do código.

| Ponto | O que se sabe | O que não se sabe |
| --- | --- | --- |
| Visitantes sem consentimento | Sem aceite, nenhum evento do funil é medido (por desenho). Antes deste PR o aviso só existia no rodapé | Quantos visitantes são. A taxa de aceite não é medida |
| Etapas vistas e concluídas | Só medidas para quem aceitar métricas; nada foi coletado em produção ainda | Funil real por pergunta |
| Perda após a criação do lead | CRM: 2 leads reais, ambos de 24/11/2026; 1 `qualified` (sem reunião) e 1 `limited` (`budget_limited`); 0 reservas presas | Por que o `qualified` não agendou (desistência × falha) |
| Turnstile | Falha no cliente deixava o botão desativado sem rastro; agora gera evento (com consentimento). No servidor, `403 SECURITY_CHECK_FAILED` e `503 SECURITY_CHECK_UNAVAILABLE` **não deixam log** | Quantas vezes ocorreram |
| Timeout do Neon | 1× `Connection terminated due to connection timeout` em `GET /formularios/hamburguerias` (24/11, 17:48 UTC, `gru1`). Em 19/11: 4× `password authentication failed` (provável rotação de credencial). Neon Free suspende após 5 min ociosos; cold start típico de centenas de ms. Uso do Neon: 26,17 de 100 h de computação, 37 MB de 1 GB: **não é esgotamento de cota** | Causa raiz do timeout (consistente com cold start/conexão lenta, **não provado**; ocorrência única) |
| Falha de carregamento do calendário | Rotas de calendário/disponibilidade não registram log; no cliente, `booking_calendar_load_error` (com consentimento) | Quantas ocorreram em produção |
| Falha de confirmação | A rota de confirmação registra logs estruturados; 41 linhas em 7 dias (antes), nenhuma nas últimas 36 h | Taxa de falha: ausência de log não é sucesso |

**Não é possível concluir que a falta de consentimento explica os zero agendamentos.** Falta de consentimento explica
falta de **medição** (GA4/Meta), não falta de reuniões: a perda depois do cadastro é visível no CRM com ou sem
consentimento. Com 1 lead qualificado real e nenhuma reunião, a amostra é pequena demais para inferir causa.

### Mitigações propostas (não implementadas; exigem aprovação)

1. Logs operacionais de código-only para rejeições do servidor (Turnstile, calendário), **sem IP, sem token, sem dados do
   formulário**.
2. Neon: `connectionTimeoutMillis` de 10 s (recomendação da documentação), nova tentativa com espera crescente, cache
   da definição publicada do formulário e, se necessário, manter a instância aquecida.

## 7. Homologação e autorizações

Pendências para homologar: criar GA4 e GTM da Cassiellos (aceite dos termos do Google), importar o rascunho de container,
registrar dimensões/métricas personalizadas, GTM Preview, GA4 DebugView e painel por etapa.

Exigem autorização expressa antes de qualquer execução: publicar container GTM; instalar tags em produção; merge e
deploy; alterar política de privacidade; mudar conversões/orçamento/lances no Google Ads; ativar Clarity.

## 8. Como repetir o teste em navegador real

```bash
# banco local descartável + app em modo de teste (CRM_BOOKING_MODE=test, TRACKING_GTM_ENABLED=true,
# GTM_FORM_CONTAINER_ID=GTM-TEST123, META_PIXEL_ENABLED=true, META_PIXEL_ID=123456789012345, chaves de teste do Turnstile)
npm run dev -- -p 3123
BASE=http://localhost:3123 OUT=./evidencias node scripts/tracking/e2e-formulario-navegador.cjs
```

O roteiro nunca fala com produção, GTM, Meta ou Turnstile reais. Os IDs de evento simulados seguem o formato real do
servidor (`lead_<hex>`, `chronos_scheduled_<hex>`); IDs fora desse formato são descartados pelo cliente.
