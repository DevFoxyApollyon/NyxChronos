const { SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const mongoose = require('mongoose');

// Schema do servidor para armazenar configurações no MongoDB
const servidorSchema = new mongoose.Schema({
    spreadsheetId: { type: String, maxlength: 500 }, // ID da planilha
    sheetName: { type: String, maxlength: 500 }, // Nome da aba na planilha
    cargoPermitido: { type: String, maxlength: 500 }, // Cargo que pode usar o sistema
    responsavelHoras: { type: String, maxlength: 500 }, // Nome do responsável pelas horas
    channelId: { type: String, maxlength: 500 }, // Canal de envio dos dados
    guildId: { type: String, unique: true, required: true }, // ID do servidor (único)
    GOOGLE_CREDENTIALS_PATH: { type: String, maxlength: 500 }, // Adicionando o campo para o caminho do arquivo de credenciais
    showEmbed: { type: Boolean, default: true }, // Adicionando o campo para controlar a exibição da embed no modal de configuração
    blocked: { type: Boolean, default: false } // Adicionando o campo para controlar o estado do servidor
});

// Criação ou reuso do modelo
const Servidor = mongoose.models.Servidor || mongoose.model('Servidor', servidorSchema);

// Função para salvar ou atualizar as configurações no banco de dados
const saveConfig = async (config) => {
    try {
        console.log('Tentando salvar configuração:', config);
        
        // Verifica se o mongoose está conectado
        if (mongoose.connection.readyState !== 1) {
            console.error('MongoDB não está conectado. Estado atual:', mongoose.connection.readyState);
            throw new Error('MongoDB não está conectado');
        }

        const result = await Servidor.findOneAndUpdate(
            { guildId: config.guildId },
            config,
            { upsert: true, new: true }
        );

        console.log('Configuração salva com sucesso:', result);
        return result;
    } catch (error) {
        console.error('Erro detalhado ao salvar a configuração:', error);
        throw error;
    }
};

const handlePainelCommand = async (interaction) => {
    try {
        // Verificar se é o administrador do bot
        const isAdmin = interaction.user.id === '657014871228940336'; // ID do suporte

        // Se não for administrador, verificar permissões do bot
        if (!isAdmin) {
            if (!interaction.guild.members.me.permissions.has(['SendMessages', 'EmbedLinks', 'ManageMessages'])) {
                const permissionEmbed = new EmbedBuilder()
                    .setColor('#FF0000')
                    .setTitle('❌ Permissões Insuficientes')
                    .setDescription('O bot não possui as permissões necessárias para funcionar corretamente.')
                    .addFields(
                        { 
                            name: '🔐 Permissões Necessárias', 
                            value: '• `Enviar Mensagens`\n• `Incorporar Links`\n• `Gerenciar Mensagens`', 
                            inline: false 
                        },
                        {
                            name: '📝 Como Resolver',
                            value: 'Peça a um administrador para verificar as permissões do bot no servidor.',
                            inline: false
                        }
                    )
                    .setTimestamp()
                    .setFooter({ 
                        text: 'Sistema de Bate Ponto Nychronos', 
                        iconURL: interaction.guild.iconURL({ dynamic: true }) 
                    });

                return await interaction.reply({
                    embeds: [permissionEmbed],
                    ephemeral: true
                });
            }

            // Verificar permissão do usuário
            if (!interaction.member.permissions.has('Administrator')) {
                // Notificar o suporte
                try {
                    const SUPPORT_ID = '657014871228940336';
                    const suporteUser = await interaction.client.users.fetch(SUPPORT_ID);
                    
                    const suporteEmbed = new EmbedBuilder()
                        .setColor('#FF0000')
                        .setTitle('⚠️ Tentativa de Acesso ao Painel')
                        .setDescription(`Um usuário tentou acessar o comando /painel sem permissão.`)
                        .addFields(
                            { name: '👤 Usuário', value: `<@${interaction.user.id}> (${interaction.user.tag})`, inline: true },
                            { name: '🆔 ID do Usuário', value: `\`${interaction.user.id}\``, inline: true },
                            { name: '🏢 Servidor', value: `${interaction.guild.name}`, inline: true },
                            { name: '🆔 ID do Servidor', value: `\`${interaction.guild.id}\``, inline: true }
                        )
                        .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
                        .setTimestamp()
                        .setFooter({ 
                            text: 'Sistema de Bate Ponto Nychronos',
                            iconURL: interaction.client.user.displayAvatarURL()
                        });

                    await suporteUser.send({ embeds: [suporteEmbed] });
                } catch (err) {
                    console.error('Erro ao enviar notificação para o suporte:', err);
                }

                const accessEmbed = new EmbedBuilder()
                    .setColor('#FF0000')
                    .setTitle('🔒 Acesso Negado')
                    .setDescription('Você não tem permissão para utilizar este comando.')
                    .addFields(
                        { 
                            name: '⚠️ Requisitos', 
                            value: 'Para usar este comando, você precisa ter permissão de Administrador no servidor.', 
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
                    embeds: [accessEmbed],
                    ephemeral: true
                });
            }
        }

        // Procura a configuração existente no banco
        const servidor = await Servidor.findOne({ guildId: interaction.guild.id });

        // Se existir, exibe as informações
        if (servidor) {
            const embed = new EmbedBuilder()
                .setColor('#2b2d31')
                .setTitle('⚙️ Configurações do Servidor')
                .setDescription('Abaixo estão listadas todas as configurações atuais do servidor.')
                .addFields(
                    {
                        name: '📊 Planilha',
                        value: `\`\`\`${servidor.spreadsheetId || 'Não configurado'}\`\`\``,
                        inline: false
                    },
                    {
                        name: '📑 Aba da Planilha',
                        value: `\`\`\`${servidor.sheetName || 'Não configurado'}\`\`\``,
                        inline: false
                    },
                    {
                        name: '👥 Cargos',
                        value: [
                            `**Cargo Permitido:** ${servidor.cargoPermitido ? `<@&${servidor.cargoPermitido}>` : '`Não configurado`'}`,
                            `**Responsável por Horas:** ${servidor.responsavelHoras ? `<@&${servidor.responsavelHoras}>` : '`Não configurado`'}`
                        ].join('\n'),
                        inline: false
                    },
                    {
                        name: '📝 Canal de Logs',
                        value: servidor.channelId ? `<#${servidor.channelId}>` : '`Não configurado`',
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
            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setLabel('Acessar Planilha')
                        .setStyle(ButtonStyle.Link)
                        .setURL(`https://docs.google.com/spreadsheets/d/${servidor.spreadsheetId}`)
                        .setEmoji('📊')
                        .setDisabled(!servidor.spreadsheetId)
                );

            await interaction.reply({ 
                embeds: [embed], 
                components: [row],
                ephemeral: true 
            });
        } else {
            // Se não existir, exibe o modal para preencher os dados
            const modal = new ModalBuilder()
                .setCustomId('serverConfigModal')
                .setTitle('Configurações do Servidor');

            // Criação dos campos do modal
            const spreadsheetIdInput = new TextInputBuilder()
                .setCustomId('spreadsheetId')
                .setLabel('ID da Planilha do Google Sheets')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Cole o ID da sua planilha aqui')
                .setRequired(true);

            const sheetNameInput = new TextInputBuilder()
                .setCustomId('sheetName')
                .setLabel('Nome da Aba')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Nome da aba onde os dados serão salvos')
                .setRequired(true);

            const cargoPermitidoInput = new TextInputBuilder()
                .setCustomId('cargoPermitido')
                .setLabel('ID do Cargo Permitido')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Cole o ID numérico do cargo (ative o Modo Desenvolvedor)')
                .setRequired(true);

            const responsavelHorasInput = new TextInputBuilder()
                .setCustomId('responsavelHoras')
                .setLabel('ID do Cargo Responsável pelas Horas')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Cole o ID numérico do cargo (ative o Modo Desenvolvedor)')
                .setRequired(true);

            const channelIdInput = new TextInputBuilder()
                .setCustomId('channelId')
                .setLabel('ID do Canal de Log')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Cole o ID numérico do canal (ative o Modo Desenvolvedor)')
                .setRequired(true);

            // Criação das linhas do modal
            const firstActionRow = new ActionRowBuilder().addComponents(spreadsheetIdInput);
            const secondActionRow = new ActionRowBuilder().addComponents(sheetNameInput);
            const thirdActionRow = new ActionRowBuilder().addComponents(cargoPermitidoInput);
            const fourthActionRow = new ActionRowBuilder().addComponents(responsavelHorasInput);
            const fifthActionRow = new ActionRowBuilder().addComponents(channelIdInput);

            // Adiciona as linhas ao modal
            modal.addComponents(firstActionRow, secondActionRow, thirdActionRow, fourthActionRow, fifthActionRow);

            await interaction.showModal(modal);
        }
    } catch (error) {
        console.error('Erro ao executar comando /painel:', error);
        
        // Tratamento específico para diferentes tipos de erro
        if (error.code === 'INTERACTION_ALREADY_REPLIED') {
            return;
        }
        
        if (error.code === 'INTERACTION_TIMEOUT') {
            const timeoutEmbed = new EmbedBuilder()
                .setColor('#FFA500')
                .setTitle('⏰ Tempo Expirado')
                .setDescription('A interação expirou devido ao tempo limite.')
                .addFields(
                    { 
                        name: '🔄 Próximos Passos', 
                        value: 'Por favor, tente executar o comando novamente.', 
                        inline: false 
                    }
                )
                .setTimestamp()
                .setFooter({ 
                    text: 'Sistema de Bate Ponto Nychronos', 
                    iconURL: interaction.guild.iconURL({ dynamic: true }) 
                });

            return await interaction.followUp({ 
                embeds: [timeoutEmbed],
                ephemeral: true 
            }).catch(() => {});
        }

        // Erro genérico mais informativo
        try {
            const errorEmbed = new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle('❌ Erro no Sistema')
                .setDescription('Ocorreu um erro ao processar o comando.')
                .addFields(
                    { 
                        name: '⚠️ Detalhes do Erro', 
                        value: '```' + error.message + '```', 
                        inline: false 
                    },
                    {
                        name: '🔄 Sugestão',
                        value: 'Por favor, tente novamente. Se o problema persistir, contate um administrador.',
                        inline: false
                    }
                )
                .setTimestamp()
                .setFooter({ 
                    text: 'Sistema de Bate Ponto Nychronos', 
                    iconURL: interaction.guild.iconURL({ dynamic: true }) 
                });

            await interaction.reply({ 
                embeds: [errorEmbed],
                ephemeral: true 
            });
        } catch {
            // Se não conseguir responder à interação original, tenta enviar uma nova
            const fallbackEmbed = new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle('❌ Erro no Sistema')
                .setDescription('Ocorreu um erro ao processar o comando.')
                .addFields(
                    {
                        name: '🔄 Sugestão',
                        value: 'Por favor, tente novamente mais tarde.',
                        inline: false
                    }
                )
                .setTimestamp()
                .setFooter({ 
                    text: 'Sistema de Bate Ponto Nychronos', 
                    iconURL: interaction.guild.iconURL({ dynamic: true }) 
                });

            await interaction.followUp({ 
                embeds: [fallbackEmbed],
                ephemeral: true 
            }).catch(() => {});
        }
    }
};

const handleInteraction = async (interaction) => {
    if (!interaction.isModalSubmit()) return;
    if (interaction.customId === 'serverConfigModal') {
        try {
            const spreadsheetId = interaction.fields.getTextInputValue('spreadsheetId');
            const sheetName = interaction.fields.getTextInputValue('sheetName');
            const channelId = interaction.fields.getTextInputValue('channelId');
            const cargoPermitido = interaction.fields.getTextInputValue('cargoPermitido');
            const responsavelHoras = interaction.fields.getTextInputValue('responsavelHoras');

            // Validar se os IDs fornecidos são válidos
            const errors = [];
            
            // Verificar se a planilha já está em uso em outro servidor
            const existingServer = await Servidor.findOne({ 
                spreadsheetId: spreadsheetId,
                guildId: { $ne: interaction.guild.id } // Exclui o servidor atual da busca
            });

            if (existingServer) {
                errors.push('Esta planilha já está configurada em outro servidor. Por favor, crie uma nova planilha para este servidor.');
            }
            
            // Validar channelId (deve ser numérico)
            if (!/^\d+$/.test(channelId)) {
                errors.push('O ID do canal de logs deve ser um ID válido do Discord (apenas números).');
            } else {
                try {
                    const channel = await interaction.guild.channels.fetch(channelId);
                    if (!channel) {
                        errors.push('Canal de logs não encontrado neste servidor.');
                    }
                } catch (error) {
                    errors.push('Canal de logs não encontrado ou inacessível.');
                }
            }
            
            // Validar cargoPermitido (deve ser numérico)
            if (!/^\d+$/.test(cargoPermitido)) {
                errors.push('O ID do cargo permitido deve ser um ID válido do Discord (apenas números).');
            } else {
                try {
                    const role = await interaction.guild.roles.fetch(cargoPermitido);
                    if (!role) {
                        errors.push('Cargo permitido não encontrado neste servidor.');
                    }
                } catch (error) {
                    errors.push('Cargo permitido não encontrado ou inacessível.');
                }
            }
            
            // Validar responsavelHoras (deve ser numérico)
            if (!/^\d+$/.test(responsavelHoras)) {
                errors.push('O ID do cargo responsável por horas deve ser um ID válido do Discord (apenas números).');
            } else {
                try {
                    const role = await interaction.guild.roles.fetch(responsavelHoras);
                    if (!role) {
                        errors.push('Cargo responsável por horas não encontrado neste servidor.');
                    }
                } catch (error) {
                    errors.push('Cargo responsável por horas não encontrado ou inacessível.');
                }
            }
            
            // Se houver erros, retorna uma mensagem com os problemas
            if (errors.length > 0) {
                const errorEmbed = new EmbedBuilder()
                    .setColor('#FF0000')
                    .setTitle('❌ Erro na Configuração')
                    .setDescription('Foram encontrados problemas com os dados fornecidos:')
                    .addFields(
                        { 
                            name: '⚠️ Erros Detectados', 
                            value: errors.map(err => `• ${err}`).join('\n'), 
                            inline: false 
                        },
                        {
                            name: '❓ Como obter os IDs corretos',
                            value: 'Para obter um ID de canal: clique com o botão direito no canal e selecione "Copiar ID".\nPara obter um ID de cargo: vá em Configurações do Servidor > Cargos, clique com o botão direito no cargo e selecione "Copiar ID".\n\n**Nota:** Você precisa ter o Modo Desenvolvedor ativado nas configurações do Discord para ver estas opções.',
                            inline: false
                        }
                    )
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

            // Coleta os dados inseridos no modal
            const config = {
                guildId: interaction.guild.id,
                spreadsheetId,
                sheetName,
                cargoPermitido,
                responsavelHoras,
                channelId,
                GOOGLE_CREDENTIALS_PATH: './credentials.json'
            };

            console.log('📝 Configuração:', {
                servidor: interaction.guild.name,
                planilha: sheetName,
                cargo: cargoPermitido,
                canal: channelId
            });

            // Tenta salvar a configuração
            await saveConfig(config);
            
            console.log('✅ Configuração salva');

            // Buscar nome dos cargos
            let nomeCargoPermitido = 'Desconhecido';
            let nomeResponsavelHoras = 'Desconhecido';
            try {
                const cargoObj = await interaction.guild.roles.fetch(cargoPermitido);
                if (cargoObj) nomeCargoPermitido = cargoObj.name;
            } catch {}
            try {
                const respObj = await interaction.guild.roles.fetch(responsavelHoras);
                if (respObj) nomeResponsavelHoras = respObj.name;
            } catch {}

            // Criar embed de sucesso melhorada
            const guildOwner = await interaction.guild.fetchOwner();
            const memberCount = interaction.guild.memberCount;

            const successEmbed = new EmbedBuilder()
                .setColor('#2b2d31')
                .setTitle('🛠️ Novo Servidor Configurado')
                .setDescription(`O servidor **${interaction.guild.name}** (${interaction.guild.id}) foi configurado usando o comando "/painel".`)
                .addFields(
                    { name: '👤 Configurado por', value: `<@${interaction.user.id}> (${interaction.user.tag})\n(\`${interaction.user.id}\`)`, inline: true },
                    { name: '🆔 ID do Servidor', value: `\`${interaction.guild.id}\``, inline: true },
                    { name: '👥 Membros', value: `${memberCount}`, inline: true },
                    { name: '👑 Dono', value: `<@${guildOwner.id}>`, inline: true },
                    { name: '📊 ID da Planilha', value: `\`${spreadsheetId}\``, inline: false },
                    { name: '📑 Aba da Planilha', value: `\`${sheetName}\``, inline: false },
                    { name: '📝 Canal de Logs', value: `<#${channelId}>`, inline: false },
                    {
                        name: '👥 Cargos Configurados',
                        value: `**Cargo Permitido:** <@&${cargoPermitido}> (${nomeCargoPermitido})\n**Responsável por Horas:** <@&${responsavelHoras}> (${nomeResponsavelHoras})`,
                        inline: false
                    }
                )
                .setThumbnail(interaction.guild.iconURL({ dynamic: true }))
                .setTimestamp()
                .setFooter({ 
                    text: `Hoje às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`,
                    iconURL: interaction.user.displayAvatarURL({ dynamic: true })
                });

            // Criar botão para acessar a planilha
            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setLabel('Acessar Planilha')
                        .setStyle(ButtonStyle.Link)
                        .setURL(`https://docs.google.com/spreadsheets/d/${config.spreadsheetId}`)
                        .setEmoji('📊')
                );

            const message = await interaction.reply({ 
                embeds: [successEmbed], 
                components: [row],
                ephemeral: true 
            });

            // Enviar mensagem privada para o suporte com o nome dos cargos
            try {
                const SUPPORT_ID = '657014871228940336';
                const suporteUser = await interaction.client.users.fetch(SUPPORT_ID);
                const suporteEmbed = new EmbedBuilder()
                    .setColor('#2b2d31')
                    .setTitle('🛠️ Novo Servidor Configurado')
                    .setDescription(`O servidor **${interaction.guild.name}** (${interaction.guild.id}) foi configurado usando o comando "/painel".`)
                    .addFields(
                        { name: '👤 Configurado por', value: `<@${interaction.user.id}> (${interaction.user.tag})\n(\`${interaction.user.id}\`)`, inline: true },
                        { name: '🆔 ID do Servidor', value: `\`${interaction.guild.id}\``, inline: true },
                        { name: '👥 Membros', value: `${memberCount}`, inline: true },
                        { name: '👑 Dono', value: `<@${guildOwner.id}>`, inline: true },
                        { name: '📊 ID da Planilha', value: `\`${spreadsheetId}\``, inline: false },
                        { name: '📑 Aba da Planilha', value: `\`${sheetName}\``, inline: false },
                        { name: '📝 Canal de Logs', value: `<#${channelId}>`, inline: false },
                        {
                            name: '👥 Cargos Configurados',
                            value: `**Cargo Permitido:** <@&${cargoPermitido}> (${nomeCargoPermitido})\n**Responsável por Horas:** <@&${responsavelHoras}> (${nomeResponsavelHoras})`,
                            inline: false
                        }
                    )
                    .setThumbnail(interaction.guild.iconURL({ dynamic: true }))
                    .setTimestamp()
                    .setFooter({ 
                        text: `Hoje às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`,
                        iconURL: interaction.user.displayAvatarURL({ dynamic: true })
                    });
                await suporteUser.send({ embeds: [suporteEmbed] });
            } catch (err) {
                console.error('Erro ao enviar mensagem para o suporte:', err.message);
            }
        } catch (err) {
            console.error('Erro detalhado ao processar interação:', err);
            
            const errorEmbed = new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle('❌ Erro ao Salvar Configuração')
                .setDescription('Ocorreu um problema ao salvar suas configurações.')
                .addFields(
                    { 
                        name: '⚠️ Detalhes do Erro', 
                        value: `\`\`\`${err.message || 'Erro desconhecido'}\`\`\``, 
                        inline: false 
                    },
                    {
                        name: '🔍 Verificação',
                        value: 'Por favor, verifique se todos os dados estão corretos e tente novamente.',
                        inline: false
                    }
                )
                .setTimestamp()
                .setFooter({ 
                    text: 'Sistema de Bate Ponto Nychronos', 
                    iconURL: interaction.guild.iconURL({ dynamic: true }) 
                });
            
            await interaction.reply({ 
                embeds: [errorEmbed], 
                ephemeral: true 
            });
        }
    }
};

module.exports = { handlePainelCommand, handleInteraction };