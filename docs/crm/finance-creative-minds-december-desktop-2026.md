# SHARK SCALE — Financeiro Creative Minds e Desktop (17/11/2026)

## Fato identificado no banco oficial (Neon, apenas consultas)
Cliente: Minds Franquia - Creative Mind. Serviço: Gerador de imagens por IA, categoria creative_minds. Fonte mensal, R$ 1.397,00.
- Lançamento c4ac7c76-6050-4030-b8af-1d6b8931c066: competência **novembro/2026**, vencimento **01/12/2026**, R$ 1.397,00, R$ 0,00 recebido.
- Lançamento 96f29bd0-9f8b-4e4f-bc3e-d7d44b7f8809: competência **dezembro/2026**, vencimento **10/12/2026**, R$ 1.397,00, R$ 0,00 recebido.
- O usuário informou que uma cobrança de 01/12 não deve aparecer no faturamento operacional de novembro. Ambas as datas no banco foram preservadas. **Não concluir que a segunda cobrança é duplicada** sem verificar o contrato.

## Decisão técnica
O sistema distingue legitimamente:
- **Competência contábil**: serviço a que a receita se refere. Mantida sem mudança em DRE/relatórios contábeis e nos dados originais.
- **Vencimento da cobrança**: previsão de recebimento. Deve ser a referência padrão dos painéis operacionais de Receitas, Contas a Receber, previsão por categoria e tendência dos últimos 12 meses.
- **Caixa realizado**: somente pagamentos confirmados na data da liquidação. Nunca confundir previsão com recebimento.

Esta mudança corrige a visualização de novembro sem reclassificar contabilmente serviços nem mudar o banco:
- KPI "A receber no mês" agora soma saldos de cobranças cujo vencimento ocorre no período, excluindo cancelamentos e verba de anúncio de clientes.
- "Receita dos últimos 12 meses": projeção por vencimento × caixa efetivamente recebido.
- "Receita por categoria": vencimento na barra principal; caixa na secundária.
- "Contas a Receber" e histórico de clientes: cobrança por vencimento, não competência; Despesas continuam por competência.
- Aba Receitas já tinha vencimento como padrão e opção de competência contábil, mantida.

## Desktop
- Botões diretos de Visão geral, Leads, Formulários e Agenda no topo em telas amplas, acompanhando o padrão aprovado no mobile.
- Financeiro desktop: abas em grade responsiva, filtros agrupados, cartões de KPI mais equilibrados.
- Menus, cards, cores navy + vermelho e componentes do mobile preservados.

## Escopo e homologação
Código apenas no repositório `cassiellos/cassiellos_site`, branch de produção `crm-production`.
Sem mudança em Neon, recebimentos, auditorias, CAPI/Pixel, formulários ou campanhas.
QA: suíte `npm test` com 745 aprovações, verificação de tipos `npx tsc --noEmit` e `npm run build`. Homologação visual autenticada no desktop ainda requerida para confirmar ergonomia.
