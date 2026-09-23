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

// Código de cierre propio (el rango 4000-4999 es para uso de la aplicación).
// Debe coincidir con CLOSE_DUPLICATE_SESSION_GETNET en websocket_client_getnet.js
const CLOSE_DUPLICATE_SESSION = 4001;
const DUPLICATE_SESSION_MESSAGE = 'Este usuario ya tiene una sesión abierta en otra pestaña o equipo.';
// Tiempo máximo para que una conexión existente responda antes de
// considerarla "fantasma" (pestaña cerrada cuyo cierre no llegó al servidor)
const PROBE_TIMEOUT = 1000 * 3;

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
  // Servidor auxiliar SIN clientTracking: solo acepta la conexión duplicada,
  // le avisa al navegador y la cierra. Estas conexiones nunca entran a
  // wss.clients, así que no afectan los intervalos de ping ni de cola.
  const wssRechazo = new WebSocketServer({ noServer: true, clientTracking: false });
  connectWebSocketClient(wss);

  const getConnectedClients = (token, userId) => {
    const found = [];
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN
          && (client.token === token
              || (userId !== undefined && client.userId === userId))) {
        found.push(client);
      }
    });
    return found;
  };

  // Manda un ping de protocolo a la conexión existente. El navegador responde
  // el pong automáticamente mientras la pestaña siga abierta; si no responde
  // a tiempo, la conexión es un fantasma.
  const isClientAlive = (client) => new Promise((resolve) => {
    let finished = false;
    const finish = (alive) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      client.removeListener('pong', onPong);
      client.removeListener('close', onClose);
      resolve(alive);
    };
    const onPong = () => finish(true);
    const onClose = () => finish(false);
    const timer = setTimeout(() => finish(false), PROBE_TIMEOUT);

    client.once('pong', onPong);
    client.once('close', onClose);
    try {
      client.ping();
    } catch (error) {
      finish(false);
    }
  });

  // Regresa true solo si hay otra sesión REALMENTE activa.
  // Las conexiones fantasma se eliminan para dejar entrar al usuario.
  const hasActiveSession = async (token, userId) => {
    const clients = getConnectedClients(token, userId);
    if (clients.length === 0) return false;

    const results = await Promise.all(clients.map(isClientAlive));
    let active = false;
    results.forEach((alive, i) => {
      if (alive) {
        active = true;
      } else {
        config.LOGGER.conn(`Conexión fantasma del usuario ${clients[i].userId} eliminada`);
        clients[i].terminate();
      }
    });
    return active;
  };

  // Evita que dos conexiones del mismo usuario que llegan al mismo tiempo
  // pasen ambas la validación mientras se espera la respuesta de la API.
  const pendingUsers = new Set();

  server.on('upgrade', (req, socket, head) => {
    socket.on('error', onsSocketPreError);

    const destroySocket = () => {
      if (socket.destroyed) return;
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
    };

    // El navegador no puede leer un 401 del handshake (solo ve un close 1006),
    // por eso para sesión duplicada se acepta la conexión, se manda el motivo
    // y se cierra con un código que el cliente sí puede leer en event.code.
    const rejectDuplicateSession = (userId) => {
      if (socket.destroyed) return;
      wssRechazo.handleUpgrade(req, socket, head, (ws) => {
        socket.removeListener('error', onsSocketPreError);
        ws.on('error', onsSocketPostError);
        ws.send(JSON.stringify({
          type: events.DUPLICATE_SESSION,
          message: DUPLICATE_SESSION_MESSAGE,
        }));
        ws.close(CLOSE_DUPLICATE_SESSION, 'Sesion duplicada');
        config.LOGGER.conn(`Conexión rechazada: usuario ${userId} ya estaba conectado`);
      });
    };

    const encryptedToken = req.url.substring(1);
    if (!encryptedToken) {
      destroySocket();
      return;
    }

    let token;
    try {
      token = utils.decryptToken(encryptedToken);
    } catch (error) {
      config.LOGGER.api(`Token no se pudo desencriptar: ${error}`);
      destroySocket();
      return;
    }

    requests.verifyToken(token)
      .then(async (response) => {
        const { data } = response;
        console.log('Respuesta en verifyToken : ', data);
        if (!('status' in data) || data.status !== 200) {
          destroySocket();
          return;
        }

        const userId = data.id_usuario;

        if (pendingUsers.has(userId)) {
          rejectDuplicateSession(userId);
          return;
        }
        pendingUsers.add(userId);

        try {
          if (await hasActiveSession(token, userId)) {
            rejectDuplicateSession(userId);
            return;
          }

          // La nueva conexión pudo cerrarse mientras se validaba
          if (socket.destroyed) return;

          wss.handleUpgrade(req, socket, head, (ws) => {
            socket.removeListener('error', onsSocketPreError);
            wss.emit('connection', ws, token, userId);
          });
        } finally {
          pendingUsers.delete(userId);
        }
      })
      .catch((error) => {
        destroySocket();
        config.LOGGER.api(`Respuesta del servicio (desde local): ${error}`);
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