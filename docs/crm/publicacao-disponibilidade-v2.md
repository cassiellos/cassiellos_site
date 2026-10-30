# Disponibilidade V2 — plano de publicação e recuperação

**Status: preparado, NÃO executado.** Nada foi enviado ao GitHub, publicado no Vercel ou aplicado no Neon.

## 0. O que será publicado

| Item | Valor |
|---|---|
| Base publicada (Preview) | `feature/mini-crm-shark-scale` @ `c366dc3` (deploy `dpl_F6EZwFiQPhaxaSMBtGCYXnxAeWtM`) |
| Código V2 | `local/availability-v2-prep`: `f26d0a1` (V2) + commit D1 (capacidade inicialmente desligada e `lock_timeout` na 0009). O push é fast-forward a partir de `c366dc3` |
| Migração | `db/migrations/0009_availability_capacity.sql`: SHA-256 do arquivo `06ecb08a…c26f`; 67 linhas não vazias, SHA-256 das linhas não vazias `77eb815a…adf2` (conferência no editor do Neon) |
| Recuperação | `db/ops/0009_rollback.sql` e `db/ops/0009_pre_post_checks.sql` (somente leitura) |

Regras finais: antecedência de 2 h, inícios das 09h00 às 18h00, reuniões de 30 min (a última termina às 18h30), janela de 3 dias corridos e capacidade diária **desligada** até ser ativada pelo painel.

## 1. Ordem recomendada: código primeiro, migração depois

| Fase | Ação | Efeito para o visitante |
|---|---|---|
| A | Push e deploy do código V2 | **Nenhum.** O banco ainda guarda 3 h e término 18h00, e a capacidade aparece como "Migração 0009 pendente" (desligada) |
| B | Aplicar a 0009 no Neon Preview | **Momento único da troca:** 2 h e último início 18h00. A capacidade é criada desligada, sem nenhuma reserva interna |
| C (futuro, com autorização) | Ativar a capacidade pelo painel | De 3 a 4 horários por dia útil deixam de ser oferecidos |

Por que esta ordem:

1. O deploy não muda regra nenhuma. Se der problema, volta-se ao código anterior sem tocar no banco.
2. A troca de regra comercial acontece num único ponto controlado (a 0009) e já com o painel novo no ar.
3. A ordem inversa também funcionaria: o código publicado aceita a 0009 e já aplicaria 2 h e 18h00. Mas a regra mudaria antes do painel novo, que mostra "Último início" (o antigo mostraria "Término 18:30").

## 2. Pré-requisitos

- Sessão com **permissão de escrita** no repositório `cassiellos/cassiellos_site`. Nesta sessão o acesso é **negado** (403 "not in this session's authorized repository set"). Alternativa: você faz o push pelo seu computador a partir do bundle.
- Autorização explícita para cada fase (A, B e C separadamente).

## 3. Verificações antes (somente leitura)

1. `git ls-remote`: a feature deve estar em `c366dc3` e a `main` em `e998bf1`.
2. Bundle: SHA-256 conferido, `git bundle verify` ok, fetch para uma branch local e conferir o hash completo do commit.
3. Testes, verificação de tipos e build no commit a publicar.
4. Vercel: o deploy atual deve estar READY no commit `c366dc3`, sem erros de execução.
5. Neon Preview: rodar as conferências 1 a 3 de `0009_pre_post_checks.sql` e guardar o resultado. Esperado:
   - configuração 180 / 1080;
   - tabelas da 0009 ausentes;
   - assinaturas de leads `d27eaff0…`, reuniões `33ded84c…` e reservas `20ab5a07…`, ou novas se houver movimento real. Neste caso, anotar.

## 4. Fase A — código

1. `git push --dry-run origin <commit>:refs/heads/feature/mini-crm-shark-scale`. **Se houver 403 ou outra restrição, PARAR.**
2. `git push origin <commit>:refs/heads/feature/mini-crm-shark-scale`. É um fast-forward, sem `--force` e somente para a feature.
3. Aguardar o deploy do Vercel ficar READY e conferir o commit e o alias `crm.cassiellos.com.br`.

**Depois da Fase A (somente leitura):**

