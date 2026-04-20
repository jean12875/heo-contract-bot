const {
  Client, GatewayIntentBits, Partials, ChannelType, PermissionFlagsBits,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  REST, Routes, SlashCommandBuilder,
} = require('discord.js');
const fs = require('fs');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Channel],
});

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const CONFIG = {
  TOKEN:              process.env.TOKEN,
  CLIENT_ID:          process.env.CLIENT_ID,
  GUILD_ID:           process.env.GUILD_ID,
  PANEL_CHANNEL_ID:   '1495692176020078602',
  STAFF_ROLE_ID:      '1487848016110162153',
  SECRETAIRE_ROLE_ID: '1490464910549712937',

  CATEGORIES: {
    NEGOCIATION:   '1487848273355210803',
    PAIEMENT_1:    '1487848408050962593',
    DEVELOPPEMENT: '1487848473448546577',
    PAIEMENT_2:    '1487848515165229336',
    TERMINE:       '1487848579488813309',
    ANNULE:        '1487859413627834418',
    DEV_CONTRAT:   '1495687556728225792',
    DEV_TERMINE:   '1495698716160692274',
    DEV_ANNULE:    '1495698949850271765',
  },

  ETAPES: [
    { id: 'NEGOCIATION',   label: '🟡 Négociation',               color: 0xF5C542 },
    { id: 'PAIEMENT_1',    label: '1️⃣ 1er paiement en attente',   color: 0xFF8C00 },
    { id: 'DEVELOPPEMENT', label: '🛠️ En cours de développement', color: 0x5865F2 },
    { id: 'PAIEMENT_2',    label: '2️⃣ 2ème paiement en attente',  color: 0xFF8C00 },
    { id: 'TERMINE',       label: '✅ Terminé',                    color: 0x57F287 },
  ],

  SECURITY_MESSAGE: `⚠️ **Message de sécurité automatique**\nAucun secrétaire ne vous demandera jamais de le payer directement. Tous les paiements passent exclusivement par le compte Revolut officiel HEO : https://revolut.me/heostudio ou le groupe officiel HEO : https://www.roblox.com/fr/games/119523597803809/Hospital-Escape-Obby.\nSi un secrétaire tente de faire autrement ou si vous observez un comportement suspect, utilisez immédiatement le ping <@&1489736017576591481>.`,
};
// ──────────────────────────────────────────────────────────────────────────────

// ─── PERSISTANCE ──────────────────────────────────────────────────────────────
const COUNTER_FILE = './counter.json';
const TICKETS_FILE = './tickets.json';

function loadCounter() {
  try {
    if (fs.existsSync(COUNTER_FILE)) return JSON.parse(fs.readFileSync(COUNTER_FILE, 'utf8')).count ?? 0;
  } catch {}
  return 0;
}

function saveCounter(count) {
  fs.writeFileSync(COUNTER_FILE, JSON.stringify({ count }));
}

function loadTickets() {
  try {
    if (fs.existsSync(TICKETS_FILE)) return new Map(Object.entries(JSON.parse(fs.readFileSync(TICKETS_FILE, 'utf8'))));
  } catch {}
  return new Map();
}

function saveTickets() {
  const obj = {};
  for (const [k, v] of ticketInfos.entries()) obj[k] = v;
  fs.writeFileSync(TICKETS_FILE, JSON.stringify(obj));
}

let contractCounter = loadCounter();

// ─── STATE ────────────────────────────────────────────────────────────────────
const ticketEtapes = new Map();
const ticketInfos  = loadTickets();

for (const [channelId, info] of ticketInfos.entries()) {
  ticketEtapes.set(channelId, info.etapeIndex ?? 0);
}
// ──────────────────────────────────────────────────────────────────────────────

function padNum(n) {
  return String(n).padStart(4, '0');
}

