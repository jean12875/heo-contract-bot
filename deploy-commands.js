const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const commands = [
    new SlashCommandBuilder()
        .setName('contrat')
        .setDescription('Ouvre le formulaire de création de contrat'),
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
    try {
        console.log('⏳ Enregistrement de la commande /contrat...');
        await rest.put(
            Routes.applicationCommands('1490751731154554932'),
            { body: commands },
        );
        console.log('✅ Commande /contrat enregistrée !');
    } catch (error) {
        console.error('❌ Erreur :', error);
    }
})();
