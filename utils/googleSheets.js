const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { Servidor } = require('../models/Servidor');
const { DateTime } = require('luxon');

// Configuração de logging
const LOGGING = {
  verbose: false, // Definido como false para reduzir logs
  debug: false,   // Ativar logs de debug
  errors: true,   // Manter logs de erros
  success: false, // Desativar logs de sucesso
  queue: false    // Desativar logs de enfileiramento
};

// Função auxiliar para logging condicional
function logDebug(message) {
  if (LOGGING.debug) {
    console.log(`[GoogleSheets] ${message}`);
  }
}

// Função auxiliar para logging de fila
function logQueue(message) {
  if (LOGGING.queue) {
    console.log(`[GoogleSheets] ${message}`);
  }
}

// Usa a variável de ambiente para o caminho das credenciais
const credentialsPath = process.env.GOOGLE_CREDENTIALS_PATH || path.resolve(__dirname, '../credentials.json');
if (!fs.existsSync(credentialsPath)) {
  console.error(`Erro: O arquivo de credenciais não existe no caminho: ${credentialsPath}`);
  process.exit(1); // Sai do processo com erro
}

process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialsPath;
process.env.TZ = "America/Sao_Paulo";
if (LOGGING.verbose) console.log(`Credenciais do Google configuradas: ${credentialsPath}`);

// ID do usuário responsável por dar suporte
const SUPPORT_USER_ID = "657014871228940336";

// Sistema de Cache para otimizar chamadas ao Google Sheets
const SHEETS_CACHE = {
  userRows: new Map(),      // Cache de posições de usuários na planilha
  sheetData: new Map(),     // Cache de dados da planilha
  lastAccess: new Map(),    // Controle de último acesso
  ttl: 5 * 60 * 1000,       // 5 minutos de tempo de vida para o cache
  lastCleanup: Date.now()   // Última vez que o cache foi limpo
};

// Sistema de Batch Updates para otimizar atualizações da planilha
const UPDATE_QUEUE = {
  updates: [],              // Fila de atualizações pendentes
  inProgress: false,        // Flag para indicar processamento em andamento
  lastFlush: Date.now()     // Última vez que a fila foi processada
};

// Cache de letras de colunas para evitar recálculos
const COLUMN_LETTER_CACHE = new Map();

// Mapa de referência para debugging
const COLUMN_REFERENCE = {
  1: 'E',   // Dia 1 começa na coluna E
  2: 'F',   // Dia 2 na coluna F
  25: 'AD', // Dia 25 deve ser coluna AD
  31: 'AJ'  // Dia 31 deve ser coluna AJ
};

// Limpar cache a cada 15 minutos para evitar consumo de memória
setInterval(() => {
  const now = Date.now();
  
  // Limpar cache de usuários
  for (const [key, data] of SHEETS_CACHE.userRows.entries()) {
    if (now - data.timestamp > SHEETS_CACHE.ttl) {
      SHEETS_CACHE.userRows.delete(key);
    }
  }
  
  // Limpar cache de dados de planilha
  for (const [key, data] of SHEETS_CACHE.sheetData.entries()) {
    if (now - data.timestamp > SHEETS_CACHE.ttl) {
      SHEETS_CACHE.sheetData.delete(key);
    }
  }
  
  SHEETS_CACHE.lastCleanup = now;
}, 15 * 60 * 1000);

// Processar fila de atualizações a cada 5 segundos
setInterval(async () => {
  if (UPDATE_QUEUE.updates.length > 0 && !UPDATE_QUEUE.inProgress) {
    await processUpdateQueue();
  }
}, 5000);

/**
 * Processa a fila de atualizações em lote
 */
