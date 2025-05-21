// websocket.js
const WebSocket = require('ws');

// Function to create WebSocket with reconnection logic
function createWebSocket(url, handler, wsType, symbol) {
  const ws = new WebSocket(url);

  ws.on('message', handler);

  ws.on('error', (error) => {
    console.error(
      `[${symbol.toUpperCase()}] ${wsType} WebSocket error:`,
      error.message
    );
  });

  ws.on('close', (code, reason) => {
    console.log(
      `[${symbol.toUpperCase()}] ${wsType} WebSocket closed. Code: ${code}, Reason: ${reason.toString()}. Reconnecting in 5 seconds...`
    );
    setTimeout(() => {
      console.log(
        `[${symbol.toUpperCase()}] Attempting to reconnect ${wsType} WebSocket...`
      );
      createWebSocket(url, handler, wsType, symbol); // Pass symbol back for logging
    }, 5000);
  });

  ws.on('open', () => {
    console.log(`[${symbol.toUpperCase()}] ${wsType} WebSocket opened.`);
  });

  // Add ping/pong to keep connection alive
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
    } else {
      clearInterval(pingInterval);
    }
  }, 30000); // Send ping every 30 seconds

  return ws;
}

module.exports = {
  createWebSocket,
};
