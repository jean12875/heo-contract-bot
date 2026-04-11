const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
  PermissionsBitField
} = require("discord.js");
const { getConfig } = require("./config");
const { db } = require("./db");
const { safeDeferReply, safeReply, safeShowModal } = require("./interaction");
const { buildStudioEmbed, block, palette } = require("./ui");
const { logInfo, logError } = require("./logger");

const contractLocks = new Set();
const channelViewPerms = [
  PermissionsBitField.Flags.ViewChannel,
  PermissionsBitField.Flags.SendMessages,
  PermissionsBitField.Flags.ReadMessageHistory
];
const categoryViewPerms = [PermissionsBitField.Flags.ViewChannel];
const stageCategoryPrefixes = {
  1: "1️⃣",
  2: "2️⃣",
  3: "3️⃣",
  4: "4️⃣",
  5: "5️⃣",
  6: "5️⃣",
  7: "✅"
};
const cancelPrefix = "🛑";

function uniq(values) {
  return [...new Set(values.filter(Boolean).map((value) => String(value)))];
}

function hasContractPermission(member) {
  if (!member) return false;
  const config = getConfig();
  const allowedRoles = uniq([
    config.roles.owner,
    config.roles.admin,
    config.roles.gestionTicket,
    config.roles.secretaire
  ]);
  return member.roles.cache.some((role) => allowedRoles.includes(role.id));
}

function hasOwnerPermission(member) {
  if (!member) return false;
  const config = getConfig();
  const allowedRoles = uniq([config.roles.owner, config.roles.admin]);
  return member.roles.cache.some((role) => allowedRoles.includes(role.id));
}

function sanitizeDisplayName(value, fallback = "contrat", limit = 90) {
  const text = String(value || fallback)
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, limit) || fallback;
}

function sanitizeChannelLabel(value, fallback = "salon", limit = 82) {
  const normalized = String(value || fallback)
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[^a-z0-9\u00C0-\u024F\s_-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, limit);

  return normalized || fallback;
}

function withCancelPrefix(name, cancelled) {
  if (!cancelled) return name;
  return name.startsWith(`${cancelPrefix}-`) ? name : `${cancelPrefix}-${name}`;
}

function withTimeout(promise, ms, fallback = null) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms))
  ]);
}

function serializePermissionBitfield(value) {
  return new PermissionsBitField(value || []).bitfield.toString();
}

function serializeOverwriteEntries(overwrites) {
  return (overwrites || [])
    .filter((overwrite) => overwrite?.id)
    .map((overwrite) => ({
      id: String(overwrite.id),
      allow: serializePermissionBitfield(overwrite.allow || []),
      deny: serializePermissionBitfield(overwrite.deny || [])
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function serializeOverwriteManager(manager) {
  return [...(manager?.cache?.values() || [])]
    .map((overwrite) => ({
      id: String(overwrite.id),
      allow: overwrite.allow.bitfield.toString(),
      deny: overwrite.deny.bitfield.toString()
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function overwritesMatch(manager, overwrites) {
  return JSON.stringify(serializeOverwriteManager(manager)) === JSON.stringify(serializeOverwriteEntries(overwrites));
}

function toSerializablePayloadValue(value) {
  if (!value) return value;
  if (typeof value.toJSON === "function") {
    return value.toJSON();
  }
  if (Array.isArray(value)) {
    return value.map((entry) => toSerializablePayloadValue(entry));
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, toSerializablePayloadValue(entry)])
    );
  }
  return value;
}

function buildPayloadSignature(payload) {
  return JSON.stringify({
    content: payload?.content ?? null,
    embeds: toSerializablePayloadValue(payload?.embeds || []),
    components: toSerializablePayloadValue(payload?.components || [])
  });
}

function createProgressTracker(interaction, title) {
  const steps = [];

  return {
    async step(label) {
      if (!label || steps[steps.length - 1] === label) {
        return;
      }

      steps.push(label);
      const lines = steps.map((entry, index) => `${index === steps.length - 1 ? "⏳" : "✅"} ${entry}`);
      await safeReply(interaction, {
        content: [`⌛ ${title}`, ...lines].join("\n")
      });
    }
  };
}

function getStageMeta(step) {
  const stages = {
    1: {
      categoryPrefix: stageCategoryPrefixes[1],
      categoryLabel: "negociation",
      label: "Négociation",
      clientTitle: "1️⃣ Contrat en négociation",
      clientDescription: "**CONTRAT OUVERT**\n\nLe secrétaire peut maintenant cadrer le besoin, le budget et les conditions et tout les besoins pour le developpemment avec le client.",
      clientStatus: "Négociation en cours"
    },
    2: {
      categoryPrefix: stageCategoryPrefixes[2],
      categoryLabel: "premier-paiement",
      label: "Attente du premier paiement",
      clientTitle: "2️⃣ Premier paiement en attente",
      clientDescription: "**DÉVELOPPEUR SÉLECTIONNÉ**\n\nUn développeur a été sélectionné pour votre projet.\n**En attente du premier paiement sans cela rien ne peut se lancer.**",
      clientStatus: "Attente du premier paiement",
      devTitle: "2️⃣ Ticket développeur ouvert",
      devDescription: "Le ticket technique est prêt, les developpeurs peuvent discuter entre eux ou avec les owner pour lancer et dev le projet.\nEn attente du premier paiement.",
      devStatus: "Attente du premier paiement"
    },
    3: {
      categoryPrefix: stageCategoryPrefixes[3],
      categoryLabel: "developpement",
      label: "Développement",
      clientTitle: "3️⃣ Développement en cours",
      clientDescription: "Premier paiement effectué, le développement peut commencer dès maintenant.",
      clientStatus: "Développement en cours",
      devTitle: "3️⃣ Développement lancé",
      devDescription: "Premier paiement effectué et le développement peut commencer.",
      devStatus: "Développement en cours"
    },
    4: {
      categoryPrefix: stageCategoryPrefixes[4],
      categoryLabel: "developpement-fini",
      label: "Attente du paiement final",
      clientTitle: "4️⃣ Développement terminé | projet pret",
      clientDescription: "**TRAVAIL TERMINÉ**\n\nLes développeurs ont validé la finition du jeu.\nLe jeu est prêt.\nMerci d'effectuer le second paiement pour recevoir votre projet.\nLe bouton de fermeture du ticket reste disponible en cas de besoin.\nSeuls les owners peuvent confirmer cette étape.",
      clientStatus: "Jeu terminé • Paiement final attendu",
      devTitle: "4️⃣ Travail terminé",
      devDescription: "Le travail est terminé maintenant c'est en attente du paiement final du client.",
      devStatus: "Attente du paiement final"
    },
    5: {
      categoryPrefix: stageCategoryPrefixes[5],
      categoryLabel: "paiement-developpeur",
      label: "Paiement développeur",
      clientTitle: "5️⃣ Paiement développeur en attente",
      clientDescription: "Le paiement final a été confirmé les developpeurs ont recu leur virementt si jamais merci de procéder au paiement du développeur.\nSeuls les owners peuvent confirmer cette étape.",
      clientStatus: "Paiement développeur en attente",
      devTitle: "5️⃣ Développeur à payer",
      devDescription: "Deuxième paiement effectué.",
      devStatus: "Paiement développeur en attente"
    },
    6: {
      categoryPrefix: stageCategoryPrefixes[6],
      categoryLabel: "paiement-secretaire",
      label: "Paiement secrétaire",
      clientTitle: "5️⃣ Paiement secrétaire en attente",
      clientDescription: "Le développeur a été payé maintenant en attente du paiement du secrétaire.",
      clientStatus: "Paiement secrétaire en attente",
      devTitle: "5️⃣ Développeur payé",
      devDescription: "Le développeur a été payé le paiement en attente restant et le paiement du secrétaire ayany gerer le ticket.",
      devStatus: "Paiement secrétaire en attente",
      secTitle: "5️⃣ Paiement secrétaire",
      secDescription: "En attente du paiement du secrétaire.",
      secStatus: "Paiement secrétaire en attente"
    },
    7: {
      categoryPrefix: stageCategoryPrefixes[7],
      categoryLabel: "termine",
      label: "Contrat clôturé",
      clientTitle: "✅ Contrat clôturé",
      clientDescription: "Le contrat est clôturé.",
      clientStatus: "Clôturé",
      devTitle: "✅ Contrat clôturé",
      devDescription: "Le contrat est clôturé.",
      devStatus: "Clôturé",
      secTitle: "✅ Secrétaire payé",
      secDescription: "Paiement du secrétaire effectué le contrat est donc clôturé.",
      secStatus: "Clôturé"
    }
  };

  return stages[step] || stages[1];
}

function getTicketRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("close_ticket").setLabel("Fermer").setEmoji("🔒").setStyle(ButtonStyle.Danger)
  );
}

function getCancelledRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("c_uncancel").setLabel("Désannuler").setEmoji("♻️").setStyle(ButtonStyle.Success)
  );
}

function getActionButtonForLocation(contract, location) {
  if (contract.cancelled) return null;

  if (location === "client") {
    if (contract.step === 1) {
      return new ButtonBuilder().setCustomId("c_next").setLabel("Choisir un développeur").setEmoji("🧑‍💻").setStyle(ButtonStyle.Primary);
    }
    if (contract.step === 2) {
      return new ButtonBuilder().setCustomId("c_next").setLabel("Premier paiement reçu").setEmoji("💳").setStyle(ButtonStyle.Success);
    }
    if (contract.step === 3) {
      return new ButtonBuilder().setCustomId("c_next").setLabel("Travail terminé").setEmoji("🧾").setStyle(ButtonStyle.Primary);
    }
    if (contract.step === 4) {
      return new ButtonBuilder().setCustomId("c_next").setLabel("Paiement final reçu").setEmoji("💰").setStyle(ButtonStyle.Success);
    }
    if (contract.step === 5) {
      return new ButtonBuilder().setCustomId("c_next").setLabel("Développeur payé").setEmoji("✅").setStyle(ButtonStyle.Success);
    }
  }

  if (location === "sec" && contract.step === 6) {
    return new ButtonBuilder().setCustomId("c_finish").setLabel("TERMINER").setEmoji("✅").setStyle(ButtonStyle.Success);
  }

  return null;
}

function canBack(contract) {
  return Array.isArray(contract.history) && contract.history.length > 0 && !contract.cancelled;
}

function buildActionRow(contract, location) {
  if (contract.cancelled) {
    return getCancelledRow();
  }

  const row = new ActionRowBuilder();
  const nextButton = getActionButtonForLocation(contract, location);
  if (nextButton) {
    row.addComponents(nextButton);
  }
  if (canBack(contract)) {
    row.addComponents(
      new ButtonBuilder().setCustomId("c_back").setLabel("Retour").setEmoji("🔙").setStyle(ButtonStyle.Secondary)
    );
  }
  row.addComponents(
    new ButtonBuilder().setCustomId("c_cancel").setLabel("Annuler").setEmoji("🛑").setStyle(ButtonStyle.Danger)
  );

  return row.components.length ? row : null;
}

function buildDeveloperChoiceModal(nonce) {
  const modal = new ModalBuilder().setCustomId(`modal_c_dev:${nonce}`).setTitle("Choisir un développeur");
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("devs")
        .setLabel("Développeur(s)")
        .setPlaceholder("@pseudo1, @pseudo2, pour les pseudos faites comme ceci <@userid> et séparez les par des virgules sinon je ne vais rien comprendre :(")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("infos")
        .setLabel("Informations supplémentaires")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
    )
  );
  return modal;
}

