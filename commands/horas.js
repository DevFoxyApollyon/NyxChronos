const { google } = require('googleapis');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const sheets = google.sheets('v4');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Importar o modelo Servidor
const { Servidor } = require('../models/Servidor');

// ID do suporte técnico
const SUPPORT_ID = '657014871228940336';

// Sistema de Cache Melhorado
const cache = {
  sheets: new Map(), // Cache por planilha
  users: new Map(),  // Cache por usuário
  cooldowns: new Map(), // Cooldown por usuário
  lastCleanup: Date.now()
};

// Configurações
const CONFIG = {
  CACHE_DURATION: 5 * 60 * 1000, // 5 minutos
  COOLDOWN_DURATION: 30 * 1000,  // 30 segundos
  CLEANUP_INTERVAL: 10 * 60 * 1000, // 10 minutos
  MAX_CONCURRENT_REQUESTS: 50
};

// Contador de requisições concorrentes
let concurrentRequests = 0;

/**
 * Gerencia o cooldown dos usuários
 * @param {string} userId - ID do usuário
 * @returns {boolean} - true se o usuário pode usar o comando
 */
function handleCooldown(userId) {
  const now = Date.now();
  const lastUse = cache.cooldowns.get(userId) || 0;
  
  if (now - lastUse < CONFIG.COOLDOWN_DURATION) {
    return false;
  }
  
  cache.cooldowns.set(userId, now);
  return true;
}

/**
 * Limpa caches antigos periodicamente
 */
function cleanupCache() {
  const now = Date.now();
  
  // Limpa apenas a cada CLEANUP_INTERVAL
  if (now - cache.lastCleanup < CONFIG.CLEANUP_INTERVAL) {
    return;
  }
  
  // Limpa cache de planilhas
  for (const [key, value] of cache.sheets.entries()) {
    if (now - value.timestamp > CONFIG.CACHE_DURATION) {
      cache.sheets.delete(key);
    }
  }
  
  // Limpa cache de usuários
  for (const [key, value] of cache.users.entries()) {
    if (now - value.timestamp > CONFIG.CACHE_DURATION) {
      cache.users.delete(key);
    }
  }
  
  // Limpa cooldowns antigos
  for (const [key, value] of cache.cooldowns.entries()) {
    if (now - value > CONFIG.COOLDOWN_DURATION) {
      cache.cooldowns.delete(key);
    }
  }
  
  cache.lastCleanup = now;
}

/**
 * Busca dados da planilha do Google, usando cache quando possível
 * @param {Object} auth - Cliente autenticado do Google
 * @param {string} spreadsheetId - ID da planilha
 * @param {string} range - Intervalo de dados para buscar
 * @param {boolean} forceRefresh - Se true, ignora o cache e busca novos dados
 * @returns {Array} - Linhas de dados da planilha
 */
async function fetchSheetData(auth, spreadsheetId, range, forceRefresh = false) {
  const cacheKey = `${spreadsheetId}-${range}`;
  const now = Date.now();
  
  // Verifica cache
  const cachedData = cache.sheets.get(cacheKey);
  if (!forceRefresh && cachedData && (now - cachedData.timestamp < CONFIG.CACHE_DURATION)) {
    return cachedData.data;
  }
  
  // Verifica limite de requisições concorrentes
  if (concurrentRequests >= CONFIG.MAX_CONCURRENT_REQUESTS) {
    throw new Error('Muitas requisições simultâneas. Tente novamente em alguns segundos.');
  }
  
  try {
    concurrentRequests++;
    
    const response = await sheets.spreadsheets.values.get({
      auth,
      spreadsheetId,
      range,
    });
    
    // Atualiza o cache
    cache.sheets.set(cacheKey, {
      data: response.data.values,
      timestamp: now
    });
    
    return response.data.values;
  } finally {
    concurrentRequests--;
  }
}

/**
 * Manipula o comando de horas do Discord
 * @param {Object} interaction - Interação do Discord 
 * @param {boolean} forceRefresh - Se verdadeiro, força a atualização dos dados
 */
