const { PointCard } = require('../models/pointCard');
const { User } = require('../models/user');
const { Servidor } = require('../models/Servidor');
const { generateEmbed, generateButtons } = require('../utils/embed');
const { formatTime, calculateTotalTime } = require('../utils/time');
const { sendToGoogleSheets, getStartDay, getColumnLetter, getBrasiliaDay } = require('../utils/googleSheets');
const { PermissionsBitField, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { ROLE_ID } = process.env;
const messageData = new Map();
const { handleAjudarCommand, handleHelpButton } = require('../commands/ajudar');

const SUPPORT_ID = '657014871228940336';
const TEMPO_MENSAGEM = 10000;
const TEMPO_MINIMO_INTERACAO = 10 * 1000;
const TEMPO_VERIFICACAO = 5 * 60 * 1000; // 5 minutos em milissegundos
const CACHE_TEMPO = 10 * 60 * 1000; // 10 minutos em milissegundos

const DEBUG_LOG = false; // Coloque false para desativar os logs

// Cache para armazenar os cartões já verificados
const cartoesVerificados = new Map();

function debugLog(...args) {
  if (DEBUG_LOG) {
    console.log(...args);
  }
}

async function excluirResposta(interaction) {
  setTimeout(() => interaction.deleteReply().catch(err => 
    console.error('Erro ao excluir resposta:', err)), TEMPO_MENSAGEM);
}

async function handleButtonInteraction(interaction, client) {
  try {
    const customId = interaction.customId;

    if (interaction.customId.startsWith('cartoes_')) {
      // Chama mostrarPaginaCartoes ou lógica de paginação
      return;
    }

    // Verificar se é um botão do comando /ajudar
    if (customId.startsWith('help_')) {
      await handleHelpButton(interaction);
      return;
    }

    if (customId?.startsWith('planilha_')) {
      return;
    }

    // Handler para botão de marcar como erro
    if (customId?.startsWith('error_')) {
      const messageId = customId.split('_')[1];
      const pointCard = await PointCard.findOne({ messageId });
      
      if (!pointCard) {
        // Verificar se existe algum cartão ativo para o usuário
        const activeCard = await PointCard.findOne({
          userId: interaction.user.id,
          finished: false,
          status: 'active'
        });

        if (activeCard) {
          activeCard.finished = true;
          activeCard.status = 'error';
          activeCard.endTime = new Date();
          activeCard.history.push({
            action: 'Marcado como Erro - Mensagem não encontrada',
            time: new Date(),
            user: interaction.user.tag
          });
          await activeCard.save();

          try {
            await interaction.reply({
              content: '✅ Cartão marcado como erro com sucesso! Você já pode criar um novo cartão usando `/ponto`.',
              ephemeral: true
            });
            await excluirResposta(interaction);
          } catch (error) {
            if (error.code === 10062) {
              console.warn('[handleButtonInteraction] Interação expirada ao tentar responder');
              return;
            }
            throw error;
          }
          return;
        }

        try {
          await interaction.reply({
            content: '❌ Cartão não encontrado. Use `/ponto` para criar um novo cartão.',
            ephemeral: true
          });
          await excluirResposta(interaction);
        } catch (error) {
          if (error.code === 10062) {
            console.warn('[handleButtonInteraction] Interação expirada ao tentar responder');
            return;
          }
          throw error;
        }
        return;
      }

      pointCard.status = 'error';
      pointCard.finished = true;
      pointCard.endTime = new Date();
      pointCard.history.push({
        action: 'Marcado como Erro',
        time: new Date(),
        user: interaction.user.tag
      });

      await pointCard.save();

      try {
        const channel = await client.channels.fetch(pointCard.channelId);
        if (!channel) {
          throw new Error('Canal não encontrado');
        }
        const message = await channel.messages.fetch(messageId);
        await message.edit({
          embeds: [await generateEmbed(interaction.user, pointCard, messageId, interaction)],
          components: []
        });
      } catch (error) {
        if (
          error.code === 10008 ||
          error.message?.includes('Unknown Message') ||
          error.message === 'Canal não encontrado'
        ) {
          // Finaliza o cartão no banco de dados
          pointCard.status = 'error';
          pointCard.finished = true;
          pointCard.endTime = new Date();
          pointCard.history.push({
            action: 'Marcado como Erro (canal/mensagem não encontrado)',
            time: new Date(),
            user: interaction.user.tag
          });
          await pointCard.save();

          await interaction.reply({
            content: '✅ Cartão marcado como erro com sucesso! Você já pode criar um novo cartão usando `/ponto`.',
            ephemeral: true
          });
          await excluirResposta(interaction);
          return;
        }
        throw error; // Outros erros, relança
      }

      await interaction.reply({
        content: '✅ Cartão marcado como erro com sucesso! Você já pode criar um novo cartão usando `/ponto`.',
        ephemeral: true
      });
      await excluirResposta(interaction);
      return;
    }

    // Remover o handler para botão de novo cartão
    if (customId === 'new_card') {
      await interaction.reply({
        content: '❌ Esta funcionalidade foi desativada.',
        ephemeral: true
      });
      await excluirResposta(interaction);
      return;
    }

    const pointCardInDB = await PointCard.findOne({ messageId: interaction.message.id });
    const pointCardFromMap = messageData.get(interaction.message.id);
    
    if (!pointCardInDB && !pointCardFromMap) {
      // Verificar se existe algum cartão ativo para o usuário
      const activeCard = await PointCard.findOne({
        userId: interaction.user.id,
        finished: false,
        status: 'active'
      });

      if (activeCard) {
        // Finalizar o cartão automaticamente
        activeCard.finished = true;
        activeCard.status = 'error';
        activeCard.endTime = new Date();
        activeCard.history.push({
          action: 'Finalizado automaticamente - Mensagem não encontrada',
          time: new Date(),
          user: 'Sistema'
        });
        await activeCard.save();

        await interaction.reply({ 
          content: '✅ Detectamos que seu cartão anterior estava com problemas e o finalizamos automaticamente. Você já pode criar um novo cartão usando `/ponto`.',
          ephemeral: true 
        });
        await excluirResposta(interaction);
        return;
      }

      await interaction.reply({ 
        content: '⚠️ Cartão de ponto não encontrado. Use `/ponto` para criar um novo cartão.', 
        ephemeral: true 
      });
      await excluirResposta(interaction);
      return;
    }
    
    const pointCard = pointCardInDB || pointCardFromMap;
    
    // Permitir que o suporte interaja com qualquer cartão
    const isSupport = interaction.user.id === SUPPORT_ID;
    
    if (!isSupport && interaction.user.id !== pointCard.userId) {
      await interaction.reply({ 
        content: `⚠️ Apenas o usuário que iniciou este cartão de ponto ou o suporte pode interagir com ele. Caso tenha algum erro no ponto procure o <@${SUPPORT_ID}>.`, 
        ephemeral: true 
      });
      await excluirResposta(interaction);
      return;
    }

    const now = new Date();

    if (pointCard.lastInteractionTime && (now - pointCard.lastInteractionTime < TEMPO_MINIMO_INTERACAO)) {
      await interaction.reply({ 
        content: `⚠️ Você só pode interagir com os botões a cada 10 segundos . Caso tenha algum erro no ponto procure o <@${SUPPORT_ID}>.`, 
        ephemeral: true 
      });
      await excluirResposta(interaction);
      return ;
    }

    pointCard.lastInteractionTime = now;
    await pointCard.save();

    let actionSuccess = false;
    
    if (pointCard.canceled) {
      await interaction.reply({ 
        content: `❌ Este cartão foi cancelado e não pode mais ser alterado.`, 
        ephemeral: true 
      });
      await excluirResposta(interaction);
      return false;
    }

    if (customId === 'pause') {
      actionSuccess = await handlePauseAction(interaction, pointCard);
    } else if (customId === 'resume') {
      actionSuccess = await handleResumeAction(interaction, pointCard);
    } else if (customId === 'finish') {
      actionSuccess = await handleFinishAction(interaction, pointCard, interaction.message.id);
    }

    if (!actionSuccess) return;

  } catch (error) {
    if (error.code === 10062) {
        console.warn('[handleButtonInteraction] Interação expirada ao tentar responder');
        return;
    }
    // Só loga stack trace se não for erro 10062
    console.error('❌ Erro ao processar interação de botão:', error);
    
    // Notificar o suporte/admin via DM
    try {
      const adminUser = await interaction.client.users.fetch(SUPPORT_ID);
      if (adminUser) {
        const erroEmbed = new EmbedBuilder()
          .setColor('#ff0000')
          .setTitle('❗ Erro crítico detectado no comando!')
          .addFields(
            { name: 'Comando', value: interaction.commandName || 'Desconhecido', inline: false }, // Usar o nome do comando da interação
            { name: 'Servidor', value: `${interaction.guild?.name} (${interaction.guildId})` || 'DM', inline: false }, // Usar nome e ID do servidor
            { name: 'Usuário', value: `${interaction.user.tag} (${interaction.user.id})`, inline: false }, // Usar tag e ID do usuário
            { name: 'Canal', value: interaction.channelId || 'Desconhecido', inline: false }, // Usar o ID do canal
            { name: 'Erro', value: `${error.message || error}`, inline: false } 
          )
          .setTimestamp()
          .setFooter({ 
              text: 'Sistema de Ponto • Notificação de Erro', 
              iconURL: interaction.client.user.displayAvatarURL() 
          });

        await adminUser.send({ embeds: [erroEmbed] });
      }
    } catch (notifyError) {
      console.error('Erro ao notificar admin:', notifyError);
    }
    
    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: 'Erro ao processar a interação. Por favor, tente novamente. O suporte foi notificado.',
          ephemeral: true
        });
        await excluirResposta(interaction);
      }
    } catch (replyError) {
      if (replyError.code === 10062) {
        console.warn('[handleButtonInteraction] Interação expirada ao tentar enviar mensagem de erro');
      } else {
        console.error('[handleButtonInteraction] Erro ao enviar mensagem de erro:', replyError);
      }
    }
  }
}

