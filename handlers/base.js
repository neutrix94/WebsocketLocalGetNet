const config = require('../config');

const sendAcknowledgment = (ws, eventType) => {
  ws.send(JSON.stringify({
    type: eventType,
  }));
  config.LOGGER.sent(`${ws.userId ? 'User ' + ws.userId : 'Local Server'}: ${eventType}`);
};

module.exports = {
  sendAcknowledgment,
};
