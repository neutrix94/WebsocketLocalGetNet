const getUsersConnected = (wss) => {
  const users = [];
  wss.clients.forEach((client) => {
    users.push(client.userId);
  });

  return users;
};

module.exports = {
  getUsersConnected,
};
