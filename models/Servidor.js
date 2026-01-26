const mongoose = require('mongoose');

const servidorSchema = new mongoose.Schema({
    spreadsheetId: { type: String, maxlength: 500 },
    sheetName: { type: String, maxlength: 500 },
    cargoPermitido: { type: String, maxlength: 500 },
    responsavelHoras: { type: String, maxlength: 500 },
    channelId: { type: String, maxlength: 500 },
    guildId: { type: String, unique: true, required: true },
    showEmbed: { type: Boolean, default: true }
});

const Servidor = mongoose.model('Servidor', servidorSchema);

const saveConfig = async (config) => {
    try {
        await Servidor.findOneAndUpdate(
            { guildId: config.guildId },
            config,
            { upsert: true, new: true }
        );
        console.log('✅ Configuração salva no banco');
    } catch (error) {
        console.error('❌ Erro ao salvar:', error.message);
        throw new Error('Erro ao salvar a configuração no banco de dados');
    }
};

module.exports = {
    saveConfig,
    Servidor
};