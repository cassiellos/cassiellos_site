/**
 * Referência PÚBLICA do agendamento — o único identificador que pode aparecer no texto do wa.me.
 *
 * Não é o id da reunião, do lead nem da reserva: é um código aleatório de 10 caracteres,
 * sem relação com nenhum dado pessoal, que expira. Mesmo que o link vaze (o WhatsApp mostra o
 * texto antes do envio, e prints circulam), ele não revela e-mail, telefone nem o link do Meet, e
 * sozinho não autoriza nada: a resposta automática do Modo B ainda confere o remetente no banco.
 *
 * Alfabeto sem 0/O, 1/l/I e 'o'/'i' para o código ser ditado por telefone sem ambiguidade.
 * 32^10 ≈ 1,1 × 10^15 combinações; com validade curta, adivinhar não é um caminho viável.
 */

export const REFERENCE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'
export const REFERENCE_LENGTH = 10
/** Validade: cobre a janela de agendamento (até 30 dias) com folga até a reunião acontecer. */
export const REFERENCE_TTL_DAYS = 45

const PATTERN = /^[a-hjkmnp-z2-9]{10}$/

export function isPublicReference(value: unknown): value is string {
  return typeof value === 'string' && PATTERN.test(value)
}

type RandomBytes = (size: number) => Uint8Array

function defaultRandom(size: number): Uint8Array {
  const bytes = new Uint8Array(size)
  globalThis.crypto.getRandomValues(bytes)
  return bytes
}

/**
 * Código aleatório sem viés de módulo: bytes fora da maior faixa múltipla do alfabeto são
 * descartados em vez de dobrados (um `% 31` cru tornaria os primeiros símbolos mais prováveis).
 */
export function generatePublicReference(random: RandomBytes = defaultRandom): string {
  const size = REFERENCE_ALPHABET.length
  const limit = Math.floor(256 / size) * size
  let out = ''
  while (out.length < REFERENCE_LENGTH) {
    for (const byte of random(REFERENCE_LENGTH)) {
      if (byte >= limit) continue
      out += REFERENCE_ALPHABET[byte % size]
      if (out.length === REFERENCE_LENGTH) break
    }
  }
  return out
}

export function referenceExpiresAt(now: Date = new Date()): Date {
  return new Date(now.getTime() + REFERENCE_TTL_DAYS * 24 * 60 * 60_000)
}
