const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder } = require('discord.js');
const { Servidor } = require('../models/Servidor');

const SUPPORT_ID = '657014871228940336';

const CATEGORIAS = {
    BUG: { label: '🐛 Bug', value: 'BUG', description: 'Reportar um problema ou erro' },
    SUGESTAO: { label: '💡 Sugestão', value: 'SUGESTAO', description: 'Sugerir uma nova funcionalidade' },
    DUVIDA: { label: '❓ Dúvida', value: 'DUVIDA', description: 'Tirar dúvidas sobre o bot' },
    OUTRO: { label: '📝 Outro', value: 'OUTRO', description: 'Outros assuntos' }
};

async function handleReportarCommand(interaction) {
    try {
        // Verificar se o usuário tem o cargo permitido
        const servidor = await Servidor.findOne({ guildId: interaction.guild.id });
        if (!servidor || !servidor.cargoPermitido) {
            return await interaction.reply({
                content: '❌ Este servidor não possui um cargo configurado para usar este comando. Peça para um administrador configurar usando `/painel`.',
                ephemeral: true
            });
        }

        const member = await interaction.guild.members.fetch(interaction.user.id);
        if (!member.roles.cache.has(servidor.cargoPermitido)) {
            return await interaction.reply({
                content: `❌ Você precisa ter o cargo <@&${servidor.cargoPermitido}> para usar este comando.`,
                ephemeral: true
            });
        }

        // Criar menu de seleção de categoria
        const row = new ActionRowBuilder()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('categoria_reporte')
                    .setPlaceholder('Selecione a categoria do seu reporte')
                    .addOptions(Object.values(CATEGORIAS))
            );

        await interaction.reply({
            content: '📝 Por favor, selecione a categoria do seu reporte:',
            components: [row],
            ephemeral: true
        });

    } catch (error) {
        console.error('Erro ao iniciar reporte:', error);
        await interaction.reply({
            content: '❌ Ocorreu um erro ao iniciar o reporte. Por favor, tente novamente mais tarde.',
            ephemeral: true
        });
    }
}

async function handleCategoriaSelect(interaction) {
    try {
        const categoria = interaction.values[0];
        
        // Criar o modal
        const modal = new ModalBuilder()
            .setCustomId(`report_modal_${categoria}`)
            .setTitle(`📢 ${CATEGORIAS[categoria].label}`);

        // Campo obrigatório para o problema
        const problemaInput = new TextInputBuilder()
            .setCustomId('problema')
            .setLabel('Descreva em detalhes')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMinLength(10)
            .setMaxLength(1000);

        // Campo opcional para link
        const linkInput = new TextInputBuilder()
            .setCustomId('link')
            .setLabel('Link relacionado (opcional)')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setPlaceholder('https://...');

        const primeiroActionRow = new ActionRowBuilder().addComponents(problemaInput);
        const segundoActionRow = new ActionRowBuilder().addComponents(linkInput);

        modal.addComponents(primeiroActionRow, segundoActionRow);

        await interaction.showModal(modal);

    } catch (error) {
        console.error('Erro ao mostrar modal do reporte:', error);
        await interaction.reply({
            content: '❌ Ocorreu um erro ao abrir o formulário. Por favor, tente novamente mais tarde.',
            ephemeral: true
        });
    }
}

async function handleReportModal(interaction) {
    try {
        const [_, __, categoria] = interaction.customId.split('_');
        const problema = interaction.fields.getTextInputValue('problema');
        const link = interaction.fields.getTextInputValue('link');
        const user = interaction.user;
        const guild = interaction.guild;
        const member = await guild.members.fetch(user.id);
        const avatarUrl = user.displayAvatarURL({ dynamic: true, size: 256 });

        // Gerar link de convite para o servidor
        let inviteUrl = null;
        try {
            const channel = guild.channels.cache.find(c => c.isTextBased && c.permissionsFor(guild.members.me).has('CreateInstantInvite'));
            if (channel) {
                const invite = await channel.createInvite({ maxAge: 86400, maxUses: 5, reason: 'Suporte via /reportar' });
                inviteUrl = invite.url;
            }
        } catch (e) {
            inviteUrl = null;
        }

        // Montar a embed melhorada
        const embedSuporte = new EmbedBuilder()
            .setTitle(`📢 Novo Reporte: ${CATEGORIAS[categoria].label}`)
            .setColor(getColorByCategoria(categoria))
            .setThumbnail(avatarUrl)
            .setDescription(`**Mensagem:**\n${problema}`)
            .addFields(
                {
                    name: '👤 Usuário',
                    value: `<@${user.id}> | ${user.tag} | ID: ${user.id}`,
                    inline: false
                },
                {
                    name: '🏠 Servidor',
                    value: `${guild.name} | ID: ${guild.id}`,
                    inline: false
                },
                {
                    name: '📅 Data',
                    value: new Date().toLocaleString('pt-BR'),
                    inline: true
                }
            )
            .setFooter({ text: 'Sistema de Suporte', iconURL: avatarUrl })
            .setTimestamp();

        if (link) {
            embedSuporte.addFields({
                name: '🔗 Link Relacionado',
                value: link
            });
        }
        if (inviteUrl) {
            embedSuporte.addFields({
                name: '📨 Convite para o Servidor',
                value: `[Clique para entrar](${inviteUrl})`
            });
        }

        // Botão para responder em privado
        const buttons = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setLabel('Responder em Privado')
                    .setStyle(ButtonStyle.Link)
                    .setURL(`https://discord.com/users/${user.id}`)
                    .setEmoji('💬')
            );

        // Enviar mensagem para o suporte
        const supportUser = await interaction.client.users.fetch(SUPPORT_ID);
        await supportUser.send({ embeds: [embedSuporte], components: [buttons] });

        // Responder ao usuário
        const userEmbed = new EmbedBuilder()
            .setColor(getColorByCategoria(categoria))
            .setTitle('✅ Reporte Enviado com Sucesso!')
            .setDescription('Seu reporte foi enviado para o suporte. Em breve você receberá uma resposta.')
            .addFields(
                {
                    name: '📝 Categoria',
                    value: CATEGORIAS[categoria].label,
                    inline: true
                }
            )
            .setTimestamp();

        await interaction.reply({
            embeds: [userEmbed],
            ephemeral: true
        });

    } catch (error) {
        console.error('Erro ao processar reporte:', error);
        await interaction.reply({
            content: '❌ Ocorreu um erro ao enviar seu reporte. Por favor, tente novamente mais tarde.',
            ephemeral: true
        });
    }
}

function getColorByCategoria(categoria) {
    const cores = {
        BUG: '#ff0000',
        SUGESTAO: '#00ff00',
        DUVIDA: '#0099ff',
        OUTRO: '#ff9900'
    };
    return cores[categoria] || '#ffffff';
}

module.exports = { 
    handleReportarCommand,
    handleCategoriaSelect,
    handleReportModal
}; 