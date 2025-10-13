const axios = require('axios');

const config = require('../config');

const updateViewedTransactionFlag = (transactions, token) => {
  const payload = {
    registros: [],
  };
  transactions.forEach((transaction) => {
    payload.registros.push({
      folio_unico: transaction,
    });
  });
  return axios.post(
    `${config.API_URL}getNet/actualizar_status_transacciones`,
    payload,
    {
      headers: {
        Token: token,
      },
    },
  );
};

module.exports = updateViewedTransactionFlag;
