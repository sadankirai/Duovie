import './App.css'
import { PeerDevelopmentHarness } from './features/peer/PeerDevelopmentHarness'

function App() {
  if (window.location.pathname === '/dev/peer') {
    return <PeerDevelopmentHarness />
  }

  return (
    <main className="app-shell">
      <section aria-labelledby="duovie-title">
        <h1 id="duovie-title">Duovie</h1>
        <p>Private movie dates, together.</p>
        <p className="development-status">Early development</p>
      </section>
    </main>
  )
}

export default App
