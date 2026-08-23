import { useEffect, useState } from 'react'
import './App.css'
import { PeerDevelopmentHarness } from './features/peer/PeerDevelopmentHarness'
import { isPeerDevelopmentPath } from './features/peer/roomRoute'

function App() {
  const [pathname, setPathname] = useState(window.location.pathname)

  useEffect(() => {
    const handlePopState = () => setPathname(window.location.pathname)
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  if (isPeerDevelopmentPath(pathname)) {
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
