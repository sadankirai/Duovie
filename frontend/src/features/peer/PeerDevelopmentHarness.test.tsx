import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GuestRemoteVideo,
  PeerDevelopmentHarness,
  type PeerHarnessDependencies,
  type RoomHubRuntime,
} from './PeerDevelopmentHarness'
import { browserParticipantCredentialStorage } from './participantCredentialStorage'
import type { RoomHubHandlers } from './RoomHubClient'
import type { RoomSession } from './contracts'

describe('GuestRemoteVideo', () => {
  beforeEach(() => {
    Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
      configurable: true,
      writable: true,
      value: null,
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('hides a retained frozen stream while inactive and reuses it when sharing resumes', async () => {
    const play = vi
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockResolvedValue(undefined)
    const stream = {} as MediaStream
    const { rerender, unmount } = render(
      <GuestRemoteVideo active stream={stream} />,
    )
    const video = screen.getByLabelText('Host shared display') as HTMLVideoElement

    await waitFor(() => expect(video.srcObject).toBe(stream))
    expect(video).not.toHaveAttribute('hidden')
    expect(play).toHaveBeenCalledTimes(1)

    rerender(<GuestRemoteVideo active={false} stream={stream} />)

    expect(video).toHaveAttribute('hidden')
    expect(screen.getByText('Host is not sharing.')).toBeInTheDocument()
    expect(video.srcObject).toBe(stream)

    rerender(<GuestRemoteVideo active stream={stream} />)

    expect(video).not.toHaveAttribute('hidden')
    expect(screen.queryByText('Host is not sharing.')).not.toBeInTheDocument()
    expect(video.srcObject).toBe(stream)
    expect(play).toHaveBeenCalledTimes(1)

    unmount()
    expect(video.srcObject).toBeNull()
  })
})

const firstRoomId = 'a3f45d1e-6c6e-4cab-9dc8-246a2bc74995'
const secondRoomId = 'bd7a3863-58d4-4caf-89da-35309f4a6e93'
const hostCredential = 'H'.repeat(43)
const guestCredential = 'G'.repeat(43)
const hostSession: RoomSession = {
  roomId: firstRoomId,
  participantId: 'ec71c4ae-dbc9-4fb4-94bd-acbfeb04389a',
  role: 'Host',
  credential: hostCredential,
}
const guestSession: RoomSession = {
  roomId: firstRoomId,
  participantId: '3305e07a-0c6b-477d-9ff8-82ba80114e29',
  role: 'Guest',
  credential: guestCredential,
}

describe('PeerDevelopmentHarness Room session continuity', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/dev/peer')
    window.sessionStorage.clear()
  })

  afterEach(() => {
    cleanup()
    window.sessionStorage.clear()
    vi.restoreAllMocks()
  })

  it('stores a created Host credential and moves to a credential-free Room URL', async () => {
    const fixture = createHarnessFixture()
    const pushState = vi.spyOn(window.history, 'pushState')
    render(<PeerDevelopmentHarness dependencies={fixture.dependencies} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Create Room' }))

    await waitFor(() => expect(window.location.pathname).toBe(`/dev/peer/${firstRoomId}`))
    expect(fixture.createRoomSession).toHaveBeenCalledTimes(1)
    expect(browserParticipantCredentialStorage.read(firstRoomId)).toBe(hostCredential)
    expect(screen.getByText('Host', { selector: 'strong' })).toBeInTheDocument()
    expect(fixture.hubs).toHaveLength(1)
    expect(fixture.hubs[0].startCount).toBe(1)
    const navigation = pushState.mock.calls.at(-1)
    expect(navigation?.[0]).toBeNull()
    expect(navigation?.[2]).toBe(`/dev/peer/${firstRoomId}`)
    expect(window.location.href).not.toContain(hostCredential)
    expect(window.location.search).toBe('')
    expect(window.location.hash).toBe('')
    expect(JSON.stringify(window.history.state)).not.toContain(hostCredential)
  })

  it('binds a direct Room locator to Join and stores the issued Guest session', async () => {
    window.history.replaceState(null, '', `/dev/peer/${firstRoomId}`)
    const fixture = createHarnessFixture()
    render(<PeerDevelopmentHarness dependencies={fixture.dependencies} />)

    expect(await screen.findByRole('heading', { name: 'Join Room' })).toBeInTheDocument()
    expect(screen.getByText(firstRoomId)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Create Room' })).not.toBeInTheDocument()
    expect(fixture.resumeRoomSession).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Join Room' }))

    await waitFor(() => expect(fixture.joinRoomSession).toHaveBeenCalledWith(firstRoomId))
    expect(browserParticipantCredentialStorage.read(firstRoomId)).toBe(guestCredential)
    expect(window.location.pathname).toBe(`/dev/peer/${firstRoomId}`)
    expect(window.location.href).not.toContain(guestCredential)
    expect(screen.getByText('Guest', { selector: 'strong' })).toBeInTheDocument()
  })

  it('moves a Guest joining from the root form to the Room-specific URL', async () => {
    const fixture = createHarnessFixture()
    const pushState = vi.spyOn(window.history, 'pushState')
    render(<PeerDevelopmentHarness dependencies={fixture.dependencies} />)
    const roomInput = await screen.findByLabelText('Room ID')

    fireEvent.change(roomInput, { target: { value: firstRoomId } })
    fireEvent.click(screen.getByRole('button', { name: 'Join Room' }))

    await waitFor(() => expect(window.location.pathname).toBe(`/dev/peer/${firstRoomId}`))
    expect(fixture.joinRoomSession).toHaveBeenCalledWith(firstRoomId)
    expect(browserParticipantCredentialStorage.read(firstRoomId)).toBe(guestCredential)
    expect(pushState.mock.calls.at(-1)?.[0]).toBeNull()
    expect(pushState.mock.calls.at(-1)?.[2]).toBe(`/dev/peer/${firstRoomId}`)
    expect(window.location.href).not.toContain(guestCredential)
    expect(JSON.stringify(window.history.state)).not.toContain(guestCredential)
  })

  it('restores only server-canonical identity and reconnects the Hub from a stored credential', async () => {
    window.history.replaceState(null, '', `/dev/peer/${firstRoomId}`)
    browserParticipantCredentialStorage.write(firstRoomId, hostCredential)
    const fixture = createHarnessFixture()
    fixture.resumeRoomSession.mockResolvedValue({
      roomId: firstRoomId,
      participantId: guestSession.participantId,
      role: 'Guest',
      credential: 'server-response-does-not-own-the-credential',
    })
    render(<PeerDevelopmentHarness dependencies={fixture.dependencies} />)

    expect(await screen.findByText('Guest', { selector: 'strong' })).toBeInTheDocument()
    expect(fixture.resumeRoomSession).toHaveBeenCalledWith(
      firstRoomId,
      hostCredential,
      expect.any(AbortSignal),
    )
    expect(fixture.hubs).toHaveLength(1)
    expect(fixture.hubs[0].session).toEqual({
      roomId: firstRoomId,
      participantId: guestSession.participantId,
      role: 'Guest',
      credential: hostCredential,
    })
    expect(fixture.hubs[0].startCount).toBe(1)
    expect(screen.getAllByText('new')).toHaveLength(3)
  })

  it('clears an unusable stored credential and falls back to unauthenticated Join', async () => {
    window.history.replaceState(null, '', `/dev/peer/${firstRoomId}`)
    browserParticipantCredentialStorage.write(firstRoomId, hostCredential)
    const fixture = createHarnessFixture()
    fixture.resumeRoomSession.mockRejectedValue(new Error('expired private detail'))
    render(<PeerDevelopmentHarness dependencies={fixture.dependencies} />)

    expect(await screen.findByRole('heading', { name: 'Join Room' })).toBeInTheDocument()
    expect(
      screen.getByText('The stored participant session is no longer usable. Join the Room again.'),
    ).toBeInTheDocument()
    expect(browserParticipantCredentialStorage.read(firstRoomId)).toBeNull()
    expect(fixture.hubs).toHaveLength(0)
    expect(screen.queryByText('expired private detail')).not.toBeInTheDocument()
  })

  it('scopes credentials by Room and never restores Room A authority at Room B', async () => {
    browserParticipantCredentialStorage.write(firstRoomId, hostCredential)
    window.history.replaceState(null, '', `/dev/peer/${secondRoomId}`)
    const fixture = createHarnessFixture()
    render(<PeerDevelopmentHarness dependencies={fixture.dependencies} />)

    expect(await screen.findByText(secondRoomId)).toBeInTheDocument()
    expect(fixture.resumeRoomSession).not.toHaveBeenCalled()
    expect(fixture.hubs).toHaveLength(0)
    expect(browserParticipantCredentialStorage.read(firstRoomId)).toBe(hostCredential)
  })

  it('Reset Session clears storage, stops the runtime, and returns to the root route', async () => {
    window.history.replaceState(null, '', `/dev/peer/${firstRoomId}`)
    browserParticipantCredentialStorage.write(firstRoomId, hostCredential)
    const fixture = createHarnessFixture()
    fixture.resumeRoomSession.mockResolvedValue(hostSession)
    render(<PeerDevelopmentHarness dependencies={fixture.dependencies} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Reset Session' }))

    await waitFor(() => expect(window.location.pathname).toBe('/dev/peer'))
    expect(browserParticipantCredentialStorage.read(firstRoomId)).toBeNull()
    expect(fixture.hubs[0].stopCount).toBeGreaterThanOrEqual(1)
    expect(screen.getByRole('button', { name: 'Create Room' })).toBeInTheDocument()
  })

  it('popstate disposes the old runtime and stale restore completion cannot repopulate a new route', async () => {
    window.history.replaceState(null, '', `/dev/peer/${firstRoomId}`)
    browserParticipantCredentialStorage.write(firstRoomId, hostCredential)
    const firstRestore = deferred<RoomSession>()
    const fixture = createHarnessFixture()
    fixture.resumeRoomSession.mockReturnValue(firstRestore.promise)
    render(<PeerDevelopmentHarness dependencies={fixture.dependencies} />)
    await waitFor(() => expect(fixture.resumeRoomSession).toHaveBeenCalledTimes(1))

    window.history.pushState(null, '', `/dev/peer/${secondRoomId}`)
    window.dispatchEvent(new PopStateEvent('popstate'))
    expect(await screen.findByText(secondRoomId)).toBeInTheDocument()

    firstRestore.resolve(hostSession)
    await Promise.resolve()

    expect(fixture.hubs).toHaveLength(0)
    expect(screen.queryByText('Host', { selector: 'strong' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Join Room' })).toBeInTheDocument()
  })

  it('popstate away from the peer harness stops its Hub without rewriting the destination', async () => {
    window.history.replaceState(null, '', `/dev/peer/${firstRoomId}`)
    browserParticipantCredentialStorage.write(firstRoomId, hostCredential)
    const fixture = createHarnessFixture()
    fixture.resumeRoomSession.mockResolvedValue(hostSession)
    render(<PeerDevelopmentHarness dependencies={fixture.dependencies} />)
    expect(await screen.findByText('Host', { selector: 'strong' })).toBeInTheDocument()

    window.history.pushState(null, '', '/')
    window.dispatchEvent(new PopStateEvent('popstate'))

    await waitFor(() => expect(fixture.hubs[0].stopCount).toBeGreaterThanOrEqual(1))
    expect(window.location.pathname).toBe('/')
    expect(screen.getByRole('button', { name: 'Create Room' })).toBeInTheDocument()
    expect(browserParticipantCredentialStorage.read(firstRoomId)).toBe(hostCredential)
  })
})

function createHarnessFixture() {
  const createRoomSession = vi.fn<PeerHarnessDependencies['createRoomSession']>()
    .mockResolvedValue(hostSession)
  const joinRoomSession = vi.fn<PeerHarnessDependencies['joinRoomSession']>()
    .mockResolvedValue(guestSession)
  const resumeRoomSession = vi.fn<PeerHarnessDependencies['resumeRoomSession']>()
  const hubs: FakeRoomHubRuntime[] = []
  const createHubClient = vi.fn<PeerHarnessDependencies['createHubClient']>(
    (session, handlers) => {
      const hub = new FakeRoomHubRuntime(session, handlers)
      hubs.push(hub)
      return hub
    },
  )
  const dependencies: PeerHarnessDependencies = {
    createRoomSession,
    joinRoomSession,
    resumeRoomSession,
    participantCredentialStorage: browserParticipantCredentialStorage,
    createHubClient,
  }

  return {
    dependencies,
    createRoomSession,
    joinRoomSession,
    resumeRoomSession,
    createHubClient,
    hubs,
  }
}

class FakeRoomHubRuntime implements RoomHubRuntime {
  public startCount = 0
  public stopCount = 0
  private connected = false
  public readonly session: RoomSession
  private readonly handlers: RoomHubHandlers

  public constructor(
    session: RoomSession,
    handlers: RoomHubHandlers,
  ) {
    this.session = session
    this.handlers = handlers
  }

  public async start(): Promise<void> {
    this.startCount += 1
    this.connected = true
  }

  public async stop(): Promise<void> {
    this.stopCount += 1
    this.connected = false
  }

  public async disconnect(): Promise<void> {
    this.connected = false
    this.handlers.onDisconnected()
  }

  public isConnected(): boolean {
    return this.connected
  }

  public async sendOffer(): Promise<void> {}

  public async sendAnswer(): Promise<void> {}

  public async sendIceCandidate(): Promise<void> {}

  public async sendScreenShareState(): Promise<void> {}
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((fulfill) => {
    resolve = fulfill
  })

  return { promise, resolve }
}
