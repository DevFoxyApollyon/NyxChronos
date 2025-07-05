const { Servidor } = require('../models/Servidor');
const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, ComponentType, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { getAvailableSheets } = require('../utils/googleSheets');

// Usar variáveis de ambiente em vez de config.json
const { GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY } = process.env;

const BOT_EMAIL = GOOGLE_SERVICE_ACCOUNT_EMAIL;
const SUPPORT_ID = '657014871228940336'; // Adicionado para permitir suporte

function createPageEmbed(abas, currentPage, totalPages, abaAtual) {
    return new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle('📑 Seleção de Aba da Planilha')
        .setDescription(`Selecione a aba desejada no menu abaixo:\nPágina ${currentPage + 1} de ${totalPages}`)
        .addFields(
            { 
                name: 'Aba Atual', 
                value: `📌 ${abaAtual || 'Não configurada'}` 
            }
        )
        .setTimestamp()
        .setFooter({ text: 'Sistema de Gerenciamento de Planilhas' });
}

function createSelectMenu(abas, startIndex, abaAtual) {
    const pageAbas = abas.slice(startIndex, startIndex + 25);
    return new StringSelectMenuBuilder()
        .setCustomId('select_sheet')
        .setPlaceholder('Selecione uma aba')
        .addOptions(
            pageAbas.map(aba => ({
                label: aba,
                value: aba,
                description: aba === abaAtual ? 'Aba atual' : 'Clique para selecionar esta aba',
                default: aba === abaAtual,
                emoji: aba === abaAtual ? '📌' : '📄'
            }))
        );
}

function createNavigationButtons(currentPage, totalPages) {
    const previousButton = new ButtonBuilder()
        .setCustomId('prev_page')
        .setLabel('◀️ Anterior')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage === 0);

    const nextButton = new ButtonBuilder()
        .setCustomId('next_page')
        .setLabel('Próxima ▶️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage === totalPages - 1);
    
    const planilhaButton = new ButtonBuilder()
        .setLabel('Acessar Planilha')
        .setStyle(ButtonStyle.Link)
        .setEmoji('📊');

    return new ActionRowBuilder().addComponents(previousButton, nextButton, planilhaButton);
}

/**
 * Envia um log para o canal configurado, DM do usuário e DM do suporte
 * @param {Object} client - Cliente Discord.js
 * @param {string} guildId - ID do servidor
 * @param {string} userId - ID do usuário que fez a alteração
 * @param {string} oldSheet - Nome da aba antiga
 * @param {string} newSheet - Nome da nova aba
 * @param {string} oldId - ID antigo da planilha (opcional)
 * @param {string} newId - Novo ID da planilha (opcional)
 */
