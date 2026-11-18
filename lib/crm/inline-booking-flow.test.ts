import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { calendarDays, shiftCalendarMonth } from '../../app/formularios/[slug]/inline-booking-calendar'
import { getBookingForm } from './booking-forms'

const file=(path:string)=>readFileSync(resolve(process.cwd(),path),'utf8')

describe('Hamburguerias — etapa de agenda incorporada ao mesmo formulário',()=>{
  it('calendário usa semanas começando em segunda e considera virada do ano',()=>{
    const days=calendarDays('2026-11')
    assert.equal(days[0],null)
    assert.equal(days[6],'2026-11-01')
    assert.equal(days[7],'2026-11-02')
    assert.equal(days.at(-1),'2026-11-30')
    assert.equal(calendarDays('2026-02').filter(Boolean).length,28)
    assert.equal(calendarDays('2028-02').filter(Boolean).length,29)
    assert.equal(shiftCalendarMonth('2026-12',1),'2027-01')
    assert.equal(shiftCalendarMonth('2026-01',-1),'2025-12')
    assert.deepEqual(calendarDays('foobar'),[])
  })

  it('mesmo fluxo renderiza calendário após envio, sem CTA externa para /agendar',()=>{
    const src=file('app/formularios/[slug]/public-flow.tsx')
    assert.match(src,/setStatus\('calendar'\)/)
    assert.match(src,/data\.outcome==='qualified'&&data\.inlineBooking===true/)
    assert.match(src,/<InlineBookingCalendar\s+formSlug=\{slug\}/)
    assert.match(src,/bookingToken=\{bookingToken\}/)
    // A única âncora para actionHref fica em uma tela final sem calendário.
    assert.match(src,/status==='calendar'\?<InlineBookingCalendar/)
  })

  it('servidor devolve sessão assinada só depois de verificar e salvar a inscrição qualificada',()=>{
    const src=file('app/api/public/forms/[slug]/route.ts')
    const saving=src.indexOf('const saved=await saveLeadSubmission')
    const token=src.indexOf('const bookingToken=bookingEnabled?createBookingGrant')
    assert.ok(saving>0&&token>saving)
    assert.match(src,/result\.result\.outcome==='qualified'/)
    assert.match(src,/leadId:saved\.leadId,submissionId:saved\.submissionId,formSlug:doc\.slug/)
    assert.match(src,/actionLabel:inlineBooking\?'':result\.result\.actionLabel/)
    assert.match(src,/actionHref:inlineBooking\?'':result\.result\.actionHref/)
    assert.match(src,/verifyTurnstileToken/)
  })

  it('a rota legada não pode emitir sessão de agendamento para Hamburguerias',()=>{
    const src=file('app/api/booking/leads/route.ts')
    assert.match(src,/getForm: slug => slug === 'hamburguerias' \? null : getBookingForm\(slug\)/)
    const form=getBookingForm('hamburguerias')
    assert.ok(form)
    assert.deepEqual(form.fields,[])
  })

  it('confirmação usa a API existente, com token e horário e sem nova inscrição',()=>{
    const src=file('app/formularios/[slug]/inline-booking-calendar.tsx')
    assert.match(src,/fetch\('\/api\/booking\/calendar\?form='/)
    assert.match(src,/fetch\('\/api\/booking\/availability\?form='/)
    assert.match(src,/fetch\('\/api\/booking\/confirm'/)
    assert.match(src,/JSON\.stringify\(\{bookingToken,startAt:chosen\.startAt\}\)/)
    assert.match(src,/inFlight\.current = true/)
    assert.match(src,/value\.alreadyConfirmed !== true && schedule/)
    assert.match(src,/trackMetaConversion\('Schedule',schedule\.eventId/)
    assert.doesNotMatch(src,/fetch\('\/api\/booking\/leads'/)
  })
})
