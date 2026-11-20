/**
 * Provas da home (resultados, depoimentos, prêmios, parceiros, artigos).
 *
 * Tudo que for `null` ainda não foi fornecido pela Cassiellos. Enquanto
 * SHOW_PLACEHOLDERS for true, o site mostra um quadro "a preencher" com a
 * orientação; com false, o item vazio simplesmente não aparece.
 * Nunca inventar números, depoimentos ou selos: só dado real e autorizado.
 */
export const SHOW_PLACEHOLDERS = false

export type CaseProof = {
  client: string
  logo: string
  logoAlt: string
  /** Depoimento real, com autorização por escrito do cliente. */
  quote: string | null
  /** Resumo do trabalho (1 a 2 frases). */
  summary: string
  author: { name: string; role: string; photo: string | null } | null
  /** Resultado medido: valor, unidade e o que foi medido, no período informado. */
  metric: { value: number; prefix?: string; suffix: string; label: string } | null
}

export const CASES: Record<'pt' | 'en', CaseProof[]> = {
  pt: [
    { client: 'Minds English School', logo: '/client-logos/current/minds.png', logoAlt: 'Logo da Minds English School', quote: null, summary: 'Estratégia, conteúdo, campanhas e comunicação conectados à rotina comercial e institucional da escola.', author: null, metric: null },
    { client: 'Gira Moto Peças', logo: '/client-logos/current/gira-official.svg', logoAlt: 'Logo da Gira Moto Peças', quote: null, summary: 'Conteúdo, posicionamento, audiovisual e campanhas para uma operação que reúne loja, oficina e comunidade.', author: null, metric: null },
    { client: 'Escola Santa Rita', logo: '/client-logos/current/santa-rita.png', logoAlt: 'Logo da Escola de Enfermagem Santa Rita', quote: null, summary: 'Comunicação, conteúdo e campanhas para cursos técnicos, matrículas e relacionamento com futuros alunos.', author: null, metric: null },
  ],
  en: [
    { client: 'Minds English School', logo: '/client-logos/current/minds.png', logoAlt: 'Minds English School logo', quote: null, summary: 'Strategy, content, campaigns and communication connected to the school’s commercial and institutional routine.', author: null, metric: null },
    { client: 'Gira Moto Peças', logo: '/client-logos/current/gira-official.svg', logoAlt: 'Gira Moto Peças logo', quote: null, summary: 'Content, positioning, audiovisual and campaigns for an operation that brings store, workshop and community together.', author: null, metric: null },
    { client: 'Escola Santa Rita', logo: '/client-logos/current/santa-rita.png', logoAlt: 'Escola Santa Rita logo', quote: null, summary: 'Communication, content and campaigns for technical courses, enrollment and relationships with future students.', author: null, metric: null },
  ],
}

/** Logos extras para a grade de clientes (além dos 3 cases). `null` = vaga a preencher. */
export const EXTRA_CLIENT_LOGOS: ({ src: string; alt: string } | null)[] = [null, null, null]

/** Prêmios, selos ou certificações reais (ex.: parceiro oficial de plataforma). */
export const AWARDS: ({ src: string; alt: string } | null)[] = [null, null, null]

/** Plataformas e parceiros: só com selo oficial ou autorização de uso da marca. */
export const PARTNERS: ({ src: string; alt: string } | null)[] = [null, null, null, null]

/** Artigos ou materiais publicados pela Cassiellos. */
export type Article = { title: string; href: string; image: string | null; date: string } | null
export const ARTICLES: Article[] = [null, null, null]

/** Redes sociais oficiais. `null` = não exibir o ícone. */
export const SOCIALS: { name: string; href: string | null }[] = [
  { name: 'Instagram', href: null },
  { name: 'LinkedIn', href: null },
  { name: 'YouTube', href: null },
  { name: 'TikTok', href: null },
]

/** Orientação exibida nos quadros vazios. */
export const GUIDE = {
  pt: {
    quote: 'Depoimento real do cliente (2 a 3 linhas), com autorização por escrito.',
    author: 'Nome, cargo e foto de quem deu o depoimento.',
    metric: 'Resultado medido: ex. "↑ 180% em leads no Instagram em 6 meses" (com fonte e período).',
    logo: 'Logo de cliente, com autorização para exibir a marca.',
    award: 'Prêmio, selo ou certificação (ex.: Meta Business Partner, Google Partner).',
    partner: 'Plataforma ou parceiro oficial, só com selo ou autorização.',
    article: 'Artigo ou case publicado pela Cassiellos (título, imagem e link).',
  },
  en: {
    quote: 'Real client testimonial (2–3 lines), with written permission.',
    author: 'Name, role and photo of the person quoted.',
    metric: 'Measured result: e.g. "↑ 180% Instagram leads in 6 months" (with source and period).',
    logo: 'Client logo, with permission to display the brand.',
    award: 'Award, badge or certification (e.g. Meta Business Partner, Google Partner).',
    partner: 'Official platform or partner, only with badge or permission.',
    article: 'Article or case published by Cassiellos (title, image and link).',
  },
} as const