async function handlePauseAction(interaction, pointCard) {
  try {
    if (pointCard.canceled) {
      await interaction.reply({ 
        content: `❌ Este cartão foi cancelado e não pode mais ser alterado.`, 
        ephemeral: true 
      });
      await excluirResposta(interaction);
      return false;
    }

    if (pointCard.isPaused) {
      await interaction.reply({ 
        content: `⚠️ O cartão já está pausado. Caso tenha algum erro no comando, procure o suporte <@${SUPPORT_ID}>.`, 
        ephemeral: true 
      });
      await excluirResposta(interaction);
      return false;
    }

    // Verificar permissões do bot
    const channel = interaction.channel;
    if (!channel) {
      await interaction.reply({ 
        content: `⚠️ Canal não encontrado. Caso tenha algum erro no comando, procure o suporte <@${SUPPORT_ID}>.`, 
        ephemeral: true 
      });
      await excluirResposta(interaction);
      return false;
    }

    const botPermissions = channel.permissionsFor(interaction.client.user);
    if (!botPermissions.has(PermissionsBitField.Flags.ViewChannel) || 
        !botPermissions.has(PermissionsBitField.Flags.SendMessages) || 
        !botPermissions.has(PermissionsBitField.Flags.EmbedLinks)) {
      await interaction.reply({ 
        content: `⚠️ O bot não tem permissões suficientes neste canal. Caso tenha algum erro no comando, procure o suporte <@${SUPPORT_ID}>.`, 
        ephemeral: true 
      });
      await excluirResposta(interaction);
      return false;
    }

    await interaction.reply({ content: '⏸️ Pausando ponto...', ephemeral: true });

    const now = new Date();
    if (typeof pointCard.totalPausedTime !== 'number') {
      pointCard.totalPausedTime = 0;
    }
    pointCard.lastPauseStart = now;
    pointCard.isPaused = true;
    pointCard.history.push({ 
      action: 'Pausado', 
      time: now, 
      user: interaction.user.tag 
    });

    // Fechar o período atual ao pausar, SEMPRE no momento da pausa
    pointCard.workPeriods = pointCard.workPeriods || [];
    if (pointCard.workPeriods.length > 0) {
      const lastPeriod = pointCard.workPeriods[pointCard.workPeriods.length - 1];
      lastPeriod.end = now;
      lastPeriod.pauseIntervals = lastPeriod.pauseIntervals || [];
      // Adiciona início da pausa (end será preenchido ao voltar)
      lastPeriod.pauseIntervals.push({ start: now, end: null });
    }

    await pointCard.save();
    
    const embed = await generateEmbed(interaction.user, pointCard, null, interaction);
    const buttons = generateButtons(pointCard);
    
    await interaction.message.edit({ 
      embeds: [embed], 
      components: buttons ? [buttons] : [] 
    }).catch(() => null);
    
    await interaction.editReply({ content: '⏸️ Ponto pausado com sucesso!', ephemeral: true });
    await excluirResposta(interaction);
    return true;
  } catch (error) {
    try {
      await interaction.editReply({ 
        content: `⚠️ Erro ao pausar o ponto. Tente novamente mais tarde. Caso tenha algum erro no comando, procure o suporte <@${SUPPORT_ID}>.`, 
        ephemeral: true 
      });
      await excluirResposta(interaction);
    } catch (replyError) {
      // Ignorar erro de resposta
    }
    await excluirResposta(interaction);
    return false;
  }
}

