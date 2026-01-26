const path = require('path');
const { PointCard } = require('../models/pointCard');
const { User } = require('../models/user');
const { sendToGoogleSheets, checkUserInSheet, createUserInSheet, getColumnLetter, getStartDay, getBrasiliaDay } = require('../utils/googleSheets');
const { generateEmbed, generateButtons } = require('../utils/embed');
const { formatTime } = require('../utils/time');
const { DateTime } = require('luxon');
const { ActionRowBuilder, ButtonBuilder, EmbedBuilder, ButtonStyle } = require('discord.js');
const { Servidor } = require('../models/Servidor');
const messageData = new Map();
require('dotenv').config();

// Constante para controlar o tempo de exibição das mensagens efêmeras (5 segundos)
const TEMPO_MENSAGEM = 5000;

// Constante para controlar o tempo mínimo entre interações (5 minutos)
const TEMPO_MINIMO_INTERACAO = 0 * 60 * 1000; // 5 minutos em milissegundos

// ID do suporte técnico
const SUPPORT_ID = '657014871228940336';

// Função para obter configuração do servidor
async function getServerConfig(guildId) {
    try {
        const servidor = await Servidor.findOne({ guildId });
        if (!servidor) {
            throw new Error('Servidor não configurado');
        }
        return servidor;
    } catch (error) {
        console.error(`Erro: Servidor "${interaction.guild.name}" não configurado\nUse: /painel`);
        throw error;
    }
}

// Função para validar dados do cartão
function validateCardData(cardData) {
    const requiredFields = ['userId', 'channelId', 'guildId', 'startTime'];
    const missingFields = requiredFields.filter(field => !cardData[field]);
    
    if (missingFields.length > 0) {
        throw new Error(`Campos obrigatórios faltando: ${missingFields.join(', ')}`);
    }
}

// Função para atualizar o Google Sheets com o dia correto
async function updateGoogleSheetsWithStartDay(client, card, formattedTime) {
    try {
        console.log('[LOG ponto.js] startTime original do cartão:', card.startTime, 'Data formatada:', new Date(card.startTime).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }));
        const startDay = getBrasiliaDay(new Date(card.startTime));
        const columnLetter = getColumnLetter(startDay);
        
        console.log('DEBUG envio:', {
            startTime: card.startTime,
            startDay: getBrasiliaDay(new Date(card.startTime)),
            columnLetter
        });
        
        const result = await sendToGoogleSheets(
            client,
            card.userId,
            formattedTime,
            card.messageId,
            card.guildId,
            columnLetter,
            card.channelId
        );
        
        return result;
    } catch (error) {
        console.error('Erro ao atualizar Google Sheets com dia de início:', error);
        throw error;
    }
}

/**
 * Função para lidar com o comando de ponto.
 * @param {Object} interaction - A interação do Discord.
 */
