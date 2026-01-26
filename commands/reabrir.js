const { PointCard } = require('../models/pointCard');
const { PermissionsBitField, EmbedBuilder } = require('discord.js');
const { generateEmbed, generateButtons } = require('../utils/embed');
const { ADMIN_ID } = process.env;
const SUPPORT_ID = '657014871228940336';
const { calcularTempoTotalPorWorkPeriods } = require('../handlers/buttonHandler');

const DEBUG_REABRIR = false; // Coloque false para desativar os logs

function debugLog(...args) {
  if (DEBUG_REABRIR) {
    console.log('[Reabrir]', ...args);
  }
}

async function handleReabrirCommand(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const messageId = interaction.options.getString('id');
  let pointCard;
  let message = null;

  try {
    pointCard = await PointCard.findOne({ messageId });
    
    if (!pointCard) {
      await interaction.editReply({ 
        embeds: [new EmbedBuilder()
          .setTitle('❌ Cartão não encontrado')
          .setDescription('Nenhum cartão encontrado com esse ID.')
          .setColor(0xFF0000)]
      });
      return;
    }

    if (DEBUG_REABRIR) console.log('[Reabrir] Cartão encontrado:', pointCard);

    if (
      interaction.user.id !== pointCard.userId &&
      !interaction.member.permissions.has(PermissionsBitField.Flags.Administrator) &&
      !interaction.member.roles.cache.has(ADMIN_ID) &&
      interaction.user.id !== SUPPORT_ID
    ) {
      await interaction.editReply({ 
        embeds: [new EmbedBuilder()
          .setTitle('⚠️ Permissão negada')
          .setDescription('Você não tem permissão para reabrir este cartão.\nCaso seja um erro de comando, contate o suporte: <@657014871228940336>')
          .setColor(0xFFA500)]
      });
      return;
    }

    if (pointCard.canceled) {
      await interaction.editReply({ 
        embeds: [new EmbedBuilder()
          .setTitle('⚠️ Cartão cancelado')
          .setDescription('O cartão está cancelado e não pode ser reaberto.\nCaso seja um erro de comando, contate o suporte: <@657014871228940336>')
          .setColor(0xFFA500)]
      });
      return;
    }

    const isCardFinished = pointCard.finished === true && pointCard.status === 'finished';
    
    if (!isCardFinished) {
      if (pointCard.finished !== (pointCard.status === 'finished')) {
        const oldStatus = pointCard.status;
        pointCard.status = pointCard.finished ? 'finished' : 'active';
        
        try {
          await pointCard.save();
          
          const savedCard = await PointCard.findOne({ messageId: pointCard.messageId });
          
          if (savedCard.status !== pointCard.status) {
            console.error('⚠️ Cartão não foi salvo corretamente. Tentando novamente...');
            await new Promise(resolve => setTimeout(resolve, 1000));
            savedCard.status = pointCard.status;
            await savedCard.save();
          }
        } catch (error) {
          console.error('Erro ao salvar correção de status:', error);
          try {
            await new Promise(resolve => setTimeout(resolve, 1000));
            await pointCard.save();
          } catch (retryError) {
            console.error('Erro ao salvar correção de status na segunda tentativa:', retryError);
          }
        }
      }
      
      await interaction.editReply({ 
        embeds: [new EmbedBuilder()
          .setTitle('⚠️ Cartão não finalizado')
          .setDescription('O cartão não está finalizado.\nCaso seja um erro de comando, contate o suporte: <@657014871228940336>')
          .setColor(0xFFA500)]
      });
      return;
    }

    const lastFinalization = pointCard.history
      .filter(entry => entry && entry.action && entry.action.includes('Finalizado'))
      .sort((a, b) => b.time - a.time)[0];

    if (lastFinalization) {
      const timeSinceFinalization = (new Date() - new Date(lastFinalization.time)) / 1000;
      if (timeSinceFinalization < 10) {
        await interaction.editReply({ 
          embeds: [new EmbedBuilder()
            .setTitle('⚠️ Aguarde um momento')
            .setDescription('Este cartão foi finalizado há menos de 1 minuto. Aguarde um pouco antes de reabri-lo.\nCaso seja um erro de comando, contate o suporte: <@657014871228940336>')
            .setColor(0xFFA500)]
        });
        return;
      }
    }

    if (pointCard.history.length >= 13) {
      await interaction.editReply({ 
        embeds: [new EmbedBuilder()
          .setTitle('⚠️ Limite de interações atingido')
          .setDescription('Este cartão já atingiu o limite de 13 interações e não pode ser reaberto.\nCaso seja um erro de comando, contate o suporte: <@657014871228940336>')
          .setColor(0xFFA500)]
      });
      return;
    }

    const currentTime = new Date();
    const timeDifference = (currentTime - pointCard.startTime) / (1000 * 60 * 60);

    if (timeDifference > 24) {
      await interaction.editReply({ 
        embeds: [new EmbedBuilder()
          .setTitle('⚠️ Cartão expirado')
          .setDescription('Este cartão tem mais de 24 horas e não pode ser reaberto.\nCaso seja um erro de comando, contate o suporte: <@657014871228940336>')
          .setColor(0xFFA500)]
      });
      return;
    }

    const cartaoAtivo = await PointCard.findOne({ 
      userId: pointCard.userId, 
      finished: false,
      status: 'active',
      messageId: { $ne: messageId }
    });

    if (cartaoAtivo) {
      // Tentar buscar a mensagem do cartão ativo
      try {
        message = await interaction.channel.messages.fetch(cartaoAtivo.messageId);
      } catch (e) {
        // Se não encontrar a mensagem, marcar o cartão como erro e permitir reabertura
        cartaoAtivo.finished = true;
        cartaoAtivo.status = 'error';
        cartaoAtivo.history.push({ 
          action: 'Finalizado automaticamente - Mensagem não encontrada (reabrir)', 
          time: new Date(), 
          user: 'Sistema' 
        });
        await cartaoAtivo.save();
        // Prosseguir normalmente para reabrir o cartão solicitado
      }
      if (message) {
        // Se encontrou a mensagem, envie resposta efêmera com botão/link e informações do cartão
        const startedAt = cartaoAtivo.startTime ? `<t:${Math.floor(new Date(cartaoAtivo.startTime).getTime()/1000)}:F>` : 'Desconhecido';
        const status = cartaoAtivo.isPaused ? '⏸️ Pausado' : '▶️ Em andamento';
        const embedInfo = new EmbedBuilder()
          .setTitle('⚠️ Cartão ativo existente')
          .setDescription('Você já possui um cartão de ponto ativo. Para evitar duplicidade, finalize o cartão atual antes de reabrir outro.')
          .addFields(
            { name: '🆔 ID do Cartão', value: `${cartaoAtivo.messageId}`, inline: false },
            { name: '⏰ Iniciado em', value: startedAt, inline: true },
            { name: '📍 Status', value: status, inline: true },
            { name: '🔗 Link', value: `[Clique aqui para ver o cartão](${`https://discord.com/channels/${interaction.guildId}/${cartaoAtivo.channelId}/${cartaoAtivo.messageId}`})`, inline: false }
          )
          .setColor(0xFFA500)
          .setFooter({ text: 'Apenas você pode ver esta mensagem.' });
        const row = {
          type: 1,
          components: [
            {
              type: 2,
              style: 5, // Link
              label: 'Ver Cartão Ativo',
              url: `https://discord.com/channels/${interaction.guildId}/${cartaoAtivo.channelId}/${cartaoAtivo.messageId}`,
              emoji: { name: '🔍' }
            }
          ]
        };
        await interaction.editReply({
          embeds: [embedInfo],
          components: [row],
          ephemeral: true
        });
        return;
      }
    }

    const previousTime = pointCard.totalTime || pointCard.accumulatedTime || 0;

    pointCard.previousAccumulatedTime = previousTime;
    pointCard.accumulatedTime = previousTime;
    pointCard.finished = false;
    pointCard.status = 'active';
    pointCard.endTime = null;
    pointCard.totalPausedTime = 0;
    pointCard.lastPauseStart = null;
    pointCard.isPaused = false;
    pointCard.history.push({ 
      action: 'Reabertura', 
      time: new Date(), 
      user: interaction.user.tag,
      previousTime: previousTime
    });

    // Fechar qualquer período aberto antes de criar um novo
    if (!pointCard.workPeriods) pointCard.workPeriods = [];
    for (const period of pointCard.workPeriods) {
      if (!period.end) {
        period.end = pointCard.history[pointCard.history.length - 2].time; // fecha no último finalizado
      }
    }

    // Criar novo período de trabalho a partir da reabertura, se não houver nenhum aberto
    const existeAberto = pointCard.workPeriods.some(p => !p.end);
    if (!existeAberto) {
      pointCard.workPeriods.push({
        start: pointCard.history[pointCard.history.length - 1].time, // horário da reabertura
        end: null,
        pauseIntervals: []
      });
    }

    const tempoTotal = calcularTempoTotalPorWorkPeriods(pointCard.workPeriods);
    pointCard.totalTime = tempoTotal;
    pointCard.accumulatedTime = tempoTotal;

    await pointCard.save();

    const embed = await generateEmbed(interaction.user, pointCard, null, interaction);
    const buttons = generateButtons(pointCard);

    // Buscar a mensagem do cartão reaberto
    try {
      debugLog('Tentando atualizar mensagem:', {
        messageId: pointCard.messageId,
        channelId: pointCard.channelId
      });

      // Primeiro tenta buscar no canal atual
      let reabrirMessage = null;
      try {
        reabrirMessage = await interaction.channel.messages.fetch(pointCard.messageId);
      } catch (e) {
        debugLog('Mensagem não encontrada no canal atual, tentando buscar no canal original');
        // Se não encontrar no canal atual, tenta buscar no canal original
        const originalChannel = await interaction.client.channels.fetch(pointCard.channelId);
        if (originalChannel) {
          reabrirMessage = await originalChannel.messages.fetch(pointCard.messageId);
        }
      }

      if (reabrirMessage) {
        debugLog('Mensagem encontrada, atualizando embed');
        await reabrirMessage.edit({
          embeds: [embed],
          components: buttons ? [buttons] : []
        });
        debugLog('Embed atualizada com sucesso');
      } else {
        console.warn('[Reabrir] Mensagem não encontrada em nenhum canal');
        // Se não encontrar a mensagem, marca o cartão como erro
        pointCard.status = 'error';
        pointCard.history.push({ 
          action: 'Erro ao atualizar embed (mensagem não encontrada)', 
          time: new Date(), 
          user: 'Sistema' 
        });
        await pointCard.save();
      }
    } catch (e) {
      console.error('[Reabrir] Erro ao atualizar mensagem:', e);
      // Se der erro ao atualizar, marca o cartão como erro
      pointCard.status = 'error';
      pointCard.history.push({ 
        action: 'Erro ao atualizar embed', 
        time: new Date(), 
        user: 'Sistema' 
      });
      await pointCard.save();
    }

    await interaction.editReply({ content: 'Cartão reaberto com sucesso!' });

  } catch (error) {
    console.error('[Reabrir] Erro ao reabrir cartão:', error);
    await interaction.editReply({ 
      embeds: [new EmbedBuilder()
        .setTitle('❌ Erro ao reabrir cartão')
        .setDescription('Erro ao reabrir o cartão. Tente novamente mais tarde.\nCaso seja um erro de comando, contate o suporte: <@657014871228940336>')
        .setColor(0xFF0000)]
    });
  }
}

module.exports = { handleReabrirCommand }; 