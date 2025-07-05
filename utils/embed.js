const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js'); 
const { formatTime } = require('./time');
const { Servidor } = require('../models/Servidor');

const SUPPORT_ID = '657014871228940336'; // ID do suporte fixo

async function generateEmbed(user, data, messageID, interaction = null) {
  if (!user || !data) {
    throw new Error('Parâmetros obrigatórios não fornecidos');
  }

  const { 
    startTime, 
    isPaused, 
    finished, 
    status,
    history, 
    accumulatedTime, 
    totalTime,
    messageId: dataMessageId,
    guildId
  } = data;

  // Buscar configuração do servidor
  let serverConfig = null;
  try {
    serverConfig = await Servidor.findOne({ guildId: guildId });
  } catch (error) {
    console.error('Erro ao buscar configuração do servidor:', error);
  }

  // Garantir que sempre tenha uma descrição
  const description = serverConfig?.nome || '📍 Sistema de bate ponto';

  const formatDate = date => {
    return date ? `🗓️ **${new Date(date).toLocaleString('pt-BR', {
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric', 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit'
    })}**` : '---';
  };

  const fields = [{ name: '👑 Admin', value: `<@${data.userId}>`, inline: false }];

  // Adiciona o status atual do cartão de ponto
  // Verifica tanto finished quanto status para determinar o estado real
  const isReallyFinished = finished === true && status === 'finished';
  
  if (isPaused) {
    fields.push({ name: '⏸️ Status', value: '**PAUSADO**', inline: false });
  } else if (!isReallyFinished) {
    fields.push({ name: '▶️ Status', value: '**EM ANDAMENTO**', inline: false });
  } else {
    fields.push({ name: '🔴 Status', value: '**FINALIZADO**', inline: false });
  }

  if (history.length > 0) {
    const historyList = history
      .map(entry => {
        let emoji = '🟧'; 
        if (entry.action.includes('Finalizado')) emoji = '🔴';
        if (entry.action.includes('Pausado')) emoji = '⏸️';
        if (entry.action.includes('Volta')) emoji = '🔄';
        if (entry.action.includes('Início')) emoji = '🟢';
        if (entry.action.includes('Reabertura')) emoji = '🔄';

        const timestamp = getBrasiliaTimestamp(entry.time);

        return `${emoji} ${entry.action}\n> 🗓️ <t:${timestamp}:F> `;
      })
      .join('\n\n');
      
    fields.push({ name: '\u200B', value: historyList, inline: false });
  }

  // Função para determinar o turno baseado na hora
  function getTurno(date) {
    const hora = date.getHours();
    if (hora >= 5 && hora < 12) return '🌅 Manhã';
    if (hora >= 12 && hora < 18) return '☀️ Tarde';
    if (hora >= 18 && hora < 22) return '🌙 Noite';
    return '🌑 Madrugada';
  }

  // Obter a data e hora atual para o rodapé
  const dataAtual = new Date();
  const turno = getTurno(new Date(startTime));
  const dataHoraAtual = new Date().toLocaleString('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  // Adicionar o rodapé com ícone, data/hora e turno
  const footerText = `${serverConfig?.nome || 'Sistema de bate ponto'} • ${dataHoraAtual} • ${turno}`;
  
  if (isReallyFinished) {
    // Formata o tempo total (que está em MS) antes de exibir
    let displayTime = '--:--:--'; // Valor padrão em caso de erro
    if (typeof totalTime === 'number' && !isNaN(totalTime)) {
      displayTime = formatTime(totalTime); 
    } else if (typeof accumulatedTime === 'number' && !isNaN(accumulatedTime)) {
      // Fallback para accumulatedTime se totalTime for inválido
      displayTime = formatTime(accumulatedTime);
      console.warn(`[generateEmbed] Usando accumulatedTime formatado como fallback para ${dataMessageId || messageID}`);
    } else if (typeof data.previousAccumulatedTime === 'number' && !isNaN(data.previousAccumulatedTime)) {
      // Segundo fallback para previousAccumulatedTime
      displayTime = formatTime(data.previousAccumulatedTime);
    } else {
       console.error(`[generateEmbed] Não foi possível formatar o tempo para ${dataMessageId || messageID}. totalTime: ${totalTime}, accumulatedTime: ${accumulatedTime}`);
    }

    fields.push({ name: '⏳ **Tempo Total**', value: `\`${displayTime}\``, inline: false });  
    fields.push({ name: '\u200B', value: 'Caso queira reabrir seu cartão, use o comando /reabrir com o ID da mensagem que esta logo abaixo.',  inline: false});

    const finalMessageId = messageID || dataMessageId;

    if (finalMessageId && finalMessageId.toString().length > 0) {
      fields.push({ name: '⚠️ Mensagem ID', value: `\`\`\`diff\n ${finalMessageId} \n\`\`\``, inline: false });
    } else {
      fields.push({ name: '⚠️ Erro', value: `ID da mensagem não disponível. Por favor, contate o suporte <@${SUPPORT_ID}>.`, inline: false});
    }
  }

  // Obter a URL do ícone do servidor
  let iconURL = null;
  try {
    // Tentar obter o ícone do servidor de várias maneiras possíveis
    if (interaction?.guild?.iconURL) {
      iconURL = interaction.guild.iconURL({ dynamic: true });
    } else if (serverConfig?.guildId) {
      // Se tivermos o client disponível, podemos tentar buscar o servidor
      const client = interaction?.client;
      if (client?.guilds?.cache) {
        const guild = client.guilds.cache.get(serverConfig.guildId);
        if (guild?.iconURL) {
          iconURL = guild.iconURL({ dynamic: true });
        }
      }
    }
  } catch (error) {
    console.error('Erro ao obter ícone do servidor:', error);
  }

  // Ajusta a cor da embed baseado no estado
  const embedColor = isPaused ? '#FFA500' : (isReallyFinished ? '#FF0000' : '#5865F2');

  // Constrói a embed com os campos
  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setTitle('📂 Bate-Ponto')
    .setDescription(description)
    .addFields(fields)
    .setTimestamp();

  // Adicionar o rodapé com ícone, data/hora e turno
  if (iconURL) {
    embed.setFooter({ 
      text: footerText,
      iconURL: iconURL
    });
  } else {
    embed.setFooter({ 
      text: footerText
    });
  }

  return embed;
}

function generateButtons(cardData) {
  if (!cardData) {
    console.error("Dados do cartão não fornecidos");
    return null;
  }

  if (cardData.canceled) return null;

  const { isPaused, finished, status, history } = cardData;
  
  // Usar a mesma lógica de isReallyFinished do generateEmbed
  const isReallyFinished = finished === true && status === 'finished';

  if (isReallyFinished) return null;

  const row = new ActionRowBuilder();

  // Limitar o número de interações a 13
  if (history.length >= 13) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId('finish')
        .setLabel('Finalizar 🔴')
        .setStyle(ButtonStyle.Danger)
    );
  } else {
    if (isPaused) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId('resume')
          .setLabel('Volta 🔄')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('finish')
          .setLabel('Finalizar 🔴')
          .setStyle(ButtonStyle.Danger)
      );
    } else {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId('pause')
          .setLabel('Pausar ⏸️')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('finish')
          .setLabel('Finalizar 🔴')
          .setStyle(ButtonStyle.Danger)
      );
    }
  }
  return row;
}

// Função utilitária para garantir timestamp no horário de Brasília
function getBrasiliaTimestamp(date) {
  const d = date instanceof Date ? date : new Date(date);
  const brasiliaDate = new Date(d.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  return Math.floor(brasiliaDate.getTime() / 1000);
}

function formatDateBrasilia(date) {
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

module.exports = { generateEmbed, generateButtons };