async function handleResumeAction(interaction, pointCard) {
  if (!pointCard.isPaused) {
    await interaction.reply({ 
      content: `⚠️ O cartão não está pausado. Caso tenha algum erro no comando, procure o suporte <@${SUPPORT_ID}>.`, 
      ephemeral: true 
    });
    await excluirResposta(interaction);
    return false;
  }

  await interaction.reply({ content: '🔄 Retomando ponto...', ephemeral: true });

  const now = new Date();
  debugLog('[handleResumeAction] Iniciando retomada:', {
    cardId: pointCard._id,
    lastPauseStart: pointCard.lastPauseStart,
    currentWorkPeriods: pointCard.workPeriods
  });

  if (pointCard.lastPauseStart) {
    if (typeof pointCard.totalPausedTime !== 'number') {
      pointCard.totalPausedTime = 0;
    }
    pointCard.totalPausedTime += now - pointCard.lastPauseStart;
    debugLog('[handleResumeAction] Pausa encerrada:', {
      cardId: pointCard._id,
      lastPauseStart: pointCard.lastPauseStart,
      now,
      tempoPausa: now - pointCard.lastPauseStart,
      tempoPausaFormatado: formatTime(now - pointCard.lastPauseStart)
    });
  }
  pointCard.lastPauseStart = null;
  pointCard.isPaused = false;
  pointCard.history.push({ 
    action: 'Volta', 
    time: now, 
    user: interaction.user.tag 
  });

  // Fechar o período atual e criar um novo a partir da volta
  if (pointCard.workPeriods && pointCard.workPeriods.length > 0) {
    const lastPeriod = pointCard.workPeriods[pointCard.workPeriods.length - 1];
    
    // Se o último período não tiver end, significa que ele está aberto
    if (!lastPeriod.end) {
      // Fechar o período atual no momento da pausa
      lastPeriod.end = pointCard.lastPauseStart;
      
      // Adicionar a pausa ao período
      if (!lastPeriod.pauseIntervals) {
        lastPeriod.pauseIntervals = [];
      }
      lastPeriod.pauseIntervals.push({
        start: pointCard.lastPauseStart,
        end: now
      });

      debugLog('[handleResumeAction] Período anterior fechado e pausa adicionada:', {
        periodStart: lastPeriod.start,
        periodEnd: lastPeriod.end,
        pauseStart: pointCard.lastPauseStart,
        pauseEnd: now
      });

      // Criar novo período a partir da volta
      pointCard.workPeriods.push({
        start: now,
        end: null,
        pauseIntervals: []
      });

      debugLog('[handleResumeAction] Novo período criado:', {
        start: now,
        end: null
      });
    } else {
      // Se o período já estiver fechado, apenas criar um novo
      pointCard.workPeriods.push({
        start: now,
        end: null,
        pauseIntervals: []
      });

      debugLog('[handleResumeAction] Novo período criado (período anterior já fechado):', {
        start: now,
        end: null
      });
    }
  } else {
    // Se não houver períodos, criar o primeiro
    pointCard.workPeriods = [{
      start: now,
      end: null,
      pauseIntervals: []
    }];
    debugLog('[handleResumeAction] Primeiro período criado:', {
      start: now,
      end: null
    });
  }

  try {
    await pointCard.save();
    debugLog('[handleResumeAction] Cartão salvo com sucesso:', {
      cardId: pointCard._id,
      workPeriods: pointCard.workPeriods.map(p => ({
        start: p.start,
        end: p.end,
        duration: p.end ? formatTime(new Date(p.end) - new Date(p.start)) : 'em andamento',
        pauseIntervals: p.pauseIntervals
      }))
    });
    
    const embed = await generateEmbed(interaction.user, pointCard, null, interaction);
    const buttons = generateButtons(pointCard);
    
    await interaction.message.edit({ 
      embeds: [embed], 
      components: buttons ? [buttons] : [] 
    });
    
    await interaction.editReply({ content: '🔄 Ponto retomado com sucesso!', ephemeral: true });
    await excluirResposta(interaction);
    return true;
  } catch (error) {
    console.error('[handleResumeAction] Erro ao salvar o cartão:', error);
    try {
      await interaction.editReply({ 
        content: `⚠️ Erro ao retomar o ponto. Tente novamente mais tarde. Caso tenha algum erro no comando, procure o suporte <@${SUPPORT_ID}>.`, 
        ephemeral: true 
      });
      await excluirResposta(interaction);
    } catch (replyError) {
      console.error('[handleResumeAction] Erro ao responder à interação:', replyError);
    }
    await excluirResposta(interaction);
    return false;
  }
}

