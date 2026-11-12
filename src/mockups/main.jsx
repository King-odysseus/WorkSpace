import React from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider } from 'flowbite-react'
import { ThemeInit } from '../../.flowbite-react/init.jsx'
import '../pencil.css'
import { flowbiteTheme } from '../lib/flowbite-theme.js'
import HeroMockup from './HeroMockup.jsx'

// The same theme provider the app mounts, so the mockup's buttons are the app's
// real buttons (pill, bronze gold variant) and not Flowbite's defaults.
createRoot(document.getElementById('root')).render(
  <>
    <ThemeInit />
    <ThemeProvider theme={flowbiteTheme}>
      <HeroMockup />
    </ThemeProvider>
  </>,
)
