import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/site'

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date()
  return [
    {
      url: SITE_URL,
      lastModified,
      changeFrequency: 'weekly',
      priority: 1,
      alternates: { languages: { 'pt-BR': SITE_URL, en: `${SITE_URL}/en` } },
    },
    { url: `${SITE_URL}/en`, lastModified, changeFrequency: 'monthly', priority: 0.8 },
    {
      url: `${SITE_URL}/sobre`,
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.8,
      alternates: { languages: { 'pt-BR': `${SITE_URL}/sobre`, en: `${SITE_URL}/en/sobre` } },
    },
    { url: `${SITE_URL}/en/sobre`, lastModified, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${SITE_URL}/politica-de-privacidade`, lastModified, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${SITE_URL}/termos-de-uso`, lastModified, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${SITE_URL}/politica-de-cookies`, lastModified, changeFrequency: 'yearly', priority: 0.3 },
  ]
}
