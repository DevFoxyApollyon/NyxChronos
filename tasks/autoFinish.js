/**
 * Importações e dependências necessárias para o funcionamento do sistema
 * - buttonHandler: Funções para manipulação de botões e cálculos
 * - models: Modelos do banco de dados
 * - utils: Utilitários diversos
 */
const { handleFinishAction, calcularTempoTotalPorWorkPeriods } = require("../handlers/buttonHandler");
const { PointCard } = require('../models/pointCard');
const { generateEmbed } = require('../utils/embed');
const { formatTime, calculateTotalTime } = require('../utils/time');
const { User } = require('../models/user');
const {sendToGoogleSheets, getStartDay, getColumnLetter, getBrasiliaDay, checkUserInSheet, createUserInSheet, sendLogMessage, getSheetRowForUser, SHEETS_CACHE } = require('../utils/googleSheets');
const { ActionRowBuilder, EmbedBuilder } = require('discord.js');
const { Servidor } = require('../models/Servidor');
const { enviarMensagemParabens } = require('../handlers/buttonHandler');
const { google } = require('googleapis');

// Usar variáveis de ambiente em vez de config.json
const { GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY } = process.env;

/**
 * Configurações do sistema de retry
 * - maxAttempts: Número máximo de tentativas
 * - delayMs: Tempo base entre tentativas em ms 
 * - backoffFactor: Fator multiplicador para aumento do tempo entre tentativas
 */
const RETRY_CONFIG = {
    maxAttempts: 3,
    delayMs: 2000,
    backoffFactor: 2
};

/**
 * Sistema de cache para otimização
 * - userRows: Cache de linhas dos usuários
 * - lastAccess: Registro do último acesso
 * - ttl: Tempo de vida do cache em ms (5 minutos)
 */
const PROCESSING_CACHE = {
    userRows: new Map(),
    lastAccess: new Map(),
    ttl: 5 * 60 * 1000 // 5 minutos
};

/**
 * Configuração da autenticação com Google Sheets
 * Usa variáveis de ambiente para credenciais
 */
const auth = new google.auth.JWT(
    GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n').replace(/"/g, ''),
    ['https://www.googleapis.com/auth/spreadsheets']
);

/**
 * Instância do cliente Google Sheets
 */
const sheets = google.sheets({ version: 'v4', auth });

/**
 * Função auxiliar para retry com backoff exponencial
 * @param {Function} fn - Função a ser executada
 * @param {string} context - Contexto para logs
 * @returns {Promise} Resultado da função ou erro após tentativas
 */
