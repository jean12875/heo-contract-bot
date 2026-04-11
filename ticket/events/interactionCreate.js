const {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
  PermissionsBitField,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");
const { getConfig } = require("../Utils/config");
const {
  handleContractLogic,
  findContractEntryByChannel,
  createContract,
  applyDeveloperSelection,
  saveContract,
  closeTicketStructure
} = require("../Utils/contractSystem");
const { safeDeferReply, safeReply, safeShowModal } = require("../Utils/interaction");
const { buildStudioEmbed, block, palette } = require("../Utils/ui");
const { logInfo, logError, logWarn } = require("../Utils/logger");
const { sendTranscriptCopies } = require("../Utils/transcriptService");

function buildRecruitmentEmbed(interaction, typeDev, dispo, paiement) {
  return buildStudioEmbed({
    title: "📩 Nouvelle candidature dev Roblox",
    color: palette.blue,
    description: "Une nouvelle candidature Roblox a été envoyée et le dossier est prêt à être étudié par l’équipe HEO Studio.",
    footer: "HEO Studio | Recrutement Roblox",
    fields: [
      { name: "Candidat", value: `<@${interaction.user.id}>`, inline: true },
      { name: "Spécialité Roblox", value: block(typeDev), inline: true },
      { name: "Disponibilité", value: block(dispo), inline: true },
      { name: "Paiement", value: block(paiement), inline: true },
      { name: "Statut", value: block("En attente de retour"), inline: true }
    ]
  });
}

function buildSupportEmbed(interaction, ticketType, sujet, description) {
  const titles = {
    question: "❓ Ticket question",
    suggestion: "💡 Ticket suggestion",
    report: "🚨 Ticket report"
  };

  const colors = {
    question: palette.blue,
    suggestion: palette.orange,
    report: palette.red
  };

  return buildStudioEmbed({
    title: titles[ticketType] || "🎫 Ticket support",
    color: colors[ticketType] || palette.slate,
    description: "La demande a été reçue et le ticket est ouvert pour le traitement.",
    footer: "HEO Studio | Support",
    fields: [
      { name: "Auteur", value: `<@${interaction.user.id}>`, inline: true },
      { name: "Catégorie", value: block(ticketType), inline: true },
      { name: "Statut", value: block("En attente"), inline: true },
      { name: "Sujet", value: block(sujet), inline: false },
      { name: "Description", value: block(description), inline: false }
    ]
  });
}

async function notifyExpiredInteraction(interaction, text) {
  await interaction.user.send(text).catch(() => {});
}

async function fetchConfiguredCategory(guild, categoryId) {
  if (!categoryId) return null;
  const channel = guild.channels.cache.get(categoryId) || (await guild.channels.fetch(categoryId).catch(() => null));
  return channel?.type === ChannelType.GuildCategory ? channel : null;
}

async function getRoleLabel(guild, roleId, fallback) {
  if (!roleId) return fallback;
  const role = guild.roles.cache.get(roleId) || (await guild.roles.fetch(roleId).catch(() => null));
  return role ? `@${role.name}` : fallback;
}

function normalizeLookupToken(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/^@+/, "")
    .replace(/\s+/g, " ");
}

function withTimeout(promise, ms, fallback = null) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms))
  ]);
}

function findMemberInCollection(collection, token) {
  if (!collection?.size) return null;
  return collection.find((entry) => {
    const candidates = [
      entry.user?.username,
      entry.displayName,
      entry.user?.globalName
    ]
      .filter(Boolean)
      .map(normalizeLookupToken);

    return candidates.includes(token);
  }) || null;
}

async function updateProgress(interaction, title, steps) {
  const lines = (steps || []).filter(Boolean).map((step, index, list) => `${index === list.length - 1 ? "⏳" : "✅"} ${step}`);
  return safeReply(interaction, {
    content: [`⌛ ${title}`, ...lines].join("\n")
  });
}