// Função para enviar a mensagem de parabéns
async function enviarMensagemParabens(client, user, pointCard) {
    try {
        // Buscar configuração do servidor
        const servidor = await Servidor.findOne({ guildId: pointCard.guildId });
        if (!servidor) {
            console.error('[ButtonHandler] Configuração do servidor não encontrada');
            return;
        }

        // Calcular o tempo formatado
        const tempoTotal = calcularTempoTotalPorWorkPeriods(pointCard.workPeriods);
        const tempoFormatado = formatTime(tempoTotal);
        
        // Calcular estatísticas
        const horasTrabalhadas = Math.floor(tempoTotal / 3600);
        const minutosTrabalhados = Math.floor((tempoTotal % 3600) / 60);
        const QUATRO_HORAS_MS = 4 * 60 * 60 * 1000; // 4 horas em milissegundos
        const produtividade = Math.min(100, Math.floor((tempoTotal / QUATRO_HORAS_MS) * 100));

        // Definir cor e título baseado no tempo
        const atingiuQuatroHoras = tempoTotal >= QUATRO_HORAS_MS;
        
        const cor = atingiuQuatroHoras ? '#00FF00' : '#FFD700';
        const titulo = atingiuQuatroHoras ? '🎉 Meta de Horas Atingida!' : '🎯 Registro de Ponto Concluído!';
        const descricao = atingiuQuatroHoras 
            ? 'Parabéns! Você atingiu a meta de horas de trabalho! Continue mantendo esse excelente desempenho! 🎉' 
            : 'Parabéns pela sua dedicação! Seu tempo foi registrado com sucesso.';
        
        const tempoRestante = Math.max(0, QUATRO_HORAS_MS - tempoTotal);
        const horasRestantes = Math.floor(tempoRestante / 3600000);
        const minutosRestantes = Math.floor((tempoRestante % 3600000) / 60000);
        
        const embed = new EmbedBuilder()
            .setColor(cor)
            .setTitle(titulo)
            .setDescription(descricao)
            .addFields(
                { name: '\u200B', value: '━━━━━━━━━━━━━━━━━━━━━━━', inline: false },
                { 
                    name: '📊 Resumo do Registro', 
                    value: (() => {
                        const mensagem = [
                            `• **Tempo Total:** \`${tempoFormatado}\``,
                            `• **Data:** <t:${Math.floor(pointCard.endTime.getTime()/1000)}:F>`,
                            `• **Status:** ✅ Registrado com sucesso`,
                            `• **Produtividade:** \`${produtividade}%\``
                        ].join('\n');
                        
                        if (mensagem.length > 1024) {
                            return mensagem.slice(0, 1021) + '...';
                        }
                        return mensagem;
                    })(),
                    inline: false
                },
                { name: '\u200B', value: '━━━━━━━━━━━━━━━━━━━━━━━', inline: false },
                { 
                    name: '💡 Dicas para Hoje', 
                    value: [
                        '• Mantenha o foco nas suas tarefas',
                        '• Faça pausas regulares',
                        '• Hidrate-se e alongue-se',
                        '• Organize suas prioridades'
                    ].join('\n'),
                    inline: true
                },
                { 
                    name: '📈 Seu Progresso', 
                    value: [
                        atingiuQuatroHoras 
                            ? '• 🎉 Parabéns! Você atingiu a meta de 4 horas!'
                            : `• Você está a ${horasRestantes}h${minutosRestantes > 0 ? ` ${minutosRestantes}min` : ''} de atingir a meta!`,
                        '• Cada minuto conta para seu crescimento',
                        '• Continue mantendo essa dedicação',
                        '• Sua produtividade está aumentando'
                    ].join('\n'),
                    inline: false
                },
                { name: '\u200B', value: '━━━━━━━━━━━━━━━━━━━━━━━', inline: false }
            )
            .setThumbnail('https://cdn.discordapp.com/emojis/1108775530113245275.webp?size=96&quality=lossless')
            .setImage(atingiuQuatroHoras 
                ? 'https://cdn.discordapp.com/attachments/1079378874501210152/1214390093056225320/success.png'
                : 'https://cdn.discordapp.com/attachments/1079378874501210152/1214390093056225320/progress.png'
            )
            .setFooter({ 
                text: 'Sistema de Ponto • Toca da Raposa', 
                iconURL: client.user.displayAvatarURL() 
            })
            .setTimestamp();

        // Adicionar botões
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setLabel('Ver Cartão de Ponto')
                    .setStyle(ButtonStyle.Link)
                    .setURL(`https://discord.com/channels/${pointCard.guildId}/${pointCard.channelId}/${pointCard.messageId}`)
                    .setEmoji('📋'),
                new ButtonBuilder()
                    .setLabel('Ver Planilha')
                    .setStyle(ButtonStyle.Link)
                    .setURL(`https://docs.google.com/spreadsheets/d/${servidor.spreadsheetId}`)
                    .setEmoji('📊')
            );

        await user.send({ 
            embeds: [embed],
            components: [row]
        }).catch((error) => {
            if (error.code === 50007) {
                // Usuário não permite DMs, apenas ignore ou logue
                console.warn('[ButtonHandler] Usuário não permite DMs:', user.id);
            } else {
                throw error;
            }
        });
        
        // Usar findOneAndUpdate ao invés de save
        await PointCard.findOneAndUpdate(
            { _id: pointCard._id },
            { $set: { fourHoursNotified: true } },
            { 
                new: true,
                runValidators: true
            }
        );

    } catch (err) {
        console.error('[ButtonHandler] Erro ao enviar mensagem de parabéns:', err);
        
        // Log adicional para debug
        console.error('[ButtonHandler] Detalhes do erro:', {
            pointCardId: pointCard._id,
            userId: user.id,
            guildId: pointCard.guildId,
            errorName: err.name,
            errorMessage: err.message,
            stack: err.stack
        });
    }
}

