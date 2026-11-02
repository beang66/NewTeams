import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/noto-serif-kr/korean-700.css'
import './styles/tokens.css'
import './styles/base.css'
import './styles/shell.css'
import './styles/lanes.css'
import './styles/paper.css'
import './styles/screens.css'
import './styles/panel.css'
import './styles/home.css'
import './styles/workspace.css'
import './styles/motion.css'
import { App } from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