function generateNonce() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function buildCategoryName(contract) {
  const meta = getStageMeta(contract.step);
  const label = contract.cancelled ? "contrat-annule" : meta.categoryLabel || "contrat";
  const prefix = contract.cancelled ? cancelPrefix : meta.categoryPrefix;
  return `${prefix}-${sanitizeDisplayName(label, "contrat", 32)}-${sanitizeDisplayName(contract.nom || contract.clientName, "contrat", 40)}`;
}

function buildClientChannelName(contract) {
  const safeName = sanitizeChannelLabel(contract.clientName || contract.nom || "client", "client");
  const base = `${contract.step >= 5 ? "✅-" : ""}contrat-${safeName}`;
  return withCancelPrefix(base, contract.cancelled);
}

function buildDevChannelName(contract) {
  const base = contract.step >= 6 ? "✅🟡-dev" : "🟡-dev";
  return withCancelPrefix(base, contract.cancelled);
}

function buildSecretaryChannelName(contract, secretaryName) {
  const safeName = sanitizeChannelLabel(secretaryName || "secretaire", "secretaire");
  const base = `${contract.step >= 7 ? "✅" : ""}🟡🟡-${safeName}`;
  return withCancelPrefix(base, contract.cancelled);
}

function getConfiguredCategoryIds() {
  const config = getConfig();
  return uniq(Object.values(config.categories || {}));
}

function isConfiguredSharedCategory(categoryId) {
  if (!categoryId) return false;
  return getConfiguredCategoryIds().includes(String(categoryId));
}

function buildContractRecord({ nom, budget, delai, desc, clientId, clientName, categoryId, clientChanId }) {
  return {
    step: 1,
    nom,
    budget,
    delai,
    desc,
    client: clientId,
    clientName: clientName || "client",
    secretaire: null,
    devs: [],
    infos: "",
    categoryId,
    clientChan: clientChanId,
    devChan: null,
    secChan: null,
    cancelled: false,
    cancelSnapshot: null,
    history: [],
    devSelectionNonce: null,
    controlMessages: {
      client: null,
      dev: null,
      sec: null
    }
  };
}

function cloneContractState(contract) {
  return {
    step: contract.step,
    nom: contract.nom,
    budget: contract.budget,
    delai: contract.delai,
    desc: contract.desc,
    client: contract.client,
    clientName: contract.clientName || "client",
    secretaire: contract.secretaire,
    devs: [...(contract.devs || [])],
    infos: contract.infos || "",
    categoryId: contract.categoryId || null,
    categoryName: buildCategoryName(contract),
    clientChan: contract.clientChan || null,
    devChan: contract.devChan || null,
    secChan: contract.secChan || null
  };
}

