'use client'

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

type LeviContextValue = {
  open: boolean
  openChat: () => void
  closeChat: () => void
  toggleChat: () => void
}

const LeviContext = createContext<LeviContextValue | null>(null)

export function LeviProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)

  const openChat = useCallback(() => setOpen(true), [])
  const closeChat = useCallback(() => setOpen(false), [])
  const toggleChat = useCallback(() => setOpen((value) => !value), [])

  const value = useMemo(
    () => ({ open, openChat, closeChat, toggleChat }),
    [open, openChat, closeChat, toggleChat],
  )

  return <LeviContext.Provider value={value}>{children}</LeviContext.Provider>
}

export function useLevi() {
  const context = useContext(LeviContext)
  if (!context) throw new Error('useLevi precisa estar dentro de <LeviProvider>')
  return context
}
