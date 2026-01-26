const { google } = require('googleapis');
const sheets = google.sheets('v4');
const fs = require('fs');
const path = require('path');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
require('dotenv').config();

// Importar o modelo Servidor
const { Servidor } = require('../models/Servidor');

// ID do suporte técnico
const SUPPORT_ID = '657014871228940336';

// Sistema de Cache Global e Rate Limiting
const CACHE = {
  rankings: new Map(), // Cache global dos rankings
  lastUpdate: 0,       // Última atualização do cache
  updateLock: false,   // Trava para atualização concorrente
  userCooldowns: new Map(), // Cooldown por usuário
  requestCount: 0,     // Contador de requisições atual
  lastReset: Date.now() // Último reset do contador de requisições
};

// Configurações
const CONFIG = {
  CACHE_DURATION: 2 * 60 * 1000,     // Cache válido por 2 minutos
  COOLDOWN_DURATION: 10 * 1000,      // Cooldown de 10 segundos por usuário
  MAX_REQUESTS_PER_MINUTE: 100,      // Máximo de requisições por minuto
  REQUEST_RESET_INTERVAL: 60 * 1000,  // Intervalo de reset do contador (1 minuto)
};

/**
 * Gerencia rate limiting e cooldown
 * @param {string} userId ID do usuário
 * @returns {Object} Status do rate limit
 */
function handleRateLimit(userId) {
  const now = Date.now();

  // Reset contador de requisições se necessário
  if (now - CACHE.lastReset > CONFIG.REQUEST_RESET_INTERVAL) {
    CACHE.requestCount = 0;
    CACHE.lastReset = now;
  }

  // Verifica limite global de requisições
  if (CACHE.requestCount >= CONFIG.MAX_REQUESTS_PER_MINUTE) {
    return {
      allowed: false,
      reason: 'GLOBAL_LIMIT',
      retryAfter: Math.ceil((CONFIG.REQUEST_RESET_INTERVAL - (now - CACHE.lastReset)) / 1000)
    };
  }

  // Verifica cooldown do usuário
  const userLastUse = CACHE.userCooldowns.get(userId) || 0;
  if (now - userLastUse < CONFIG.COOLDOWN_DURATION) {
    return {
      allowed: false,
      reason: 'USER_COOLDOWN',
      retryAfter: Math.ceil((CONFIG.COOLDOWN_DURATION - (now - userLastUse)) / 1000)
    };
  }

  // Atualiza contadores
  CACHE.requestCount++;
  CACHE.userCooldowns.set(userId, now);

  return { allowed: true };
}

/**
 * Busca ou atualiza o cache do ranking
 * @param {string} guildId ID do servidor
 * @returns {Promise<Array>} Dados do ranking
 */
async function getRankingData(guildId) {
  const now = Date.now();

  // Se o cache está válido, retorna os dados em cache
  if (CACHE.rankings.has(guildId) && 
      now - CACHE.lastUpdate < CONFIG.CACHE_DURATION) {
    return CACHE.rankings.get(guildId);
  }

  // Se já há uma atualização em andamento, aguarda
  if (CACHE.updateLock) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    return CACHE.rankings.get(guildId);
  }

  try {
    CACHE.updateLock = true;
    const topUsuarios = await getTopUsers(guildId);
    
    CACHE.rankings.set(guildId, topUsuarios);
    CACHE.lastUpdate = now;
    
    return topUsuarios;
  } finally {
    CACHE.updateLock = false;
  }
}

function converterTempoParaSegundos(strTempo) {
  if (!strTempo) return 0;

  const partes = strTempo.split(':');
  if (partes.length === 3) {
    const horas = parseInt(partes[0], 10) || 0;
    const minutos = parseInt(partes[1], 10) || 0;
    const segundos = parseInt(partes[2], 10) || 0;
    return horas * 3600 + minutos * 60 + segundos;
  }
  return 0;
}

function formatarTempoLegivel(tempo) {
  const partes = tempo.split(':');
  if (partes.length === 3) {
    return `${partes[0]}h ${partes[1]}m ${partes[2]}s`;
  }
  return tempo;
}

