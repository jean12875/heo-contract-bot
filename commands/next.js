const { SlashCommandBuilder } = require("discord.js");
const { handleContractLogic, hasContractPermission } = require("../Utils/contractSystem");
const { safeReply } = require("../Utils/interaction");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("next")
    .setDescription("Passe à l'étape suivante du contrat"),
  async execute(interaction) {
    if (!hasContractPermission(interaction.member)) {
      return safeReply(interaction, { content: "❌ Vous n'avez pas la permission requise pour ceci", flags: 64 });
    }
    await handleContractLogic(interaction, "next");
  }
};
