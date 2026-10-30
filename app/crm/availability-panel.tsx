'use client'

import { useEffect, useState } from 'react'
import './availability-panel.css'

/**
 * Seção DISPONIBILIDADE: horário comercial, capacidade diária (atividades internas), bloqueios
 * (dia, período, férias, recesso), exceções autorizadas e feriados/políticas comerciais — sem editar código.
 * Toda alteração pede confirmação e é registrada com o autor. Nenhuma reunião já
 * confirmada é alterada ou cancelada: bloqueios e reservas internas valem apenas para novos agendamentos.
 */

type BlockRule = { type: 'none' } | { type: 'full' } | { type: 'until'; minute: number } | { type: 'after'; minute: number }
type Settings = { workingDays: number[]; openMinute: number; closeMinute: number; slotMinutes: number; minNoticeMinutes: number; windowDays: number }
type Holiday = {
  key: string; date: string; name: string; kinds: string[]; block: BlockRule; defaultBlock: BlockRule
  source: string; note?: string; overridden: boolean; effect: string; defaultEffect: string
  provisional?: boolean; provisionalNote?: string
}
type Entry = { id: string; startsAt: string; endsAt: string; reason: string; category?: string }
type ClosedDay = { date: string; workingDay: boolean; holidays: Holiday[]; blocks: Entry[]; exceptions: Entry[]; candidates: number; capacity?: { effective: number[] } }
type CapacitySettings = { enabled: boolean; minPerDay: number; maxPerDay: number; lunchStartMinute: number; lunchEndMinute: number; seed: number }
type Override = { minute: number; id: string; reason: string }
type CapacityDay = {
  date: string; generated: number[]; released: Override[]; manual: Override[]; dayOff: { id: string; reason: string } | null
  effective: number[]; withMeeting: number[]; holidays: string[]; closedByHoliday: boolean; inWindow: boolean
  preview: number[]
}
type Overview = {
  source: 'database' | 'defaults'; migrationPending: boolean; settings: Settings; holidays: Holiday[]
  blocks: Entry[]; exceptions: Entry[]; window: { today: string; closedDates: ClosedDay[] }
  capacity: { source: 'database' | 'defaults'; migrationPending: boolean; settings: CapacitySettings; days: CapacityDay[] }
}

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const KIND_LABEL: Record<string, string> = {
  national_holiday: 'Feriado nacional', state_holiday: 'Feriado estadual (MG)', municipal_holiday: 'Feriado municipal (BH)',
  federal_optional: 'Ponto facultativo federal', commercial_policy: 'Política comercial', observance: 'Data informativa',
}
const CATEGORY_LABEL: Record<string, string> = { day: 'Dia', partial: 'Período', vacation: 'Férias', recess: 'Recesso', other: 'Outro' }
const ERRORS: Record<string, string> = {
  MIGRATION_PENDING: 'A migração 0008 ainda não foi aplicada no banco. Alterações ficam disponíveis após a autorização D4.',
  CONFIRMATION_REQUIRED: 'Confirmação obrigatória.',
  INVALID_SETTINGS: 'Configuração fora dos limites seguros (06h–22h, último início até 21h30, múltiplos de 30 min, antecedência até 7 dias, janela de 1 a 90 dias).',
  CAPACITY_MIGRATION_PENDING: 'A migração 0009 ainda não foi aplicada no banco. A capacidade diária fica desligada até a autorização.',
  INVALID_CAPACITY: 'Ajuste de capacidade inválido: confira a data (dia de atendimento, de hoje até 1 ano), o horário (dentro do expediente) e as quantidades (0 a 6, mínimo ≤ máximo).',
  NOT_A_HOLD: 'Este horário não é uma reserva automática desta data. Atualize a página.',
  ALREADY_HELD: 'Este horário já está reservado para atividades internas.',
  ALREADY_SET: 'Este ajuste já existe para a data. Atualize a página.',
  INVALID_BLOCK: 'Bloqueio inválido: confira datas, horários (fim após início) e motivo (até 200 caracteres). Máximo de 366 dias.',
  INVALID_EXCEPTION: 'Exceção inválida: informe um único dia com horário de início e fim.',
  INVALID_HOLIDAY: 'Ajuste de feriado inválido.',
  NOT_FOUND: 'Registro não encontrado ou já revogado.',
  UNAUTHORIZED: 'Sua sessão administrativa expirou. Entre novamente.',
}