async function getTopUsers(guildId) {
  try {
    const servidor = await Servidor.findOne({ guildId });
    if (!servidor) {
      throw new Error("Configuração do servidor não encontrada. Use o comando /painel para configurar.");
    }

    // Verificar se o arquivo de credenciais existe
    const credentialsPath = process.env.GOOGLE_CREDENTIALS_PATH || './credentials.json';
    
    if (!fs.existsSync(credentialsPath)) {
      throw new Error(`Arquivo de credenciais não encontrado em: ${credentialsPath}`);
    }

    const auth = new google.auth.GoogleAuth({
      keyFile: credentialsPath,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const authClient = await auth.getClient();

    try {
      const res = await sheets.spreadsheets.values.get({
        auth: authClient,
        spreadsheetId: servidor.spreadsheetId,
        range: `${servidor.sheetName}!A:C`,
      });

      const rows = res.data.values;
      if (!rows || rows.length === 0) {
        return [];
      }

      // Processar dados da planilha, pulando as primeiras duas linhas
      const dadosBrutos = rows
        .slice(2) // Pula as duas primeiras linhas da planilha
        .filter(row => row.length >= 3 && row[0] && row[1] && row[2])
        .map(row => ({
          userId: row[0],
          userName: row[1],
          totalTime: row[2],
        }));

      // Agrupar por userId e somar os tempos
      const usuariosAgrupados = {};
      
      dadosBrutos.forEach(usuario => {
        if (!usuariosAgrupados[usuario.userId]) {
          usuariosAgrupados[usuario.userId] = {
            userId: usuario.userId,
            userName: usuario.userName,
            totalSegundos: 0
          };
        }
        
        usuariosAgrupados[usuario.userId].totalSegundos += converterTempoParaSegundos(usuario.totalTime);
      });
      
      // Converter para array final
      const usuarios = Object.values(usuariosAgrupados).map(usuario => {
        const totalSegundos = usuario.totalSegundos;
        const horas = Math.floor(totalSegundos / 3600);
        const minutos = Math.floor((totalSegundos % 3600) / 60);
        const segundos = totalSegundos % 60;
        
        return {
          userId: usuario.userId,
          userName: usuario.userName,
          totalTime: `${horas}:${minutos.toString().padStart(2, '0')}:${segundos.toString().padStart(2, '0')}`
        };
      });

      // Ordenar por tempo total (decrescente)
      usuarios.sort((a, b) => {
        const segundosA = converterTempoParaSegundos(a.totalTime);
        const segundosB = converterTempoParaSegundos(b.totalTime);
        return segundosB - segundosA;
      });

      return usuarios;
    } catch (error) {
      console.error('Erro ao obter dados da planilha:', error);
      throw error;
    }
  } catch (error) {
    console.error('Erro ao obter configuração do servidor:', error);
    throw error;
  }
}

/**
 * Gera o embed do ranking
 * @param {Array} topUsuarios Lista de usuários ordenada
 * @param {number} page Número da página atual
 * @param {number} itemsPerPage Itens por página
 * @param {Object} interaction Objeto de interação do Discord
 * @returns {EmbedBuilder} Embed construído
 */
function generateRankingEmbed(topUsuarios, page, itemsPerPage = 25, interaction) {
  const totalPages = Math.ceil(topUsuarios.length / itemsPerPage);
  const start = page * itemsPerPage;
  const end = Math.min(start + itemsPerPage, topUsuarios.length);
  const usuariosPagina = topUsuarios.slice(start, end);
  
  let listaTopUsuarios = "";
  
  if (usuariosPagina.length === 0) {
    listaTopUsuarios = "Não há usuários para exibir nesta página.";
  } else {
    listaTopUsuarios = usuariosPagina
      .map((usuario, index) => {
        const position = start + index + 1;
        const tempoFormatado = formatarTempoLegivel(usuario.totalTime);
        
        let prefix = `${position}º`;
        let medal = "";
        if (position === 1) medal = "🥇";
        if (position === 2) medal = "🥈";
        if (position === 3) medal = "🥉";
        
        return `${medal} **${prefix} Lugar**\n👤 ${usuario.userName}\n⏳ \`${tempoFormatado}\`\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬`;
      })
      .join('\n\n');
  }
  
  const embed = new EmbedBuilder()
    .setTitle('🏆 TOP ADMINISTRADORES')
    .setDescription(listaTopUsuarios)
    .setColor(0x2b2d31)
    .setTimestamp();

  if (interaction?.guild?.iconURL) {
    embed.setFooter({
      text: `Sistema de Top • Página ${page + 1}/${totalPages}`,
      iconURL: interaction.guild.iconURL()
    });
  } else {
    embed.setFooter({
      text: `Sistema de Top • Página ${page + 1}/${totalPages}`
    });
  }

  return embed;
}

async function handleTopCommand(interaction) {
  try {
    await interaction.deferReply();

    const rateLimit = handleRateLimit(interaction.user.id);
    if (!rateLimit.allowed) {
      const message = rateLimit.reason === 'GLOBAL_LIMIT'
        ? `⚠️ Sistema sobrecarregado. Tente novamente em ${rateLimit.retryAfter} segundos.`
        : `⏳ Aguarde ${rateLimit.retryAfter} segundos para usar o comando novamente.`;
      
      await interaction.editReply({
        content: message,
        ephemeral: true
      });
      return;
    }

    try {
      const topUsuarios = await getRankingData(interaction.guild.id);
      
      if (!topUsuarios || topUsuarios.length === 0) {
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle('❌ Sem Dados Disponíveis')
              .setDescription('Não foram encontrados registros na planilha.')
              .setColor(0x2b2d31)
              .setTimestamp()
          ],
          ephemeral: true
        });
        return;
      }

      const embed = generateRankingEmbed(topUsuarios, 0, 25, interaction);
      const totalPages = Math.ceil(topUsuarios.length / 25);

      const servidor = await Servidor.findOne({ guildId: interaction.guild.id });
      
      if (!servidor || !servidor.spreadsheetId) {
        throw new Error("Configuração do servidor não encontrada ou ID da planilha não definido.");
      }

      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('ranking_prev_page')
            .setLabel('◀️ Anterior')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(true),
          new ButtonBuilder()
            .setCustomId('ranking_next_page')
            .setLabel('Próximo ▶️')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(totalPages <= 1),
          new ButtonBuilder()
            .setLabel('Acessar Planilha')
            .setStyle(ButtonStyle.Link)
            .setURL(`https://docs.google.com/spreadsheets/d/${servidor.spreadsheetId}`)
            .setEmoji('📊')
        );

      const message = await interaction.editReply({
        embeds: [embed],
        components: [row]
      });

      // Criar coletor de botões
      const collector = message.createMessageComponentCollector({ 
        time: 300000,
        filter: i => i.user.id === interaction.user.id 
      });

      let currentPage = 0;

      collector.on('collect', async (i) => {
        try {
          if (i.customId === 'ranking_prev_page') {
            currentPage = Math.max(0, currentPage - 1);
          } else if (i.customId === 'ranking_next_page') {
            currentPage = Math.min(totalPages - 1, currentPage + 1);
          }

          const newEmbed = generateRankingEmbed(topUsuarios, currentPage, 25, interaction);
          
          // Atualizar estado dos botões
          row.components[0].setDisabled(currentPage === 0);
          row.components[1].setDisabled(currentPage === totalPages - 1);

          await i.update({
            embeds: [newEmbed],
            components: [row]
          });
        } catch (error) {
          console.error('Erro ao processar interação do botão:', error);
        }
      });

      collector.on('end', () => {
        try {
          message.delete().catch(console.error);
        } catch (error) {
          console.error('Erro ao excluir mensagem:', error);
        }
      });

    } catch (error) {
      console.error('Erro ao buscar ranking:', error);
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle('❌ Erro no Sistema')
            .setDescription('Ocorreu um erro ao buscar o ranking de administradores.')
            .setColor(0x2b2d31)
            .setTimestamp()
        ],
        ephemeral: true
      });
    }
  } catch (error) {
    console.error('Erro ao processar comando top:', error);
    const errorMessage = "Ocorreu um erro ao processar o comando. Por favor, tente novamente.";
    
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: errorMessage, ephemeral: true });
    } else {
      await interaction.followUp({ content: errorMessage, ephemeral: true });
    }
  }
}

module.exports = { 
  handleTopCommand
};