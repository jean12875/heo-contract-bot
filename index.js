const http = require('http');

const healthServer = http.createServer((req, res) => {
  res.writeHead(200);
  res.end('HEO Bot en ligne');
});
healthServer.on('error', (err) => console.error('⚠️ Serveur HTTP:', err));
healthServer.listen(process.env.PORT || 3000);

// Keep-alive : le bot ping sa propre URL toutes les 10 min pour éviter la mise en
// veille du plan gratuit Render (qui s'endort après ~15 min sans trafic entrant).
// Render fournit automatiquement RENDER_EXTERNAL_URL ; sinon, définis SELF_URL.
const SELF_URL = process.env.RENDER_EXTERNAL_URL || process.env.SELF_URL;
if (SELF_URL) {
  setInterval(() => {
    try {
      const mod = SELF_URL.startsWith('https') ? require('https') : require('http');
      mod.get(SELF_URL, (res) => res.resume()).on('error', () => {});
    } catch {}
  }, 10 * 60 * 1000);
}

const {
  Client, GatewayIntentBits, Partials, ChannelType, PermissionFlagsBits,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  REST, Routes, SlashCommandBuilder,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
} = require('discord.js');
const fs = require('fs');
const { Redis } = require('@upstash/redis');
const transcripts = require('discord-html-transcripts');

// ─── STOCKAGE : Upstash Redis si configuré, sinon fichiers locaux (repli) ──────
// Sur Render, le disque est effacé à chaque redémarrage : sans Redis, l'état
// des tickets est perdu. Avec les 2 variables d'env ci-dessous, tout est gardé.
const redis = (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)
  ? new Redis({
      url:   process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    })
  : null;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Channel],
});

// ─── FILET DE SÉCURITÉ GLOBAL ───────────────────────────────────────────────
// Empêche qu'une seule erreur non gérée fasse planter tout le bot.
// Sans ça, un bug dans une interaction tuait le process jusqu'au redémarrage Render.
process.on('unhandledRejection', (reason) => logError('unhandledRejection', reason));
process.on('uncaughtException', (err) => logError('uncaughtException', err));
client.on('error', (err) => logError('client Discord', err));
client.on('shardError', (err) => logError('shard Discord', err));

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const CONFIG = {
  TOKEN:              process.env.TOKEN,
  CLIENT_ID:          process.env.CLIENT_ID,
  GUILD_ID:           process.env.GUILD_ID,
  PANEL_CHANNEL_ID:   '1495692176020078602',
  STAFF_ROLE_ID:      '1487848016110162153',
  SECRETAIRE_ROLE_ID: '1490464910549712937',
  LOG_CHANNEL_ID:            '1518537607481397379',
  LOG_TRANSCRIPT_CHANNEL_ID: '1518537756526121030',
  DASHBOARD_CHANNEL_ID:      '1518540506483654716',
  ANNUAIRE_CHANNEL_ID:       '1518573444395044924',

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
    scripteur:    ['1485321122646851735','1485321178859180165','1485321077495300298','1485321012709953717','1485320795868631092'],
    modelisateur: ['1496427405462605854','1496427628897243345','1496427675437371462','1496427717342793879','1496427769217679450'],
    designer:     ['1496429816365322260','1496429980912058408','1496430030610366504','1496430076038742156','1496430128396501052'],
  },
};
// ──────────────────────────────────────────────────────────────────────────────

// ─── PERSISTANCE ──────────────────────────────────────────────────────────────
const TICKETS_FILE = './tickets.json';
const RECRUITS_FILE = './recruits.json';
const COOLDOWNS_FILE = './cooldowns.json';
const META_FILE = './meta.json';
const REDIS_TICKETS_KEY = 'heo:tickets';
const REDIS_RECRUITS_KEY = 'heo:recruits';
const REDIS_COOLDOWNS_KEY = 'heo:refuscooldowns';
const REDIS_META_KEY = 'heo:meta';
const ERRORS_FILE = './errors.json';
const REDIS_ERRORS_KEY = 'heo:errors';
const REFUS_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000; // 1 mois

// Charge un Map persisté depuis Redis (ou un fichier local en repli).
async function loadMap(redisKey, file) {
  if (redis) {
    try {
      let obj = await redis.get(redisKey);
      if (typeof obj === 'string') obj = JSON.parse(obj);
      return new Map(Object.entries(obj || {}));
    } catch (e) { console.error(`⚠️ load ${redisKey} (redis):`, e); return new Map(); }
  }
  try {
    if (fs.existsSync(file)) return new Map(Object.entries(JSON.parse(fs.readFileSync(file, 'utf8'))));
  } catch {}
  return new Map();
}

// Sauvegarde un Map vers Redis (ou un fichier local en repli).
function saveMap(map, redisKey, file) {
  const obj = {};
  for (const [k, v] of map.entries()) obj[k] = v;
  if (redis) {
    redis.set(redisKey, obj).catch(e => console.error(`⚠️ save ${redisKey} (redis):`, e));
    return;
  }
  try { fs.writeFileSync(file, JSON.stringify(obj)); } catch (e) { console.error(`⚠️ save ${file}:`, e); }
}

const loadTickets   = () => loadMap(REDIS_TICKETS_KEY, TICKETS_FILE);
const saveTickets   = () => saveMap(ticketInfos, REDIS_TICKETS_KEY, TICKETS_FILE);
const loadRecruits  = () => loadMap(REDIS_RECRUITS_KEY, RECRUITS_FILE);
const saveRecruits  = () => saveMap(recruitInfos, REDIS_RECRUITS_KEY, RECRUITS_FILE);
const loadCooldowns = () => loadMap(REDIS_COOLDOWNS_KEY, COOLDOWNS_FILE);
const saveCooldowns = () => saveMap(refusCooldowns, REDIS_COOLDOWNS_KEY, COOLDOWNS_FILE);
const loadMeta      = () => loadMap(REDIS_META_KEY, META_FILE);
const saveMeta      = () => saveMap(meta, REDIS_META_KEY, META_FILE);

// Journal d'erreurs persistant (Upstash) — consultable via /debug même après un crash.
function saveErrors() {
  if (redis) { redis.set(REDIS_ERRORS_KEY, errorLog).catch(() => {}); return; }
  try { fs.writeFileSync(ERRORS_FILE, JSON.stringify(errorLog)); } catch {}
}
async function loadErrors() {
  if (redis) {
    try { let e = await redis.get(REDIS_ERRORS_KEY); if (typeof e === 'string') e = JSON.parse(e); return Array.isArray(e) ? e : []; }
    catch { return []; }
  }
  try { if (fs.existsSync(ERRORS_FILE)) return JSON.parse(fs.readFileSync(ERRORS_FILE, 'utf8')); } catch {}
  return [];
}
function logError(context, err) {
  console.error(`⚠️ ${context}:`, err);
  try {
    errorLog.push({ t: Date.now(), c: context, m: String(err?.stack || err?.message || err).slice(0, 600) });
    while (errorLog.length > 50) errorLog.shift();
    saveErrors();
  } catch {}
}

// ─── STATE ────────────────────────────────────────────────────────────────────
const ticketEtapes  = new Map();
const ticketInfos   = new Map();
const recruitInfos  = new Map();
const refusCooldowns = new Map(); // userId -> timestamp du dernier refus
const meta = new Map();           // divers : ex. id du message du tableau secrétaire
const errorLog = [];              // 50 dernières erreurs, consultables via /debug
// Verrous anti double-clic : empêche un membre de créer 2 contrats/candidatures
// en soumettant le formulaire deux fois très vite (avant que le 1er ait fini).
const enCreationContrat = new Set();
const enCreationRecrut  = new Set();

