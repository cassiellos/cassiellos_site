'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'

type AudioWindow = Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext }

export default function SiteControls() {
  const pathname = usePathname()
  const english = pathname.startsWith('/en')
  const [light, setLight] = useState(false)
  const [playing, setPlaying] = useState(false)
  const audio = useRef<{ ctx: AudioContext; master: GainNode; timer?: number; step: number } | null>(null)

  useEffect(() => {
    document.documentElement.lang = english ? 'en' : 'pt-BR'
    const saved = localStorage.getItem('cassiellos-theme')
    const next = saved === 'light'
    setLight(next)
    document.documentElement.dataset.theme = next ? 'light' : 'dark'
    return () => {
      if (audio.current?.timer) window.clearTimeout(audio.current.timer)
      audio.current?.ctx.close()
    }
  }, [english])

  const toggleTheme = () => {
    const next = !light
    setLight(next)
    document.documentElement.dataset.theme = next ? 'light' : 'dark'
    localStorage.setItem('cassiellos-theme', next ? 'light' : 'dark')
  }

  const tone = (state: NonNullable<typeof audio.current>, frequency: number, when: number, duration: number, volume: number, type: OscillatorType = 'sine') => {
    const oscillator = state.ctx.createOscillator()
    const gain = state.ctx.createGain()
    const filter = state.ctx.createBiquadFilter()
    oscillator.type = type
    oscillator.frequency.setValueAtTime(frequency, when)
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(780, when)
    gain.gain.setValueAtTime(0.0001, when)
    gain.gain.exponentialRampToValueAtTime(volume, when + 0.35)
    gain.gain.exponentialRampToValueAtTime(0.0001, when + duration)
    oscillator.connect(filter)
    filter.connect(gain)
    gain.connect(state.master)
    oscillator.start(when)
    oscillator.stop(when + duration + 0.1)
  }

  const pulse = (state: NonNullable<typeof audio.current>) => {
    const notes = [110, 164.81, 220, 246.94, 164.81, 130.81, 196, 146.83]
    const now = state.ctx.currentTime + 0.04
    const root = notes[state.step % notes.length]
    tone(state, root, now, 3.8, 0.055)
    tone(state, root * 2, now + 0.08, 2.6, 0.018, 'triangle')
    if (state.step % 2 === 0) tone(state, root / 2, now, 4.5, 0.025)
    state.step += 1
    state.timer = window.setTimeout(() => pulse(state), 2200)
  }

  const toggleSound = async () => {
    if (playing && audio.current) {
      if (audio.current.timer) window.clearTimeout(audio.current.timer)
      audio.current.master.gain.setTargetAtTime(0.0001, audio.current.ctx.currentTime, 0.25)
      setPlaying(false)
      return
    }

    const AudioCtor = window.AudioContext || (window as AudioWindow).webkitAudioContext
    if (!AudioCtor) return
    if (!audio.current) {
      const ctx = new AudioCtor()
      const master = ctx.createGain()
      master.gain.value = 0.32
      master.connect(ctx.destination)
      audio.current = { ctx, master, step: 0 }
    }
    await audio.current.ctx.resume()
    audio.current.master.gain.setValueAtTime(0.32, audio.current.ctx.currentTime)
    setPlaying(true)
    pulse(audio.current)
  }

  return (
    <div className="siteControls" aria-label={english ? 'Site preferences' : 'Preferências do site'}>
      <button type="button" onClick={toggleSound} aria-pressed={playing} title={english ? 'Background sound' : 'Som de fundo'}>
        <span aria-hidden>{playing ? '◼' : '♪'}</span><span className="controlLabel">{playing ? (english ? 'Sound on' : 'Som ligado') : (english ? 'Sound' : 'Som')}</span>
      </button>
      <button type="button" onClick={toggleTheme} aria-pressed={light} title={english ? 'Change theme' : 'Mudar tema'}>
        <span aria-hidden>{light ? '☀' : '◐'}</span><span className="controlLabel">{light ? (english ? 'Light' : 'Claro') : (english ? 'Dark' : 'Escuro')}</span>
      </button>
      <a href={english ? '/' : '/en'} lang={english ? 'pt-BR' : 'en'} aria-label={english ? 'Versão em português' : 'English version'}>
        {english ? 'PT' : 'EN'}
      </a>
    </div>
  )
}
