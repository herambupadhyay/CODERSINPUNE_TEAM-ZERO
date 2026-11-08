import { createContext, useContext, type ReactNode } from 'react'
import { useLenis } from '@/hooks/useLenis'

type ScrollApi = {
  scrollTo: (target: string | number, offset?: number) => void
  stop: () => void
  start: () => void
}

const ScrollContext = createContext<ScrollApi>({
  scrollTo: (target) => {
    if (typeof target === 'string') {
      document.querySelector(target)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  },
  stop: () => {},
  start: () => {},
})

export function ScrollProvider({ children }: { children: ReactNode }) {
  const api = useLenis()
  return <ScrollContext.Provider value={api}>{children}</ScrollContext.Provider>
}

export function useScroll() {
  return useContext(ScrollContext)
}
