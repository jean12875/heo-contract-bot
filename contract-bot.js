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
    TOKEN: process.env.TOKEN, // Variable Railway
    ROLE_OWNER: "1485191413837856966",
    ROLE_SECRETAIRE: "1490464910549712937",
    ROLE_STAFF: "1487848016110162153",
    GUILD_ID: "1485191413355515936"
};

const contractStates = new Map();

// Configuration des étapes
const STEPS = {
    0: { emoji: '🟡', label: 'Initialisation' },
    1: { emoji: '1️⃣💳', label: 'Attente 1er paiement' },
    2: { emoji: '🛠️', label: 'Développement' },
    3: { emoji: '2️⃣💳', label: 'Attente paiement final' },
    4: { emoji: '💰', label: 'Paiement dév en cours' },
    5: { emoji: '✅', label: 'Paiement secrétaire' },
    6: { emoji: '🏁', label: 'Contrat terminé' }
};

client.once('ready', () => {
    console.log(`✅ HEO Bot prêt sur Railway !`);
});

client.on('interactionCreate', async interaction => {
    // 1. CRÉATION DU CONTRAT (MODAL)
    if (interaction.isChatInputCommand() && interaction.commandName === 'contrat') {
        const modal = new ModalBuilder().setCustomId('modal_create').setTitle('📋 Nouveau Contrat');
        modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('name').setLabel("Nom du contrat").setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('budget').setLabel("Budget (€)").setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('deadline').setLabel("Délai").setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('desc').setLabel("Description").setStyle(TextInputStyle.Paragraph).setRequired(true))
        );
        return await interaction.showModal(modal);
    }

    // GESTION DU SUBMIT MODAL CRÉATION
    if (interaction.isModalSubmit() && interaction.customId === 'modal_create') {
        const name = interaction.fields.getTextInputValue('name');
        const budget = interaction.fields.getTextInputValue('budget');

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

        const embed = new EmbedBuilder()
            .setTitle(`💼 Contrat : ${name}`)
            .setColor('#f1c40f')
            .setDescription(`**SÉCURITÉ :** Tout paiement doit passer par le compte officiel HEO.\nEn cas de doute : @🚨 • Urgence`)
            .addFields({ name: 'Budget', value: `${budget}€`, inline: true });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('btn_next').setLabel('Étape Suivante ➡️').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('btn_back').setLabel('🔙').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('btn_cancel').setLabel('🛑 Annuler').setStyle(ButtonStyle.Danger)
        );

        await ticketClient.send({ content: `<@&${CONFIG.ROLE_SECRETAIRE}>`, embeds: [embed], components: [row] });
        
        contractStates.set(category.id, { 
            step: 0, history: [], originalName: name, clientId: interaction.user.id,
            ticketClient: ticketClient.id, ticketDev: null, isCancelled: false 
        });

        await interaction.reply({ content: `✅ Contrat initialisé : ${ticketClient}`, ephemeral: true });
    }

    // 2. LOGIQUE DES BOUTONS ET COMMANDES /NEXT /BACK
    const category = interaction.channel?.parent;
    if (!category) return;
    const state = contractStates.get(category.id);
    if (!state) return;

    const isNext = interaction.customId === 'btn_next' || (interaction.isChatInputCommand() && interaction.commandName === 'next');
    const isBack = interaction.customId === 'btn_back' || (interaction.isChatInputCommand() && interaction.commandName === 'back');
    const isCancel = interaction.customId === 'btn_cancel';

    if (isNext) {
        if (state.step === 0) { // Demander le Dev
            const modalDev = new ModalBuilder().setCustomId('modal_dev').setTitle('Assigner le Développeur');
            modalDev.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('dev_tags').setLabel("Tags Dev (ex: @user1, @user2)").setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('infos').setLabel("Infos additionnelles").setStyle(TextInputStyle.Paragraph))
            );
            return await interaction.showModal(modalDev);
        }
        state.history.push(state.step);
        state.step++;
        await handleTransition(category, state, interaction);
    }

    if (isBack) {
        if (state.history.length === 0) return interaction.reply({ content: "Retour impossible.", ephemeral: true });
        state.step = state.history.pop();
        await handleTransition(category, state, interaction, true);
    }

    if (isCancel) {
        state.isCancelled = !state.isCancelled;
        const prefix = state.isCancelled ? "🛑" : STEPS[state.step].emoji;
        await category.setName(`${prefix}-${state.originalName}`);
        await interaction.reply({ content: state.isCancelled ? "🛑 Contrat annulé." : "✅ Contrat repris.", ephemeral: true });
    }

    // MODAL ASSIGNATION DEV
    if (interaction.isModalSubmit() && interaction.customId === 'modal_dev') {
        state.history.push(state.step);
        state.step = 1;
        const devTags = interaction.fields.getTextInputValue('dev_tags');
        
        const ticketDev = await interaction.guild.channels.create({
            name: `🛠-dev`,
            parent: category.id,
            type: ChannelType.GuildText,
            permissionOverwrites: [
                { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                { id: CONFIG.ROLE_SECRETAIRE, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
                { id: CONFIG.ROLE_OWNER, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
            ]
        });
        state.ticketDev = ticketDev.id;
        
        await handleTransition(category, state, interaction);
        await ticketDev.send(`**Nouveau Contrat Dev**\nDéveloppeurs : ${devTags}\n\n*Attente du premier paiement...*`);
        await interaction.channel.send(`🛠️ Développeur choisi. Un message a été envoyé dans le salon client.`);
    }
});

// FONCTION DE TRANSITION (Gère les changements d'emojis et salons)
async function handleTransition(category, state, interaction, isBack = false) {
    const stepInfo = STEPS[state.step];
    await category.setName(`${stepInfo.emoji}-${state.originalName}`);
    
    const clientChan = category.guild.channels.cache.get(state.ticketClient);
    const devChan = category.guild.channels.cache.get(state.ticketDev);

    switch(state.step) {
        case 1: // Attente 1er paiement
            [clientChan, devChan].forEach(c => c?.send("⏳ Attente du premier paiement..."));
            break;
        case 2: // Début Travail
            [clientChan, devChan].forEach(c => c?.send("🛠️ Premier paiement effectué ! Le travail commence."));
            break;
        case 3: // Attente Paiement Final
            await category.setName(`2️⃣💳-${state.originalName}`);
            [clientChan, devChan].forEach(c => c?.send("💳 Travail terminé. Attente du paiement final."));
            break;
        case 4: // Payement Dev (Owner ping)
            await clientChan?.setName(`✅-${clientChan.name}`);
            clientChan?.send("✅ Deuxième paiement effectué.");
            devChan?.send(`<@&${CONFIG.ROLE_OWNER}> : Merci de payer le développeur.`);
            break;
        case 5: // Payement Secrétaire
            if (devChan) {
                await devChan.setName(`✅-${devChan.name}`);
                // On retire le dev du salon selon ton souhait
                // logic: remove dev permissions here
            }
            const secTicket = await category.guild.channels.create({
                name: `📍💳-paiement-secrétaire`,
                parent: category.id,
                type: ChannelType.GuildText
            });
            secTicket.send(`<@&${CONFIG.ROLE_OWNER}> : Attente du paiement du secrétaire.`);
            break;
    }

    if (!interaction.replied) await interaction.reply({ content: `Passage à l'étape : ${stepInfo.label}`, ephemeral: true });
}

client.login(CONFIG.TOKEN);