async function sendLogToChannel(client, guildId, userId, oldSheet, newSheet, oldId = null, newId = null) {
    try {
        const servidor = await Servidor.findOne({ guildId });
        if (!servidor || !servidor.channelId) {
            console.error('Canal de log não configurado para o servidor:', guildId);
            return;
        }

        // Validar se o channelId é um número válido (snowflake)
        if (!servidor.channelId || !/^\d+$/.test(servidor.channelId)) {
            console.error('ID de canal inválido (não é um snowflake válido):', servidor.channelId);
            return;
        }

        const channel = await client.channels.fetch(servidor.channelId);
        if (!channel) {
            console.error('Canal de log não encontrado:', servidor.channelId);
            return;
        }

        // Buscar informações do usuário
        const user = await client.users.fetch(userId);
        if (!user) {
            console.error('Usuário não encontrado:', userId);
            return;
        }

        // Criar embed para o canal de log
        const logEmbed = new EmbedBuilder()
            .setColor('#00ff00')
            .setTitle('📊 Alteração na Planilha')
            .setDescription(`Uma alteração foi feita nas configurações da planilha por <@${userId}>.`)
            .addFields(
                { name: '👤 Usuário', value: `<@${userId}>`, inline: true },
                { name: '📝 Alteração', value: oldId ? 'Mudança de ID da planilha' : 'Mudança de aba da planilha', inline: true },
                { name: '🏢 Servidor', value: channel.guild.name, inline: true }
            )
            .setThumbnail(user.displayAvatarURL({ dynamic: true }))
            .setTimestamp()
            .setFooter({ 
                text: 'Sistema de Gerenciamento de Planilhas • Toca da Raposa',
                iconURL: client.user.displayAvatarURL()
            });

        // Adicionar campos específicos baseado no tipo de alteração
        if (oldId) {
            logEmbed.addFields(
                { 
                    name: '🔄 Detalhes da Alteração', 
                    value: `**ID Anterior:**\n\`${oldId}\`\n\n**Novo ID:**\n\`${newId}\``, 
                    inline: false 
                },
                { 
                    name: '🔗 Link da Planilha', 
                    value: `[Clique aqui para acessar](https://docs.google.com/spreadsheets/d/${newId})`, 
                    inline: false 
                }
            );
        } else {
            logEmbed.addFields(
                { 
                    name: '🔄 Detalhes da Alteração', 
                    value: `**Aba Anterior:**\n\`${oldSheet || 'Não configurada'}\`\n\n**Nova Aba:**\n\`${newSheet}\``, 
                    inline: false 
                },
                { 
                    name: '🔗 Link da Planilha', 
                    value: `[Clique aqui para acessar](https://docs.google.com/spreadsheets/d/${servidor.spreadsheetId})`, 
                    inline: false 
                }
            );
        }

        // Enviar para o canal de log
        await channel.send({ embeds: [logEmbed] });

        // Enviar DM para o usuário
        try {
            const dmEmbed = new EmbedBuilder()
                .setColor('#00ff00')
                .setTitle('📊 Alteração na Planilha')
                .setDescription(`Você realizou uma alteração nas configurações da planilha.`)
                .addFields(
                    { name: '🏢 Servidor', value: channel.guild.name, inline: true },
                    { name: '👤 Seu Usuário', value: `<@${userId}> (${userId})`, inline: true },
                    { name: '📝 Alteração', value: oldId ? 'Mudança de ID da planilha' : 'Mudança de aba da planilha', inline: true }
                )
                .setThumbnail(user.displayAvatarURL({ dynamic: true }))
                .setTimestamp()
                .setFooter({ 
                    text: 'Sistema de Gerenciamento de Planilhas • Toca da Raposa',
                    iconURL: client.user.displayAvatarURL()
                });

            // Adicionar campos específicos baseado no tipo de alteração
            if (oldId) {
                dmEmbed.addFields(
                    { 
                        name: '🔄 Detalhes da Alteração', 
                        value: `**ID Anterior:**\n\`${oldId}\`\n\n**Novo ID:**\n\`${newId}\``, 
                        inline: false 
                    },
                    { 
                        name: '🔗 Link da Planilha', 
                        value: `[Clique aqui para acessar](https://docs.google.com/spreadsheets/d/${newId})`, 
                        inline: false 
                    }
                );
            } else {
                dmEmbed.addFields(
                    { 
                        name: '🔄 Detalhes da Alteração', 
                        value: `**Aba Anterior:**\n\`${oldSheet || 'Não configurada'}\`\n\n**Nova Aba:**\n\`${newSheet}\``, 
                        inline: false 
                    },
                    { 
                        name: '🔗 Link da Planilha', 
                        value: `[Clique aqui para acessar](https://docs.google.com/spreadsheets/d/${servidor.spreadsheetId})`, 
                        inline: false 
                    }
                );
            }

            await user.send({ embeds: [dmEmbed] });
        } catch (dmError) {
            console.error('Erro ao enviar DM para o usuário:', dmError);
        }

        // Enviar DM para o suporte
        try {
            const supportUser = await client.users.fetch(SUPPORT_ID);
            if (supportUser) {
                const supportEmbed = new EmbedBuilder()
                    .setColor('#00ff00')
                    .setTitle('📊 Alteração na Planilha')
                    .setDescription(`Uma alteração foi feita nas configurações da planilha por <@${userId}>.`)
                    .addFields(
                        { name: '🏢 Servidor', value: channel.guild.name, inline: true },
                        { name: '👤 Usuário', value: `<@${userId}> (${userId})`, inline: true },
                        { name: '📝 Alteração', value: oldId ? 'Mudança de ID da planilha' : 'Mudança de aba da planilha', inline: true }
                    )
                    .setThumbnail(user.displayAvatarURL({ dynamic: true }))
                    .setTimestamp()
                    .setFooter({ 
                        text: 'Sistema de Gerenciamento de Planilhas • Toca da Raposa',
                        iconURL: client.user.displayAvatarURL()
                    });

                // Adicionar campos específicos baseado no tipo de alteração
                if (oldId) {
                    supportEmbed.addFields(
                        { 
                            name: '🔄 Detalhes da Alteração', 
                            value: `**ID Anterior:**\n\`${oldId}\`\n\n**Novo ID:**\n\`${newId}\``, 
                            inline: false 
                        },
                        { 
                            name: '🔗 Link da Planilha', 
                            value: `[Clique aqui para acessar](https://docs.google.com/spreadsheets/d/${newId})`, 
                            inline: false 
                        }
                    );
                } else {
                    supportEmbed.addFields(
                        { 
                            name: '🔄 Detalhes da Alteração', 
                            value: `**Aba Anterior:**\n\`${oldSheet || 'Não configurada'}\`\n\n**Nova Aba:**\n\`${newSheet}\``, 
                            inline: false 
                        },
                        { 
                            name: '🔗 Link da Planilha', 
                            value: `[Clique aqui para acessar](https://docs.google.com/spreadsheets/d/${servidor.spreadsheetId})`, 
                            inline: false 
                        }
                    );
                }

                await supportUser.send({ embeds: [supportEmbed] });
            }
        } catch (supportError) {
            console.error('Erro ao enviar DM para o suporte:', supportError);
        }
    } catch (error) {
        console.error('Erro ao enviar log para o canal:', error);
    }
}

