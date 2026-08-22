import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/site'

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date()
  return [
    {
      url: SITE_URL,
      lastModified,
      changeFrequency: 'monthly',
      priority: 1,
    },
    { url: `${SITE_URL}/politica-de-privacidade`, lastModified, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${SITE_URL}/termos-de-uso`, lastModified, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${SITE_URL}/politica-de-cookies`, lastModified, changeFrequency: 'yearly', priority: 0.3 },
  ]
}
