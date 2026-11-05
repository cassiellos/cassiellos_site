/**
 * Rótulos visíveis: o /agendar usa o CTA comercial definitivo e as telas do CRM não exibem rótulos de ambiente
 * ("Ambiente Preview", "Neon Preview") — o CRM também roda em Production. Verificação estática do código-fonte.
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const root = join(__dirname, '..', '..')
const files = (dir: string): string[] => readdirSync(dir).flatMap(f => {
  const p = join(dir, f)
  return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : []
})

describe('rótulos públicos e do CRM', () => {
  it('telas do CRM e do /agendar sem "Ambiente Preview" nem "Neon Preview"', () => {
    for (const f of [...files(join(root, 'app', 'crm')), ...files(join(root, 'app', 'agendar'))]) {
      const src = readFileSync(f, 'utf8')
      assert.equal(/Ambiente Preview|Neon Preview|NEON PREVIEW|banco Preview/.test(src), false, f)
    }
  })
  it('painel de homologação Meta e monitor Neon não afirmam que o ambiente atual é Preview', () => {
    const meta = readFileSync(join(root, 'app', 'crm', 'meta-homologation-panel.tsx'), 'utf8')
    assert.equal(/ambiente Preview|neste Preview|ligados no Preview/.test(meta), false)
    assert.ok(meta.includes('recurso exclusivo do Preview'))
    const neon = readFileSync(join(root, 'app', 'crm', 'neon-usage-monitor.tsx'), 'utf8')
    assert.ok(neon.includes('Armazenamento · Branch monitorada') && neon.includes('tamanho lógico da branch monitorada'))
    assert.equal(/Armazenamento · Preview|branch Preview|lógico da Preview/.test(neon), false)
    const mini = readFileSync(join(root, 'app', 'crm', 'mini-crm.tsx'), 'utf8')
    assert.ok(mini.includes('ativados na Preview em 03/11/2026'), 'texto histórico preservado')
  })
  it('/agendar: CTA "Confirmar minha reunião", subtítulo vindo do formulário e sem "pacientes"', () => {
    const src = readFileSync(join(root, 'app', 'agendar', '[slug]', 'booking-experience.tsx'), 'utf8')
    assert.ok(src.includes("'Confirmar minha reunião'"))
    assert.ok(src.includes('{form.description}'))
    assert.equal(/pacient/i.test(src), false)
  })
})
