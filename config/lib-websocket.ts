/**
 * Socket.IO (WebSocket) config for SmugMug.
 * Used by config.ts via websocket_config. Listeners: client-ping → server-pong (test); bingo-subscribe / bingo-cell-updated later.
 */
import type { RawWebsiteConfig } from 'thalia/types'

export const websocket_config: RawWebsiteConfig = {
  websockets: {
    listeners: {
      'client-ping': (socket, data, _clientInfo, _website) => {
        socket.emit('server-pong', {
          message: 'pong',
          at: new Date().toISOString(),
          echo: data ?? null,
        })
      },
    },
  }
}
