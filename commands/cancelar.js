const { PointCard } = require('../models/pointCard');
const { Servidor } = require('../models/Servidor');
const { sendToGoogleSheets, getUserRowCached } = require('../utils/googleSheets');
const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const path = require('path');
const credentialsPath = path.resolve(__dirname, '../credentials.json');
const { google } = require('googleapis');

// Singleton para o cliente do Google Sheets
let sheetsClient = null;
async function getSheetsClient() {
    if (!sheetsClient) {
        const auth = new google.auth.GoogleAuth({
            keyFile: credentialsPath,
            scopes: ["https://www.googleapis.com/auth/spreadsheets"],
        });
        const authClient = await auth.getClient();
        sheetsClient = google.sheets({ version: "v4", auth: authClient });
    }
    return sheetsClient;
}

// Modificar a estrutura do cache para ser por servidor
const serverConfigCache = new Map();
const userRowCache = new Map();
const sheetsClientsCache = new Map();

// Adicionar as constantes de TTL que estavam faltando
const SERVER_CACHE_TTL = 60 * 60 * 1000; // 1 hora em milissegundos
const CACHE_TTL = 60 * 60 * 1000; // 1 hora em milissegundos

class CacheManager {
    constructor() {
        this.caches = new Map();
    }

    getServerCache(guildId) {
        if (!this.caches.has(guildId)) {
            this.caches.set(guildId, {
                config: new Map(),
                userRows: new Map(),
                sheetsClient: null,
                lastCleanup: Date.now()
            });
        }
        return this.caches.get(guildId);
    }

    cleanup() {
        const now = Date.now();
        for (const [guildId, cache] of this.caches.entries()) {
            if (now - cache.lastCleanup > 24 * 60 * 60 * 1000) { // Limpar cache a cada 24h
                this.caches.delete(guildId);
            }
        }
    }
}

const cacheManager = new CacheManager();

// Sistema de Rate Limit
const rateLimits = new Map();
const RATE_LIMIT = {
    MAX_REQUESTS: 5,    // Máximo de 5 requisições
    TIME_WINDOW: 150000, // Janela de tempo (1 minuto)
    COOLDOWN: 30000    // Tempo de espera após atingir o limite (30 segundos)
};

// Configuração de logging
const LOGGING = {
    verbose: false,
    debug: false,
    errors: true
};

const PERFORMANCE_THRESHOLDS = {
    SHEET_UPDATE: 5000,
    TOTAL_COMMAND: 10000
};

function logPerformance(operation, duration, guildId) {
    if (duration > PERFORMANCE_THRESHOLDS[operation]) {
        console.warn(`[Performance] ${operation} demorou ${duration}ms no servidor ${guildId}`);
    }
}

/**
 * Verifica o rate limit do usuário
 * @param {string} userId ID do usuário
 * @returns {boolean|number} false se pode prosseguir, ou tempo restante se em cooldown
 */
function checkRateLimit(userId) {
    const now = Date.now();
    const userLimit = rateLimits.get(userId);

    if (!userLimit) {
        rateLimits.set(userId, {
            count: 1,
            firstRequest: now,
            lastRequest: now
        });
        return false;
    }

    // Reseta o contador se passou a janela de tempo
    if (now - userLimit.firstRequest > RATE_LIMIT.TIME_WINDOW) {
        userLimit.count = 1;
        userLimit.firstRequest = now;
        userLimit.lastRequest = now;
        return false;
    }

    // Verifica cooldown
    if (userLimit.count >= RATE_LIMIT.MAX_REQUESTS) {
        const timeLeft = RATE_LIMIT.COOLDOWN - (now - userLimit.lastRequest);
        if (timeLeft > 0) {
            return timeLeft;
        }
        // Reseta após cooldown
        userLimit.count = 1;
        userLimit.firstRequest = now;
    } else {
        userLimit.count++;
    }

    userLimit.lastRequest = now;
    return false;
}

/**
 * Busca configuração do servidor com cache
 * @param {string} guildId ID do servidor
 * @returns {Promise<Object>} Configuração do servidor
 */
async function getServerConfig(guildId) {
    const now = Date.now();
    const cached = serverConfigCache.get(guildId);
    
    if (cached && now - cached.timestamp < SERVER_CACHE_TTL) {
        return cached.config;
    }

    const config = await Servidor.findOne({ guildId }).lean();
    if (config) {
        serverConfigCache.set(guildId, { config, timestamp: now });
    }
    return config;
}