- CRM e painel carregam.
- DISPONIBILIDADE mostra "Último início 17:30 · termina às 18:00", antecedência 3 e janela 3.
- A capacidade aparece como "Migração 0009 pendente", com os controles bloqueados.
- A consulta de horários de um dia útil termina às 17:30, sem mudança para o visitante.
- O formulário público carrega.
- Nenhum erro de execução no Vercel.
- As assinaturas no Neon estão inalteradas.

**Recuperação da Fase A (banco intocado):**

- Opção 1: apontar `crm.cassiellos.com.br` de volta para `dpl_F6EZwFiQPhaxaSMBtGCYXnxAeWtM` no Vercel. É imediato e exige autorização de alteração no Vercel (somente Preview).
- Opção 2: push de um commit de reversão na feature.
- Se o build falhar, o alias continua no deploy anterior, sem indisponibilidade.

## 5. Fase B — migração 0009 (Neon Preview)

1. Abrir o editor SQL no projeto `cassiellos-crm`, branch **preview**, banco `cassiellos_crm`, role `cassiellos_crm_owner`.
2. Colar a 0009 e conferir o conteúdo do editor: 67 linhas não vazias e SHA-256 das linhas não vazias `77eb815a…adf2`.
3. Executar **uma vez**. Esperado: 11 comandos com sucesso em menos de 1 s.
   - Se aparecer "lock timeout", nada foi alterado. Aguardar e repetir uma única vez, com autorização.

**Depois da Fase B:**

- Conferências 2 a 4 de `0009_pre_post_checks.sql`:
  - configuração 120 / 1110 com `updated_by = migration:0009`;
  - capacidade com `enabled = false`, 3–4, 720–810, semente 1;
  - nenhum ajuste por data;
  - assinaturas **idênticas** às de antes.
- CRM:
  - painel com "Último início 18:00 · termina às 18:30", antecedência 2 e capacidade "DESLIGADA" com prévia tracejada;
  - consulta de horários de um dia útil terminando em 18:00 e sem 18:30;
  - primeiro horário de hoje igual a agora + 2 h, arredondado para o próximo slot de 30 min.
- Formulário público carregando.
- Nenhum erro no Vercel nos 30 min seguintes.
- Nenhuma reunião criada ou cancelada.

**Recuperação da Fase B:**

| Nível | Como | Efeito |
|---|---|---|
| B1 (regra comercial) | Painel → Horário comercial: antecedência 3 e último início 17:30 → Salvar | Volta à regra anterior sem SQL e sem deploy |
| B2 (estrutura) | `db/ops/0009_rollback.sql`, com autorização | Remove só as 2 tabelas novas e volta a 180 / 1080 se a linha ainda estiver como a 0009 deixou. O código V2 continua funcionando sem a 0009 (capacidade "pendente") |

Nenhum nível toca em leads, reuniões, reservas, bloqueios, exceções, feriados ou Google.

## 6. Fase C — ativar a capacidade (futuro)

- **Ativar:** painel → marcar "Reservas automáticas ativas" → Salvar. A prévia mostrada passa a valer exatamente.
- **Desfazer:** desmarcar e Salvar.
- Reuniões confirmadas nunca são alteradas. Se uma reserva interna coincidir com uma reunião existente, o painel apenas sinaliza.

## 7. Garantias verificadas (local)

- **Nenhuma reunião fictícia.** O código novo só grava em `availability_capacity` e `availability_capacity_overrides`. Nenhuma chamada nova ao Google e nenhum arquivo de reserva, confirmação, Google, autenticação ou allowlist foi alterado.
- **Reuniões confirmadas intactas.** Teste em banco mostra reunião e reserva idênticas antes e depois de reservar, desligar, redistribuir e desligar a capacidade.
- **Allowlist ativa.** `CRM_BOOKING_ALLOWED_EMAIL` continua configurada só no Preview da feature, e o fluxo de confirmação não foi alterado.
- **Compatibilidade testada:**

  | Código \ Banco | Só 0008 | Com 0009 |
  |---|---|---|
  | Publicado `c366dc3` | 3 h / 17:30 | 2 h / 18:00 |
  | Novo V2 | 3 h / 17:30, capacidade pendente | 2 h / 18:00, capacidade desligada |

  Em todos os casos, início às 18h30 é recusado (409).