function applyStateSnapshot(contract, snapshot) {
  contract.step = snapshot.step;
  contract.nom = snapshot.nom;
  contract.budget = snapshot.budget;
  contract.delai = snapshot.delai;
  contract.desc = snapshot.desc;
  contract.client = snapshot.client;
  contract.clientName = snapshot.clientName || "client";
  contract.secretaire = snapshot.secretaire;
  contract.devs = [...(snapshot.devs || [])];
  contract.infos = snapshot.infos || "";
  contract.categoryId = snapshot.categoryId || null;
  contract.categoryName = snapshot.categoryName || null;
  contract.clientChan = snapshot.clientChan || null;
  contract.devChan = snapshot.devChan || null;
  contract.secChan = snapshot.secChan || null;
  contract.cancelled = false;
  contract.devSelectionNonce = null;
}

function pushHistorySnapshot(contract) {
  if (!Array.isArray(contract.history)) {
    contract.history = [];
  }
  contract.history.push(cloneContractState(contract));
  if (contract.history.length > 20) {
    contract.history.shift();
  }
}

function ensureControlEntry(entry, fallbackChannelId = null) {
  if (!entry) return null;
  if (typeof entry === "string") {
    return { messageId: entry, channelId: fallbackChannelId, signature: null };
  }
  if (!entry.messageId) return null;
  return {
    messageId: entry.messageId,
    channelId: entry.channelId || fallbackChannelId || null,
    signature: entry.signature || null
  };
}

function ensureContractState(contract) {
  if (!Array.isArray(contract.devs)) {
    contract.devs = [];
  }
  if (!Array.isArray(contract.history)) {
    contract.history = [];
  }
  if (typeof contract.infos !== "string") {
    contract.infos = contract.infos ? String(contract.infos) : "";
  }
  if (typeof contract.clientName !== "string" || !contract.clientName.trim()) {
    contract.clientName = "client";
  }
  if (typeof contract.cancelled !== "boolean") {
    contract.cancelled = false;
  }
  if (!contract.controlMessages || typeof contract.controlMessages !== "object") {
    contract.controlMessages = {};
  }
  contract.controlMessages = {
    client: ensureControlEntry(contract.controlMessages.client, contract.clientChan || null),
    dev: ensureControlEntry(contract.controlMessages.dev, contract.devChan || null),
    sec: ensureControlEntry(contract.controlMessages.sec, contract.secChan || null)
  };
  if (typeof contract.devSelectionNonce === "undefined") {
    contract.devSelectionNonce = null;
  }
  if (typeof contract.cancelSnapshot === "undefined") {
    contract.cancelSnapshot = null;
  }
  if (typeof contract.categoryName === "undefined") {
    contract.categoryName = null;
  }
  return contract;
}

async function getContracts() {
  return (await db.get("contracts")) || {};
}

async function saveContract(key, contract) {
  ensureContractState(contract);
  await db.set(`contracts.${key}`, contract);
}

async function removeContract(key) {
  const contracts = await getContracts();
  delete contracts[key];
  await db.set("contracts", contracts);
}

async function fetchChannel(guild, channelId) {
  if (!channelId) return null;
  return guild.channels.cache.get(channelId) || (await withTimeout(guild.channels.fetch(channelId).catch(() => null), 2000, null));
}

async function resolvePermissionTarget(guild, targetId) {
  const id = targetId ? String(targetId) : null;
  if (!id) return null;
  return id;
}

async function resolvePermissionOverwrites(guild, overwrites) {
  const resolved = [];

  for (const overwrite of overwrites || []) {
    const targetId = await resolvePermissionTarget(guild, overwrite.id);
    if (!targetId) continue;
    resolved.push({
      id: targetId,
      allow: overwrite.allow || [],
      deny: overwrite.deny || []
    });
  }

  return resolved;
}

async function fetchContractChannels(guild, contract) {
  const category = await fetchChannel(guild, contract.categoryId);
  const clientChan = await fetchChannel(guild, contract.clientChan);
  const devChan = await fetchChannel(guild, contract.devChan);
  const secChan = await fetchChannel(guild, contract.secChan);

  return {
    category,
    clientChan,
    devChan,
    secChan
  };
}

function buildOverwriteEntries(entries) {
  const merged = new Map();

  for (const entry of entries.filter(Boolean)) {
    if (!entry.id) continue;
    const existing = merged.get(String(entry.id)) || {
      id: String(entry.id),
      allow: new Set(),
      deny: new Set()
    };

    for (const perm of entry.allow || []) {
      existing.allow.add(perm);
      existing.deny.delete(perm);
    }

    for (const perm of entry.deny || []) {
      if (!existing.allow.has(perm)) {
        existing.deny.add(perm);
      }
    }

    merged.set(String(entry.id), existing);
  }

  return [...merged.values()].map((entry) => ({
    id: entry.id,
    allow: [...entry.allow],
    deny: [...entry.deny]
  }));
}

function buildClientOverwrites(guild, contract) {
  const config = getConfig();
  return buildOverwriteEntries([
    { id: guild.id, deny: channelViewPerms },
    { id: contract.client, allow: channelViewPerms },
    { id: config.roles.secretaire, allow: channelViewPerms },
    { id: config.roles.gestionTicket, allow: channelViewPerms },
    { id: config.roles.owner, allow: channelViewPerms },
    { id: config.roles.admin, allow: channelViewPerms }
  ]);
}

function buildCategoryOverwrites(guild, contract) {
  const config = getConfig();
  const entries = [
    { id: guild.id, deny: categoryViewPerms },
    { id: contract.client, allow: categoryViewPerms },
    { id: config.roles.secretaire, allow: categoryViewPerms },
    { id: config.roles.gestionTicket, allow: categoryViewPerms },
    { id: config.roles.owner, allow: categoryViewPerms },
    { id: config.roles.admin, allow: categoryViewPerms }
  ];

  if (contract.secretaire) {
    entries.push({ id: contract.secretaire, allow: categoryViewPerms });
  }

  if (contract.step < 4) {
    for (const devId of contract.devs || []) {
      entries.push({ id: devId, allow: categoryViewPerms });
    }
  }

  return buildOverwriteEntries(entries);
}

function buildDevOverwrites(guild, contract) {
  const config = getConfig();
  const entries = [
    { id: guild.id, deny: channelViewPerms },
    { id: contract.client, deny: channelViewPerms },
    { id: config.roles.secretaire, deny: channelViewPerms },
    { id: contract.secretaire, allow: channelViewPerms },
    { id: config.roles.owner, allow: channelViewPerms },
    { id: config.roles.admin, allow: channelViewPerms }
  ];

  if (contract.step < 6) {
    for (const devId of contract.devs || []) {
      entries.push({ id: devId, allow: channelViewPerms });
    }
  }

  return buildOverwriteEntries(entries);
}

