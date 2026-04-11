const { Client, GatewayIntentBits, Collection } = require("discord.js");
const fs = require("fs");
const path = require("path");
const { getConfig } = require("./Utils/config");
const { setLoggerClient, logError } = require("./Utils/logger");

const client = new Client({ 
intents: [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.GuildMembers,
  GatewayIntentBits.GuildMessageReactions,
  GatewayIntentBits.GuildVoiceStates,
  GatewayIntentBits.MessageContent
]
});
client.commands = new Collection();
setLoggerClient(client);
client.on("error", (error) => {
  logError("CLIENT", "Erreur client Discord", error);
});
process.on("unhandledRejection", (error) => {
  logError("PROCESS", "Unhandled rejection", error);
});
process.on("uncaughtException", (error) => {
  logError("PROCESS", "Uncaught exception", error);
});

const commandsPath = path.join(__dirname, "commands");
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith(".js"));

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command = require(filePath);
  if ("data" in command && "execute" in command) {
    client.commands.set(command.data.name, command);
  }
}

const eventsPath = path.join(__dirname, "events");
const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith(".js"));

for (const file of eventFiles) {
  const filePath = path.join(eventsPath, file);
  const event = require(filePath);
  if (event.once) {
    client.once(event.name, (...args) => event.execute(...args, client));
  } else {
    client.on(event.name, (...args) => event.execute(...args, client));
  }
}

const config = getConfig();
client.login(config.token);
