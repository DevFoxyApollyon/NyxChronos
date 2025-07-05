const { Servidor } = require('../models/Servidor');
const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ComponentType } = require('discord.js');

/**
 * Cria um embed para a seleção do tipo de cargo
 */
function createRoleTypeEmbed() {
    return new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle('👥 Gerenciamento de Cargos')
        .setDescription('Selecione qual cargo você deseja modificar:')
        .setTimestamp()
        .setFooter({ text: 'Sistema de Gerenciamento de Cargos' });
}

/**
 * Cria um menu de seleção para o tipo de cargo
 */
function createRoleTypeMenu() {
    return new StringSelectMenuBuilder()
        .setCustomId('select_role_type')
        .setPlaceholder('Selecione o tipo de cargo')
        .addOptions([
            {
                label: 'Cargo Permitido',
                description: 'Cargo que pode usar o comando de ponto',
                value: 'cargoPermitido',
                emoji: '✅'
            },
            {
                label: 'Responsável por Horas',
                description: 'Cargo que gerencia as horas',
                value: 'responsavelHoras',
                emoji: '⏰'
            }
        ]);
}

/**
 * Cria um embed para a seleção do cargo com informação de página
 */
function createRoleSelectionEmbed(roleType, page, totalPages) {
    const title = roleType === 'cargoPermitido' ? '✅ Cargo Permitido' : '⏰ Responsável por Horas';
    const description = roleType === 'cargoPermitido' 
        ? 'Selecione o cargo que poderá usar o comando de ponto:'
        : 'Selecione o cargo que será responsável por gerenciar as horas:';

    return new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle(title)
        .setDescription(`${description}\n\nPágina ${page + 1} de ${totalPages}`)
        .setTimestamp()
        .setFooter({ text: 'Sistema de Gerenciamento de Cargos' });
}

/**
 * Cria um menu de seleção para os cargos do servidor com paginação
 */
function createServerRolesMenu(roles, roleType, page = 0) {
    // Reduzindo para 23 para deixar espaço para os dois botões de navegação
    const itemsPerPage = 23; 
    const startIndex = page * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const totalPages = Math.ceil(roles.size / itemsPerPage);
    
    const rolesArray = Array.from(roles.values())
        .slice(startIndex, endIndex)
        .map(role => ({
            label: role.name.length > 25 ? role.name.substring(0, 22) + '...' : role.name,
            description: `ID: ${role.id}`,
            value: `role_${role.id}`,
            emoji: '👥'
        }));

    // Adiciona opções de navegação se necessário
    const navigationOptions = [];
    
    if (totalPages > 1) {
        if (page > 0) {
            navigationOptions.push({
                label: '⬅️ Página Anterior',
                description: `Voltar para a página ${page}`,
                value: `page_${page - 1}`,
                emoji: '⬅️'
            });
        }
        
        if (page < totalPages - 1) {
            navigationOptions.push({
                label: '➡️ Próxima Página',
                description: `Ir para a página ${page + 2}`,
                value: `page_${page + 1}`,
                emoji: '➡️'
            });
        }
    }
    
    // Verifica se a adição dos botões de navegação não ultrapassa o limite de 25
    const totalOptions = rolesArray.length + navigationOptions.length;
    if (totalOptions > 25) {
        // Se ultrapassar, remove os últimos cargos para abrir espaço para os botões
        const spaceNeeded = totalOptions - 25;
        rolesArray.splice(rolesArray.length - spaceNeeded, spaceNeeded);
    }
    
    // Adiciona os botões de navegação ao array de opções
    rolesArray.push(...navigationOptions);

    // Verifica novamente se o total não ultrapassou 25 (garantia extra)
    if (rolesArray.length > 25) {
        console.warn(`Aviso: Número de opções (${rolesArray.length}) excede o limite de 25. Ajustando...`);
        rolesArray.length = 25;
    }

    return new StringSelectMenuBuilder()
        .setCustomId('select_server_role')
        .setPlaceholder(`Selecione um cargo (Página ${page + 1}/${totalPages})`)
        .addOptions(rolesArray);
}

/**
 * Envia um log para o canal configurado e DM do suporte, mostrando o nome dos cargos
 */
