import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from './App'
import './shell.css'

const container = document.getElementById('root')

// A missing mount point means the HTML and the bundle disagree (wrong document,
// or the div was renamed). Throwing with the reason here is clearer than a null
// assertion failing somewhere inside React's mount path.
if (container === null) {
  throw new Error('ZuriCopilot renderer: no #root element in the document')
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
)
