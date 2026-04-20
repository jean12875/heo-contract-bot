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
  TOKEN:                    process.env.TOKEN,
  CLIENT_ID:                process.env.CLIENT_ID,
  GUILD_ID:                 process.env.GUILD_ID,
  PANEL_CHANNEL_ID:         '1485191415435624594',
  SUPPORT_PANEL_CHANNEL_ID: '1487752758294614076',
  STAFF_ROLE_ID:            '1487848016110162153',
  SECRETAIRE_ROLE_ID:       '1490464910549712937',

  DEV_ROLE_ID:              '1485191413829337299',

  DEV_ROLES: {
    builder:   '1488194780809789511',
    ui:        '1488194616413913088',
    scripteur: '1488194696831307776',
    animateur: '1488581098563702914',
  },

  CATEGORIES: {
    NEGOCIATION:   '1487848273355210803',
    PAIEMENT_1:    '1487848408050962593',
    DEVELOPPEMENT: '1487848473448546577',
    PAIEMENT_2:    '1487848515165229336',
    TERMINE:       '1487848579488813309',
    ANNULE:        '1487859413627834418',
    SUPPORT:       '1485236440047554640',
    DEV_CONTRAT:   '1495687556728225792',
  },

  ETAPES: [
    { id: 'NEGOCIATION',   label: '🟡 Négociation',               color: 0xF5C542 },
    { id: 'PAIEMENT_1',    label: '1️⃣ 1er paiement en attente',   color: 0xFF8C00 },
    { id: 'DEVELOPPEMENT', label: '🛠️ En cours de développement', color: 0x5865F2 },
    { id: 'PAIEMENT_2',    label: '2️⃣ 2ème paiement en attente',  color: 0xFF8C00 },
    { id: 'TERMINE',       label: '✅ Terminé',                    color: 0x57F287 },
  ],

  SUPPORT_TYPES: {
    question:   { label: '❓ Question',   color: 0x5865F2 },
    suggestion: { label: '💡 Suggestion', color: 0xF5C542 },
    report:     { label: '🚨 Report',     color: 0xED4245 },
  },

  // ─── RECRUTEMENT ──────────────────────────────────────────────────────────
  RECRUTEMENT_PANEL_CHANNEL_ID: '1488553805258821662',
  RECRUTEMENT_CATEGORY_ID:      '1488554531217346731',
  ROLE_ATT_ENTRETIEN:           '1485313117603893348',
  ROLE_DEV_GLOBAL:              '1485191413829337299',
  ROLE_SEPARATION:              '1485191413829337293',

  ETOILES_ROLES: {
    ui:        ['1485321773665751141','1485321825834766587','1485321711158038841','1485321660138524763','1485320858624065757'],
    builder:   ['1485322061994786918','1485321763985293392','1485321427845648385','1485321015721591024','1485320049073061952'],
    animateur: ['1488587193932058654','1488587312269885590','1488587339105308752','1488587372319871197','1488587400518041612'],
    scripteur: ['1485321122646851735','1485321178859180165','1485321077495300298','1485321012709953717','1488194696831307776'],
  },

  // ─── ASSETS / BOUTIQUE ────────────────────────────────────────────────────
  SHOP_CHANNEL_ID:   '1488940435593236570',
  ACHAT_CATEGORY_ID: '1488943924167970987',
  VENDEUR_ROLE_ID:   '1488952681278996571',

  // ─── URGENCE ──────────────────────────────────────────────────────────────
  URGENCE_ROLE_ID: '1489736017576591481',

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
const ticketEtapes        = new Map(); // channelId → etapeIndex (-1 = annulé)
const ticketInfos         = loadTickets(); // channelId → { num, nom, description, budget, delai, clientId, etapeIndex }
const pendingRecrutement  = new Map();
const pendingShop         = new Map();
// ──────────────────────────────────────────────────────────────────────────────

// Recharge les étapes depuis ticketInfos au démarrage
for (const [channelId, info] of ticketInfos.entries()) {
  ticketEtapes.set(channelId, info.etapeIndex ?? 0);
}

const DEV_TYPE_ICONS = {
  builder:   '🏗️ Builder',
  scripteur: '💻 Scripteur',
  ui:        '🎨 UI',
  animateur: '💨 Animateur',
};

const ASSET_TYPE_ICONS = {
  build:     '🏗️ Build',
  ui:        '🎨 UI',
  script:    '💻 Script',
  animation: '💨 Animation',
};

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];

