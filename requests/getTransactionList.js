const axios = require('axios');

const config = require('../config');

const getTransactionList = (userId, token) => axios.post(
  `${config.API_URL}getNet/recuperar_respuestas_transacciones`,
  {
    id_usuario: userId,
  },
  {
    headers: {
      Token: token,
    },
  },
);

module.exports = getTransactionList;
