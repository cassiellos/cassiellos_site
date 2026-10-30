# Fase 4 — Integração controlada, etapa 1: disponibilidade e feriados

Branch local `local/integration-1-availability`, criada a partir de `dae52f7` (Preview publicado), com merge sem squash
de `local/availability-prep` @ `2410815`. O histórico original foi preservado. **Sem push, deploy ou migração.**
Não inclui o agendamento sem convite, a privacidade nem o Meta Pixel.

## Regras confirmadas na versão integrada

| Regra | Onde | Teste |
|---|---|---|
| Antecedência mínima de 3 h, arredondada para o próximo slot de 30 min | `DEFAULT_BOOKING_POLICY` → `DEFAULT_AVAILABILITY_SETTINGS` | engine.test (casos 1–4), booking-slots.test |
| Janela de 3 dias corridos, datas em America/Sao_Paulo, hoje incluído | idem | engine.test (casos 5–7, 10, 11) |
| Seg–sex, 09h–18h, slots de 30 min, última reunião termina às 18h | idem | booking-slots.test, engine.test |
| Feriados nacionais, estaduais (MG) e municipais (BH); políticas comerciais | `lib/crm/availability/holidays.ts` | holidays.test, engine.test (02/11 nunca oferecido) |
| Bloqueios, férias e recessos configuráveis; exceções sem ultrapassar janela e antecedência | painel DISPONIBILIDADE + 0008 | engine.test, admin.test, store.db.test |
| Validação obrigatória no servidor; 409 para conflito, 400 para pedido inválido | `booking-confirmation.ts`, rotas | admin.test (API direta), booking-antiabuse.db.test |
| Mensagem quando não há horários na janela | `booking-experience.tsx` | navegador local (desktop e celular) |
| Reuniões existentes preservadas | bloqueio só conta reuniões | store.db.test, auditoria da 0008 |

## Ajustes feitos nesta integração

1. **Política base como fonte única:** `DEFAULT_BOOKING_POLICY` (`lib/crm/booking-slots.ts`) passou de 12 h / 30 dias
   para **3 h / 3 dias**. O motor (`DEFAULT_AVAILABILITY_SETTINGS`) agora **deriva** dela: antecedência, janela, horário
   e dias. Um teste garante que os dois não divergem.
2. **Tela sem horários:** quando a janela inteira está fechada, o título da área de horários passa a "Sem horários
   disponíveis", em vez de "Selecione um dia", acompanhado da mensagem aprovada.
3. **Testes da grade base** (`booking-slots.test.ts`) atualizados para 3 h / 3 dias. A grade base não aplica feriados;
   o feriado de 02/11 é aplicado pelo motor, que é o que as rotas usam.

## Auditoria da migração 0008 (não executada)

| Verificação | Resultado |
|---|---|
| Padrões | `min_notice_minutes` **180**, `window_days` **3**, seg–sex, 540–1080, slot 30 |
| Compatibilidade | Só cria 4 tabelas novas (`IF NOT EXISTS`) e índices próprios. Não usa `ALTER` nem toca em tabela existente. Requer PostgreSQL 13+ (`gen_random_uuid()` nativo, como na 0001) |
| Histórico | Em banco descartável com histórico simulado (5 reuniões, 3 reservas): assinatura das reuniões e das reservas **idêntica** antes e depois |
| Não destrutiva / reexecutável | Aplicada 2 vezes seguidas sem erro; nada removido |
| Falha no meio | Transação única (`BEGIN … COMMIT`): erro simulado desfaz tudo e nenhuma tabela fica criada |
| Ordem de publicação | Funciona nas duas ordens: código novo sem a 0008 usa o padrão embutido (feriados incluídos); 0008 com o código atual não muda nada |
| Recuperação | `db/ops/0008_rollback.sql` remove só as 4 tabelas novas (testado; histórico intacto; reaplicação ok). Fica fora de `db/migrations` para não ser aplicado por engano |
| Conferência | `db/ops/0008_pre_post_checks.sql` (somente leitura): role e dono das tabelas, existência das tabelas, assinatura do histórico antes × depois |

**Procedimento proposto para quando houver autorização (D4/T-2):**
1. No Neon **Preview**, rodar `0008_pre_post_checks.sql` e guardar o resultado. O role deve ser o mesmo dono das tabelas `crm`.
2. Aplicar `db/migrations/0008_availability.sql` uma vez.
3. Rodar as conferências de novo e comparar as assinaturas, que devem ser idênticas. A configuração deve sair 180 min / 3 dias.
4. Em caso de falha durante a aplicação, nada fica criado (transação). Se for preciso desfazer depois, usar
   `0008_rollback.sql`, com autorização.

## Riscos e pendências

- **Feriados no Preview atual:** até a publicação desta etapa, o Preview continua oferecendo 02/11.
- **Janela de 3 dias:** haverá dias sem horários (ex.: hoje, sexta após 14h30, com Finados na segunda). Aceito em R-2.
- **Testes de navegador** usam APIs simuladas. O comportamento real com o Google será conferido após a publicação.
- **Próximas etapas** (sem convite, privacidade do funil, Pixel) não foram iniciadas.

## Registro de aplicação da 0008 no Neon Preview (autorização I-1, 30/10/2026)

O projeto não tem tabela de controle de migrações (consulta: nenhuma tabela `*migrat*`). Este registro é o controle da 0008.

| Item | Valor |
|---|---|
| Organização / projeto / branch / banco | Cassiellos CRM / `cassiellos-crm` / **preview** (`br-solitary-darkness-b67vm982`) / `cassiellos_crm` |
| Confirmação técnica | Os dados batem com o CRM Preview: reunião de teste `eb80fd41` (criada pelo Preview às 09h46 de 30/10) presente e cancelada |
| Role | `cassiellos_crm_owner` (mesmo dono de todas as tabelas `crm`) |
| Arquivo | `db/migrations/0008_availability.sql`, conteúdo conferido no editor (79 linhas não vazias, SHA-256 idêntico ao arquivo) |
| Execução | 10 comandos (BEGIN, 4 CREATE TABLE, INSERT 1, 3 CREATE INDEX, COMMIT), todos com sucesso, por volta das 10h05 |
| Antes | tabelas 0008: nenhuma; leads 7; reuniões confirmed 3 / completed 1 / cancelled 1; reservas confirmed 2 / cancelled 1; processing 0 |
| Depois | 4 tabelas criadas (dono `cassiellos_crm_owner`); configuração seg–sex, 540–1080, 30 min, **180 min**, **3 dias**; blocks/exceptions/holiday_rules vazias; 7 índices; 41 restrições validadas |
| Assinaturas (antes = depois) | reuniões `33ded84c8b8863de9f7fcb1f1049a66b`; reservas `20ab5a074976db3e01899904d4b1bb0f`; leads `d27eaff0d8b7dcca0a812d78275db807` |
| Teste controlado | reunião `eb80fd41` cancelled; reserva `b87ccd78` cancelled; nenhuma reserva presa |
| CRM publicado (`dae52f7`) | agenda, reservas, painel, leads, disponibilidade administrativa e página pública respondem 200; o código atual ignora as tabelas novas |
| Vercel | nenhum erro de execução nos 30 min seguintes |

As novas regras (3 h, 3 dias, feriados) **só valem no CRM depois do deploy** desta etapa, que ainda não está autorizado.