async function processUpdateQueue() {
  if (UPDATE_QUEUE.updates.length === 0 || UPDATE_QUEUE.inProgress) {
    return;
  }
  
  UPDATE_QUEUE.inProgress = true;
  
  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: credentialsPath, 
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    
    const authClient = await auth.getClient();
    const sheets = google.sheets({ version: "v4", auth: authClient });
    
    // Agrupar atualizações por planilha
    const bySpreadsheet = {};
    for (const update of UPDATE_QUEUE.updates) {
      if (!bySpreadsheet[update.spreadsheetId]) {
        bySpreadsheet[update.spreadsheetId] = [];
      }
      bySpreadsheet[update.spreadsheetId].push({
        range: update.range,
        values: [[update.value]]
      });
    }
    
    // Processar cada planilha em batch
    for (const [spreadsheetId, data] of Object.entries(bySpreadsheet)) {
      try {
        const response = await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId,
          resource: {
            valueInputOption: "USER_ENTERED",
            data
          }
        });
      } catch (error) {
        console.error(`[GoogleSheets] Erro ao atualizar planilha ${spreadsheetId}:`, error.message);
        throw error;
      }
    }
    
    UPDATE_QUEUE.updates = [];
    UPDATE_QUEUE.lastFlush = Date.now();
  } catch (error) {
    console.error(`[GoogleSheets] Erro ao processar fila de atualizações:`, error);
    throw error;
  } finally {
    UPDATE_QUEUE.inProgress = false;
  }
}

/**
 * Enfileira uma atualização para ser processada em lote
 * @param {string} spreadsheetId - ID da planilha
 * @param {string} range - Range da célula (ex: 'Sheet1!A1')
 * @param {string} value - Valor a ser inserido
 */
function queueSheetUpdate(spreadsheetId, range, value) {
  logQueue(`Enfileirando atualização: ${spreadsheetId} - ${range} = ${value}`);
  
  UPDATE_QUEUE.updates.push({
    spreadsheetId,
    range,
    value
  });
  
  // Forçar processamento imediato se houver atualizações pendentes
  if (UPDATE_QUEUE.updates.length > 0 && !UPDATE_QUEUE.inProgress) {
    logQueue(`Forçando processamento imediato da fila...`);
    processUpdateQueue().catch(error => {
      logQueue(`Erro ao processar fila imediatamente:`, error);
    });
  }
}

/**
 * Busca ou retorna do cache a linha do usuário na planilha
 * @param {Object} sheets - Cliente Google Sheets
 * @param {string} spreadsheetId - ID da planilha
 * @param {string} sheetName - Nome da aba
 * @param {string} userId - ID do usuário
 * @returns {Promise<number|null>} - Número da linha ou null se não encontrado
 */
async function getUserRowCached(sheets, spreadsheetId, sheetName, userId) {
  const cacheKey = `${spreadsheetId}-${sheetName}-${userId}`;
  const now = Date.now();
  
  // Verificar cache
  if (SHEETS_CACHE.userRows.has(cacheKey)) {
    const cached = SHEETS_CACHE.userRows.get(cacheKey);
    if (now - cached.timestamp < SHEETS_CACHE.ttl) {
      return cached.row;
    }
  }
  
  // Cache miss - buscar da planilha
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: spreadsheetId,
      range: `${sheetName}!A:A`,
    });
    
    const rows = response.data.values || [];
    
    let rowIndex = -1;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i][0]?.toString() === userId.toString()) {
        rowIndex = i + 1;
        break;
      }
    }
    
    if (rowIndex !== -1) {
      // Atualizar cache
      SHEETS_CACHE.userRows.set(cacheKey, {
        row: rowIndex,
        timestamp: now
      });
      return rowIndex;
    }
  } catch (error) {
    console.error(`[GoogleSheets] Erro ao buscar usuário ${userId} na planilha:`, error);
    return null;
  }
  
  return null;
}

/**
 * Verifica se a planilha está acessível e se a coluna A está disponível
 * @param {Object} sheets - Cliente do Google Sheets
 * @param {string} spreadsheetId - ID da planilha
 * @param {string} sheetName - Nome da aba
 * @returns {Promise<boolean>} - Verdadeiro se a planilha e a coluna A estão acessíveis
 */
