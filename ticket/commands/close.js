const { SlashCommandBuilder, ChannelType } = require("discord.js");
const { hasContractPermission, closeTicketStructure } = require("../Utils/contractSystem");
const { safeDeferReply, safeReply } = require("../Utils/interaction");
const { sendTranscriptCopies } = require("../Utils/transcriptService");
const { logInfo } = require("../Utils/logger");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("close")
    .setDescription("Ferme le ticket"),
  async execute(interaction) {
    if (!hasContractPermission(interaction.member)) {
      return safeReply(interaction, { content: "❌ Vous n'avez pas la permission requise pour ceci", flags: 64 });
    }
    if (!interaction.channel || interaction.channel.type !== ChannelType.GuildText) {
      return safeReply(interaction, { content: "❌ Commande utilisable que en ticket", flags: 64 });
    }

    const acknowledged = await safeDeferReply(interaction);
    if (!acknowledged) return;
    await safeReply(interaction, { content: "🔒 Fermeture du ticket dans 5 secondes environ..." });
    setTimeout(() => {
      sendTranscriptCopies(interaction.channel, interaction.user.id)
        .then((transcriptResult) => {
          logInfo("TICKET", "Fermeture demandée via commande", {
            channelId: interaction.channel?.id || null,
            userId: interaction.user.id,
            transcriptRecipients: transcriptResult.recipients
          });
        })
        .catch(() => {})
        .finally(() => {
          closeTicketStructure(interaction.guild, interaction.channel.id).catch(() => {});
        });
    }, 2000);
  }
};