async function handlePontoCommand(interaction) {
    let timeout = null;
    let replied = false;
    try {
        timeout = setTimeout(() => {
            if (!interaction.replied && !interaction.deferred) {
                interaction.reply({
                    content: '⚠️ O comando está demorando muito para processar. Por favor, tente novamente.',
                    ephemeral: true
                }).catch(() => {});
            }
        }, 14000);

        // Verificar se temos acesso ao guild
        if (!interaction.guild?.id) {
            clearTimeout(timeout);
            return await interaction.reply({
                content: '❌ Este comando só pode ser usado em servidores.',
                ephemeral: true
            });
        }

        // Obter configuração do servidor
        const config = await getServerConfig(interaction.guild.id);

        // Verificar se o usuário tem o cargo permitido configurado
        if (config.cargoPermitido) {
            const hasRequiredRole = interaction.member.roles.cache.some(role => role.id === config.cargoPermitido);
            if (!hasRequiredRole) {
                return await interaction.reply({
                    content: `❌ Você não tem permissão para usar este comando. É necessário ter o cargo <@&${config.cargoPermitido}>.`,
                    ephemeral: true
                });
            }
        }

        // Verificar se o usuário já tem um cartão de ponto ativo neste servidor
        const existingCard = await PointCard.findOne({
            userId: interaction.user.id,
            guildId: interaction.guild.id,
            finished: false,
            status: { $in: ['active', 'error_sheets'] }
        });

        if (existingCard) {
            try {
                // Tentar buscar a mensagem do cartão
                const channel = await interaction.guild.channels.fetch(existingCard.channelId);
                if (!channel) {
                    // Se o canal não existir mais, finaliza o cartão antigo e permite criar um novo
                    existingCard.finished = true;
                    existingCard.status = 'error';
                    existingCard.history.push({ 
                        action: 'Finalizado automaticamente - Canal não encontrado', 
                        time: new Date(), 
                        user: 'Sistema' 
                    });
                    await existingCard.save();
                } else {
                    try {
                        const message = await channel.messages.fetch(existingCard.messageId);
                        if (message) {
                            const row = new ActionRowBuilder()
                                .addComponents(
                                    new ButtonBuilder()
                                        .setCustomId(`error_${existingCard.messageId}`)
                                        .setLabel('❌ Marcar como Erro')
                                        .setStyle(ButtonStyle.Danger),
                                    new ButtonBuilder()
                                        .setLabel('🔍 Ver Cartão Ativo')
                                        .setStyle(ButtonStyle.Link)
                                        .setURL(`https://discord.com/channels/${interaction.guildId}/${existingCard.channelId}/${existingCard.messageId}`)
                                );

                            const embed = new EmbedBuilder()
                                .setColor('#FF0000')
                                .setTitle('⚠️ Cartão de Ponto Ativo')
                                .setDescription('Você já possui um cartão de ponto ativo neste servidor.')
                                .addFields(
                                    { 
                                        name: '👑 Admin',
                                        value: `<@${interaction.user.id}>`,
                                        inline: false
                                    },
                                    { 
                                        name: '📅 Iniciado em',
                                        value: new Date(existingCard.startTime).toLocaleString('pt-BR', { 
                                            weekday: 'long', 
                                            year: 'numeric', 
                                            month: 'long', 
                                            day: 'numeric', 
                                            hour: '2-digit', 
                                            minute: '2-digit' 
                                        }),
                                        inline: false
                                    },
                                    { 
                                        name: '📍 Status',
                                        value: existingCard.isPaused ? '⏸️ Em pausa' : '▶️ Em andamento',
                                        inline: false
                                    },
                                    {
                                        name: '🆔 ID do Cartão',
                                        value: `\`${existingCard.messageId}\``,
                                        inline: false
                                    }
                                )
                                .setFooter({ 
                                    text: `Finalize o cartão atual antes de abrir um novo • ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`,
                                    iconURL: interaction.guild.iconURL({ dynamic: true })
                                })
                                .setTimestamp();

                            const reply = await interaction.reply({
                                embeds: [embed],
                                components: [row],
                                ephemeral: true
                            });

                            replied = true;
                            setTimeout(async () => {
                                try {
                                    await interaction.deleteReply();
                                } catch (e) {
                                    // Ignora erros se a mensagem já foi deletada
                                }
                            }, 5000);

                            return;
                        }
                    } catch (messageError) {
                        // Se a mensagem não existir mais, finaliza o cartão antigo
                        existingCard.finished = true;
                        existingCard.status = 'error';
                        existingCard.history.push({ 
                            action: 'Finalizado automaticamente - Mensagem não encontrada', 
                            time: new Date(), 
                            user: 'Sistema' 
                        });
                        await existingCard.save();
                    }
                }

                // Quando finalizar o cartão, usar o dia de início
                if (existingCard.finished) {
                    const formattedTime = formatTime(existingCard.totalTime);
                    await updateGoogleSheetsWithStartDay(interaction.client, existingCard, formattedTime);
                }
            } catch (error) {
                console.error('Erro ao verificar mensagem existente:', error);
                // Em caso de erro, finaliza o cartão antigo por segurança
                existingCard.finished = true;
                existingCard.status = 'error';
                existingCard.history.push({ 
                    action: 'Finalizado automaticamente - Erro ao verificar mensagem', 
                    time: new Date(), 
                    user: 'Sistema' 
                });
                await existingCard.save();
            }
        }

        // Finalizar automaticamente todos os cartões antigos não finalizados
        await PointCard.updateMany({
            userId: interaction.user.id,
            guildId: interaction.guild.id,
            finished: false
        }, {
            $set: {
                finished: true,
                status: 'error',
                endTime: new Date()
            },
            $push: {
                history: {
                    action: 'Finalizado automaticamente ao abrir novo cartão',
                    time: new Date(),
                    user: 'Sistema'
                }
            }
        });

        // Criar um novo cartão de ponto
        const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
        const guildId = interaction.guild.id;

        // Criar objeto cardData explicitamente
        const cardData = {};
        
        // Adicionar campos obrigatórios primeiro
        cardData.guildId = guildId;
        cardData.userId = interaction.user.id;
        cardData.channelId = interaction.channel.id;
        cardData.startTime = now;
        cardData.startDay = getStartDay(now); // Adicionando o dia de início
        
        // Adicionar campos restantes
        Object.assign(cardData, {
            totalPausedTime: 0,
            lastPauseStart: null,
            isPaused: false,
            finished: false,
            endTime: null,
            history: [{ action: 'Início', time: now, user: interaction.user.tag }],
            totalTime: null,
            accumulatedTime: 0,
            messageId: null,
            lastInteractionTime: now,
            createdAt: now,
            status: 'active',
            fourHoursNotified: false,
            workPeriods: [{
                start: now,
                end: null,
                pauseIntervals: []
            }]
        });

        // Criar o PointCard com new
        const pointCard = new PointCard(cardData);

        // Verificar se o guildId está presente antes de continuar
        if (!pointCard.guildId) {
            throw new Error(`GuildId não foi definido. Guild da interação: ${interaction.guild.id}`);
        }

        // Gerar o embed e os botões
        const embed = await generateEmbed(interaction.user, cardData);
        const buttons = generateButtons(cardData);

        // Enviar a mensagem e obter sua referência
        const message = await interaction.reply({
            embeds: [embed],
            components: buttons ? [buttons] : [],
            fetchReply: true
        });

        // Atualizar o messageId
        pointCard.messageId = message.id;

        // Tentar salvar
        try {
            await pointCard.save();
            // Se o usuário já está em call, salvar o horário de entrada
            try {
                const membro = await interaction.guild.members.fetch(interaction.user.id);
                if (membro.voice && membro.voice.channelId) {
                    await PointCard.updateOne(
                        { userId: interaction.user.id, guildId: interaction.guild.id, finished: false, canceled: false },
                        { $set: { lastVoiceChannelJoinedAt: new Date() } }
                    );
                }
            } catch (e) {
                // Ignora erros ao buscar membro ou atualizar o cartão
            }
        } catch (saveError) {
            console.error('Erro ao salvar cartão de ponto:', saveError);
            throw saveError;
        }

        // Limpar timeout após sucesso
        clearTimeout(timeout);
    } catch (error) {
        if (timeout) {
            clearTimeout(timeout);
        }
        // Verificar se é um erro de interação expirada
        if (error.code === 10062) {
            console.log('Interação expirada para o comando ponto, ignorando');
            return;
        }

        console.error(`Erro: Servidor "${interaction.guild.name}" não configurado`);

        // Verificar se é um erro de configuração não encontrada
        if (error.message && error.message.includes('Configuração do servidor não encontrada')) {
            const setupEmbed = new EmbedBuilder()
                .setColor('#FFA500')
                .setTitle('⚙️ Configuração Necessária')
                .setDescription('Este servidor ainda não foi configurado adequadamente.')
                .addFields(
                    { 
                        name: '📝 Problema Detectado', 
                        value: 'A configuração necessária para usar o sistema de ponto não foi encontrada.', 
                        inline: false 
                    },
                    { 
                        name: '📋 Próximos Passos', 
                        value: 'Execute o comando `/painel` para configurar o servidor.', 
                        inline: false 
                    },
                    { 
                        name: '❓ Precisa de Ajuda?', 
                        value: `Entre em contato com o suporte: <@${SUPPORT_ID}>`, 
                        inline: false 
                    }
                )
                .setThumbnail(interaction.guild.iconURL({ dynamic: true }))
                .setTimestamp()
                .setFooter({ 
                    text: 'Sistema de Bate Ponto Nychronos', 
                    iconURL: interaction.guild.iconURL({ dynamic: true }) 
                });

            return await interaction.reply({
                embeds: [setupEmbed],
                ephemeral: true
            });
        }

        // Para outros tipos de erro, criar um embed genérico
        const errorEmbed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('❌ Erro ao Registrar Ponto')
            .setDescription('Não foi possível processar sua solicitação de registro de ponto.')
            .addFields(
                { 
                    name: '📝 Detalhes do Problema', 
                    value: error.errors 
                        ? Object.entries(error.errors).map(([field, err]) => `• **${field}**: ${err.message}`).join('\n')
                        : `• ${error.message}`, 
                    inline: false 
                },
                {
                    name: '🔄 O que fazer agora?',
                    value: [
                        '1. Aguarde alguns minutos e tente novamente',
                        '2. Verifique se você tem as permissões necessárias',
                        `3. Se o problema persistir, contate o suporte: <@${SUPPORT_ID}>`
                    ].join('\n'),
                    inline: false
                }
            )
            .setTimestamp()
            .setFooter({ 
                text: 'Sistema de Bate Ponto Nychronos • Erro detectado', 
                iconURL: interaction.guild.iconURL({ dynamic: true }) 
            });

        if (!replied && !interaction.replied && !interaction.deferred) {
            await interaction.reply({
                embeds: [errorEmbed],
                ephemeral: true
            });
        }
    } finally {
        if (timeout) {
            clearTimeout(timeout);
        }
    }
}

module.exports = { handlePontoCommand };