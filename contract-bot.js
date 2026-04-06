const { 
    Client, 
    GatewayIntentBits, 
    Partials, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    ChannelType, 
    PermissionsBitField, 
    EmbedBuilder, 
    ModalBuilder, 
    TextInputBuilder, 
    TextInputStyle 
} = require('discord.js');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
    partials: [Partials.Channel]
});

// Configuration des IDs
const CONFIG = {
    TOKEN: process.env.TOKEN, // Variable Railway
    GUILD_ID: '1485191413355515936',
    ROLE_OWNER: '1485191413837856966',
    ROLE_SECRETARY: '1490464910549712937',
    ROLE_STAFF: '1487848016110162153',
    CAT_PROPOSITION: '1490697124709404872' // Salon proposition
};

// Map des étapes pour la fonction Back
const STEPS = [
    { emoji: '🟡', label: 'Initialisation' },
    { emoji: '1️⃣💳', label: 'Attente 1er Paiement' },
    { emoji: '🛠️', label: 'En Développement' },
    { emoji: '2️⃣💳', label: 'Attente Paiement Final' },
    { emoji: '💰', label: 'Paiement Dev' },
    { emoji: '✅', label: 'Terminé' }
];

client.once('ready', () => {
    console.log(`Bot connecté en tant que ${client.user.tag}`);
});