// Charge l'état (contrats + recrutements) au démarrage, depuis Redis ou les fichiers.
async function initState() {
  const loaded = await loadTickets();
  ticketInfos.clear();
  ticketEtapes.clear();
  for (const [channelId, info] of loaded.entries()) {
    ticketInfos.set(channelId, info);
    ticketEtapes.set(channelId, info.etapeIndex ?? 0);
  }
  const loadedRecruits = await loadRecruits();
  recruitInfos.clear();
  for (const [channelId, info] of loadedRecruits.entries()) recruitInfos.set(channelId, info);
  const loadedCooldowns = await loadCooldowns();
  refusCooldowns.clear();
  for (const [userId, ts] of loadedCooldowns.entries()) refusCooldowns.set(userId, ts);
  const loadedMeta = await loadMeta();
  meta.clear();
  for (const [k, v] of loadedMeta.entries()) meta.set(k, v);
  const loadedErrors = await loadErrors();
  errorLog.length = 0;
  errorLog.push(...loadedErrors.slice(-50));
  console.log(`✅ État chargé : ${ticketInfos.size} contrat(s), ${recruitInfos.size} recrutement(s) — stockage=${redis ? 'Upstash Redis' : 'fichiers locaux'}`);
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

// Garantit qu'une valeur de champ d'embed ne dépasse jamais la limite Discord (1024).
// Filet de sécurité pour les données déjà enregistrées avant l'ajout des setMaxLength.
function clip(text, max = 1024) {
  const str = String(text ?? '');
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

// Libellé du champ montant : « Budget » (estimation client) → « Prix » (coût convenu, après modif).
const prixLabel = (info) => (info?.priceConfirmed ? '💰 Prix' : '💰 Budget');

function isStaffOrAdmin(member) {
  if (!member?.roles?.cache) return false;
  return member.roles.cache.has(CONFIG.STAFF_ROLE_ID) ||
    member.roles.cache.has(CONFIG.SECRETAIRE_ROLE_ID) ||
    member.permissions.has(PermissionFlagsBits.Administrator);
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function buildEmbed(num, nom, description, budget, delai, user, etapeIndex, budgetLabel = '💰 Budget') {
  const etape = CONFIG.ETAPES[etapeIndex];
  return new EmbedBuilder()
    .setTitle(`📋 Contrat #${padNum(num)} — ${nom}`)
    .setColor(etape.color)
    .addFields(
      { name: '👤 Client',      value: `<@${user.id}>`,    inline: true },
      { name: budgetLabel,      value: clip(budget, 256),   inline: true },
      { name: '⏱️ Délai',       value: clip(delai, 256),    inline: true },
      { name: '📝 Description', value: clip(description),   inline: false },
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
    new ButtonBuilder().setCustomId('modifier_contrat').setLabel('✏️ Modifier').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('annuler_contrat').setLabel('🚫 Annuler').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('supprimer_ticket').setLabel('🗑️ Supprimer').setStyle(ButtonStyle.Secondary),
  );
}

// Formulaire de création de contrat (partagé : bouton « Créer un contrat » + /contrat).
function buildContratModal() {
  return new ModalBuilder().setCustomId('modal_contrat').setTitle('Nouvelle demande de contrat').addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('nom_projet').setLabel('Nom du projet').setStyle(TextInputStyle.Short).setPlaceholder('Ex: Jeu Roblox RPG, Site vitrine...').setRequired(true).setMaxLength(100)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('description').setLabel('Description du projet').setStyle(TextInputStyle.Paragraph).setPlaceholder('Décris ce que tu veux qu\'on réalise...').setRequired(true).setMaxLength(1000)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('budget').setLabel('Budget estimé (en Robux ou €)').setStyle(TextInputStyle.Short).setPlaceholder('Ex: 5000 Robux, 50€...').setRequired(true).setMaxLength(100)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('delai').setLabel('Délai souhaité').setStyle(TextInputStyle.Short).setPlaceholder('Ex: 2 semaines, 1 mois...').setRequired(false).setMaxLength(100)),
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

// Journal d'audit : écrit une ligne dans le salon de logs staff.
async function logAction(guild, description, color = 0x5865F2) {
  try {
    const ch = await guild.channels.fetch(CONFIG.LOG_CHANNEL_ID).catch(() => null);
    if (ch) await ch.send({ embeds: [new EmbedBuilder().setColor(color).setDescription(description).setTimestamp()] });
  } catch (e) {
    console.error('⚠️ logAction:', e);
  }
}

// Génère un transcript HTML de la conversation, l'envoie dans le salon transcripts, puis supprime le salon.
async function archiveAndDelete(channel, guild, label) {
  try {
    const file = await transcripts.createTranscript(channel, {
      limit: -1,
      filename: `${label}-${channel.name}.html`,
      poweredBy: false,
    });
    const logCh = await guild.channels.fetch(CONFIG.LOG_TRANSCRIPT_CHANNEL_ID).catch(() => null);
    if (logCh) await logCh.send({ content: `🗒️ Transcript — ${label} : \`${channel.name}\``, files: [file] });
  } catch (e) {
    console.error('⚠️ archiveAndDelete (transcript):', e);
  }
  await channel.delete().catch(() => {});
}

// ─── TABLEAU SECRÉTAIRE ─────────────────────────────────────────────────────
// Un message unique (1 embed par étape active) listant les contrats, recréé s'il manque.
async function updateDashboard(guild) {
  try {
    if (!guild) return;
    const ch = await guild.channels.fetch(CONFIG.DASHBOARD_CHANNEL_ID).catch(() => null);
    if (!ch) return;

    const embeds = [];
    for (let i = 0; i < CONFIG.ETAPES.length; i++) {
      const etape = CONFIG.ETAPES[i];
      if (etape.id === 'TERMINE') continue; // ni terminé ni annulé dans le tableau
      const lines = [];
      for (const [chId, info] of ticketInfos.entries()) {
        const idx = ticketEtapes.get(chId) ?? info.etapeIndex ?? 0;
        if (idx !== i) continue;
        let line = `<#${chId}> — 👤 <@${info.clientId}>`;
        if (info.devChannelId) line += ` — 🛠️ <#${info.devChannelId}>`;
        lines.push(line);
      }
      let desc = lines.join('\n') || '*Aucun contrat*';
      if (desc.length > 1400) desc = desc.slice(0, 1400) + '\n… et d\'autres';
      embeds.push(new EmbedBuilder().setColor(etape.color).setTitle(`${etape.label} (${lines.length})`).setDescription(desc));
    }

    const msgId = meta.get('dashboardMsgId');
    let msg = msgId ? await ch.messages.fetch(msgId).catch(() => null) : null;
    if (msg) {
      await msg.edit({ embeds });
    } else {
      const sent = await ch.send({ embeds });
      meta.set('dashboardMsgId', sent.id);
      saveMeta();
    }
  } catch (e) {
    console.error('⚠️ updateDashboard:', e);
  }
}

// ─── ANNUAIRE DES DEVS ──────────────────────────────────────────────────────
// Renvoie les étoiles d'un membre pour un type donné (ETOILES_ROLES[type] : index 0 = 5★).
function etoilesPour(member, type) {
  const arr = CONFIG.ETOILES_ROLES[type] || [];
  for (let i = 0; i < arr.length; i++) {
    if (member.roles.cache.has(arr[i])) return '⭐'.repeat(5 - i);
  }
  return '';
}

// Met à jour l'annuaire : un embed total + un embed par type de dev (avec compteur).
async function updateAnnuaire(guild) {
  try {
    if (!guild) return;
    const ch = await guild.channels.fetch(CONFIG.ANNUAIRE_CHANNEL_ID).catch(() => null);
    if (!ch) return;
    await guild.members.fetch().catch(() => {}); // best effort pour peupler le cache

    const distinct = new Set();
    const typeEmbeds = [];
    for (const [type, roleId] of Object.entries(CONFIG.DEV_ROLES)) {
      const membres = guild.members.cache.filter(m => m.roles.cache.has(roleId));
      const lines = [];
      for (const m of membres.values()) {
        distinct.add(m.id);
        const stars = etoilesPour(m, type);
        lines.push(`<@${m.id}>${stars ? ` — ${stars}` : ''}`);
      }
      let desc = lines.join('\n') || '*Personne pour l\'instant*';
      if (desc.length > 900) desc = desc.slice(0, 900) + '\n…';
      typeEmbeds.push(new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(`${DEV_TYPE_ICONS[type] ?? type} (${membres.size})`)
        .setDescription(desc));
    }
    const topEmbed = new EmbedBuilder()
      .setColor(0x57F287)
      .setTitle(`👥 Équipe développement HEO — ${distinct.size} dev(s)`)
      .setDescription('Annuaire mis à jour automatiquement. Les devs multi-rôles apparaissent dans chaque type mais ne sont comptés qu\'une fois dans le total.')
      .setTimestamp();
    const embeds = [topEmbed, ...typeEmbeds];

    const msgId = meta.get('annuaireMsgId');
    let msg = msgId ? await ch.messages.fetch(msgId).catch(() => null) : null;
    if (msg) {
      await msg.edit({ embeds });
    } else {
      const sent = await ch.send({ embeds });
      meta.set('annuaireMsgId', sent.id);
      saveMeta();
    }
  } catch (e) {
    console.error('⚠️ updateAnnuaire:', e);
  }
}

// Débounce : regroupe les mises à jour rapprochées (changements de rôles en rafale).
let annuaireTimer = null;
function planifierAnnuaire(guild) {
  if (annuaireTimer) return;
  annuaireTimer = setTimeout(() => { annuaireTimer = null; updateAnnuaire(guild); }, 15 * 1000);
}

// Recrée le tableau / l'annuaire s'ils sont supprimés manuellement.
client.on('messageDelete', (msg) => {
  try {
    if (msg?.id && meta.get('dashboardMsgId') === msg.id) {
      meta.delete('dashboardMsgId');
      saveMeta();
      if (msg.guild) updateDashboard(msg.guild);
    }
    if (msg?.id && meta.get('annuaireMsgId') === msg.id) {
      meta.delete('annuaireMsgId');
      saveMeta();
      if (msg.guild) updateAnnuaire(msg.guild);
    }
  } catch {}
});

// Met à jour l'annuaire quand les rôles d'un membre changent (même à la main).
client.on('guildMemberUpdate', (oldM, newM) => {
  try {
    if (oldM.roles.cache.size !== newM.roles.cache.size) planifierAnnuaire(newM.guild);
  } catch {}
});

// ─── DÉPART D'UN MEMBRE : helpers partagés (événement temps réel + réconciliation) ──
// Annule un contrat car son client n'est plus là (suppose le contrat actif).
async function annulerContratDepartClient(guild, chId, info) {
  info.etapeAvantAnnulation = ticketEtapes.get(chId) ?? info.etapeIndex ?? 0;
  info.etapeIndex = -1;
  info.clientLeft = true;
  ticketEtapes.set(chId, -1);
  saveTickets();

  const channel = await guild.channels.fetch(chId).catch(() => null);
  if (channel) {
    await channel.setParent(CONFIG.CATEGORIES.ANNULE, { lockPermissions: false }).catch(() => {});
    const contractMsg = await getContractMessage(channel, info);
    if (contractMsg) {
      const annEmbed = new EmbedBuilder()
        .setTitle(`📋 Contrat #${padNum(info.num)} — ${info.nom}`)
        .setColor(0xED4245)
        .addFields(
          { name: '👤 Client',      value: `<@${info.clientId}>`,    inline: true },
          { name: prixLabel(info),  value: clip(info.budget, 256),    inline: true },
          { name: '⏱️ Délai',       value: clip(info.delai, 256),     inline: true },
          { name: '📝 Description', value: clip(info.description),    inline: false },
        )
        .setFooter({ text: 'HEO Studio • ❌ Annulé (départ du client)' })
        .setTimestamp();
      await contractMsg.edit({ embeds: [annEmbed], components: [buildStaffRow(0, true)] }).catch(() => {});
    }
    await channel.send({ content: `⚠️ <@&${CONFIG.SECRETAIRE_ROLE_ID}> Le client <@${info.clientId}> a **quitté le serveur**. Le contrat est **annulé automatiquement**. S'il revient, son accès sera rétabli et vous pourrez le désannuler.` }).catch(() => {});
  }
  const devChannel = await getDevChannel(guild, info);
  if (devChannel) await devChannel.setParent(CONFIG.CATEGORIES.DEV_ANNULE, { lockPermissions: false }).catch(() => {});
  await logAction(guild, `🚪 Client <@${info.clientId}> parti → contrat **#${padNum(info.num)} — ${info.nom}** annulé automatiquement`, 0xED4245);
}

// Signale au staff qu'un candidat est parti (avec bouton supprimer, pas de suppression auto).
async function signalerDepartDev(guild, chId, rec) {
  rec.candidateLeft = true;
  saveRecruits();
  const channel = await guild.channels.fetch(chId).catch(() => null);
  if (!channel) return;
  await channel.send({
    content: `⚠️ <@&${CONFIG.SECRETAIRE_ROLE_ID}> Le candidat/dev <@${rec.candidateId}> a **quitté le serveur**. La candidature est conservée au cas où il reviendrait.`,
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('recrut_supprimer').setLabel('🗑️ Supprimer la candidature').setStyle(ButtonStyle.Danger),
    )],
  }).catch(() => {});
  await logAction(guild, `🚪 Candidat <@${rec.candidateId}> parti — candidature \`${channel.name}\``, 0xED4245);
}

// Au démarrage : rattrape les départs survenus pendant que le bot était hors-ligne.
async function reconcilierMembres(guild) {
  // On récupère TOUS les membres en une fois. Si ça échoue, on n'annule RIEN
  // (évite d'annuler un contrat à tort à cause d'une erreur réseau passagère).
  try {
    await guild.members.fetch();
  } catch (e) {
    console.error('⚠️ reconcilierMembres (fetch global échoué, aucune action):', e);
    return;
  }
  try {
    for (const [chId, info] of ticketInfos.entries()) {
      const idx = ticketEtapes.get(chId) ?? info.etapeIndex ?? 0;
      if (idx === -1 || CONFIG.ETAPES[idx]?.id === 'TERMINE') continue;
      if (!guild.members.cache.has(info.clientId)) await annulerContratDepartClient(guild, chId, info);
    }
    for (const [chId, rec] of recruitInfos.entries()) {
      if (rec.candidateLeft) continue;
      if (!guild.members.cache.has(rec.candidateId)) await signalerDepartDev(guild, chId, rec);
    }
    updateDashboard(guild);
  } catch (e) {
    console.error('⚠️ reconcilierMembres:', e);
  }
}

// Relance : ping secrétaire + client si un contrat actif est inactif depuis 3 jours.
const INACTIVITE_MS = 3 * 24 * 60 * 60 * 1000;
async function verifierInactivite() {
  try {
    const guild = client.guilds.cache.get(CONFIG.GUILD_ID) || await client.guilds.fetch(CONFIG.GUILD_ID).catch(() => null);
    if (!guild) return;
    for (const [chId, info] of ticketInfos.entries()) {
      const idx = ticketEtapes.get(chId) ?? info.etapeIndex ?? 0;
      if (idx === -1 || CONFIG.ETAPES[idx]?.id === 'TERMINE') continue; // sauf annulé/terminé
      const channel = await guild.channels.fetch(chId).catch(() => null);
      if (!channel) continue;
      const msgs = await channel.messages.fetch({ limit: 1 }).catch(() => null);
      const lastTs = msgs?.first()?.createdTimestamp ?? 0;
      const dejaRelance = Date.now() - (info.lastReminder ?? 0) < INACTIVITE_MS;
      if (Date.now() - lastTs > INACTIVITE_MS && !dejaRelance) {
        await channel.send({ content: `⏰ <@&${CONFIG.SECRETAIRE_ROLE_ID}> <@${info.clientId}> — Ce contrat est **inactif depuis plus de 3 jours**. Un point sur l'avancement ?` }).catch(() => {});
        info.lastReminder = Date.now();
        saveTickets();
      }
    }
  } catch (e) {
    console.error('⚠️ verifierInactivite:', e);
  }
}

// Logique partagée par les boutons ◀️/➡️ ET les commandes /back et /next.
// sens = 'next' ou 'back'. Gère perms, garde-fous, déplacement de catégorie,
// archivage du salon dev si TERMINE, et mise à jour de l'embed du contrat.
async function changerEtape(interaction, sens) {
  if (!isStaffOrAdmin(interaction.member)) {
    return interaction.reply({ content: '❌ Tu n\'as pas la permission de faire ça.', ephemeral: true });
  }
  const channel = interaction.channel;
  const info    = ticketInfos.get(channel.id);
  if (!info) {
    return interaction.reply({ content: '⚠️ Ce salon n\'est pas un contrat reconnu par le bot.', ephemeral: true });
  }
  const etapeActuelle = ticketEtapes.get(channel.id) ?? 0;
  if (etapeActuelle === -1) {
    return interaction.reply({ content: '⚠️ Ce contrat est annulé. Utilise « ↩️ Désannuler » avant.', ephemeral: true });
  }
  const cible = sens === 'next' ? etapeActuelle + 1 : etapeActuelle - 1;
  if (cible < 0)                       return interaction.reply({ content: '⚠️ Déjà à la première étape.', ephemeral: true });
  if (cible >= CONFIG.ETAPES.length)   return interaction.reply({ content: '✅ Déjà à l\'étape finale.', ephemeral: true });

  const isButton = typeof interaction.isButton === 'function' && interaction.isButton();
  if (isButton) await interaction.deferUpdate();
  else          await interaction.deferReply({ ephemeral: true });

  await channel.setParent(CONFIG.CATEGORIES[CONFIG.ETAPES[cible].id], { lockPermissions: false }).catch(() => {});
  ticketEtapes.set(channel.id, cible);
  info.etapeIndex = cible;
  saveTickets();

  // Si on passe à TERMINE, on archive le salon dev associé.
  if (CONFIG.ETAPES[cible].id === 'TERMINE') {
    const devChannel = await getDevChannel(interaction.guild, info);
    if (devChannel) {
      await devChannel.setParent(CONFIG.CATEGORIES.DEV_TERMINE, { lockPermissions: false }).catch(() => {});
      await devChannel.send({
        embeds: [new EmbedBuilder()
          .setColor(0x57F287)
          .setDescription(`✅ Contrat **#${padNum(info.num)} — ${info.nom}** marqué comme **terminé** par <@${interaction.user.id}>`)
          .setTimestamp()],
      }).catch(() => {});
    }
    // Proposition de pourboire au client (totalement optionnel).
    await channel.send({
      content: `🎉 <@${info.clientId}>`,
      embeds: [new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle('🎉 Projet terminé — merci !')
        .setDescription(
          'Merci pour ta confiance ! Ton projet est terminé. 💛\n\n' +
          'Si tu es satisfait et que tu souhaites soutenir l\'équipe, tu peux laisser un **pourboire** (totalement optionnel) via 👉 https://revolut.me/heostudio'
        )
        .setFooter({ text: 'HEO Studio' })],
    }).catch(() => {});
  }

  const embed = buildEmbed(info.num, info.nom, info.description, info.budget, info.delai, { id: info.clientId }, cible, prixLabel(info));
  const row   = buildStaffRow(cible);
  // Pour un bouton, le message à éditer EST celui qui porte le bouton.
  // Pour une commande, on retrouve le message du contrat via son ID stocké.
  const contractMsg = isButton ? interaction.message : await getContractMessage(channel, info);
  if (contractMsg) await contractMsg.edit({ embeds: [embed], components: [row] }).catch(() => {});

  // Prévient le client de la nouvelle étape, directement dans son salon.
  await channel.send({ content: `📢 <@${info.clientId}> — Le contrat passe à l'étape : **${CONFIG.ETAPES[cible].label}**` }).catch(() => {});
  await logAction(interaction.guild, `➡️ Contrat **#${padNum(info.num)} — ${info.nom}** → **${CONFIG.ETAPES[cible].label}** (par <@${interaction.user.id}>)`, CONFIG.ETAPES[cible].color);
  updateDashboard(interaction.guild);

  if (!isButton) await interaction.editReply({ content: `✅ Étape : **${CONFIG.ETAPES[cible].label}**` });
}

// ─── READY ────────────────────────────────────────────────────────────────────
client.once('ready', async () => {
  console.log(`✅ Connecté en tant que ${client.user.tag}`);
  await initState();
  await registerSlashCommands();
  // Rafraîchit le tableau + rattrape les départs manqués pendant l'arrêt.
  const g = await client.guilds.fetch(CONFIG.GUILD_ID).catch(() => null);
  if (g) {
    updateDashboard(g);
    updateAnnuaire(g);
    reconcilierMembres(g);
  }
  // Relances d'inactivité + rafraîchissement annuaire : passage après le boot, puis toutes les 6 h.
  setTimeout(verifierInactivite, 60 * 1000);
  setInterval(verifierInactivite, 6 * 60 * 60 * 1000);
  setInterval(() => { const gg = client.guilds.cache.get(CONFIG.GUILD_ID); if (gg) updateAnnuaire(gg); }, 6 * 60 * 60 * 1000);
});

// ─── NETTOYAGE AUTO ─────────────────────────────────────────────────────────────
// Quand un salon est supprimé (même à la main), on retire les entrées associées
// pour éviter les données fantômes qui s'accumulent.
client.on('channelDelete', (channel) => {
  try {
    const id = channel.id;
    let changedTickets = false;
    if (ticketInfos.has(id)) { ticketInfos.delete(id); ticketEtapes.delete(id); changedTickets = true; }
    // Si c'était un salon dev, on retire la référence dans le contrat parent.
    for (const info of ticketInfos.values()) {
      if (info.devChannelId === id) { info.devChannelId = null; changedTickets = true; }
    }
    if (changedTickets) { saveTickets(); if (channel.guild) updateDashboard(channel.guild); }
    if (recruitInfos.has(id)) { recruitInfos.delete(id); saveRecruits(); }
  } catch (e) {
    console.error('⚠️ channelDelete:', e);
  }
});

// ─── DÉPART D'UN MEMBRE ─────────────────────────────────────────────────────
// Client parti → contrats annulés auto + ping secrétaire.
// Dev/candidat parti → ping secrétaire + bouton supprimer (pas de suppression auto).
client.on('guildMemberRemove', async (member) => {
  try {
    const guild = member.guild;
    for (const [chId, info] of ticketInfos.entries()) {
      if (info.clientId !== member.id) continue;
      const idx = ticketEtapes.get(chId) ?? info.etapeIndex ?? 0;
      if (idx === -1 || CONFIG.ETAPES[idx]?.id === 'TERMINE') continue;
      await annulerContratDepartClient(guild, chId, info);
    }
    updateDashboard(guild);
    for (const [chId, rec] of recruitInfos.entries()) {
      if (rec.candidateId !== member.id) continue;
      await signalerDepartDev(guild, chId, rec);
    }
    planifierAnnuaire(guild);
  } catch (e) {
    console.error('⚠️ guildMemberRemove:', e);
  }
});

// ─── RETOUR D'UN MEMBRE ─────────────────────────────────────────────────────
// Rétablit l'accès du membre revenu sur ses tickets (contrat et/ou candidature).
client.on('guildMemberAdd', async (member) => {
  try {
    const guild = member.guild;

    for (const [chId, info] of ticketInfos.entries()) {
      if (info.clientId !== member.id || !info.clientLeft) continue;
      const channel = await guild.channels.fetch(chId).catch(() => null);
      if (channel) {
        await channel.permissionOverwrites.edit(member.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true }).catch(() => {});
        await channel.send({ content: `✅ <@&${CONFIG.SECRETAIRE_ROLE_ID}> Le client <@${member.id}> est **revenu** sur le serveur. Son accès au ticket a été rétabli — vous pouvez **désannuler** le contrat si besoin.` }).catch(() => {});
      }
      info.clientLeft = false;
      saveTickets();
      await logAction(guild, `↩️ Client <@${member.id}> revenu — accès rétabli au contrat **#${padNum(info.num)} — ${info.nom}**`, 0x57F287);
    }

    for (const [chId, rec] of recruitInfos.entries()) {
      if (rec.candidateId !== member.id || !rec.candidateLeft) continue;
      const channel = await guild.channels.fetch(chId).catch(() => null);
      if (channel) {
        await channel.permissionOverwrites.edit(member.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true }).catch(() => {});
        await channel.send({ content: `✅ <@&${CONFIG.SECRETAIRE_ROLE_ID}> Le candidat <@${member.id}> est **revenu** sur le serveur.` }).catch(() => {});
      }
      rec.candidateLeft = false;
      saveRecruits();
    }
    planifierAnnuaire(guild);
  } catch (e) {
    console.error('⚠️ guildMemberAdd:', e);
  }
});

