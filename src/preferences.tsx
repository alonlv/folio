import { createContext, useContext, useLayoutEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { hebrew } from './hebrew'

type Language = 'en' | 'he'
type Theme = 'system' | 'light' | 'dark'
type Values = Record<string, string | number>
type Translate = (message: string, values?: Values) => string

const Preferences = createContext<{
  language: Language
  theme: Theme
  setLanguage: (language: Language) => void
  setTheme: (theme: Theme) => void
  t: Translate
} | null>(null)

const systemTheme = matchMedia('(prefers-color-scheme: dark)')
const subscribeToSystemTheme = (change: () => void) => {
  systemTheme.addEventListener('change', change)
  return () => systemTheme.removeEventListener('change', change)
}
const isSystemDark = () => systemTheme.matches

function readPreference(key: string) {
  try { return localStorage.getItem('folio-' + key) } catch { return null }
}

function writePreference(key: string, value: string) {
  try { localStorage.setItem('folio-' + key, value) } catch { /* Preferences still apply to this tab. */ }
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(() => {
    const saved = readPreference('language')
    if (saved === 'he' || saved === 'en') return saved
    return /^he\b/i.test(navigator.language) ? 'he' : 'en'
  })
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = readPreference('theme')
    return saved === 'light' || saved === 'dark' ? saved : 'system'
  })
  const systemDark = useSyncExternalStore(subscribeToSystemTheme, isSystemDark)
  const dark = theme === 'dark' || (theme === 'system' && systemDark)
  const t: Translate = (message, values) => {
    const text = language === 'he' && Object.hasOwn(hebrew, message) ? hebrew[message] : message
    return values ? text.replace(/\{(\w+)\}/g, (key, field) => String(values[field] ?? key)) : text
  }

  useLayoutEffect(() => {
    const root = document.documentElement
    root.lang = language
    root.dir = language === 'he' ? 'rtl' : 'ltr'
    document.title = t('Folio — Your PDF workspace')
    writePreference('language', language)
  }, [language])

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#080b09' : '#f7f8f5')
    writePreference('theme', theme)
  }, [dark, theme])

  return <Preferences.Provider value={{ language, theme, setLanguage, setTheme, t }}>{children}</Preferences.Provider>
}

export function usePreferences() {
  return useContext(Preferences)!
}
