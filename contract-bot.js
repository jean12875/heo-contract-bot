const { 
    Client, GatewayIntentBits, Partials, PermissionFlagsBits, 
    ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, 
    ModalBuilder, TextInputBuilder, TextInputStyle, ChannelType 
} = require('discord.js');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers],
    partials: [Partials.Channel],
});

const CONFIG = {
    TOKEN: process.env.TOKEN,
    ROLE_OWNER: "1485191413837856966",
    ROLE_SECRETAIRE: "1490464910549712937",
    ROLE_STAFF: "1487848016110162153",
    SALON_PROPOSITION: "1490697124709404872",
    ROLE_URGENCE: "<@&1485191413837856966>"
};

// Mémoire vive du bot pour gérer les Back et Annulations
const contractStates = new Map();

const STEPS = {
    0: { emoji: '🟡', label: 'Initialisation' },
    1: { emoji: '1️⃣💳', label: 'Attente 1er paiement' },
    2: { emoji: '🛠️', label: 'Développement' },
    3: { emoji: '2️⃣💳', label: 'Attente paiement final' },
    4: { emoji: '💰', label: 'Payement Dev' },
    5: { emoji: '✅', label: 'Payement Secrétaire' }
};

client.once('ready', () => { console.log("✅ Bot HEO v3 opérationnel"); });

