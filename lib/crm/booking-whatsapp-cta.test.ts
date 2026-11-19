import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'
const file = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

test('formulário principal: botão WhatsApp só depois de reunião confirmada', () => {
  const src = file('app/agendar/[slug]/booking-experience.tsx')
  assert.match(src, /if \(!confirmation\?\.bookingRequestId \|\| !bookingToken \|\| !bookingEnabled\) return/)
  assert.match(src, /fetch\('\/api\/booking\/whatsapp'/)
  assert.match(src, /JSON\.stringify\(\{ bookingToken, bookingRequestId: confirmation\.bookingRequestId \}\)/)
  assert.match(src, /link\.hostname !== 'wa\.me'/)
  assert.match(src, /\{whatsappUrl && <section className="booking-whatsapp-cta"/)
  assert.match(src, /Enviar mensagem no WhatsApp/)
  assert.match(src, /toque em Enviar para iniciar a conversa/)
})

test('dois caminhos usam API protegida sem prometer resposta automática', () => {
  const main = file('app/agendar/[slug]/booking-experience.tsx')
  const inline = file('app/formularios/[slug]/inline-booking-calendar.tsx')
  const api = file('app/api/booking/whatsapp/route.ts')
  assert.match(inline, /fetch\('\/api\/booking\/whatsapp'/)
  assert.match(api, /verifyBookingGrant\(data\.bookingToken\)/)
  assert.match(api, /appointmentForSession\(pool/)
  assert.match(api, /status: 'awaiting_lead'/)
  assert.doesNotMatch(main, /Nossa equipe entrará em contato pelo WhatsApp informado/)
})
