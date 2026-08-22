'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'

export default function SiteControls() {
  const pathname = usePathname()
  const english = pathname.startsWith('/en')
  const [light, setLight] = useState(false)
  const [playing, setPlaying] = useState(false)
  const audio = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    document.documentElement.lang = english ? 'en' : 'pt-BR'
    const saved = localStorage.getItem('cassiellos-theme')
    const next = saved === 'light'
    setLight(next)
    document.documentElement.dataset.theme = next ? 'light' : 'dark'
    return () => audio.current?.pause()
  }, [english])

  const toggleTheme = () => {
    const next = !light
    setLight(next)
    document.documentElement.dataset.theme = next ? 'light' : 'dark'
    localStorage.setItem('cassiellos-theme', next ? 'light' : 'dark')
  }

  const toggleSound = async () => {
    if (playing && audio.current) {
      audio.current.pause()
      setPlaying(false)
      return
    }
    if (!audio.current) {
      audio.current = new Audio('/cassiellos-countdown-30s.mp3')
      audio.current.loop = true
      audio.current.volume = 0.32
    }
    try {
      await audio.current.play()
      setPlaying(true)
    } catch {
      setPlaying(false)
    }
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
