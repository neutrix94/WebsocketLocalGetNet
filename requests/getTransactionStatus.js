const axios = require('axios');

const config = require('../config');

const getTransactionStatus = (payload, token) => axios.post(
  `${config.API_URL}getNet/recuperar_respuesta_por_folio_unico`,
  payload,
  {
    headers: {
      Token: token,
    },
  },
);

module.exports = getTransactionStatus;