async function verificarAcessoPlanilha(sheets, spreadsheetId, sheetName) {
  try {
    // Fazer uma única chamada para verificar a planilha e a aba
    const planilha = await sheets.spreadsheets.get({
      spreadsheetId: spreadsheetId,
      ranges: [`${sheetName}!A:AK`],
      fields: 'sheets.properties'
    });

    // Se não houver erro até aqui, significa que temos acesso à planilha
    // e a aba existe. Não precisamos fazer mais verificações.
    return true;
  } catch (error) {
    // Não logar erro no terminal
    return false;
  }
}

/**
 * Converte um número do dia para a letra de coluna correspondente
 * @param {number} day - Dia do mês (1-31)
 * @returns {string} - Letra da coluna correspondente
 */
function getColumnLetter(day) {
  // Validar entrada
  if (!day || day < 1 || day > 31) {
    throw new Error(`Dia inválido para cálculo de coluna: ${day}`);
  }

  // Verificar cache primeiro
  if (COLUMN_LETTER_CACHE.has(day)) {
    return COLUMN_LETTER_CACHE.get(day);
  }

  // A coluna F (índice 6) é onde começam os dias
  const columnIndex = day + 5;

  // Converter índice para letra(s) de coluna
  function indexToColumn(index) {
    let temp = index;
    let letters = '';
    
    while (temp > 0) {
      temp--;
      letters = String.fromCharCode((temp % 26) + 65) + letters;
      temp = Math.floor(temp / 26);
    }
    
    return letters;
  }

  // Tabela de validação
  const columnsByIndex = {
    6: 'F',   // Dia 1
    7: 'G',   // Dia 2
    8: 'H',   // Dia 3
    29: 'AC', // Dia 24
    30: 'AD', // Dia 25
    31: 'AE', // Dia 26
    32: 'AF', // Dia 27
    33: 'AG', // Dia 28
    34: 'AH', // Dia 29
    35: 'AI', // Dia 30
    36: 'AJ'  // Dia 31
  };

  const columnName = indexToColumn(columnIndex);

  // Validação
  if (columnsByIndex[columnIndex] && columnsByIndex[columnIndex] !== columnName) {
    throw new Error(`Erro no cálculo da coluna para o dia ${day} (índice ${columnIndex})`);
  }

  // Armazenar no cache
  COLUMN_LETTER_CACHE.set(day, columnName);
  return columnName;
}

// Função para obter configuração do servidor
async function getServerConfig(guildId) {
  try {
    const servidor = await Servidor.findOne({ guildId });
    if (!servidor) {
      throw new Error('Configuração do servidor não encontrada. Use o comando /painel para configurar.');
    }
    return servidor;
  } catch (error) {
    console.error(`[GoogleSheets] Erro ao buscar configuração do servidor ${guildId}:`, error);
    throw error;
  }
}

/**
 * Verifica se o usuário existe na planilha - Versão otimizada
 * @param {string} userId - ID do usuário
 * @returns {boolean} - Verdadeiro se o usuário existe, falso caso contrário
 */
async function checkUserInSheet(userId, config) {
  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: credentialsPath, 
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    const authClient = await auth.getClient();
    const sheets = google.sheets({ version: "v4", auth: authClient });

    // Usar cache se disponível
    const row = await getUserRowCached(sheets, config.spreadsheetId, config.sheetName, userId);
    return row !== null;
  } catch (error) {
    logDebug(`Erro ao verificar usuário na planilha: ${error.message}`);
    return false;
  }
}

/**
 * Cria um novo usuário na planilha
 * @param {string} userId - ID do usuário
 * @param {string} userTag - Tag do usuário
 */
