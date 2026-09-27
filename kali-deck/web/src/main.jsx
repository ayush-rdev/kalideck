import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './styles.css'
import '@xterm/xterm/css/xterm.css'

// No StrictMode: terminal sessions open real PTYs - double-mounting in dev
// would spawn duplicate sessions for no benefit.
createRoot(document.getElementById('root')).render(<App />)
