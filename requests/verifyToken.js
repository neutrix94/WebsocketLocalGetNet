const axios = require('axios');

const config = require('../config');

const verifyToken = (token) => axios.post(
  `${config.API_URL}getNet/valida_token`,
  {},
  {
    headers: {
      Token: token,
    },
  },
);

module.exports = verifyToken;