// ─── SLASH COMMANDS ───────────────────────────────────────────────────────────
async function registerSlashCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName('contrat')
      .setDescription('Ouvre le formulaire pour créer un nouveau contrat')
      .toJSON(),
    new SlashCommandBuilder()
      .setName('contrats')
      .setDescription('Liste tous les contrats en cours')
      .toJSON(),
    new SlashCommandBuilder()
      .setName('next')
      .setDescription('Passe le contrat de ce salon à l\'étape suivante')
      .toJSON(),
    new SlashCommandBuilder()
      .setName('back')
      .setDescription('Ramène le contrat de ce salon à l\'étape précédente')
      .toJSON(),
    new SlashCommandBuilder()
      .setName('debug')
      .setDescription('Affiche les dernières erreurs du bot (staff)')
      .toJSON(),
    new SlashCommandBuilder()
      .setName('paiement')
      .setDescription('Affiche les instructions de paiement dans le salon')
      .addStringOption(opt =>
        opt.setName('m')
          .setDescription('Méthode de paiement')
          .setRequired(true)
          .addChoices(
            { name: 'Revolut', value: 'revolut' },
            { name: 'Roblox (gamepass)', value: 'roblox' },
          )
      )
      .addStringOption(opt =>
        opt.setName('l')
          .setDescription('Lien du gamepass (requis pour Roblox)')
          .setRequired(false)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName('assign')
      .setDescription('Créer ou mettre à jour le salon dev pour un contrat')
      .addStringOption(opt =>
        opt.setName('id_contrat')
          .setDescription('ID du salon contrat (laisse vide pour utiliser le salon actuel)')
          .setRequired(false)
      )
      .addUserOption(opt => opt.setName('p1').setDescription('Dev 1').setRequired(false))
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

// Répond à une interaction de manière sûre, même si elle a déjà été deferred/replied.
async function safeErrorReply(interaction) {
  const msg = '❌ Une erreur est survenue. Réessaie, et si ça persiste préviens le staff.';
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content: msg, ephemeral: true });
    } else if (interaction.isRepliable?.()) {
      await interaction.reply({ content: msg, ephemeral: true });
    }
  } catch {}
}

