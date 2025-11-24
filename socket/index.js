const { WebSocketServer, WebSocket } = require('ws');

const connectWebSocketClient = require('./client');
const config = require('../config');
const handlers = require('../handlers/base');
const clientHandlers = require('../handlers/client');
const requests = require('../requests/base');
const events = require('../utils/constants');
const utils = require('../utils/functions');
const Queue = require('../utils/queue');

const PING_INTERVAL = 1000 * 5;
const QUEUE_INTERVAL = 1000 * 30;
const CLEAN_CONNECTIONS_INTERVAL = 1000 * 60 * 5;
const PING_VALUE = 1;
const ACKNOWLEDGEMENT_EVENTS_CLIENTS = [
  events.INFORM_TRANSACTIONS,
  events.ACTUAL_TRANSACTION
];

const onsSocketPreError = (error) => {
  config.LOGGER.error(`Error on socket setUp: ${error}`);
};

const onsSocketPostError = (error) => {
  config.LOGGER.error(`Error on socket process: ${error}`);
};

const ping = (ws) => {
  ws.send(PING_VALUE, { binary: true });
};

function setUp(server) {
  const wss = new WebSocketServer({ noServer: true });
  connectWebSocketClient(wss);

  server.on('upgrade', (req, socket, head) => {
    socket.on('error', onsSocketPreError);

    const destroySocket = () => {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
    };

    const encryptedToken = req.url.substring(1);
    if (!encryptedToken) {
      destroySocket();
    }

    const token = utils.decryptToken(encryptedToken);
    // Validate if user is already connected
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN
          && token === client.token){
        destroySocket();
      }
    });

    requests.verifyToken(token)
      .then((response) => {
        const { data } = response;
        if ('status' in data && data.status === 200) {
          const userId = data.id_usuario;
          wss.handleUpgrade(req, socket, head, (ws) => {
            socket.removeListener('error', onsSocketPreError);
            wss.emit('connection', ws, token, userId);
          });
        }
      })
      .catch((error) => {
        destroySocket();
        config.LOGGER.api(`Respuesta del servicio: ${error}`);
        config.LOGGER.api(`Invalid token ${token}`);
      });
  });

  wss.on('connection', (ws, token, userId) => {
    ws.token = token;
    ws.userId = userId;
    ws.isAlive = true;
    ws.isProcessing = false;
    ws.eventQueue = new Queue();
    ws.actualFolio = null;

    ws.actualTransaction = null;
    ws.actualStatus = null;
    ws.viewedTransactions = [];

    if (ws.readyState === WebSocket.OPEN) {
      config.LOGGER.conn(`Connection started with user ${userId}`);
      clientHandlers.getTransactionList(ws);
    }

    ws.on('error', onsSocketPostError);

    ws.on('message', (msg, isBinary) => {
      if (isBinary && (msg)[0] === PING_VALUE) {
        ws.isAlive = true;
      } else if (utils.isJSON(msg)) {
        const jsonMsg = JSON.parse(msg);
        config.LOGGER.recv(`User ${ws.userId}: ${msg}`);
        if (ACKNOWLEDGEMENT_EVENTS_CLIENTS.includes(jsonMsg.type)) {
          ws.eventQueue.remove(jsonMsg.type);
          if (jsonMsg.type === events.ACTUAL_TRANSACTION) {
            ws.viewedTransactions = [
              ...ws.viewedTransactions,
              ws.actualTransaction.TrxReference,/*traceability.folio_unico_transaccion*/
            ];
            clientHandlers.updateViewedTransactions(ws);
          }
        } else if (jsonMsg.type === events.INFORM_VIEWED_TRANSACTION) {
          handlers.sendAcknowledgment(ws, jsonMsg.type);
          ws.viewedTransactions = [...ws.viewedTransactions, ...jsonMsg.folios];
          clientHandlers.updateViewedTransactions(ws);
        } else if (jsonMsg.type === events.GET_TRANSACTION_STATUS) {
          handlers.sendAcknowledgment(ws, jsonMsg.type);
          ws.actualStatus = jsonMsg.payload;
          clientHandlers.getTransactionStatus(ws);
        } else if (jsonMsg.type === events.INFORM_FOLIO) {
          handlers.sendAcknowledgment(ws, jsonMsg.type);
          ws.actualFolio = jsonMsg.folio;
          console.log( jsonMsg.folio );
        }
      } else {
        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(msg, { binary: isBinary });
          }
        });
      }
    });

    ws.on('close', () => {
      clientHandlers.updateViewedTransactions(ws);
      config.LOGGER.conn(`Connection closed with user ${ws.userId}`);
    });
  });

  const sendAllViewedTransactions = () => {
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN && !client.isServer) {
        clientHandlers.updateViewedTransactions(client);
      }
    });
  };

  const interval = setInterval(() => {
    wss.clients.forEach((client) => {
      if (!client.isAlive) {
        client.terminate();
        return;
      }

      client.isAlive = false;
      ping(client);
    });
  }, PING_INTERVAL);

  const queueInterval = setInterval(() => {
    wss.clients.forEach((client) => {
      client.eventQueue.get().forEach((event) => {
        config.LOGGER.queue(`Queue started for ${client.userId}, processing ${client.isProcessing}, queue ${client.eventQueue.get()}`);
        if (client.readyState === WebSocket.OPEN && !client.isProcessing) {
          if (event === events.INFORM_TRANSACTIONS) {
            clientHandlers.getTransactionList(client);
          } else if (event === events.UPDATE_VIEWED_TRANSACTION) {
            clientHandlers.updateViewedTransactions(client);
          } else if (event === events.ACTUAL_TRANSACTION) {
            clientHandlers.sendActualTransaction(client);
          } else if (event === events.GET_TRANSACTION_STATUS) {
            clientHandlers.getTransactionStatus(client);
          }
        }
      });
    });
  }, QUEUE_INTERVAL);

  const cleanConnectionsInterval = setInterval(() => {
    wss.clients.forEach((client) => {
      if (client.readyState !== WebSocket.OPEN) {
        client.terminate();
      }
    });
  }, CLEAN_CONNECTIONS_INTERVAL);

  wss.on('close', () => {
    clearInterval(interval);
    clearInterval(queueInterval);
    clearInterval(cleanConnectionsInterval);
    sendAllViewedTransactions();
    config.LOGGER.server('Closing websocket server connection');
  });
}

module.exports = setUp;
