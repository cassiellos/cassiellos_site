# SHARK SCALE — Interface simplificada e mobile-first (17/11/2026)

## Referências externas
- Linear: projeto de interface com menos ruído, hierarquia de navegação, superfícies discretas.
  https://linear.app/now/behind-the-latest-design-refresh
- Attio: sidebar claramente separada da área de trabalho, agrupamento de funções.
  https://attio.com/help/reference/attio-101/introduction-to-navigating-attio
- Google/Android: bottom navigation nas telas compactas, sidebar nas telas amplas.
  https://developer.android.com/develop/ui/views/layout/build-responsive-navigation

Referências servem para decisões de UX; visuais, paleta e marca permanecem Cassiellos.

## O que mudou
- Navegação desktop: sidebar agrupada por **Visão comercial**, **Captação**, **Operação**, com **Inteligência** condicional.
- Navegação em até 830px: barra inferior com **Início**, **Leads**, **Formulários**, **Agenda** e **Mais**, onde estão Funil, Financeiro, Relatórios, Disponibilidade, Configurações, Integrações etc. Sem corredor horizontal de botões.
- Menu Mais: painel inferior com botões grandes, seção organizada, fechamento pelo pano de fundo/Escape, foco de teclado contido, encerramento de sessão acessível.
- Barra superior mobile: contexto da tela, busca sob demanda, atalho para eventos.
- Dashboard: acesso rápido para Leads, Agenda e Formulários, KPIs mais contidos e superfícies com menos gradientes.
- Leads: no celular, cartões com nome, etapa, faturamento e data. O toque abre **a mesma ficha existente** do lead; no desktop, a tabela completa permanece.
- Funil: no mobile, etapas empilhadas na vertical em vez de grade de ~1324px; cards e seletor de qualificação continuam operantes.
- Formulários e agenda: refinamentos de espaçamento, quebra de linha e largura.
- Branding preservado: símbolo oficial Cassiellos, navy escuro e vermelho #ed4558; nenhuma mudança de logotipo.
- Reescrita de descrições da navegação em linguagem simples.

## Invariantes
Sem modificações nos contratos de API, modelos Neon, políticas de privacidade, lógica de conversão, cookies, rotas públicas ou estado de formulários. A saída do menu More não altera a sessão.
O fluxo de formulários e o calendário permanecem existentes, sem publicação de rascunhos.

## QA antes de marcar homologado
1. Desktop 1440px e tablet 820px: sidebar/toolbar, nav completa, scroll do conteúdo.
2. Mobile 390px e 414px: barra inferior sem corte, Mais/Fechar/Escape, acesso a todas as funções.
3. Busca de leads no topo mobile; cartões e ficha de lead, incluindo modal em tela cheia.
4. Funil em colunas verticais, altera qualificação sem substituir status automático.
5. Dashboard: KPIs, cards e acessos rápidos.
6. Formulários: abrir rascunho Hamburguerias e Escolas, simular sem gravar; canvas/campos móveis.
7. Agenda: detalhes de reuniões, data, filtros e rolagem.
8. Financeiro, Relatórios e Inteligência (se habilitada): campos, tabelas, modais e controles.
9. Console de navegador, overflow horizontal da página, foco de teclado, zoom e safe-area do dispositivo.
10. Não criar leads, não enviar formulários, não publicar drafts e não emitir conversões reais para homologação.

A suíte automatizada passou com 741 testes, TypeScript e build aprovados em sandbox descartável. **Não equivale a teste visual autenticado.**
