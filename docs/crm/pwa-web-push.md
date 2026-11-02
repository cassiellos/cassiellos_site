# SHARK SCALE — PWA + Web Push (Etapa 5)

O Mini CRM (`/crm`) pode ser instalado no celular como aplicativo. Ele avisa a equipe sobre:
- novos leads;
- reuniões confirmadas.

Não usa Telegram nem serviço pago de notificações.

## Arquitetura

| Parte | Onde | Observação |
|---|---|---|
| Manifesto | `app/crm/manifest.webmanifest/route.ts` | Só as rotas `/crm` o referenciam (`app/crm/layout.tsx`). Páginas públicas não viram app |
| Ícones | `lib/crm/cassiellos-icon.ts` + `/crm/icon/{variant}.png` | Logo oficial Cassiellos vetorizado a partir da imagem fornecida, com texto CRM; 192, 512, *maskable* 512, Apple 180, *badge* 96; URLs versionadas para impedir cache |
| Service worker | `app/crm-sw.js/route.ts` + `lib/crm/push/service-worker.ts` | Escopo `/crm`. **Sem cache e sem evento `fetch`**: não guarda nenhuma resposta autenticada |
| Protocolo | `lib/crm/push/web-push.ts` | Implementação nativa (node:crypto) da RFC 8291 (aes128gcm) e da RFC 8292 (VAPID). Validada contra o vetor oficial da RFC |
| Fila | `lib/crm/push/store.ts` + migração `0010_admin_web_push.sql` | Persistente, com deduplicação, ordem, tentativas e vencimento |
| Ganchos | `app/api/booking/leads` e `app/api/booking/confirm` | Só lead novo (201, `reused=false`) e reunião nova (201). Com `PWA_PUSH_ENABLED` desligada, nenhuma consulta extra |
| Painel | `app/crm/notifications-panel.tsx` (aba **Notificações**) | Status, ativar o aparelho, teste, aparelhos, preferências, mensagem do WhatsApp e histórico |
| Destinos | `/crm/notificacoes/abrir/<id>` → `/crm?lead=<id>`, `/crm/reuniao/<id>` ou `/crm/reuniao/<id>/whatsapp` | Exigem sessão administrativa; o último abre o WhatsApp com o texto preparado, mas não envia mensagem sozinho. Sem sessão: login → destino seguro |

## Notificações compactas (versão mobile aprovada em 02/11/2026)

A apresentação do aviso depende do sistema operacional (iOS/Android). O app usa o nome `CRM Cassiellos` no manifesto, mas um PWA já instalado pode conservar o nome antigo até ser reinstalado. O ícone permanece o oficial.

| Evento | Título | Corpo quando houver dados válidos |
|---|---|---|
| Lead | 👤 Novo lead | Juliana preencheu o formulário |
| Reunião | 📅 Novo agendamento | Márcio marcou quarta-feira às 9h30 |
| WhatsApp | 💬 Enviar WhatsApp | Enviar confirmação para Márcio |
| Teste | ✅ Teste de notificações | Notificações funcionando. |

**Sem frases "toque para abrir/ver"** e sem informações desnecessárias.

## Privacidade do aviso

- **A solicitação explícita do administrador inclui mostrar o PRIMEIRO nome e o dia/horário da reunião na notificação móvel.** Esses dados podem aparecer mesmo com o aparelho bloqueado; só habilite notificações em aparelhos pessoais protegidos por senha/biometria.
- O payload **cifrado para o aparelho** inclui apenas: tipo, título e mensagem (primeiro nome quando válido + dia/horário para reunião), destino interno opaco, tag, ID da entrega e recibo HMAC. Apple/Google/Mozilla transportam o payload criptografado.
- **Nunca enviar no push:** nome completo, telefone, e-mail, respostas do formulário, link do Meet, orçamento, dados financeiros, texto completo do WhatsApp, credenciais ou tokens.
- O nome e horário são consultados do CRM ao enviar cada aviso, **sem cópia nas tabelas de notificações ou nos logs**. Quando faltar dado, usar corpo genérico.
- WhatsApp: tocar no segundo aviso faz a sequência `/crm/notificacoes/abrir/<id>` → autenticação → `/crm/reuniao/<id>/whatsapp` → redirecionamento `https://wa.me/...` com número e texto previamente verificados.
- O administrador precisa **tocar em Enviar no WhatsApp**. O CRM não dispara mensagens automaticamente e não usa a API paga.
- Sem telefone válido, com reunião cancelada/encerrada ou link Meet pendente, o redirecionamento volta à ficha da reunião, com a opção manual.
- **Estados registrados:** aceita pelo serviço ≠ exibida no aparelho ≠ aberta no toque. O clique autenticado continua marcado por ID.

