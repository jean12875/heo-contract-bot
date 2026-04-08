const { 
    Client, GatewayIntentBits, Partials, PermissionFlagsBits, 
    ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, 
    ModalBuilder, TextInputBuilder, TextInputStyle, ChannelType 
} = require('discord.js');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers],
    partials: [Partials.Channel],
});

// --- CONFIGURATION ---
const CONFIG = {
    TOKEN: process.env.TOKEN,
    ROLE_OWNER: "1485191413837856966",
    ROLE_SECRETAIRE: "1490464910549712937",
    ROLE_STAFF: "1487848016110162153",
    SALON_PROPOSITION: "1490697124709404872",
    PING_URGENCE: "<@&1485191413837856966>" // Remplace par l'ID réel du rôle Urgence si différent
};

const contractStates = new Map();

const STEPS = {
    0: { emoji: '🟡', label: 'Initialisation' },
    1: { emoji: '1️⃣💳', label: 'Attente 1er paiement' },
    2: { emoji: '🛠️', label: 'Développement' },
    3: { emoji: '2️⃣💳', label: 'Attente paiement final' },
    4: { emoji: '💰', label: 'Payement Dev' },
    5: { emoji: '✅', label: 'Payement Secrétaire' }
};

client.once('ready', () => { console.log(`✅ HEO Studio Bot prêt !`); });