function buildSecretaryOverwrites(guild, contract) {
  const config = getConfig();
  return buildOverwriteEntries([
    { id: guild.id, deny: channelViewPerms },
    { id: contract.client, deny: channelViewPerms },
    { id: config.roles.secretaire, deny: channelViewPerms },
    { id: config.roles.gestionTicket, deny: channelViewPerms },
    { id: contract.secretaire, allow: channelViewPerms },
    { id: config.roles.owner, allow: channelViewPerms },
    { id: config.roles.admin, allow: channelViewPerms }
  ]);
}

async function resolveExistingDedicatedCategory(guild, contract) {
  const currentCategory = await fetchChannel(guild, contract.categoryId);
  if (currentCategory?.type === ChannelType.GuildCategory && !isConfiguredSharedCategory(currentCategory.id)) {
    return currentCategory;
  }

  const clientChan = await fetchChannel(guild, contract.clientChan);
  const devChan = await fetchChannel(guild, contract.devChan);
  const secChan = await fetchChannel(guild, contract.secChan);
  const candidateIds = uniq([clientChan?.parentId, devChan?.parentId, secChan?.parentId]);

  for (const candidateId of candidateIds) {
    const candidate = await fetchChannel(guild, candidateId);
    if (candidate?.type === ChannelType.GuildCategory && !isConfiguredSharedCategory(candidate.id)) {
      return candidate;
    }
  }

  return null;
}

async function ensureCategory(guild, contract) {
  let category = await resolveExistingDedicatedCategory(guild, contract);
  const payload = {
    name: buildCategoryName(contract),
    permissionOverwrites: await resolvePermissionOverwrites(guild, buildCategoryOverwrites(guild, contract))
  };

  if (!category) {
    category = await withTimeout(
      guild.channels.create({
        name: payload.name,
        type: ChannelType.GuildCategory,
        permissionOverwrites: payload.permissionOverwrites
      }).catch((error) => {
        logError("CONTRACT", "Contract category create error", error);
        return null;
      }),
      12000,
      null
    );
  } else {
    if (category.name !== payload.name) {
      category = await withTimeout(
        category.setName(payload.name).catch((error) => {
          logError("CONTRACT", "Contract category rename error", error);
          return category;
        }),
        7000,
        category
      );
    }

    if (!overwritesMatch(category.permissionOverwrites, payload.permissionOverwrites)) {
      await withTimeout(
        category.permissionOverwrites.set(payload.permissionOverwrites).catch((error) => {
          logError("CONTRACT", "Contract category permissions error", error);
          return null;
        }),
        5000,
        null
      );
    }
  }

  if (!category || category.type !== ChannelType.GuildCategory) {
    return null;
  }

  contract.categoryId = category.id;
  return category;
}

async function ensureCategoryState(category, guild, contract) {
  if (!category || category.type !== ChannelType.GuildCategory) {
    return null;
  }

  const payload = {
    name: buildCategoryName(contract),
    permissionOverwrites: await resolvePermissionOverwrites(guild, buildCategoryOverwrites(guild, contract))
  };

  if (category.name !== payload.name) {
    category = await withTimeout(
      category.setName(payload.name).catch(() => category),
      3000,
      category
    );
  }

  if (!overwritesMatch(category.permissionOverwrites, payload.permissionOverwrites)) {
    await withTimeout(
      category.permissionOverwrites.set(payload.permissionOverwrites).catch(() => null),
      3000,
      null
    );
  }

  contract.categoryId = category.id;
  return category;
}

async function ensureTextChannel(guild, existingId, payload) {
  const permissionOverwrites = await resolvePermissionOverwrites(guild, payload.permissionOverwrites);
  let channel = await fetchChannel(guild, existingId);

  if (!channel || channel.type !== ChannelType.GuildText) {
    channel = await withTimeout(
      guild.channels.create({
        name: payload.name,
        type: ChannelType.GuildText,
        parent: payload.parent,
        permissionOverwrites
      }).catch((error) => {
        logError("CONTRACT", "Contract channel create error", error);
        return null;
      }),
      12000,
      null
    );
  } else {
    if (channel.name !== payload.name) {
      channel = await withTimeout(
        channel.setName(payload.name).catch((error) => {
          logError("CONTRACT", "Contract channel rename error", error);
          return channel;
        }),
        7000,
        channel
      );
    }

    if (channel.parentId !== payload.parent) {
      channel = await withTimeout(
        channel.setParent(payload.parent, { lockPermissions: false }).catch((error) => {
          logError("CONTRACT", "Contract channel parent error", error);
          return channel;
        }),
        7000,
        channel
      );
    }

    if (!overwritesMatch(channel.permissionOverwrites, permissionOverwrites)) {
      await withTimeout(
        channel.permissionOverwrites.set(permissionOverwrites).catch((error) => {
          logError("CONTRACT", "Contract channel permissions error", error);
          return null;
        }),
        5000,
        null
      );
    }
  }

  return channel;
}

async function ensureClientChannel(guild, contract, category) {
  const channel = await ensureTextChannel(guild, contract.clientChan, {
    name: buildClientChannelName(contract),
    parent: category.id,
    permissionOverwrites: buildClientOverwrites(guild, contract)
  });

  if (channel) {
    contract.clientChan = channel.id;
  }

  return channel;
}

async function resolveOperationalCategory(guild, contract, fallbackCategory, clientChan) {
  const currentParent = await fetchChannel(guild, clientChan?.parentId || fallbackCategory?.id);
  const activeCategory = currentParent?.type === ChannelType.GuildCategory && !isConfiguredSharedCategory(currentParent.id)
    ? currentParent
    : fallbackCategory;

  return ensureCategoryState(activeCategory, guild, contract);
}

async function forceCategoryRefreshFromChannels(guild, contract, interactionChannelId = null) {
  const clientChan = await fetchChannel(guild, contract.clientChan);
  const devChan = await fetchChannel(guild, contract.devChan);
  const secChan = await fetchChannel(guild, contract.secChan);
  const sourceChan = await fetchChannel(guild, interactionChannelId);
  const candidateIds = uniq([
    sourceChan?.parentId,
    clientChan?.parentId,
    devChan?.parentId,
    secChan?.parentId,
    contract.categoryId
  ]);

  for (const candidateId of candidateIds) {
    const category = await fetchChannel(guild, candidateId);
    if (category?.type !== ChannelType.GuildCategory || isConfiguredSharedCategory(category.id)) {
      continue;
    }

    const refreshed = await ensureCategoryState(category, guild, contract);
    if (refreshed) {
      contract.categoryId = refreshed.id;
      return refreshed;
    }
  }

  return null;
}

async function restoreSnapshotCategoryName(guild, snapshot, interactionChannelId = null) {
  if (!snapshot) {
    return null;
  }

  const restoredContract = {
    ...snapshot,
    cancelled: false
  };
  const expectedName = snapshot.categoryName || buildCategoryName(restoredContract);
  const sourceChan = await fetchChannel(guild, interactionChannelId);
  const clientChan = await fetchChannel(guild, snapshot.clientChan);
  const devChan = await fetchChannel(guild, snapshot.devChan);
  const secChan = await fetchChannel(guild, snapshot.secChan);
  const candidateIds = uniq([
    sourceChan?.parentId,
    clientChan?.parentId,
    devChan?.parentId,
    secChan?.parentId,
    snapshot.categoryId
  ]);

  for (const candidateId of candidateIds) {
    const category = await fetchChannel(guild, candidateId);
    if (category?.type !== ChannelType.GuildCategory || isConfiguredSharedCategory(category.id)) {
      continue;
    }

    if (category.name !== expectedName) {
      await withTimeout(
        category.setName(expectedName).catch(() => category),
        3000,
        category
      );
    }

    return category;
  }

  return null;
}