async function sendLogToChannel(client, guildId, userId, roleType, newRoleId, newRoleName, oldRoleId, oldRoleName) {
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

        const roleTypeName = roleType === 'cargoPermitido' ? 'Cargo Permitido' : 'Responsável por Horas';

        const embed = new EmbedBuilder()
            .setColor('#00ff00')
            .setTitle('👥 Alteração de Cargo')
            .setDescription('Uma alteração foi feita nas configurações de cargos.')
            .addFields(
                { name: '👤 Usuário', value: `<@${userId}>`, inline: true },
                { name: '📝 Alteração', value: roleTypeName, inline: true },
                { name: '🔄 Detalhes', value: `Cargo anterior: ${oldRoleId ? `<@&${oldRoleId}> (${oldRoleName})` : 'Não configurado'}\nNovo cargo: <@&${newRoleId}> (${newRoleName})`, inline: false },
                { name: '🏢 Servidor', value: channel.guild.name, inline: true },
                { name: '🆔 ID do Servidor', value: guildId, inline: true }
            )
            .setThumbnail(channel.guild.iconURL({ dynamic: true }))
            .setTimestamp()
            .setFooter({ text: 'Sistema de Gerenciamento de Cargos', iconURL: client.user.displayAvatarURL() });

        await channel.send({ embeds: [embed] });

        // Enviar log para o DM do suporte
        const SUPPORT_ID = '657014871228940336';
        try {
            const supportUser = await client.users.fetch(SUPPORT_ID);
            if (supportUser) {
                const supportEmbed = new EmbedBuilder()
                    .setColor('#ff9900')
                    .setTitle('🔔 Notificação de Alteração de Cargo')
                    .setDescription('Uma alteração foi feita nas configurações de cargos em um servidor.')
                    .addFields(
                        { name: '👤 Usuário', value: `<@${userId}>`, inline: true },
                        { name: '📝 Alteração', value: roleTypeName, inline: true },
                        { name: '🔄 Detalhes', value: `Cargo anterior: ${oldRoleId ? `<@&${oldRoleId}> (${oldRoleName})` : 'Não configurado'}\nNovo cargo: <@&${newRoleId}> (${newRoleName})`, inline: false },
                        { name: '🏢 Servidor', value: channel.guild.name, inline: true },
                        { name: '🆔 ID do Servidor', value: guildId, inline: true }
                    )
                    .setThumbnail(channel.guild.iconURL({ dynamic: true }))
                    .setTimestamp()
                    .setFooter({ text: 'Sistema de Gerenciamento de Cargos - Notificação de Suporte', iconURL: client.user.displayAvatarURL() });

                await supportUser.send({ embeds: [supportEmbed] });
            }
        } catch (supportError) {
            console.error('Erro ao enviar log para o DM do suporte:', supportError);
        }
    } catch (error) {
        console.error('Erro ao enviar log para o canal:', error);
    }
}

/**
 * Manipula o comando de cargos
 */
