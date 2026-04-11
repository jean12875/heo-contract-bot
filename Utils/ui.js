const { EmbedBuilder } = require("discord.js");
const { getConfig } = require("./config");

const palette = {
  gold: 0xc99a38,
  blue: 0x2b6ef2,
  green: 0x1f9d66,
  red: 0xd64545,
  orange: 0xe48d2f,
  slate: 0x2d3748,
  violet: 0x6f52ed
};

function block(value) {
  return `\`\`\`${value || "Aucune donnée"}\`\`\``;
}

function buildStudioEmbed({
  title,
  description,
  color,
  fields = [],
  footer = "HEO Studio",
  author = "HEO Studio"
}) {
  const config = getConfig();
  const embed = new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: author, iconURL: config.thumbnail })
    .setTitle(title)
    .setThumbnail(config.thumbnail)
    .setFooter({ text: footer, iconURL: config.thumbnail })
    .setTimestamp();

  if (description) {
    embed.setDescription(description);
  }

  if (fields.length) {
    embed.addFields(fields);
  }

  return embed;
}

module.exports = {
  palette,
  block,
  buildStudioEmbed
};