async function validateSpreadsheetId(spreadsheetId) {
    try {
        // Verificações básicas do ID da planilha
        if (!spreadsheetId || typeof spreadsheetId !== 'string' || spreadsheetId.trim() === '') {
            return {
                valid: false,
                error: 'invalid_format',
                message: 'ID da planilha não fornecido ou inválido.'
            };
        }
        
        // Verificar se o ID tem um formato válido
        if (spreadsheetId.length < 10 || !/^[a-zA-Z0-9-_]+$/.test(spreadsheetId)) {
            return {
                valid: false,
                error: 'invalid_format',
                message: `ID da planilha inválido. Um ID válido deve ter pelo menos 10 caracteres e conter apenas letras, números, hífens e sublinhados.`
            };
        }
        
        const response = await sheets.spreadsheets.get({
            spreadsheetId: spreadsheetId,
            fields: 'spreadsheetId,properties.title'
        });
        return {
            valid: true,
            title: response.data.properties.title
        };
    } catch (error) {
        console.error('Erro ao validar ID da planilha:', error);
        
        if (error.response?.status === 403) {
            return {
                valid: false,
                error: 'permission',
                message: `O bot não tem permissão para acessar esta planilha. Por favor, compartilhe a planilha com o email:\n\`${BOT_EMAIL}\``
            };
        } else if (error.response?.status === 404) {
            return {
                valid: false,
                error: 'not_found',
                message: 'Planilha não encontrada. Verifique se o ID está correto.'
            };
        }
        
        return {
            valid: false,
            error: 'unknown',
            message: 'Erro ao validar a planilha. Tente novamente mais tarde.'
        };
    }
}