async function createUserInSheet(userId, userTag, config) {
  const { spreadsheetId, sheetName } = config;
  try {
    if (LOGGING.verbose) logDebug(`Criando novo usuário na planilha: ${userId} (${userTag})...`);
    
    // Configurar autenticação e client do Google Sheets
    const auth = new google.auth.GoogleAuth({
      keyFile: credentialsPath,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    
    const authClient = await auth.getClient();
    const sheets = google.sheets({ version: "v4", auth: authClient });
    
    // Verificar acesso à planilha antes de prosseguir
    if (!(await verificarAcessoPlanilha(sheets, spreadsheetId, sheetName))) {
      return null;
    }
    
    // Buscar o sheetId correto
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
    const sheet = spreadsheet.data.sheets.find(s => s.properties.title === sheetName);
    if (!sheet) throw new Error(`Aba '${sheetName}' não encontrada na planilha`);
    const sheetId = sheet.properties.sheetId;

    // Obter dados da planilha
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A:A`,
    });
    const rows = response.data.values || [];
    let nextRow = rows.length + 1;

    // Se a planilha estiver vazia, adicionar cabeçalhos corretos
    if (rows.length === 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetName}!A1:E1`,
        valueInputOption: "USER_ENTERED",
        resource: { values: [["ID", "Nome", "Horas", "Dados", "Outros Dados"]] }
      });
      nextRow = 2;
    }

    // Verificar duplicidade
    const existingRow = rows.findIndex(row => row[0]?.toString() === userId.toString());
    if (existingRow !== -1) return existingRow + 1;

    // Expandir linhas se necessário
    // (agora usando o sheetId correto)
    if (nextRow > rows.length) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        resource: {
          requests: [{
            appendDimension: {
              sheetId,
              dimension: "ROWS",
              length: 10
            }
          }]
        }
      });
    }

    // Adicionar o usuário (preenchendo até a coluna E)
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A${nextRow}:E${nextRow}`,
      valueInputOption: "USER_ENTERED",
      resource: {
        values: [[userId, userTag, "", "", ""]]
      }
    });

    // Atualizar cache
    const cacheKey = `${spreadsheetId}-${sheetName}-${userId}`;
    SHEETS_CACHE.userRows.set(cacheKey, { row: nextRow, timestamp: Date.now() });

    if (LOGGING.success) logDebug(`Usuário ${userId} adicionado na linha ${nextRow} com sucesso.`);
    return nextRow;
  } catch (error) {
    console.error(`[GoogleSheets] Erro ao criar usuário na planilha: ${error.message}`);
    return null;
  }
}

/**
 * Envia os dados para o Google Sheets - Versão otimizada e com mais logs
 * @param {Object} client - Cliente Discord.js
 * @param {string} userId - ID do usuário
 * @param {string} accumulatedTime - Tempo acumulado formatado (HH:MM:SS)
 * @param {string} messageId - ID da mensagem
 * @param {string} guildId - ID do servidor
 * @param {string} specificColumn - Coluna específica para registrar o tempo (opcional)
 * @param {string} cardChannelId - ID do canal do cartão (opcional)
 * @returns {Promise<{success: boolean, url: string, error?: string}>}
 */
async function sendToGoogleSheets(client, userId, accumulatedTime, messageId, guildId, specificColumn = null, cardChannelId = null) {
  let config;
  let auth;
  let sheets;

  try {
    if (!guildId) {
      throw new Error('ID do servidor não fornecido');
    }

    // Inicializar auth e sheets uma única vez
    auth = new google.auth.GoogleAuth({
      keyFile: credentialsPath,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    const [authClient, serverConfig] = await Promise.all([
      auth.getClient(),
      getServerConfig(guildId)
    ]);

    config = serverConfig;
    if (!config?.spreadsheetId || !config?.sheetName) {
      throw new Error(`Configuração do servidor inválida ou incompleta para guild ${guildId}`);
    }

    sheets = google.sheets({ version: "v4", auth: authClient });

    // Obter data e coluna
    const date = new Date();
    const startDay = getBrasiliaDay(date);
    const columnLetter = specificColumn || getColumnLetter(startDay);

    // Buscar linha do usuário e verificar acesso à planilha em paralelo
    const [rowIndex, sheetAccess] = await Promise.all([
      getUserRowCached(sheets, config.spreadsheetId, config.sheetName, userId),
      verificarAcessoPlanilha(sheets, config.spreadsheetId, config.sheetName)
    ]);

    if (!sheetAccess) {
      throw new Error('Sem acesso à planilha ou planilha não encontrada');
    }

    // Validar rowIndex
    if (rowIndex && (!Number.isInteger(rowIndex) || rowIndex < 1)) {
      throw new Error(`Linha inválida para usuário ${userId}: ${rowIndex}`);
    }

    const sheetUrl = `https://docs.google.com/spreadsheets/d/${config.spreadsheetId}/edit#gid=0`;
    let targetRange = '';
    let updateResponse;

    if (rowIndex) {
      // Usuário existe - Atualizar célula
      targetRange = `${config.sheetName}!${columnLetter}${rowIndex}`;
      
      updateResponse = await sheets.spreadsheets.values.update({
        spreadsheetId: config.spreadsheetId,
        range: targetRange,
        valueInputOption: "USER_ENTERED",
        resource: {
          values: [[accumulatedTime]]
        }
      });
    } else {
      // Usuário não existe - Criar e atualizar
      const user = await client.users.fetch(userId);
      if (!user) {
        throw new Error(`Usuário Discord ${userId} não encontrado`);
      }

      const newRow = await createUserInSheet(userId, user.tag, config);

      if (!newRow) {
        throw new Error(`Falha ao criar linha para o usuário ${userId}`);
      }

      targetRange = `${config.sheetName}!${columnLetter}${newRow}`;

      updateResponse = await sheets.spreadsheets.values.update({
        spreadsheetId: config.spreadsheetId,
        range: targetRange,
        valueInputOption: "USER_ENTERED",
        resource: {
          values: [[accumulatedTime]]
        }
      });
    }

    // Enviar log para Discord
    await sendLogMessage(
      client,
      userId,
      'Tempo atualizado na planilha com sucesso!',
      sheetUrl,
      columnLetter,
      rowIndex || 'N/A',
      accumulatedTime,
      config,
      messageId,
      cardChannelId
    );

    return { 
      success: true, 
      url: `${sheetUrl}&range=${columnLetter}${rowIndex}` 
    };

  } catch (error) {
    const errorMessage = `Erro: ${error.message}`;

    try {
      await sendLogMessage(
        client,
        userId,
        errorMessage,
        '',
        '',
        '',
        accumulatedTime,
        config,
        messageId,
        cardChannelId
      );
    } catch (logError) {
      console.error('[GoogleSheets] Erro ao enviar log:', logError);
    }

    return { 
      success: false, 
      error: errorMessage 
    };
  }
}

