const dotenv = require('dotenv');
const path = require('path');
const winston = require('winston');

const {
  combine, timestamp, printf, colorize, align,
} = winston.format;

dotenv.config({
  path: path.resolve(__dirname, `${process.env.NODE_ENV}.env`),
});

const levels = {
  levels: {
    error: 0,
    warn: 1,
    info: 2,
    server: 3,
    conn: 4,
    queue: 5,
    recv: 6,
    sent: 7,
    api: 8,
    ws_cli: 9,
  },
  colors: {
    error: 'red',
    warn: 'yellow',
    info: 'blue',
    server: 'bold green',
    conn: 'bold cyan',
    queue: 'white',
    recv: 'blue',
    sent: 'magenta',
    api: 'red',
    ws_cli: 'grey',
  },
};

winston.addColors(levels.colors);

const logger = winston.createLogger({
  levels: levels.levels,
  format: combine(
    colorize({ all: true }),
    timestamp({
      format: 'YYYY-MM-DD hh:mm:ss.SSS A',
    }),
    align(),
    printf((info) => `[${info.timestamp}] ${info.level}: ${info.message}`),
  ),
  transports: [new winston.transports.Console({ level: 'ws_cli' })],
});

module.exports = {
  NODE_ENV: process.env.NODE_ENV,
  HOST: process.env.HOST,
  PORT: process.env.PORT,
  API_URL: process.env.API_URL,
  API_URL_LOCAL: process.env.API_URL_LOCAL,
  SERVER_TOKEN: process.env.SERVER_TOKEN,
  ENC_KEY: process.env.ENC_KEY,
  WEBSOCKET_CLIENT_URL: process.env.WEBSOCKET_CLIENT_URL,
  LOGGER: logger,
};
