const { 
    Client, 
    GatewayIntentBits, 
    Partials, 
    PermissionFlagsBits, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    EmbedBuilder, 
    ModalBuilder, 
    TextInputBuilder, 
    TextInputStyle, 
    ChannelType 
} = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
    ],
    partials: [Partials.Channel],
});

// --- CONFIGURATION ---
const CONFIG = {
    TOKEN: process.env.TOKEN,
    ROLE_OWNER: "1485191413837856966",
    ROLE_SECRETAIRE: "1490464910549712937",
    ROLE_STAFF: "1487848016110162153",
    SALON_PROPOSITION: "1490697124709404872",
    EMOJI_URGENCE: "@🚨 • Urgence"
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
    // A. OUVERTURE DU MODAL
    if ((interaction.isButton() && interaction.customId === 'btn_open_contract_modal') || 
        (interaction.isChatInputCommand() && interaction.commandName === 'contrat')) {
        
        const modal = new ModalBuilder().setCustomId('modal_create').setTitle('📋 Nouveau Contrat HEO Studio');
        modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('name').setLabel("Nom du contrat").setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('budget').setLabel("Budget (€)").setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('deadline').setLabel("Délai").setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('desc').setLabel("Description du projet").setStyle(TextInputStyle.Paragraph).setRequired(true))
        );
        return await interaction.showModal(modal);
    }

    // B. RÉCEPTION DU FORMULAIRE (SUBMIT)
    if (interaction.isModalSubmit() && interaction.customId === 'modal_create') {
        const name = interaction.fields.getTextInputValue('name');
        const budget = interaction.fields.getTextInputValue('budget');
        const deadline = interaction.fields.getTextInputValue('deadline');
        const desc = interaction.fields.getTextInputValue('desc');

        const category = await interaction.guild.channels.create({
            name: `🟡-${name}`,
            type: ChannelType.GuildCategory,
        });

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

        // 1er EMBED : Récapitulatif complet du formulaire
        const infoEmbed = new EmbedBuilder()
            .setTitle(`💼 Ticket Client - ${name}`)
            .setColor('#f1c40f')
            .addFields(
                { name: '💰 Budget', value: `${budget}€`, inline: true },
                { name: '⏳ Délai', value: deadline, inline: true },
                { name: '📝 Description', value: desc }
            );

        // 2ème EMBED : Prévention Sécurité (Message séparé)
        const safetyEmbed = new EmbedBuilder()
            .setTitle("🛡️ PROTECTION & SÉCURITÉ")
            .setColor('#ff0000')
            .setDescription(`Jamais un secrétaire ne vous demandera de payer directement. Tout passe par le PayPal officiel HEO ou le groupe officiel HEO.\n\nEn cas de comportement suspect, contactez immédiatement : ${CONFIG.EMOJI_URGENCE}`);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('next_step').setLabel('Suivant ➡️').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('back_step').setLabel('🔙').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('cancel_contract').setLabel('🛑 Annuler').setStyle(ButtonStyle.Danger)
        );

        await ticketClient.send({ 
            content: `<@${interaction.user.id}> | <@&${CONFIG.ROLE_SECRETAIRE}>`, 
            embeds: [infoEmbed, safetyEmbed], 
            components: [row] 
        });
        
        contractStates.set(category.id, { 
            step: 0, history: [], originalName: name, 
            ticketClient: ticketClient.id, ticketDev: null, isCancelled: false 
        });

        await interaction.reply({ content: `✅ Contrat créé : ${ticketClient}`, ephemeral: true });
    }

    // C. LOGIQUE NEXT / BACK / CANCEL (Même structure que précédemment)
    const category = interaction.channel?.parent;
    if (!category) return;
    const state = contractStates.get(category.id);
    if (!state) return;

    if (interaction.customId === 'next_step' || (interaction.isChatInputCommand() && interaction.commandName === 'next')) {
        if (state.step === 0) {
            const modalDev = new ModalBuilder().setCustomId('modal_dev').setTitle('Assigner le Développeur');
            modalDev.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('dev_tag').setLabel("Devs (@exemple)").setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('info').setLabel("Infos supp.").setStyle(TextInputStyle.Paragraph))
            );
            return await interaction.showModal(modalDev);
        }
        state.history.push(state.step);
        state.step++;
        await updateWorkflow(category, state, interaction);
    }

    if (interaction.customId === 'back_step' || (interaction.isChatInputCommand() && interaction.commandName === 'back')) {
        if (state.history.length === 0) return interaction.reply({ content: "Impossible de reculer.", ephemeral: true });
        state.step = state.history.pop();
        await updateWorkflow(category, state, interaction);
    }

    if (interaction.customId === 'cancel_contract') {
        state.isCancelled = !state.isCancelled;
        const emojiPrefix = state.isCancelled ? "🛑" : STEPS[state.step].emoji;
        await category.setName(`${emojiPrefix}-${state.originalName}`);
        await interaction.reply({ content: state.isCancelled ? "🛑 Contrat suspendu." : "✅ Contrat repris.", ephemeral: true });
    }

    if (interaction.isModalSubmit() && interaction.customId === 'modal_dev') {
        state.history.push(state.step);
        state.step = 1;
        const ticketDev = await interaction.guild.channels.create({
            name: `🛠-dev`,
            parent: category.id,
            permissionOverwrites: [
                { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                { id: CONFIG.ROLE_SECRETAIRE, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
                { id: CONFIG.ROLE_OWNER, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
            ]
        });
        state.ticketDev = ticketDev.id;
        await updateWorkflow(category, state, interaction);
        await ticketDev.send(`**Nouveau Contrat**\nDev : ${interaction.fields.getTextInputValue('dev_tag')}\nNotes : ${interaction.fields.getTextInputValue('info')}`);
        await interaction.reply({ content: "Développeur assigné.", ephemeral: true });
    }
});

async function updateWorkflow(category, state, interaction) {
    const info = STEPS[state.step];
    await category.setName(`${info.emoji}-${state.originalName}`);
    const clientChan = category.guild.channels.cache.get(state.ticketClient);
    const devChan = category.guild.channels.cache.get(state.ticketDev);

    if (state.step === 2) { clientChan?.send("🛠️ Travail en cours."); devChan?.send("🛠️ Vous pouvez commencer."); }
    if (state.step === 4) { clientChan?.send("💰 Paiement reçu !"); devChan?.send(`<@&${CONFIG.ROLE_OWNER}> payez le dev.`); }
    if (state.step === 5) {
        const secChan = await category.guild.channels.create({ name: `📍💳-payement-secrétaire`, parent: category.id });
        secChan.send(`<@&${CONFIG.ROLE_OWNER}> payez le secrétaire.`);
    }
    if (!interaction.replied) await interaction.reply({ content: `Étape : ${info.label}`, ephemeral: true });
}

client.on('messageCreate', async (message) => {
    if (message.content === '!setup-heo' && message.member.permissions.has(PermissionFlagsBits.Administrator)) {
        const channel = client.channels.cache.get(CONFIG.SALON_PROPOSITION);
        const embed = new EmbedBuilder().setTitle("📝 HEO Studio").setDescription("Cliquez pour créer un contrat.").setColor("#f1c40f");
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('btn_open_contract_modal').setLabel('Créer un Contrat').setStyle(ButtonStyle.Primary));
        await channel.send({ embeds: [embed], components: [row] });
    }
});

client.login(CONFIG.TOKEN);
