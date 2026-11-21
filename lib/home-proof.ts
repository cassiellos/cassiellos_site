/**
 * Provas da home (resultados, depoimentos, prêmios, parceiros, artigos).
 *
 * Tudo que for `null` ainda não foi fornecido pela Cassiellos. Quando
 * SHOW_PLACEHOLDERS é true, o site mostra o quadro-modelo "a preencher" com a
 * orientação; com false, o item vazio simplesmente não aparece.
 * Os modelos aparecem só em prévias da Vercel e no ambiente local
 * (NEXT_PUBLIC_SHOW_PLACEHOLDERS=1); em produção ficam sempre desligados.
 * Depoimento e número atribuídos a um cliente real precisam ser verdadeiros
 * e aprovados por ele (CDC art. 37 e Código do CONAR).
 */
export const SHOW_PLACEHOLDERS =
  process.env.NEXT_PUBLIC_VERCEL_ENV === 'preview' || process.env.NEXT_PUBLIC_SHOW_PLACEHOLDERS === '1'

export type CaseProof = {
  client: string
  logo: string
  /** Versão monocromática opcional para os cartões escuros (quando o filtro branco apaga detalhes). */
  logoMono?: string
  logoAlt: string
  /**
   * Depoimento aprovado pelo cliente? Enquanto `false`, frase, autor e foto são
   * RASCUNHO: aparecem só na prévia (para mostrar e aprovar com o cliente) e
   * nunca em produção. Virar `true` só com o OK do cliente e nome/foto reais.
   */
  approved: boolean
  /** Depoimento (rascunho até `approved`). */
  quote: string | null
  /** Texto de apoio abaixo da frase (continuação do depoimento ou resumo do trabalho). Corta em 2 linhas. */
  summary: string
  /** Quem deu o depoimento. Sem foto, aparece um círculo com as iniciais. Os de `/avatars/exemplo-*` são ilustrações de exemplo. */
  author: { name: string; role: string; photo: string | null } | null
  /** Resultado medido: valor, unidade e o que foi medido, no período informado. */
  metric: { value: number; prefix?: string; suffix: string; label: string } | null
  /** Link do "Leia mais" (case completo, post ou vídeo). `null` = sem link. */
  href: string | null
}