client.on('interactionCreate', async interaction => {
    // 1. COMMANDE / BOUTON CRÉATION
    if ((interaction.isButton() && interaction.customId === 'btn_open_contract_modal') || (interaction.isChatInputCommand() && interaction.commandName === 'contrat')) {
        const modal = new ModalBuilder().setCustomId('modal_create').setTitle('📋 Nouveau Contrat HEO Studio');
        modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('name').setLabel("Nom du contrat").setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('budget').setLabel("Budget (€)").setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('deadline').setLabel("Délai").setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('desc').setLabel("Description du projet").setStyle(TextInputStyle.Paragraph).setRequired(true))
        );
        return await interaction.showModal(modal);
    }

    // 2. LOGIQUE DES ÉTAPES (NEXT / BACK / CANCEL / DELETE)
    const isCommand = interaction.isChatInputCommand();
    const isButton = interaction.isButton();
    const category = interaction.channel?.parent;
    const state = category ? contractStates.get(category.id) : null;

    if (state) {
        // --- BOUTON SUPPRIMER ---
        if (interaction.customId === 'delete_all') {
            const channels = category.children.cache;
            for (const c of channels.values()) await c.delete();
            await category.delete();
            return;
        }

        // --- COMMANDE NEXT OU BOUTON SUIVANT ---
        if ((isButton && interaction.customId === 'next_step') || (isCommand && interaction.commandName === 'next')) {
            if (state.step === 0) {
                const modalDev = new ModalBuilder().setCustomId('modal_dev').setTitle('Assigner le Développeur');
                modalDev.addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('dev_tag').setLabel("Mention du Dev (@nom)").setStyle(TextInputStyle.Short).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('info').setLabel("Infos supp.").setStyle(TextInputStyle.Paragraph))
                );
                return await interaction.showModal(modalDev);
            }
            if (state.step >= 5) return interaction.reply({ content: "Contrat déjà terminé.", ephemeral: true });
            
            state.history.push({ step: state.step, name: category.name });
            state.step++;
            await updateWorkflow(category, state, interaction);
        }

        // --- COMMANDE BACK OU BOUTON RETOUR ---
        if ((isButton && interaction.customId === 'back_step') || (isCommand && interaction.commandName === 'back')) {
            if (state.history.length === 0) return interaction.reply({ content: "Impossible de revenir en arrière.", ephemeral: true });
            const lastState = state.history.pop();
            state.step = lastState.step;
            await updateWorkflow(category, state, interaction);
        }

        // --- BOUTON ANNULER ---
        if (isButton && interaction.customId === 'cancel_contract') {
            state.isCancelled = !state.isCancelled;
            const prefix = state.isCancelled ? "🛑" : STEPS[state.step].emoji;
            await category.setName(`${prefix}-${state.originalName}`);
            await interaction.reply({ content: state.isCancelled ? "🛑 Contrat suspendu." : "✅ Contrat repris.", ephemeral: true });
        }
    }

    // 3. SOUMISSION DES FORMULAIRES (MODALS)
    if (interaction.isModalSubmit()) {
        await interaction.deferReply({ ephemeral: true });

        if (interaction.customId === 'modal_create') {
            const name = interaction.fields.getTextInputValue('name');
            const cat = await interaction.guild.channels.create({ name: `🟡-${name}`, type: ChannelType.GuildCategory });
            const ticketClient = await interaction.guild.channels.create({
                name: `💼-client`,
                parent: cat.id,
                permissionOverwrites: [
                    { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                    { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
                    { id: CONFIG.ROLE_SECRETAIRE, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
                    { id: CONFIG.ROLE_OWNER, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
                    { id: CONFIG.ROLE_STAFF, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
                ]
            });

            const embedInfo = new EmbedBuilder().setTitle(`💼 Contrat : ${name}`).setColor('#f1c40f').addFields(
                { name: '💰 Budget', value: interaction.fields.getTextInputValue('budget') + '€', inline: true },
                { name: '⏳ Délai', value: interaction.fields.getTextInputValue('deadline'), inline: true },
                { name: '📝 Description', value: interaction.fields.getTextInputValue('desc') }
            );

            const embedSafety = new EmbedBuilder().setTitle("🛡️ SÉCURITÉ").setColor('#ff0000').setDescription(`Paiement uniquement via PayPal HEO. En cas de doute : ${CONFIG.ROLE_URGENCE}`);

            const buttons = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('next_step').setLabel('Suivant ➡️').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('back_step').setLabel('🔙').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('cancel_contract').setLabel('🛑 Annuler').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('delete_all').setLabel('🗑️').setStyle(ButtonStyle.Danger)
            );

            await ticketClient.send({ content: `${interaction.user} | <@&${CONFIG.ROLE_SECRETAIRE}>`, embeds: [embedInfo, embedSafety], components: [buttons] });
            contractStates.set(cat.id, { step: 0, history: [], originalName: name, ticketClient: ticketClient.id, ticketDev: null });
            await interaction.editReply("✅ Contrat initialisé.");
        }

        if (interaction.customId === 'modal_dev') {
            const devId = interaction.fields.getTextInputValue('dev_tag').replace(/[<@!>]/g, '');
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

            state.history.push({ step: state.step, name: category.name });
            state.step = 1;
            state.ticketDev = ticketDev.id;
            await updateWorkflow(category, state);
            await ticketDev.send(`🛠 **Ticket Développeur**\nDev : <@${devId}>\nNotes : ${interaction.fields.getTextInputValue('info')}\n\nAttente du 1er paiement.`);
            await interaction.editReply("✅ Développeur assigné.");
        }
    }
});

async function updateWorkflow(category, state, interaction = null) {
    const info = STEPS[state.step];
    await category.setName(`${info.emoji}-${state.originalName}`);
    
    const clientChan = category.guild.channels.cache.get(state.ticketClient);
    const devChan = category.guild.channels.cache.get(state.ticketDev);

    if (state.step === 1) clientChan?.send("1️⃣ Attente du premier paiement...");
    if (state.step === 2) { clientChan?.send("🛠️ Travail en cours."); devChan?.send("🛠️ Payement reçu, commencez le travail."); }
    if (state.step === 4) { 
        await clientChan?.setName(`✅-client`);
        clientChan?.send("💰 Paiement final reçu !");
        devChan?.send(`<@&${CONFIG.ROLE_OWNER}> : Merci de payer le développeur.`); 
    }
    if (state.step === 5) {
        const secChan = await category.guild.channels.create({ name: `📍💳-secrétaire`, parent: category.id });
        secChan.send(`<@&${CONFIG.ROLE_OWNER}> : Merci de payer la commission du secrétaire.`);
    }

    if (interaction && !interaction.replied) await interaction.deferUpdate().catch(() => {});
}

// Commande de setup du bouton
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
