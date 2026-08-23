import { expect, test, type BrowserContext, type Page } from '@playwright/test'

test('Room URL, refresh continuity, and automatic Host-initiated P2P work end to end', async ({
  browser,
}) => {
  const hostContext = await browser.newContext()
  const guestContext = await browser.newContext()
  const thirdContext = await browser.newContext()

  try {
    const host = await hostContext.newPage()
    await host.goto('/dev/peer')
    await host.getByRole('button', { name: 'Create Room' }).click()

    await expect(host).toHaveURL(/\/dev\/peer\/[0-9a-f-]{36}$/)
    const roomUrl = host.url()
    const roomId = new URL(roomUrl).pathname.split('/').at(-1)
    expect(roomId).toMatch(/^[0-9a-f-]{36}$/)
    expect(new URL(roomUrl).search).toBe('')
    expect(new URL(roomUrl).hash).toBe('')
    expect(await host.evaluate(() => window.history.state)).toBeNull()
    await expect(stateValue(host, 'Room Hub', 'Connection')).toHaveText('connected')
    await expect(host.getByText('Waiting for Guest.')).toBeVisible()
    await expect(host.getByRole('button', { name: 'Start P2P' })).toHaveCount(0)
    await expect(host.getByRole('button', { name: 'Reset Peer' })).toHaveCount(0)

    const guest = await guestContext.newPage()
    await guest.goto(roomUrl)
    await expect(guest.getByRole('heading', { name: 'Join Room' })).toBeVisible()
    await expect(guest.getByText(roomId!, { exact: true })).toBeVisible()
    await expect(guest.getByText('Host', { exact: true })).toHaveCount(0)
    await guest.getByRole('button', { name: 'Join Room' }).click()

    await expect(guest).toHaveURL(roomUrl)
    await expect(roleValue(guest, 'Guest')).toBeVisible()
    await expectPeerConnected(host)
    await expectPeerConnected(guest)
    await expect(host.getByRole('button', { name: 'Share Screen' })).toBeEnabled()
    await expect(guest.getByRole('button', { name: 'Share Screen' })).toHaveCount(0)
    await expect(guest.getByRole('button', { name: 'Start P2P' })).toHaveCount(0)

    await host.getByText('Developer diagnostics / controls').click()
    await host.getByRole('button', { name: 'Restart Peer Runtime' }).click()
    await expectPeerConnected(host)
    await expectPeerConnected(guest)

    await host.reload()
    await expect(roleValue(host, 'Host')).toBeVisible()
    await expect(stateValue(host, 'Room Hub', 'Connection')).toHaveText('connected')
    await expectPeerConnected(host)
    await expectPeerConnected(guest)
    await expect(host.getByRole('button', { name: 'Share Screen' })).toBeEnabled()

    await guest.reload()
    await expect(roleValue(guest, 'Guest')).toBeVisible()
    await expect(stateValue(guest, 'Room Hub', 'Connection')).toHaveText('connected')
    await expectPeerConnected(host)
    await expectPeerConnected(guest)

    await host.getByText('Developer diagnostics / controls').click()
    await expect(host.getByRole('button', { name: 'Start P2P' })).toHaveCount(0)
    await expect(host.getByRole('button', { name: 'Reset Peer' })).toHaveCount(0)
    await host.getByRole('button', { name: 'Disconnect Hub' }).click()
    await expect(stateValue(host, 'Room Hub', 'Connection')).not.toHaveText('connected')

    // Automatic Hub recovery only: no Reconnect Hub, Start P2P, or Reset Peer click below.
    await expect(stateValue(host, 'Room Hub', 'Connection')).toHaveText('connected', {
      timeout: 20_000,
    })
    await expect(stateValue(host, 'Room Hub', 'Guest presence')).toHaveText('online')
    await expect(stateValue(guest, 'Room Hub', 'Host presence')).toHaveText('online')
    await expectPeerConnected(host)
    await expectPeerConnected(guest)
    await expect(host).toHaveURL(roomUrl)
    await expect(guest).toHaveURL(roomUrl)

    const third = await thirdContext.newPage()
    await third.goto(roomUrl)
    await expect(third.getByRole('heading', { name: 'Join Room' })).toBeVisible()
    await expect(roleValue(third, 'Host')).toHaveCount(0)
    await expect(roleValue(third, 'Guest')).toHaveCount(0)
    await third.getByRole('button', { name: 'Join Room' }).click()
    await expect(third.getByText('The Guest session could not be created or connected.')).toBeVisible()
    await expect(third.getByRole('heading', { name: 'Join Room' })).toBeVisible()

    await host.goBack()
    await expect(host).toHaveURL(/\/dev\/peer$/)
    await expect(host.getByRole('button', { name: 'Create Room' })).toBeVisible()
    await expect(stateValue(guest, 'Room Hub', 'Host presence')).toHaveText('offline')

    await host.goForward()
    await expect(host).toHaveURL(roomUrl)
    await expect(roleValue(host, 'Host')).toBeVisible()
    await expectPeerConnected(host)
    await expectPeerConnected(guest)

    await host.getByRole('button', { name: 'Reset Session' }).click()
    await expect(host).toHaveURL(/\/dev\/peer$/)
    await host.goto(roomUrl)
    await expect(host.getByRole('heading', { name: 'Join Room' })).toBeVisible()
    await expect(roleValue(host, 'Host')).toHaveCount(0)
  } finally {
    await closeContexts(thirdContext, guestContext, hostContext)
  }
})

async function expectPeerConnected(page: Page): Promise<void> {
  await expect(page.getByText('Peer connected.')).toBeVisible()
  await expect(stateValue(page, 'WebRTC peer', 'Connection')).toHaveText('connected')
  await expect(stateValue(page, 'WebRTC peer', 'ICE connection')).toHaveText('connected')
  await expect(stateValue(page, 'WebRTC peer', 'Signaling')).toHaveText('stable')
}

function stateValue(page: Page, sectionHeading: string, label: string) {
  const section = page.getByRole('heading', { name: sectionHeading }).locator('..')
  return section
    .locator('dt')
    .filter({ hasText: new RegExp(`^${label}$`) })
    .locator('xpath=following-sibling::dd')
}

function roleValue(page: Page, role: 'Host' | 'Guest') {
  return page.locator('strong').filter({ hasText: new RegExp(`^${role}$`) })
}

async function closeContexts(...contexts: BrowserContext[]): Promise<void> {
  await Promise.all(contexts.map((context) => context.close()))
}