async function ensureDevChannel(guild, contract, category) {
  if (contract.step < 2 || contract.step >= 4) {
    const existing = await fetchChannel(guild, contract.devChan);
    if (existing) {
      await withTimeout(existing.delete().catch(() => {}), 4000, null);
    }
    contract.controlMessages.dev = null;
    contract.devChan = null;
    return null;
  }

  const channel = await ensureTextChannel(guild, contract.devChan, {
    name: buildDevChannelName(contract),
    parent: category.id,
    permissionOverwrites: buildDevOverwrites(guild, contract)
  });

  if (channel) {
    contract.devChan = channel.id;
    return channel;
  }

  const fallbackChannel = await withTimeout(
    guild.channels.create({
      name: buildDevChannelName(contract),
      type: ChannelType.GuildText,
      parent: category.id,
      permissionOverwrites: await resolvePermissionOverwrites(guild, buildDevOverwrites(guild, contract))
    }).catch((error) => {
      logError("CONTRACT", "Contract dev fallback create error", error);
      return null;
    }),
    12000,
    null
  );

  if (fallbackChannel) {
    contract.devChan = fallbackChannel.id;
  }

  return fallbackChannel;
}

async function getSecretaryName(guild, contract) {
  const member = contract.secretaire
    ? guild.members.cache.get(contract.secretaire) || (await withTimeout(guild.members.fetch(contract.secretaire).catch(() => null), 2500, null))
    : null;
  return member?.displayName || member?.user?.username || "secretaire";
}

async function ensureSecretaryChannel(guild, contract, category) {
  if (contract.step < 6) {
    const existing = await fetchChannel(guild, contract.secChan);
    if (existing) {
      await withTimeout(existing.delete().catch(() => {}), 4000, null);
    }
    contract.controlMessages.sec = null;
    contract.secChan = null;
    return null;
  }

  const secretaryName = await getSecretaryName(guild, contract);
  const channel = await ensureTextChannel(guild, contract.secChan, {
    name: buildSecretaryChannelName(contract, secretaryName),
    parent: category.id,
    permissionOverwrites: buildSecretaryOverwrites(guild, contract)
  });

  if (channel) {
    contract.secChan = channel.id;
  }

  return channel;
}

async function deleteControlMessage(guild, entry) {
  if (!entry?.messageId) return;
  const channel = await fetchChannel(guild, entry.channelId);
  if (!channel) return;
  const message = await withTimeout(channel.messages.fetch(entry.messageId).catch(() => null), 3000, null);
  if (message) {
    await withTimeout(message.delete().catch(() => {}), 3000, null);
  }
}

async function replaceControlMessage(guild, contract, key, channel, payload) {
  const previous = contract.controlMessages[key];
  const signature = buildPayloadSignature(payload);

  if (previous?.messageId && previous.channelId === channel.id && previous.signature === signature) {
    const cachedMessage = channel.messages.cache.get(previous.messageId);
    if (cachedMessage) {
      return cachedMessage;
    }

    const existingMessage = await withTimeout(channel.messages.fetch(previous.messageId).catch(() => null), 2000, null);
    if (existingMessage) {
      return existingMessage;
    }
  }

  if (previous?.messageId && previous.channelId === channel.id) {
    const previousMessage = await withTimeout(channel.messages.fetch(previous.messageId).catch(() => null), 3000, null);
    if (previousMessage) {
      const edited = await withTimeout(
        previousMessage.edit({
          ...payload,
          content: typeof payload.content === "undefined" ? null : payload.content
        }).catch(() => null),
        5000,
        null
      );
      if (edited) {
        contract.controlMessages[key] = { channelId: channel.id, messageId: edited.id, signature };
        return edited;
      }
    }
  }

  await deleteControlMessage(guild, previous);

  const sendPayload = { ...payload };
  if (typeof sendPayload.content === "undefined" || sendPayload.content === null) {
    delete sendPayload.content;
  }

  const message = await withTimeout(channel.send(sendPayload).catch(() => null), 5000, null);
  contract.controlMessages[key] = message
    ? { channelId: channel.id, messageId: message.id, signature }
    : null;

  return message;
}

function buildUrgenceLabel() {
  const config = getConfig();
  return `@${config.roleNames?.urgence || "Urgence"}`;
}

function buildOwnerMention() {
  const config = getConfig();
  if (config.roles?.owner) {
    return `<@&${config.roles.owner}>`;
  }
  return "Owner";
}

function buildSecurityMessage() {
  return [
    "⚠ Message de sécurité automatique pour eviter de vous faire avoir",
    "Aucun secrétaire ne vous demandera jamais de le payer directement, ceci est impossible et constitut à une faudre :(.",
    "Tous les paiements passent exclusivement par le compte PayPal officiel HEO ou le groupe officiel HEO, par les owners pour faire simple.",
    `Si un secrétaire tente de faire autrement ou si vous observez un comportement suspect, utilisez immédiatement le ping ${buildUrgenceLabel()}, eux seront comment reagir et quoi faire.`,
      "Merci de votre compréhension ainsi de votre prudence !"
  ].join("\n");
}

async function getDeveloperMentions(contract) {
  if (!contract.devs?.length) return "Aucun";
  return contract.devs.map((id) => `<@${id}>`).join(", ");
}

async function getDeveloperNames(guild, devIds) {
  if (!devIds?.length) return "Aucun";
  return devIds.map((devId) => `<@${devId}>`).join(", ");
}

async function buildClientEmbed(contract, guild) {
  const meta = getStageMeta(contract.step);
  const fields = [
    { name: "Contrat", value: block(contract.nom), inline: true },
    { name: "Client", value: `<@${contract.client}>`, inline: true },
    { name: "Budget", value: block(contract.budget), inline: true },
    { name: "Délai", value: block(contract.delai), inline: true },
    { name: "Statut", value: block(meta.clientStatus), inline: true },
    { name: "Description", value: block(contract.desc), inline: false }
  ];

  if (contract.devs?.length) {
    fields.push({ name: "Développeur(s)", value: await getDeveloperNames(guild, contract.devs), inline: false });
  }

  if (contract.infos && contract.step >= 2) {
    fields.push({ name: "Informations supplémentaires", value: block(contract.infos), inline: false });
  }

  return buildStudioEmbed({
    title: contract.cancelled ? "🛑 Contrat annulé" : meta.clientTitle,
    color: contract.cancelled ? palette.red : palette.gold,
    description: contract.cancelled ? "Contrat annulé." : meta.clientDescription,
    footer: `HEO Studio • ${contract.cancelled ? "Contrat annulé" : meta.label}`,
    fields
  });
}

