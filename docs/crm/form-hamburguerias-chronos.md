# SHARK SCALE — Formulário Hamburguerias (Chronos)

Fonte de estrutura: `Formulario_Validado_Chronos_Shark_Crew_Consolidado.docx` e `CHECKLIST DO FORMULÁRIO FARMADOR DE CASCALHO.pdf`. Adaptação de copy e faixas conforme a orientação do usuário em 16/11/2026.

## Estado de entrega
- Modelo `lib/crm/form-builder/hamburguerias.ts` é usado para preparar o **rascunho** `hamburguerias` na tabela `crm.form_flows`.
- Não publicar automaticamente, nem migrar dados de leads ou criar campanhas.
- A capa é opcional no motor e não altera as versões antigas dos formulários.
- Não foi apresentada afirmação de mais de 100 hamburguerias atendidas porque não há comprovação aprovada.
- Não usar promessa de crescimento ou faturamento garantido em 30 dias.

## Copy de capa
- Headline: 🍔 Tráfego pago para hamburguerias que querem vender mais.
- Benefícios: 📈 Campanhas para gerar demanda; 📲 Mais pedidos além do iFood; 🍔 Estratégias para seu mercado.
- Filtro em itálico: → Exclusivo para hamburguerias que faturam a partir de R$ 40 mil/mês e querem vender mais.
- CTA: QUERO VENDER MAIS.

## Etapas e caminhos
1. Nome (obrigatório).
2. Telefone com DDD (obrigatório e validado).
3. Site ou Instagram (obrigatório e validado).
4. Faturamento mensal, com CINCO faixas 30–39 / 40–49 / 50–59 / 60–99 / 100+ mil.
5. Investimento de mídia de R$ 30/dia, indicando explicitamente que **não inclui gestão**. Sim/Não.
6. Final A: Receita >= R$ 40 mil e investimento SIM -> qualificado, próximo passo agenda.
7. Final B: Receita 30–39 mil OU investimento NÃO -> orçamento/perfil limitado, sem calendário prioritário; dados para nutrição.

## Limitação assumida e não mascarada
O construtor `/formularios/[slug]` ainda **não incorpora o módulo de calendário dinâmico no mesmo wizard**. Na etapa de resultado qualificado, o botão aponta à agenda oficial já existente em `/agendar`, que tem seu próprio formulário e pode solicitar dados novamente. Não apresentar isto como calendário nativo integrado. A experiência de agendamento unificada deve ser homologada antes de qualquer publicação.

O formulário de hamburguerias permanece inativo até aprovação explícita. `/formularios/hamburguerias` deve responder 404 enquanto o status for `draft`.

## Testes
- `node --import tsx --test lib/crm/form-builder/hamburguerias.test.ts`
- `npm test`
- `npx tsc --noEmit` e `npm run build`
- Fluxos limitados/qualificados determinísticos, rejeição de contatos mal formatados e tentativa de salto de etapa.
