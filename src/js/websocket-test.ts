console.log("websocket-test.ts loaded");

const socket = io();

socket.on('server-pong', (data: any) => {
  console.log("server-pong", data);
});

socket.emit('client-ping', { message: 'ping' });
