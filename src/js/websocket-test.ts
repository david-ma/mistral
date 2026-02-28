/**
 * Socket.IO test client: connect, emit client-ping, show server-pong.
 * Expects global io from /socket.io/socket.io.js.
 */

declare global {
  interface Window {
    io: (url?: string, opts?: object) => SocketLike
  }
}

interface SocketLike {
  on(event: string, cb: (...args: any[]) => void): void
  emit(event: string, ...args: any[]): void
  connected: boolean
}

function main(): void {
  const statusEl = document.getElementById('status')
  const pingBtn = document.getElementById('pingBtn')
  const pongEl = document.getElementById('pong')

  function setStatus(text: string, connected: boolean): void {
    if (!statusEl) return
    statusEl.textContent = text
    statusEl.className = connected ? 'connected' : 'disconnected'
  }

  function setPong(text: string): void {
    if (pongEl) pongEl.textContent = text
  }

  if (!window.io) {
    setStatus('Socket.IO script not loaded.', false)
    return
  }

  const socket = window.io()

  socket.on('connect', () => {
    setStatus('Connected', true)
    if (pingBtn) (pingBtn as HTMLButtonElement).disabled = false
  })

  socket.on('disconnect', () => {
    setStatus('Disconnected', false)
    if (pingBtn) (pingBtn as HTMLButtonElement).disabled = true
  })

  socket.on('server-pong', (data: { message?: string; at?: string; echo?: unknown }) => {
    setPong(JSON.stringify(data, null, 2))
  })

  if (pingBtn) {
    pingBtn.addEventListener('click', () => {
      setPong('Waiting for pong…')
      socket.emit('client-ping', { ts: new Date().toISOString() })
    })
  }
}

main()
