const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder
} = require("discord.js");
const { getConfig } = require("./config");
const { buildStudioEmbed, palette } = require("./ui");
const { logInfo, logError } = require("./logger");

async function upsertPanelMessage(channel, client, matcher, payload) {
  const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  const matches = (messages ? [...messages.values()] : [])
    .filter((message) => message.author.id === client.user.id && matcher(message))
    .sort((a, b) => b.createdTimestamp - a.createdTimestamp);

  const existing = matches[0];

  if (existing) {
    await existing.edit(payload).catch(() => {});
    for (const duplicate of matches.slice(1)) {
      await duplicate.delete().catch(() => {});
    }
    return existing;
  }

  return channel.send(payload).catch(() => null);
}

async function ensureCentralPanel(client) {
  const config = getConfig();

  try {
    const contractChannel = await client.channels.fetch(config.channels.contrat).catch(() => null);
    if (contractChannel) {
      const embed = buildStudioEmbed({
        title: "🤝 Ouvrir un contrat",
        color: palette.gold,
        description: "Utilise ce panneau pour créer un contrat avec HEO studio celui ci sera pris en charge par l’équipe HEO.",
        footer: "HEO Studio | Contrats"
      });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("request_contract")
          .setLabel("Créer un contrat")
          .setEmoji("📜")
          .setStyle(ButtonStyle.Success)
      );

      await upsertPanelMessage(
        contractChannel,
        client,
        (message) => message.components.some((row) => row.components.some((component) => component.customId === "request_contract")),
        { embeds: [embed], components: [row] }
      );
      logInfo("PANEL", "Panel contrat prêt", { channelId: contractChannel.id }, { console: false });

    
    }
  } catch (error) {
    logError("PANEL", "Contrat panel error", error);
  }

  try {
    const recruitmentChannel = await client.channels.fetch(config.channels.recrutement).catch(() => null);
    if (recruitmentChannel) {
      const embed = buildStudioEmbed({
        title: "🖥️ Rejoindre l’équipe dev Roblox",
        color: palette.blue,
        description: "Dépose ta candidature Roblox depuis ce panneau ",
        footer: "HEO Studio | Recrutement Roblox"
      });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("apply_dev")
          .setLabel("Postuler")
          .setEmoji("📩")
          .setStyle(ButtonStyle.Primary)
      );

      await upsertPanelMessage(
        recruitmentChannel,
        client,
        (message) => message.components.some((row) => row.components.some((component) => component.customId === "apply_dev")),
        { embeds: [embed], components: [row] }
      );
      logInfo("PANEL", "Panel recrutement prêt", { channelId: recruitmentChannel.id }, { console: false });
    }
  } catch (error) {
    logError("PANEL", "Recrutement panel error", error);
  }

  try {
    const supportChannel = await client.channels.fetch(config.channels.ticket).catch(() => null);
    if (supportChannel) {
      const embed = buildStudioEmbed({
        title: "🎫 Ouvrir un ticket",
        color: palette.orange,
        description: "Choisis le type de demande adapté et un ticket sera ouvert.",
        footer: "HEO Studio | Support",
        fields: [
          { name: "Question", value: "Besoin d’une réponse claire", inline: true },
          { name: "Suggestion", value: "Proposer une amélioration", inline: true },
          { name: "Report", value: "Signaler un problème ou quelqu'un", inline: true }
        ]
      });

      const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("ticket_select")
          .setPlaceholder("Choisis le type de ticket")
          .addOptions([
            { label: "Question", description: "Poser une question", value: "question", emoji: "❓" },
            { label: "Suggestion", description: "Proposer une idée", value: "suggestion", emoji: "💡" },
            { label: "Report", description: "Signaler un souci ou quelqu'un", value: "report", emoji: "🚨" }
          ])
      );

      await upsertPanelMessage(
        supportChannel,
        client,
        (message) => message.components.some((row) => row.components.some((component) => component.customId === "ticket_select")),
        { embeds: [embed], components: [row] }
      );
      logInfo("PANEL", "Panel support prêt", { channelId: supportChannel.id }, { console: false });
    }
  } catch (error) {
    logError("PANEL", "Ticket panel error", error);
  }
}

module.exports = { ensureCentralPanel };