/**
 * Envia uma mensagem de log para o canal configurado
 * @param {Object} client - Cliente Discord.js
 * @param {string} userId - ID do usuário
 * @param {string} message - Mensagem a enviar
 * @param {string} sheetUrl - URL da planilha
 * @param {string} columnLetter - Letra da coluna atualizada
 * @param {number} rowIndex - Número da linha atualizada
 * @param {string} accumulatedTime - Tempo registrado
 */
async function sendLogMessage(client, userId, message, sheetUrl = "", columnLetter = "", rowIndex = "", accumulatedTime = "", config = null, messageId = "", cardChannelId = null) {
  try {
    if (!client || !client.channels) {
      return;
    }

    // Se não tiver config, tenta buscar do banco de dados
    if (!config) {
      const guildId = client.guilds.cache.first()?.id;
      if (!guildId) {
        return;
      }
      config = await getServerConfig(guildId);
    }

    if (!config || !config.channelId) {
      return;
    }

    // Buscar o canal de log
    let logChannel;
    try {
      logChannel = await client.channels.fetch(config.channelId);
      if (!logChannel || !logChannel.isTextBased()) {
        return;
      }
    } catch (error) {
      return;
    }

    // Obter o servidor para acessar o ícone
    const guild = logChannel.guild;
    const guildIconURL = guild.iconURL({ dynamic: true });
    
    // Verifica se é uma mensagem de erro
    const isError = message.includes("Erro");
    
    // Cria um embed mais bonito
    const embed = new EmbedBuilder()
      .setColor(isError ? 0xED4245 : 0x57F287)
      .setTitle(isError ? "❌ Erro no Registro" : "✅ Registro de Horas")
      .setTimestamp();

    // Formatação da data e hora para o rodapé
    const timeFormatted = new Date().toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit', 
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    // Texto do rodapé com o nome do sistema e data/hora formatados
    const footerText = `Sistema de Log • desenvolvido por toca da raposa • ${timeFormatted}`; 
    
    // Adiciona o rodapé com ou sem ícone do servidor
    if (guildIconURL) {
      embed.setFooter({ 
        text: footerText,
        iconURL: guildIconURL 
      });
    } else {
      embed.setFooter({ 
        text: footerText
      });
    }
    
    // Se for erro, adiciona mensagem para contatar o suporte com mais destaque
    if (isError) {
      embed.setDescription(`<@${userId}> ${message}\n\n**⚠️ Por favor, contate o suporte do bot: <@${SUPPORT_USER_ID}>**`);
      
      // Lista de URLs de fallback para ícones de erro
      const errorIcons = [
        'https://cdn.discordapp.com/emojis/695734221322584155.png',
        'https://cdn.discordapp.com/attachments/1079378874501210152/1214390093290557531/error.png',
        'https://cdn.discordapp.com/emojis/912008733219147796.png'
      ];
      
      // Usa o primeiro ícone da lista
      embed.setThumbnail(errorIcons[0]);
    } else {
      // Mensagem de sucesso com formatação melhorada
      embed.setDescription(`🦊 <@${userId}> ${message}`);
      
      // Lista de URLs de fallback para ícones de sucesso
      const successIcons = [
        'https://cdn.discordapp.com/emojis/1039675046509314089.png',
        'https://cdn.discordapp.com/attachments/1079378874501210152/1214390093056225320/success.png',
        'https://cdn.discordapp.com/emojis/911779307516481586.png'
      ];
      
      // Usa o primeiro ícone da lista
      embed.setThumbnail(successIcons[0]);
    }
    
    // Adiciona campos extras para mensagens de sucesso com emojis e melhor formatação
    if (!isError && columnLetter && rowIndex && accumulatedTime) {
      embed.addFields(
        { name: '📊 Planilha', value: `\`${config.sheetName}\``, inline: true },
        { name: '📋 Célula', value: `\`${columnLetter}${rowIndex}\``, inline: true },
        { name: '⏱️ Tempo Registrado', value: `\`${accumulatedTime}\``, inline: true }
      );
      
      // Adiciona campo para o nome do servidor
      if (config?.nome) {
        embed.addFields({ name: '🏢 Servidor', value: `\`${config.nome}\``, inline: false });
      }
    }

    // Adiciona autor com o nome do usuário e seu avatar
    try {
      const user = await client.users.fetch(userId);
      if (user) {
        // Configura o autor com tamanho e formato específicos para o avatar
        embed.setAuthor({
          name: user.tag || `Usuário ${userId}`,
          iconURL: user.displayAvatarURL({ 
            dynamic: true,
            format: 'png',
            size: 128
          })
        });
      }
    } catch (error) {
      // Fallback sem imagem se não conseguir obter o usuário
      embed.setAuthor({
        name: `Usuário ${userId}`
      });
    }

    // Adiciona botões na mesma linha
    const components = [];
    const row = new ActionRowBuilder();
    
    // Botão para ver a planilha
    if (sheetUrl) {
      row.addComponents(
        new ButtonBuilder()
          .setLabel("Ver Planilha")
          .setStyle(ButtonStyle.Link)
          .setURL(sheetUrl)
          .setEmoji('📊')
      );
    }

    // Adiciona botão de suporte apenas para mensagens de erro
    if (isError) {
      row.addComponents(
        new ButtonBuilder()
          .setLabel("Contatar Suporte")
          .setStyle(ButtonStyle.Link)
          .setURL(`https://discord.com/users/${SUPPORT_USER_ID}`)
          .setEmoji('🆘')
      );
    }

    // Adiciona botão de ver cartão
    const resolvedGuildId = config?.guildId || logChannel?.guild?.id || 'N/A';

    if (messageId && cardChannelId && resolvedGuildId !== 'N/A') {
      row.addComponents(
        new ButtonBuilder()
          .setLabel('Ver Cartão')
          .setStyle(ButtonStyle.Link)
          .setURL(`https://discord.com/channels/${resolvedGuildId}/${cardChannelId}/${messageId}`)
          .setEmoji('📋')
      );
    }

    if (row.components.length > 0) {
      components.push(row);
    }

    // Enviar a mensagem para o canal de log
    const messageLog = await logChannel.send({
      embeds: [embed],
      components: components
    }).catch((err) => {
      console.error('[GoogleSheets] Erro ao enviar mensagem de log:', err);
      return null;
    });

    return { 
      success: true, 
      url: `${sheetUrl}&range=${columnLetter}${rowIndex}`,
      messageId: messageLog?.id
    };

  } catch (error) {
    console.error('[GoogleSheets] Erro geral em sendLogMessage:', error);
    return { 
      success: false, 
      error: error.message 
    };
  }
}

