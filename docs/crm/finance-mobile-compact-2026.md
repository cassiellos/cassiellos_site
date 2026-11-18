# SHARK SCALE — Financeiro mobile compacto (18/11/2026)

## Problema real
Na captura enviada pelo usuário (iPhone), `/crm?view=financeiro` ocupa a maior parte da primeira rolagem com uma navegação financeira horizontal cortada e cinco controles de filtro em linhas separadas; um KPI ocupa quase toda a tela.

## Padrões usados como referência
- Android Material / Android Developers: navegação primária e secundária claramente separadas, sem barras concorrentes
  https://developer.android.com/design/ui/mobile/guides/layout-and-content/layout-and-nav-patterns
- Toptal — Mobile Dashboard UI: *progressive disclosure*: mostrar indicadores importantes antes de funções raras e gráficos
  https://www.toptal.com/designers/dashboard-design/mobile-dashboard-ui
- Fintech responsive UI: cards resumidos em coluna/grade compacta em vez de transpor a tabela do desktop sem adaptações
  https://www.onething.design/post/banking-app-dashboard-design

## Alterações
1. Em telas de até 830px, substituir o corredor horizontal de nove abas por quatro áreas: **Resumo / Receitas / Despesas / Mais**. Em Mais aparecem Clientes e Contratos, Rateio, Contas a Receber, Contas a Pagar, Notas e Relatórios. Nenhum destino foi excluído.
2. Período mensal sempre visível, com setas e seletor nativo `type=month`. Filtros avançados (Ano, Cliente, Categoria, Fonte) permanecem funcionais sob botão de expansão, com contador de filtros ativos e Limpar.
3. Resumo prioritário em grade 2×2: **Recebido (caixa)**, **A receber (vencimento do mês)**, **Despesas pagas (caixa)** e **Resultado do mês (caixa)**. Cada indicador é botão navegável para a lista original apropriada, preservando as semânticas financeiras distintas.
4. Outras métricas ficam em painel expansível: despesas previstas, recebíveis vencidos, contratos recorrentes e rateio projetado. Todas com botão de navegação real.
5. Cinco gráficos continuam disponíveis no botão expansível **Gráficos e análises** e não ocupam o início da página no mobile.
6. A barra global inferior aprovada pelo usuário permanece sem alterações. Não criamos uma segunda barra inferior.
7. Desktop: navegação em grade, filtros, cards e gráficos completos são preservados.

## Salvaguardas
Nenhuma mudança em tabelas Neon, contratos, lançamentos, cálculo de competência/vencimento/caixa, APIs ou publicações de formulários. O código mobile usa os mesmos números retornados pelo backend e o mesmo direcionamento de seções do painel desktop.

## QA de homologação visual
- iPhone Safari 390/414px e Android Chrome 360px: confirmar 4 tabs inteiras, botão Mais abrindo outros seis destinos, filtro de período visível, filtros avançados recolhidos, quatro KPIs em 2 colunas, sem rolagem horizontal da página
- Clicar em Recebido, A receber, Despesas pagas, Resultado; confirmar páginas de destino e retorno para Resumo
- Filtro por cliente/categoria/fonte e contador de filtros, mês anterior/próximo, loading sem valores antigos
- Abrir Outros indicadores e Gráficos; testar rolagem e fechamento sem perder dados
- 820px e desktop 1440px: garantir desktop inalterado acima de 830px
- Nenhum movimento de teste; não cadastrar pagamentos, leads ou agendamentos
- Testes automatizados: 745 aprovados, `npx tsc --noEmit` aprovado, `npm run build` aprovado. QA visual autenticada ainda pendente