const two = (n: number) => String(n).padStart(2, '0')
const hhmm = (minute: number) => two(Math.floor(minute / 60)) + ':' + two(minute % 60)
const TIMES = Array.from({ length: 33 }, (_, i) => 360 + i * 30) // 06:00 … 22:00
const START_TIMES = TIMES.slice(0, -1) // inícios: 06:00 … 21:30 (a reunião de 30 min termina até 22:00)
const fmtDate = (date: string) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })
  .format(new Date(date + 'T12:00:00Z'))
const fmtInstant = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })

function ruleValue(rule: BlockRule): string {
  return rule.type === 'until' || rule.type === 'after' ? rule.type + ':' + rule.minute : rule.type
}
function parseRule(value: string): BlockRule | null {
  if (value === 'default') return null
  if (value === 'none' || value === 'full') return { type: value }
  const [type, minute] = value.split(':')
  return { type: type as 'until' | 'after', minute: Number(minute) }
}

export default function AvailabilityPanel() {
  const [data, setData] = useState<Overview | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [refresh, setRefresh] = useState(0)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [year, setYear] = useState<number | null>(null)
  const [block, setBlock] = useState({ mode: 'day', date: '', endDate: '', startTime: '12:00', endTime: '14:00', category: 'day', reason: '' })
  const [exception, setException] = useState({ date: '', startTime: '09:00', endTime: '12:00', reason: '' })
  const [capacity, setCapacity] = useState<CapacitySettings | null>(null)
  const [hold, setHold] = useState({ date: '', time: '', reason: '' })

  useEffect(() => {
    const controller = new AbortController()
    setState('loading')
    fetch('/api/crm/availability', { cache: 'no-store', credentials: 'same-origin', signal: controller.signal })
      .then(async r => { if (!r.ok) throw new Error('FAILED'); return r.json() as Promise<Overview> })
      .then(value => {
        if (controller.signal.aborted) return
        setData(value); setSettings(value.settings); setCapacity(value.capacity.settings); setState('ready')
        setYear(y => y ?? Number(value.window.today.slice(0, 4)))
      })
      .catch(() => { if (!controller.signal.aborted) setState('error') })
    return () => controller.abort()
  }, [refresh])

  async function act(body: Record<string, unknown>, question: string, success: string) {
    if (!window.confirm(question)) return
    setBusy(true); setMessage('')
    try {
      const r = await fetch('/api/crm/availability', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, confirmed: true }),
      })
      const result = await r.json().catch(() => ({})) as Record<string, unknown>
      if (r.ok) {
        const overlapping = typeof result.overlappingMeetings === 'number' ? result.overlappingMeetings : 0
        setMessage(success + (overlapping ? ' Atenção: ' + overlapping + ' reunião(ões) já confirmada(s) no período foram MANTIDAS — nada foi cancelado.' : ''))
        setRefresh(v => v + 1)
      } else {
        setMessage(ERRORS[String(result.error)] || 'Não foi possível concluir. Nada foi alterado.')
      }
    } catch { setMessage('Não foi possível concluir. Nada foi alterado.') } finally { setBusy(false) }
  }

  if (state === 'loading' && !data) return <section className="crm-card crm-real-agenda"><p className="crm-real-agenda-message">Carregando disponibilidade…</p></section>
  if (state === 'error' || !data || !settings || !capacity) return <section className="crm-card crm-real-agenda"><p className="crm-real-agenda-message" role="alert">Não foi possível consultar a disponibilidade. Nenhum horário é oferecido enquanto houver falha de leitura.</p></section>

  const locked = data.migrationPending || busy
  const capacityLocked = data.capacity.migrationPending || busy
  const lastStart = settings.closeMinute - settings.slotMinutes
  const gridTimes = START_TIMES.filter(t => t >= settings.openMinute && t <= lastStart)
  const isLunch = (m: number) => m >= capacity.lunchStartMinute && m + settings.slotMinutes <= capacity.lunchEndMinute
  const holdDays = data.capacity.days.filter(d => !d.closedByHoliday)
  const holdDate = hold.date || holdDays[0]?.date || ''
  const holdTime = hold.time || hhmm(gridTimes[0] ?? 540)
  const years = [...new Set(data.holidays.map(h => Number(h.date.slice(0, 4))))]
  const holidays = data.holidays.filter(h => Number(h.date.slice(0, 4)) === year)

  return <div className="crm-availability">
    {data.migrationPending && <section className="crm-card crm-real-agenda-notice crm-availability-notice" role="status">
      <strong>MIGRAÇÃO PENDENTE</strong>A migração 0008 ainda não foi aplicada no Neon Preview. A agenda já usa o padrão do código
      (seg–sex, inícios das 09h00 às 18h00, reuniões de 30 min, 2 h de antecedência, 3 dias corridos, feriados e políticas comerciais).
      As alterações abaixo ficam bloqueadas até a autorização.
    </section>}
    {message && <section className="crm-card"><p className="crm-real-agenda-message" role="status">{message}</p></section>}

    <section className="crm-card crm-real-agenda">
      <div className="crm-real-agenda-title"><div>
        <div className="crm-panel-title">Horário comercial</div>
        <p>Vale para novos agendamentos · fuso America/Sao_Paulo · reuniões de 30 min</p>
      </div></div>
      <div className="crm-availability-form">
        <fieldset><legend>Dias de atendimento</legend><div className="crm-availability-days">
          {WEEKDAYS.map((label, day) => <label key={label}><input type="checkbox" checked={settings.workingDays.includes(day)} disabled={locked}
            onChange={e => setSettings({ ...settings, workingDays: e.target.checked ? [...settings.workingDays, day].sort() : settings.workingDays.filter(d => d !== day) })}/>{label}</label>)}
        </div></fieldset>
        <label>Primeiro início<select value={settings.openMinute} disabled={locked} onChange={e => setSettings({ ...settings, openMinute: Number(e.target.value) })}>
          {START_TIMES.map(t => <option key={t} value={t}>{hhmm(t)}</option>)}</select></label>
        <label><span>Último início <small>· termina às {hhmm(settings.closeMinute)}</small></span><select value={lastStart} disabled={locked}
          onChange={e => setSettings({ ...settings, closeMinute: Number(e.target.value) + settings.slotMinutes })}>
          {START_TIMES.map(t => <option key={t} value={t}>{hhmm(t)}</option>)}</select></label>
        <label>Antecedência mínima (horas)<input type="number" min={0} max={168} step={1} value={settings.minNoticeMinutes / 60} disabled={locked}
          onChange={e => setSettings({ ...settings, minNoticeMinutes: Math.round(Number(e.target.value) * 60) })}/></label>
        <label>Janela de agendamento (dias)<input type="number" min={1} max={90} step={1} value={settings.windowDays} disabled={locked}
          onChange={e => setSettings({ ...settings, windowDays: Number(e.target.value) })}/></label>
        <button className="crm-btn" type="button" disabled={locked} onClick={() => act({ action: 'save_settings', settings },
          'Salvar o horário comercial? Vale apenas para novos agendamentos; reuniões já confirmadas são mantidas.', 'Horário comercial salvo.')}>Salvar horário</button>
      </div>
    </section>

    <section className="crm-card crm-real-agenda" aria-labelledby="crm-capacity-title">
      <div className="crm-real-agenda-title"><div>
        <div className="crm-panel-title" id="crm-capacity-title">Capacidade diária · atividades internas</div>
        <p>{data.capacity.settings.enabled ? 'Reserva' : 'Quando ativada, reserva'} {capacity.minPerDay === capacity.maxPerDay ? capacity.minPerDay : capacity.minPerDay + ' a ' + capacity.maxPerDay} horários
          por dia útil para trabalho interno, priorizando o almoço ({hhmm(capacity.lunchStartMinute)}–{hhmm(capacity.lunchEndMinute)}).
          A distribuição é fixa por data e igual para todos os visitantes, que veem apenas que o horário não está disponível.
          Nenhuma reunião é criada, e reuniões já confirmadas nunca são alteradas.</p>
      </div></div>
      {data.capacity.migrationPending && <p className="crm-real-agenda-message" role="status">Migração 0009 pendente: a capacidade
        diária está desligada e não reserva nenhum horário. Os controles ficam bloqueados até a autorização.</p>}
      {!data.capacity.migrationPending && !data.capacity.settings.enabled && <p className="crm-real-agenda-message" role="status">
        Reservas automáticas DESLIGADAS: nenhum horário é reservado. A prévia abaixo mostra o que seria reservado ao ativar
        (marque &quot;Reservas automáticas ativas&quot; e salve).</p>}
      <div className="crm-availability-form">
        <label className="crm-availability-check"><input type="checkbox" checked={capacity.enabled} disabled={capacityLocked}
          onChange={e => setCapacity({ ...capacity, enabled: e.target.checked })}/>Reservas automáticas ativas</label>
        <label>Mínimo por dia<select value={capacity.minPerDay} disabled={capacityLocked}
          onChange={e => setCapacity({ ...capacity, minPerDay: Number(e.target.value) })}>
          {[0, 1, 2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
        <label>Máximo por dia<select value={capacity.maxPerDay} disabled={capacityLocked}
          onChange={e => setCapacity({ ...capacity, maxPerDay: Number(e.target.value) })}>
          {[0, 1, 2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
        <label>Almoço de<select value={capacity.lunchStartMinute} disabled={capacityLocked}
          onChange={e => setCapacity({ ...capacity, lunchStartMinute: Number(e.target.value) })}>
          {TIMES.map(t => <option key={t} value={t}>{hhmm(t)}</option>)}</select></label>
        <label>Almoço até<select value={capacity.lunchEndMinute} disabled={capacityLocked}
          onChange={e => setCapacity({ ...capacity, lunchEndMinute: Number(e.target.value) })}>
          {TIMES.map(t => <option key={t} value={t}>{hhmm(t)}</option>)}</select></label>
        <button className="crm-btn" type="button" disabled={capacityLocked} onClick={() => act({ action: 'save_capacity', capacity: {
          enabled: capacity.enabled, minPerDay: capacity.minPerDay, maxPerDay: capacity.maxPerDay,
          lunchStartMinute: capacity.lunchStartMinute, lunchEndMinute: capacity.lunchEndMinute,
        } }, 'Salvar a capacidade diária? Vale para todas as datas; reuniões já confirmadas são mantidas.', 'Capacidade diária salva.')}>Salvar capacidade</button>
        <button className="crm-btn" type="button" disabled={capacityLocked || !capacity.enabled} onClick={() => act({ action: 'redistribute_capacity' },
          'Gerar uma nova distribuição para TODAS as datas? Os horários reservados mudam também nos dias já visíveis ao público, e as liberações feitas sobre a distribuição atual são desfeitas. Reservas manuais e dias desligados continuam valendo.',
          'Nova distribuição gerada.')}>Redistribuir horários</button>
      </div>
      <div className="crm-real-agenda-items">{data.capacity.days.map(day => {
        const manual = new Map(day.manual.map(m => [m.minute, m]))
        const status = day.closedByHoliday ? day.holidays.join(' · ') + ' · dia fechado ao público (reservas internas sem efeito)'
          : day.dayOff ? 'Reservas automáticas desligadas neste dia' + (day.dayOff.reason ? ' · ' + day.dayOff.reason : '')
          : day.effective.length ? day.effective.length + ' horário(s) reservado(s) para atividades internas'
          : !data.capacity.settings.enabled ? 'Reservas automáticas desligadas'
          : 'Sem reservas internas'
        return <article className="crm-real-agenda-item crm-capacity-day" key={day.date}>
          <div className="crm-real-agenda-content">
            <strong>{fmtDate(day.date)}{day.inWindow ? ' · na janela pública' : ''}</strong>
            <span>{status}{!day.closedByHoliday && day.holidays.length ? ' · ' + day.holidays.join(' · ') + ' (bloqueio parcial prevalece)' : ''}</span>
            {!day.closedByHoliday && <div className="crm-capacity-chips">
              {day.effective.map(m => {
                const own = manual.get(m)
                return <span className="crm-capacity-chip" key={'e' + m} data-kind={own ? 'manual' : isLunch(m) ? 'lunch' : 'auto'}>
                  {hhmm(m)}{own ? ' · manual' : isLunch(m) ? ' · almoço' : ''}
                  {day.withMeeting.includes(m) && <em> · coincide com reunião confirmada (mantida)</em>}
                  <button type="button" disabled={capacityLocked} aria-label={(own ? 'Remover reserva manual das ' : 'Liberar reserva das ') + hhmm(m)}
                    onClick={() => own
                      ? act({ action: 'revoke_capacity_override', id: own.id }, 'Remover a reserva manual das ' + hhmm(m) + '? O horário volta a ser oferecido se estiver livre.', 'Reserva manual removida.')
                      : act({ action: 'capacity_release', date: day.date, time: hhmm(m) }, 'Liberar as ' + hhmm(m) + ' de ' + fmtDate(day.date) + ' para agendamentos? O horário volta a ser oferecido se estiver livre.', 'Horário liberado.')}>
                    {own ? 'Remover' : 'Liberar'}</button>
                </span>
              })}
              {!data.capacity.migrationPending && day.preview.map(m => <span className="crm-capacity-chip" key={'p' + m} data-kind="preview"
                title="Prévia: não aplicada enquanto a capacidade estiver desligada">{hhmm(m)}{isLunch(m) ? ' · almoço' : ''} · prévia</span>)}
              {day.released.map(r => <span className="crm-capacity-chip" key={'r' + r.minute} data-kind="released">
                {hhmm(r.minute)} · liberado
                <button type="button" disabled={capacityLocked} aria-label={'Restaurar reserva das ' + hhmm(r.minute)}
                  onClick={() => act({ action: 'revoke_capacity_override', id: r.id }, 'Voltar a reservar as ' + hhmm(r.minute) + ' para atividades internas?', 'Reserva restaurada.')}>Restaurar</button>
              </span>)}
            </div>}
          </div>
          <div className="crm-real-agenda-actions">{day.closedByHoliday ? null : day.dayOff
            ? <button className="crm-btn" type="button" disabled={capacityLocked}
              onClick={() => act({ action: 'revoke_capacity_override', id: day.dayOff!.id }, 'Reativar as reservas automáticas de ' + fmtDate(day.date) + '?', 'Reservas do dia reativadas.')}>Reativar reservas</button>
            : <button className="crm-btn" type="button" disabled={capacityLocked || !capacity.enabled}
              onClick={() => act({ action: 'capacity_day_off', date: day.date }, 'Desligar as reservas automáticas de ' + fmtDate(day.date) + '? Os horários voltam a ser oferecidos se estiverem livres.', 'Reservas automáticas desligadas neste dia.')}>Sem reservas neste dia</button>}
          </div>
        </article>
      })}</div>
      <div className="crm-availability-form">
        <label>Reservar em<select value={holdDate} disabled={capacityLocked} onChange={e => setHold({ ...hold, date: e.target.value })}>
          {holdDays.map(d => <option key={d.date} value={d.date}>{fmtDate(d.date)}</option>)}</select></label>
        <label>Horário<select value={holdTime} disabled={capacityLocked} onChange={e => setHold({ ...hold, time: e.target.value })}>
          {gridTimes.map(t => <option key={t} value={hhmm(t)}>{hhmm(t)}</option>)}</select></label>
        <label className="crm-availability-wide">Motivo (interno)<input type="text" maxLength={200} value={hold.reason} disabled={capacityLocked}
          onChange={e => setHold({ ...hold, reason: e.target.value })}/></label>
        <button className="crm-btn" type="button" disabled={capacityLocked || !holdDate} onClick={() => act({ action: 'capacity_hold', date: holdDate, time: holdTime, reason: hold.reason },
          'Reservar as ' + holdTime + ' de ' + fmtDate(holdDate) + ' para atividades internas? Reuniões já confirmadas são mantidas.', 'Horário reservado para atividades internas.')}>Reservar horário interno</button>
      </div>
    </section>

    <section className="crm-card crm-real-agenda">
      <div className="crm-real-agenda-title"><div>
        <div className="crm-panel-title">Bloqueios de agenda</div>
        <p>Dia inteiro, período do dia, férias ou recesso · reuniões já confirmadas no período NÃO são canceladas</p>
      </div></div>
      <div className="crm-availability-form">
        <label>Tipo<select value={block.mode} disabled={locked} onChange={e => setBlock({ ...block, mode: e.target.value,
          category: e.target.value === 'partial' ? 'partial' : e.target.value === 'range' ? 'vacation' : 'day' })}>
          <option value="day">Dia inteiro</option><option value="partial">Período do dia</option><option value="range">Intervalo de datas</option>
        </select></label>
        <label>{block.mode === 'range' ? 'De' : 'Data'}<input type="date" value={block.date} disabled={locked} onChange={e => setBlock({ ...block, date: e.target.value })}/></label>
        {block.mode === 'range' && <label>Até<input type="date" value={block.endDate} disabled={locked} onChange={e => setBlock({ ...block, endDate: e.target.value })}/></label>}
        {block.mode === 'partial' && <>
          <label>Das<input type="time" step={1800} value={block.startTime} disabled={locked} onChange={e => setBlock({ ...block, startTime: e.target.value })}/></label>
          <label>Até<input type="time" step={1800} value={block.endTime} disabled={locked} onChange={e => setBlock({ ...block, endTime: e.target.value })}/></label>
        </>}
        {block.mode === 'range' && <label>Categoria<select value={block.category} disabled={locked} onChange={e => setBlock({ ...block, category: e.target.value })}>
          <option value="vacation">Férias</option><option value="recess">Recesso</option><option value="other">Outro</option></select></label>}
        <label className="crm-availability-wide">Motivo (interno)<input type="text" maxLength={200} value={block.reason} disabled={locked} onChange={e => setBlock({ ...block, reason: e.target.value })}/></label>
        <button className="crm-btn" type="button" disabled={locked || !block.date} onClick={() => act({
          action: 'add_block', date: block.date, reason: block.reason, category: block.category,
          ...(block.mode === 'range' ? { endDate: block.endDate || block.date } : {}),
          ...(block.mode === 'partial' ? { startTime: block.startTime, endTime: block.endTime } : {}),
        }, 'Criar este bloqueio? Novos agendamentos deixam de ser oferecidos no período. Reuniões já confirmadas são mantidas.', 'Bloqueio criado.')}>Bloquear</button>
      </div>
      {data.blocks.length === 0 && <p className="crm-real-agenda-message">Nenhum bloqueio manual ativo.</p>}
      {data.blocks.map(item => <article className="crm-real-agenda-item" key={item.id}>
        <div className="crm-real-agenda-content">
          <strong>{CATEGORY_LABEL[item.category || 'other']} · {fmtInstant.format(new Date(item.startsAt))} → {fmtInstant.format(new Date(item.endsAt))}</strong>
          <span>{item.reason || 'Sem motivo informado'}</span>
        </div>
        <div className="crm-real-agenda-actions"><button className="crm-btn" type="button" disabled={locked}
          onClick={() => act({ action: 'revoke_block', id: item.id }, 'Revogar este bloqueio? O registro é mantido no histórico.', 'Bloqueio revogado.')}>Revogar</button></div>
      </article>)}
    </section>

    <section className="crm-card crm-real-agenda">
      <div className="crm-real-agenda-title"><div>
        <div className="crm-panel-title">Exceções autorizadas</div>
        <p>Abre horários específicos (ex.: sábado ou feriado) · nunca libera horário ocupado no Google, antecedência ou janela</p>
      </div></div>
      <div className="crm-availability-form">
        <label>Data<input type="date" value={exception.date} disabled={locked} onChange={e => setException({ ...exception, date: e.target.value })}/></label>
        <label>Das<input type="time" step={1800} value={exception.startTime} disabled={locked} onChange={e => setException({ ...exception, startTime: e.target.value })}/></label>
        <label>Até<input type="time" step={1800} value={exception.endTime} disabled={locked} onChange={e => setException({ ...exception, endTime: e.target.value })}/></label>
        <label className="crm-availability-wide">Motivo (interno)<input type="text" maxLength={200} value={exception.reason} disabled={locked} onChange={e => setException({ ...exception, reason: e.target.value })}/></label>
        <button className="crm-btn" type="button" disabled={locked || !exception.date} onClick={() => act({ action: 'add_exception', ...exception },
          'Autorizar esta exceção? Os horários do período passam a ser oferecidos se estiverem livres no Google.', 'Exceção autorizada.')}>Autorizar</button>
      </div>
      {data.exceptions.length === 0 && <p className="crm-real-agenda-message">Nenhuma exceção ativa.</p>}
      {data.exceptions.map(item => <article className="crm-real-agenda-item" key={item.id}>
        <div className="crm-real-agenda-content">
          <strong>{fmtInstant.format(new Date(item.startsAt))} → {fmtInstant.format(new Date(item.endsAt))}</strong>
          <span>{item.reason || 'Sem motivo informado'}</span>
        </div>
        <div className="crm-real-agenda-actions"><button className="crm-btn" type="button" disabled={locked}
          onClick={() => act({ action: 'revoke_exception', id: item.id }, 'Revogar esta exceção? O registro é mantido no histórico.', 'Exceção revogada.')}>Revogar</button></div>
      </article>)}
    </section>

    <section className="crm-card crm-real-agenda">
      <div className="crm-real-agenda-title"><div>
        <div className="crm-panel-title">Feriados e políticas comerciais</div>
        <p>Belo Horizonte / MG · ponto facultativo não bloqueia por si só · sem pontes automáticas · ajustes por ano ou para todos os anos</p>
      </div>
      <div className="crm-real-agenda-filters crm-availability-years">{years.map(y =>
        <button key={y} type="button" data-selected={y === year} onClick={() => setYear(y)}>{y}</button>)}</div></div>
      <div className="crm-table-wrap"><table className="crm-availability-table">
        <thead><tr><th>Data</th><th>Data comemorativa</th><th>Natureza</th><th>Efeito na agenda</th><th>Ajustar</th></tr></thead>
        <tbody>{holidays.map(h => <tr key={h.key + h.date}>
          <td>{fmtDate(h.date)}</td>
          <td><strong>{h.name}</strong>{h.provisional && <span className="crm-availability-provisional" title={h.provisionalNote}>PROVISÓRIO</span>}
            <small>{h.source}{h.note ? ' · ' + h.note : ''}</small>{h.provisionalNote && <small>{h.provisionalNote}</small>}</td>
          <td>{h.kinds.map(k => KIND_LABEL[k] || k).join(' · ')}</td>
          <td>{h.effect}{h.overridden && <small>Ajustado (padrão: {h.defaultEffect})</small>}</td>
          <td><select disabled={locked} value={h.overridden ? ruleValue(h.block) : 'default'} aria-label={'Ajustar ' + h.name}
            onChange={e => {
              const rule = parseRule(e.target.value)
              const scope = window.confirm('Aplicar a TODOS os anos? (OK = todos os anos · Cancelar = somente ' + year + ')') ? null : year
              void act({ action: 'set_holiday_rule', key: h.key, year: scope, block: rule },
                'Confirmar o ajuste de "' + h.name + '" (' + (scope ?? 'todos os anos') + ')? Reuniões já confirmadas são mantidas.', 'Ajuste salvo.')
            }}>
            <option value="default">Padrão ({h.defaultEffect})</option>
            <option value="none">Sem bloqueio</option>
            <option value="full">Dia inteiro</option>
            {TIMES.filter(t => t >= 600 && t <= 1080).map(t => <option key={'u' + t} value={'until:' + t}>Bloquear até {hhmm(t)}</option>)}
            {TIMES.filter(t => t >= 600 && t <= 1080).map(t => <option key={'a' + t} value={'after:' + t}>Bloquear a partir de {hhmm(t)}</option>)}
          </select></td>
        </tr>)}</tbody>
      </table></div>
    </section>

    <section className="crm-card crm-real-agenda">
      <div className="crm-real-agenda-title"><div>
        <div className="crm-panel-title">Dias sem horários na janela pública</div>
        <p>A partir de {fmtDate(data.window.today)} · {settings.windowDays} dias · motivo de cada dia</p>
      </div></div>
      <div className="crm-real-agenda-items">{data.window.closedDates.map(day => <article className="crm-real-agenda-item" key={day.date}>
        <div className="crm-real-agenda-content"><strong>{fmtDate(day.date)}</strong>
          <span>{[
            !day.workingDay && day.exceptions.length === 0 ? 'Fora dos dias de atendimento' : '',
            ...day.holidays.filter(h => h.block.type !== 'none').map(h => h.name),
            ...day.blocks.map(b => 'Bloqueio: ' + (b.reason || CATEGORY_LABEL[b.category || 'other'])),
            day.capacity && day.capacity.effective.length && day.candidates === 0 && day.workingDay ? 'Capacidade interna' : '',
            day.candidates > 0 ? 'Antecedência mínima ou janela' : '',
          ].filter(Boolean).join(' · ') || 'Sem horários'}</span></div>
      </article>)}</div>
    </section>
  </div>
}
