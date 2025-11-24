const axios = require('axios');

const config = require('../config');

const updateLocalTransaction = (transaction, token) => {
console.log(`Entra en updateLocalTransaction.`);
console.log(transaction);
  return axios.post(
    `${config.API_URL_LOCAL}getNet/actualizar_datos_transacciones`,
    transaction,
    {
      headers: {
        Token: token,
      },
    },
  );
};

module.exports = updateLocalTransaction;
