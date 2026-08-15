# Site Agência Cassiellos

Reconstrução do site institucional em **Next.js 15 (App Router + TypeScript)**, mantendo
a identidade visual da versão anterior — mesmas cores, tipografia, proporções e textos.

Site atual em produção: https://agencia-cassiellos-public.vercel.app

## Comandos

```bash
npm install
npm run dev     # http://localhost:3000
npm run build   # build de produção (páginas estáticas)
npm start
```

## O que foi adicionado

| Recurso | Onde |
| --- | --- |
| Smooth scroll global (Lenis) + âncoras interceptadas | `components/smooth-scroll.tsx`, `lib/scroll.ts` |
| Parallax do hero (malha, brilho, órbita, texto) | `components/hero.tsx` |
| Parallax do painel cassiellOS | `components/os-section.tsx` |
| Parallax do orbe do Levi | `components/levi-section.tsx` |
| Parallax do brilho da seção de contato | `components/contact.tsx` |
| Animações de entrada por rolagem (reutilizável) | `components/reveal.tsx` |
| Régua do método que preenche conforme a rolagem | `components/method.tsx` |
| Barra de progresso de leitura | `components/scroll-progress.tsx` |
| Menu com item ativo por seção visível | `components/site-nav.tsx` |
| Chat do Levi com estado React, indicador de digitação e Esc para fechar | `components/levi-widget.tsx`, `components/levi-provider.tsx` |

## Identidade visual

Os tokens originais estão preservados em `app/globals.css`:

```
--n #07101f   --w #ffffff   --g #a8b4c9   --l #263650
--r #f13c4b   --b #246bff   --v #7b35f5   --c #22c7f2
```

A fonte Inter agora é realmente carregada (via `next/font`); antes o navegador caía
para Arial porque a família nunca era importada.

## Acessibilidade e robustez

- Todo o movimento respeita `prefers-reduced-motion` (Lenis nem chega a iniciar).
- `:focus-visible` consistente em links, botões e campos.
- Sem JavaScript, um `<noscript>` neutraliza os estados iniciais das animações para que
  o conteúdo continue visível.

## SEO e medição

- `app/opengraph-image.tsx` gera o card de compartilhamento (1200×630) com a marca.
  O Inter é buscado em TTF no momento do build, porque o Satori não lê o woff2 que o
  `next/font` entrega; se a rede falhar, o card cai na fonte padrão em vez de quebrar.
- `app/robots.ts` e `app/sitemap.ts` geram `/robots.txt` e `/sitemap.xml`.
- Vercel Analytics e Speed Insights ativos no layout.

## Deploy

Projeto Vercel: `cassiellos-projects/agencia-cassiellos-public`.

O `vercel.json` declara `framework: "nextjs"` — sem isso a plataforma servia a pasta
`public/` (herança da versão em HTML estático) e a raiz respondia 404. Os headers de
segurança do `vercel.json` antigo vivem agora em `next.config.mjs`.

```bash
npx vercel deploy          # preview
npx vercel deploy --prod   # produção
```
