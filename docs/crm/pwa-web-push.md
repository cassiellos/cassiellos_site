# SHARK SCALE — PWA + Web Push (Etapa 5)

O Mini CRM (`/crm`) pode ser instalado no celular como aplicativo. Ele avisa a equipe sobre:
- novos leads;
- reuniões confirmadas.

Não usa Telegram nem serviço pago de notificações.

## Arquitetura

| Parte | Onde | Observação |
|---|---|---|
| Manifesto | `app/crm/manifest.webmanifest/route.ts` | Só as rotas `/crm` o referenciam (`app/crm/layout.tsx`). Páginas públicas não viram app |
| Ícones | `public/crm-icons/` | Símbolo oficial sobre o marinho `#07101F`: 192, 512, *maskable* 512, Apple 180, *badge* 96 |
| Service worker | `app/crm-sw.js/route.ts` + `lib/crm/push/service-worker.ts` | Escopo `/crm`. **Sem cache e sem evento `fetch`**: não guarda nenhuma resposta autenticada |
| Protocolo | `lib/crm/push/web-push.ts` | Implementação nativa (node:crypto) da RFC 8291 (aes128gcm) e da RFC 8292 (VAPID). Validada contra o vetor oficial da RFC |
| Fila | `lib/crm/push/store.ts` + migração `0010_admin_web_push.sql` | Persistente, com deduplicação, ordem, tentativas e vencimento |
| Ganchos | `app/api/booking/leads` e `app/api/booking/confirm` | Só lead novo (201, `reused=false`) e reunião nova (201). Com `PWA_PUSH_ENABLED` desligada, nenhuma consulta extra |
| Painel | `app/crm/notifications-panel.tsx` (aba **Notificações**) | Status, ativar o aparelho, teste, aparelhos, preferências, mensagem do WhatsApp e histórico |
| Destinos | `/crm/notificacoes/abrir/<id>` → `/crm?lead=<id>` ou `/crm/reuniao/<id>[?whatsapp=1]` | Exigem a sessão administrativa. Sem sessão: login e volta à mesma tela (`next` seguro) |

## Privacidade do aviso

- **O aviso leva só:**
  - tipo;
  - título e texto genéricos;
  - destino `/crm/notificacoes/abrir/<id da notificação>`;
  - tag (o mesmo ID);
  - ID da entrega e recibo (HMAC).
- **Nunca leva:** nome, telefone, e-mail, respostas, link do Meet nem tokens.
- **Conteúdo cifrado de ponta a ponta para o aparelho:** o serviço de push (Google, Apple, Mozilla ou Microsoft) só transporta bytes ilegíveis.
- **Estados registrados:**
  - **aceita**: o serviço de push devolveu 201;
  - **exibida**: recibo do service worker;
  - **aberta**: toque no aviso ou abertura da tela autenticada.

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
6. Abra o aviso **✅ CONFIRMAÇÃO PRONTA!** e toque em **Enviar pelo WhatsApp**. O WhatsApp abre com o texto, e o envio continua manual.
7. Volte `PWA_PUSH_ENABLED` para `false` se a homologação não continuar.
