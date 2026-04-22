const {
  Client, GatewayIntentBits, Partials, ChannelType, PermissionFlagsBits,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  REST, Routes, SlashCommandBuilder,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
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

  // ─── RECRUTEMENT ────────────────────────────────────────────────────────────
  RECRUTEMENT_PANEL_CHANNEL_ID: '1495708866099417158',
  RECRUTEMENT_CATEGORY_ID:      '1488554531217346731',
  RECRUTEMENT_TERMINE_ID:       '1490254722899116273',
  RECRUTEMENT_REFUSE_ID:        '1490746206828232935',
  ROLE_ATT_ENTRETIEN:           '1485313117603893348',
  ROLE_DEV_GLOBAL:              '1485191413829337299',
  ROLE_SEPARATION:              '1485191413829337293',

  DEV_ROLES: {
    builder:      '1488194780809789511',
    ui:           '1488194616413913088',
    scripteur:    '1488194696831307776',
    animateur:    '1488581098563702914',
    modelisateur: '1496426361265328138',
    designer:     '1496429573900992614',
  },

  ETOILES_ROLES: {
    ui:           ['1485321773665751141','1485321825834766587','1485321711158038841','1485321660138524763','1485320858624065757'],
    builder:      ['1485322061994786918','1485321763985293392','1485321427845648385','1485321015721591024','1485320049073061952'],
    animateur:    ['1488587193932058654','1488587312269885590','1488587339105308752','1488587372319871197','1488587400518041612'],
    scripteur:    ['1485321122646851735','1485321178859180165','1485321077495300298','1485321012709953717','1488194696831307776'],
    modelisateur: ['1496427405462605854','1496427628897243345','1496427675437371462','1496427717342793879','1496427769217679450'],
    designer:     ['1496429816365322260','1496429980912058408','1496430030610366504','1496430076038742156','1496430128396501052'],
  },
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
const ticketEtapes       = new Map();
const ticketInfos        = loadTickets();
const pendingRecrutement = new Map();

for (const [channelId, info] of ticketInfos.entries()) {
  ticketEtapes.set(channelId, info.etapeIndex ?? 0);
}
// ──────────────────────────────────────────────────────────────────────────────

const DEV_TYPE_ICONS = {
  builder:      '🏗️ Builder',
  scripteur:    '💻 Scripteur',
  ui:           '🎨 UI',
  animateur:    '💨 Animateur',
  modelisateur: '🗿 Modélisateur',
  designer:     '🖌️ Designer',
};

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

    const recrutCh = await client.channels.fetch(CONFIG.RECRUTEMENT_PANEL_CHANNEL_ID);
    await recrutCh.send({
      embeds: [new EmbedBuilder()
        .setTitle('🖥️ HEO Studio — Recrutement Dev')
        .setDescription(
          'Tu souhaites rejoindre l\'équipe de développement **HEO Studio** ?\n\n' +
          'Clique sur le bouton ci-dessous pour ouvrir ta candidature.\nUn salon privé sera créé pour toi et notre équipe.'
        )
        .setColor(0x5865F2)
        .setFooter({ text: 'HEO Studio • Recrutement' })],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('creer_recrutement').setLabel('📩 Postuler').setStyle(ButtonStyle.Primary)
      )],
    });

    console.log('✅ Panneaux envoyés !');
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

  // ════════════════════════════════════════════════════════════════════════════
  // ─── RECRUTEMENT DEV ────────────────────────────────────────────────────────
  // ════════════════════════════════════════════════════════════════════════════

  // ── Ouvrir candidature ────────────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === 'creer_recrutement') {
    const modal = new ModalBuilder()
      .setCustomId('modal_recrutement')
      .setTitle('📩 Candidature Dev — HEO Studio');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('type_dev').setLabel('Type de développeur').setStyle(TextInputStyle.Short).setPlaceholder('UI, Builder, Animateur, Scripteur, Modélisateur, Designer').setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('disponibilite').setLabel('Disponibilité (jours / horaires)').setStyle(TextInputStyle.Short).setPlaceholder('Ex: Lun-Ven 18h-22h, Week-end toute la journée...').setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('paiement').setLabel('Type de paiement souhaité').setStyle(TextInputStyle.Short).setPlaceholder('Ex: Robux, €, % sur projet...').setRequired(true)
      ),
    );
    await interaction.showModal(modal);
    return;
  }

  // ── Modal recrutement soumis ──────────────────────────────────────────────────
  if (interaction.isModalSubmit() && interaction.customId === 'modal_recrutement') {
    await interaction.deferReply({ ephemeral: true });
    const typeDev       = interaction.fields.getTextInputValue('type_dev');
    const disponibilite = interaction.fields.getTextInputValue('disponibilite');
    const paiement      = interaction.fields.getTextInputValue('paiement');
    const user          = interaction.user;
    const guild         = interaction.guild;

    const existing = guild.channels.cache.find(c =>
      c.name === `recrut-${user.username.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20)}` &&
      c.type === ChannelType.GuildText
    );
    if (existing) {
      await interaction.editReply({ content: `❌ Tu as déjà une candidature ouverte : ${existing}` }); return;
    }

    const ticketChannel = await guild.channels.create({
      name: `recrut-${user.username.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20)}`,
      type: ChannelType.GuildText,
      parent: CONFIG.RECRUTEMENT_CATEGORY_ID,
      permissionOverwrites: [
        { id: guild.roles.everyone,  deny:  [PermissionFlagsBits.ViewChannel] },
        { id: user.id,               allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
        { id: CONFIG.STAFF_ROLE_ID,  allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] },
        { id: CONFIG.SECRETAIRE_ROLE_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] },
      ],
    });

    await ticketChannel.send({
      content: `👋 <@${user.id}> | <@&${CONFIG.STAFF_ROLE_ID}>`,
      embeds: [new EmbedBuilder()
        .setTitle(`📩 Candidature — ${user.username}`)
        .setColor(0x5865F2)
        .addFields(
          { name: '👤 Candidat',         value: `<@${user.id}>`, inline: true  },
          { name: '🛠️ Type de dev',       value: typeDev,         inline: true  },
          { name: '🕐 Disponibilité',     value: disponibilite,   inline: false },
          { name: '💰 Paiement souhaité', value: paiement,        inline: true  },
        )
        .setFooter({ text: 'HEO Studio • Recrutement' })
        .setTimestamp()],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('recrut_accepter').setLabel('✅ Accepter').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('recrut_refuser').setLabel('❌ Refuser').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('recrut_supprimer').setLabel('🗑️ Supprimer').setStyle(ButtonStyle.Secondary),
      )],
    });

    await interaction.editReply({ content: `✅ Ta candidature a été ouverte : ${ticketChannel}` });
    return;
  }

  // ── Supprimer ticket recrutement ──────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === 'recrut_supprimer') {
    if (!isStaffOrAdmin(interaction.member)) {
      await interaction.reply({ content: '❌ Réservé au staff.', ephemeral: true }); return;
    }
    const channelId = interaction.channel.id;
    await interaction.reply({
      content: '⚠️ Tu es sûr de vouloir **supprimer définitivement** ce ticket de recrutement ?',
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`recrut_confirmer_suppression_${channelId}`).setLabel('✅ Oui, supprimer').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('recrut_annuler_suppression').setLabel('❌ Annuler').setStyle(ButtonStyle.Secondary),
      )],
      ephemeral: true,
    });
    return;
  }

  if (interaction.isButton() && interaction.customId === 'recrut_annuler_suppression') {
    await interaction.reply({ content: '✅ Suppression annulée.', ephemeral: true }); return;
  }

  if (interaction.isButton() && interaction.customId.startsWith('recrut_confirmer_suppression_')) {
    const channelId = interaction.customId.replace('recrut_confirmer_suppression_', '');
    const channel   = await interaction.guild.channels.fetch(channelId).catch(() => null);
    if (!channel) return;
    pendingRecrutement.delete(channelId);
    await interaction.reply({ content: '🗑️ Suppression en cours...', ephemeral: true });
    setTimeout(() => channel.delete().catch(() => {}), 2000);
    return;
  }

  // ── Refuser candidature ───────────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === 'recrut_refuser') {
    if (!isStaffOrAdmin(interaction.member)) {
      await interaction.reply({ content: '❌ Réservé au staff.', ephemeral: true }); return;
    }
    await interaction.deferUpdate();
    const channel = interaction.channel;

    const disabledRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('recrut_accepter').setLabel('✅ Accepter').setStyle(ButtonStyle.Success).setDisabled(true),
      new ButtonBuilder().setCustomId('recrut_refuser').setLabel('❌ Refusé').setStyle(ButtonStyle.Danger).setDisabled(true),
      new ButtonBuilder().setCustomId('recrut_supprimer').setLabel('🗑️ Supprimer').setStyle(ButtonStyle.Secondary),
    );
    await interaction.message.edit({ components: [disabledRow] });

    // Déplacer dans recrutement refusé + préfixe 🔴
    const newName = `🔴-${channel.name.replace(/^🔴-/, '')}`;
    await channel.setName(newName).catch(() => {});
    await channel.setParent(CONFIG.RECRUTEMENT_REFUSE_ID, { lockPermissions: false }).catch(() => {});

    await channel.send({
      embeds: [new EmbedBuilder()
        .setColor(0xED4245)
        .setDescription(`❌ Candidature **refusée** par <@${interaction.user.id}>`)
        .setTimestamp()],
    });
    return;
  }

  // ── Accepter candidature → sélecteur type(s) ─────────────────────────────────
  if (interaction.isButton() && interaction.customId === 'recrut_accepter') {
    if (!isStaffOrAdmin(interaction.member)) {
      await interaction.reply({ content: '❌ Réservé au staff.', ephemeral: true }); return;
    }
    await interaction.deferUpdate();
    const channel = interaction.channel;

    const disabledRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('recrut_accepter').setLabel('✅ Accepté').setStyle(ButtonStyle.Success).setDisabled(true),
      new ButtonBuilder().setCustomId('recrut_refuser').setLabel('❌ Refuser').setStyle(ButtonStyle.Danger).setDisabled(true),
      new ButtonBuilder().setCustomId('recrut_supprimer').setLabel('🗑️ Supprimer').setStyle(ButtonStyle.Secondary),
    );
    await interaction.message.edit({ components: [disabledRow] });

    const selectTypes = new StringSelectMenuBuilder()
      .setCustomId('recrut_select_types')
      .setPlaceholder('Sélectionne le ou les types retenus...')
      .setMinValues(1)
      .setMaxValues(6)
      .addOptions(
        new StringSelectMenuOptionBuilder().setLabel('🎨 UI').setValue('ui'),
        new StringSelectMenuOptionBuilder().setLabel('🏗️ Builder').setValue('builder'),
        new StringSelectMenuOptionBuilder().setLabel('💨 Animateur').setValue('animateur'),
        new StringSelectMenuOptionBuilder().setLabel('💻 Scripteur').setValue('scripteur'),
        new StringSelectMenuOptionBuilder().setLabel('🗿 Modélisateur').setValue('modelisateur'),
        new StringSelectMenuOptionBuilder().setLabel('🖌️ Designer').setValue('designer'),
      );

    await channel.send({
      embeds: [new EmbedBuilder()
        .setTitle('✅ Candidature acceptée — Étape 1/2')
        .setDescription('Sélectionne le ou les **types de dev** attribués à ce candidat.')
        .setColor(0x57F287)],
      components: [
        new ActionRowBuilder().addComponents(selectTypes),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('recrut_types_valider').setLabel('➡️ Étape suivante').setStyle(ButtonStyle.Primary),
        ),
      ],
    });
    return;
  }

  // ── Select : types retenus ────────────────────────────────────────────────────
  if (interaction.isStringSelectMenu() && interaction.customId === 'recrut_select_types') {
    const channel  = interaction.channel;
    const existing = pendingRecrutement.get(channel.id) ?? {};
    existing.types = interaction.values;
    pendingRecrutement.set(channel.id, existing);
    await interaction.deferUpdate();
    return;
  }

  // ── Valider types → sélecteur étoiles ────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === 'recrut_types_valider') {
    if (!isStaffOrAdmin(interaction.member)) {
      await interaction.reply({ content: '❌ Réservé au staff.', ephemeral: true }); return;
    }
    const channel = interaction.channel;
    const pending = pendingRecrutement.get(channel.id);
    if (!pending?.types?.length) {
      await interaction.reply({ content: '⚠️ Sélectionne au moins un type de dev.', ephemeral: true }); return;
    }
    await interaction.deferUpdate();
    await interaction.message.delete().catch(() => {});

    const rows = [];
    for (const type of pending.types) {
      const label = DEV_TYPE_ICONS[type] ?? type;
      rows.push(new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`recrut_etoiles_${type}`)
          .setPlaceholder(`Niveau pour ${label}...`)
          .addOptions(
            new StringSelectMenuOptionBuilder().setLabel('⭐⭐⭐⭐⭐ — 5 étoiles').setValue('0'),
            new StringSelectMenuOptionBuilder().setLabel('⭐⭐⭐⭐ — 4 étoiles').setValue('1'),
            new StringSelectMenuOptionBuilder().setLabel('⭐⭐⭐ — 3 étoiles').setValue('2'),
            new StringSelectMenuOptionBuilder().setLabel('⭐⭐ — 2 étoiles').setValue('3'),
            new StringSelectMenuOptionBuilder().setLabel('⭐ — 1 étoile').setValue('4'),
          )
      ));
    }
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('recrut_etoiles_valider').setLabel('✅ Confirmer et attribuer les rôles').setStyle(ButtonStyle.Success),
    ));

    await channel.send({
      embeds: [new EmbedBuilder()
        .setTitle('✅ Candidature acceptée — Étape 2/2')
        .setDescription(`Types retenus : **${pending.types.map(t => DEV_TYPE_ICONS[t] ?? t).join(', ')}**\n\nChoisis le **niveau (étoiles)** pour chaque type.`)
        .setColor(0x57F287)],
      components: rows,
    });
    return;
  }

  // ── Select : étoiles par type ─────────────────────────────────────────────────
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith('recrut_etoiles_')) {
    const type    = interaction.customId.replace('recrut_etoiles_', '');
    const channel = interaction.channel;
    const pending = pendingRecrutement.get(channel.id) ?? {};
    if (!pending.etoiles) pending.etoiles = {};
    pending.etoiles[type] = interaction.values[0];
    pendingRecrutement.set(channel.id, pending);
    await interaction.deferUpdate();
    return;
  }

  // ── Confirmer → attribuer les rôles, renommer, déplacer ──────────────────────
  if (interaction.isButton() && interaction.customId === 'recrut_etoiles_valider') {
    if (!isStaffOrAdmin(interaction.member)) {
      await interaction.reply({ content: '❌ Réservé au staff.', ephemeral: true }); return;
    }
    await interaction.deferUpdate();
    const channel = interaction.channel;
    const pending = pendingRecrutement.get(channel.id);

    if (!pending?.types?.length || !pending?.etoiles) {
      await interaction.followUp({ content: '⚠️ Données manquantes, recommence.', ephemeral: true }); return;
    }
    for (const type of pending.types) {
      if (pending.etoiles[type] === undefined) {
        await interaction.followUp({ content: `⚠️ Tu n'as pas choisi le niveau pour **${DEV_TYPE_ICONS[type] ?? type}**.`, ephemeral: true }); return;
      }
    }

    // Retrouver le candidat depuis l'embed
    const messages    = await channel.messages.fetch({ limit: 30 });
    const embedMsg    = messages.find(m => m.author.id === client.user.id && m.embeds?.[0]?.title?.startsWith('📩 Candidature'));
    const candidateId = embedMsg?.embeds?.[0]?.fields?.find(f => f.name === '👤 Candidat')?.value?.replace(/[<@>]/g, '');
    if (!candidateId) {
      await interaction.followUp({ content: '❌ Impossible de retrouver le candidat dans l\'embed.', ephemeral: true }); return;
    }

    const guild           = interaction.guild;
    const candidateMember = await guild.members.fetch(candidateId).catch(() => null);
    if (!candidateMember) {
      await interaction.followUp({ content: '❌ Le membre a quitté le serveur.', ephemeral: true }); return;
    }

    const rolesAdded = [];

    if (candidateMember.roles.cache.has(CONFIG.ROLE_ATT_ENTRETIEN)) {
      await candidateMember.roles.remove(CONFIG.ROLE_ATT_ENTRETIEN).catch(() => {});
    }
    await candidateMember.roles.add(CONFIG.ROLE_DEV_GLOBAL).catch(() => {});
    await candidateMember.roles.add(CONFIG.ROLE_SEPARATION).catch(() => {});
    rolesAdded.push(`<@&${CONFIG.ROLE_DEV_GLOBAL}>`, `<@&${CONFIG.ROLE_SEPARATION}>`);

    for (const type of pending.types) {
      const typeRoleId = CONFIG.DEV_ROLES[type];
      const starIndex  = parseInt(pending.etoiles[type], 10);
      const starRoleId = CONFIG.ETOILES_ROLES[type]?.[starIndex];
      if (typeRoleId) { await candidateMember.roles.add(typeRoleId).catch(() => {}); rolesAdded.push(`<@&${typeRoleId}>`); }
      if (starRoleId) { await candidateMember.roles.add(starRoleId).catch(() => {}); rolesAdded.push(`<@&${starRoleId}>`); }
    }

    pendingRecrutement.delete(channel.id);
    await interaction.message.delete().catch(() => {});

    const typesLabel = pending.types.map(t => {
      const starIndex = parseInt(pending.etoiles[t], 10);
      const stars     = '⭐'.repeat(5 - starIndex);
      return `${DEV_TYPE_ICONS[t] ?? t} — ${stars}`;
    }).join('\n');

    await channel.send({
      content: `🎉 <@${candidateId}>`,
      embeds: [new EmbedBuilder()
        .setTitle('🎉 Candidature acceptée !')
        .setColor(0x57F287)
        .setDescription(`Bienvenue dans l'équipe **HEO Studio** <@${candidateId}> !\nRôles attribués par <@${interaction.user.id}>.`)
        .addFields(
          { name: '🛠️ Types & niveaux', value: typesLabel,            inline: false },
          { name: '🏷️ Rôles ajoutés',   value: rolesAdded.join('\n'), inline: false },
        )
        .setFooter({ text: 'HEO Studio • Recrutement' })
        .setTimestamp()],
    });

    // Renommer avec préfixe 🟢 et déplacer dans recrutement terminé
    const newName = `🟢-${channel.name.replace(/^🟢-/, '')}`;
    await channel.setName(newName).catch(() => {});
    await channel.setParent(CONFIG.RECRUTEMENT_TERMINE_ID, { lockPermissions: false }).catch(() => {});
    return;
  }

});