async function handleCargosCommand(interaction) {
    try {
        // Verificar se o usuário tem permissão de administrador ou é o suporte
        const SUPPORT_ID = '657014871228940336';
        const isAdmin = interaction.member.permissions.has('Administrator');
        const isSupport = interaction.user.id === SUPPORT_ID;

        if (!isAdmin && !isSupport) {
            return await interaction.reply({
                content: '❌ Você precisa ter permissão de administrador ou ser o suporte para usar este comando.',
                ephemeral: true
            });
        }

        const guildId = interaction.guildId;
        const servidor = await Servidor.findOne({ guildId });
        
        if (!servidor) {
            return await interaction.reply({
                content: '❌ Este servidor ainda não foi configurado. Use o comando `/painel` primeiro.',
                ephemeral: true
            });
        }

        const embed = createRoleTypeEmbed();
        const menu = createRoleTypeMenu();
        const row = new ActionRowBuilder().addComponents(menu);

        const response = await interaction.reply({
            embeds: [embed],
            components: [row],
            ephemeral: true
        });

        const collector = response.createMessageComponentCollector({
            componentType: ComponentType.StringSelect,
            time: 300000 // 5 minutos
        });

        let selectedRoleType = null;
        let currentPage = 0;

        collector.on('collect', async (i) => {
            if (i.customId === 'select_role_type') {
                selectedRoleType = i.values[0];
                
                const roles = interaction.guild.roles.cache
                    .filter(role => role.id !== interaction.guild.id)
                    .sort((a, b) => b.position - a.position);

                const totalPages = Math.ceil(roles.size / 24);
                const roleEmbed = createRoleSelectionEmbed(selectedRoleType, currentPage, totalPages);
                const roleMenu = createServerRolesMenu(roles, selectedRoleType, currentPage);
                const roleRow = new ActionRowBuilder().addComponents(roleMenu);

                try {
                    await i.update({
                        embeds: [roleEmbed],
                        components: [roleRow]
                    });
                } catch (updateError) {
                    if (updateError.code === 'InteractionAlreadyReplied') {
                        // Se a interação já foi respondida, envie uma nova mensagem
                        await i.followUp({
                            embeds: [roleEmbed],
                            components: [roleRow],
                            ephemeral: true
                        });
                    } else {
                        console.error('Erro ao atualizar seleção de tipo de cargo:', updateError);
                    }
                }
            } else if (i.customId === 'select_server_role') {
                const value = i.values[0];

                if (value.startsWith('page_')) {
                    // Navegação de página
                    currentPage = parseInt(value.split('_')[1]);
                    const roles = interaction.guild.roles.cache
                        .filter(role => role.id !== interaction.guild.id)
                        .sort((a, b) => b.position - a.position);

                    const totalPages = Math.ceil(roles.size / 24);
                    const roleEmbed = createRoleSelectionEmbed(selectedRoleType, currentPage, totalPages);
                    const roleMenu = createServerRolesMenu(roles, selectedRoleType, currentPage);
                    const roleRow = new ActionRowBuilder().addComponents(roleMenu);

                    try {
                        await i.update({
                            embeds: [roleEmbed],
                            components: [roleRow]
                        });
                    } catch (updateError) {
                        if (updateError.code === 'InteractionAlreadyReplied') {
                            // Se a interação já foi respondida, envie uma nova mensagem
                            await i.followUp({
                                embeds: [roleEmbed],
                                components: [roleRow],
                                ephemeral: true
                            });
                        } else {
                            console.error('Erro ao atualizar navegação:', updateError);
                        }
                    }
                } else {
                    // Seleção de cargo
                    const roleId = value.split('_')[1];
                    const newRole = interaction.guild.roles.cache.get(roleId);

                    try {
                        // Buscar o cargo antigo ANTES do update!
                        const servidorAtual = await Servidor.findOne({ guildId });
                        const oldRoleId = selectedRoleType === 'cargoPermitido' 
                            ? servidorAtual.cargoPermitido 
                            : servidorAtual.responsavelHoras;
                        const oldRoleObj = interaction.guild.roles.cache.get(oldRoleId);
                        const oldRoleName = oldRoleObj ? oldRoleObj.name : 'Desconhecido';

                        await Servidor.findOneAndUpdate(
                            { guildId },
                            { [selectedRoleType]: roleId },
                            { new: true }
                        );

                        // Enviar log se o canal estiver configurado
                        if (servidorAtual.channelId) {
                            await sendLogToChannel(
                                interaction.client,
                                guildId,
                                interaction.user.id,
                                selectedRoleType,
                                roleId,
                                newRole.name,
                                oldRoleId,
                                oldRoleName
                            );
                        }

                        const embed = new EmbedBuilder()
                            .setColor('#00ff00')
                            .setTitle('✅ Cargo Atualizado')
                            .setDescription(`O cargo foi atualizado com sucesso!\n\n**Cargo Anterior:** ${oldRoleId ? `<@&${oldRoleId}>` : 'Não configurado'}\n**Novo Cargo:** <@&${roleId}>`)
                            .setTimestamp()
                            .setFooter({ text: 'Sistema de Gerenciamento de Cargos' });

                        try {
                            await i.update({
                                embeds: [embed],
                                components: []
                            });
                        } catch (updateError) {
                            if (updateError.code === 'InteractionAlreadyReplied') {
                                // Se a interação já foi respondida, envie uma nova mensagem
                                await i.followUp({
                                    embeds: [embed],
                                    ephemeral: true
                                });
                            } else {
                                throw updateError;
                            }
                        }
                        collector.stop();
                    } catch (error) {
                        console.error('Erro ao atualizar cargo:', error);
                        try {
                            await i.update({
                                content: '❌ Erro ao atualizar o cargo. Por favor, tente novamente.',
                                embeds: [],
                                components: []
                            });
                        } catch (updateError) {
                            if (updateError.code === 'InteractionAlreadyReplied') {
                                // Se a interação já foi respondida, envie uma nova mensagem
                                await i.followUp({
                                    content: '❌ Erro ao atualizar o cargo. Por favor, tente novamente.',
                                    ephemeral: true
                                });
                            } else {
                                console.error('Erro secundário ao responder:', updateError);
                            }
                        }
                        collector.stop();
                    }
                }
            }
        });

        collector.on('end', async (collected, reason) => {
            if (reason === 'time' && !collected.find(c => c.customId === 'select_server_role')) {
                const timeoutEmbed = new EmbedBuilder()
                    .setColor('#ff0000')
                    .setTitle('⏰ Tempo Expirado')
                    .setDescription('O tempo para selecionar um cargo expirou. Por favor, use o comando novamente.')
                    .setTimestamp();

                await interaction.editReply({
                    embeds: [timeoutEmbed],
                    components: []
                });
            }
        });

        // Adicionar um temporizador para deletar a mensagem após 5 minutos
        setTimeout(async () => {
            try {
                await interaction.deleteReply();
            } catch (error) {
                console.error('Erro ao deletar mensagem:', error);
            }
        }, 5 * 60 * 1000);

    } catch (error) {
        console.error('Erro ao executar comando:', error);
        await interaction.reply({
            content: '❌ Ocorreu um erro ao executar o comando. Por favor, tente novamente.',
            ephemeral: true
        });
    }
}

module.exports = { handleCargosCommand }; 