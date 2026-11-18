import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import App from './App.tsx'
import CargaInicial from './components/CargaInicial'
import './design-system.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter><CargaInicial><App /></CargaInicial></BrowserRouter>
  </StrictMode>,
)