client.on('interactionCreate', async (interaction) => {
 try {

  // ── /contrats ────────────────────────────────────────────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'contrats') {
    if (!interaction.member?.roles?.cache?.has(CONFIG.SECRETAIRE_ROLE_ID)) {
      await interaction.reply({ content: '❌ Commande réservée aux secrétaires.', ephemeral: true }); return;
    }
    await interaction.deferReply({ ephemeral: true });
    const guild   = interaction.guild;
    const tickets = [];
    for (const [channelId, info] of ticketInfos.entries()) {
      const channel = guild.channels.cache.get(channelId);
      if (!channel) continue;
      if (!info || info.num === undefined || info.nom === undefined) continue;
      const etapeIndex = ticketEtapes.get(channelId) ?? 0;
      if (etapeIndex === -1) continue;
      const etape = CONFIG.ETAPES[etapeIndex];
      if (!etape) continue; // entrée corrompue : on l'ignore au lieu de planter
      tickets.push(`${etape.label} — **#${padNum(info.num)} ${info.nom}** — <@${info.clientId}> — ${channel}`);
    }
    if (tickets.length === 0) {
      await interaction.editReply({ content: '📭 Aucun contrat en cours.' });
      return;
    }
    // La description d'un embed est limitée à 4096 caractères : on tronque proprement.
    let desc = tickets.join('\n');
    if (desc.length > 4000) desc = desc.slice(0, 4000) + `\n… et d'autres (liste trop longue)`;
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setTitle('📋 Contrats en cours — HEO Studio')
        .setColor(0x5865F2)
        .setDescription(desc)
        .setFooter({ text: `${tickets.length} contrat(s) actif(s)` })
        .setTimestamp()],
    });
    return;
  }

  // ── /next et /back (équivalents des boutons ➡️ / ◀️) ──────────────────────────
  if (interaction.isChatInputCommand() && (interaction.commandName === 'next' || interaction.commandName === 'back')) {
    await changerEtape(interaction, interaction.commandName === 'next' ? 'next' : 'back');
    return;
  }

  // ── /debug : affiche les dernières erreurs (staff) ────────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'debug') {
    if (!isStaffOrAdmin(interaction.member)) {
      await interaction.reply({ content: '❌ Réservé au staff.', ephemeral: true }); return;
    }
    if (errorLog.length === 0) {
      await interaction.reply({ content: '✅ Aucune erreur enregistrée. 🎉', ephemeral: true }); return;
    }
    const lignes = errorLog.slice(-15).reverse().map(e =>
      `<t:${Math.floor(e.t / 1000)}:R> — **${e.c}**\n\`\`\`${String(e.m).slice(0, 300)}\`\`\``
    );
    let desc = lignes.join('\n');
    if (desc.length > 4000) desc = desc.slice(0, 4000) + '\n…';
    await interaction.reply({
      embeds: [new EmbedBuilder()
        .setTitle(`🐞 Dernières erreurs (${errorLog.length} au total)`)
        .setColor(0xED4245)
        .setDescription(desc)
        .setFooter({ text: 'Copie-colle ça pour le partager' })
        .setTimestamp()],
      ephemeral: true,
    });
    return;
  }

  // ── /paiement ─────────────────────────────────────────────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'paiement') {
    if (!isStaffOrAdmin(interaction.member)) {
      await interaction.reply({ content: '❌ Réservé au staff.', ephemeral: true }); return;
    }
    const methode = interaction.options.getString('m');
    const lien    = interaction.options.getString('l');

    if (methode === 'revolut') {
      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setTitle('💳 Paiement par Revolut')
          .setColor(0x5865F2)
          .setDescription(
            'Pour régler ton contrat :\n\n' +
            '**1.** Rends-toi sur 👉 https://revolut.me/heostudio\n' +
            '**2.** Tu peux payer par **carte bancaire**, **Revolut** ou **Apple Pay**.\n' +
            '**3.** Entre **exactement la somme convenue**.\n' +
            '**4.** Effectue le paiement, puis **envoie une capture d\'écran ici** pour confirmer. ✅'
          )
          .setFooter({ text: 'HEO Studio • Paiement' })],
      });
      return;
    }

    if (methode === 'roblox') {
      if (!lien) {
        await interaction.reply({ content: '⚠️ Pour Roblox, ajoute le lien du gamepass : `/paiement m:roblox l:<lien>`.', ephemeral: true }); return;
      }
      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setTitle('🎮 Paiement par Roblox (Gamepass)')
          .setColor(0x57F287)
          .setDescription(
            'Pour régler ton contrat :\n\n' +
            `**1.** Ouvre le gamepass 👉 ${lien}\n` +
            '**2.** Achète-le au **montant convenu**.\n' +
            '**3.** Envoie une **preuve de paiement** ici pour confirmer. ✅'
          )
          .setFooter({ text: 'HEO Studio • Paiement' })],
      });
      return;
    }
    return;
  }

  // ── /assign ──────────────────────────────────────────────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'assign') {
    if (!isStaffOrAdmin(interaction.member)) {
      await interaction.reply({ content: '❌ Réservé au staff.', ephemeral: true }); return;
    }
    await interaction.deferReply({ ephemeral: true });

    // ID fourni, sinon on prend le salon où la commande est lancée.
    const contratChannelId = interaction.options.getString('id_contrat') || interaction.channelId;
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
    const vusDev   = new Set();
    for (const key of ['p1', 'p2', 'p3', 'p4', 'p5']) {
      const u = interaction.options.getUser(key);
      if (u && !vusDev.has(u.id)) { vusDev.add(u.id); devUsers.push(u); }
    }
    if (devUsers.length === 0) {
      await interaction.editReply({ content: '⚠️ Indique au moins un développeur (option `p1`).' }); return;
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
      // Remplace toutes les permissions en UNE fois (atomique : aucun instant de visibilité).
      await devChannel.permissionOverwrites.set([
        { id: guild.roles.everyone,      deny:  [PermissionFlagsBits.ViewChannel] },
        { id: CONFIG.STAFF_ROLE_ID,      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] },
        { id: CONFIG.SECRETAIRE_ROLE_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] },
        ...devUsers.map(u => ({
          id: u.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
        })),
      ]).catch(() => {});
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
      updateDashboard(guild);

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
      updateDashboard(guild);

      await interaction.editReply({ content: `✅ Salon ${devChannel} créé pour le contrat #${numStr} avec ${devUsers.length} dev(s).` });
    }
    return;
  }

  // ── /contrat : ouvre le formulaire de création ────────────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'contrat') {
    await interaction.showModal(buildContratModal());
    return;
  }

  // ── Créer un contrat (bouton du panneau) ──────────────────────────────────────
  if (interaction.isButton() && interaction.customId === 'creer_contrat') {
    await interaction.showModal(buildContratModal());
    return;
  }

  // ── Modifier un contrat (secrétaire uniquement) ───────────────────────────────
  if (interaction.isButton() && interaction.customId === 'modifier_contrat') {
    if (!interaction.member?.roles?.cache?.has(CONFIG.SECRETAIRE_ROLE_ID)) {
      await interaction.reply({ content: '❌ Seuls les secrétaires peuvent modifier un contrat.', ephemeral: true }); return;
    }
    const info = ticketInfos.get(interaction.channel.id);
    if (!info) {
      await interaction.reply({ content: '⚠️ Ce salon n\'est pas un contrat reconnu par le bot.', ephemeral: true }); return;
    }
    const delaiVal = (info.delai && info.delai !== 'Non précisé') ? String(info.delai).slice(0, 100) : '';
    const modal = new ModalBuilder().setCustomId('modal_modifier').setTitle('Modifier le contrat').addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('nom_projet').setLabel('Nom du projet').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100).setValue(String(info.nom ?? '').slice(0, 100))),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('description').setLabel('Description du projet').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000).setValue(String(info.description ?? '').slice(0, 1000))),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('prix').setLabel('Prix (coût convenu)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100).setValue(String(info.budget ?? '').slice(0, 100))),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('delai').setLabel('Délai').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(100).setValue(delaiVal)),
    );
    await interaction.showModal(modal);
    return;
  }

  // ── Modal modification soumis ─────────────────────────────────────────────────
  if (interaction.isModalSubmit() && interaction.customId === 'modal_modifier') {
    await interaction.deferReply({ ephemeral: true });
    const channel = interaction.channel;
    const info    = ticketInfos.get(channel.id);
    if (!info) {
      await interaction.editReply({ content: '⚠️ Contrat introuvable.' }); return;
    }
    info.nom         = interaction.fields.getTextInputValue('nom_projet');
    info.description = interaction.fields.getTextInputValue('description');
    info.budget      = interaction.fields.getTextInputValue('prix');
    info.delai       = interaction.fields.getTextInputValue('delai') || 'Non précisé';
    info.priceConfirmed = true; // le champ « Budget » devient « Prix »
    saveTickets();

    const etapeIndex  = ticketEtapes.get(channel.id) ?? info.etapeIndex ?? 0;
    const contractMsg = await getContractMessage(channel, info);
    if (contractMsg && etapeIndex !== -1) {
      await contractMsg.edit({
        embeds: [buildEmbed(info.num, info.nom, info.description, info.budget, info.delai, { id: info.clientId }, etapeIndex, prixLabel(info))],
        components: [buildStaffRow(etapeIndex)],
      }).catch(() => {});
    }
    await logAction(interaction.guild, `✏️ Contrat **#${padNum(info.num)} — ${info.nom}** modifié par <@${interaction.user.id}> (prix : ${info.budget})`, 0x5865F2);
    updateDashboard(interaction.guild);
    await interaction.editReply({ content: '✅ Contrat mis à jour.' });
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

    // Verrou anti double-clic.
    if (enCreationContrat.has(user.id)) {
      await interaction.editReply({ content: '⏳ Ta demande est déjà en cours de création, patiente un instant.' }); return;
    }
    enCreationContrat.add(user.id);
    try {

    // 1 seul contrat actif par client (on ignore les annulés et les terminés).
    for (const [chId, info] of ticketInfos.entries()) {
      if (info.clientId !== user.id) continue;
      const etapeIdx = ticketEtapes.get(chId) ?? 0;
      const estActif = etapeIdx !== -1 && CONFIG.ETAPES[etapeIdx]?.id !== 'TERMINE';
      if (!estActif) continue;
      const existingCh = guild.channels.cache.get(chId);
      if (existingCh) {
        await interaction.editReply({ content: `❌ Tu as déjà un contrat en cours : ${existingCh}\nTermine-le ou attends qu'il soit clôturé avant d'en ouvrir un nouveau.` });
        return;
      }
      // Salon disparu : entrée orpheline, on nettoie.
      ticketInfos.delete(chId);
      ticketEtapes.delete(chId);
      saveTickets();
    }

    const ticketChannel = await guild.channels.create({
      name: 'contrat',
      type: ChannelType.GuildText,
      parent: CONFIG.CATEGORIES.NEGOCIATION,
      permissionOverwrites: [
        { id: guild.roles.everyone,      deny:  [PermissionFlagsBits.ViewChannel] },
        { id: user.id,                   allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
        { id: CONFIG.STAFF_ROLE_ID,      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] },
        { id: CONFIG.SECRETAIRE_ROLE_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] },
      ],
    });

    // L'identifiant du contrat = l'ID Discord du salon (unique, plus de numéro à 4 chiffres).
    // Le bot ne connaît l'ID qu'après la création, d'où le renommage ici.
    const num = ticketChannel.id;
    // Renommage avec une 2e tentative : les renommages Discord sont limités en débit
    // et échouaient parfois silencieusement (le salon restait nommé « contrat »).
    try {
      await ticketChannel.setName(`contrat-${num}`);
    } catch (e1) {
      console.error('⚠️ rename contrat (tentative 1):', e1?.message || e1);
      await new Promise(r => setTimeout(r, 2500));
      await ticketChannel.setName(`contrat-${num}`).catch(e2 => console.error('⚠️ rename contrat (échec):', e2?.message || e2));
    }

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
    await logAction(guild, `🆕 Contrat **${nomProjet}** créé par <@${user.id}> — ${ticketChannel}`, 0x57F287);
    updateDashboard(guild);

    await interaction.editReply({ content: `✅ Ton ticket a été créé : ${ticketChannel}` });
    } finally {
      enCreationContrat.delete(user.id);
    }
    return;
  }

  // ── Étape précédente ──────────────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === 'etape_precedente') {
    await changerEtape(interaction, 'back');
    return;
  }

  // ── Étape suivante ────────────────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === 'etape_suivante') {
    await changerEtape(interaction, 'next');
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
    if (!isStaffOrAdmin(interaction.member)) {
      await interaction.reply({ content: '❌ Réservé au staff.', ephemeral: true }); return;
    }
    await interaction.deferUpdate();
    const contratChannelId = interaction.customId.replace('confirmer_annulation_', '');
    const channel = await interaction.guild.channels.fetch(contratChannelId).catch(() => null);
    if (!channel) { console.error('confirmer_annulation: salon introuvable', contratChannelId); return; }
    const etapeActuelle = ticketEtapes.get(channel.id) ?? 0;
    const info          = ticketInfos.get(channel.id);
    if (!info) {
      await interaction.followUp({ content: '⚠️ Ce contrat n\'est plus reconnu par le bot (données perdues après un redémarrage). Tu peux supprimer ce salon manuellement.', ephemeral: true }); return;
    }
    info.etapeAvantAnnulation = etapeActuelle;
    info.etapeIndex = -1;
    saveTickets();
    await channel.setParent(CONFIG.CATEGORIES.ANNULE, { lockPermissions: false }).catch(() => {});
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
        { name: '👤 Client', value: `<@${info.clientId}>`,    inline: true },
        { name: prixLabel(info), value: clip(info.budget, 256), inline: true },
        { name: '⏱️ Délai',  value: clip(info.delai, 256),     inline: true },
        { name: '📝 Description', value: clip(info.description), inline: false },
      )
      .setFooter({ text: 'HEO Studio • ❌ Contrat annulé' })
      .setTimestamp();

    const contractMsg = await getContractMessage(channel, info);
    if (contractMsg) {
      await contractMsg.edit({ embeds: [updatedEmbed], components: [buildStaffRow(0, true)] });
    }
    await channel.send({ embeds: [new EmbedBuilder().setColor(0xED4245).setDescription(`❌ Contrat **annulé** par <@${interaction.user.id}>`)] });
    await logAction(interaction.guild, `🚫 Contrat **#${padNum(info.num)} — ${info.nom}** annulé par <@${interaction.user.id}>`, 0xED4245);
    updateDashboard(interaction.guild);
    return;
  }

  // ── Désannuler contrat ────────────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === 'desannuler_contrat') {
    if (!isStaffOrAdmin(interaction.member)) {
      await interaction.reply({ content: '❌ Réservé au staff.', ephemeral: true }); return;
    }
    const channel     = interaction.channel;
    const info        = ticketInfos.get(channel.id);
    if (!info) {
      await interaction.reply({ content: '⚠️ Ce contrat n\'est plus reconnu par le bot (données perdues après un redémarrage).', ephemeral: true }); return;
    }
    await interaction.deferUpdate();
    const etapeRetour = info?.etapeAvantAnnulation ?? 0;
    await channel.setParent(CONFIG.CATEGORIES[CONFIG.ETAPES[etapeRetour].id], { lockPermissions: false }).catch(() => {});
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

    const baseEmbed = interaction.message.embeds?.[0]
      ? EmbedBuilder.from(interaction.message.embeds[0])
      : buildEmbed(info.num, info.nom, info.description, info.budget, info.delai, { id: info.clientId }, etapeRetour, prixLabel(info));
    const restoredEmbed = baseEmbed
      .setColor(etape.color)
      .setFooter({ text: `HEO Studio • Étape : ${etape.label}` });
    await interaction.message.edit({ embeds: [restoredEmbed], components: [buildStaffRow(etapeRetour)] });
    await channel.send({ embeds: [new EmbedBuilder().setColor(etape.color).setDescription(`↩️ Contrat **désannulé** par <@${interaction.user.id}>\nRetour à l'étape : **${etape.label}**`)] });
    await logAction(interaction.guild, `↩️ Contrat **#${padNum(info.num)} — ${info.nom}** désannulé par <@${interaction.user.id}> → **${etape.label}**`, etape.color);
    updateDashboard(interaction.guild);
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
    if (!isStaffOrAdmin(interaction.member)) {
      await interaction.reply({ content: '❌ Réservé au staff.', ephemeral: true }); return;
    }
    const contratChannelId = interaction.customId.replace('confirmer_suppression_', '');
    const channel = await interaction.guild.channels.fetch(contratChannelId).catch(() => null);
    if (!channel) return;
    const info = ticketInfos.get(channel.id);
    const guild = interaction.guild;

    // On accuse réception TOUT DE SUITE (le transcript peut être lent → éviter l'expiration des 3 s).
    await interaction.reply({ content: '🗑️ Suppression en cours... (un transcript est sauvegardé)', ephemeral: true });

    ticketEtapes.delete(channel.id);
    ticketInfos.delete(channel.id);
    saveTickets();
    updateDashboard(guild);
    await logAction(guild, `🗑️ Contrat **#${padNum(info?.num ?? channel.id)} — ${info?.nom ?? channel.name}** supprimé par <@${interaction.user.id}>`, 0xED4245);

    const devChannel = await getDevChannel(guild, info);
    if (devChannel) await archiveAndDelete(devChannel, guild, 'dev');
    setTimeout(() => archiveAndDelete(channel, guild, 'contrat'), 2000);
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
    if (!isStaffOrAdmin(interaction.member)) {
      await interaction.reply({ content: '❌ Réservé au staff.', ephemeral: true }); return;
    }
    const devChannel = interaction.channel;

    // Trouver le contrat associé à ce salon dev et retirer le devChannelId
    for (const [contratChannelId, info] of ticketInfos.entries()) {
      if (info.devChannelId === devChannel.id) {
        info.devChannelId = null;
        saveTickets();
        break;
      }
    }

    const guild = interaction.guild;
    await logAction(guild, `🗑️ Salon dev \`${devChannel.name}\` supprimé par <@${interaction.user.id}>`, 0xED4245);
    await interaction.reply({ content: '🗑️ Suppression du salon dev en cours... (un transcript est sauvegardé)', ephemeral: true });
    setTimeout(() => archiveAndDelete(devChannel, guild, 'dev'), 2000);
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
        new TextInputBuilder().setCustomId('type_dev').setLabel('Type de développeur').setStyle(TextInputStyle.Short).setPlaceholder('UI, Builder, Animateur, Scripteur, Modélisateur, Designer').setRequired(true).setMaxLength(100)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('disponibilite').setLabel('Disponibilité (jours / horaires)').setStyle(TextInputStyle.Short).setPlaceholder('Ex: Lun-Ven 18h-22h, Week-end toute la journée...').setRequired(true).setMaxLength(300)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('paiement').setLabel('Type de paiement souhaité').setStyle(TextInputStyle.Short).setPlaceholder('Ex: Robux, €, % sur projet...').setRequired(true).setMaxLength(200)
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

    // Verrou anti double-clic.
    if (enCreationRecrut.has(user.id)) {
      await interaction.editReply({ content: '⏳ Ta candidature est déjà en cours de création, patiente un instant.' }); return;
    }
    enCreationRecrut.add(user.id);
    try {

    // Cooldown : pas de nouvelle candidature dans le mois suivant un refus.
    const dernierRefus = refusCooldowns.get(user.id);
    if (dernierRefus && (Date.now() - dernierRefus) < REFUS_COOLDOWN_MS) {
      const dispoLe = Math.floor((dernierRefus + REFUS_COOLDOWN_MS) / 1000);
      await interaction.editReply({ content: `❌ Ta candidature a été refusée récemment. Tu pourras repostuler <t:${dispoLe}:R> (le <t:${dispoLe}:D>).` });
      return;
    }

    // Anti-doublon : une seule candidature ouverte par personne (état persistant).
    for (const [chId, rec] of recruitInfos.entries()) {
      if (rec.candidateId === user.id) {
        const existingCh = guild.channels.cache.get(chId);
        if (existingCh) {
          await interaction.editReply({ content: `❌ Tu as déjà une candidature ouverte : ${existingCh}` }); return;
        }
        // Le salon n'existe plus : on nettoie l'entrée orpheline.
        recruitInfos.delete(chId);
        saveRecruits();
      }
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

    // Mémorise le candidat dès l'ouverture (plus besoin de relire l'embed plus tard).
    recruitInfos.set(ticketChannel.id, { candidateId: user.id, typeDev, disponibilite, paiement });
    saveRecruits();

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
        new ButtonBuilder().setCustomId('recrut_entretien').setLabel('🎤 Entretien').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('recrut_refuser').setLabel('❌ Refuser').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('recrut_supprimer').setLabel('🗑️ Supprimer').setStyle(ButtonStyle.Secondary),
      )],
    });

    await ticketChannel.send({
      content: `📂 <@${user.id}>`,
      embeds: [new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('📂 Montre-nous tes réalisations')
        .setDescription(
          'Pour évaluer ton niveau, envoie ici tes **réalisations** : images, vidéos, liens (portfolio, jeux Roblox, modèles 3D, scripts...).\n\n' +
          'Plus tu en montres, mieux on pourra juger ton profil. 😉'
        )
        .setFooter({ text: 'HEO Studio • Recrutement' })],
    }).catch(() => {});

    await logAction(guild, `📩 Nouvelle candidature de <@${user.id}> (${typeDev}) — ${ticketChannel}`, 0x5865F2);
    await interaction.editReply({ content: `✅ Ta candidature a été ouverte : ${ticketChannel}` });
    } finally {
      enCreationRecrut.delete(user.id);
    }
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
    if (!isStaffOrAdmin(interaction.member)) {
      await interaction.reply({ content: '❌ Réservé au staff.', ephemeral: true }); return;
    }
    const channelId = interaction.customId.replace('recrut_confirmer_suppression_', '');
    const channel   = await interaction.guild.channels.fetch(channelId).catch(() => null);
    if (!channel) return;
    const guild = interaction.guild;
    recruitInfos.delete(channelId);
    saveRecruits();
    await logAction(guild, `🗑️ Candidature \`${channel.name}\` supprimée par <@${interaction.user.id}>`, 0xED4245);
    await interaction.reply({ content: '🗑️ Suppression en cours... (un transcript est sauvegardé)', ephemeral: true });
    setTimeout(() => archiveAndDelete(channel, guild, 'recrutement'), 2000);
    return;
  }

  // ── Entretien : portfolio insuffisant → entretien oral ───────────────────────
  if (interaction.isButton() && interaction.customId === 'recrut_entretien') {
    if (!isStaffOrAdmin(interaction.member)) {
      await interaction.reply({ content: '❌ Réservé au staff.', ephemeral: true }); return;
    }
    const channel = interaction.channel;

    // Retrouve le candidat (mémorisé à l'ouverture, repli sur l'embed sinon).
    let candidateId = recruitInfos.get(channel.id)?.candidateId;
    if (!candidateId) {
      const messages = await channel.messages.fetch({ limit: 50 });
      const embedMsg = messages.find(m => m.author.id === client.user.id && m.embeds?.[0]?.title?.startsWith('📩 Candidature'));
      candidateId = embedMsg?.embeds?.[0]?.fields?.find(f => f.name === '👤 Candidat')?.value?.replace(/[<@>]/g, '');
    }
    if (!candidateId) {
      await interaction.reply({ content: '❌ Impossible de retrouver le candidat.', ephemeral: true }); return;
    }
    await interaction.deferReply({ ephemeral: true });

    // Ajoute le rôle « en attente d'entretien » au candidat.
    const candidateMember = await interaction.guild.members.fetch(candidateId).catch(() => null);
    if (candidateMember) {
      await candidateMember.roles.add(CONFIG.ROLE_ATT_ENTRETIEN).catch(() => {});
    }

    await interaction.editReply({ content: '✅ Entretien proposé au candidat.' });
    await channel.send({
      content: `🎤 <@${candidateId}>`,
      embeds: [new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('🎤 Entretien oral requis')
        .setDescription(
          `Bonjour <@${candidateId}>,\n\n` +
          'Ton portfolio ne nous permet pas encore de statuer sur ta candidature. ' +
          'Nous te proposons donc un **entretien oral avec un secrétaire** afin de mieux évaluer ton profil.\n\n' +
          '🔔 Tu seras **pingé ici même** au moment de l\'entretien. Merci de rester disponible et de surveiller ce salon !'
        )
        .setFooter({ text: 'HEO Studio • Recrutement' })
        .setTimestamp()],
    });
    await logAction(interaction.guild, `🎤 Entretien proposé à <@${candidateId}> par <@${interaction.user.id}> — ${channel}`, 0x5865F2);
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

    // Démarre le cooldown anti re-candidature (1 mois) pour ce candidat.
    const refusedId = recruitInfos.get(channel.id)?.candidateId;
    if (refusedId) {
      refusCooldowns.set(refusedId, Date.now());
      saveCooldowns();
    }
    recruitInfos.delete(channel.id);
    saveRecruits();

    await channel.send({
      embeds: [new EmbedBuilder()
        .setColor(0xED4245)
        .setDescription(`❌ Candidature **refusée** par <@${interaction.user.id}>`)
        .setTimestamp()],
    });
    await logAction(interaction.guild, `❌ Candidature \`${channel.name}\` refusée par <@${interaction.user.id}>${refusedId ? ` (candidat <@${refusedId}>, cooldown 1 mois)` : ''}`, 0xED4245);
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
    const existing = recruitInfos.get(channel.id) ?? {};
    existing.types = interaction.values;
    recruitInfos.set(channel.id, existing);
    saveRecruits();
    await interaction.deferUpdate();
    return;
  }

  // ── Valider types → sélecteur étoiles ────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === 'recrut_types_valider') {
    if (!isStaffOrAdmin(interaction.member)) {
      await interaction.reply({ content: '❌ Réservé au staff.', ephemeral: true }); return;
    }
    const channel = interaction.channel;
    const pending = recruitInfos.get(channel.id);
    if (!pending?.types?.length) {
      await interaction.reply({ content: '⚠️ Sélectionne au moins un type de dev.', ephemeral: true }); return;
    }
    await interaction.deferUpdate();
    await interaction.message.delete().catch(() => {});

    // Une rangée de sélection par type retenu.
    const selectRows = pending.types.map((type) => {
      const label = DEV_TYPE_ICONS[type] ?? type;
      return new ActionRowBuilder().addComponents(
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
      );
    });

    const etape2Embed = new EmbedBuilder()
      .setTitle('✅ Candidature acceptée — Étape 2/2')
      .setDescription(`Types retenus : **${pending.types.map(t => DEV_TYPE_ICONS[t] ?? t).join(', ')}**\n\nChoisis le **niveau (étoiles)** pour chaque type.`)
      .setColor(0x57F287);

    // Discord limite à 5 rangées par message : on envoie les menus par paquets de 5,
    // puis le bouton de confirmation dans un message séparé.
    for (let i = 0; i < selectRows.length; i += 5) {
      const chunk = selectRows.slice(i, i + 5);
      await channel.send({ ...(i === 0 ? { embeds: [etape2Embed] } : {}), components: chunk });
    }
    await channel.send({
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('recrut_etoiles_valider').setLabel('✅ Confirmer et attribuer les rôles').setStyle(ButtonStyle.Success),
      )],
    });
    return;
  }

  // ── Select : étoiles par type ─────────────────────────────────────────────────
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith('recrut_etoiles_')) {
    const type    = interaction.customId.replace('recrut_etoiles_', '');
    const channel = interaction.channel;
    const pending = recruitInfos.get(channel.id) ?? {};
    if (!pending.etoiles) pending.etoiles = {};
    pending.etoiles[type] = interaction.values[0];
    recruitInfos.set(channel.id, pending);
    saveRecruits();
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
    const pending = recruitInfos.get(channel.id);

    if (!pending?.types?.length || !pending?.etoiles) {
      await interaction.followUp({ content: '⚠️ Données manquantes, recommence.', ephemeral: true }); return;
    }
    for (const type of pending.types) {
      if (pending.etoiles[type] === undefined) {
        await interaction.followUp({ content: `⚠️ Tu n'as pas choisi le niveau pour **${DEV_TYPE_ICONS[type] ?? type}**.`, ephemeral: true }); return;
      }
    }

    // Candidat mémorisé à l'ouverture (avec repli sur l'embed si jamais absent).
    let candidateId = pending.candidateId;
    if (!candidateId) {
      const messages = await channel.messages.fetch({ limit: 50 });
      const embedMsg = messages.find(m => m.author.id === client.user.id && m.embeds?.[0]?.title?.startsWith('📩 Candidature'));
      candidateId = embedMsg?.embeds?.[0]?.fields?.find(f => f.name === '👤 Candidat')?.value?.replace(/[<@>]/g, '');
    }
    if (!candidateId) {
      await interaction.followUp({ content: '❌ Impossible de retrouver le candidat.', ephemeral: true }); return;
    }

    const guild           = interaction.guild;
    const candidateMember = await guild.members.fetch(candidateId).catch(() => null);
    if (!candidateMember) {
      await interaction.followUp({ content: '❌ Le membre a quitté le serveur.', ephemeral: true }); return;
    }

    const rolesAdded  = [];
    const rolesFailed = [];
    // Ajoute un rôle en notant s'il a échoué (souvent : rôle du bot trop bas dans la hiérarchie).
    const tryAddRole = async (roleId) => {
      try { await candidateMember.roles.add(roleId); rolesAdded.push(`<@&${roleId}>`); }
      catch { rolesFailed.push(`<@&${roleId}>`); }
    };

    if (candidateMember.roles.cache.has(CONFIG.ROLE_ATT_ENTRETIEN)) {
      await candidateMember.roles.remove(CONFIG.ROLE_ATT_ENTRETIEN).catch(() => {});
    }
    await tryAddRole(CONFIG.ROLE_DEV_GLOBAL);
    await tryAddRole(CONFIG.ROLE_SEPARATION);

    for (const type of pending.types) {
      const typeRoleId = CONFIG.DEV_ROLES[type];
      const starIndex  = parseInt(pending.etoiles[type], 10);
      const starRoleId = CONFIG.ETOILES_ROLES[type]?.[starIndex];
      if (typeRoleId) await tryAddRole(typeRoleId);
      if (starRoleId) await tryAddRole(starRoleId);
    }

    recruitInfos.delete(channel.id);
    saveRecruits();
    await interaction.message.delete().catch(() => {});

    const typesLabel = pending.types.map(t => {
      const starIndex = parseInt(pending.etoiles[t], 10);
      const stars     = '⭐'.repeat(5 - starIndex);
      return `${DEV_TYPE_ICONS[t] ?? t} — ${stars}`;
    }).join('\n');

    const acceptEmbed = new EmbedBuilder()
      .setTitle('🎉 Candidature acceptée !')
      .setColor(0x57F287)
      .setDescription(`Bienvenue dans l'équipe **HEO Studio** <@${candidateId}> !\nRôles attribués par <@${interaction.user.id}>.`)
      .addFields(
        { name: '🛠️ Types & niveaux', value: typesLabel || '*Aucun*',                 inline: false },
        { name: '🏷️ Rôles ajoutés',   value: rolesAdded.join('\n') || '*Aucun*',       inline: false },
      )
      .setFooter({ text: 'HEO Studio • Recrutement' })
      .setTimestamp();
    // Alerte si certains rôles n'ont pas pu être attribués (hiérarchie du bot, etc.).
    if (rolesFailed.length) {
      acceptEmbed.addFields({ name: '⚠️ Rôles NON attribués', value: `${rolesFailed.join('\n')}\n\n> Vérifie que le rôle du bot est **au-dessus** de ces rôles dans les paramètres du serveur, puis réattribue-les à la main.`, inline: false });
    }
    await channel.send({ content: `🎉 <@${candidateId}>`, embeds: [acceptEmbed] });

    await logAction(interaction.guild, `🎉 <@${candidateId}> accepté par <@${interaction.user.id}> — ${pending.types.map(t => DEV_TYPE_ICONS[t] ?? t).join(', ')}${rolesFailed.length ? ' ⚠️ (certains rôles non attribués)' : ''}`, 0x57F287);

    // Renommer avec préfixe 🟢 et déplacer dans recrutement terminé
    const newName = `🟢-${channel.name.replace(/^🟢-/, '')}`;
    await channel.setName(newName).catch(() => {});
    await channel.setParent(CONFIG.RECRUTEMENT_TERMINE_ID, { lockPermissions: false }).catch(() => {});
    planifierAnnuaire(guild);
    return;
  }

 } catch (err) {
    logError('interactionCreate', err);
    await safeErrorReply(interaction);
  }
});

client.login(CONFIG.TOKEN);
