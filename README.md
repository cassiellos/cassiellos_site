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

## Deploy

O projeto atual na Vercel (`agencia-cassiellos-public`) serve um HTML estático.
Para publicar esta versão, aponte o projeto para este diretório — a Vercel detecta o
Next.js automaticamente; não é necessário `outputDirectory`. Os headers de segurança
do `vercel.json` antigo foram transferidos para `next.config.mjs`.
