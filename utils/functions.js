const crypto = require('crypto');

const config = require('../config');

const isJSON = (data) => {
  try {
    JSON.parse(data);
    return true;
  } catch (error) {
    return false;
  }
};

const encryptToken = (token) => {
  const iv = crypto.randomBytes(16).toString('hex').slice(0, 16);
  const cipher = crypto.createCipheriv('aes-256-cbc', config.ENC_KEY, iv);
  let encrypted = cipher.update(token, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  return Buffer.from(iv + encrypted).toString('base64');
};

const decryptToken = (encryptedData) => {
  const buff = Buffer.from(encryptedData, 'base64');

  const ivSize = crypto.getCipherInfo('aes-256-cbc').ivLength;
  const iv = buff.subarray(0, ivSize);
  const cipherText = buff.subarray(ivSize);

  const decipher = crypto.createDecipheriv('aes-256-cbc', config.ENC_KEY, iv);
  let decrypted = decipher.update(Buffer.from(cipherText).toString('utf8'), 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
};

module.exports = {
  isJSON,
  encryptToken,
  decryptToken,
};
