import { SITE_CITY, SITE_COUNTRY, SITE_DESCRIPTION, SITE_NAME, SITE_REGION, SITE_URL } from '@/lib/site'
import { WHATSAPP_CONTACT_URL } from '@/lib/site-links'

/**
 * Dados estruturados (schema.org, JSON-LD) para buscadores.
 * Só fatos confirmados: cidade-sede, área de atuação, serviços, fundadores e contato.
 * Endereço completo, telefone, horário e redes sociais entram quando forem informados.
 */
const SERVICES = [
  'Estratégia e posicionamento de marketing',
  'Branding e design',
  'Gestão de conteúdo e redes sociais',
  'Tráfego pago e mídia paga',
  'Produção de vídeo e motion design',
  'Criação de sites e landing pages',
]

const ORG_ID = `${SITE_URL}/#organizacao`

function graph() {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': ['Organization', 'ProfessionalService'],
        '@id': ORG_ID,
        name: SITE_NAME,
        legalName: 'Agência Cassiellos',
        alternateName: ['Agência Cassiellos', 'Cassiellos Agência de Marketing'],
        description: SITE_DESCRIPTION,
        url: SITE_URL,
        logo: `${SITE_URL}/icon.svg`,
        image: `${SITE_URL}/opengraph-image`,
        slogan: 'Clareza em movimento.',
        address: {
          '@type': 'PostalAddress',
          addressLocality: SITE_CITY,
          addressRegion: SITE_REGION,
          addressCountry: SITE_COUNTRY,
        },
        areaServed: [
          { '@type': 'City', name: 'Belo Horizonte' },
          { '@type': 'State', name: 'Minas Gerais' },
          { '@type': 'Country', name: 'Brasil' },
        ],
        knowsAbout: ['marketing digital', 'agência de marketing', 'branding', 'redes sociais', 'tráfego pago', 'produção de vídeo', 'criação de sites'],
        founder: [
          { '@type': 'Person', name: 'Guilherme Cassim', jobTitle: 'CEO e Fundador' },
          { '@type': 'Person', name: 'Daniel Barcellos', jobTitle: 'CEO e Fundador' },
        ],
        contactPoint: {
          '@type': 'ContactPoint',
          contactType: 'sales',
          url: WHATSAPP_CONTACT_URL,
          areaServed: 'BR',
          availableLanguage: ['Portuguese', 'English'],
        },
        hasOfferCatalog: {
          '@type': 'OfferCatalog',
          name: 'Serviços de marketing',
          itemListElement: SERVICES.map((name) => ({
            '@type': 'Offer',
            itemOffered: { '@type': 'Service', name, areaServed: { '@type': 'Country', name: 'Brasil' }, provider: { '@id': ORG_ID } },
          })),
        },
      },
      {
        '@type': 'WebSite',
        '@id': `${SITE_URL}/#site`,
        url: SITE_URL,
        name: SITE_NAME,
        inLanguage: ['pt-BR', 'en'],
        publisher: { '@id': ORG_ID },
      },
    ],
  }
}

function JsonLd({ data }: { data: object }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }} />
}

/** Organização e site: vai no layout, vale para todas as páginas. */
export default function StructuredData() {
  return <JsonLd data={graph()} />
}

/** Perguntas frequentes da home (rich result de FAQ). */
export function FaqStructuredData({ items }: { items: [string, string][] }) {
  return (
    <JsonLd
      data={{
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: items.map(([question, answer]) => ({
          '@type': 'Question',
          name: question,
          acceptedAnswer: { '@type': 'Answer', text: answer },
        })),
      }}
    />
  )
}

/** Trilha de navegação para páginas internas. */
export function BreadcrumbStructuredData({ items }: { items: { name: string; path: string }[] }) {
  return (
    <JsonLd
      data={{
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: items.map((item, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          name: item.name,
          item: `${SITE_URL}${item.path}`,
        })),
      }}
    />
  )
}
