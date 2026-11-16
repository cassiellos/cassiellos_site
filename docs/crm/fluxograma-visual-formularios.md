# SHARK SCALE — Construtor de formulários, Modo Fluxograma

## Objetivo

O CRM oficial em `/crm?view=formularios` oferece dois modos, **Fluxograma interativo** (padrão) e **Lista de etapas**. Ambos editam o mesmo JSON de rascunho usado pelo motor de roteamento e publicação. Não existe segundo formulário, banco ou webhook. Não requer migração além da 0020 já instalada.

## Operação visual

- Abra o formulário existente (ex.: Escolas). No novo modo, cada etapa aparece como um cartão ligado por setas rotuladas. Linhas verdes são SIM, âmbar NÃO; as demais são caminhos padrão ou desvios personalizados.
- Arraste a parte superior de um cartão para organizá-lo. O posicionamento é salvo em `flow.layout` **somente quando Salvar rascunho é acionado**. O botão Organizar volta ao layout automático, também sem publicar.
- Arraste o fundo para navegar. Role o trackpad para deslocar o canvas; pressione Ctrl/⌘ + rolagem para zoom. Use os botões + / − / Centralizar para ajustes rápidos.
- Clique no cartão para editar seu título, alternativas, descrição e destino no painel lateral; mude para **Lista de etapas** sem perder os dados.
- Para **conectar**: clique na saída de uma pergunta e em seguida no cartão de destino. Se a resposta já é um desvio, somente seu destino muda. Se for caminho padrão, alteram-se as respostas que não têm desvio explícito. Qualquer ligação que introduzir ciclo/etapa desconectada é barrada.
- Para **criar bifurcação**: no cartão, abra **+ Separar resposta**, escolha a alternativa e clique no cartão destino. O motor recalcula o percurso e impede ciclos.
- Para **retirar uma bifurcação**: pressione **×** na linha do desvio e confirme o impacto sobre a resposta. Se o resultado antigo ficar sem caminho, o rascunho torna-se inválido e não poderá ser salvo ou publicado até reconectar/excluir a etapa órfã. Nunca há alteração silenciosa.
- Para **excluir um cartão**: as ligações de entrada devem ser removidas/redirecionadas explicitamente antes; a exclusão é confirmada. Uma exclusão da etapa inicial informa qual será o próximo início.
- Para adicionar, os botões **+ Adicionar pergunta** e **+ Adicionar finalização** continuam disponíveis, além do editor tradicional.

## Segurança e semântica

- A mesma função `validateFlow` do servidor valida todos os nós, bifurcações, destinos, ciclos e o layout novo (`x/y` numéricos finitos, limites e IDs válidos). Não há mudança no formato das respostas nem no fluxo real de leads.
- Rascunhos e versões publicadas continuam distintos. A visualização/canvas **nunca** publica ou grava leads; apenas os botões já existentes fazem isso.
- Novos formulários continuam sendo publicados em `/formularios/<slug>`. O novo modo não altera o `/agendar` nem as conexões Meta/Google.
- O banco tem o registro **Formulário Escolas**, slug `escolas`, revisão #7, em estado **draft**, com seis etapas de teste. **Não editar/remover os dados sem solicitação.**
- O modo gráfico é client-side, sem dependência externa e carregado junto com o construtor somente ao abrir o menu.

## Homologação visual sugerida após deploy

1. Abrir `/crm?view=formularios` com sessão autenticada, verificar modo gráfico por padrão e lista alternável, sem criar novo formulário.
2. Conferir linhas do Sim e Não e a etapa de teste no rascunho `escolas`. Use **Organizar** apenas se a intenção for alterar layout e lembre de descartar mudanças.
3. Arrastar um cartão, pan/zoom/centralização, selecionar pergunta, editar título e verificar sincronização ao alternar modo.
4. Tentar ligar nó a ele mesmo, criar ciclo e excluir resultado vinculado: tudo deve ser bloqueado ou exigir confirmação, **sem salvar**.
5. Testar criar/remover desvio e verificar que resultados órfãos bloqueiam salvar/publicar. Descarta-se o teste recarregando o formulário do banco.
6. Verificar viewport desktop e celular (414 px), canvas e editor, console.
7. Confirmar **status draft** e `/formularios/escolas` 404 depois. Sem criar/enviar contatos e sem publicar formulário de teste.

Testes automáticos de layout e segurança em `lib/crm/form-builder/diagram.test.ts`; `npm test`, `npx tsc --noEmit`, `npm run build`.