async function buildDevEmbed(contract, guild) {
  const meta = getStageMeta(contract.step);
  const fields = [
    { name: "Contrat", value: block(contract.nom), inline: true },
    { name: "Secrétaire", value: contract.secretaire ? `<@${contract.secretaire}>` : block("Non défini"), inline: true },
    { name: "Développeur(s)", value: block(await getDeveloperMentions(contract)), inline: false },
    { name: "Budget", value: block(contract.budget), inline: true },
    { name: "Délai", value: block(contract.delai), inline: true },
    { name: "Statut", value: block(contract.cancelled ? "Contrat annulé" : meta.devStatus || meta.clientStatus), inline: true },
    { name: "Description du projet", value: block(contract.desc), inline: false }
  ];

  if (contract.infos) {
    fields.push({ name: "Consignes supplémentaires", value: block(contract.infos), inline: false });
  }

  return buildStudioEmbed({
    title: contract.cancelled ? "🛑 Ticket développeur annulé" : meta.devTitle || meta.clientTitle,
    color: contract.cancelled ? palette.red : contract.step >= 5 ? palette.violet : palette.blue,
    description: contract.cancelled ? "Contrat annulé." : meta.devDescription || meta.clientDescription,
    footer: `HEO Studio • ${contract.cancelled ? "Contrat annulé" : meta.label}`,
    fields
  });
}

async function buildSecretaryEmbed(contract, guild) {
  const meta = getStageMeta(contract.step);
  const secretaryName = await getSecretaryName(guild, contract);
  return buildStudioEmbed({
    title: contract.cancelled ? "🛑 Paiement secrétaire suspendu" : meta.secTitle,
    color: contract.cancelled ? palette.red : palette.green,
    description: contract.cancelled ? "Contrat annulé." : meta.secDescription,
    footer: `HEO Studio • ${contract.cancelled ? "Contrat annulé" : meta.label}`,
    fields: [
      { name: "Contrat", value: block(contract.nom), inline: true },
      { name: "Secrétaire", value: block(secretaryName), inline: true },
      { name: "Statut", value: block(contract.cancelled ? "Contrat annulé" : meta.secStatus), inline: true }
    ]
  });
}

async function buildChannelPayload(contract, guild, location) {
  const actionRow = buildActionRow(contract, location);
  const components = [];
  if (actionRow) {
    components.push(actionRow);
  }
  components.push(getTicketRow());

  if (location === "client") {
    return {
      content: !contract.cancelled && contract.step === 5 ? `${buildOwnerMention()} Merci de procéder au paiement du développeur.` : null,
      embeds: [await buildClientEmbed(contract, guild)],
      components
    };
  }

  if (location === "dev") {
    return {
      embeds: [await buildDevEmbed(contract, guild)],
      components
    };
  }

  if (location === "sec") {
    return {
      content: !contract.cancelled && contract.step === 6 ? `${buildOwnerMention()} En attente du paiement du secrétaire.` : null,
      embeds: [await buildSecretaryEmbed(contract, guild)],
      components
    };
  }

  return null;
}

async function syncContractState(guild, contract, onProgress = null) {
  ensureContractState(contract);
  const report = typeof onProgress === "function" ? onProgress : async () => {};

  await report("Préparation de la catégorie en train de se faire");
  const initialCategory = await ensureCategory(guild, contract);
  if (!initialCategory) {
    throw new Error("Catégorie contrat introuvable ou impossible à créer");
  }

  await report("Synchronisation du salon en cours, je rename le salon en ce moment");
  const clientChan = await ensureClientChannel(guild, contract, initialCategory);
  if (!clientChan) {
    throw new Error("Salon client introuvable ou impossible à créer");
  }

  await report("Mise à jour de la catégorie en cours, il est possible que le nom se mettent pas à jours correctement si cela arrive je vous pris de le faire manuellement");
  const category = await resolveOperationalCategory(guild, contract, initialCategory, clientChan);
  if (!category) {
    throw new Error("Catégorie contrat introuvable ou impossible à synchronisée");
  }

  if (clientChan.parentId !== category.id) {
    const movedClient = await ensureTextChannel(guild, clientChan.id, {
      name: buildClientChannelName(contract),
      parent: category.id,
      permissionOverwrites: buildClientOverwrites(guild, contract)
    });
    if (movedClient) {
      contract.clientChan = movedClient.id;
    }
  }

  const currentClientChan = await fetchChannel(guild, contract.clientChan);
  if (!currentClientChan) {
    throw new Error("Salon du client introuvable après synchronisation, impossible de continuer la synchronisation");
  }
  await report("Synchronisation des salons privés");
  const [devChan, secChan] = await Promise.all([
    ensureDevChannel(guild, contract, category),
    ensureSecretaryChannel(guild, contract, category)
  ]);

  if (contract.step >= 2 && contract.step < 4 && !devChan) {
    throw new Error("Salon développeur introuvable ou impossible à créer, verifier les permissions du bot et réessayez ou vous verifiez qu'il sois pas supprimer");
  }

  const currentControls = { ...contract.controlMessages };

  if (currentControls.client && currentControls.client.channelId !== currentClientChan.id) {
    await deleteControlMessage(guild, currentControls.client);
    contract.controlMessages.client = null;
  }
  if (!devChan && currentControls.dev && contract.controlMessages.dev) {
    await deleteControlMessage(guild, currentControls.dev);
    contract.controlMessages.dev = null;
  }
  if (!secChan && currentControls.sec && contract.controlMessages.sec) {
    await deleteControlMessage(guild, currentControls.sec);
    contract.controlMessages.sec = null;
  }

  await report("Mise à jour des messages");
  const [clientPayload, devPayload, secPayload] = await Promise.all([
    buildChannelPayload(contract, guild, "client"),
    devChan ? buildChannelPayload(contract, guild, "dev") : Promise.resolve(null),
    secChan ? buildChannelPayload(contract, guild, "sec") : Promise.resolve(null)
  ]);

  const messageTasks = [replaceControlMessage(guild, contract, "client", currentClientChan, clientPayload)];

  if (devChan && devPayload) {
    messageTasks.push(replaceControlMessage(guild, contract, "dev", devChan, devPayload));
  } else {
    contract.controlMessages.dev = null;
  }

  if (secChan && secPayload) {
    messageTasks.push(replaceControlMessage(guild, contract, "sec", secChan, secPayload));
  } else {
    contract.controlMessages.sec = null;
  }

  if (!devChan) {
    contract.controlMessages.dev = null;
  }

  await Promise.all(messageTasks);

  return {
    category,
    clientChan: currentClientChan,
    devChan,
    secChan
  };
}

async function findContractEntryByChannel(channelId) {
  const contracts = await getContracts();
  for (const [key, contractValue] of Object.entries(contracts)) {
    if (!contractValue) continue;
    const contract = ensureContractState(contractValue);
    if ([contract.clientChan, contract.devChan, contract.secChan].includes(channelId)) {
      return { key, contract };
    }
  }
  return null;
}

