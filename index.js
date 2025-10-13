const express = require('express');
const config = require('./config');
const setUpSocket = require('./socket');

const app = express();

setUpSocket(app.listen(config.PORT, config.HOST, () => {
  config.LOGGER.server(`NODE_ENV=${config.NODE_ENV}`);
  config.LOGGER.server(`WEBSOCKET LISTENING AT http://${config.HOST}:${config.PORT}`);
}));
