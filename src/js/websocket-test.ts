console.log("websocket-test.ts loaded");



// @ts-ignore
const socket = io();

console.log("socket", socket);

socket.on('server-pong', (data: any) => {
  console.log("server-pong", data);
});

socket.emit('client-ping', { message: 'ping' });
