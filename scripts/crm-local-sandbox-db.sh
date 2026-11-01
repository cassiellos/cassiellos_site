#!/usr/bin/env bash
# CRM | Cassiellos — PostgreSQL LOCAL e DESCARTÁVEL para testes da integração Asaas (Fase 2.2A).
#
# Nunca usa Neon nem qualquer banco remoto: o servidor é iniciado por este script, escuta SOMENTE em 127.0.0.1,
# numa porta própria, num diretório próprio; variáveis de conexão herdadas (PGHOST, DATABASE_URL, CRM_DATABASE_URL…)
# são descartadas. Dados exclusivamente sintéticos. Nenhuma chamada ao Asaas.
#
# Uso:
#   scripts/crm-local-sandbox-db.sh up                 # cria (initdb) e inicia o servidor local
#   scripts/crm-local-sandbox-db.sh create NOME MODO    # cria um banco e imprime a URL de conexão
#       MODO = sandbox  0001–0016 + ligação 'sandbox' + marcador + semente sintética
#              fresh16  0001–0016, SEM ligação de ambiente (teste de isolamento)
#              pre16    0001–0015 (teste da aplicação/reversão da 0016)
#              pre12    0001–0011 (teste de atualização da 0012, suíte de regressão)
#              upto12   0001–0012 + 0015 (teste da consolidação 0013: o Financeiro atual exige a 0015)
#   scripts/crm-local-sandbox-db.sh env                # cria os bancos da suíte e imprime os "export" das variáveis
#   scripts/crm-local-sandbox-db.sh status
#   scripts/crm-local-sandbox-db.sh down               # para o servidor e APAGA o diretório (destruição total)
set -euo pipefail
unset PGHOST PGHOSTADDR PGPORT PGUSER PGPASSWORD PGDATABASE PGSERVICE PGSERVICEFILE PGPASSFILE DATABASE_URL CRM_DATABASE_URL || true

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGBIN="${CRM_LOCAL_PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
DIR="${CRM_LOCAL_PG_DIR:-/tmp/crm-local-pg}"
PORT="${CRM_LOCAL_PG_PORT:-55433}"
HOST=127.0.0.1
[[ -x "$PGBIN/pg_ctl" ]] || { echo "PostgreSQL não encontrado (defina CRM_LOCAL_PGBIN)" >&2; exit 1; }
[[ "$PORT" =~ ^[0-9]{4,5}$ ]] || { echo "porta inválida" >&2; exit 1; }
case "$DIR" in /tmp/*|/var/tmp/*|"$ROOT"/.local-pg*) ;; *) echo "diretório recusado (use /tmp/...): $DIR" >&2; exit 1;; esac

as_pg() { if [[ $(id -u) -eq 0 ]]; then su postgres -s /bin/bash -c "$*"; else bash -c "$*"; fi; }
psqlx() { PGOPTIONS="-c client_min_messages=warning" "$PGBIN/psql" -X -q -v ON_ERROR_STOP=1 -h "$HOST" -p "$PORT" -U postgres "$@"; }

up() {
  if [[ ! -f "$DIR/data/PG_VERSION" ]]; then
    mkdir -p "$DIR"; [[ $(id -u) -eq 0 ]] && chown postgres "$DIR"
    as_pg "'$PGBIN/initdb' -D '$DIR/data' -U postgres -A trust --no-locale -E UTF8 >/dev/null"
  fi
  if ! as_pg "'$PGBIN/pg_ctl' -D '$DIR/data' status" >/dev/null 2>&1; then
    as_pg "'$PGBIN/pg_ctl' -D '$DIR/data' -o \"-p $PORT -k '$DIR' -c listen_addresses=$HOST\" -l '$DIR/log' -w start" >/dev/null
  fi
  echo "servidor local: $HOST:$PORT ($DIR)"
}

migrate() { # $1 banco, $2 última migração (número)
  local f n
  for f in "$ROOT"/db/migrations/[0-9][0-9][0-9][0-9]_*.sql; do
    n=$(basename "$f" | cut -c1-4)
    [[ "10#$n" -le "10#$2" ]] || continue
    psqlx -d "$1" -f "$f" >/dev/null
  done
}

create() {
  local name="${1:?nome}" mode="${2:?modo}"
  [[ "$name" =~ ^crm_local_[a-z0-9_]{1,40}$ ]] || { echo "nome deve começar com crm_local_" >&2; exit 1; }
  psqlx -d postgres -c "DROP DATABASE IF EXISTS $name WITH (FORCE)" -c "CREATE DATABASE $name" >/dev/null
  case "$mode" in
    sandbox) migrate "$name" 16 ;;
    fresh16) migrate "$name" 16 ;;
    pre16)   migrate "$name" 15 ;;
    pre12)   migrate "$name" 11 ;;
    upto12)  migrate "$name" 12; psqlx -d "$name" -f "$ROOT/db/migrations/0015_finance_project_installments.sql" >/dev/null ;;
    *) echo "modo inválido: $mode" >&2; exit 1 ;;
  esac
  psqlx -d "$name" -v mode="$mode" -f "$ROOT/db/local/marker.sql" >/dev/null
  if [[ "$mode" == sandbox ]]; then
    psqlx -d "$name" -f "$ROOT/db/local/sandbox_seed.sql" >/dev/null
  fi
  echo "postgres://postgres@$HOST:$PORT/$name"
}

case "${1:-}" in
  up) up ;;
  create) create "${2:-}" "${3:-}" ;;
  env)
    up >/dev/null
    echo "export CRM_ASAAS_SANDBOX_DATABASE_URL=$(create crm_local_asaas_sandbox sandbox)"
    echo "export CRM_ASAAS_MIGRATION_DATABASE_URL=$(create crm_local_asaas_migration pre16)"
    echo "export CRM_ASAAS_ISOLATION_DATABASE_URL=$(create crm_local_asaas_isolation fresh16)"
    echo "export CRM_INTEGRATION_DATABASE_URL=$(create crm_local_integration fresh16)"
    echo "export CRM_FINANCE_PRE0012_DATABASE_URL=$(create crm_local_finance_pre0012 pre12)"
    echo "export CRM_FINANCE_OPS_DATABASE_URL=$(create crm_local_finance_ops upto12)"
    ;;
  status) as_pg "'$PGBIN/pg_ctl' -D '$DIR/data' status" || true ;;
  down)
    as_pg "'$PGBIN/pg_ctl' -D '$DIR/data' -m fast -w stop" >/dev/null 2>&1 || true
    rm -rf -- "$DIR"; echo "servidor local parado e diretório removido: $DIR" ;;
  *) sed -n '2,21p' "$0"; exit 1 ;;
esac