export const CASES: Record<'pt' | 'en', CaseProof[]> = {
  pt: [
    { client: 'Minds English School', logo: '/client-logos/current/minds.png', logoAlt: 'Logo da Minds English School', approved: false, quote: 'Hoje a Minds aparece com constância, e as famílias já chegam sabendo quem somos.', summary: 'Conteúdo e campanhas de matrícula que viraram canal de captação.', author: { name: 'Camila Rezende', role: 'Diretora pedagógica', photo: '/avatars/exemplo-1.svg' }, metric: null, href: null },
    { client: 'Gira Moto Peças', logo: '/client-logos/current/gira-official.svg', logoAlt: 'Logo da Gira Moto Peças', approved: false, quote: 'A Gira deixou de ser só mais uma loja de peças e virou ponto de encontro de quem vive de moto.', summary: 'Audiovisual e campanhas para loja, oficina e comunidade motociclista.', author: { name: 'Rafael Gomes', role: 'Sócio-proprietário', photo: '/avatars/exemplo-2.svg' }, metric: null, href: null },
    { client: 'Escola Santa Rita', logo: '/client-logos/current/santa-rita.png', logoAlt: 'Logo da Escola de Enfermagem Santa Rita', approved: false, quote: 'Nossa comunicação ganhou a seriedade que a enfermagem pede, e os alunos certos começaram a chegar.', summary: 'Campanhas para cursos técnicos de enfermagem, do contato à matrícula.', author: { name: 'Patrícia Moura', role: 'Coordenadora de matrículas', photo: '/avatars/exemplo-3.svg' }, metric: null, href: null },
    { client: 'Auto Perícia Virtual', logo: '/client-logos/current/auto-pericia.png', logoAlt: 'Logo da Auto Perícia Virtual', approved: false, quote: 'Precisávamos explicar uma ideia nova em segundos. A marca passou a fazer isso por nós.', summary: 'Marca e comunicação digital para a perícia veicular feita pelo celular.', author: { name: 'Eduardo Lima', role: 'Fundador', photo: '/avatars/exemplo-4.svg' }, metric: null, href: null },
    { client: 'Instituto Mineiro de Perícias', logo: '/client-logos/current/imp.svg', logoMono: '/client-logos/current/imp-mono.svg', logoAlt: 'Logo do Instituto Mineiro de Perícias', approved: false, quote: 'A marca passou a transmitir a credibilidade técnica que o nosso trabalho sempre teve.', summary: 'Identidade, site institucional e marketing digital para perícias técnicas.', author: { name: 'Mariana Costa', role: 'Diretora técnica', photo: '/avatars/exemplo-5.svg' }, metric: null, href: null },
    { client: 'Terriê Serralheria', logo: '/client-logos/current/terrie.png', logoAlt: 'Logo da Terriê Serralheria', approved: false, quote: 'Antes dependíamos só de indicação. Agora o cliente nos encontra no Google e já chega pedindo orçamento.', summary: 'Identidade visual, site e presença no Google para uma serralheria.', author: { name: 'Thiago Ferreira', role: 'Proprietário', photo: '/avatars/exemplo-6.svg' }, metric: null, href: null },
  ],
  en: [
    { client: 'Minds English School', logo: '/client-logos/current/minds.png', logoAlt: 'Minds English School logo', approved: false, quote: 'Minds now shows up consistently, and families arrive already knowing who we are.', summary: 'Content and enrollment campaigns that became a student acquisition channel.', author: { name: 'Camila Rezende', role: 'Academic director', photo: '/avatars/exemplo-1.svg' }, metric: null, href: null },
    { client: 'Gira Moto Peças', logo: '/client-logos/current/gira-official.svg', logoAlt: 'Gira Moto Peças logo', approved: false, quote: 'Gira stopped being just another parts store and became a meeting point for people who live on two wheels.', summary: 'Audiovisual and campaigns for store, workshop and rider community.', author: { name: 'Rafael Gomes', role: 'Co-owner', photo: '/avatars/exemplo-2.svg' }, metric: null, href: null },
    { client: 'Escola Santa Rita', logo: '/client-logos/current/santa-rita.png', logoAlt: 'Escola Santa Rita logo', approved: false, quote: 'Our communication gained the seriousness nursing demands, and the right students started to arrive.', summary: 'Campaigns for technical nursing courses, from first contact to enrollment.', author: { name: 'Patrícia Moura', role: 'Enrollment coordinator', photo: '/avatars/exemplo-3.svg' }, metric: null, href: null },
    { client: 'Auto Perícia Virtual', logo: '/client-logos/current/auto-pericia.png', logoAlt: 'Auto Perícia Virtual logo', approved: false, quote: 'We needed to explain a new idea in seconds. The brand now does that for us.', summary: 'Brand and digital communication for vehicle inspections by smartphone.', author: { name: 'Eduardo Lima', role: 'Founder', photo: '/avatars/exemplo-4.svg' }, metric: null, href: null },
    { client: 'Instituto Mineiro de Perícias', logo: '/client-logos/current/imp.svg', logoMono: '/client-logos/current/imp-mono.svg', logoAlt: 'Instituto Mineiro de Perícias logo', approved: false, quote: 'Our brand now conveys the technical credibility our work has always had.', summary: 'Identity, institutional website and digital marketing for forensics.', author: { name: 'Mariana Costa', role: 'Technical director', photo: '/avatars/exemplo-5.svg' }, metric: null, href: null },
    { client: 'Terriê Serralheria', logo: '/client-logos/current/terrie.png', logoAlt: 'Terriê Serralheria logo', approved: false, quote: 'We used to rely only on referrals. Now clients find us on Google and arrive asking for a quote.', summary: 'Visual identity, website and Google presence for a metalwork shop.', author: { name: 'Thiago Ferreira', role: 'Owner', photo: '/avatars/exemplo-6.svg' }, metric: null, href: null },
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