/**
 * Busca a linha do usuário na planilha com cache
 * @param {string} userId ID do usuário
 * @param {string} spreadsheetId ID da planilha
 * @param {string} sheetName Nome da aba
 * @param {string} guildId ID do servidor
 * @returns {Promise<number|null>} Número da linha ou null se não encontrado
 */
async function getUserRowWithCache(userId, spreadsheetId, sheetName, guildId) {
    const serverCache = cacheManager.getServerCache(guildId);
    const cacheKey = `${userId}-${spreadsheetId}-${sheetName}`;
    const cached = serverCache.userRows.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.row;
    }

    try {
        const sheets = await getSheetsClient();
        const row = await getUserRowCached(sheets, spreadsheetId, sheetName, userId);
        
        if (row) {
            serverCache.userRows.set(cacheKey, { 
                row, 
                timestamp: Date.now() 
            });
        }
        return row;
    } catch (error) {
        console.error(`[Cancelar] Erro ao buscar linha do usuário ${userId}:`, error);
        return null;
    }
}

async function handleCancelarCommand(interaction) {
    try {
        const servidor = await getServerConfig(interaction.guild.id).catch(error => {
            console.error('[Cancelar] Erro ao buscar configuração do servidor:', error);
            return null;
        });

        if (!servidor) {
            try {
                return await interaction.reply({
                    content: '⚠️ Erro ao carregar configurações do servidor. Por favor, tente novamente.',
                    ephemeral: true
                });
            } catch (error) {
                if (error.code === 10062) {
                    console.warn('[Cancelar] Interação expirada ao tentar responder');
                    return;
                }
                throw error;
            }
        }

        if (!servidor?.responsavelHoras) {
            try {
                return await interaction.reply({
                    content: '⚠️ Configuração do servidor incompleta. Use `/painel`.',
                    ephemeral: true
                });
            } catch (error) {
                if (error.code === 10062) {
                    console.warn('[Cancelar] Interação expirada ao tentar responder');
                    return;
                }
                throw error;
            }
        }

        if (!interaction.member.roles.cache.has(servidor.responsavelHoras)) {
            try {
                return await interaction.reply({
                    content: `⛔ Apenas <@&${servidor.responsavelHoras}> podem usar este comando.`,
                    ephemeral: true
                });
            } catch (error) {
                if (error.code === 10062) {
                    console.warn('[Cancelar] Interação expirada ao tentar responder');
                    return;
                }
                throw error;
            }
        }

        // Mostra o modal para o usuário preencher o ID do cartão e o motivo
        const modalSubmission = await showCancelModal(interaction);
        // Se o usuário não submeteu o modal (ex: fechou), sai da função
        if (!modalSubmission) {
            return;
        }

        // *** INÍCIO DA MEDIÇÃO DE PERFORMANCE ***
        // A contagem começa APÓS a submissão do modal
        const startTime = Date.now();

        // Verificar rate limit APÓS o envio do modal
        const userId = interaction.user.id;
        const rateLimit = checkRateLimit(userId);
        if (rateLimit) {
            try {
                // Fim da contagem para este caso específico de rate limit
                const endTime = Date.now(); // Define endTime aqui para calcular o elapsed
                 const elapsed = endTime - startTime;
                 if (elapsed > 5000) { // Mantém o log de lentidão mesmo em caso de rate limit
                    console.warn(`⚠️ Comando lento (Rate Limit): 'cancelar' levou ${elapsed}ms para executar`);
                }
                // Responde ao usuário informando sobre o rate limit
                return await modalSubmission.reply({
                    content: `⏳ Você precisa aguardar ${Math.ceil(rateLimit / 1000)} segundos antes de usar este comando novamente.`,
                    ephemeral: true
                });
            } catch (error) {
                // Ignora erro se a interação já expirou
                if (error.code === 10062) {
                    console.warn('[Cancelar] Interação expirada ao tentar responder');
                    return;
                }
                throw error; // Relança outros erros
            }
        }

        // Atualizar o rate limit apenas após a verificação bem-sucedida
        rateLimits.set(userId, {
            count: 1,
            firstRequest: Date.now(), // Pode ser ajustado para startTime se quiser incluir o tempo de espera do modal
            lastRequest: Date.now()
        });

        try {
            // Defer a resposta para indicar que o bot está processando
            await modalSubmission.deferReply({ ephemeral: true });
        } catch (error) {
            // Ignora erro se a interação já expirou ao tentar deferir
            if (error.code === 10062) {
                console.warn('[Cancelar] Interação expirada ao tentar defer reply');
                // Fim da contagem para este caso específico de interação expirada
                const endTime = Date.now(); // Define endTime aqui para calcular o elapsed
                 const elapsed = endTime - startTime;
                 if (elapsed > 5000) { // Mantém o log de lentidão mesmo em caso de erro
                    console.warn(`⚠️ Comando lento (Defer Error): 'cancelar' levou ${elapsed}ms para executar`);
                }
                return;
            }
            throw error; // Relança outros erros
        }

        // Buscar dados em paralelo
        const [pointCard, servidorCompleto] = await Promise.all([
            PointCard.findOne({ 
                messageId: modalSubmission.fields.getTextInputValue('id-input'),
                guildId: interaction.guild.id 
            }).lean(),
            getServerConfig(interaction.guild.id)
        ]);

        if (!pointCard) {
            try {
                return await modalSubmission.editReply({ 
                    content: '❌ Cartão não encontrado.' 
                });
            } catch (error) {
                if (error.code === 10062) {
                    console.warn('[Cancelar] Interação expirada ao tentar editar resposta');
                    return;
                }
                throw error;
            }
        }

        // Buscar linha do usuário na planilha
        const userRow = await getUserRowWithCache(
            pointCard.userId,
            servidorCompleto.spreadsheetId,
            servidorCompleto.sheetName,
            interaction.guild.id
        );

        if (pointCard.canceled) {
            try {
                return await modalSubmission.editReply({ 
                    content: '❌ Cartão já cancelado.' 
                });
            } catch (error) {
                if (error.code === 10062) {
                    console.warn('[Cancelar] Interação expirada ao tentar editar resposta');
                    return;
                }
                throw error;
            }
        }

        if (!pointCard.startTime) {
            try {
                return await modalSubmission.editReply({ 
                    content: '❌ Cartão não iniciado.' 
                });
            } catch (error) {
                if (error.code === 10062) {
                    console.warn('[Cancelar] Interação expirada ao tentar editar resposta');
                    return;
                }
                throw error;
            }
        }

        const motivo = modalSubmission.fields.getTextInputValue('motivo-input');

        // Preparar atualizações do cartão
        const updateData = {
            $set: {
                canceledBy: interaction.user.id,
                finished: true,
                canceled: true,
                endTime: new Date(),
                accumulatedTime: 0,
                totalAccumulatedTime: 0,
                previousAccumulatedTime: 0,
                isPaused: false,
                lastPauseStart: null,
                totalPausedTime: 0
            },
            $push: {
                history: {
                    action: 'Cancelado',
                    time: new Date(),
                    user: interaction.user.tag,
                    reason: motivo
                }
            }
        };

        // Preparar atualização da planilha
        let sheetUpdatePromise = Promise.resolve();
        if (userRow) {
            const cardDate = new Date(pointCard.startTime);
            const day = cardDate.getDate();
            const columnLetter = getColumnLetter(day);
            
            if (columnLetter) {
                const ranges = [
                    `${servidorCompleto.sheetName}!${columnLetter}${userRow}`,
                    `${servidorCompleto.sheetName}!E${userRow}`
                ];
                const values = ["00:00:00", "00:00:00"];
                
                sheetUpdatePromise = updateQueue.queueUpdate(
                    interaction.guildId,
                    servidorCompleto.spreadsheetId,
                    ranges,
                    values
                );
            }
        } else {
            console.error(`[Cancelar] Usuário não encontrado na planilha (userRow é null)`);
        }

        // Executar todas as operações pesadas em paralelo
        const [updatedCard, originalUser, sheetUpdate] = await Promise.all([
            PointCard.findOneAndUpdate(
                { _id: pointCard._id },
                updateData,
                { new: true }
            ),
            interaction.client.users.fetch(pointCard.userId).catch(() => null),
            sheetUpdatePromise
        ]);

        try {
            // Atualizar mensagem e enviar log em paralelo
            await Promise.all([
                updateCancelMessage(interaction, updatedCard, motivo, originalUser),
                sheetUpdate
            ]);

            // Enviar DM para o usuário
            if (originalUser) {
                try {
                    const channel = interaction.channel;
                    const message = await channel?.messages.fetch(pointCard.messageId).catch(() => null);
                    
                    if (!message) {
                        console.error('[Cancelar] Mensagem original não encontrada');
                        try {
                            await interaction.followUp({
                                content: '⚠️ Cartão cancelado, mas a mensagem original não foi encontrada para atualizar a embed.',
                                ephemeral: true
                            });
                        } catch (error) {
                            if (error.code === 10062) {
                                console.warn('[Cancelar] Interação expirada ao tentar enviar followUp');
                            } else {
                                throw error;
                            }
                        }
                        return;
                    }

                    const buttons = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setLabel('Ver Cartão')
                            .setStyle(ButtonStyle.Link)
                            .setURL(message.url)
                            .setEmoji('🔍')
                    );

                    await originalUser.send({
                        embeds: [
                            new EmbedBuilder()
                                .setColor('#ED4245')
                                .setTitle('❌ Seu Cartão de Ponto foi Cancelado')
                                .setDescription(`Olá <@${pointCard.userId}>, seu cartão de ponto foi **cancelado**.`)
                                .addFields(
                                    { name: '👮 Cancelado por', value: `<@${interaction.user.id}>`, inline: true },
                                    { name: '📝 Motivo', value: motivo, inline: true },
                                    { name: '⏰ Data do Cancelamento', value: `🗓️ <t:${Math.floor(Date.now()/1000)}:F>`, inline: false }
                                )
                                .setThumbnail(interaction.guild.iconURL({ dynamic: true }) || null)
                                .setFooter({ text: 'Sistema de Cancelamento • Toca da Raposa', iconURL: interaction.client.user.displayAvatarURL() })
                                .setTimestamp()
                        ],
                        components: [buttons]
                    });
                } catch (err) {
                    console.error(`[Cancelar] Não foi possível enviar DM para o usuário (${pointCard.userId}):`, err);
                }
            }

            // Fim da contagem de tempo real do processamento do comando
            const endTime = Date.now();
            const elapsed = endTime - startTime;
            if (elapsed > 120000) { // 2 minutos
                console.warn(`⚠️ Comando lento: 'cancelar' levou ${elapsed}ms para executar`);
                await notifyPerformanceIssue(interaction.client, 'cancelar', elapsed, interaction);
            }

            try {
                return await modalSubmission.editReply({
                    content: '✅ **Cartão de ponto cancelado com sucesso!**' + 
                            (userRow ? ' (Planilha será atualizada em breve)' : ' (Usuário não encontrado na planilha)')
                });
            } catch (error) {
                if (error.code === 10062) {
                    console.warn('[Cancelar] Interação expirada ao tentar editar resposta final');
                    return;
                }
                throw error;
            }
        } catch (error) {
            console.error('[Cancelar] Erro ao processar cancelamento:', error);
            try {
                if (!modalSubmission.replied) {
                    return await modalSubmission.reply({
                        content: '⚠️ Ocorreu um erro ao processar o cancelamento. Por favor, tente novamente.'
                    });
                } else {
                    return await modalSubmission.editReply({
                        content: '⚠️ Ocorreu um erro ao processar o cancelamento. Por favor, tente novamente.'
                    });
                }
            } catch (editError) {
                if (editError.code === 10062) {
                    console.warn('[Cancelar] Interação expirada ao tentar editar resposta de erro');
                    return;
                }
                throw editError;
            }
        }

    } catch (error) {
        console.error('[Cancelar] Erro inesperado ao processar o comando:', error);
        try {
            if (!interaction.replied) {
                await interaction.reply({
                    content: '⚠️ Ocorreu um erro ao processar o comando. Por favor, tente novamente.',
                    ephemeral: true
                });
            } else {
                await interaction.editReply({
                    content: '⚠️ Ocorreu um erro ao processar o comando. Por favor, tente novamente.',
                    ephemeral: true
                });
            }
        } catch (replyError) {
            if (replyError.code === 10062) {
                console.warn('[Cancelar] Interação expirada ao tentar enviar mensagem de erro');
            } else {
                console.error('[Cancelar] Erro ao enviar mensagem de erro:', replyError);
            }
        }
    }
}

