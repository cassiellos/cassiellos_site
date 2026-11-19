/**
 * Horário de parede em America/Sao_Paulo → instante em UTC.
 *
 * "8h da manhã do dia da reunião" é um horário LOCAL. Converter isso somando 3 horas fixas
 * funcionaria hoje (o Brasil não usa horário de verão desde 2019) e quebraria em silêncio se o
 * país voltar a usar, ou se um dia a agência atender outro fuso. Então o deslocamento é LIDO do
 * próprio fuso, no instante em questão, em vez de ser presumido.
 *
 * Como: formata-se um instante no fuso alvo, lê-se o relógio de parede resultante e compara-se com
 * o mesmo relógio em UTC — a diferença é o deslocamento naquele instante. Duas iterações bastam
 * para convergir, porque o deslocamento muda no máximo uma vez entre o palpite e o resultado.
 */

export const SAO_PAULO = 'America/Sao_Paulo'

const partsFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: SAO_PAULO, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
})

type Wall = { year: number; month: number; day: number; hour: number; minute: number; second: number }

/** Relógio de parede em São Paulo para um instante. */
export function wallClock(instant: Date | number): Wall {
  const parts = partsFormat.formatToParts(new Date(instant))
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value ?? '0')
  return {
    year: get('year'), month: get('month'), day: get('day'),
    hour: get('hour'), minute: get('minute'), second: get('second'),
  }
}

/** Deslocamento do fuso (local − UTC), em milissegundos, NAQUELE instante. */
function offsetMs(instant: number): number {
  const w = wallClock(instant)
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second)
  // Segundos são preservados; milissegundos não entram na comparação e não importam para o fuso.
  return asUtc - (Math.floor(instant / 1000) * 1000)
}

/** Instante UTC correspondente a um horário de parede em São Paulo. */
export function fromWallClock(
  year: number, month: number, day: number, hour: number, minute = 0,
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute)
  let instant = naive
  for (let i = 0; i < 2; i++) instant = naive - offsetMs(instant)
  return new Date(instant)
}

/** O instante `hour`:00 do MESMO dia (em São Paulo) em que a reunião acontece. */
export function hourOfMeetingDay(meetingStart: Date | number, hour: number): Date {
  const w = wallClock(meetingStart)
  return fromWallClock(w.year, w.month, w.day, hour)
}
