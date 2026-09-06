import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { PeerDevelopmentHarness } from './features/peer/PeerDevelopmentHarness'
import { isPeerDevelopmentPath } from './features/peer/roomRoute'
import Landing from './pages/Landing/Landing'
import Dashboard from './pages/Dashboard/Dashboard'
import Discover from './pages/Discover/Discover'
import Friends from './pages/Friends/Friends'
import Messages from './pages/Messages/Messages'
import Profile from './pages/Profile/Profile'
import AccountSettings from './pages/AccountSettings/AccountSettings'
import Lobby from './pages/Lobby/Lobby'
import Room from './pages/Room/Room'

function App() {
  const [pathname, setPathname] = useState(window.location.pathname)

  useEffect(() => {
    const handlePopState = () => setPathname(window.location.pathname)
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  // The existing WebRTC/SignalR development harness keeps its own /dev/peer/*
  // route, checked before the router mounts — untouched from the original App.tsx.
  if (isPeerDevelopmentPath(pathname)) {
    return <PeerDevelopmentHarness />
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/discover" element={<Discover />} />
        <Route path="/friends" element={<Friends />} />
        <Route path="/messages" element={<Messages />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/account-settings" element={<AccountSettings />} />
        <Route path="/lobby/:roomId" element={<Lobby />} />
        <Route path="/room/:roomId" element={<Room />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
