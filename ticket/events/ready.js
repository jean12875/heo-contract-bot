const { REST, Routes, Events } = require("discord.js");
const { getConfig } = require("../Utils/config");
const { ensureCentralPanel } = require("../Utils/contractService");
const { logError } = require("../Utils/logger");

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    const config = getConfig();
    const token = config.token;
    const clientId = config.clientId;
    const guildId = config.guildId;

    if (!token || !clientId) {
      logError("READY", "Configuration invalide: token ou clientId manquant verifie tout cela avant de lancer", null, { console: true, discord: false });
      return;
    }

    const slashCommandArray = [...client.commands.values()]
      .filter((command) => !command.maintenance && command.data)
      .map((command) => command.data.toJSON());

    const rest = new REST({ version: "10" }).setToken(token);
    const route = guildId ? Routes.applicationGuildCommands(clientId, guildId) : Routes.applicationCommands(clientId);

    try {
      await client.application.fetch().catch(() => null);
      await rest.put(route, {
        body: slashCommandArray
      });
      console.log(`Success le bot et enligne avec ${slashCommandArray.length} de commmands.`);
    } catch (error) {
      logError("READY", "Slash command enregistrement echouer", error);
    }

    await ensureCentralPanel(client);
    console.log(`${client.user.tag} est connecté et prêt, c'est parfait !`);
  }
};
