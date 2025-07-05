const { PointCard } = require('../models/pointCard');
const { EmbedBuilder, PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { Servidor } = require('../models/Servidor');

// ID do suporte do bot
const SUPPORT_ID = '657014871228940336';
const CARTOES_POR_PAGINA = 10;

// Função auxiliar para formatar tempo
function formatarTempo(milissegundos) {
    const minutos = Math.floor(milissegundos / 60000);
    const segundos = Math.floor((milissegundos % 60000) / 1000);
    return `${minutos}m ${segundos}s`;
}

// Função auxiliar para verificar permissões
async function verificarPermissoes(interaction) {
    const member = interaction.member;
    const isAdmin = member.permissions.has(PermissionsBitField.Flags.Administrator);
    const isSupport = member.user.id === SUPPORT_ID;
    
    const servidorConfig = await Servidor.findOne({ guildId: interaction.guildId });
    
    if (isAdmin || isSupport) return true;
    
    if (!servidorConfig || !servidorConfig.responsavelHoras) return false;
    
    return member.roles.cache.has(servidorConfig.responsavelHoras);
}

async function safeReply(interaction, options) {
    try {
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply(options);
        }
    } catch (error) {
        if (error.code !== 10062) {
            console.error('Erro ao responder interação:', error);
        }
    }
}

async function handleCartoesCommand(interaction) {
    try {
        if (!await verificarPermissoes(interaction)) {
            return interaction.reply({
                content: '❌ Você não tem permissão para usar este comando. Apenas administradores, suporte e responsáveis de horas podem acessar.',
                ephemeral: true
            });
        }

        await interaction.deferReply({ ephemeral: true });

        const cartoes = await PointCard.find({
            guildId: interaction.guildId,
            finished: false,
            canceled: false
        }).sort({ createdAt: -1 });

        if (cartoes.length === 0) {
            return interaction.editReply({
                content: '📭 Não há cartões abertos no momento.'
            });
        }

        await mostrarPaginaCartoes(interaction, cartoes, 0);

    } catch (error) {
        console.error('Erro ao executar comando /cartoes:', error);
        await interaction.editReply({
            content: '❌ Ocorreu um erro ao listar os cartões. Por favor, tente novamente mais tarde.'
        });
    }
}

async function mostrarPaginaCartoes(interaction, cartoes, pagina) {
    const tempoAtual = Date.now();
    const membros = new Map();
    
    // Buscar membros em paralelo para melhor performance
    await Promise.all(cartoes.map(async (cartao) => {
        try {
            const membro = await interaction.guild.members.fetch(cartao.userId);
            membros.set(cartao.userId, membro);
        } catch (e) {
            console.log(`Membro não encontrado: ${cartao.userId}`);
        }
    }));

    const inicio = pagina * CARTOES_POR_PAGINA;
    const fim = inicio + CARTOES_POR_PAGINA;
    const cartoesPagina = cartoes.slice(inicio, fim);
    const totalPaginas = Math.ceil(cartoes.length / CARTOES_POR_PAGINA);

    // Cor dinâmica conforme status do primeiro cartão da página
    let corEmbed = '#0099ff';
    if (cartoesPagina.length > 0) {
        if (cartoesPagina[0].isPaused) corEmbed = '#ffcc00'; // amarelo
        else if (cartoesPagina[0].lastVoiceChannelLeftAt) corEmbed = '#ff3333'; // vermelho
        else corEmbed = '#00cc66'; // verde
    }

    const embed = new EmbedBuilder()
        .setTitle('📋 Cartões Ativos')
        .setColor(corEmbed)
        .setDescription('━━━━━━━━━━━━━━━━━━━━\n**Lista de cartões ativos e pausados:**\n━━━━━━━━━━━━━━━━━━━━')
        .setFooter({ 
            text: `Página ${pagina + 1} de ${totalPaginas} • Total de cartões: ${cartoes.length} • Solicitado por: ${interaction.user.username}`,
            iconURL: interaction.user.displayAvatarURL({ dynamic: true })
        })
        .setTimestamp();

    for (const cartao of cartoesPagina) {
        const usuario = membros.get(cartao.userId);
        const nomeUsuario = usuario ? usuario.displayName : 'Usuário não encontrado';
        const status = cartao.isPaused ? '⏸️ Pausado' : (cartao.lastVoiceChannelLeftAt ? '🔴 Fora do Canal' : '▶️ Ativo');
        const link = `https://discord.com/channels/${cartao.guildId}/${cartao.channelId}/${cartao.messageId}`;
        const avatarURL = usuario ? usuario.displayAvatarURL({ dynamic: true }) : null;

        // Cor do campo conforme status
        let separador = '━━━━━━━━━━━━━━';
        let canalVoz = '';
        if (usuario && usuario.voice && usuario.voice.channelId) {
            canalVoz = `🟢 **No canal:** <#${usuario.voice.channelId}> \`${usuario.voice.channel.name}\``;
        } else if (cartao.lastVoiceChannelLeftAt) {
            canalVoz = `🔴 **Fora do canal há:** ${formatarTempo(tempoAtual - new Date(cartao.lastVoiceChannelLeftAt).getTime())}\n📝 **Última call:** \`${cartao.lastVoiceChannelName || 'Desconhecida'}\``;
        } else {
            canalVoz = '⚪ **Nunca entrou em um canal de voz desde que abriu o ponto.**';
        }

        let info = [
            `🔗 [Ver Cartão](${link})`,
            avatarURL ? `[⠀](${avatarURL})` : '', // avatar como link "invisível" para não poluir
            cartao.isPaused ? '⏸️ **Cartão pausado.**' : '',
            canalVoz,
            !cartao.isPaused && usuario && usuario.voice && usuario.voice.channelId && cartao.lastVoiceChannelJoinedAt
                ? `⏱️ **Tempo em call:** ${formatarTempo(tempoAtual - new Date(cartao.lastVoiceChannelJoinedAt).getTime())}`
                : '',
            separador
        ].filter(Boolean).join('\n');

        embed.addFields({
            name: `${status} ${nomeUsuario}`,
            value: info,
            inline: false
        });

        // Adiciona avatar do usuário no primeiro cartão da página
        if (avatarURL && cartao === cartoesPagina[0]) {
            embed.setThumbnail(avatarURL);
        }
    }

    // Botões de paginação
    const row = new ActionRowBuilder();
    if (pagina > 0) {
        row.addComponents(
            new ButtonBuilder()
                .setCustomId('cartoes_anterior')
                .setLabel('⬅️ Anterior')
                .setStyle(ButtonStyle.Primary)
        );
    }
    if ((pagina + 1) * CARTOES_POR_PAGINA < cartoes.length) {
        row.addComponents(
            new ButtonBuilder()
                .setCustomId('cartoes_proximo')
                .setLabel('Próxima ➡️')
                .setStyle(ButtonStyle.Primary)
        );
    }

    await interaction.editReply({
        embeds: [embed],
        components: row.components.length > 0 ? [row] : []
    });

    // Coletor de botões com timeout aumentado
    const filter = i => i.user.id === interaction.user.id && (i.customId === 'cartoes_anterior' || i.customId === 'cartoes_proximo');
    const collector = interaction.channel.createMessageComponentCollector({ filter, time: 300000, max: 1 });

    collector.on('collect', async i => {
        await i.deferUpdate();
        if (i.customId === 'cartoes_anterior') {
            await mostrarPaginaCartoes(i, cartoes, pagina - 1);
        } else if (i.customId === 'cartoes_proximo') {
            await mostrarPaginaCartoes(i, cartoes, pagina + 1);
        }
    });
}

module.exports = { handleCartoesCommand }; 