// ════════════════════════════════════════════════════════════════════════════
// ─── SUPPORT TICKETS ────────────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════════════

const SUPPORT_CONFIG = {
  PANEL_CHANNEL_ID: '1487752758294614076',
  CATEGORY_ID:      '1485236440047554640',
  LOGS_CHANNEL_ID:  '1485241208136536157',

  TYPES: {
    question:    { label: '❓ Question',    emoji: '❓', color: 0x3498DB },
    suggestion:  { label: '💡 Suggestion',  emoji: '💡', color: 0x2ECC71 },
    signalement: { label: '⚠️ Signalement', emoji: '⚠️', color: 0xE74C3C },
  },
};

function getSupportEmoji(typeKey) {
  if (typeKey === 'question')    return '❓';
  if (typeKey === 'suggestion')  return '💡';
  if (typeKey === 'signalement') return '⚠️';
  return typeKey;
}

// ── Setup panel support ────────────────────────────────────────────────────
if (process.argv[2] === 'setup-support') {
  client.once('ready', async () => {
    const ch = await client.channels.fetch(SUPPORT_CONFIG.PANEL_CHANNEL_ID);
    await ch.send({
      embeds: [new EmbedBuilder()
        .setTitle('🎫 HEO Studio — Support')
        .setDescription('Clique sur le bouton correspondant à ta demande.\nUn salon privé sera créé pour toi et notre équipe.')
        .setColor(0x5865F2)
        .setFooter({ text: 'HEO Studio • Support' })],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('support_question')   .setLabel('Question')   .setEmoji('❓').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('support_suggestion') .setLabel('Suggestion') .setEmoji('💡').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('support_signalement').setLabel('Signalement').setEmoji('⚠️').setStyle(ButtonStyle.Danger),
      )],
    });
    console.log('✅ Panel support envoyé !');
    process.exit(0);
  });
}