async function buscarUsuario(sheets, spreadsheetId, sheetName, userId, nomeAnimal = null) {
  try {
    // Busca apenas as colunas necessárias (ID e Nome)
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: spreadsheetId,
      range: `${sheetName}!A:B`,
      valueRenderOption: 'UNFORMATTED_VALUE'
    });

    if (!response.data.values) {
      return null;
    }

    // Procura o usuário pelo ID
    const userRow = response.data.values.findIndex(row => row[0] === userId);
    if (userRow === -1) {
      return null;
    }

    // Se um nome de animal foi fornecido, atualiza o nome do usuário
    if (nomeAnimal) {
      // Verifica se o nome de animal já existe na planilha
      const animalExiste = response.data.values.some(row => row[1] === nomeAnimal);
      if (animalExiste) {
        throw new Error(`O nome de animal "${nomeAnimal}" já está sendo usado por outro usuário`);
      }

      await sheets.spreadsheets.values.update({
        spreadsheetId: spreadsheetId,
        range: `${sheetName}!B${userRow + 1}`,
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: [[nomeAnimal]]
        }
      });
      response.data.values[userRow][1] = nomeAnimal;
    }

    return {
      row: userRow + 1,
      data: response.data.values[userRow]
    };
  } catch (error) {
    logDebug(`Erro ao buscar/atualizar usuário: ${error.message}`);
    throw error;
  }
}