async function handlePlanilhaCommand(interaction) {
    try {
        // Verificar se o usuário tem permissão de administrador, cargo de Administrador ou é o suporte
        const hasAdminPermission = interaction.member.permissions.has('Administrator');
        const hasAdminRole = interaction.member.roles.cache.some(role => role.name === 'Administrador');
        const hasSupportPermission = interaction.user.id === SUPPORT_ID;
        
        if (!hasAdminPermission && !hasAdminRole && !hasSupportPermission) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle('🔒 Acesso Negado')
                .setDescription('Você não tem permissão para utilizar este comando.')
                .addFields(
                    { 
                        name: '⚠️ Requisitos', 
                        value: 'Para usar este comando, você precisa ter:\n• Permissão de Administrador\n• OU possuir o cargo "Administrador"\n• OU ser o usuário de suporte', 
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
                embeds: [errorEmbed],
                ephemeral: true
            });
        }

        const guildId = interaction.guildId;
        const servidor = await Servidor.findOne({ guildId });
        
        if (!servidor) {
            const setupEmbed = new EmbedBuilder()
                .setColor('#FFA500')
                .setTitle('⚙️ Configuração Necessária')
                .setDescription('Este servidor ainda não foi configurado adequadamente.')
                .addFields(
                    { 
                        name: '📝 Próximos Passos', 
                        value: 'Use o comando `/painel` primeiro para configurar o sistema corretamente.', 
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

        // Criar o embed com as opções
        const embed = new EmbedBuilder()
            .setColor('#2b2d31')
            .setTitle('📊 Configurações da Planilha')
            .setDescription('Selecione uma das opções abaixo para configurar a planilha do servidor.')
            .addFields(
                { 
                    name: '📋 ID da Planilha Atual', 
                    value: servidor.spreadsheetId ? `\`${servidor.spreadsheetId}\`` : '`Não configurado`', 
                    inline: true 
                },
                { 
                    name: '📑 Aba Atual', 
                    value: servidor.sheetName ? `\`${servidor.sheetName}\`` : '`Não configurada`', 
                    inline: true 
                }
            )
            .setThumbnail(interaction.guild.iconURL({ dynamic: true }))
            .setTimestamp()
            .setFooter({ 
                text: `Solicitado por ${interaction.user.username}`, 
                iconURL: interaction.user.displayAvatarURL({ dynamic: true }) 
            });

        // Criar os botões
        const planilhaButton = new ButtonBuilder()
            .setCustomId('planilha_alterar_id')
            .setLabel('Alterar ID')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('📊');

        const abaButton = new ButtonBuilder()
            .setCustomId('planilha_alterar_aba')
            .setLabel('Alterar Aba')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('📑');

        const linkButton = new ButtonBuilder()
            .setLabel('Acessar Planilha')
            .setStyle(ButtonStyle.Link)
            .setURL(servidor.spreadsheetId ? `https://docs.google.com/spreadsheets/d/${servidor.spreadsheetId}` : '#')
            .setEmoji('🔗')
            .setDisabled(!servidor.spreadsheetId);

        const row = new ActionRowBuilder().addComponents(planilhaButton, abaButton, linkButton);

        const response = await interaction.reply({
            embeds: [embed],
            components: [row],
            ephemeral: true
        });

        const message = await interaction.fetchReply();
        const collector = message.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 60000 // 1 minuto
        });

        collector.on('collect', async (i) => {
            try {
                // Verificar se a interação não expirou
                if (i.isExpired) {
                    const expiredEmbed = new EmbedBuilder()
                        .setColor('#FF0000')
                        .setTitle('⏰ Tempo Expirado')
                        .setDescription('Esta interação expirou. Por favor, use o comando novamente.')
                        .setTimestamp();

                    if (i.deferred || i.replied) {
                        await i.followUp({ embeds: [expiredEmbed], ephemeral: true });
                    } else {
                        await i.reply({ embeds: [expiredEmbed], ephemeral: true });
                    }
                    return;
                }

                if (i.customId === 'planilha_alterar_id') {
                    const modal = new ModalBuilder()
                        .setCustomId('planilha_alterar_id_modal')
                        .setTitle('Alterar ID da Planilha');

                    const planilhaIdInput = new TextInputBuilder()
                        .setCustomId('planilhaId')
                        .setLabel('ID da Planilha')
                        .setStyle(TextInputStyle.Short)
                        .setValue(servidor.spreadsheetId || '')
                        .setPlaceholder('Digite o ID da planilha')
                        .setRequired(true)
                        .setMinLength(5)
                        .setMaxLength(100);

                    const firstActionRow = new ActionRowBuilder().addComponents(planilhaIdInput);
                    modal.addComponents(firstActionRow);

                    await i.showModal(modal);
                } else if (i.customId === 'planilha_alterar_aba') {
                    try {
                        const abas = await getAvailableSheets(servidor.spreadsheetId);
                        let currentPage = 0;
                        const totalPages = Math.ceil(abas.length / 25);

                        const updateMessage = async (page) => {
                            const embed = createPageEmbed(abas, page, totalPages, servidor.sheetName);
                            const selectMenu = createSelectMenu(abas, page * 25, servidor.sheetName);
                            const menuRow = new ActionRowBuilder().addComponents(selectMenu);
                            const buttonRow = createNavigationButtons(page, totalPages);
                            
                            buttonRow.components[2].setURL(`https://docs.google.com/spreadsheets/d/${servidor.spreadsheetId}`);

                            const components = [menuRow];
                            if (totalPages > 1) {
                                components.push(buttonRow);
                            }

                            return { embeds: [embed], components };
                        };

                        try {
                            await i.update(await updateMessage(currentPage));
                        } catch (updateError) {
                            if (updateError.code === 'InteractionAlreadyReplied') {
                                // Se a interação já foi respondida, envie uma nova mensagem
                                await i.followUp({
                                    ...(await updateMessage(currentPage)),
                                    ephemeral: true
                                });
                            } else {
                                throw updateError;
                            }
                        }

                        const selectCollector = i.message.createMessageComponentCollector({
                            componentType: ComponentType.StringSelect,
                            time: 60000
                        });

                        selectCollector.on('collect', async (selectInteraction) => {
                            try {
                                if (selectInteraction.customId === 'select_sheet') {
                                    const novaAba = selectInteraction.values[0];
                                    const abaAntiga = servidor.sheetName;
                                    await Servidor.findOneAndUpdate(
                                        { guildId },
                                        { sheetName: novaAba },
                                        { new: true }
                                    );

                                    await sendLogToChannel(interaction.client, guildId, interaction.user.id, abaAntiga, novaAba);

                                    const updatedEmbed = new EmbedBuilder()
                                        .setColor('#00ff00')
                                        .setTitle('✅ Aba Alterada com Sucesso')
                                        .setDescription(`A aba da planilha foi alterada para: **${novaAba}**`)
                                        .setTimestamp()
                                        .setFooter({ text: 'Sistema de Gerenciamento de Planilhas' });

                                    await selectInteraction.update({
                                        embeds: [updatedEmbed],
                                        components: []
                                    });
                                    selectCollector.stop();
                                } else if (selectInteraction.customId === 'prev_page' || selectInteraction.customId === 'next_page') {
                                    currentPage = selectInteraction.customId === 'prev_page' ? 
                                        Math.max(0, currentPage - 1) : 
                                        Math.min(totalPages - 1, currentPage + 1);
                                    
                                    const updatedMessage = await updateMessage(currentPage);
                                    try {
                                        await selectInteraction.update(updatedMessage);
                                    } catch (updateError) {
                                        if (updateError.code === 'InteractionAlreadyReplied') {
                                            // Se a interação já foi respondida, envie uma nova mensagem
                                            await selectInteraction.followUp({
                                                ...updatedMessage,
                                                ephemeral: true
                                            });
                                        } else {
                                            throw updateError;
                                        }
                                    }
                                }
                            } catch (error) {
                                const errorEmbed = new EmbedBuilder()
                                    .setColor('#FF0000')
                                    .setTitle('❌ Erro no Processamento')
                                    .setDescription('Ocorreu um erro ao processar sua solicitação.')
                                    .addFields(
                                        { 
                                            name: '🔄 Sugestão', 
                                            value: 'Por favor, tente novamente mais tarde. Se o problema persistir, contate um administrador.', 
                                            inline: false 
                                        }
                                    )
                                    .setTimestamp()
                                    .setFooter({ 
                                        text: 'Sistema de Bate Ponto Nychronos', 
                                        iconURL: interaction.guild.iconURL({ dynamic: true }) 
                                    });

                                if (i.deferred || i.replied) {
                                    await i.followUp({
                                        embeds: [errorEmbed],
                                        ephemeral: true
                                    });
                                } else {
                                    await i.reply({
                                        embeds: [errorEmbed],
                                        ephemeral: true
                                    });
                                }
                            }
                        });

                        selectCollector.on('end', async (collected, reason) => {
                            if (reason === 'time') {
                                const timeoutEmbed = new EmbedBuilder()
                                    .setColor('#ff0000')
                                    .setTitle('⏰ Tempo Expirado')
                                    .setDescription('O tempo para interação expirou. Por favor, use o comando novamente.')
                                    .setTimestamp();

                                try {
                                    await message.edit({
                                        embeds: [timeoutEmbed],
                                        components: []
                                    });
                                } catch (error) {
                                    if (error.code === 10008) {
                                        console.log('[LOG] Mensagem já foi deletada, não é possível editar.');
                                    } else {
                                        console.error('[LOG] Erro ao editar mensagem:', error);
                                    }
                                }
                            }
                        });
                    } catch (error) {
                        const errorEmbed = new EmbedBuilder()
                            .setColor('#FF0000')
                            .setTitle('❌ Erro ao Buscar Abas')
                            .setDescription('Ocorreu um erro ao buscar as abas da planilha.')
                            .addFields(
                                { 
                                    name: '🔍 Possíveis causas', 
                                    value: [
                                        '• ID da planilha inválido',
                                        '• Falta de permissão (verifique se o bot tem acesso)',
                                        '• Planilha não encontrada',
                                        '• Erro de conexão com o Google'
                                    ].join('\n'), 
                                    inline: false 
                                },
                                {
                                    name: '📝 Próximos passos',
                                    value: [
                                        '1. Verifique se o ID da planilha está correto',
                                        `2. Compartilhe a planilha com \`${BOT_EMAIL}\``,
                                        '3. Tente novamente usando `/planilha`'
                                    ].join('\n'),
                                    inline: false
                                }
                            )
                            .setTimestamp()
                            .setFooter({ 
                                text: 'Sistema de Bate Ponto Nychronos', 
                                iconURL: interaction.guild.iconURL({ dynamic: true }) 
                            });

                        if (i.deferred || i.replied) {
                            await i.followUp({
                                embeds: [errorEmbed],
                                ephemeral: true
                            });
                        } else {
                            await i.reply({
                                embeds: [errorEmbed],
                                ephemeral: true
                            });
                        }
                    }
                }
            } catch (error) {
                // Verificar se o erro é de interação desconhecida
                if (error.code === 10062) {
                    return; // Silenciosamente ignora o erro de interação desconhecida
                }

                const errorEmbed = new EmbedBuilder()
                    .setColor('#FF0000')
                    .setTitle('❌ Erro no Processamento')
                    .setDescription('Ocorreu um erro ao processar sua solicitação.')
                    .addFields(
                        { 
                            name: '🔄 Sugestão', 
                            value: 'Por favor, tente novamente mais tarde. Se o problema persistir, contate um administrador.', 
                            inline: false 
                        }
                    )
                    .setTimestamp()
                    .setFooter({ 
                        text: 'Sistema de Bate Ponto Nychronos', 
                        iconURL: interaction.guild.iconURL({ dynamic: true }) 
                    });

                try {
                    if (interaction.deferred || interaction.replied) {
                        await interaction.followUp({
                            embeds: [errorEmbed],
                            ephemeral: true
                        });
                    } else {
                        await interaction.reply({
                            embeds: [errorEmbed],
                            ephemeral: true
                        });
                    }
                } catch (e) {
                    console.error('[LOG] Falha ao enviar mensagem de erro:', e);
                }
            }
        });

    } catch (error) {
        const errorEmbed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('❌ Erro no Sistema')
            .setDescription('Ocorreu um erro ao executar o comando.')
            .addFields(
                { 
                    name: '🔄 Sugestão', 
                    value: 'Por favor, tente novamente mais tarde. Se o problema persistir, contate um administrador.', 
                    inline: false 
                }
            )
            .setTimestamp()
            .setFooter({ 
                text: 'Sistema de Bate Ponto Nychronos', 
                iconURL: interaction.guild.iconURL({ dynamic: true }) 
            });

        try {
            if (interaction.deferred || interaction.replied) {
                await interaction.followUp({
                    embeds: [errorEmbed],
                    ephemeral: true
                });
            } else {
                await interaction.reply({
                    embeds: [errorEmbed],
                    ephemeral: true
                });
            }
        } catch (e) {
            console.error('[LOG] Falha ao enviar mensagem de erro:', e);
        }
    }
}

