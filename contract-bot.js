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
    SALON_PROPOSITION: "1490697124709404872"
};

// État des contrats (Mémoire du bot)
const contractStates = new Map();

const STEPS = {
    0: { emoji: '🟡', label: 'Initialisation' },
    1: { emoji: '1️⃣💳', label: 'Attente 1er paiement' },
    2: { emoji: '🛠️', label: 'Développement' },
    3: { emoji: '2️⃣💳', label: 'Attente paiement final' },
    4: { emoji: '💰', label: 'Payement Dev' },
    5: { emoji: '✅', label: 'Payement Secrétaire' }
};

client.once('ready', () => {
    console.log(`✅ HEO Studio Bot en ligne !`);
});

// --- LOGIQUE D'INTERACTION ---
client.on('interactionCreate', async interaction => {

    // A. OUVERTURE DU MODAL (Via Bouton Salon Proposition ou Commande)
    if (
        (interaction.isButton() && interaction.customId === 'btn_open_contract_modal') ||
        (interaction.isChatInputCommand() && interaction.commandName === 'contrat')
    ) {
        const modal = new ModalBuilder().setCustomId('modal_create').setTitle('📋 Nouveau Contrat HEO Studio');
        modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('name').setLabel("Nom du contrat").setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('budget').setLabel("Budget (€)").setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('deadline').setLabel("Délai").setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('desc').setLabel("Description du projet").setStyle(TextInputStyle.Paragraph).setRequired(true))
        );
        return await interaction.showModal(modal);
    }

    // B. CRÉATION EFFECTIVE (SUBMIT MODAL)
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
            .setTitle(`💼 Ticket Client - ${name}`)
            .setColor('#f1c40f')
            .setDescription(`**ATTENTION SÉCURITÉ**\nJamais un secrétaire ne vous demandera de payer directement. Tout passe par le PayPal officiel HEO.\n\nEn cas de doute : <@&${CONFIG.ROLE_STAFF}>`)
            .addFields({ name: 'Budget', value: `${budget}€`, inline: true });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('next_step').setLabel('Suivant ➡️').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('back_step').setLabel('🔙').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('cancel_contract').setLabel('🛑 Annuler').setStyle(ButtonStyle.Danger)
        );

        await ticketClient.send({ content: `<@${interaction.user.id}> | <@&${CONFIG.ROLE_SECRETAIRE}>`, embeds: [embed], components: [row] });
        
        contractStates.set(category.id, { 
            step: 0, history: [], originalName: name, 
            ticketClient: ticketClient.id, ticketDev: null, isCancelled: false 
        });

        await interaction.reply({ content: `✅ Contrat créé : ${ticketClient}`, ephemeral: true });
    }

    // C. GESTION DES ÉTAPES (NEXT / BACK / CANCEL)
    const category = interaction.channel?.parent;
    if (!category) return;
    const state = contractStates.get(category.id);
    if (!state) return;

    const isNext = interaction.customId === 'next_step' || (interaction.isChatInputCommand() && interaction.commandName === 'next');
    const isBack = interaction.customId === 'back_step' || (interaction.isChatInputCommand() && interaction.commandName === 'back');
    const isCancel = interaction.customId === 'cancel_contract';

    if (isNext) {
        if (state.step === 0) { // Demander le Dev
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

    if (isBack) {
        if (state.history.length === 0) return interaction.reply({ content: "Impossible de reculer.", ephemeral: true });
        state.step = state.history.pop();
        await updateWorkflow(category, state, interaction);
    }

    if (isCancel) {
        state.isCancelled = !state.isCancelled;
        const emojiPrefix = state.isCancelled ? "🛑" : STEPS[state.step].emoji;
        await category.setName(`${emojiPrefix}-${state.originalName}`);
        await interaction.reply({ content: state.isCancelled ? "🛑 Contrat suspendu." : "✅ Contrat repris.", ephemeral: true });
    }

    // D. MODAL DÉVELOPPEUR
    if (interaction.isModalSubmit() && interaction.customId === 'modal_dev') {
        state.history.push(state.step);
        state.step = 1;
        const devTag = interaction.fields.getTextInputValue('dev_tag');
        
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
        await ticketDev.send(`**Nouveau Contrat**\nDev : ${devTag}\nAttente du 1er paiement.`);
        await interaction.channel.send(`✅ Développeur assigné. Le salon dev est prêt.`);
    }
});

// --- FONCTION DE MISE À JOUR DU WORKFLOW ---
async function updateWorkflow(category, state, interaction) {
    const info = STEPS[state.step];
    await category.setName(`${info.emoji}-${state.originalName}`);
    
    const clientChan = category.guild.channels.cache.get(state.ticketClient);
    const devChan = category.guild.channels.cache.get(state.ticketDev);

    if (state.step === 2) {
        clientChan?.send("🛠️ Premier paiement reçu. Le travail commence !");
        devChan?.send("🛠️ Go ! Premier paiement validé.");
    }
    if (state.step === 4) {
        await clientChan?.setName(`✅-client`);
        clientChan?.send("💰 Paiement final reçu !");
        devChan?.send(`<@&${CONFIG.ROLE_OWNER}> : Merci de payer le développeur.`);
    }
    if (state.step === 5) {
        const secChan = await category.guild.channels.create({
            name: `📍💳-paiement-secrétaire`,
            parent: category.id
        });
        secChan.send(`<@&${CONFIG.ROLE_OWNER}> : Merci de payer la commission du secrétaire.`);
    }

    if (!interaction.replied) await interaction.reply({ content: `Passage à : ${info.label}`, ephemeral: true });
}

// --- SETUP DU SALON DE PROPOSITION (ADMIN) ---
client.on('messageCreate', async (message) => {
    if (message.content === '!setup-heo' && message.member.permissions.has(PermissionFlagsBits.Administrator)) {
        const channel = client.channels.cache.get(CONFIG.SALON_PROPOSITION);
        const embed = new EmbedBuilder()
            .setTitle("📝 HEO Studio - Nouveau Contrat")
            .setDescription("Cliquez sur le bouton pour lancer une procédure de contrat.")
            .setColor("#f1c40f");

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('btn_open_contract_modal').setLabel('Créer un Contrat').setEmoji('🎫').setStyle(ButtonStyle.Primary)
        );

        await channel.send({ embeds: [embed], components: [row] });
        message.delete();
    }
});

client.login(CONFIG.TOKEN);
