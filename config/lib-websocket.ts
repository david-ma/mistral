// Start with a websocket test page

// import 

export const websocket_config = {
  listeners: {
    'client-ping': (socket: any, data: any, clientInfo: any, website: any) => {
      socket.emit('server-pong', { message: 'pong' });
    },
  },
}