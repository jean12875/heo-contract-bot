const { SlashCommandBuilder, ChannelType } = require("discord.js");
const { hasContractPermission } = require("../Utils/contractSystem");
const { safeDeferReply, safeReply } = require("../Utils/interaction");
const { logInfo, logError, logWarn } = require("../Utils/logger");
const { sendTranscriptCopies } = require("../Utils/transcriptService");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("transcript")
    .setDescription("Faire une transcript du ticket"),
  async execute(interaction) {
    if (!hasContractPermission(interaction.member)) {
      return safeReply(interaction, { content: "❌ Vous n'avez pas la permission requise pour ceci", flags: 64 });
    }
    if (!interaction.channel || interaction.channel.type !== ChannelType.GuildText) {
      return safeReply(interaction, { content: "❌ Commande utilisable que en ticket, uniquement !", flags: 64 });
    }

    const acknowledged = await safeDeferReply(interaction);
    if (!acknowledged) return;

    try {
      const transcriptResult = await sendTranscriptCopies(interaction.channel, interaction.user.id);

      if (transcriptResult.success) {
        await safeReply(interaction, { content: "✅ Transcript envoyé par MP (message prive)" });
        logInfo("TRANSCRIPT", "Transcript envoyé par commande", {
          channelId: interaction.channel?.id || null,
          userId: interaction.user.id,
          recipients: transcriptResult.recipients
        });
      } else {
        await safeReply(interaction, { content: "❌ Erreur création transcript" });
        logWarn("TRANSCRIPT", "Échec création transcript via commande", {
          channelId: interaction.channel?.id || null
        });
      }
    } catch (error) {
      logError("TRANSCRIPT", "Transcript error", error);
      await safeReply(interaction, { content: "❌ Erreur" });
    }
  }
};