function isStaffOrAdmin(member) {
  return member.roles.cache.has(CONFIG.STAFF_ROLE_ID) ||
    member.roles.cache.has(CONFIG.SECRETAIRE_ROLE_ID) ||
    member.permissions.has(PermissionFlagsBits.Administrator);
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function buildEmbed(num, nom, description, budget, delai, user, etapeIndex) {
  const etape = CONFIG.ETAPES[etapeIndex];
  return new EmbedBuilder()
    .setTitle(`📋 Contrat #${padNum(num)} — ${nom}`)
    .setColor(etape.color)
    .addFields(
      { name: '👤 Client',      value: `<@${user.id}>`, inline: true },
      { name: '💰 Budget',      value: budget,           inline: true },
      { name: '⏱️ Délai',       value: delai,            inline: true },
      { name: '📝 Description', value: description,      inline: false },
    )
    .setFooter({ text: `HEO Studio • Étape : ${etape.label}` })
    .setTimestamp();
}

function buildStaffRow(etapeIndex, annule = false) {
  if (annule) {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('etape_precedente').setLabel('◀️').setStyle(ButtonStyle.Secondary).setDisabled(true),
      new ButtonBuilder().setCustomId('etape_suivante').setLabel('Annulé').setStyle(ButtonStyle.Danger).setDisabled(true),
      new ButtonBuilder().setCustomId('desannuler_contrat').setLabel('↩️ Désannuler').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('supprimer_ticket').setLabel('🗑️ Supprimer').setStyle(ButtonStyle.Secondary),
    );
  }
  const isLast  = etapeIndex >= CONFIG.ETAPES.length - 1;
  const isFirst = etapeIndex <= 0;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('etape_precedente').setLabel('◀️').setStyle(ButtonStyle.Secondary).setDisabled(isFirst),
    new ButtonBuilder().setCustomId('etape_suivante').setLabel(isLast ? '✅ Terminé' : `➡️ ${CONFIG.ETAPES[etapeIndex + 1]?.label ?? 'Fin'}`).setStyle(isLast ? ButtonStyle.Success : ButtonStyle.Primary).setDisabled(isLast),
    new ButtonBuilder().setCustomId('annuler_contrat').setLabel('🚫 Annuler').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('supprimer_ticket').setLabel('🗑️ Supprimer').setStyle(ButtonStyle.Secondary),
  );
}

// Bouton de suppression du salon dev uniquement
function buildDevDeleteRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('supprimer_dev').setLabel('🗑️ Supprimer ce salon dev').setStyle(ButtonStyle.Danger),
  );
}

// Récupère le salon dev associé à un contrat
async function getDevChannel(guild, info) {
  if (!info?.devChannelId) return null;
  try {
    return await guild.channels.fetch(info.devChannelId);
  } catch {
    return null;
  }
}

// Récupère le message embed du contrat
async function getContractMessage(channel, info) {
  if (!info?.messageId) return null;
  try {
    return await channel.messages.fetch(info.messageId);
  } catch {
    return null;
  }
}

// ─── READY ────────────────────────────────────────────────────────────────────
client.once('ready', async () => {
  console.log(`✅ Connecté en tant que ${client.user.tag}`);
  await registerSlashCommands();
});

// ─── SLASH COMMANDS ───────────────────────────────────────────────────────────
async function registerSlashCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName('contrats')
      .setDescription('Liste tous les contrats en cours')
      .toJSON(),
    new SlashCommandBuilder()
      .setName('assign')
      .setDescription('Créer ou mettre à jour le salon dev pour un contrat')
      .addStringOption(opt =>
        opt.setName('id_contrat')
          .setDescription('ID Discord du salon contrat')
          .setRequired(true)
      )
      .addUserOption(opt => opt.setName('p1').setDescription('Dev 1').setRequired(true))
      .addUserOption(opt => opt.setName('p2').setDescription('Dev 2').setRequired(false))
      .addUserOption(opt => opt.setName('p3').setDescription('Dev 3').setRequired(false))
      .addUserOption(opt => opt.setName('p4').setDescription('Dev 4').setRequired(false))
      .addUserOption(opt => opt.setName('p5').setDescription('Dev 5').setRequired(false))
      .toJSON(),
  ];
  const rest = new REST({ version: '10' }).setToken(CONFIG.TOKEN);
  try {
    await rest.put(Routes.applicationGuildCommands(CONFIG.CLIENT_ID, CONFIG.GUILD_ID), { body: commands });
    console.log('✅ Commandes slash enregistrées');
  } catch (err) {
    console.error('Erreur commandes:', err);
  }
}