// --- 1. CRÉATION DU CONTRAT (MODAL) ---
client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand() && interaction.commandName === 'create-contract') {
        const modal = new ModalBuilder()
            .setCustomId('modal_contract')
            .setTitle('Nouveau Contrat HEO');

        const fields = [
            new TextInputBuilder().setCustomId('name').setLabel("Nom du contrat").setStyle(TextInputStyle.Short).setRequired(true),
            new TextInputBuilder().setCustomId('budget').setLabel("Budget (€)").setStyle(TextInputStyle.Short).setRequired(true),
            new TextInputBuilder().setCustomId('delay').setLabel("Délai").setStyle(TextInputStyle.Short).setRequired(true),
            new TextInputBuilder().setCustomId('desc').setLabel("Description").setStyle(TextInputStyle.Paragraph).setRequired(true)
        ];

        modal.addComponents(fields.map(f => new ActionRowBuilder().addComponents(f)));
        await interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId === 'modal_contract') {
        const name = interaction.fields.getTextInputValue('name');
        const budget = interaction.fields.getTextInputValue('budget');
        const delay = interaction.fields.getTextInputValue('delay');
        
        const guild = interaction.guild;

        // Création Catégorie
        const category = await guild.channels.create({
            name: `🟡-${name}`,
            type: ChannelType.GuildCategory,
        });

        // Ticket Client
        const clientTicket = await guild.channels.create({
            name: `💼-client`,
            type: ChannelType.GuildText,
            parent: category.id,
            permissionOverwrites: [
                { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel] },
                { id: CONFIG.ROLE_SECRETARY, allow: [PermissionsBitField.Flags.ViewChannel] },
                { id: CONFIG.ROLE_OWNER, allow: [PermissionsBitField.Flags.ViewChannel] },
                { id: CONFIG.ROLE_STAFF, allow: [PermissionsBitField.Flags.ViewChannel] },
            ]
        });

        const welcomeEmbed = new EmbedBuilder()
            .setTitle('🛡️ Sécurité HEO')
            .setDescription(`Bienvenue. Un secrétaire va s'occuper de vous.\n\n**ATTENTION :** Un secrétaire ne demandera jamais de paiement direct. Tout passe par le PayPal officiel ou le groupe HEO. En cas de comportement suspect, pinge <@&${CONFIG.ROLE_STAFF}>.`)
            .setColor('Red');

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('step_choose_dev').setLabel('Choisir Dev').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('contract_back').setLabel('🔙').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('contract_cancel').setLabel('🛑 Annuler').setStyle(ButtonStyle.Danger)
        );

        await clientTicket.send({ content: `Client: ${interaction.user} | Staff: <@&${CONFIG.ROLE_SECRETARY}>`, embeds: [welcomeEmbed], components: [row] });
        await interaction.reply({ content: `Contrat créé : ${category.name}`, ephemeral: true });
    }

    // --- 3. CHOIX DU DEV (MODAL) ---
    if (interaction.isButton() && interaction.customId === 'step_choose_dev') {
        const modal = new ModalBuilder().setCustomId('modal_dev').setTitle('Assigner un Développeur');
        const devInput = new TextInputBuilder().setCustomId('dev_id').setLabel("ID ou Mention du Dev").setStyle(TextInputStyle.Short).setPlaceholder("@exemple").setRequired(true);
        const infoInput = new TextInputBuilder().setCustomId('extra_info').setLabel("Infos supplémentaires").setStyle(TextInputStyle.Paragraph).setRequired(false);
        
        modal.addComponents(new ActionRowBuilder().addComponents(devInput), new ActionRowBuilder().addComponents(infoInput));
        await interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId === 'modal_dev') {
        const devId = interaction.fields.getTextInputValue('dev_id').replace(/[<@!>]/g, '');
        const category = interaction.channel.parent;

        // Création Ticket Dev
        const devTicket = await interaction.guild.channels.create({
            name: `🛠-dev-discussion`,
            parent: category.id,
            permissionOverwrites: [
                { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                { id: CONFIG.ROLE_SECRETARY, allow: [PermissionsBitField.Flags.ViewChannel] },
                { id: devId, allow: [PermissionsBitField.Flags.ViewChannel] },
            ]
        });

        await category.setName(category.name.replace('🟡', '1️⃣💳'));
        await interaction.channel.send("✅ Développeur choisi. En attente du premier paiement.");
        await devTicket.send(`Ticket Dev créé. En attente du premier paiement du client.`);
        
        // Mise à jour des boutons du ticket client
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('step_paid_1').setLabel('1er Paiement Reçu').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('contract_back').setLabel('🔙').setStyle(ButtonStyle.Secondary)
        );
        await interaction.reply({ content: "Ticket Dev créé !", ephemeral: true });
        await interaction.channel.send({ content: "Action suivante :", components: [row] });
    }

    // --- 4 & 5. LOGIQUE DES ÉTAPES (SUIVANT / RETOUR / ANNULER) ---
    if (interaction.isButton()) {
        const category = interaction.channel.parent;
        
        // BOUTON ANNULER
        if (interaction.customId === 'contract_cancel') {
            await category.setName(`🛑-${category.name.split('-')[1]}`);
            return interaction.reply("Contrat annulé 🛑");
        }

        // BOUTON PREMIER PAIEMENT -> DÉV
        if (interaction.customId === 'step_paid_1') {
            await category.setName(category.name.replace('1️⃣💳', '🛠️'));
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('step_work_done').setLabel('Travail Terminé').setStyle(ButtonStyle.Primary)
            );
            await interaction.reply({ content: "🛠️ Premier paiement reçu, le dev peut commencer.", components: [row] });
        }

        // BOUTON TRAVAIL FINI -> PAIEMENT 2
        if (interaction.customId === 'step_work_done') {
            await category.setName(category.name.replace('🛠️', '2️⃣💳'));
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('step_paid_final').setLabel('Paiement Final Reçu').setStyle(ButtonStyle.Success)
            );
            await interaction.reply({ content: "💰 Travail fini ! En attente du paiement final.", components: [row] });
        }

        // PAIEMENT FINAL -> PAYER LE DEV
        if (interaction.customId === 'step_paid_final') {
            await category.setName(category.name.replace('2️⃣💳', '💰'));
            await interaction.channel.setName(`✅-${interaction.channel.name}`);
            await interaction.reply(`✅ Paiement final reçu. <@&${CONFIG.ROLE_OWNER}> merci de payer le développeur.`);
            
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('step_dev_paid').setLabel('Dev Payé').setStyle(ButtonStyle.Primary)
            );
            await interaction.channel.send({ components: [row] });
        }
    }
});

client.login(CONFIG.TOKEN);