async function handleFinishAction(interaction, pointCard, messageId) {
  try {
    debugLog('[handleFinishAction] Iniciando finalização:', {
      cardId: pointCard._id,
      currentWorkPeriods: pointCard.workPeriods,
      history: pointCard.history,
      isPaused: pointCard.isPaused,
      lastPauseStart: pointCard.lastPauseStart
    });

    if (pointCard.finished) {
      try {
        await interaction.reply({ 
          content: `⚠️ O cartão já está finalizado. Caso tenha algum erro no comando, procure o suporte <@${SUPPORT_ID}>.`, 
          ephemeral: true 
        });
        await excluirResposta(interaction);
      } catch (error) {
        if (error.code === 10062) {
          console.warn('[handleFinishAction] Interação expirada ao tentar responder');
          return false;
        }
        throw error;
      }
      return false;
    }

    // Verificar permissões do bot
    const channel = interaction.channel;
    if (!channel) {
      try {
        await interaction.reply({ 
          content: `⚠️ Canal não encontrado. Caso tenha algum erro no comando, procure o suporte <@${SUPPORT_ID}>.`, 
          ephemeral: true 
        });
        await excluirResposta(interaction);
      } catch (error) {
        if (error.code === 10062) {
          console.warn('[handleFinishAction] Interação expirada ao tentar responder');
          return false;
        }
        throw error;
      }
      return false;
    }

    const botPermissions = channel.permissionsFor(interaction.client.user);
    if (!botPermissions.has(PermissionsBitField.Flags.ViewChannel) || 
        !botPermissions.has(PermissionsBitField.Flags.SendMessages) || 
        !botPermissions.has(PermissionsBitField.Flags.EmbedLinks)) {
      try {
        await interaction.reply({ 
          content: `⚠️ O bot não tem permissões suficientes neste canal. Caso tenha algum erro no comando, procure o suporte <@${SUPPORT_ID}>.`, 
          ephemeral: true 
        });
        await excluirResposta(interaction);
      } catch (error) {
        if (error.code === 10062) {
          console.warn('[handleFinishAction] Interação expirada ao tentar responder');
          return false;
        }
        throw error;
      }
      return false;
    }

    try {
      await interaction.reply({ content: '🔴 Finalizando ponto...', ephemeral: true });
    } catch (error) {
      if (error.code === 10062) {
        console.warn('[handleFinishAction] Interação expirada ao tentar responder');
        return false;
      }
      throw error;
    }

    const now = new Date();
    
    // Se estiver pausado, adicionar a pausa atual aos workPeriods antes de finalizar
    if (pointCard.isPaused && pointCard.lastPauseStart) {
      debugLog('[handleFinishAction] Cartão está pausado, adicionando pausa atual:', {
        lastPauseStart: pointCard.lastPauseStart,
        now
      });

      // Encontrar o período atual que está pausado
      const currentPeriod = pointCard.workPeriods.find(p => !p.end);
      if (currentPeriod) {
        if (!currentPeriod.pauseIntervals) {
          currentPeriod.pauseIntervals = [];
        }
        
        // Adicionar a pausa atual
        currentPeriod.pauseIntervals.push({
          start: pointCard.lastPauseStart,
          end: now
        });

        debugLog('[handleFinishAction] Pausa adicionada ao período:', {
          periodStart: currentPeriod.start,
          pauseStart: pointCard.lastPauseStart,
          pauseEnd: now,
          pauseDuration: now - pointCard.lastPauseStart
        });
      }

      // Atualizar o totalPausedTime
      if (typeof pointCard.totalPausedTime !== 'number') {
        pointCard.totalPausedTime = 0;
      }
      pointCard.totalPausedTime += now - pointCard.lastPauseStart;
      pointCard.lastPauseStart = null;
      pointCard.isPaused = false;
    }

    // Fechar o último período se ele estiver aberto
    const lastPeriod = pointCard.workPeriods[pointCard.workPeriods.length - 1];
    if (lastPeriod && !lastPeriod.end) {
      lastPeriod.end = now;
      debugLog('[handleFinishAction] Último período fechado:', {
        start: lastPeriod.start,
        end: lastPeriod.end,
        duration: formatTime(new Date(lastPeriod.end) - new Date(lastPeriod.start))
      });
    }

    // Garantir que todos os períodos estão fechados e válidos
    pointCard.workPeriods = pointCard.workPeriods.map(period => {
      // Verificar se é um período antigo (sem pauseIntervals)
      if (!period.pauseIntervals) {
        period.pauseIntervals = [];
      }
      
      // Garantir que o período tem end
      if (!period.end) {
        period.end = now;
      }
      
      return period;
    }).filter(p => p.start && p.end);

    debugLog('[handleFinishAction] Períodos após processamento:', {
      workPeriods: pointCard.workPeriods.map(p => ({
        start: p.start,
        end: p.end,
        duration: formatTime(new Date(p.end) - new Date(p.start)),
        pauseIntervals: p.pauseIntervals || []
      }))
    });

    pointCard.finished = true;
    pointCard.status = 'finished';
    pointCard.endTime = now;
    pointCard.history.push({ 
      action: 'Finalizado', 
      time: now, 
      user: interaction.user.tag 
    });

    const tempoTotal = calcularTempoTotalPorWorkPeriods(pointCard.workPeriods);
    debugLog('[handleFinishAction] Tempo total calculado:', {
      tempoTotal,
      tempoTotalFormatted: formatTime(tempoTotal),
      workPeriods: pointCard.workPeriods.map(p => ({
        start: p.start,
        end: p.end,
        duration: formatTime(new Date(p.end) - new Date(p.start)),
        pauseIntervals: p.pauseIntervals
      }))
    });

    if (isNaN(tempoTotal)) {
      pointCard.status = 'error';
      pointCard.totalTime = 0;
      throw new Error('Erro no cálculo do tempo total');
    } else {
      pointCard.totalTime = tempoTotal;
      pointCard.accumulatedTime = tempoTotal;
    }

    await pointCard.save();

    await User.findOneAndUpdate(
      { userId: pointCard.userId },
      { $inc: { totalTime: tempoTotal } },
      { upsert: true }
    ).catch((error) => {
      console.error('[ButtonHandler] Erro ao atualizar tempo do usuário:', error);
    });

    const formattedTime = formatTime(pointCard.totalTime);
    const startDay = getBrasiliaDay(new Date(pointCard.startTime));
    const columnLetter = getColumnLetter(startDay);
    await sendToGoogleSheets(interaction.client, pointCard.userId, formattedTime, messageId, pointCard.guildId, columnLetter, pointCard.channelId).catch((error) => {
      console.error('[ButtonHandler] Erro ao enviar para Google Sheets:', error);
    });
    
    const originalUser = await interaction.client.users.fetch(pointCard.userId).catch((error) => {
      console.error('[ButtonHandler] Erro ao buscar usuário:', error);
      return null;
    });
    const embed = await generateEmbed(originalUser || interaction.user, pointCard, messageId, interaction);
    await interaction.message.edit({ 
      embeds: [embed], 
      components: [] 
    }).catch((error) => {
      console.error('[ButtonHandler] Erro ao editar mensagem:', error);
    });

    await interaction.editReply({ content: '🔴 Ponto finalizado com sucesso!', ephemeral: true });
    await excluirResposta(interaction);

    const user = await interaction.client.users.fetch(pointCard.userId).catch((error) => {
      console.error('[ButtonHandler] Erro ao buscar usuário para mensagem de parabéns:', error);
      return null;
    });
    if (user) {
        await enviarMensagemParabens(interaction.client, user, pointCard).catch((error) => {
          console.error('[ButtonHandler] Erro ao enviar mensagem de parabéns:', error);
        });
    }

    return true;

  } catch (error) {
    console.error('[handleFinishAction] Erro ao finalizar ponto:', error);
    try {
      if (!interaction.replied) {
        await interaction.reply({ 
          content: `⚠️ Erro ao finalizar o ponto. Tente novamente mais tarde. Caso tenha algum erro no comando, procure o suporte <@${SUPPORT_ID}>.`, 
          ephemeral: true 
        });
      } else {
        await interaction.editReply({ 
          content: `⚠️ Erro ao finalizar o ponto. Tente novamente mais tarde. Caso tenha algum erro no comando, procure o suporte <@${SUPPORT_ID}>.`, 
          ephemeral: true 
        });
      }
      await excluirResposta(interaction);
    } catch (replyError) {
      if (replyError.code === 10062) {
        console.warn('[handleFinishAction] Interação expirada ao tentar enviar mensagem de erro');
      } else {
        console.error('[handleFinishAction] Erro ao enviar mensagem de erro:', replyError);
      }
    }
    return false;
  }
}