// ── Helper : créer un ticket support ──────────────────────────────────────
async function handleSupportCreate(interaction, typeKey) {
  const guild = interaction.guild;
  const user  = interaction.user;
  const type  = SUPPORT_CONFIG.TYPES[typeKey];
  const emoji = getSupportEmoji(typeKey);

  // Anti-doublon : un seul ticket par type par utilisateur
  const existing = guild.channels.cache.find(c =>
    c.parentId === SUPPORT_CONFIG.CATEGORY_ID &&
    c.topic === user.id &&
    c.name.includes(emoji)
  );
  if (existing) {
    await interaction.reply({ content: `❌ Tu as déjà un ticket de ce type ouvert : ${existing}`, ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const safeName    = user.username.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20);
  const channelName = `${emoji}-${safeName}`;

  const ticketChannel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: SUPPORT_CONFIG.CATEGORY_ID,
    topic: user.id,
    permissionOverwrites: [
      { id: guild.roles.everyone,          deny:  [PermissionFlagsBits.ViewChannel] },
      { id: user.id,                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
      { id: CONFIG.STAFF_ROLE_ID,           allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] },
      { id: CONFIG.SECRETAIRE_ROLE_ID,      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] },
    ],
  });

  await ticketChannel.send({
    content: `👋 <@${user.id}> | <@&${CONFIG.STAFF_ROLE_ID}>`,
    embeds: [new EmbedBuilder()
      .setTitle(`${type.emoji} Ticket — ${type.label.split(' ').slice(1).join(' ')}`)
      .setDescription(`Bienvenue <@${user.id}> !\nExplique ta demande, notre équipe te répondra dès que possible.`)
      .setColor(type.color)
      .addFields({ name: '👤 Créé par', value: `<@${user.id}>`, inline: true })
      .setFooter({ text: 'HEO Studio • Support' })
      .setTimestamp()],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('support_fermer').setLabel('🔒 Fermer').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('support_supprimer').setLabel('🗑️ Supprimer').setStyle(ButtonStyle.Danger),
    )],
  });

  await interaction.editReply({ content: `✅ Ton ticket a été créé : ${ticketChannel}` });
}