async function resolveDeveloperIds(guild, input) {
  const directMentionIds = [...input.matchAll(/<@!?(\d+)>/g)].map((match) => match[1]);
  const remaining = input.replace(/<@!?(\d+)>/g, " ");
  const rawTokens = remaining
    .split(/[\n,;]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  const resolved = new Set(directMentionIds);
  if (!rawTokens.length) {
    return [...resolved];
  }

  for (const rawToken of rawTokens) {
    const token = normalizeLookupToken(rawToken);
    if (!token) continue;

    if (/^\d{17,20}$/.test(token)) {
      const member = guild.members.cache.get(token) || (await withTimeout(guild.members.fetch(token).catch(() => null), 2500, null));
      if (member) {
        resolved.add(member.id);
      }
      continue;
    }

    const cachedMember = findMemberInCollection(guild.members.cache, token);
    if (cachedMember) {
      resolved.add(cachedMember.id);
      continue;
    }

    const searchedMembers = await withTimeout(
      guild.members.search({ query: token.slice(0, 32), limit: 10 }).catch(() => null),
      2500,
      null
    );

    const searchedMember = findMemberInCollection(searchedMembers, token);
    if (searchedMember) {
      resolved.add(searchedMember.id);
    }
  }

  return [...resolved];
}

async function resolveGuildMemberIds(guild, ids) {
  const resolved = [];

  for (const id of ids || []) {
    const member = guild.members.cache.get(id) || (await withTimeout(guild.members.fetch(id).catch(() => null), 4000, null));
    if (member) {
      resolved.push(member.id);
    }
  }

  return [...new Set(resolved)];
}

module.exports = {
  name: "interactionCreate",
  async execute(interaction, client) {
    try {
      logInfo("INTERACTION", interaction.customId || interaction.commandName || "unknown", {
        type: interaction.type,
        userId: interaction.user?.id || null,
        channelId: interaction.channel?.id || null
      });

      if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);
        if (!command) return;

        try {
          await command.execute(interaction);
        } catch (error) {
          logError("COMMAND", `Erreur commande ${interaction.commandName}`, error);
          await safeReply(interaction, { content: "❌ Erreur", flags: 64 });
        }
        return;
      }

      const config = getConfig();

      if (interaction.isButton()) {
        if (interaction.customId === "apply_dev") {
          const modal = new ModalBuilder().setCustomId("modal_dev").setTitle("Candidature dev Roblox");
          modal.addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId("type")
                .setLabel("Spécialité Roblox")
                .setStyle(TextInputStyle.Short)
                .setPlaceholder("Scripting Luau, UI, Build, Animation")
                .setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId("dispo")
                .setLabel("Disponibilité")
                .setStyle(TextInputStyle.Short)
                .setPlaceholder("Ex: Lundi/Mardi/Mercredi/Jeudi/Vendredi/Samedi/Dimanche, de quand à quand")
                .setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId("paiement")
                .setLabel("Mode de paiement")
                .setStyle(TextInputStyle.Short)
                .setPlaceholder("PayPal, Robux, etc")
                .setRequired(true)
            )
          );

          const shown = await safeShowModal(interaction, modal);
          if (!shown) {
            await notifyExpiredInteraction(interaction, "Le bouton de candidature a expiré Merci de recliquer dessus.");
          }
          return;
        }

        if (interaction.customId === "request_contract") {
          const modal = new ModalBuilder().setCustomId("modal_contract_init").setTitle("Nouveau contrat");
          modal.addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder().setCustomId("nom").setLabel("Nom du contrat").setStyle(TextInputStyle.Short).setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder().setCustomId("budget").setLabel("Budget").setStyle(TextInputStyle.Short).setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder().setCustomId("delai").setLabel("Délai").setStyle(TextInputStyle.Short).setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder().setCustomId("desc").setLabel("Description").setStyle(TextInputStyle.Paragraph).setRequired(true)
            )
          );

          const shown = await safeShowModal(interaction, modal);
          if (!shown) {
            await notifyExpiredInteraction(interaction, "Le bouton de contrat a expiré merci de recliquer dessus.");
          }
          return;
        }

        if (interaction.customId === "close_ticket") {
          const acknowledged = await safeDeferReply(interaction);
          if (!acknowledged) return;
          await safeReply(interaction, { content: "🔒 Fermeture..." });
          setTimeout(() => {
            sendTranscriptCopies(interaction.channel, interaction.user.id)
              .then((transcriptResult) => {
                logInfo("TICKET", "Fermeture demandée", {
                  channelId: interaction.channel?.id || null,
                  userId: interaction.user?.id || null,
                  transcriptRecipients: transcriptResult.recipients
                });
              })
              .catch(() => {})
              .finally(() => {
                closeTicketStructure(interaction.guild, interaction.channel.id).catch(() => {});
              });
          }, 1500);
          return;
        }

        if (interaction.customId === "transcript_ticket") {
          const acknowledged = await safeDeferReply(interaction);
          const transcriptResult = await sendTranscriptCopies(interaction.channel, interaction.user.id);

          if (transcriptResult.success) {
            if (acknowledged) {
              await safeReply(interaction, { content: "📄 Transcript envoyé par DM" });
            }
          } else if (acknowledged) {
            await safeReply(interaction, { content: "❌ Erreur création transcript" });
            logWarn("TRANSCRIPT", "Échec création transcript", {
              channelId: interaction.channel?.id || null
            });
          }
          return;
        }

        if (interaction.customId.startsWith("c_")) {
          await handleContractLogic(interaction, interaction.customId.split("_")[1]);
          return;
        }
      }

      if (interaction.isStringSelectMenu()) {
        if (interaction.customId === "ticket_select") {
          const value = interaction.values[0];
          const modal = new ModalBuilder().setCustomId(`modal_${value}`).setTitle("Créer un ticket");
          modal.addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder().setCustomId("sujet").setLabel("Sujet").setStyle(TextInputStyle.Short).setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder().setCustomId("desc").setLabel("Description").setStyle(TextInputStyle.Paragraph).setRequired(true)
            )
          );

          const shown = await safeShowModal(interaction, modal);
          if (!shown) {
            await notifyExpiredInteraction(interaction, "Le menu ticket a expiré merci de refaire une autre sélection.");
          }
          return;
        }
      }

      if (!interaction.isModalSubmit()) {
        return;
      }

      if (interaction.customId === "modal_contract_init") {
        const acknowledged = await safeDeferReply(interaction);
        if (!acknowledged) return;
        await updateProgress(interaction, "Création du contrat", ["Préparation de la structure"]);

        const nom = interaction.fields.getTextInputValue("nom");
        const budget = interaction.fields.getTextInputValue("budget");
        const delai = interaction.fields.getTextInputValue("delai");
        const desc = interaction.fields.getTextInputValue("desc");

        const contract = await createContract(interaction.guild, {
          nom,
          budget,
          delai,
          desc,
          clientId: interaction.user.id,
          clientName: interaction.user.username
        }, (label) => updateProgress(interaction, "Création du contrat", ["Préparation de la structure", label]));

        if (!contract?.clientChan || !contract?.categoryId) {
          await safeReply(interaction, { content: "❌ Erreur création contrat" });
          return;
        }

        await saveContract(contract.clientChan, contract);
        const urgenceLabel = await getRoleLabel(interaction.guild, config.roles.urgence, `@${config.roleNames?.urgence || "Urgence"}`);
        await interaction.user.send({
          embeds: [
            buildStudioEmbed({
              title: "⚠ Message de sécurité automatique // Anti Scam ⚠",
              color: palette.red,
              description: [
                "Aucun secrétaire ne vous demandera jamais de le payer directement.",
                "Tous les paiements passent exclusivement par le compte PayPal officiel HEO ou le groupe officiel HEO.",
                `Si un secrétaire tente de faire autrement ou si vous observez un comportement suspect, utilisez immédiatement le ping ${urgenceLabel}.`
              ].join("\n"),
              footer: "HEO Studio | Sécurité"
            })
          ]
        }).catch(() => {});
        await safeReply(interaction, { content: `✅ Contrat créé: <#${contract.clientChan}>` });
        logInfo("CONTRACT", "Contrat créé", {
          contractName: nom,
          categoryId: contract.categoryId,
          clientChannelId: contract.clientChan,
          clientId: interaction.user.id
        });
        return;
      }

      if (interaction.customId.startsWith("modal_c_dev:")) {
        const acknowledged = await safeDeferReply(interaction);
        if (!acknowledged) return;
        await updateProgress(interaction, "Choix du développeur", ["Vérification des développeurs"]);

        const entry = await findContractEntryByChannel(interaction.channel.id);
        if (!entry) {
          await safeReply(interaction, { content: "❌ Contrat introuvable" });
          return;
        }

        const { key, contract } = entry;
        const [, modalNonce] = interaction.customId.split(":");
        if (contract.step !== 1 || !contract.devSelectionNonce || contract.devSelectionNonce !== modalNonce) {
          await safeReply(interaction, { content: "❌ Ce formulaire n’est plus valide, reclique sur Choisir un développeur" });
          return;
        }

        const devText = interaction.fields.getTextInputValue("devs");
        const infos = interaction.fields.getTextInputValue("infos");
        const devs = await resolveDeveloperIds(interaction.guild, devText);
        const candidateDevs = devs.filter(id => /^\d{17,20}$/.test(String(id)));
        const validDevs = await resolveGuildMemberIds(interaction.guild, candidateDevs);
        if (!validDevs.length) {
          await safeReply(interaction, { content: "❌ Aucun développeur valide trouvé dans le serveur merci de mettre une @mention, un ID ou un pseudo exact d’un membre présent." });
          return;
        }
        await updateProgress(interaction, "Choix du développeur", [
          "Développeurs vérifiés",
          "Création du salon privé"
        ]);
        try {
          await applyDeveloperSelection(interaction.guild, contract, {
            secretaryId: interaction.user.id,
            devs: validDevs,
            infos
          }, (label) => updateProgress(interaction, "Choix du développeur", [
            "Développeurs vérifiés",
            label
          ]));
          await updateProgress(interaction, "Choix du développeur", [
            "Développeurs vérifiés",
            "Salon privé créé",
            "Sauvegarde du contrat"
          ]);
          await saveContract(key, contract);
        } catch (error) {
          logError("CONTRACT", "Erreur création salon développeur", error);
          await safeReply(interaction, { content: "❌ Impossible de créer le salon privé des développeurs" });
          return;
        }

        await safeReply(interaction, { content: "✅ Développeur(s) assigné(s)" });
        logInfo("CONTRACT", "Développeur assigné", {
          contractKey: key,
          channelId: interaction.channel?.id || null,
          secretaryId: interaction.user.id,
          devs: validDevs
        });
        return;
      }

      if (interaction.customId === "modal_dev") {
        const acknowledged = await safeDeferReply(interaction);
        if (!acknowledged) return;

        const typeDev = interaction.fields.getTextInputValue("type");
        const dispo = interaction.fields.getTextInputValue("dispo");
        const paiement = interaction.fields.getTextInputValue("paiement");

        const recruitCategory = await fetchConfiguredCategory(interaction.guild, config.categories.recrutement);
        if (!recruitCategory) {
          await safeReply(interaction, { content: `❌ Catégorie recrutement introuvable (${config.categories.recrutement})` });
          return;
        }

        const channel = await interaction.guild.channels.create({
          name: `📝-${interaction.user.username}`,
          type: ChannelType.GuildText,
          parent: config.categories.recrutement,
          topic: JSON.stringify({
            creatorId: interaction.user.id,
            kind: "recruitment"
          }),
          permissionOverwrites: [
            { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
            { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
            { id: config.roles.owner, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
            { id: config.roles.admin, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
            { id: config.roles.accesVocEntretien, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }
          ]
        }).catch(() => null);

        if (!channel) {
          await safeReply(interaction, { content: "❌ Erreur création candidature" });
          return;
        }

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("close_ticket").setLabel("Fermer").setEmoji("🔒").setStyle(ButtonStyle.Danger)
        );

        await channel.send({
          content: `<@${interaction.user.id}>`,
          embeds: [buildRecruitmentEmbed(interaction, typeDev, dispo, paiement)],
          components: [row]
        });

        await safeReply(interaction, { content: `✅ Candidature créée: <#${channel.id}>` });
        logInfo("RECRUITMENT", "Candidature créée", {
          channelId: channel.id,
          userId: interaction.user.id
        });
        return;
      }

      const acknowledged = await safeDeferReply(interaction);
      if (!acknowledged) return;

      const ticketType = interaction.customId.slice(6);
      const subject = interaction.fields.getTextInputValue("sujet");
      const description = interaction.fields.getTextInputValue("desc");

      const ticketCategory = await fetchConfiguredCategory(interaction.guild, config.categories.ticket);
      if (!ticketCategory) {
        await safeReply(interaction, { content: `❌ Catégorie tickets introuvable (${config.categories.ticket})` });
        return;
      }

      const channel = await interaction.guild.channels.create({
        name: `${ticketType}-${interaction.user.username}`,
        type: ChannelType.GuildText,
        parent: config.categories.ticket,
        topic: JSON.stringify({
          creatorId: interaction.user.id,
          kind: "support",
          ticketType
        }),
        permissionOverwrites: [
          { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
          { id: config.roles.owner, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
          { id: config.roles.admin, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
          { id: config.roles.urgence, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
          { id: config.roles.gestionTicket, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }
        ]
      }).catch(() => null);

      if (!channel) {
        await safeReply(interaction, { content: "❌ Erreur création ticket" });
        return;
      }

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("close_ticket").setLabel("Fermer").setEmoji("🔒").setStyle(ButtonStyle.Danger)
      );

      await channel.send({
        content: `<@${interaction.user.id}>`,
        embeds: [buildSupportEmbed(interaction, ticketType, subject, description)],
        components: [row]
      });

      await safeReply(interaction, { content: `✅ Ticket créé: <#${channel.id}>` });
      logInfo("SUPPORT", "Ticket créé", {
        ticketType,
        channelId: channel.id,
        userId: interaction.user.id
      });
    } catch (error) {
      logError("INTERACTION", "Interaction error", error);
      await safeReply(interaction, { content: "❌ Erreur", flags: 64 });
    }
  }
};