client.on('interactionCreate', async interaction => {
    // A. OUVERTURE MODAL CRÉATION
    if (interaction.isButton() && interaction.customId === 'btn_open_contract_modal') {
        const modal = new ModalBuilder().setCustomId('modal_create').setTitle('📋 Nouveau Contrat HEO Studio');
        modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('name').setLabel("Nom du contrat").setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('budget').setLabel("Budget (€)").setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('deadline').setLabel("Délai").setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('desc').setLabel("Description du projet").setStyle(TextInputStyle.Paragraph).setRequired(true))
        );
        return await interaction.showModal(modal);
    }

    // B. SUBMIT CRÉATION
    if (interaction.isModalSubmit() && interaction.customId === 'modal_create') {
        await interaction.deferReply({ ephemeral: true });
        
        const name = interaction.fields.getTextInputValue('name');
        const budget = interaction.fields.getTextInputValue('budget');
        const deadline = interaction.fields.getTextInputValue('deadline');
        const desc = interaction.fields.getTextInputValue('desc');

        const category = await interaction.guild.channels.create({ name: `🟡-${name}`, type: ChannelType.GuildCategory });

        const ticketClient = await interaction.guild.channels.create({
            name: `💼-client`,
            type: ChannelType.GuildText,
            parent: category.id,
            permissionOverwrites: [
                { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
                { id: CONFIG.ROLE_SECRETAIRE, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
                { id: CONFIG.ROLE_OWNER, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
                { id: CONFIG.ROLE_STAFF, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
            ],
        });

        const infoEmbed = new EmbedBuilder().setTitle(`💼 Ticket Client - ${name}`).setColor('#f1c40f').addFields({ name: '💰 Budget', value: `${budget}€`, inline: true }, { name: '⏳ Délai', value: deadline, inline: true }, { name: '📝 Description', value: desc });
        const safetyEmbed = new EmbedBuilder().setTitle("🛡️ PROTECTION & SÉCURITÉ").setColor('#ff0000').setDescription(`Jamais un secrétaire ne vous demandera de payer directement. Tout passe par le PayPal officiel HEO.\n\nEn cas de doute : @🚨 • Urgence`);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('next_step').setLabel('Suivant ➡️').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('back_step').setLabel('🔙').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('cancel_contract').setLabel('🛑 Annuler').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('delete_all').setLabel('🗑️ Tout Supprimer').setStyle(ButtonStyle.Danger)
        );

        await ticketClient.send({ content: `<@${interaction.user.id}> | <@&${CONFIG.ROLE_SECRETAIRE}>`, embeds: [infoEmbed, safetyEmbed], components: [row] });
        contractStates.set(category.id, { step: 0, history: [], originalName: name, ticketClient: ticketClient.id, ticketDev: null, isCancelled: false });
        await interaction.editReply({ content: `✅ Contrat créé : ${ticketClient}` });
    }

    // C. GESTION DES BOUTONS & NAVIGATION
    const category = interaction.channel?.parent;
    if (!category) return;
    const state = contractStates.get(category.id);
    if (!state && interaction.customId !== 'delete_all') return;

    // BOUTON SUPPRIMER TOUT
    if (interaction.customId === 'delete_all') {
        await interaction.reply({ content: "⚠️ Suppression de toute la catégorie en cours...", ephemeral: true });
        const channels = category.children.cache;
        for (const channel of channels.values()) await channel.delete();
        await category.delete();
        return;
    }

    if (interaction.customId === 'next_step') {
        if (state.step === 0) {
            const modalDev = new ModalBuilder().setCustomId('modal_dev').setTitle('Assigner le Développeur');
            modalDev.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('dev_tag').setLabel("Mention du Dev (@nom)").setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('info').setLabel("Infos supp.").setStyle(TextInputStyle.Paragraph))
            );
            return await interaction.showModal(modalDev);
        }
        await interaction.deferUpdate();
        state.history.push(state.step);
        state.step++;
        await updateWorkflow(category, state);
    }

    if (interaction.customId === 'back_step') {
        if (state.history.length === 0) return interaction.reply({ content: "Impossible de reculer.", ephemeral: true });
        await interaction.deferUpdate();
        state.step = state.history.pop();
        await updateWorkflow(category, state);
    }

    if (interaction.customId === 'cancel_contract') {
        await interaction.deferUpdate();
        state.isCancelled = !state.isCancelled;
        const prefix = state.isCancelled ? "🛑" : STEPS[state.step].emoji;
        await category.setName(`${prefix}-${state.originalName}`);
    }

    // D. SUBMIT DÉVELOPPEUR
    if (interaction.isModalSubmit() && interaction.customId === 'modal_dev') {
        await interaction.deferReply({ ephemeral: true });
        const devTag = interaction.fields.getTextInputValue('dev_tag');
        const devId = devTag.replace(/[<@!>]/g, '');

        const ticketDev = await interaction.guild.channels.create({
            name: `🛠-dev`,
            parent: category.id,
            permissionOverwrites: [
                { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                { id: devId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
                { id: CONFIG.ROLE_SECRETAIRE, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
                { id: CONFIG.ROLE_OWNER, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
            ]
        });

        state.history.push(state.step);
        state.step = 1;
        state.ticketDev = ticketDev.id;
        await updateWorkflow(category, state);
        await ticketDev.send(`**Nouveau Contrat**\nDev : <@${devId}>\nNotes : ${interaction.fields.getTextInputValue('info')}`);
        await interaction.editReply({ content: "✅ Développeur ajouté au ticket dev." });
    }
});

async function updateWorkflow(category, state) {
    const info = STEPS[state.step];
    await category.setName(`${info.emoji}-${state.originalName}`);
    const clientChan = category.guild.channels.cache.get(state.ticketClient);
    if (state.step === 4) {
        await clientChan?.setName(`✅-client`);
        clientChan?.send(`💰 Paiement final reçu ! <@&${CONFIG.ROLE_OWNER}> payez le dev.`);
    }
    if (state.step === 5) {
        const secChan = await category.guild.channels.create({ name: `📍💳-payement-secrétaire`, parent: category.id });
        secChan.send(`<@&${CONFIG.ROLE_OWNER}> payez le secrétaire.`);
    }
}

client.on('messageCreate', async (message) => {
    if (message.content === '!setup-heo' && message.member.permissions.has(PermissionFlagsBits.Administrator)) {
        const channel = client.channels.cache.get(CONFIG.SALON_PROPOSITION);
        const embed = new EmbedBuilder().setTitle("📝 HEO Studio").setDescription("Cliquez pour créer un contrat.").setColor("#f1c40f");
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('btn_open_contract_modal').setLabel('Créer un Contrat').setStyle(ButtonStyle.Primary));
        await channel.send({ embeds: [embed], components: [row] });
        message.delete();
    }
});

client.login(CONFIG.TOKEN);