// ── Retranscription .txt ───────────────────────────────────────────────────
async function buildTranscript(channel) {
  const allMessages = [];
  let   lastId      = null;

  while (true) {
    const options = { limit: 100 };
    if (lastId) options.before = lastId;
    const batch = await channel.messages.fetch(options);
    if (batch.size === 0) break;
    allMessages.push(...batch.values());
    lastId = batch.last().id;
    if (batch.size < 100) break;
  }

  allMessages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

  const lines = allMessages.map(m => {
    const date    = new Date(m.createdTimestamp).toLocaleString('fr-FR');
    const content = m.content || (m.embeds.length ? '[embed]' : '[attachement]');
    return `[${date}] ${m.author.tag} : ${content}`;
  });

  return lines.join('\n');
}

// ── Second listener dédié au support ──────────────────────────────────────
client.on('interactionCreate', async (interaction) => {

  // ── Ouverture des tickets ────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === 'support_question')    { await handleSupportCreate(interaction, 'question');    return; }
  if (interaction.isButton() && interaction.customId === 'support_suggestion')  { await handleSupportCreate(interaction, 'suggestion');  return; }
  if (interaction.isButton() && interaction.customId === 'support_signalement') { await handleSupportCreate(interaction, 'signalement'); return; }

  // ── Fermer (tout le monde) ────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === 'support_fermer') {
    const channel = interaction.channel;

    if (channel.name.startsWith('🔒')) {
      await interaction.reply({ content: '⚠️ Ce ticket est déjà fermé.', ephemeral: true }); return;
    }
    await interaction.deferUpdate();

    const creatorId = channel.topic;
    if (creatorId) {
      await channel.permissionOverwrites.edit(creatorId, { SendMessages: false }).catch(() => {});
    }

    const newName = `🔒-${channel.name.replace(/^🔒-/, '')}`;
    await channel.setName(newName).catch(() => {});

    await channel.send({
      embeds: [new EmbedBuilder()
        .setColor(0x99AAB5)
        .setDescription(`🔒 Ticket **fermé** par <@${interaction.user.id}>`)
        .setTimestamp()],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('support_fermer')    .setLabel('🔒 Fermé')     .setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId('support_desannuler').setLabel('🔓 Rouvrir')   .setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('support_supprimer') .setLabel('🗑️ Supprimer').setStyle(ButtonStyle.Danger),
      )],
    });
    return;
  }

  // ── Rouvrir (staff/secrétaire) ────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === 'support_desannuler') {
    if (!isStaffOrAdmin(interaction.member)) {
      await interaction.reply({ content: '❌ Réservé au staff.', ephemeral: true }); return;
    }
    const channel = interaction.channel;
    await interaction.deferUpdate();

    const creatorId = channel.topic;
    if (creatorId) {
      await channel.permissionOverwrites.edit(creatorId, {
        ViewChannel:        true,
        SendMessages:       true,
        ReadMessageHistory: true,
      }).catch(() => {});
    }

    const newName = channel.name.replace(/^🔒-/, '');
    await channel.setName(newName).catch(() => {});

    await channel.send({
      embeds: [new EmbedBuilder()
        .setColor(0x57F287)
        .setDescription(`🔓 Ticket **rouvert** par <@${interaction.user.id}>`)
        .setTimestamp()],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('support_fermer')    .setLabel('🔒 Fermer')    .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('support_supprimer') .setLabel('🗑️ Supprimer').setStyle(ButtonStyle.Danger),
      )],
    });
    return;
  }

  // ── Supprimer (staff/secrétaire) ──────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === 'support_supprimer') {
    if (!isStaffOrAdmin(interaction.member)) {
      await interaction.reply({ content: '❌ Réservé au staff.', ephemeral: true }); return;
    }
    const channelId = interaction.channel.id;
    await interaction.reply({
      content: '⚠️ Tu es sûr de vouloir **supprimer définitivement** ce ticket ?\n> Une retranscription `.txt` sera envoyée dans les logs.',
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`support_confirm_del_${channelId}`).setLabel('✅ Oui, supprimer').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('support_cancel_del')              .setLabel('❌ Annuler')        .setStyle(ButtonStyle.Secondary),
      )],
      ephemeral: true,
    });
    return;
  }

  if (interaction.isButton() && interaction.customId === 'support_cancel_del') {
    await interaction.reply({ content: '✅ Suppression annulée.', ephemeral: true }); return;
  }

  if (interaction.isButton() && interaction.customId.startsWith('support_confirm_del_')) {
    const targetChannelId = interaction.customId.replace('support_confirm_del_', '');
    const channel = await interaction.guild.channels.fetch(targetChannelId).catch(() => null);
    if (!channel) return;

    await interaction.reply({ content: '📝 Génération de la retranscription...', ephemeral: true });

    const transcript = await buildTranscript(channel);
    const buffer     = Buffer.from(transcript, 'utf8');
    const fileName   = `transcript-${channel.name}-${Date.now()}.txt`;

    try {
      const logsChannel = await interaction.guild.channels.fetch(SUPPORT_CONFIG.LOGS_CHANNEL_ID);
      await logsChannel.send({
        embeds: [new EmbedBuilder()
          .setTitle(`🗑️ Ticket supprimé — #${channel.name}`)
          .setColor(0xED4245)
          .addFields(
            { name: '📋 Salon',        value: channel.name,                                         inline: true },
            { name: '👤 Créé par',     value: channel.topic ? `<@${channel.topic}>` : '*inconnu*', inline: true },
            { name: '🛡️ Supprimé par', value: `<@${interaction.user.id}>`,                          inline: true },
          )
          .setTimestamp()],
        files: [{ attachment: buffer, name: fileName }],
      });
    } catch (e) {
      console.error('Erreur envoi logs support:', e);
    }

    setTimeout(() => channel.delete().catch(() => {}), 2000);
    return;
  }

});

client.login(CONFIG.TOKEN);
