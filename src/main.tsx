import { createRoot } from 'react-dom/client'
import '@fontsource-variable/manrope'
import '@fontsource-variable/dm-sans'
import './style.css'
import './theme.css'
import { App } from './app'
import { PreferencesProvider } from './preferences'

createRoot(document.getElementById('root')!).render(<PreferencesProvider><App /></PreferencesProvider>)