/**
 * Obtém o dia de início do ponto
 * @param {Date} startTime - Data de início do ponto
 * @returns {number} - Dia do mês (1-31)
 */
function getStartDay(startTime) {
    const brasiliaDate = new Date(startTime.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    return brasiliaDate.getDate();
}

function getBrasiliaDay(date = new Date()) {
  // Converter para o fuso horário de Brasília
  const brasiliaDate = new Date(date.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));

  return brasiliaDate.getDate();
}

/**
 * Retorna as abas (sheets) disponíveis de uma planilha
 * @param {string} spreadsheetId - ID da planilha
 * @returns {Promise<string[]>} - Lista de nomes das abas
 */
async function getAvailableSheets(spreadsheetId) {
    try {
        const auth = new google.auth.GoogleAuth({
            keyFile: process.env.GOOGLE_CREDENTIALS_PATH,
            scopes: ["https://www.googleapis.com/auth/spreadsheets"],
        });
        const authClient = await auth.getClient();
        const sheets = google.sheets({ version: "v4", auth: authClient });

        const response = await sheets.spreadsheets.get({
            spreadsheetId: spreadsheetId,
            fields: 'sheets.properties'
        });

        return response.data.sheets
            .filter(sheet => !sheet.properties.hidden)
            .map(sheet => sheet.properties.title);
    } catch (error) {
        console.error('[GoogleSheets] Erro ao buscar abas da planilha:', error);
        throw new Error('Não foi possível obter a lista de abas da planilha');
    }
}

module.exports = { 
    sendToGoogleSheets, 
    checkUserInSheet, 
    createUserInSheet, 
    queueSheetUpdate, 
    processUpdateQueue, 
    sendLogMessage,
    getColumnLetter,
    getUserRowCached,
    getStartDay,
    buscarUsuario,
    getBrasiliaDay,
    getAvailableSheets
};