// Função auxiliar para gerar embed do cartão cancelado
async function generateCancelEmbed(pointCard, interaction, motivo, originalUser) {
    const embed = new EmbedBuilder()
        .setColor('#FF0000')
        .setTitle('📂 Bate-Ponto • ❌ Cancelado')
        .addFields(
            { name: '👑 Admin', value: `<@${pointCard.userId}>`, inline: false },
            { name: '👮 Cancelado por', value: `<@${interaction.user.id}>`, inline: false },
            { name: '📝 Motivo', value: motivo, inline: false },
            { name: 'Status', value: '❌ Cancelado', inline: false }
        );

    if (pointCard.history && pointCard.history.length > 0) {
        const historyEntries = pointCard.history.map(entry => {
            const date = entry.time ? new Date(entry.time) : null;
            let emoji = '❓';
            if (entry.action.includes('Início')) emoji = '🟢';
            else if (entry.action.includes('Pausado')) emoji = '⏸️';
            else if (entry.action.includes('Volta')) emoji = '🔄';
            else if (entry.action.includes('Finalizado')) emoji = '🔴';
            else if (entry.action.includes('Cancelado')) emoji = '❌';

            const formattedDate = date
                ? `🗓️ <t:${Math.floor(date.getTime() / 1000)}:F>`
                : 'Data não registrada';

            return `${emoji} ${entry.action}\n> ${formattedDate}`;
        });

        if (historyEntries.length > 0) {
            embed.addFields({
                name: '\u200B',
                value: historyEntries.join('\n\n'),
                inline: false
            });
        }
    }

    embed.addFields({
        name: '⏱️ Tempo Total',
        value: '**00:00:00**',
        inline: false
    });

    embed.setFooter({
        text: 'Sistema de Cancelamento • Desenvolvido por toca da raposa',
        iconURL: interaction.guild.iconURL() || null
    }).setTimestamp();

    return embed;
}

