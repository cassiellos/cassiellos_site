import type { Metadata } from 'next'
import AboutContent from '@/components/about-content'

export const metadata: Metadata = {
  title: 'Sobre a Cassiellos — Empresa de Operações Criativas',
  description: 'Conheça a Cassiellos, empresa de operações criativas que conecta estratégia, conteúdo, tecnologia e acompanhamento para organizar o marketing do planejamento à publicação.',
  alternates: { canonical: '/sobre', languages: { 'pt-BR': '/sobre', en: '/en/sobre' } },
}

export default function AboutPage() {
  return <AboutContent lang="pt" />
}
