import React from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider } from 'flowbite-react'
import { ThemeInit } from '../../../.flowbite-react/init.jsx'
import '../../pencil.css'
import { flowbiteTheme } from '../../lib/flowbite-theme.js'
import CopilotMockup from './CopilotMockup.jsx'

// Same theme provider the app mounts, so buttons and tokens are the app's own.
createRoot(document.getElementById('root')).render(
  <>
    <ThemeInit />
    <ThemeProvider theme={flowbiteTheme}>
      <CopilotMockup />
    </ThemeProvider>
  </>,
)