## Entrega confiável sem Cron

- A Vercel só executa Cron em deploys de **Production**; o CRM roda no **Preview**.
- **Ordem de cada evento:**
  1. A fila é gravada **antes** da resposta, com prazo de 1,5 s. Se demorar ou falhar, o cadastro e a reunião não são afetados.
  2. O envio roda com `after()`.
  3. Novas tentativas acontecem:
     - no próximo evento;
     - quando o administrador abre o CRM;
     - pelo botão **Reprocessar**.
- **Repetir é seguro:** a tag fixa faz o aparelho substituir o aviso em vez de duplicar.
- **Limites:**
  - até 5 tentativas;
  - a fila vence em 24 h;
  - reunião cancelada não recebe aviso;
  - aparelho com 404/410 vira "expirado";
  - aparelho com 401/403 vira "precisa autorizar de novo".
- **Futuro, opcional:** a rota `/api/crm/push/process`, com `Authorization: Bearer <CRM_PUSH_PROCESS_SECRET>`, para um agendador. Fica desligada sem o segredo.

## Variáveis (Vercel → Preview → branch `feature/mini-crm-shark-scale`)

| Variável | Tipo | Valor |
|---|---|---|
| `PWA_PUSH_ENABLED` | Plain | `false` até a homologação. Ausente = desligada. Liga só os avisos automáticos |
| `VAPID_PUBLIC_KEY` | Plain | Chave pública (base64url, 87 caracteres) |
| `VAPID_PRIVATE_KEY` | **Sensitive** | Chave privada (base64url, 43 caracteres). Nunca no GitHub |
| `VAPID_SUBJECT` | Plain (opcional) | Padrão: `https://crm.cassiellos.com.br` |

Com as chaves VAPID e a migração aplicada, já é possível:
- autorizar o aparelho;
- enviar o **teste**, mesmo com `PWA_PUSH_ENABLED` desligada.

Avisos de leads e reuniões exigem `PWA_PUSH_ENABLED=true`.

### Gerar o par VAPID

Rode **no seu computador**, dentro do repositório. Não cole a chave privada em chats, issues nem commits.

```bash
npx tsx -e "import { generateVapidKeys } from './lib/crm/push/web-push'; const k = generateVapidKeys(); console.log('VAPID_PUBLIC_KEY=' + k.publicKey); console.log('VAPID_PRIVATE_KEY=' + k.privateKey)"
```

Trocar o par invalida as inscrições existentes. Os aparelhos precisam ser autorizados de novo, e o painel indica isso.

## Homologação no celular

1. **Android (Chrome):** abra `https://crm.cassiellos.com.br/crm`, entre e use **Instalar aplicativo** (aba Notificações ou menu do Chrome).
2. **iPhone (iOS 16.4 ou mais novo):**
   - abra no Safari;
   - toque em **Compartilhar → Adicionar à Tela de Início**;
   - abra o **SHARK SCALE** pelo ícone e entre.
3. No app, abra **Notificações → Ativar notificações neste aparelho** e permita.
4. Toque em **Enviar teste**, feche o app e confirme o aviso. Tocar nele deve abrir o CRM.
5. Com `PWA_PUSH_ENABLED=true`, só no Preview:
   - envie um lead fictício pelo formulário;
   - depois, faça uma reunião fictícia controlada, autorizada e cancelada em seguida.
6. Abra o aviso **💬 Enviar WhatsApp**. Ele deve abrir a conversa com a mensagem preparada, após autenticação quando necessário; apenas o envio da mensagem permanece manual.
7. Volte `PWA_PUSH_ENABLED` para `false` se a homologação não continuar.
