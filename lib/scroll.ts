import type Lenis from 'lenis'

let instance: Lenis | null = null

export function registerLenis(lenis: Lenis | null) {
  instance = lenis
}

/** Deslocamento necessário para o header sticky não cobrir o alvo. */
function navOffset() {
  const nav = document.querySelector<HTMLElement>('.nav')
  return -((nav?.offsetHeight ?? 72) + 10)
}

/** Rola até um seletor (`#servicos`) usando Lenis quando disponível. */
export function scrollToId(selector: string) {
  const target = document.querySelector<HTMLElement>(selector)
  if (!target) return

  if (instance) {
    instance.scrollTo(target, { offset: navOffset(), duration: 1.4 })
    return
  }

  const top = target.getBoundingClientRect().top + window.scrollY + navOffset()
  window.scrollTo({ top, behavior: 'smooth' })
}

export const EASE_OUT = [0.22, 1, 0.36, 1] as const