// Função auxiliar para gerar embed do log
function generateLogEmbed(pointCard, interaction, motivo, originalUser) {
    return new EmbedBuilder()
        .setColor('#FF0000')
        .setTitle('⚠️ Cartão de Ponto Cancelado • Log')
        .setDescription(`Um cartão de ponto foi cancelado no servidor ${interaction.guild.name}`)
        .addFields(
            { name: '👑 Admin', value: `<@${pointCard.userId}>`, inline: true },
            { name: '👮 Responsável', value: `<@${interaction.user.id}>`, inline: true },
            { name: '📝 Motivo', value: motivo.slice(0, 1024), inline: false },
            { name: '⏰ Data do Cancelamento', value: `🗓️ <t:${Math.floor(Date.now()/1000)}:F>`, inline: true },
            { name: '🆔 ID do Cartão', value: pointCard.messageId, inline: true }
        )
        .setThumbnail(interaction.guild.iconURL({ dynamic: true }) || null)
        .setFooter({
            text: 'Sistema de Cancelamento • Toca da Raposa',
            iconURL: interaction.client.user.displayAvatarURL()
        })
        .setTimestamp();
}

// Função auxiliar para obter emoji do histórico
function getHistoryEmoji(action) {
    if (action.includes('Início')) return '🟢';
    if (action.includes('Pausado')) return '⏸️';
    if (action.includes('Volta')) return '🔄';
    if (action.includes('Finalizado')) return '🔴';
    if (action.includes('Cancelado')) return '❌';
    return '❓';
}

