const fs = require("fs");
const path = require("path");

function getConfig() {
  const configPath = path.join(__dirname, "../config.json");
  const configFile = fs.readFileSync(configPath, "utf8");
  const fileConfig = JSON.parse(configFile);

  // Les variables sensibles sont lues depuis Railway (process.env)
  // Les autres valeurs (channels, roles, categories) viennent du config.json
  return {
    ...fileConfig,
    token: process.env.TOKEN || fileConfig.token,
    clientId: process.env.CLIENT_ID || fileConfig.clientId,
    guildId: process.env.GUILD_ID || fileConfig.guildId,
  };
}

module.exports = { getConfig };
