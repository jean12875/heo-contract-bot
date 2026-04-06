const { REST, Routes, SlashCommandBuilder } = require('discord.js');

// On définit la commande
const commands = [
    new SlashCommandBuilder()
        .setName('create-contract')
        .setDescription('Ouvre le formulaire de création de contrat'),
].map(command => command.toJSON());

// On prépare l'envoi à Discord
// Note : Le TOKEN sera récupéré depuis les variables Railway
const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
    try {
        console.log('⏳ Enregistrement de la commande /create-contract...');

        await rest.put(
            // Remplace bien par l'ID de TON bot : 1490751731154554932
            Routes.applicationCommands('1490751731154554932'),
            { body: commands },
        );

        console.log('✅ Commande enregistrée ! Elle apparaîtra sur Discord d\'ici quelques minutes.');
    } catch (error) {
        console.error('❌ Erreur lors de l\'enregistrement :', error);
    }
})();
