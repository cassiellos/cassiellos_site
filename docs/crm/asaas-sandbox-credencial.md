# Asaas Sandbox — chave de API (procedimento do titular)

Fase 2.2B. Somente o **titular** executa estes passos, no **próprio computador**, fora de qualquer sessão de agente.
A chave **nunca** é digitada no chat, colada em prompts, gravada em arquivo `.env`, enviada ao GitHub, configurada na
Vercel nem guardada no banco.

## 1. Gerar a chave no painel Sandbox

1. Entre em `https://sandbox.asaas.com` (conta Sandbox da Cassiellos — **não** a conta Production).
2. Abra **Integrações → Chaves de API** (o rótulo pode variar; é a área de chaves de API).
3. Gere uma nova chave com:
   - **Nome:** `crm-cassiellos-local-leitura-2.2B`
   - **Expiração:** a mais curta disponível que cubra a homologação (ex.: 7 a 30 dias).
4. Confira que a chave começa com `$aact_hmlg_` (Sandbox). Se começar com `$aact_prod_`, **pare**: é Production.
5. O painel mostra a chave uma única vez. Copie-a e siga direto para o passo 2 (não cole em nenhum outro lugar).

## 2. Guardar a chave no cofre do sistema (entrada oculta)

O comando abaixo **pergunta** a chave sem exibi-la (não vai para o histórico do terminal). Cole quando pedido.

**macOS (Keychain):**

```bash
security add-generic-password -s cassiellos-crm-asaas-sandbox -a api-key -U -w
```

**Linux (GNOME Keyring / Secret Service):**

```bash
secret-tool store --label="Cassiellos CRM Asaas Sandbox" service cassiellos-crm-asaas-sandbox account api-key
```

Depois, limpe a área de transferência (macOS):

```bash
pbcopy < /dev/null
```

Nunca use `-w <chave>` com o valor na linha, `echo`, `export`, arquivos ou variáveis de ambiente.

## 3. Executar a consulta somente leitura

No seu terminal (não dentro do Claude Code), na pasta do repositório com os commits da Fase 2.2B:

```bash
node --import tsx scripts/asaas-sandbox-probe.ts --confirmo-somente-leitura
```

Na primeira execução o macOS pode pedir permissão para o `security` ler o item: permita **somente** para esse uso.

O script faz exatamente 4 consultas GET de listagem (clientes, cobranças, assinaturas) e imprime um relatório
sanitizado — status, tempos, contagens e nomes de campos. **Esse relatório pode ser colado na conversa**; ele não
contém a chave nem dados de registros. O script se recusa a rodar dentro de uma sessão de agente.

## 4. Remover a chave ao final da homologação

```bash
security delete-generic-password -s cassiellos-crm-asaas-sandbox -a api-key
```

(Linux: `secret-tool clear service cassiellos-crm-asaas-sandbox account api-key`.) E revogue/exclua a chave no painel
Sandbox, ou deixe-a expirar.