const handleInteraction = async (interaction) => {
    if (!interaction.isModalSubmit()) return;
    if (interaction.customId !== 'planilha_alterar_id_modal') return;

    try {
        await interaction.deferReply({ ephemeral: true });

        const planilhaId = interaction.fields.getTextInputValue('planilhaId').trim();

        if (!planilhaId) {
            const emptyIdEmbed = new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle('❌ Campo Vazio')
                .setDescription('Por favor, preencha o ID da planilha.')
                .addFields(
                    { 
                        name: '📝 Instrução', 
                        value: 'O ID da planilha é necessário para vincular ao sistema de ponto.', 
                        inline: false 
                    }
                )
                .setTimestamp()
                .setFooter({ 
                    text: 'Sistema de Bate Ponto Nychronos', 
                    iconURL: interaction.guild.iconURL({ dynamic: true }) 
                });
                
            return await interaction.editReply({
                embeds: [emptyIdEmbed],
                ephemeral: true
            });
        }

        // Validar o formato do ID da planilha
        const idRegex = /^[a-zA-Z0-9-_]+$/;
        if (!idRegex.test(planilhaId)) {
            const invalidIdEmbed = new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle('❌ ID da Planilha Inválido')
                .setDescription('O ID da planilha fornecido parece ser inválido.')
                .addFields(
                    { 
                        name: '🔍 Verificação', 
                        value: 'Por favor, verifique se você copiou corretamente o ID da planilha e tente novamente.', 
                        inline: false 
                    }
                )
                .setTimestamp()
                .setFooter({ 
                    text: 'Sistema de Bate Ponto Nychronos', 
                    iconURL: interaction.guild.iconURL({ dynamic: true }) 
                });
                
            return await interaction.editReply({
                embeds: [invalidIdEmbed],
                ephemeral: true
            });
        }

        // Validar se a planilha existe e é acessível
        const validation = await validateSpreadsheetId(planilhaId);
        if (!validation.valid) {
            if (validation.error === 'permission') {
                const permissionEmbed = new EmbedBuilder()
                    .setColor('#FF9900')
                    .setTitle('⚠️ Permissão Necessária')
                    .setDescription('O bot precisa de permissão para acessar a planilha.')
                    .addFields(
                        { 
                            name: '📝 Como resolver:', 
                            value: '1. Abra a planilha no Google Sheets\n2. Clique em "Compartilhar" no canto superior direito\n3. Adicione o email abaixo com permissão de "Editor"\n4. Tente novamente após compartilhar', 
                            inline: false
                        },
                        { 
                            name: '📧 Email do Bot', 
                            value: `\`${BOT_EMAIL}\``,
                            inline: false
                        }
                    )
                    .setTimestamp()
                    .setFooter({ 
                        text: 'Sistema de Bate Ponto Nychronos', 
                        iconURL: interaction.guild.iconURL({ dynamic: true }) 
                    });

                return await interaction.editReply({
                    embeds: [permissionEmbed],
                    ephemeral: true
                });
            }
            
            const errorEmbed = new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle('❌ Planilha Inválida')
                .setDescription(validation.message)
                .setTimestamp()
                .setFooter({ 
                    text: 'Sistema de Bate Ponto Nychronos', 
                    iconURL: interaction.guild.iconURL({ dynamic: true }) 
                });
            
            return await interaction.editReply({
                embeds: [errorEmbed],
                ephemeral: true
            });
        }

        // Verificar se a planilha já está em uso em outro servidor
        const existingServer = await Servidor.findOne({ 
            spreadsheetId: planilhaId,
            guildId: { $ne: interaction.guild.id } // Exclui o servidor atual da busca
        });

        if (existingServer) {
            const duplicateEmbed = new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle('❌ Planilha em Uso')
                .setDescription('Esta planilha já está configurada em outro servidor.')
                .addFields(
                    { 
                        name: '⚠️ Aviso', 
                        value: 'Cada servidor deve ter sua própria planilha exclusiva para evitar conflitos de dados.', 
                        inline: false 
                    },
                    {
                        name: '📝 Como resolver',
                        value: '1. Crie uma nova planilha no Google Sheets\n2. Configure a nova planilha com as mesmas colunas\n3. Tente novamente com o ID da nova planilha',
                        inline: false
                    }
                )
                .setTimestamp()
                .setFooter({ 
                    text: 'Sistema de Bate Ponto Nychronos', 
                    iconURL: interaction.guild.iconURL({ dynamic: true }) 
                });

            return await interaction.editReply({
                embeds: [duplicateEmbed],
                ephemeral: true
            });
        }

        const guildId = interaction.guildId;
        const servidor = await Servidor.findOne({ guildId });

        if (!servidor) {
            const setupEmbed = new EmbedBuilder()
                .setColor('#FFA500')
                .setTitle('⚙️ Configuração Necessária')
                .setDescription('Este servidor ainda não foi configurado adequadamente.')
                .addFields(
                    { 
                        name: '📝 Próximos Passos', 
                        value: 'Use o comando `/painel` primeiro para configurar o sistema corretamente.', 
                        inline: false 
                    }
                )
                .setTimestamp()
                .setFooter({ 
                    text: 'Sistema de Bate Ponto Nychronos', 
                    iconURL: interaction.guild.iconURL({ dynamic: true }) 
                });

            return await interaction.editReply({
                embeds: [setupEmbed],
                ephemeral: true
            });
        }

        // Atualizar o ID da planilha
        const oldId = servidor.spreadsheetId;
        servidor.spreadsheetId = planilhaId;
        await servidor.save();

        // Enviar log da alteração
        await sendLogToChannel(interaction.client, guildId, interaction.user.id, null, null, oldId, planilhaId);

        const successEmbed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('✅ Planilha Atualizada com Sucesso')
            .setDescription(`A planilha **${validation.title}** foi vinculada ao servidor.`)
            .addFields(
                { 
                    name: '📤 ID Anterior', 
                    value: oldId ? `\`${oldId}\`` : '`Não configurado`',
                    inline: false 
                },
                { 
                    name: '📥 Novo ID', 
                    value: `\`${planilhaId}\``,
                    inline: false 
                },
                {
                    name: '🔗 Link de Acesso',
                    value: `[Clique aqui para abrir a planilha](https://docs.google.com/spreadsheets/d/${planilhaId})`,
                    inline: false
                }
            )
            .setThumbnail(interaction.guild.iconURL({ dynamic: true }))
            .setTimestamp()
            .setFooter({ 
                text: 'Sistema de Bate Ponto Nychronos', 
                iconURL: interaction.guild.iconURL({ dynamic: true }) 
            });

        // Criar botão para acessar a planilha
        const linkButton = new ButtonBuilder()
            .setLabel('Abrir Planilha')
            .setStyle(ButtonStyle.Link)
            .setURL(`https://docs.google.com/spreadsheets/d/${planilhaId}`)
            .setEmoji('📊');

        const row = new ActionRowBuilder().addComponents(linkButton);

        await interaction.editReply({
            embeds: [successEmbed],
            components: [row]
        });

    } catch (error) {
        const errorEmbed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('❌ Erro Inesperado')
            .setDescription('Ocorreu um erro ao salvar o ID da planilha.')
            .addFields(
                { 
                    name: '🔄 Sugestão', 
                    value: 'Por favor, tente novamente mais tarde. Se o problema persistir, contate um administrador.', 
                    inline: false 
                }
            )
            .setTimestamp()
            .setFooter({ 
                text: 'Sistema de Bate Ponto Nychronos', 
                iconURL: interaction.guild.iconURL({ dynamic: true }) 
            });
        
        try {
            if (interaction.deferred || interaction.replied) {
                await interaction.followUp({
                    embeds: [errorEmbed],
                    ephemeral: true
                });
            } else {
                await interaction.reply({
                    embeds: [errorEmbed],
                    ephemeral: true
                });
            }
        } catch (e) {
            console.error('[LOG] Falha ao enviar mensagem de erro:', e);
        }
    }
};

module.exports = {
    handlePlanilhaCommand,
    handleInteraction
};