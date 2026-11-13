# SHARK SCALE — Ativação de Google Ads e Meta Ads (novembro/2026)

## Estado atual
- CRM: https://crm.cassiellos.com.br/crm
- Central de Inteligência: modo real, banco definitivo (Neon), vinculada ao login do CRM.
- Cliente inicial: **Mais**, cadastrado sem associação financeira e sem conta de anúncios.
- **MI_GOOGLE_ADS_ENABLED=false** e **MI_META_ADS_ENABLED=false** até conclusão das permissões e validações.
- Cofre próprio: MI_VAULT_KEYS / MI_VAULT_KEY_CURRENT (AES-256-GCM, Vercel Production). Não reutilizar CRM_GOOGLE_ENCRYPTION_KEY nem META_CAPI_ACCESS_TOKEN.
- Retorno OAuth configurado em MI_OAUTH_REDIRECT_BASE=https://crm.cassiellos.com.br.
- Dados reais de campanhas ainda não importados. Sem dados não há fallback para mock.

## Google Ads — 2026
Fontes oficiais:
- https://developers.google.com/google-ads/api/docs/api-policy/developer-token
- https://developers.google.com/google-ads/api/docs/api-policy/access-levels
- https://developers.google.com/google-ads/api/docs/oauth/overview
- https://developers.google.com/google-ads/api/docs/release-notes

**Importante, setembro/2026:** o token de desenvolvedor antigo foi descontinuado para Google Ads API e é **opcional e ignorado** em cabeçalhos. O acesso de produção é concedido ao **projeto Google Cloud proprietário das credenciais OAuth**. Não solicitar novo token na antiga API Center.

Passos externos do titular / administrador:
1. No projeto Google Cloud destinado a Ads, habilitar Google Ads API; conferir nível Explorer, Basic ou Standard para contas de produção. Test apenas não lê campanhas reais.
2. Configurar OAuth 2.0 Web Application com URI autorizada: `https://crm.cassiellos.com.br/api/crm/intel/oauth/google/callback`.
3. Guardar as credenciais exclusivamente no **Vercel → projeto cassiellos-crm → Environment Variables → Production**:
   - `MI_GOOGLE_ADS_CLIENT_ID`
   - `MI_GOOGLE_ADS_CLIENT_SECRET` (tipo sensitive)
   - `MI_GOOGLE_ADS_API_VERSION=v26` (opcional; v26 é o endpoint principal suportado)
   - `MI_GOOGLE_ADS_DEVELOPER_TOKEN` somente se já existir legado, opcional e sem efeito no novo controle de acesso.
4. Confirmar que o usuário que autorizará o CRM tem acesso às contas da Mais (diretamente ou via MCC).
5. **Somente após a verificação:** definir `MI_GOOGLE_ADS_ENABLED=true`, publicar novo deployment, clicar "Conectar Google Ads" no CRM e autorizar no Google.
6. Em Conexões e Integrações, descobrir as contas e confirmar manualmente o vínculo correto com "Mais". Não vincular pela semelhança de nome.
7. Sincronizar apenas a conta confirmada e comparar investimento, moeda/fuso e período com o gerenciador oficial.

## Meta Ads
Etapas externas do titular:
1. Usar aplicativo Meta Developers do negócio com produto Marketing API e autorização válida para os ativos de anúncios a consultar.
2. Garantir `ads_read` (e revisão/acesso avançado do aplicativo quando exigidos para outras empresas/ativos).
3. Configurar URL de retorno OAuth autorizada: `https://crm.cassiellos.com.br/api/crm/intel/oauth/meta/callback`.
4. Configurar no Vercel Production, sem colar segredos em chat:
   - `MI_META_APP_ID`
   - `MI_META_APP_SECRET` (sensitive)
   - `MI_META_GRAPH_VERSION` (opcional, confirmar versão atual habilitada)
   - `MI_META_SYSTEM_USER_TOKEN` **somente** se optar pelo fluxo autorizado de usuário de sistema.
5. **Somente após verificação:** ativar `MI_META_ADS_ENABLED=true`, publicar, conectar via OAuth ou usuário de sistema autorizado.
6. Descobrir contas de anúncios disponíveis, validar ID com o titular, confirmar vínculo explícito à Mais, sincronizar e reconciliar com Ads Manager.

## Regras de proteção
- Não pedir senhas, refresh tokens ou client secrets em conversas, issues, commits ou logs.
- Não usar credenciais existentes de Google Calendar nem Meta CAPI como se fossem permissões de Ads Insights.
- Não criar, editar ou pausar anúncios; modo leitura.
- Não ligar provedores sem credenciais e consentimento válidos; evitar simulados.
- Primeiro validar uma plataforma e uma conta da Mais; liberar as demais contas após reconciliação.
- Nenhuma cron automática antes de autorização.
- Rotação do cofre exige conservar chave anterior até recriptografar credenciais (quando existirem).

## Critério de aceite
- Conexão OAuth autorizada e armazenada criptografada.
- Conta descoberta aparece com ID correto, moeda, fuso e status.
- Somente vínculo confirmado com Mais fornece métricas na Visão do cliente.
- Números reais conciliados com origem e período, sem mistura Google/Meta.
- Sessão/logon e todos os demais módulos do CRM preservados.