async function deleteContractTree(guild, key, contract) {
  ensureContractState(contract);

  const category = await fetchChannel(guild, contract.categoryId);
  const linkedChannelIds = uniq([
    contract.clientChan,
    contract.devChan,
    contract.secChan,
    ...(category?.children?.cache ? [...category.children.cache.keys()] : [])
  ]);

  for (const channelId of linkedChannelIds) {
    const channel = await fetchChannel(guild, channelId);
    if (channel) {
      await withTimeout(channel.delete().catch(() => {}), 4000, null);
    }
  }

  if (category) {
    await withTimeout(category.delete().catch(() => {}), 4000, null);
  }

  await removeContract(key);
  logInfo("CONTRACT", "Structure contrat supprimée", {
    contractKey: key,
    contractName: contract.nom
  });
}

async function closeTicketStructure(guild, channelId) {
  const entry = await findContractEntryByChannel(channelId);
  if (entry) {
    await deleteContractTree(guild, entry.key, entry.contract);
    return true;
  }

  const channel = await fetchChannel(guild, channelId);
  if (channel) {
    await withTimeout(channel.delete().catch(() => {}), 4000, null);
  }

  return false;
}

async function createContract(guild, data, onProgress = null) {
  const tempContract = buildContractRecord({
    nom: data.nom,
    budget: data.budget,
    delai: data.delai,
    desc: data.desc,
    clientId: data.clientId,
    clientName: data.clientName,
    categoryId: null,
    clientChanId: null
  });

  await syncContractState(guild, tempContract, onProgress);
  logInfo("CONTRACT", "Structure contrat créée", {
    contractName: tempContract.nom,
    categoryId: tempContract.categoryId,
    clientChannelId: tempContract.clientChan,
    clientId: tempContract.client
  });
  return tempContract.clientChan ? tempContract : null;
}

async function applyDeveloperSelection(guild, contract, { secretaryId, devs, infos }, onProgress = null) {
  ensureContractState(contract);
  pushHistorySnapshot(contract);
  contract.secretaire = secretaryId;
  contract.devs = [...devs];
  contract.infos = infos || "";
  contract.step = 2;
  contract.cancelled = false;
  contract.devSelectionNonce = null;
  await syncContractState(guild, contract, onProgress);
  logInfo("CONTRACT", "Choix développeur enregistré", {
    contractName: contract.nom,
    secretaryId,
    devs
  });
}

function getNextChannelId(contract) {
  if (contract.step === 6) return contract.secChan;
  return contract.clientChan;
}

function getFinishChannelId(contract) {
  return contract.secChan;
}

async function handleForwardStep(interaction, key, contract) {
  ensureContractState(contract);

  if (contract.step === 1) {
    if (interaction.channel.id !== contract.clientChan) {
      return safeReply(interaction, { content: "❌ Utilise le salon 🟡-client pour cette étape", flags: 64 });
    }

    const nonce = contract.devSelectionNonce || generateNonce();
    contract.devSelectionNonce = nonce;
    contract.secretaire = interaction.user.id;
    await saveContract(key, contract);

    const shown = await safeShowModal(interaction, buildDeveloperChoiceModal(nonce));
    if (!shown) {
      await interaction.user.send("Le bouton a expiré essaie de recliquer sur Choisir un développeur.").catch(() => {});
    }
    return true;
  }

  const acknowledged = await safeDeferReply(interaction);
  if (!acknowledged) return false;
  const progress = createProgressTracker(interaction, "Mise à jour du contrat");
  await progress.step("Préparation de l'étape");

  if (contract.step === 2) {
    if (interaction.channel.id !== contract.clientChan) {
      return safeReply(interaction, { content: "❌ Utilise le salon 🟡-client pour cette étape" });
    }
    pushHistorySnapshot(contract);
    contract.step = 3;
    contract.devSelectionNonce = null;
    await syncContractState(interaction.guild, contract, (label) => progress.step(label));
    await progress.step("Sauvegarde du contrat");
    await saveContract(key, contract);
    logInfo("CONTRACT", "Étape -> développement", { contractKey: key, contractName: contract.nom, step: contract.step });
    return safeReply(interaction, { content: "✅ Premier paiement enregistré" });
  }

  if (contract.step === 3) {
    if (interaction.channel.id !== contract.clientChan) {
      return safeReply(interaction, { content: "❌ Utilise le salon 🟡-client pour cette étape" });
    }
    pushHistorySnapshot(contract);
    contract.step = 4;
    contract.devSelectionNonce = null;
    await syncContractState(interaction.guild, contract, (label) => progress.step(label));
    await progress.step("Sauvegarde du contrat");
    await saveContract(key, contract);
    logInfo("CONTRACT", "Étape -> attente paiement final", { contractKey: key, contractName: contract.nom, step: contract.step });
    return safeReply(interaction, { content: "✅ Travail marqué comme terminé" });
  }

  if (contract.step === 4) {
    if (interaction.channel.id !== contract.clientChan) {
      return safeReply(interaction, { content: "❌ Utilise le salon 🟡-client pour cette étape" });
    }
    if (!hasOwnerPermission(interaction.member)) {
      return safeReply(interaction, { content: "❌ Seul un owner peut confirmer le paiement final", flags: 64 });
    }
    pushHistorySnapshot(contract);
    contract.step = 5;
    contract.devSelectionNonce = null;
    await syncContractState(interaction.guild, contract, (label) => progress.step(label));
    await progress.step("Sauvegarde du contrat");
    await saveContract(key, contract);
    logInfo("CONTRACT", "Étape -> paiement développeur", { contractKey: key, contractName: contract.nom, step: contract.step });
    return safeReply(interaction, { content: "✅ Paiement final enregistré" });
  }

  if (contract.step === 5) {
    if (interaction.channel.id !== contract.clientChan) {
      return safeReply(interaction, { content: "❌ Utilise le salon contrat-client pour cette étape" });
    }
    if (!hasOwnerPermission(interaction.member)) {
      return safeReply(interaction, { content: "❌ Seul un owner peut confirmer le paiement du développeur", flags: 64 });
    }
    pushHistorySnapshot(contract);
    contract.step = 6;
    contract.devSelectionNonce = null;
    await syncContractState(interaction.guild, contract, (label) => progress.step(label));
    await progress.step("Sauvegarde du contrat");
    await saveContract(key, contract);
    logInfo("CONTRACT", "Étape -> paiement secrétaire", { contractKey: key, contractName: contract.nom, step: contract.step });
    return safeReply(interaction, { content: "✅ Paiement développeur enregistré" });
  }

  if (contract.step === 6) {
    if (interaction.channel.id !== contract.secChan) {
      return safeReply(interaction, { content: "❌ Utilise le salon secrétaire pour cette étape" });
    }
    if (!hasOwnerPermission(interaction.member)) {
      return safeReply(interaction, { content: "❌ Seul un owner peut terminer cette étape", flags: 64 });
    }
    pushHistorySnapshot(contract);
    contract.step = 7;
    contract.devSelectionNonce = null;
    await syncContractState(interaction.guild, contract, (label) => progress.step(label));
    await progress.step("Sauvegarde du contrat");
    await saveContract(key, contract);
    logInfo("CONTRACT", "Étape -> terminé", { contractKey: key, contractName: contract.nom, step: contract.step });
    return safeReply(interaction, { content: "✅ Contrat terminé. Les salons restent ouverts." });
  }

  return safeReply(interaction, { content: "❌ Aucune étape suivante disponible ici" });
}

