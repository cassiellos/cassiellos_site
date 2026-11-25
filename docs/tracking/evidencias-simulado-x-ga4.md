# Evidências do funil: simulado, real e recebido pelo GA4

**Regra única:** só se escreve "o GA4 recebeu" quando o evento foi visto no DebugView ou no Tempo real do GA4. Tudo que
vem do código, de teste automatizado ou do navegador local é **simulado**. Hoje **nenhum evento foi recebido pelo GA4**,
porque a propriedade GA4 e o contêiner GTM oficiais ainda não existem.

## 1. Os três rótulos

| Rótulo | O que é | Fonte aceita | Hoje |
| --- | --- | --- | --- |
| **Real** | Aconteceu em produção | Dados do CRM (somente leitura) e registros de execução da Vercel | 2 leads reais, 0 reuniões confirmadas, 1 timeout de conexão com o banco |
| **GA4 recebido** | Chegou à propriedade GA4 | DebugView, Tempo real ou relatório do GA4, com captura de tela datada | 0 eventos |
| **Simulado** | Emitido por teste local, com dados fictícios | `npm test`, roteiro de navegador local (Playwright), lista de eventos do `dataLayer` local | 44 vistas de etapa, 35 concluídas, 6 erros provocados, 5 leads, 1 reunião (soma de 9 cenários) |

"n/d" significa que a origem não mede aquilo (o CRM não mede vista de pergunta nem abandono antes do envio). Zero no GA4
não é perda de visitantes: é ausência de propriedade e de tag em produção.

## 2. O que cada camada de teste prova (e o que não prova)

| Camada | Prova | Não prova |
| --- | --- | --- |
| `npm test` (1016 testes sem banco; 1219 com um PostgreSQL local descartável) | O código emite os 19 eventos do contrato, na ordem e com os parâmetros permitidos; nenhum dado pessoal sai | Que o navegador carregou o GTM, que o GA4 recebeu algo |
| Playwright em navegador local (14 cenários, 80 verificações) | O formulário real, rodando local, empurra os eventos certos no `dataLayer` e respeita o consentimento | Que a rede entregou o evento ao Google; só 9 cenários registram lista de eventos |
| GTM Preview | O contêiner (rascunho) dispara a tag certa para cada evento, sem publicar | Que o GA4 processou o evento |
| DebugView / Tempo real do GA4 | O evento chegou à propriedade, com os parâmetros esperados | Volume real de visitantes (precisa de produção) |

Somente o DebugView ou o Tempo real do GA4 pode mudar um número de "Simulado" para "GA4 recebido". O GTM Preview mostra que a
tag disparou, mas não que o GA4 recebeu; os testes automatizados e o navegador local nunca mudam o rótulo.

## 3. Como um número passa de simulado para recebido

1. O titular aceita os termos do Google Analytics (só ele pode aceitar).
2. Criar a propriedade GA4 e o contêiner GTM na conta Cassiellos, **sem publicar**.
3. Importar o rascunho `cassiellos-formulario-gtm-RASCUNHO.json`, trocar o ID de medição de exemplo (`G-XXXXXXXXXX`) pelo real.
4. Abrir o Preview do GTM contra uma URL de pré-visualização do formulário e conferir os 19 eventos no DebugView.
5. Registrar, para cada evento visto: nome, horário, captura de tela do DebugView. Só então a coluna "GA4 recebido" do
   painel recebe o número, com data.
6. Eventos de visitantes reais só entram depois de publicação autorizada pelo titular.

## 4. O que fica fora de qualquer evidência

Respostas das perguntas, texto digitado, telefone, e-mail, nome, identificadores de visitante e links privados de reunião
não são rastreados nem aparecem em painel, log ou documento. O painel usa somente contagens, códigos técnicos e horários.