function calcularTempoTotalPorWorkPeriods(workPeriods) {
  debugLog('[calcularTempoTotalPorWorkPeriods] Iniciando cálculo:', {
    workPeriods: workPeriods.map(p => ({
      start: p.start,
      end: p.end,
      pauseIntervals: p.pauseIntervals
    }))
  });

  let total = 0;
  for (const period of workPeriods) {
    if (period.start && period.end) {
      let periodTime = new Date(period.end) - new Date(period.start);
      debugLog('[calcularTempoTotalPorWorkPeriods] Período calculado (antes das pausas):', {
        start: period.start,
        end: period.end,
        periodTime,
        periodTimeFormatted: formatTime(periodTime)
      });

      // Descontar pausas, se houver
      if (period.pauseIntervals && period.pauseIntervals.length) {
        for (const pause of period.pauseIntervals) {
          if (pause.start && pause.end) {
            // Garantir que a pausa está dentro do período
            const pauseStart = Math.max(new Date(pause.start).getTime(), new Date(period.start).getTime());
            const pauseEnd = Math.min(new Date(pause.end).getTime(), new Date(period.end).getTime());
            
            if (pauseEnd > pauseStart) {
              const pauseTime = pauseEnd - pauseStart;
              periodTime -= pauseTime;
              debugLog('[calcularTempoTotalPorWorkPeriods] Pausa descontada:', {
                pauseStart: new Date(pauseStart),
                pauseEnd: new Date(pauseEnd),
                pauseTime,
                pauseTimeFormatted: formatTime(pauseTime),
                remainingPeriodTime: periodTime,
                remainingPeriodTimeFormatted: formatTime(periodTime)
              });
            } else {
              debugLog('[calcularTempoTotalPorWorkPeriods] Pausa ignorada (fora do período):', {
                pauseStart: new Date(pauseStart),
                pauseEnd: new Date(pauseEnd),
                periodStart: period.start,
                periodEnd: period.end
              });
            }
          } else {
            debugLog('[calcularTempoTotalPorWorkPeriods] Pausa ignorada (sem start ou end):', pause);
          }
        }
      }

      // Verificar se o período tem tempo válido após descontar pausas
      if (periodTime > 0) {
        total += periodTime;
        debugLog('[calcularTempoTotalPorWorkPeriods] Período adicionado ao total:', {
          periodTime,
          periodTimeFormatted: formatTime(periodTime),
          total,
          totalFormatted: formatTime(total)
        });
      } else {
        debugLog('[calcularTempoTotalPorWorkPeriods] Período ignorado (tempo zero ou negativo após pausas):', {
          periodTime,
          periodTimeFormatted: formatTime(periodTime)
        });
      }
    } else {
      debugLog('[calcularTempoTotalPorWorkPeriods] Período ignorado (sem start ou end):', period);
    }
  }

  debugLog('[calcularTempoTotalPorWorkPeriods] Total final:', {
    total,
    totalFormatted: formatTime(total)
  });

  return total;
}

module.exports = { 
    handleButtonInteraction, 
    handleFinishAction,
    enviarMensagemParabens,
    calcularTempoTotalPorWorkPeriods
}; 