// Função auxiliar para formatar data do histórico
function formatHistoryDate(date) {
    return date.toLocaleString('pt-BR', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

// Importar funções auxiliares de googleSheets.js se necessário
const { getColumnLetter } = require('../utils/googleSheets');

/**
 * Mostra o modal de cancelamento
 * @param {Interaction} interaction Interação do Discord
 * @returns {Promise<ModalSubmitInteraction>} Interação do modal
 */
async function showCancelModal(interaction) {
    const modal = new ModalBuilder()
        .setCustomId('cancelar-modal')
        .setTitle('Cancelar Cartão de Ponto');

    const idInput = new TextInputBuilder()
        .setCustomId('id-input')
        .setLabel('🆔 ID do Cartão de Ponto')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Digite o ID do cartão que deseja cancelar')
        .setRequired(true);

    const motivoInput = new TextInputBuilder()
        .setCustomId('motivo-input')
        .setLabel('📝 Motivo do Cancelamento')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Digite o motivo do cancelamento')
        .setMaxLength(500)
        .setRequired(true);

    modal.addComponents(
        new ActionRowBuilder().addComponents(idInput),
        new ActionRowBuilder().addComponents(motivoInput)
    );

    await interaction.showModal(modal);

    return interaction.awaitModalSubmit({
        filter: i => i.customId === 'cancelar-modal' && i.user.id === interaction.user.id,
        time: 300000
    }).catch(() => null);
}

/**
 * Atualiza a mensagem do cartão cancelado
 * @param {Interaction} interaction Interação do Discord
 * @param {PointCard} pointCard Cartão de ponto
 * @param {string} motivo Motivo do cancelamento
 */
async function updateCancelMessage(interaction, pointCard, motivo, originalUser) {
    try {
        const channel = interaction.channel;
        const message = await channel?.messages.fetch(pointCard.messageId).catch(() => null);
        
        if (!message) {
            console.error('[Cancelar] Mensagem original não encontrada');
            await interaction.followUp({
                content: '⚠️ Cartão cancelado, mas a mensagem original não foi encontrada para atualizar a embed.',
                ephemeral: true
            });
            return;
        }

        const updatedEmbed = await generateCancelEmbed(pointCard, interaction, motivo, originalUser);
        const logEmbed = generateLogEmbed(pointCard, interaction, motivo, originalUser);

        // Buscar configuração do servidor para pegar o channelId
        const servidor = await Servidor.findOne({ guildId: interaction.guild.id });
        if (!servidor?.channelId) {
            console.error('[Cancelar] Canal de logs não configurado no servidor');
            return;
        }

        const logChannel = await interaction.client.channels.fetch(servidor.channelId).catch(() => null);
        if (!logChannel) {
            console.error('[Cancelar] Canal de logs não encontrado');
            return;
        }

        // Criar botão para DM e log
        const buttons = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel('Ver Cartão')
                .setStyle(ButtonStyle.Link)
                .setURL(message.url)
                .setEmoji('🔍')
        );

        // Mensagem original: sem botão
        // Log: com botão
        await Promise.all([
            message.edit({ embeds: [updatedEmbed], components: [] }).catch(console.error),
            logChannel.send({ 
                embeds: [logEmbed], 
                components: [buttons]
            }).catch(console.error)
        ]);

    } catch (error) {
        console.error('[Cancelar] Erro ao atualizar mensagem do cartão:', error);
    }
}

class UpdateQueue {
    constructor() {
        this.queues = new Map();
        this.processing = new Set();
    }

    getQueue(guildId) {
        if (!this.queues.has(guildId)) {
            this.queues.set(guildId, []);
        }
        return this.queues.get(guildId);
    }

    async queueUpdate(guildId, spreadsheetId, ranges, values) {
        const queue = this.getQueue(guildId);
        const updatePromise = new Promise((resolve, reject) => {
            queue.push({
                spreadsheetId,
                ranges,
                values,
                resolve,
                reject
            });
        });

        this.processQueue(guildId);
        return updatePromise;
    }

    async processQueue(guildId) {
        if (this.processing.has(guildId)) return;
        this.processing.add(guildId);

        const queue = this.getQueue(guildId);
        while (queue.length > 0) {
            const batch = queue.splice(0, 10); // Processar em lotes de 10
            try {
                await Promise.all(batch.map(async (update) => {
                    try {
                        await sendToGoogleSheets(
                            update.spreadsheetId,
                            update.ranges,
                            update.values
                        );
                        update.resolve();
                    } catch (error) {
                        update.reject(error);
                    }
                }));
            } catch (error) {
                console.error(`[UpdateQueue] Erro ao processar lote para servidor ${guildId}:`, error);
            }
            await new Promise(resolve => setTimeout(resolve, 1000)); // Esperar 1s entre lotes
        }

        this.processing.delete(guildId);
    }
}

const updateQueue = new UpdateQueue();

module.exports = { handleCancelarCommand };