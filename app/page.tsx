import HomeContent from '@/components/home-content'
import ContactIntakeSection from '@/components/contact/ContactIntakeSection'
import { FaqStructuredData } from '@/components/structured-data'
import { FAQ_PT } from '@/lib/home-faq'

export default function Home() {
  return (
    <>
      <FaqStructuredData items={FAQ_PT} />
      <HomeContent lang="pt" />
      <ContactIntakeSection lang="pt" />
    </>
  )
}