function padNum(n) {
  return String(n).padStart(4, '0');
}

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
          .setDescription('ID Discord du salon contrat (ex: 123456789012345678)')
          .setRequired(true)
      )
      .addUserOption(opt => opt.setName('p1').setDescription('Dev 1').setRequired(true))
      .addUserOption(opt => opt.setName('p2').setDescription('Dev 2').setRequired(false))
      .addUserOption(opt => opt.setName('p3').setDescription('Dev 3').setRequired(false))
      .addUserOption(opt => opt.setName('p4').setDescription('Dev 4').setRequired(false))
      .addUserOption(opt => opt.setName('p5').setDescription('Dev 5').setRequired(false))
      .toJSON(),
    new SlashCommandBuilder()
      .setName('shop')
      .setDescription('Publier un nouvel asset dans la boutique (admin uniquement)')
      .toJSON(),
    new SlashCommandBuilder()
      .setName('modif')
      .setDescription('Modifier un asset existant dans la boutique (admin uniquement)')
      .addStringOption(opt =>
        opt.setName('message_id')
          .setDescription('ID du message de l\'asset à modifier')
          .setRequired(true)
      )
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
    const contractChannel = await client.channels.fetch(CONFIG.PANEL_CHANNEL_ID);
    await contractChannel.send({
      embeds: [new EmbedBuilder()
        .setTitle('📋 HEO Studio — Créer un contrat')
        .setDescription('Bienvenue sur le système de contrats **HEO Studio**.\n\nClique sur le bouton ci-dessous pour ouvrir une demande de contrat.\nUn salon privé sera créé pour toi et notre équipe.')
        .setColor(0x5865F2)
        .setFooter({ text: 'HEO Studio • Système de contrats' })],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('creer_contrat').setLabel('📝 Créer un contrat').setStyle(ButtonStyle.Primary)
      )],
    });

    const supportChannel = await client.channels.fetch(CONFIG.SUPPORT_PANEL_CHANNEL_ID);
    await supportChannel.send({
      embeds: [new EmbedBuilder()
        .setTitle('🎫 HEO Studio — Support')
        .setDescription('Sélectionne le type de ticket dans le menu ci-dessous.\nUn salon privé sera créé pour toi et notre équipe.')
        .setColor(0x5865F2)
        .setFooter({ text: 'HEO Studio • Support' })],
      components: [new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('select_support')
          .setPlaceholder('Choisis le type de ticket...')
          .addOptions(
            new StringSelectMenuOptionBuilder().setLabel('❓ Question').setDescription('Tu as une question pour l\'équipe').setValue('question'),
            new StringSelectMenuOptionBuilder().setLabel('💡 Suggestion').setDescription('Tu as une idée à soumettre').setValue('suggestion'),
            new StringSelectMenuOptionBuilder().setLabel('🚨 Report').setDescription('Signaler un problème ou un joueur').setValue('report'),
          )
      )],
    });

    const recrutChannel = await client.channels.fetch(CONFIG.RECRUTEMENT_PANEL_CHANNEL_ID);
    await recrutChannel.send({
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

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function isStaffOrAdmin(member) {
  return member.roles.cache.has(CONFIG.STAFF_ROLE_ID) ||
    member.roles.cache.has(CONFIG.SECRETAIRE_ROLE_ID) ||
    member.permissions.has(PermissionFlagsBits.Administrator);
}

function buildEmbed(num, nom, description, budget, delai, user, etapeIndex) {
  const etape = CONFIG.ETAPES[etapeIndex];
  return new EmbedBuilder()
    .setTitle(`📋 Contrat #${padNum(num)} — ${nom}`)
    .setColor(etape.color)
    .addFields(
      { name: '👤 Client',      value: `<@${user.id}>`, inline: true },
      { name: '💰 Budget',      value: budget,           inline: true },
      { name: '⏱️ Délai',       value: delai,            inline: true },
      { name: '📝 Description', value: description,       inline: false },
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

function buildSupportRow(ferme) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('fermer_support').setLabel('🔒 Fermer').setStyle(ButtonStyle.Secondary).setDisabled(ferme),
    new ButtonBuilder().setCustomId('supprimer_support').setLabel('🗑️ Supprimer').setStyle(ButtonStyle.Danger),
  );
}

function buildAssetEmbed(nom, desc, prix, typeLabel, mediaUrl) {
  const embed = new EmbedBuilder()
    .setTitle(`${typeLabel} — ${nom}`)
    .setColor(0x5865F2)
    .addFields(
      { name: '📝 Description', value: desc,      inline: false },
      { name: '💰 Prix',        value: prix,       inline: true  },
      { name: '🗂️ Type',        value: typeLabel,  inline: true  },
    )
    .setFooter({ text: 'HEO Studio • Boutique' })
    .setTimestamp();

  if (mediaUrl) {
    const isImage = IMAGE_EXTS.some(ext => mediaUrl.toLowerCase().includes(ext));
    if (isImage) embed.setImage(mediaUrl);
    else embed.addFields({ name: '🎬 Médias', value: `[Voir le média](${mediaUrl})`, inline: false });
  }

  return embed;
}

// ─── INTERACTIONS ─────────────────────────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {

  // ── /contrats ─────────────────────────────────────────────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'contrats') {
    await interaction.deferReply({ ephemeral: false });
    const guild = interaction.guild;
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

  // ── /assign ───────────────────────────────────────────────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'assign') {
    if (!isStaffOrAdmin(interaction.member)) {
      await interaction.reply({ content: '❌ Réservé au staff.', ephemeral: true }); return;
    }
    await interaction.deferReply({ ephemeral: true });

    const contratChannelId = interaction.options.getString('id_contrat');
    const guild = interaction.guild;

    // Vérifie que le salon contrat existe
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

    // Récupère les devs mentionnés
    const devUsers = [];
    for (const key of ['p1','p2','p3','p4','p5']) {
      const u = interaction.options.getUser(key);
      if (u) devUsers.push(u);
    }

    const numStr = padNum(info.num);
    const devChannelName = `dev-${numStr}`;

    // Cherche si un salon dev existe déjà
    let devChannel = guild.channels.cache.find(c =>
      c.name === devChannelName &&
      c.parentId === CONFIG.CATEGORIES.DEV_CONTRAT
    );

    const permissionOverwrites = [
      { id: guild.roles.everyone,         deny:  [PermissionFlagsBits.ViewChannel] },
      { id: CONFIG.SECRETAIRE_ROLE_ID,    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] },
      { id: CONFIG.STAFF_ROLE_ID,         allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] },
      ...devUsers.map(u => ({
        id: u.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
      })),
    ];

    if (devChannel) {
      // Repart de zéro sur les permissions
      // D'abord supprime toutes les overwrites existantes sauf @everyone
      for (const [id] of devChannel.permissionOverwrites.cache) {
        await devChannel.permissionOverwrites.delete(id).catch(() => {});
      }
      // Réapplique les nouvelles
      for (const ow of permissionOverwrites) {
        await devChannel.permissionOverwrites.edit(ow.id, ow.allow
          ? { ViewChannel: ow.allow.includes(PermissionFlagsBits.ViewChannel), SendMessages: true, ReadMessageHistory: true }
          : { ViewChannel: false }
        ).catch(() => {});
      }
      // Cas deny @everyone
      await devChannel.permissionOverwrites.edit(guild.roles.everyone, { ViewChannel: false }).catch(() => {});
      for (const roleId of [CONFIG.SECRETAIRE_ROLE_ID, CONFIG.STAFF_ROLE_ID]) {
        await devChannel.permissionOverwrites.edit(roleId, {
          ViewChannel: true, SendMessages: true, ReadMessageHistory: true, ManageChannels: true,
        }).catch(() => {});
      }
      for (const u of devUsers) {
        await devChannel.permissionOverwrites.edit(u.id, {
          ViewChannel: true, SendMessages: true, ReadMessageHistory: true,
        }).catch(() => {});
      }

      await devChannel.send({
        content: devUsers.map(u => `<@${u.id}>`).join(' '),
        embeds: [new EmbedBuilder()
          .setTitle(`🔄 Salon mis à jour — Contrat #${numStr}`)
          .setColor(0x5865F2)
          .setDescription(`Devs assignés mis à jour par <@${interaction.user.id}>`)
          .addFields({ name: '🔨 Devs', value: devUsers.map(u => `<@${u.id}>`).join('\n') || '*Aucun*' })
          .setFooter({ text: 'HEO Studio • Dev' })
          .setTimestamp()],
      });

      await interaction.editReply({ content: `✅ Salon ${devChannel} mis à jour avec ${devUsers.length} dev(s).` });
    } else {
      // Crée le salon
      devChannel = await guild.channels.create({
        name: devChannelName,
        type: ChannelType.GuildText,
        parent: CONFIG.CATEGORIES.DEV_CONTRAT,
        permissionOverwrites: [
          { id: guild.roles.everyone,      deny:  [PermissionFlagsBits.ViewChannel] },
          { id: CONFIG.SECRETAIRE_ROLE_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] },
          { id: CONFIG.STAFF_ROLE_ID,      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] },
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
            { name: '📋 Contrat',     value: `${contratChannel}`, inline: true },
            { name: '👤 Client',      value: `<@${info.clientId}>`, inline: true },
            { name: '💰 Budget',      value: info.budget,  inline: true },
            { name: '⏱️ Délai',       value: info.delai,   inline: true },
            { name: '📝 Description', value: info.description, inline: false },
            { name: '🔨 Devs',        value: devUsers.map(u => `<@${u.id}>`).join('\n') || '*Aucun*', inline: false },
          )
          .setFooter({ text: 'HEO Studio • Dev' })
          .setTimestamp()],
      });

      await interaction.editReply({ content: `✅ Salon ${devChannel} créé pour le contrat #${numStr} avec ${devUsers.length} dev(s).` });
    }
    return;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // ─── ASSETS / BOUTIQUE ──────────────────────────────────────────────────────
  // ════════════════════════════════════════════════════════════════════════════

  if (interaction.isChatInputCommand() && interaction.commandName === 'shop') {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({ content: '❌ Réservé aux admins.', ephemeral: true }); return;
    }
    const modal = new ModalBuilder().setCustomId('modal_shop_asset').setTitle('🛒 Publier un asset — HEO Studio');
    modal.addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('asset_nom').setLabel('Nom de l\'asset').setStyle(TextInputStyle.Short).setPlaceholder('Ex: Map hospitalière V2, UI Pack médical...').setRequired(true)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('asset_desc').setLabel('Description').setStyle(TextInputStyle.Paragraph).setPlaceholder('Décris l\'asset en détail (contenu, usage, compatibilité...)').setRequired(true)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('asset_prix').setLabel('Prix').setStyle(TextInputStyle.Short).setPlaceholder('Ex: 500 Robux, 10€, Gratuit...').setRequired(true)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('asset_type').setLabel('Type (build / ui / script / animation)').setStyle(TextInputStyle.Short).setPlaceholder('build, ui, script ou animation').setRequired(true)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('asset_media').setLabel('URL du média (image ou vidéo)').setStyle(TextInputStyle.Short).setPlaceholder('https://... (lien direct image ou vidéo) — optionnel').setRequired(false)),
    );
    await interaction.showModal(modal);
    return;
  }

  if (interaction.isModalSubmit() && interaction.customId === 'modal_shop_asset') {
    await interaction.deferReply({ ephemeral: true });
    const nom      = interaction.fields.getTextInputValue('asset_nom');
    const desc     = interaction.fields.getTextInputValue('asset_desc');
    const prix     = interaction.fields.getTextInputValue('asset_prix');
    const typeRaw  = interaction.fields.getTextInputValue('asset_type').toLowerCase().trim();
    const mediaUrl = interaction.fields.getTextInputValue('asset_media').trim();
    if (!ASSET_TYPE_ICONS[typeRaw]) { await interaction.editReply({ content: '❌ Type invalide. Utilise : `build`, `ui`, `script` ou `animation`.' }); return; }
    const typeLabel   = ASSET_TYPE_ICONS[typeRaw];
    const shopChannel = await client.channels.fetch(CONFIG.SHOP_CHANNEL_ID);
    const embed       = buildAssetEmbed(nom, desc, prix, typeLabel, mediaUrl);
    const msg = await shopChannel.send({
      embeds: [embed],
      components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('acheter_asset').setLabel('🛒 Acheter').setStyle(ButtonStyle.Success))],
    });
    await interaction.editReply({ content: `✅ Asset publié dans ${shopChannel} !\nID du message : \`${msg.id}\`` });
    return;
  }

  if (interaction.isChatInputCommand() && interaction.commandName === 'modif') {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({ content: '❌ Réservé aux admins.', ephemeral: true }); return;
    }
    const messageId   = interaction.options.getString('message_id');
    const shopChannel = await client.channels.fetch(CONFIG.SHOP_CHANNEL_ID);
    try { await shopChannel.messages.fetch(messageId); }
    catch { await interaction.reply({ content: '❌ Message introuvable dans le salon boutique.', ephemeral: true }); return; }
    pendingShop.set(interaction.user.id, { messageId, channelId: shopChannel.id });
    const modal = new ModalBuilder().setCustomId('modal_modif_asset').setTitle('✏️ Modifier un asset — HEO Studio');
    modal.addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('asset_nom').setLabel('Nouveau nom').setStyle(TextInputStyle.Short).setPlaceholder('Laisse vide pour ne pas changer').setRequired(false)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('asset_desc').setLabel('Nouvelle description').setStyle(TextInputStyle.Paragraph).setPlaceholder('Laisse vide pour ne pas changer').setRequired(false)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('asset_prix').setLabel('Nouveau prix').setStyle(TextInputStyle.Short).setPlaceholder('Laisse vide pour ne pas changer').setRequired(false)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('asset_type').setLabel('Nouveau type (build/ui/script/animation)').setStyle(TextInputStyle.Short).setPlaceholder('Laisse vide pour ne pas changer').setRequired(false)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('asset_media').setLabel('Nouvelle URL média').setStyle(TextInputStyle.Short).setPlaceholder('Laisse vide pour ne pas changer').setRequired(false)),
    );
    await interaction.showModal(modal);
    return;
  }

  if (interaction.isModalSubmit() && interaction.customId === 'modal_modif_asset') {
    await interaction.deferReply({ ephemeral: true });
    const pending = pendingShop.get(interaction.user.id);
    if (!pending) { await interaction.editReply({ content: '❌ Session expirée, relance /modif.' }); return; }
    pendingShop.delete(interaction.user.id);
    const shopChannel = await client.channels.fetch(pending.channelId);
    let targetMsg;
    try { targetMsg = await shopChannel.messages.fetch(pending.messageId); }
    catch { await interaction.editReply({ content: '❌ Message introuvable.' }); return; }
    const oldEmbed = targetMsg.embeds[0];
    if (!oldEmbed) { await interaction.editReply({ content: '❌ Embed introuvable sur ce message.' }); return; }
    const nomRaw   = interaction.fields.getTextInputValue('asset_nom').trim();
    const descRaw  = interaction.fields.getTextInputValue('asset_desc').trim();
    const prixRaw  = interaction.fields.getTextInputValue('asset_prix').trim();
    const typeRaw  = interaction.fields.getTextInputValue('asset_type').toLowerCase().trim();
    const mediaRaw = interaction.fields.getTextInputValue('asset_media').trim();
    const oldNom   = oldEmbed.title?.replace(/^.+? — /, '') ?? '';
    const oldDesc  = oldEmbed.fields?.find(f => f.name === '📝 Description')?.value ?? '';
    const oldPrix  = oldEmbed.fields?.find(f => f.name === '💰 Prix')?.value ?? '';
    const oldType  = oldEmbed.fields?.find(f => f.name === '🗂️ Type')?.value ?? '';
    const oldMedia = oldEmbed.image?.url ?? '';
    if (typeRaw && !ASSET_TYPE_ICONS[typeRaw]) { await interaction.editReply({ content: '❌ Type invalide.' }); return; }
    const newNom       = nomRaw  || oldNom;
    const newDesc      = descRaw || oldDesc;
    const newPrix      = prixRaw || oldPrix;
    const newMedia     = mediaRaw || oldMedia;
    const newTypeRaw   = typeRaw || Object.entries(ASSET_TYPE_ICONS).find(([, v]) => v === oldType)?.[0] || 'build';
    const newTypeLabel = ASSET_TYPE_ICONS[newTypeRaw];
    const updatedEmbed = buildAssetEmbed(newNom, newDesc, newPrix, newTypeLabel, newMedia);
    updatedEmbed.setColor(oldEmbed.color ?? 0x5865F2);
    await targetMsg.edit({ embeds: [updatedEmbed] });
    await interaction.editReply({ content: `✅ Asset **${newNom}** mis à jour !` });
    return;
  }

  if (interaction.isButton() && interaction.customId === 'acheter_asset') {
    const embed    = interaction.message.embeds[0];
    const assetNom = embed?.title?.replace(/^.+? — /, '') ?? 'Asset inconnu';
    const modal = new ModalBuilder().setCustomId(`modal_achat_asset:${assetNom.slice(0, 90)}`).setTitle(`🛒 Acheter — ${assetNom.slice(0, 40)}`);
    modal.addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('achat_moyen_paiement').setLabel('Moyen de paiement').setStyle(TextInputStyle.Short).setPlaceholder('Ex: Robux, PayPal, carte...').setRequired(true)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('achat_message').setLabel('Message / infos supplémentaires').setStyle(TextInputStyle.Paragraph).setPlaceholder('Questions, précisions, usage prévu...').setRequired(false)),
    );
    await interaction.showModal(modal);
    return;
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_achat_asset:')) {
    await interaction.deferReply({ ephemeral: true });
    const user          = interaction.user;
    const guild         = interaction.guild;
    const assetNom      = interaction.customId.slice('modal_achat_asset:'.length);
    const moyenPaiement = interaction.fields.getTextInputValue('achat_moyen_paiement');
    const messageClient = interaction.fields.getTextInputValue('achat_message') || '*Aucun*';
    const existing = guild.channels.cache.find(c =>
      c.name.startsWith(`achat-${user.username.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 15)}`) &&
      c.type === ChannelType.GuildText
    );
    if (existing) { await interaction.editReply({ content: `❌ Tu as déjà un ticket d'achat ouvert : ${existing}` }); return; }
    const ticketChannel = await guild.channels.create({
      name: `achat-${user.username.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20)}`,
      type: ChannelType.GuildText,
      parent: CONFIG.ACHAT_CATEGORY_ID,
      permissionOverwrites: [
        { id: guild.roles.everyone,      deny:  [PermissionFlagsBits.ViewChannel] },
        { id: user.id,                   allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
        { id: CONFIG.VENDEUR_ROLE_ID,    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] },
      ],
    });
    await ticketChannel.send({
      content: `👋 <@${user.id}> | <@&${CONFIG.VENDEUR_ROLE_ID}>`,
      embeds: [new EmbedBuilder()
        .setTitle(`🛒 Demande d'achat — ${user.username}`)
        .setColor(0x57F287)
        .addFields(
          { name: '👤 Acheteur',          value: `<@${user.id}>`, inline: true  },
          { name: '🎮 Article',           value: assetNom,        inline: true  },
          { name: '💳 Moyen de paiement', value: moyenPaiement,   inline: true  },
          { name: '💬 Message',           value: messageClient,   inline: false },
        )
        .setFooter({ text: 'HEO Studio • Boutique' })
        .setTimestamp()],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('achat_fermer').setLabel('🔒 Fermer le ticket').setStyle(ButtonStyle.Secondary),
      )],
    });
    await interaction.editReply({ content: `✅ Ton ticket d'achat a été créé : ${ticketChannel}` });
    return;
  }

  if (interaction.isButton() && interaction.customId === 'achat_fermer') {
    const member = interaction.member;
    if (!member.roles.cache.has(CONFIG.VENDEUR_ROLE_ID) && !member.permissions.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({ content: '❌ Réservé au rôle vendeur.', ephemeral: true }); return;
    }
    await interaction.deferUpdate();
    const channel = interaction.channel;
    const guild   = interaction.guild;
    for (const [id] of channel.permissionOverwrites.cache) {
      if (id === guild.id) continue;
      if (id === CONFIG.VENDEUR_ROLE_ID) continue;
      await channel.permissionOverwrites.edit(id, { ViewChannel: false, SendMessages: false, ReadMessageHistory: false }).catch(() => {});
    }
    const newName = `🔒${channel.name.replace(/^🔒/, '')}`;
    await channel.setName(newName).catch(() => {});
    await interaction.message.edit({
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('achat_fermer').setLabel('🔒 Fermé').setStyle(ButtonStyle.Secondary).setDisabled(true),
      )],
    });
    await channel.send({ embeds: [new EmbedBuilder().setColor(0x99AAB5).setDescription(`🔒 Ce ticket est **fermé** par <@${interaction.user.id}>\nLe salon est conservé comme archive.`)] });
    return;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // ─── SUPPORT ────────────────────────────────────────────────────────────────
  // ════════════════════════════════════════════════════════════════════════════

  if (interaction.isStringSelectMenu() && interaction.customId === 'select_support') {
    const type = interaction.values[0];
    const modals = {
      question:   { title: '❓ Poser une question',   fields: [
        { id: 'sujet',   label: 'Sujet',      short: true,  placeholder: 'Ex: Délais, paiements...' },
        { id: 'message', label: 'Ta question', short: false, placeholder: 'Décris ta question en détail...' },
      ]},
      suggestion: { title: '💡 Faire une suggestion', fields: [
        { id: 'sujet',   label: 'Titre de la suggestion', short: true,  placeholder: 'Ex: Ajouter une fonctionnalité...' },
        { id: 'message', label: 'Description',            short: false, placeholder: 'Décris ta suggestion en détail...' },
      ]},
      report:     { title: '🚨 Signaler un problème', fields: [
        { id: 'sujet',   label: 'Qui ou quoi signaler ?', short: true,  placeholder: 'Ex: Pseudo du joueur, bug...' },
        { id: 'message', label: 'Description + preuves',  short: false, placeholder: 'Décris le problème, ajoute des preuves si possible...' },
      ]},
    };
    const modalDef = modals[type];
    const modal = new ModalBuilder().setCustomId(`modal_support_${type}`).setTitle(modalDef.title);
    for (const f of modalDef.fields) {
      modal.addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId(f.id).setLabel(f.label)
          .setStyle(f.short ? TextInputStyle.Short : TextInputStyle.Paragraph)
          .setPlaceholder(f.placeholder).setRequired(true)
      ));
    }
    await interaction.showModal(modal);
    return;
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_support_')) {
    await interaction.deferReply({ ephemeral: true });
    const type     = interaction.customId.replace('modal_support_', '');
    const sujet    = interaction.fields.getTextInputValue('sujet');
    const message  = interaction.fields.getTextInputValue('message');
    const user     = interaction.user;
    const guild    = interaction.guild;
    const typeInfo = CONFIG.SUPPORT_TYPES[type];
    const ticketChannel = await guild.channels.create({
      name: `${type}-${user.username.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20)}`,
      type: ChannelType.GuildText,
      parent: CONFIG.CATEGORIES.SUPPORT,
      permissionOverwrites: [
        { id: guild.roles.everyone,      deny:  [PermissionFlagsBits.ViewChannel] },
        { id: user.id,                   allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
        { id: CONFIG.STAFF_ROLE_ID,      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] },
        { id: CONFIG.SECRETAIRE_ROLE_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] },
      ],
    });
    await ticketChannel.send({
      content: `👋 <@${user.id}> | <@&${CONFIG.STAFF_ROLE_ID}>`,
      embeds: [new EmbedBuilder()
        .setTitle(`${typeInfo.label} — ${sujet}`)
        .setColor(typeInfo.color)
        .addFields(
          { name: '👤 Membre',  value: `<@${user.id}>`, inline: true },
          { name: '📝 Message', value: message,          inline: false },
        )
        .setFooter({ text: 'HEO Studio • Support' })
        .setTimestamp()],
      components: [buildSupportRow(false)],
    });
    await interaction.editReply({ content: `✅ Ton ticket a été créé : ${ticketChannel}` });
    return;
  }

  if (interaction.isButton() && interaction.customId === 'fermer_support') {
    const member = interaction.member;
    if (!isStaffOrAdmin(member)) {
      await interaction.reply({ content: '❌ Réservé au staff.', ephemeral: true }); return;
    }
    await interaction.deferUpdate();
    const channel = interaction.channel;
    for (const [id] of channel.permissionOverwrites.cache) {
      if (id !== interaction.guild.roles.everyone.id && id !== CONFIG.STAFF_ROLE_ID && id !== CONFIG.SECRETAIRE_ROLE_ID) {
        await channel.permissionOverwrites.edit(id, { ViewChannel: false, SendMessages: false });
      }
    }
    await channel.send({ embeds: [new EmbedBuilder().setColor(0x99AAB5).setDescription(`🔒 Ticket **fermé** par <@${interaction.user.id}>\nLe membre n'a plus accès à ce salon.`)] });
    await interaction.message.edit({ components: [buildSupportRow(true)] });
    return;
  }

  if (interaction.isButton() && interaction.customId === 'supprimer_support') {
    const member = interaction.member;
    if (!isStaffOrAdmin(member)) {
      await interaction.reply({ content: '❌ Réservé au staff.', ephemeral: true }); return;
    }
    await interaction.reply({
      content: '⚠️ Tu es sûr de vouloir **supprimer définitivement** ce ticket ?',
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('confirmer_suppression_support').setLabel('✅ Oui, supprimer').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('annuler_suppression_support').setLabel('❌ Annuler').setStyle(ButtonStyle.Secondary),
      )],
      ephemeral: true,
    });
    return;
  }

  if (interaction.isButton() && interaction.customId === 'confirmer_suppression_support') {
    const channel = interaction.channel;
    await interaction.reply({ content: '🗑️ Suppression en cours...', ephemeral: true });
    setTimeout(() => channel.delete().catch(() => {}), 2000);
    return;
  }

  if (interaction.isButton() && interaction.customId === 'annuler_suppression_support') {
    await interaction.reply({ content: '✅ Suppression annulée.', ephemeral: true }); return;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // ─── CONTRATS ───────────────────────────────────────────────────────────────
  // ════════════════════════════════════════════════════════════════════════════

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

  if (interaction.isModalSubmit() && interaction.customId === 'modal_contrat') {
    await interaction.deferReply({ ephemeral: true });
    const nomProjet   = interaction.fields.getTextInputValue('nom_projet');
    const description = interaction.fields.getTextInputValue('description');
    const budget      = interaction.fields.getTextInputValue('budget');
    const delai       = interaction.fields.getTextInputValue('delai') || 'Non précisé';
    const guild       = interaction.guild;
    const user        = interaction.user;

    // Incrémente compteur
    contractCounter++;
    saveCounter(contractCounter);
    const num    = contractCounter;
    const numStr = padNum(num);

    const existing = guild.channels.cache.find(c =>
      c.name === `${numStr}-${user.username.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20)}` &&
      c.type === ChannelType.GuildText
    );
    if (existing) { await interaction.editReply({ content: `❌ Tu as déjà un ticket ouvert : ${existing}` }); return; }

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
    saveTickets();

    await ticketChannel.send({
      content: `👋 <@${user.id}> | <@&${CONFIG.SECRETAIRE_ROLE_ID}>`,
      embeds: [buildEmbed(num, nomProjet, description, budget, delai, user, 0)],
      components: [buildStaffRow(0)],
    });

    await ticketChannel.send({ content: CONFIG.SECURITY_MESSAGE });

    await interaction.editReply({ content: `✅ Ton ticket a été créé : ${ticketChannel}` });
    return;
  }

  // ── Étape précédente ──────────────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === 'etape_precedente') {
    const channel       = interaction.channel;
    const etapeActuelle = ticketEtapes.get(channel.id) ?? 0;
    if (!isStaffOrAdmin(interaction.member)) {
      await interaction.reply({ content: '❌ Tu n\'as pas la permission de faire ça.', ephemeral: true }); return;
    }
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
    const channel       = interaction.channel;
    const etapeActuelle = ticketEtapes.get(channel.id) ?? 0;
    if (!isStaffOrAdmin(interaction.member)) {
      await interaction.reply({ content: '❌ Tu n\'as pas la permission de faire ça.', ephemeral: true }); return;
    }
    const nouvelleEtape = etapeActuelle + 1;
    if (nouvelleEtape >= CONFIG.ETAPES.length) { await interaction.reply({ content: '✅ Déjà à l\'étape finale.', ephemeral: true }); return; }
    await interaction.deferUpdate();
    await channel.setParent(CONFIG.CATEGORIES[CONFIG.ETAPES[nouvelleEtape].id], { lockPermissions: false });
    ticketEtapes.set(channel.id, nouvelleEtape);
    const info = ticketInfos.get(channel.id);
    info.etapeIndex = nouvelleEtape;
    saveTickets();
    const clientUser = await client.users.fetch(info.clientId);
    await interaction.message.edit({ embeds: [buildEmbed(info.num, info.nom, info.description, info.budget, info.delai, clientUser, nouvelleEtape)], components: [buildStaffRow(nouvelleEtape)] });
    return;
  }

  // ── Supprimer ticket contrat ──────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === 'supprimer_ticket') {
    if (!isStaffOrAdmin(interaction.member)) {
      await interaction.reply({ content: '❌ Réservé au staff.', ephemeral: true }); return;
    }
    await interaction.reply({
      content: '⚠️ Tu es sûr de vouloir **supprimer définitivement** ce ticket ?',
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('confirmer_suppression').setLabel('✅ Oui, supprimer').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('annuler_suppression').setLabel('❌ Annuler').setStyle(ButtonStyle.Secondary),
      )],
      ephemeral: true,
    });
    return;
  }

  if (interaction.isButton() && interaction.customId === 'confirmer_suppression') {
    const channel = interaction.channel;
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

  // ── Annuler contrat ───────────────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === 'annuler_contrat') {
    if (!isStaffOrAdmin(interaction.member)) {
      await interaction.reply({ content: '❌ Réservé au staff.', ephemeral: true }); return;
    }
    await interaction.reply({
      content: '⚠️ Tu es sûr de vouloir **annuler** ce contrat ?',
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('confirmer_annulation').setLabel('✅ Oui, annuler').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('annuler_annulation').setLabel('❌ Retour').setStyle(ButtonStyle.Secondary),
      )],
      ephemeral: true,
    });
    return;
  }

  if (interaction.isButton() && interaction.customId === 'annuler_annulation') {
    await interaction.reply({ content: '✅ Annulation abandonnée.', ephemeral: true }); return;
  }

  if (interaction.isButton() && interaction.customId === 'confirmer_annulation') {
    await interaction.deferUpdate();
    const channel = interaction.channel;
    const etapeActuelle = ticketEtapes.get(channel.id) ?? 0;

    // Sauvegarde l'étape avant annulation
    const info = ticketInfos.get(channel.id);
    if (info) {
      info.etapeAvantAnnulation = etapeActuelle;
      info.etapeIndex = -1;
      saveTickets();
    }

    await channel.setParent(CONFIG.CATEGORIES.ANNULE, { lockPermissions: false });
    ticketEtapes.set(channel.id, -1);

    const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
      .setColor(0xED4245)
      .setFooter({ text: 'HEO Studio • ❌ Contrat annulé' });

    await interaction.message.edit({ embeds: [updatedEmbed], components: [buildStaffRow(0, true)] });
    await channel.send({ embeds: [new EmbedBuilder().setColor(0xED4245).setDescription(`❌ Contrat **annulé** par <@${interaction.user.id}>`)] });
    return;
  }

  // ── Désannuler contrat ────────────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === 'desannuler_contrat') {
    if (!isStaffOrAdmin(interaction.member)) {
      await interaction.reply({ content: '❌ Réservé au staff.', ephemeral: true }); return;
    }
    await interaction.deferUpdate();
    const channel = interaction.channel;
    const info    = ticketInfos.get(channel.id);
    const etapeRetour = info?.etapeAvantAnnulation ?? 0;

    await channel.setParent(CONFIG.CATEGORIES[CONFIG.ETAPES[etapeRetour].id], { lockPermissions: false });
    ticketEtapes.set(channel.id, etapeRetour);
    if (info) {
      info.etapeIndex = etapeRetour;
      delete info.etapeAvantAnnulation;
      saveTickets();
    }

    const clientUser = await client.users.fetch(info.clientId);
    const etape = CONFIG.ETAPES[etapeRetour];
    const restoredEmbed = EmbedBuilder.from(interaction.message.embeds[0])
      .setColor(etape.color)
      .setFooter({ text: `HEO Studio • Étape : ${etape.label}` });

    await interaction.message.edit({ embeds: [restoredEmbed], components: [buildStaffRow(etapeRetour)] });
    await channel.send({ embeds: [new EmbedBuilder().setColor(etape.color).setDescription(`↩️ Contrat **désannulé** par <@${interaction.user.id}>\nRetour à l'étape : **${etape.label}**`)] });
    return;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // ─── RECRUTEMENT ────────────────────────────────────────────────────────────
  // ════════════════════════════════════════════════════════════════════════════

  if (interaction.isButton() && interaction.customId === 'creer_recrutement') {
    const modal = new ModalBuilder().setCustomId('modal_recrutement').setTitle('📩 Candidature Dev — HEO Studio');
    modal.addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('type_dev').setLabel('Type de développeur').setStyle(TextInputStyle.Short).setPlaceholder('Ex: UI, Scripting, Builder, Animation (ou plusieurs)').setRequired(true)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('disponibilite').setLabel('Disponibilité (jours / horaires)').setStyle(TextInputStyle.Short).setPlaceholder('Ex: Lun-Ven 18h-22h, Week-end toute la journée...').setRequired(true)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('paiement').setLabel('Type de paiement souhaité').setStyle(TextInputStyle.Short).setPlaceholder('Ex: Robux, €, % sur projet...').setRequired(true)),
    );
    await interaction.showModal(modal);
    return;
  }

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
    if (existing) { await interaction.editReply({ content: `❌ Tu as déjà une candidature ouverte : ${existing}` }); return; }
    const ticketChannel = await guild.channels.create({
      name: `recrut-${user.username.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20)}`,
      type: ChannelType.GuildText,
      parent: CONFIG.RECRUTEMENT_CATEGORY_ID,
      permissionOverwrites: [
        { id: guild.roles.everyone,      deny:  [PermissionFlagsBits.ViewChannel] },
        { id: user.id,                   allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
        { id: CONFIG.STAFF_ROLE_ID,      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] },
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
      )],
    });
    await interaction.editReply({ content: `✅ Ta candidature a été ouverte : ${ticketChannel}` });
    return;
  }

  if (interaction.isButton() && interaction.customId === 'recrut_refuser') {
    const member = interaction.member;
    if (!isStaffOrAdmin(member)) {
      await interaction.reply({ content: '❌ Réservé au staff.', ephemeral: true }); return;
    }
    await interaction.deferUpdate();
    const channel = interaction.channel;
    const disabledRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('recrut_accepter').setLabel('✅ Accepter').setStyle(ButtonStyle.Success).setDisabled(true),
      new ButtonBuilder().setCustomId('recrut_refuser').setLabel('❌ Refusé').setStyle(ButtonStyle.Danger).setDisabled(true),
    );
    await interaction.message.edit({ components: [disabledRow] });
    await channel.send({ embeds: [new EmbedBuilder().setColor(0xED4245).setDescription(`❌ Candidature **refusée** par <@${interaction.user.id}>\nLe salon sera supprimé dans 5 secondes.`)] });
    setTimeout(() => channel.delete().catch(() => {}), 5000);
    return;
  }

  if (interaction.isButton() && interaction.customId === 'recrut_accepter') {
    const member = interaction.member;
    if (!isStaffOrAdmin(member)) {
      await interaction.reply({ content: '❌ Réservé au staff.', ephemeral: true }); return;
    }
    await interaction.deferUpdate();
    const channel = interaction.channel;
    const disabledRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('recrut_accepter').setLabel('✅ Accepté').setStyle(ButtonStyle.Success).setDisabled(true),
      new ButtonBuilder().setCustomId('recrut_refuser').setLabel('❌ Refuser').setStyle(ButtonStyle.Danger).setDisabled(true),
    );
    await interaction.message.edit({ components: [disabledRow] });
    const selectTypes = new StringSelectMenuBuilder()
      .setCustomId('recrut_select_types')
      .setPlaceholder('Sélectionne le ou les types retenus...')
      .setMinValues(1).setMaxValues(4)
      .addOptions(
        new StringSelectMenuOptionBuilder().setLabel('🎨 UI').setValue('ui'),
        new StringSelectMenuOptionBuilder().setLabel('🏗️ Builder').setValue('builder'),
        new StringSelectMenuOptionBuilder().setLabel('💨 Animateur').setValue('animateur'),
        new StringSelectMenuOptionBuilder().setLabel('💻 Scripteur').setValue('scripteur'),
      );
    await channel.send({
      embeds: [new EmbedBuilder().setTitle('✅ Candidature acceptée — Étape 1/2').setDescription('Sélectionne le ou les **types de dev** attribués à ce candidat.').setColor(0x57F287)],
      components: [
        new ActionRowBuilder().addComponents(selectTypes),
        new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('recrut_types_valider').setLabel('➡️ Étape suivante').setStyle(ButtonStyle.Primary)),
      ],
    });
    return;
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'recrut_select_types') {
    const channel  = interaction.channel;
    const existing = pendingRecrutement.get(channel.id) ?? {};
    existing.types = interaction.values;
    pendingRecrutement.set(channel.id, existing);
    await interaction.deferUpdate();
    return;
  }

  if (interaction.isButton() && interaction.customId === 'recrut_types_valider') {
    const member = interaction.member;
    if (!isStaffOrAdmin(member)) {
      await interaction.reply({ content: '❌ Réservé au staff.', ephemeral: true }); return;
    }
    const channel = interaction.channel;
    const pending = pendingRecrutement.get(channel.id);
    if (!pending?.types?.length) { await interaction.reply({ content: '⚠️ Sélectionne au moins un type de dev.', ephemeral: true }); return; }
    await interaction.deferUpdate();
    await interaction.message.delete().catch(() => {});
    const rows = [];
    for (const type of pending.types) {
      const label = DEV_TYPE_ICONS[type] ?? type;
      rows.push(new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId(`recrut_etoiles_${type}`).setPlaceholder(`Niveau pour ${label}...`).addOptions(
          new StringSelectMenuOptionBuilder().setLabel('⭐⭐⭐⭐⭐ — 5 étoiles').setValue('0'),
          new StringSelectMenuOptionBuilder().setLabel('⭐⭐⭐⭐ — 4 étoiles').setValue('1'),
          new StringSelectMenuOptionBuilder().setLabel('⭐⭐⭐ — 3 étoiles').setValue('2'),
          new StringSelectMenuOptionBuilder().setLabel('⭐⭐ — 2 étoiles').setValue('3'),
          new StringSelectMenuOptionBuilder().setLabel('⭐ — 1 étoile').setValue('4'),
        )
      ));
    }
    rows.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('recrut_etoiles_valider').setLabel('✅ Confirmer et attribuer les rôles').setStyle(ButtonStyle.Success)));
    await channel.send({
      embeds: [new EmbedBuilder().setTitle('✅ Candidature acceptée — Étape 2/2').setDescription(`Types retenus : **${pending.types.map(t => DEV_TYPE_ICONS[t] ?? t).join(', ')}**\n\nChoisis le **niveau (étoiles)** pour chaque type.`).setColor(0x57F287)],
      components: rows,
    });
    return;
  }

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

  if (interaction.isButton() && interaction.customId === 'recrut_etoiles_valider') {
    const member = interaction.member;
    if (!isStaffOrAdmin(member)) {
      await interaction.reply({ content: '❌ Réservé au staff.', ephemeral: true }); return;
    }
    await interaction.deferUpdate();
    const channel = interaction.channel;
    const pending = pendingRecrutement.get(channel.id);
    if (!pending?.types?.length || !pending?.etoiles) { await interaction.followUp({ content: '⚠️ Données manquantes, recommence.', ephemeral: true }); return; }
    for (const type of pending.types) {
      if (pending.etoiles[type] === undefined) { await interaction.followUp({ content: `⚠️ Tu n'as pas choisi le niveau pour **${DEV_TYPE_ICONS[type] ?? type}**.`, ephemeral: true }); return; }
    }
    const messages    = await channel.messages.fetch({ limit: 30 });
    const embedMsg    = messages.find(m => m.author.id === client.user.id && m.embeds?.[0]?.title?.startsWith('📩 Candidature'));
    const candidateId = embedMsg?.embeds?.[0]?.fields?.find(f => f.name === '👤 Candidat')?.value?.replace(/[<@>]/g, '');
    if (!candidateId) { await interaction.followUp({ content: '❌ Impossible de retrouver le candidat.', ephemeral: true }); return; }
    const guild           = interaction.guild;
    const candidateMember = await guild.members.fetch(candidateId).catch(() => null);
    if (!candidateMember) { await interaction.followUp({ content: '❌ Le membre a quitté le serveur.', ephemeral: true }); return; }
    const rolesAdded = [];
    if (candidateMember.roles.cache.has(CONFIG.ROLE_ATT_ENTRETIEN)) await candidateMember.roles.remove(CONFIG.ROLE_ATT_ENTRETIEN).catch(() => {});
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
        .setDescription(`Bienvenue dans l'équipe **HEO Studio** <@${candidateId}> !\nTes rôles ont été attribués par <@${interaction.user.id}>.`)
        .addFields(
          { name: '🛠️ Types & niveaux', value: typesLabel,            inline: false },
          { name: '🏷️ Rôles ajoutés',   value: rolesAdded.join('\n'), inline: false },
        )
        .setFooter({ text: 'HEO Studio • Recrutement' })
        .setTimestamp()],
    });
    return;
  }

});

client.login(CONFIG.TOKEN);