// ─── SETUP ────────────────────────────────────────────────────────────────────
if (process.argv[2] === 'setup') {
  client.once('ready', async () => {
    const ch = await client.channels.fetch(CONFIG.PANEL_CHANNEL_ID);
    await ch.send({
      embeds: [new EmbedBuilder()
        .setTitle('📋 HEO Studio — Créer un contrat')
        .setDescription('Bienvenue sur le système de contrats **HEO Studio**.\n\nClique sur le bouton ci-dessous pour ouvrir une demande de contrat.\nUn salon privé sera créé pour toi et notre équipe.')
        .setColor(0x5865F2)
        .setFooter({ text: 'HEO Studio • Système de contrats' })],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('creer_contrat').setLabel('📝 Créer un contrat').setStyle(ButtonStyle.Primary)
      )],
    });
    console.log('✅ Panneau envoyé !');
    process.exit(0);
  });
}

// ─── INTERACTIONS ─────────────────────────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {

  // ── /contrats ────────────────────────────────────────────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'contrats') {
    await interaction.deferReply({ ephemeral: false });
    const guild   = interaction.guild;
    const tickets = [];
    for (const [channelId, info] of ticketInfos.entries()) {
      const channel = guild.channels.cache.get(channelId);
      if (!channel) continue;
      const etapeIndex = ticketEtapes.get(channelId) ?? 0;
      if (etapeIndex === -1) continue;
      const etape = CONFIG.ETAPES[etapeIndex];
      tickets.push(`${etape.label} — **#${padNum(info.num)} ${info.nom}** — <@${info.clientId}> — ${channel}`);
    }
    if (tickets.length === 0) {
      await interaction.editReply({ content: '📭 Aucun contrat en cours.' });
      return;
    }
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setTitle('📋 Contrats en cours — HEO Studio')
        .setColor(0x5865F2)
        .setDescription(tickets.join('\n'))
        .setFooter({ text: `${tickets.length} contrat(s) actif(s)` })
        .setTimestamp()],
    });
    return;
  }

  // ── /assign ──────────────────────────────────────────────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'assign') {
    if (!isStaffOrAdmin(interaction.member)) {
      await interaction.reply({ content: '❌ Réservé au staff.', ephemeral: true }); return;
    }
    await interaction.deferReply({ ephemeral: true });

    const contratChannelId = interaction.options.getString('id_contrat');
    const guild = interaction.guild;

    let contratChannel;
    try {
      contratChannel = await guild.channels.fetch(contratChannelId);
    } catch {
      await interaction.editReply({ content: '❌ Salon introuvable avec cet ID.' }); return;
    }

    const info = ticketInfos.get(contratChannelId);
    if (!info) {
      await interaction.editReply({ content: '❌ Ce salon n\'est pas un contrat enregistré.' }); return;
    }

    const devUsers = [];
    for (const key of ['p1', 'p2', 'p3', 'p4', 'p5']) {
      const u = interaction.options.getUser(key);
      if (u) devUsers.push(u);
    }

    const numStr       = padNum(info.num);
    const devChannelName = `dev-${numStr}`;

    // Cherche d'abord via l'ID stocké, puis par nom en fallback
    let devChannel = null;
    if (info.devChannelId) {
      try {
        devChannel = await guild.channels.fetch(info.devChannelId);
      } catch {
        // Le salon a été supprimé, on en recrée un
        devChannel = null;
        info.devChannelId = null;
      }
    }

    // Fallback : cherche par nom si pas d'ID stocké
    if (!devChannel) {
      devChannel = guild.channels.cache.find(c =>
        c.name === devChannelName && c.parentId === CONFIG.CATEGORIES.DEV_CONTRAT
      ) || null;
    }

    if (devChannel) {
      // Mise à jour des permissions
      for (const [id] of devChannel.permissionOverwrites.cache) {
        await devChannel.permissionOverwrites.delete(id).catch(() => {});
      }
      await devChannel.permissionOverwrites.edit(guild.roles.everyone, { ViewChannel: false });
      for (const roleId of [CONFIG.STAFF_ROLE_ID, CONFIG.SECRETAIRE_ROLE_ID]) {
        await devChannel.permissionOverwrites.edit(roleId, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, ManageChannels: true }).catch(() => {});
      }
      for (const u of devUsers) {
        await devChannel.permissionOverwrites.edit(u.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true }).catch(() => {});
      }
      await devChannel.send({
        content: devUsers.map(u => `<@${u.id}>`).join(' '),
        embeds: [new EmbedBuilder()
          .setTitle(`🔄 Devs mis à jour — Contrat #${numStr}`)
          .setColor(0x5865F2)
          .setDescription(`Mis à jour par <@${interaction.user.id}>`)
          .addFields({ name: '🔨 Devs', value: devUsers.map(u => `<@${u.id}>`).join('\n') || '*Aucun*' })
          .setFooter({ text: 'HEO Studio • Dev' })
          .setTimestamp()],
        components: [buildDevDeleteRow()],
      });

      // Sauvegarde l'ID du salon dev
      info.devChannelId = devChannel.id;
      saveTickets();

      await interaction.editReply({ content: `✅ Salon ${devChannel} mis à jour avec ${devUsers.length} dev(s).` });
    } else {
      devChannel = await guild.channels.create({
        name: devChannelName,
        type: ChannelType.GuildText,
        parent: CONFIG.CATEGORIES.DEV_CONTRAT,
        permissionOverwrites: [
          { id: guild.roles.everyone,      deny:  [PermissionFlagsBits.ViewChannel] },
          { id: CONFIG.STAFF_ROLE_ID,      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] },
          { id: CONFIG.SECRETAIRE_ROLE_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] },
          ...devUsers.map(u => ({
            id: u.id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
          })),
        ],
      });
      await devChannel.send({
        content: devUsers.map(u => `<@${u.id}>`).join(' '),
        embeds: [new EmbedBuilder()
          .setTitle(`🛠️ Espace dev — Contrat #${numStr} — ${info.nom}`)
          .setColor(0x5865F2)
          .addFields(
            { name: '📋 Contrat', value: `${contratChannel}`, inline: true },
            { name: '🔨 Devs',   value: devUsers.map(u => `<@${u.id}>`).join('\n') || '*Aucun*', inline: false },
          )
          .setFooter({ text: 'HEO Studio • Dev' })
          .setTimestamp()],
        components: [buildDevDeleteRow()],
      });

      // Sauvegarde l'ID du salon dev
      info.devChannelId = devChannel.id;
      saveTickets();

      await interaction.editReply({ content: `✅ Salon ${devChannel} créé pour le contrat #${numStr} avec ${devUsers.length} dev(s).` });
    }
    return;
  }

  // ── Créer un contrat ──────────────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === 'creer_contrat') {
    const modal = new ModalBuilder().setCustomId('modal_contrat').setTitle('Nouvelle demande de contrat');
    modal.addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('nom_projet').setLabel('Nom du projet').setStyle(TextInputStyle.Short).setPlaceholder('Ex: Jeu Roblox RPG, Site vitrine...').setRequired(true)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('description').setLabel('Description du projet').setStyle(TextInputStyle.Paragraph).setPlaceholder('Décris ce que tu veux qu\'on réalise...').setRequired(true)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('budget').setLabel('Budget estimé (en Robux ou €)').setStyle(TextInputStyle.Short).setPlaceholder('Ex: 5000 Robux, 50€...').setRequired(true)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('delai').setLabel('Délai souhaité').setStyle(TextInputStyle.Short).setPlaceholder('Ex: 2 semaines, 1 mois...').setRequired(false)),
    );
    await interaction.showModal(modal);
    return;
  }

  // ── Modal contrat soumis ──────────────────────────────────────────────────────
  if (interaction.isModalSubmit() && interaction.customId === 'modal_contrat') {
    await interaction.deferReply({ ephemeral: true });
    const nomProjet   = interaction.fields.getTextInputValue('nom_projet');
    const description = interaction.fields.getTextInputValue('description');
    const budget      = interaction.fields.getTextInputValue('budget');
    const delai       = interaction.fields.getTextInputValue('delai') || 'Non précisé';
    const guild       = interaction.guild;
    const user        = interaction.user;

    contractCounter++;
    saveCounter(contractCounter);
    const num    = contractCounter;
    const numStr = padNum(num);

    const ticketChannel = await guild.channels.create({
      name: `${numStr}-${user.username.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20)}`,
      type: ChannelType.GuildText,
      parent: CONFIG.CATEGORIES.NEGOCIATION,
      permissionOverwrites: [
        { id: guild.roles.everyone,      deny:  [PermissionFlagsBits.ViewChannel] },
        { id: user.id,                   allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
        { id: CONFIG.STAFF_ROLE_ID,      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] },
        { id: CONFIG.SECRETAIRE_ROLE_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] },
      ],
    });

    ticketEtapes.set(ticketChannel.id, 0);
    ticketInfos.set(ticketChannel.id, { num, nom: nomProjet, description, budget, delai, clientId: user.id, etapeIndex: 0 });

    const contractMsg = await ticketChannel.send({
      content: `👋 <@${user.id}> | <@&${CONFIG.SECRETAIRE_ROLE_ID}>`,
      embeds: [buildEmbed(num, nomProjet, description, budget, delai, user, 0)],
      components: [buildStaffRow(0)],
    });

    ticketInfos.get(ticketChannel.id).messageId = contractMsg.id;
    saveTickets();

    await ticketChannel.send({ content: CONFIG.SECURITY_MESSAGE });

    await interaction.editReply({ content: `✅ Ton ticket a été créé : ${ticketChannel}` });
    return;
  }

  // ── Étape précédente ──────────────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === 'etape_precedente') {
    if (!isStaffOrAdmin(interaction.member)) {
      await interaction.reply({ content: '❌ Tu n\'as pas la permission de faire ça.', ephemeral: true }); return;
    }
    const channel         = interaction.channel;
    const etapeActuelle   = ticketEtapes.get(channel.id) ?? 0;
    const etapePrecedente = etapeActuelle - 1;
    if (etapePrecedente < 0) { await interaction.reply({ content: '⚠️ Déjà à la première étape.', ephemeral: true }); return; }
    await interaction.deferUpdate();
    await channel.setParent(CONFIG.CATEGORIES[CONFIG.ETAPES[etapePrecedente].id], { lockPermissions: false });
    ticketEtapes.set(channel.id, etapePrecedente);
    const info = ticketInfos.get(channel.id);
    info.etapeIndex = etapePrecedente;
    saveTickets();
    const clientUser = await client.users.fetch(info.clientId);
    await interaction.message.edit({ embeds: [buildEmbed(info.num, info.nom, info.description, info.budget, info.delai, clientUser, etapePrecedente)], components: [buildStaffRow(etapePrecedente)] });
    return;
  }

  // ── Étape suivante ────────────────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === 'etape_suivante') {
    if (!isStaffOrAdmin(interaction.member)) {
      await interaction.reply({ content: '❌ Tu n\'as pas la permission de faire ça.', ephemeral: true }); return;
    }
    const channel       = interaction.channel;
    const etapeActuelle = ticketEtapes.get(channel.id) ?? 0;
    const nouvelleEtape = etapeActuelle + 1;
    if (nouvelleEtape >= CONFIG.ETAPES.length) { await interaction.reply({ content: '✅ Déjà à l\'étape finale.', ephemeral: true }); return; }
    await interaction.deferUpdate();
    await channel.setParent(CONFIG.CATEGORIES[CONFIG.ETAPES[nouvelleEtape].id], { lockPermissions: false });
    ticketEtapes.set(channel.id, nouvelleEtape);
    const info = ticketInfos.get(channel.id);
    info.etapeIndex = nouvelleEtape;
    saveTickets();

    // Si on passe à TERMINE, déplacer le salon dev dans la catégorie archive terminé
    if (CONFIG.ETAPES[nouvelleEtape].id === 'TERMINE') {
      const devChannel = await getDevChannel(interaction.guild, info);
      if (devChannel) {
        await devChannel.setParent(CONFIG.CATEGORIES.DEV_TERMINE, { lockPermissions: false }).catch(() => {});
        await devChannel.send({
          embeds: [new EmbedBuilder()
            .setColor(0x57F287)
            .setDescription(`✅ Contrat **#${padNum(info.num)} — ${info.nom}** marqué comme **terminé** par <@${interaction.user.id}>`)
            .setTimestamp()],
        });
      }
    }

    const clientUser = await client.users.fetch(info.clientId);
    await interaction.message.edit({ embeds: [buildEmbed(info.num, info.nom, info.description, info.budget, info.delai, clientUser, nouvelleEtape)], components: [buildStaffRow(nouvelleEtape)] });
    return;
  }

  // ── Annuler contrat ───────────────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === 'annuler_contrat') {
    if (!isStaffOrAdmin(interaction.member)) {
      await interaction.reply({ content: '❌ Réservé au staff.', ephemeral: true }); return;
    }
    const channelId = interaction.channel.id;
    await interaction.reply({
      content: '⚠️ Tu es sûr de vouloir **annuler** ce contrat ?',
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`confirmer_annulation_${channelId}`).setLabel('✅ Oui, annuler').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('annuler_annulation').setLabel('❌ Retour').setStyle(ButtonStyle.Secondary),
      )],
      ephemeral: true,
    });
    return;
  }

  if (interaction.isButton() && interaction.customId === 'annuler_annulation') {
    await interaction.reply({ content: '✅ Annulation abandonnée.', ephemeral: true }); return;
  }

  if (interaction.isButton() && interaction.customId.startsWith('confirmer_annulation_')) {
    await interaction.deferUpdate();
    const contratChannelId = interaction.customId.replace('confirmer_annulation_', '');
    const channel = await interaction.guild.channels.fetch(contratChannelId).catch(() => null);
    if (!channel) { console.error('confirmer_annulation: salon introuvable', contratChannelId); return; }
    const etapeActuelle = ticketEtapes.get(channel.id) ?? 0;
    const info          = ticketInfos.get(channel.id);
    if (info) {
      info.etapeAvantAnnulation = etapeActuelle;
      info.etapeIndex = -1;
      saveTickets();
    }
    await channel.setParent(CONFIG.CATEGORIES.ANNULE, { lockPermissions: false });
    ticketEtapes.set(channel.id, -1);

    // Déplacer le salon dev dans la catégorie archive annulé
    const devChannel = await getDevChannel(interaction.guild, info);
    if (devChannel) {
      await devChannel.setParent(CONFIG.CATEGORIES.DEV_ANNULE, { lockPermissions: false }).catch(() => {});
      await devChannel.send({
        embeds: [new EmbedBuilder()
          .setColor(0xED4245)
          .setDescription(`❌ Contrat **#${padNum(info.num)} — ${info.nom}** **annulé** par <@${interaction.user.id}>`)
          .setTimestamp()],
      });
    }

    const updatedEmbed = new EmbedBuilder()
      .setTitle(`📋 Contrat #${padNum(info.num)} — ${info.nom}`)
      .setColor(0xED4245)
      .addFields(
        { name: '👤 Client', value: `<@${info.clientId}>`, inline: true },
        { name: '💰 Budget', value: info.budget,            inline: true },
        { name: '⏱️ Délai',  value: info.delai,             inline: true },
        { name: '📝 Description', value: info.description,  inline: false },
      )
      .setFooter({ text: 'HEO Studio • ❌ Contrat annulé' })
      .setTimestamp();

    const contractMsg = await getContractMessage(channel, info);
    if (contractMsg) {
      await contractMsg.edit({ embeds: [updatedEmbed], components: [buildStaffRow(0, true)] });
    }
    await channel.send({ embeds: [new EmbedBuilder().setColor(0xED4245).setDescription(`❌ Contrat **annulé** par <@${interaction.user.id}>`)] });
    return;
  }

  // ── Désannuler contrat ────────────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === 'desannuler_contrat') {
    if (!isStaffOrAdmin(interaction.member)) {
      await interaction.reply({ content: '❌ Réservé au staff.', ephemeral: true }); return;
    }
    await interaction.deferUpdate();
    const channel     = interaction.channel;
    const info        = ticketInfos.get(channel.id);
    const etapeRetour = info?.etapeAvantAnnulation ?? 0;
    await channel.setParent(CONFIG.CATEGORIES[CONFIG.ETAPES[etapeRetour].id], { lockPermissions: false });
    ticketEtapes.set(channel.id, etapeRetour);
    if (info) {
      info.etapeIndex = etapeRetour;
      delete info.etapeAvantAnnulation;
      saveTickets();
    }
    const etape = CONFIG.ETAPES[etapeRetour];

    // Remettre le salon dev dans DEV_CONTRAT
    const devChannelDesannule = await getDevChannel(interaction.guild, info);
    if (devChannelDesannule) {
      await devChannelDesannule.setParent(CONFIG.CATEGORIES.DEV_CONTRAT, { lockPermissions: false }).catch(() => {});
      await devChannelDesannule.send({
        embeds: [new EmbedBuilder()
          .setColor(etape.color)
          .setDescription(`↩️ Contrat **#${padNum(info.num)} — ${info.nom}** **désannulé** par <@${interaction.user.id}>\nRetour à l'étape : **${etape.label}**`)
          .setTimestamp()],
      });
    }

    const restoredEmbed = EmbedBuilder.from(interaction.message.embeds[0])
      .setColor(etape.color)
      .setFooter({ text: `HEO Studio • Étape : ${etape.label}` });
    await interaction.message.edit({ embeds: [restoredEmbed], components: [buildStaffRow(etapeRetour)] });
    await channel.send({ embeds: [new EmbedBuilder().setColor(etape.color).setDescription(`↩️ Contrat **désannulé** par <@${interaction.user.id}>\nRetour à l'étape : **${etape.label}**`)] });
    return;
  }

  // ── Supprimer ticket (contrat + dev) ──────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === 'supprimer_ticket') {
    if (!isStaffOrAdmin(interaction.member)) {
      await interaction.reply({ content: '❌ Réservé au staff.', ephemeral: true }); return;
    }
    const channelId = interaction.channel.id;
    await interaction.reply({
      content: '⚠️ Tu es sûr de vouloir **supprimer définitivement** ce ticket ?\n> Le salon dev associé sera également supprimé.',
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`confirmer_suppression_${channelId}`).setLabel('✅ Oui, supprimer').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('annuler_suppression').setLabel('❌ Annuler').setStyle(ButtonStyle.Secondary),
      )],
      ephemeral: true,
    });
    return;
  }

  if (interaction.isButton() && interaction.customId.startsWith('confirmer_suppression_') && !interaction.customId.startsWith('confirmer_suppression_dev')) {
    const contratChannelId = interaction.customId.replace('confirmer_suppression_', '');
    const channel = await interaction.guild.channels.fetch(contratChannelId).catch(() => null);
    if (!channel) return;
    const info = ticketInfos.get(channel.id);

    const devChannel = await getDevChannel(interaction.guild, info);
    if (devChannel) await devChannel.delete().catch(() => {});

    ticketEtapes.delete(channel.id);
    ticketInfos.delete(channel.id);
    saveTickets();
    await interaction.reply({ content: '🗑️ Suppression en cours...', ephemeral: true });
    setTimeout(() => channel.delete().catch(() => {}), 2000);
    return;
  }

  if (interaction.isButton() && interaction.customId === 'annuler_suppression') {
    await interaction.reply({ content: '✅ Suppression annulée.', ephemeral: true }); return;
  }

  // ── Supprimer salon dev uniquement ────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === 'supprimer_dev') {
    if (!isStaffOrAdmin(interaction.member)) {
      await interaction.reply({ content: '❌ Réservé au staff.', ephemeral: true }); return;
    }
    await interaction.reply({
      content: '⚠️ Tu es sûr de vouloir **supprimer ce salon dev** ?\n> Le contrat associé ne sera **pas** supprimé. Tu pourras réutiliser `/assign` pour en recréer un.',
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('confirmer_suppression_dev').setLabel('✅ Oui, supprimer').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('annuler_suppression_dev').setLabel('❌ Annuler').setStyle(ButtonStyle.Secondary),
      )],
      ephemeral: true,
    });
    return;
  }

  if (interaction.isButton() && interaction.customId === 'annuler_suppression_dev') {
    await interaction.reply({ content: '✅ Suppression annulée.', ephemeral: true }); return;
  }

  if (interaction.isButton() && interaction.customId === 'confirmer_suppression_dev') {
    const devChannel = interaction.channel;

    // Trouver le contrat associé à ce salon dev et retirer le devChannelId
    for (const [contratChannelId, info] of ticketInfos.entries()) {
      if (info.devChannelId === devChannel.id) {
        info.devChannelId = null;
        saveTickets();
        break;
      }
    }

    await interaction.reply({ content: '🗑️ Suppression du salon dev en cours...', ephemeral: true });
    setTimeout(() => devChannel.delete().catch(() => {}), 2000);
    return;
  }

});

client.login(CONFIG.TOKEN);