async function handleHourCommand(interaction, forceRefresh = false) {
  try {
    // Verifica cooldown
    if (!handleCooldown(interaction.user.id)) {
      const remainingTime = Math.ceil((CONFIG.COOLDOWN_DURATION - (Date.now() - (cache.cooldowns.get(interaction.user.id) || 0))) / 1000);
      return interaction.reply({ 
        content: `⏳ Aguarde ${remainingTime} segundos antes de usar o comando novamente.`,
        ephemeral: true 
      });
    }

    cleanupCache();

    const servidor = await Servidor.findOne({ guildId: interaction.guild.id });
    if (!servidor) {
      return interaction.reply({ 
        content: '⚠️ Configuração do servidor não encontrada. Use o comando /painel para configurar.', 
        ephemeral: true 
      });
    }

    if (!interaction.member.roles.cache.has(servidor.cargoPermitido)) {
      await interaction.reply({ content: '⚠️ Você não tem permissão para usar este comando.', ephemeral: true });
      return;
    }

    const userId = interaction.user.id;

    try {
      await interaction.deferReply();

      if (!servidor.spreadsheetId || !servidor.sheetName) {
        throw new Error("Configurações SPREADSHEET_ID ou SHEET_NAME não estão definidas.");
      }

      const credentialsPath = path.join(__dirname, '..', 'credentials.json');

      if (!fs.existsSync(credentialsPath)) {
        console.error(`Arquivo de credenciais não encontrado em: ${credentialsPath}`);
        throw new Error(`Arquivo de credenciais não encontrado em: ${credentialsPath}`);
      }

      const auth = new google.auth.GoogleAuth({
        keyFile: credentialsPath,
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
      });

      const authClient = await auth.getClient();
      const range = `${servidor.sheetName}!A:AJ`;

      // Busca dados da planilha
      const rows = await fetchSheetData(authClient, servidor.spreadsheetId, range, forceRefresh);
      
      // Melhorar a busca do usuário
      let userRow = null;
      let userRowIndex = -1;

      if (rows && rows.length > 0) {
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          if (row && row[0] && row[0].toString().trim() === userId.toString().trim()) {
            userRow = row;
            userRowIndex = i;
            break;
          }
        }
      }

      if (!userRow) {
        await interaction.editReply({ 
          content: '🔍 Seu ID não foi encontrado na planilha. Se você acredita que isso é um erro, tente usar o comando /ponto primeiro para registrar seus dados.',
          ephemeral: true 
        });
        return;
      }

      // Busca linha de comentários
      const commentRow = userRowIndex >= 0 && userRowIndex + 1 < rows.length ? rows[userRowIndex + 1] : null;

      // Extrai os dados do usuário com validação
      const [id = '', name = 'N/A', totalHours = '', advs = '', justifications = '', ...dayColumns] = userRow.map(cell => cell?.toString().trim() || '');

      // Usa a data atual real
      const today = new Date();
      const currentDay = today.getDate();
      
      // Extrai dados dos últimos dias (até 5 dias)
      const dayData = [];
      const maxDaysToConsider = Math.min(5, currentDay);
      
      for (let i = 0; i < maxDaysToConsider; i++) {
        const date = new Date(today);
        date.setDate(currentDay - i);
        
        const dayOfMonth = date.getDate();
        const dayIndex = dayOfMonth - 1;
        
        if (dayIndex >= 0 && dayIndex < dayColumns.length) {
          const hours = dayColumns[dayIndex]?.toString().trim() || '';
          
          if (hours !== '') {
            let comment = '';
            if (commentRow && commentRow.length > 5 + dayIndex) {
              comment = commentRow[5 + dayIndex]?.toString().trim() || '';
            }
            
            dayData.push({ date, hours, comment });
          }
        }
      }

      // Verificação melhorada quando não há dados
      if (dayData.length === 0) {
        // Envia apenas as informações disponíveis
        const embed = buildInfoEmbed(name, totalHours, advs, justifications, interaction.user.displayAvatarURL(), interaction.user.id, interaction.guild.iconURL());
        
        // Criar botão para acessar a planilha
        const row = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setLabel('Acessar Planilha')
              .setStyle(ButtonStyle.Link)
              .setURL(`https://docs.google.com/spreadsheets/d/${servidor.spreadsheetId}`)
              .setEmoji('📊')
          );
        
        await interaction.editReply({ 
          content: '📭 Não há registros de horas para este usuário nos últimos dias. Esta mensagem será removida em 5 minutos para evitar flood.', 
          embeds: [embed], 
          components: [row],
          ephemeral: true 
        });

        // Remove a mensagem após 5 minutos
        setTimeout(async () => {
          await interaction.deleteReply();
        }, 5 * 60 * 1000);
      } else {
        // Ordena os dias cronologicamente - do mais recente para o mais antigo
        dayData.sort((a, b) => b.date - a.date);

        const embed = buildFullInfoEmbed(dayData, name, totalHours, advs, justifications, interaction.user.displayAvatarURL(), interaction.user.id, maxDaysToConsider, interaction.guild.iconURL());
        
        // Criar botão para acessar a planilha
        const row = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setLabel('Acessar Planilha')
              .setStyle(ButtonStyle.Link)
              .setURL(`https://docs.google.com/spreadsheets/d/${servidor.spreadsheetId}`)
              .setEmoji('📊')
          );
        
        await interaction.editReply({ 
          embeds: [embed],
          components: [row]
        });

        // Remove a mensagem após 5 minutos
        setTimeout(async () => {
          await interaction.deleteReply();
        }, 5 * 60 * 1000);
      }
    } catch (error) {
      console.error('Erro ao acessar a planilha:', error);
      
      // Mensagem de erro amigável e visível apenas para o usuário
      await interaction.editReply({ 
        content: '❌ Ocorreu um erro ao acessar a planilha. Por favor, contate um administrador e informe o horário deste erro.',
        ephemeral: true  // Torna a mensagem visível apenas para o usuário
      });
    }
  } catch (error) {
    console.error('Erro ao processar comando de horas:', error);
    
    let errorMessage = '⚠️ Ocorreu um erro ao processar seu comando.';
    if (error.message.includes('Muitas requisições simultâneas')) {
      errorMessage = '⏳ O sistema está sobrecarregado. Por favor, tente novamente em alguns segundos.';
    }
    
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ 
        content: `${errorMessage} Se o problema persistir, procure o suporte <@${SUPPORT_ID}>.`, 
        ephemeral: true 
      });
    } else {
      await interaction.editReply({ 
        content: `${errorMessage} Se o problema persistir, procure o suporte <@${SUPPORT_ID}>.`, 
        ephemeral: true 
      });
    }
  }
}

