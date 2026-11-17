import assert from 'node:assert/strict'
import { describe,it } from 'node:test'
import { forecastRevenueByDue } from './forecast-by-due'
const entries=[
 {id:'creative-nov',direction:'in' as const,category:'creative_minds',competenceMonth:'2026-11',dueDate:'2026-12-01',state:'open',amountCents:139700,remainingCents:139700,clientAdBudget:false},
 {id:'creative-dec',direction:'in' as const,category:'creative_minds',competenceMonth:'2026-12',dueDate:'2026-12-10',state:'open',amountCents:139700,remainingCents:139700,clientAdBudget:false},
 {id:'nov-other',direction:'in' as const,category:'hosting',competenceMonth:'2026-11',dueDate:'2026-11-25',state:'settled',amountCents:9900,remainingCents:0,clientAdBudget:false},
 {id:'client-budget',direction:'in' as const,category:'marketing_monthly',competenceMonth:'2026-12',dueDate:'2026-12-01',state:'open',amountCents:100000,remainingCents:100000,clientAdBudget:true},
 {id:'cancelled',direction:'in' as const,category:'marketing_monthly',competenceMonth:'2026-12',dueDate:'2026-12-03',state:'cancelled',amountCents:89000,remainingCents:89000,clientAdBudget:false},
 {id:'expense',direction:'out' as const,category:'software',competenceMonth:'2026-12',dueDate:'2026-12-01',state:'open',amountCents:15000,remainingCents:15000,clientAdBudget:false},
]
describe('Receita operacional por vencimento — Creative Minds',()=>{
 it('nunca inclui parcela de 01/12 na previsão de novembro',()=>{
   const nov=forecastRevenueByDue(entries,'2026-11')
   assert.deepEqual(nov.list.map(x=>x.id),['nov-other'])
   assert.equal(nov.openCents,0)
   assert.equal(nov.expectedCents,9900)
 })
 it('mostra as duas cobranças distintas de dezembro sem confundi-las com caixa confirmado',()=>{
   const dec=forecastRevenueByDue(entries,'2026-12')
   assert.deepEqual(dec.list.map(x=>x.id),['creative-nov','creative-dec'])
   assert.equal(dec.expectedCents,279400)
   assert.equal(dec.openCents,279400)
   assert.deepEqual(dec.byCategory,{creative_minds:279400})
 })
 it('preserva competência e os dados sem mutação',()=>{
   const before=JSON.stringify(entries)
   forecastRevenueByDue(entries,'2026-12')
   assert.equal(JSON.stringify(entries),before)
   assert.equal(entries[0].competenceMonth,'2026-11')
 })
 it('descarta datas inválidas e registros cancelados ou de verba externa',()=>{
   assert.deepEqual(forecastRevenueByDue(entries,'2026-13').list,[])
   assert.ok(!forecastRevenueByDue(entries,'2026-12').list.some(x=>x.id==='client-budget'||x.id==='cancelled'))
 })
})
