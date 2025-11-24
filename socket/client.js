const { WebSocket } = require('ws');

const config = require('../config');
const handlers = require('../handlers/base');
const clientHandlers = require('../handlers/client');
const serverHandlers = require('../handlers/server');
const events = require('../utils/constants');
const utils = require('../utils/functions');

const PING_TIMEOUT = 1000 * 5 + 1000 * 1;
const RECONNECT_INTERVAL = 1000 * 10 + 1000 * 1;
const PING_VALUE = 1;

function connectWebSocketClient(wss) {
  const ws = new WebSocket(
    config.WEBSOCKET_CLIENT_URL + utils.encryptToken(config.SERVER_TOKEN),
  );
  ws.isProcessing = false;

  const reconnectInterval = () => {
    if (ws.readyState === ws.CLOSED) {
      connectWebSocketClient(wss);
    }
  };

  const ping = () => {
    if (!ws) {
      return;
    }
  
    if (ws.pingTimeout) {
      clearTimeout(ws.pingTimeout);
      ws.pingTimeout = null;
    }

    ws.pingTimeout = setTimeout(() => {
      ws.close();
      global.reconnectInterval = setInterval(
        reconnectInterval,
        RECONNECT_INTERVAL,
      );
    }, PING_TIMEOUT);

    const data = new Uint8Array(1);
    data[0] = PING_VALUE;
    ws.send(data);
  };

  const sendUsers = () => {
    if (wss.readyState === wss.OPEN) {
      ws.isProcessing = true;
      ws.send(
        JSON.stringify({
          type: events.INFORM_USERS,
          users: serverHandlers.getUsersConnected(wss),
        }),
      );
      ws.isProcessing = false;
    }
  };

  ws.on('open', () => {
    clearInterval(global.reconnectInterval);
    global.reconnectInterval = null;
    config.LOGGER.ws_cli('Connection started with dedicated ws');
  });

  ws.on('error', ( error ) => {
    console.log( error );
    config.LOGGER.ws_cli('Error trying to connect to dedicated ws');
  });

  ws.on('message', (msg, isBinary) => {
    if (isBinary) {
      ping();
    } else {
      const jsonMsg = JSON.parse(msg);
      if (jsonMsg) {
        config.LOGGER.ws_cli(`Local Server: ${msg}`);
        if (ws.msgFunction) {
          ws.msgFunction(jsonMsg);
        }
      }
    }
  });

  ws.on('close', (code, reason) => {
    const reasonString = Buffer.isBuffer(reason) ? reason.toString() : reason;
    config.LOGGER.ws_cli(`Connection closed with dedicated ws, code ${code}`);
    console.log(reasonString);

    if (ws.pingTimeout) {
      clearTimeout(ws.pingTimeout);
      ws.pingTimeout = null;
    }

    if (!global.reconnectInterval) {
      reconnectInterval();
      global.reconnectInterval = setInterval(
        reconnectInterval,
        RECONNECT_INTERVAL,
      );
    }
  });

  ws.msgFunction = (jsonMsg) => {
    if (jsonMsg.type === events.INFORM_USERS) {
      sendUsers();
    } else if (jsonMsg.type === events.ACTUAL_TRANSACTION) {
      config.LOGGER.ws_cli(`Received actual transaction: ${jsonMsg.type}`);
      handlers.sendAcknowledgment(ws, jsonMsg.type);
      if (wss.readyState === wss.OPEN) {
        const userId = jsonMsg.transaction.TrxUser;//traceability.id_cajero
        const folio = jsonMsg.transaction.TrxReference;//traceability.folio_unico_transaccion
        config.LOGGER.ws_cli(`Actual transaction data: Client - ${userId}, Folio - ${folio}`);
        let clientWs = null;
        wss.clients.forEach((client) => {
          config.LOGGER.ws_cli('Users connected for received transaction');
          if (client.readyState === WebSocket.OPEN
              && client.userId === userId) {
            clientWs = client;
            config.LOGGER.ws_cli('Found user for notification');
          }
          config.LOGGER.ws_cli(`Actual user connected: Client - ${client.userId}, Folio - ${client.actualFolio}`);
        });
        if (clientWs) {
          clientWs.actualTransaction = jsonMsg.transaction;
          clientHandlers.sendActualTransaction(clientWs);
          clientHandlers.updateLocalTransaction(clientWs);
          clientWs.eventQueue.add(events.ACTUAL_TRANSACTION);
        }
      }
    }
  };
}

module.exports = connectWebSocketClient;