async function retryWithBackoff(fn, context = '') {
    let lastError;
    for (let attempt = 1; attempt <= RETRY_CONFIG.maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            if (attempt < RETRY_CONFIG.maxAttempts) {
                const delay = RETRY_CONFIG.delayMs * Math.pow(RETRY_CONFIG.backoffFactor, attempt - 1);
                console.log(`[AutoFinish] Tentativa ${attempt}/${RETRY_CONFIG.maxAttempts} falhou para ${context}. Próxima tentativa em ${delay}ms`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    throw lastError;
}

/**
 * Obtém configuração do servidor do Discord
 * @param {string} guildId - ID do servidor
 * @returns {Promise<Object|null>} Configuração do servidor ou null
 */
async function getServerConfig(guildId) {
    try {
        const servidor = await Servidor.findOne({ guildId });
        if (!servidor) {
            console.warn(`Configuração não encontrada para o servidor ${guildId}`);
            return null;
        }
        return servidor;
    } catch (error) {
        console.error(`Erro ao buscar configuração do servidor ${guildId}:`, error);
        return null;
    }
}

/**
 * Limpa entradas antigas do cache
 * Remove registros que ultrapassaram o TTL definido
 */
function checkAndCleanCache() {
    const now = Date.now();
    for (const [key, data] of PROCESSING_CACHE.userRows.entries()) {
        if (now - data.timestamp > PROCESSING_CACHE.ttl) {
            PROCESSING_CACHE.userRows.delete(key);
        }
    }
}

/**
 * Flag para ativar logs de debug
 */
const DEBUG_AUTOFINISH = false;

/**
 * Função principal de finalização automática
 * Executa o processo de finalização de cartões em aberto
 * @param {Object} client - Cliente Discord.js
 */
async function executarFinalizacaoAutomatica(client) { 
    const discordClient = client || global.client;
    
    console.log("🔍 Verificando estado do client...");

    if (!discordClient || typeof discordClient.isReady !== 'function') {
        console.error("❌ Erro: client inválido ou não inicializado");
        return;
    }

    let attempts = 0;
    while (!discordClient.isReady() && attempts < 5) {
        console.log(`⏳ Aguardando client ficar pronto... Tentativa ${attempts + 1}/5`);
        await new Promise(res => setTimeout(res, 5000)); 
        attempts++;
    }

    if (!discordClient.isReady()) {
        console.error("❌ Client não ficou pronto após várias tentativas");
        return;
    }

    console.log("✅ Client está pronto! Iniciando finalização automática...");

    try {
        console.log("🔍 Buscando cartões em aberto...");
        const openPointCards = await PointCard.find({ finished: false });

        if (!openPointCards.length) {
            console.log("✅ Nenhum cartão em aberto para finalizar.");
            return;
        }

        console.log(`🔍 ${openPointCards.length} cartões encontrados.`);

        let processados = 0;
        let erros = 0;
        const summaryLogs = {};
        const erroCards = [];

        for (const card of openPointCards) {
            if (DEBUG_AUTOFINISH) console.log(`[AutoFinish] Processando cartão ${card._id}...`);
            
            if (!card.guildId) {
                console.warn(`⚠️ Cartão ${card._id} sem guildId. Pulando...`);
                erros++;
                continue;
            }
            
            let channel, message;
            const startTime = Date.now();

            try {
                // 1. Buscar Canal e Mensagem
                channel = await discordClient.channels.fetch(card.channelId).catch(() => null);
                if (!channel) {
                    console.warn(`⚠️ Canal ${card.channelId} não encontrado para cartão ${card._id}! Pulando...`);
                    erros++;
                    continue; 
                }

                message = await channel.messages.fetch(card.messageId).catch(() => null);
                if (!message) {
                    console.warn(`[AutoFinish] Mensagem ${card.messageId} não encontrada (Cartão: ${card._id}). Marcando erro no DB.`);
                    card.finished = true; 
                    card.status = 'error';
                    card.endTime = new Date();
                    card.history.push({ action: 'Finalizado Auto (Erro: Msg não encontrada)', time: card.endTime, user: 'Sistema' });
                    try { await card.save(); } catch (e) { console.error(`[AutoFinish] Falha ao salvar erro no cartão ${card._id}`, e); }
                    erros++; continue;
                }

                if (typeof message.edit !== 'function') {
                    console.error(`❌ Erro: O objeto message ${message.id} não possui o método edit.`);
                    erros++;
                    continue;
                }

                // 2. Verificar se já está finalizado (dupla checagem)
                if (card.finished) {
                    console.log(`⚠️ Cartão ${card._id} já estava finalizado no DB. Pulando...`);
                    continue;
                }

                // --- INÍCIO DO PROCESSAMENTO PRINCIPAL ---
                const now = new Date();
                let currentPeriodMs = 0;
                let totalTimeMs = 0;

                // 3. Atualizar tempos e estado
                if (card.isPaused) {
                    if (card.lastPauseStart instanceof Date && !isNaN(card.lastPauseStart)) {
                        const pauseDuration = now.getTime() - card.lastPauseStart.getTime();
                        card.totalPausedTime += pauseDuration;

                        // Adicionar a pausa atual ao último período
                        if (card.workPeriods && card.workPeriods.length > 0) {
                            const lastPeriod = card.workPeriods[card.workPeriods.length - 1];
                            if (!lastPeriod.pauseIntervals) {
                                lastPeriod.pauseIntervals = [];
                            }
                            lastPeriod.pauseIntervals.push({
                                start: card.lastPauseStart,
                                end: now
                            });
                            lastPeriod.end = now; // Fechar o período na pausa
                        }

                        card.lastPauseStart = null;
                    }
                    card.isPaused = false;
                }

                // Processar workPeriods
                if (!card.workPeriods || card.workPeriods.length === 0) {
                    card.workPeriods = [{
                        start: card.startTime,
                        end: now,
                        pauseIntervals: []
                    }];
                } else {
                    // Garantir que todos os períodos estejam corretamente fechados
                    card.workPeriods = card.workPeriods.map(period => ({
                        start: period.start,
                        end: period.end || now,
                        pauseIntervals: period.pauseIntervals || []
                    }));
                }

                // Calcular tempo total usando a mesma função do buttonHandler
                const tempoTotal = calcularTempoTotalPorWorkPeriods(card.workPeriods);

                if (isNaN(tempoTotal)) {
                    console.error(`[AutoFinish ERROR ${card._id}] Cálculo de tempo total resultou em NaN.`);
                    card.status = 'error';
                    card.totalTime = 0;
                    card.accumulatedTime = 0;
                } else {
                    // Atualizar os tempos no card
                    card.totalTime = tempoTotal;
                    card.accumulatedTime = tempoTotal;
                    console.log(`[AutoFinish] Tempo total calculado para ${card._id}: ${formatTime(tempoTotal)}`);
                }

                // Atualizar o cartão com os dados finais
                const updateData = {
                    finished: true,
                    status: 'finished',
                    endTime: now,
                    history: [...card.history, {
                        action: 'Finalizado Automaticamente (Tarefa Diária 23:59)',
                        time: now,
                        user: 'Sistema'
                    }],
                    workPeriods: card.workPeriods,
                    totalTime: tempoTotal, // Garantir que o tempo total seja salvo
                    accumulatedTime: tempoTotal,
                    totalPausedTime: card.totalPausedTime || 0,
                    isPaused: false,
                    lastPauseStart: null
                };

                // Atualizar o cartão usando findOneAndUpdate
                const updatedCard = await PointCard.findOneAndUpdate(
                    { _id: card._id },
                    updateData,
                    { new: true }
                ).lean(); // Usar lean() para melhor performance

                // 6. Atualizar Mensagem Discord com o embed atualizado
                const originalUser = await discordClient.users.fetch(card.userId).catch(() => ({
                    tag: card.userName || `Usuário (${card.userId})`,
                    id: card.userId,
                    toString: () => `<@${card.userId}>`
                }));

                // Criar dados para o embed com todos os campos necessários
                const embedData = {
                    ...updatedCard,
                    userName: originalUser.tag,
                    finished: true,
                    status: 'finished',
                    isPaused: false,
                    totalTime: tempoTotal,
                    accumulatedTime: tempoTotal,
                    workPeriods: card.workPeriods,
                    history: updateData.history
                };

                // Gerar e enviar o embed atualizado
                const finalEmbed = await generateEmbed(originalUser, embedData);

                if (finalEmbed && typeof finalEmbed.setColor === 'function') {
                    finalEmbed.setColor('#00FF00')
                        .setTitle('✅ Ponto Finalizado Automaticamente')
                        .setTimestamp(now);

                    try {
                        await message.edit({
                            embeds: [finalEmbed],
                            components: [] // Remover botões
                        });
                        console.log(`[AutoFinish] Embed atualizado com sucesso para ${card._id}`);
                    } catch (editError) {
                        console.error(`[AutoFinish] Erro ao atualizar embed para ${card._id}:`, editError);
                    }
                }

                // Enviar mensagem de parabéns ao usuário
                try {
                    const user = await discordClient.users.fetch(card.userId).catch(() => null);
                    if (user && tempoTotal > 0) {
                        console.log(`[AutoFinish] Tentando enviar mensagem de parabéns para ${card._id}`);
                        await enviarMensagemParabens(discordClient, user, {
                            ...updatedCard, // Usar updatedCard em vez de card
                            totalTime: tempoTotal,
                            accumulatedTime: tempoTotal,
                            endTime: now,
                            _id: card._id.toString(),
                            userId: card.userId,
                            guildId: card.guildId,
                            workPeriods: card.workPeriods // Garantir que workPeriods seja passado
                        }).catch(error => {
                            console.error('[AutoFinish] Erro ao enviar mensagem de parabéns:', {
                                cardId: card._id,
                                userId: card.userId,
                                error: error.message,
                                workPeriods: card.workPeriods ? 'present' : 'missing' // Debug
                            });
                        });
                    } else {
                        console.log(`[AutoFinish] Pulando mensagem de parabéns para ${card._id} - Usuário não encontrado ou sem tempo acumulado`);
                    }
                } catch (congratsError) {
                    console.error('[AutoFinish] Erro ao processar mensagem de parabéns:', {
                        cardId: card._id,
                        userId: card.userId,
                        error: congratsError.message,
                        hasWorkPeriods: !!card.workPeriods
                    });
                }
                
                processados++;

                // Registrar tempo na planilha
                try {
                    if (tempoTotal > 0) {
                        // Buscar configuração do servidor
                        const config = await getServerConfig(card.guildId);
                        if (!config) {
                            throw new Error('Configuração do servidor não encontrada');
                        }

                        // Obter data e coluna
                        const date = new Date();
                        const dia = getBrasiliaDay(date);
                        const coluna = getColumnLetter(dia);

                        // Verificar usuário na planilha
                        let userExists = false;
                        try {
                            userExists = await checkUserInSheet(card.userId, config);
                        } catch (checkError) {
                            console.warn('[AutoFinish] Erro ao verificar usuário na planilha:', checkError);
                        }

                        // Criar usuário se não existir
                        if (!userExists) {
                            console.log(`[AutoFinish] Usuário não encontrado, criando...`);
                            try {
                                await createUserInSheet(card.userId, originalUser.tag, config);
                            } catch (createError) {
                                console.error('[AutoFinish] Erro ao criar usuário:', createError);
                            }
                        }

                        console.log(`[AutoFinish] 📊 Preparando registro na planilha:
                            → Usuário: ${originalUser.tag}
                            → Data/Hora: ${date.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}
                            → Dia: ${dia}
                            → Coluna: ${coluna}
                            → Tempo: ${formatTime(tempoTotal)}`);

                        // Send to sheet with better error handling
                        const result = await sendToGoogleSheets(
                            discordClient,
                            card.userId,
                            formatTime(tempoTotal),
                            card.messageId,
                            card.guildId,
                            coluna,
                            card.channelId
                        );

                        if (!result.success) {
                            throw new Error(result.error || 'Erro desconhecido ao registrar na planilha');
                        }

                        // Registrar no log apenas uma vez após sucesso
                        console.log(`[AutoFinish] ✅ Registro concluído com sucesso para ${originalUser.tag}! Tempo: ${formatTime(tempoTotal)}`);

                        // Não enviar log intermediário, apenas o final será mantido
                    }
                } catch (sheetError) {
                    console.error('[AutoFinish] ❌ Erro ao registrar na planilha:', {
                        erro: sheetError.message,
                        usuario: originalUser.tag,
                        userId: card.userId,
                        tempo: formatTime(tempoTotal)
                    });

                    // Try to send error log
                    try {
                        const config = await getServerConfig(card.guildId);
                        if (config && typeof sendLogMessage === 'function') {
                            await sendLogMessage(
                                discordClient,
                                card.userId,
                                `❌ Erro ao registrar tempo automaticamente: ${sheetError.message}`,
                                '',
                                '',
                                '',
                                formatTime(tempoTotal),
                                config,
                                card.messageId,
                                card.channelId
                            );
                        }
                    } catch (logError) {
                        console.error('[AutoFinish] Erro ao enviar log de erro:', logError);
                    }
                }

                // Adiciona ao summaryLogs com tempo de processamento
                if (!summaryLogs[card.guildId]) {
                    const serverConfig = await getServerConfig(card.guildId);
                    summaryLogs[card.guildId] = {
                        count: 0,
                        details: [],
                        config: serverConfig,
                        guildName: channel.guild.name
                    };
                }
                
                const processingTime = Date.now() - startTime;
                const formattedTimeCard = formatTime(card.totalTime);
                const link = `https://discord.com/channels/${card.guildId}/${card.channelId}/${card.messageId}`;
                summaryLogs[card.guildId].count++;
                summaryLogs[card.guildId].details.push(
                    `Cartão de ${originalUser.tag} finalizado com ${formattedTimeCard} [Ver Cartão](${link})`
                );

            } catch (processError) {
                console.error(`❌ Erro GERAL no processamento do cartão ${card._id}:`, processError);
                if (card && !card.finished) {
                    card.finished = true;
                    card.status = 'error_processing';
                    card.endTime = new Date();
                    card.history.push({ 
                        action: 'Erro Processamento Finalização Automática', 
                        time: new Date(), 
                        user: 'Sistema', 
                        error: processError.message 
                    });
                    try { 
                        await card.save(); 
                    } catch(e) { 
                        console.error(`Falha ao salvar status de erro para cartão ${card._id}`); 
                    }
                }
                erroCards.push({
                    id: card._id,
                    userId: card.userId,
                    messageId: card.messageId,
                    guildId: card.guildId,
                    channelId: card.channelId,
                    error: processError.message
                });
                erros++;
            }
        }

        console.log(`[AutoFinish] 🏁 Concluído! ✅ Sucesso: ${processados} | ❌ Erros/Pulados: ${erros}`);

        // Enviar logs resumidos
        console.log("[AutoFinish] 📨 Enviando logs resumidos...");
        for (const guildId in summaryLogs) {
            const logData = summaryLogs[guildId];
            if (logData.count === 0 && erros === 0) {
                console.log(`[AutoFinish] Nenhum cartão processado ou erro para ${guildId}, não enviando resumo.`);
                continue;
            }
            
            const serverConfig = logData.config; 
            if (!serverConfig || !serverConfig.channelId) {
                console.warn(`[AutoFinish] Sem canal de log configurado para ${logData.guildName} (${guildId}).`);
                continue;
            }

            try {
                const logChannel = await discordClient.channels.fetch(serverConfig.channelId);
                if (!logChannel || !logChannel.isTextBased()) {
                    console.warn(`[AutoFinish] Canal de log ${serverConfig.channelId} inválido para ${guildId}.`);
                    continue;
                }
                
                const MAX_DETAILS_LINES = 10;
                const fields = [];
                let embedTitle = "";
                let embedColor = "";
                const footerText = `Tarefa de finalização automática`;

                fields.push({ 
                    name: "━━━━━━━━━━━━━━━━━━━━━━",
                    value: `📍 **Servidor Processado:**  \n**${logData.guildName}** (${guildId})`, 
                    inline: false 
                });

                if (logData.count > 0) {
                    const descriptionLines = logData.details.slice(0, MAX_DETAILS_LINES);
                    let detailsValue = descriptionLines.map((line, idx) => `> 📝 ${line}`).join('\n');
                    
                    // Dividir os detalhes em múltiplos campos se necessário
                    const MAX_FIELD_LENGTH = 1024;
                    let remainingDetails = detailsValue;
                    let fieldIndex = 1;
                    
                    while (remainingDetails.length > 0) {
                        let fieldValue = remainingDetails.slice(0, MAX_FIELD_LENGTH);
                        remainingDetails = remainingDetails.slice(MAX_FIELD_LENGTH);
                        
                        // Se houver mais detalhes, adiciona "..." no final
                        if (remainingDetails.length > 0) {
                            fieldValue = fieldValue.slice(0, -3) + '...';
                        }
                        
                        fields.push({ 
                            name: fieldIndex === 1 ? `✅ Cartões Finalizados (${logData.count})` : `✅ Cartões Finalizados (continuação)`, 
                            value: fieldValue, 
                            inline: false 
                        });
                        
                        fieldIndex++;
                    }
                    
                    if (logData.details.length > MAX_DETAILS_LINES) {
                        fields.push({ 
                            name: '📝 Observação', 
                            value: `... e mais ${logData.details.length - MAX_DETAILS_LINES} cartão(ões).`, 
                            inline: false 
                        });
                    }

                    if (erros > 0) {
                        embedTitle = `⚠️ Finalização Automática (com erros)`;
                        embedColor = '#E67E22';
                    } else {
                        embedTitle = `✅ Finalização Automática Concluída`;
                        embedColor = '#2ECC71';
                    }
                } else {
                    embedTitle = `❌ Falha na Finalização (Servidor)`;
                    embedColor = '#E74C3C';
                    fields.push({ 
                        name: "❌ Resultado (Servidor)", 
                        value: "Nenhum cartão foi finalizado neste servidor pois a tarefa geral encontrou erros.", 
                        inline: false 
                    });
                }

                fields.push({
                    name: "━━━━━━━━━━━━━━━━━━━━━━",
                    value: `📊 **Sumário Geral da Tarefa**\n• Processados com Sucesso: **${processados}**\n• Erros/Pulados: **${erros}**`,
                    inline: false
                });

                const summaryEmbed = new EmbedBuilder()
                    .setTitle(embedTitle)
                    .setColor(embedColor)
                    .setFields(fields)
                    .setThumbnail(discordClient.user ? discordClient.user.displayAvatarURL() : null)
                    .setFooter({ 
                        text: footerText, 
                        iconURL: discordClient.user ? discordClient.user.displayAvatarURL() : undefined 
                    })
                    .setTimestamp();

                await logChannel.send({ embeds: [summaryEmbed] });

                // Enviar DM para o desenvolvedor
                try {
                    const devUser = await discordClient.users.fetch('657014871228940336');
                    if (devUser) {
                        // Adicionar campo de erros apenas na DM do suporte
                        if (erroCards.length > 0) {
                            const erroLines = erroCards.slice(0, 10).map(card => {
                                const link = card.guildId && card.channelId && card.messageId ? `([Ver Cartão](https://discord.com/channels/${card.guildId}/${card.channelId}/${card.messageId}))` : '';
                                return `• ID: \`${card.id}\` Usuário: <@${card.userId}> ${link} Erro: ${card.error}`;
                            });
                            let erroValue = erroLines.join('\n');
                            if (erroCards.length > 10) {
                                erroValue += `\n... e mais ${erroCards.length - 10} cartão(ões) com erro.`;
                            }
                            summaryEmbed.addFields({
                                name: '❗ Cartões com Erro',
                                value: erroValue,
                                inline: false
                            });
                        }
                        await devUser.send({ embeds: [summaryEmbed] });
                    }
                } catch (dmError) {
                    console.error('[AutoFinish] Não foi possível enviar DM para o desenvolvedor:', dmError);
                }
            } catch (logError) {
                console.error(`[AutoFinish] Erro ao enviar log para ${guildId}:`, logError);
            }
        }
    } catch (error) {
        console.error("[AutoFinish] Erro na tarefa:", error);
    }
}

// Função auxiliar para obter linha do usuário do cache ou planilha
async function obterLinhaUsuario(userId, userName) {
    try {
        // Verificar cache primeiro
        if (PROCESSING_CACHE.userRows.has(userId)) {
            const cachedData = PROCESSING_CACHE.userRows.get(userId);
            if (Date.now() - cachedData.timestamp < PROCESSING_CACHE.ttl) {
                console.log(`[AutoFinish] Usando linha em cache para ${userName}: ${cachedData.row}`);
                return cachedData.row;
            }
        }

        console.log(`[AutoFinish] Buscando linha para usuário ${userName} na planilha...`);

        // Verificar se temos o ID da planilha
        if (!process.env.GOOGLE_SHEET_ID) {
            throw new Error('GOOGLE_SHEET_ID não configurado');
        }

        // Se não estiver em cache, buscar na planilha
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.GOOGLE_SHEET_ID,
            range: 'Dados!A:B' // Agora busca colunas A e B para ID e nome
        });

        const rows = response.data.values;
        if (!rows) {
            console.error('[AutoFinish] Nenhum dado encontrado na planilha');
            return 3; // Fallback para linha 3 se não encontrar dados
        }

        // Procurar pelo ID do usuário ou nome
        let rowIndex = rows.findIndex(row => 
            row[0] === userId || 
            (row[1] && row[1].toLowerCase() === userName.toLowerCase())
        );

        if (rowIndex === -1) {
            console.warn(`[AutoFinish] Usuário ${userName} não encontrado, usando linha padrão 3`);
            return 3; // Fallback para linha 3 se não encontrar o usuário
        }

        const linhaEncontrada = rowIndex + 1;
        console.log(`[AutoFinish] Linha encontrada para ${userName}: ${linhaEncontrada}`);

        // Atualizar cache
        PROCESSING_CACHE.userRows.set(userId, {
            row: linhaEncontrada,
            timestamp: Date.now()
        });

        return linhaEncontrada;
    } catch (error) {
        console.error('[AutoFinish] Erro ao buscar linha do usuário:', error);
        console.log('[AutoFinish] Usando linha padrão 3 como fallback');
        return 3; // Fallback para linha 3 em caso de erro
    }
}

// Modificar a função calcularDiaColuna para usar os novos valores
async function calcularDiaColuna(userId, userName) {
    try {
        // Criar data com timezone Brasil
        const now = new Date();
        const brasiliaDate = new Intl.DateTimeFormat('pt-BR', {
            timeZone: 'America/Sao_Paulo',
            day: 'numeric'
        }).format(now);
        
        // Converter string para número
        const dia = parseInt(brasiliaDate, 10);
        
        if (isNaN(dia) || dia < 1 || dia > 31) {
            throw new Error(`Dia inválido: ${dia}`);
        }
        
        // Ajustar para começar da coluna F (dia 1 = F)
        const colunaBase = 'F'.charCodeAt(0) - 1;
        const coluna = String.fromCharCode(colunaBase + dia);
        
        // Buscar linha do usuário com fallback
        const linha = await obterLinhaUsuario(userId, userName);
        
        console.log('[AutoFinish] Cálculo finalizado:', {
            dataOriginal: now,
            diaBrasilia: dia,
            coluna: coluna,
            linha: linha,
            celula: `${coluna}${linha}`,
            usuario: userName
        });
        
        return { dia, coluna, linha, celula: `${coluna}${linha}` };
    } catch (error) {
        console.error('[AutoFinish] Erro ao calcular dia/coluna:', error);
        // Usar valores fallback em caso de erro
        const diaAtual = new Date().getDate();
        const colunaFallback = String.fromCharCode('F'.charCodeAt(0) + diaAtual - 1);
        return { 
            dia: diaAtual, 
            coluna: colunaFallback, 
            linha: 3, 
            celula: `${colunaFallback}3` 
        };
    }
}

process.env.TZ = "America/Sao_Paulo";

// Exportar função principal
module.exports = { executarFinalizacaoAutomatica };