// Start with a websocket test page

// import 
import { RawWebsocketConfig } from '../node_modules/thalia/server/types'

export const websocket_config: RawWebsocketConfig = {
  listeners: {
    'client-ping': (socket: any, data: any, clientInfo: any, website: any) => {
      socket.emit('server-pong', { message: 'pong' });
    },
  },
}