/**
 * Converte uma string de horas para o formato HH:MM:SS
 * @param {string} hoursStr - String de horas
 * @returns {string} - Horas formatadas em HH:MM:SS
 */
function formatHours(hoursStr) {
  const parts = hoursStr.split(':');
  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  const seconds = parts[2] ? parseInt(parts[2], 10) : 0;

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Obtém a cor do embed com base no total de horas
 * @param {string} totalHours - Total de horas do usuário
 * @returns {number} - Código da cor em hexadecimal
 */
function getColorByHours(totalHours) {
  const hours = parseFloat(totalHours);
  
  if (isNaN(hours)) return 0x5865F2;  // Azul padrão Discord se não for um número
  
  if (hours >= 100) return 0xE91E63;  // Rosa
  if (hours >= 50) return 0x9C27B0;   // Roxo
  if (hours >= 25) return 0x2196F3;   // Azul
  if (hours >= 10) return 0x4CAF50;   // Verde
  
  return 0xFFC107;  // Amarelo
}

/**
 * Constrói o embed com as informações do usuário
 * @param {Array} dayData - Dados dos dias
 * @param {string} name - Nome do usuário
 * @param {string} totalHours - Total de horas
 * @param {string} advs - Advertências
 * @param {string} justifications - Justificativas
 * @param {string} avatarURL - URL do avatar do usuário
 * @param {string} userId - ID do usuário no Discord
 * @param {number} maxDaysToConsider - Número máximo de dias considerados
 * @returns {EmbedBuilder} - Embed construído
 */
function buildFullInfoEmbed(dayData, name, totalHours, advs, justifications, avatarURL, userId, maxDaysToConsider, guildIcon) {
  const color = getColorByHours(totalHours);
  
  const registrosMessage = maxDaysToConsider < 5
    ? `Últimos ${dayData.length} ${dayData.length === 1 ? 'dia' : 'dias'} de registro (início do mês)`
    : `Últimos ${dayData.length} ${dayData.length === 1 ? 'dia' : 'dias'} de atividade`;
  
  const fields = [
    {
      name: '👑 Informações do Admin',
      value: `Nome: ${name}\nDiscord: <@${userId}>`,
      inline: false
    },
    {
      name: '⏱️ Estatísticas',
      value: '\u200B',
      inline: false
    },
    {
      name: '🕒 Total de Horas',
      value: totalHours || '-',
      inline: true
    },
    {
      name: '⚠️ Advertências',
      value: advs || '-',
      inline: true
    },
    {
      name: '📝 Justificativas',
      value: justifications || '-',
      inline: true
    },
    {
      name: '▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬',
      value: '\u200B',
      inline: false
    },
    {
      name: '📅 Registros Recentes',
      value: registrosMessage,
      inline: false
    }
  ];

  // Adiciona os dados de cada dia
  dayData.forEach((data) => {
    const formattedDate = `${data.date.getDate().toString().padStart(2, '0')}/${(data.date.getMonth() + 1).toString().padStart(2, '0')}/${data.date.getFullYear()}`;
    
    const isJustification = data.hours === 'J';
    
    let statusEmoji;
    let hoursText;
    
    if (isJustification) {
      statusEmoji = "📋";
      hoursText = "Justificativa registrada";
    } else if (!data.hours || data.hours.trim() === '' || data.hours === 'N/A' || data.hours === 'NaN:NaN:00') {
      statusEmoji = "⚪";
      hoursText = "Sem registro";
    } else {
      try {
        const [hours, minutes, seconds] = data.hours.split(':').map(num => parseInt(num, 10));
        const totalMinutes = (hours * 60) + minutes;
        
        if (totalMinutes >= 180) { // 3 horas ou mais
          statusEmoji = "✅";
        } else if (totalMinutes > 0) { // Mais que 0 minutos
          statusEmoji = "⏱️";
        } else {
          statusEmoji = "❌";
        }
        hoursText = formatHours(data.hours);
      } catch (error) {
        statusEmoji = "⚪";
        hoursText = "Formato inválido";
      }
    }
    
    fields.push({
      name: `${formattedDate}`,
      value: `${statusEmoji} ${hoursText}`,
      inline: false
    });
  });

  return new EmbedBuilder()
    .setTitle(`📊 Status de Horas - ${name}`)
    .setDescription('Aqui está o resumo das suas atividades como admin. Mantenha o bom trabalho! ✨')
    .setColor(color)
    .setThumbnail(avatarURL)
    .addFields(fields)
    .setFooter({ 
      text: 'Sistema de Horas • Desenvolvido por Toca da raposa',
      iconURL: guildIcon
    })
    .setTimestamp();
}

/**
 * Constrói o embed com as informações básicas do usuário
 * @param {string} name - Nome do usuário
 * @param {string} totalHours - Total de horas
 * @param {string} advs - Advertências
 * @param {string} justifications - Justificativas
 * @param {string} avatarURL - URL do avatar do usuário
 * @param {string} userId - ID do usuário no Discord
 * @returns {EmbedBuilder} - Embed construído
 */
function buildInfoEmbed(name, totalHours, advs, justifications, avatarURL, userId, guildIcon) {
  const color = getColorByHours(totalHours);

  const fields = [
    {
      name: '👑 Informações do Admin',
      value: `Nome: ${name}\nDiscord: <@${userId}>`,
      inline: false
    },
    {
      name: '⏱️ Estatísticas',
      value: '\u200B',
      inline: false
    },
    {
      name: '🕒 Total de Horas',
      value: totalHours || '-',
      inline: true
    },
    {
      name: '⚠️ Advertências',
      value: advs || '-',
      inline: true
    },
    {
      name: '📝 Justificativas',
      value: justifications || '-',
      inline: true
    }
  ];

  return new EmbedBuilder()
    .setTitle(`📊 Informações do Admin - ${name}`)
    .setDescription('Aqui estão as informações disponíveis sobre o admin. ✨')
    .setColor(color)
    .setThumbnail(avatarURL)
    .addFields(fields)
    .setFooter({ 
      text: 'Sistema de Horas • Desenvolvido por Toca da raposa',
      iconURL: guildIcon
    })
    .setTimestamp();
}

module.exports = { handleHourCommand };