async function handleBackStep(interaction, key, contract) {
  ensureContractState(contract);
  if (!contract.history.length) {
    return safeReply(interaction, { content: "❌ Aucun retour disponible ici", flags: 64 });
  }

  const acknowledged = await safeDeferReply(interaction);
  if (!acknowledged) return false;
  const progress = createProgressTracker(interaction, "Restauration du contrat");
  await progress.step("Chargement de l'étape précédente");
  const previousState = contract.history.pop();
  applyStateSnapshot(contract, previousState);
  contract.cancelSnapshot = null;
  await syncContractState(interaction.guild, contract, (label) => progress.step(label));
  await progress.step("Sauvegarde du contrat");
  await saveContract(key, contract);
  logInfo("CONTRACT", "Retour arrière effectué", { contractKey: key, contractName: contract.nom, step: contract.step });
  return safeReply(interaction, { content: "🔙 Étape précédente restaurée" });
}

async function handleCancelState(interaction, key, contract, cancel) {
  ensureContractState(contract);
  const acknowledged = await safeDeferReply(interaction);
  if (!acknowledged) return false;
  const progress = createProgressTracker(interaction, cancel ? "Annulation du contrat" : "Réactivation du contrat");
  await progress.step(cancel ? "Préparation de l'annulation" : "Préparation de la réactivation");

  if (cancel) {
    if (contract.cancelled) {
      return safeReply(interaction, { content: "❌ Le contrat est déjà annulé", flags: 64 });
    }
    contract.cancelSnapshot = cloneContractState(contract);
    contract.cancelled = true;
    contract.devSelectionNonce = null;
    await syncContractState(interaction.guild, contract, (label) => progress.step(label));
    await progress.step("Vérification finale de la catégorie");
    await forceCategoryRefreshFromChannels(interaction.guild, contract, interaction.channel.id);
    await progress.step("Sauvegarde du contrat");
    await saveContract(key, contract);
    logInfo("CONTRACT", "Contrat annulé", { contractKey: key, contractName: contract.nom, step: contract.step });
    return safeReply(interaction, { content: "🛑 Contrat annulé" });
  }

  if (!contract.cancelled || !contract.cancelSnapshot) {
    return safeReply(interaction, { content: "❌ Aucun état à restaurer", flags: 64 });
  }

  const snapshot = contract.cancelSnapshot;
  applyStateSnapshot(contract, snapshot);
  contract.cancelSnapshot = null;
  contract.cancelled = false;
  await syncContractState(interaction.guild, contract, (label) => progress.step(label));
  await progress.step("Restauration du nom de catégorie");
  const restoredCategory = await restoreSnapshotCategoryName(interaction.guild, snapshot, interaction.channel.id);
  if (restoredCategory) {
    contract.categoryId = restoredCategory.id;
  }
  await forceCategoryRefreshFromChannels(interaction.guild, contract, interaction.channel.id);
  await progress.step("Sauvegarde du contrat");
  await saveContract(key, contract);
  logInfo("CONTRACT", "Contrat réactivé", { contractKey: key, contractName: contract.nom, step: contract.step });
  return safeReply(interaction, { content: "✅ Contrat réactivé" });
}

function createEtape1Embed(nom, budget, delai, desc, clientId) {
  return buildStudioEmbed({
    title: "1️⃣ Contrat en négociation",
    color: palette.gold,
    description: "**CONTRAT OUVERT**\n\nLe secrétaire peut maintenant cadrer le besoin, le budget et les conditions avec le client.",
    footer: "HEO Studio • Étape 1",
    fields: [
      { name: "Contrat", value: block(nom), inline: true },
      { name: "Client", value: `<@${clientId}>`, inline: true },
      { name: "Budget", value: block(budget), inline: true },
      { name: "Délai", value: block(delai), inline: true },
      { name: "Statut", value: block("Négociation en cours"), inline: true },
      { name: "Description", value: block(desc), inline: false }
    ]
  });
}

async function handleContractLogic(interaction, action) {
  let lockKey = null;

  try {
    if (!hasContractPermission(interaction.member)) {
      return safeReply(interaction, { content: "❌ Vous n'avez pas la permission requise pour ceci", flags: 64 });
    }

    const entry = await findContractEntryByChannel(interaction.channel.id);
    if (!entry) {
      return safeReply(interaction, { content: "❌ Contrat introuvable", flags: 64 });
    }

    const { key, contract } = entry;
    ensureContractState(contract);

    if (contractLocks.has(key)) {
      return safeReply(interaction, { content: "⌛ Une action est déjà en cours sur ce contrat", flags: 64 });
    }

    contractLocks.add(key);
    lockKey = key;

    if (action === "cancel") {
      return handleCancelState(interaction, key, contract, true);
    }

    if (action === "uncancel") {
      return handleCancelState(interaction, key, contract, false);
    }

    if (contract.cancelled) {
      return safeReply(interaction, {
        content: "🛑 Contrat annulé, utilise Désannuler ou /uncancel pour reprendre",
        flags: 64
      });
    }

    if (action === "next") {
      return handleForwardStep(interaction, key, contract);
    }

    if (action === "finish") {
      if (contract.step !== 6) {
        return safeReply(interaction, { content: "❌ Cette étape n’est pas disponible ici", flags: 64 });
      }
      return handleForwardStep(interaction, key, contract);
    }

    if (action === "back") {
      return handleBackStep(interaction, key, contract);
    }

    if (action === "close") {
      const acknowledged = await safeDeferReply(interaction);
      if (!acknowledged) return;
      await safeReply(interaction, { content: "🔒 Fermeture dans 5 secondes environs..." });
      setTimeout(() => {
        closeTicketStructure(interaction.guild, interaction.channel.id).catch(() => {});
      }, 1500);
      return;
    }

    return safeReply(interaction, { content: "❌ Action inconnue", flags: 64 });
  } catch (error) {
    logError("CONTRACT", "Contract logic error", error);
    return safeReply(interaction, { content: "❌ Erreur" });
  } finally {
    if (lockKey) {
      contractLocks.delete(lockKey);
    }
  }
}

module.exports = {
  handleContractLogic,
  hasContractPermission,
  hasOwnerPermission,
  getTicketRow,
  getCancelledRow,
  buildDeveloperChoiceModal,
  buildContractRecord,
  buildSecurityMessage,
  cloneContractState,
  createContract,
  applyDeveloperSelection,
  saveContract,
  syncContractState,
  getNextChannelId,
  getFinishChannelId,
  buildCategoryName,
  buildClientChannelName,
  buildDevChannelName,
  buildSecretaryChannelName,
  createEtape1Embed,
  findContractEntryByChannel,
  ensureContractState,
  closeTicketStructure
};
