const config = require('../config');
const events = require('../utils/constants');
const requests = require('../requests/base');

const getTransactionList = (ws) => {
  ws.isProcessing = true;
  ws.eventQueue.add(events.INFORM_TRANSACTIONS);
  requests.getTransactionList(ws.userId, ws.token)
    .then((response) => {
      const { data } = response;
      if ('status' in data && data.status === 200) {
        const transactions = [];
        data.transacciones.forEach((transaction) => {
          transactions.push({
            message: transaction.message,
            folio_unico: transaction.folio_unico,
          });
        });
        ws.send(JSON.stringify({
          type: events.INFORM_TRANSACTIONS,
          transactions,
        }));
        config.LOGGER.sent(`User ${ws.userId}: ${events.INFORM_TRANSACTIONS}`);
      }
      ws.isProcessing = false;
    })
    .catch(() => {
      ws.isProcessing = false;
      config.LOGGER.api(`Error while getting transaction list for ${ws.userId}`);
    });
};

const getTransactionStatus = (ws) => {
  ws.isProcessing = true;
  requests.getTransactionStatus(ws.actualStatus, ws.token)
    .then((response) => {
      const { data } = response;
      if ('status' in data && data.status === 200) {
        ws.eventQueue.remove(events.GET_TRANSACTION_STATUS);
      }
      ws.isProcessing = false;
    })
    .catch(() => {
      ws.eventQueue.add(events.GET_TRANSACTION_STATUS);
      ws.isProcessing = false;
      config.LOGGER.api(`Error while getting transaction status for ${ws.userId}`);
    });
};

const updateViewedTransactions = (ws) => {
  if (ws.viewedTransactions.length > 0){
    ws.isProcessing = true;
    requests.updateViewedTransactionFlag(ws.viewedTransactions, ws.token)
      .then((response) => {
        const { data } = response;
        if ('status' in data && data.status === 200) {
          ws.eventQueue.remove(events.UPDATE_VIEWED_TRANSACTION);
          config.LOGGER.sent(`User ${ws.userId}: ${events.UPDATE_VIEWED_TRANSACTION}`);
        }
        ws.isProcessing = false;
      })
      .catch(() => {
        ws.eventQueue.add(events.UPDATE_VIEWED_TRANSACTION);
        ws.isProcessing = false;
        config.LOGGER.api(`Error while updating viewed transaction flag for ${ws.userId}`);
      });
  }
};

const updateLocalTransaction = (ws) => {
  ws.isProcessing = true;
  requests.updateLocalTransaction(ws.actualTransaction, ws.token)
    .then(() => {
      ws.isProcessing = false;
    })
    .catch(() => {
      ws.isProcessing = false;
      config.LOGGER.api(`Error while updating local transaction for ${ws.userId}`);
    });
};

const sendActualTransaction = (ws) => {
  ws.isProcessing = true;
  ws.send(JSON.stringify({
    type: events.ACTUAL_TRANSACTION,
    transaction: ws.actualTransaction,
  }));
  config.LOGGER.sent(`User ${ws.userId}: ${events.ACTUAL_TRANSACTION}`);
  ws.isProcessing = false;
};

module.exports = {
  getTransactionList,
  getTransactionStatus,
  updateViewedTransactions,
  sendActualTransaction,
  updateLocalTransaction,
};
