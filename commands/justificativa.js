const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { google } = require('googleapis');
const fs = require('fs');
const moment = require('moment');
require('moment/locale/pt-br');

const sheets = google.sheets('v4');

// Configuração de logging - NOVA variável para controle de logs
const LOGGING = {
  verbose: false, // Definido como false para reduzir logs
  debug: false,   // Logs de debug 
  errors: true    // Manter logs de erros
};

// Cache de usuários com timestamp de última atualização
const cacheUsuarios = new Map();
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 horas em milissegundos

// Adicionar cache para informações da planilha
const cachePlanilha = new Map();
const CACHE_PLANILHA_DURATION = 1 * 60 * 60 * 1000; // 1 hora

// Cache para credenciais de autenticação
const cacheAuth = new Map();
const CACHE_AUTH_DURATION = 30 * 60 * 1000; // 30 minutos

// Fila de operações em lote para planilhas
const operacoesPendentes = new Map();
const INTERVALO_PROCESSAMENTO = 5000; // 5 segundos

// Função para limpar cache antigo
function limparCacheAntigo() {
  const agora = Date.now();
  
  // Limpa cache de usuários
  for (const [key, value] of cacheUsuarios.entries()) {
    if (agora - value.timestamp > CACHE_DURATION) {
      cacheUsuarios.delete(key);
    }
  }
  
  // Limpa cache de planilhas
  for (const [key, value] of cachePlanilha.entries()) {
    if (agora - value.timestamp > CACHE_PLANILHA_DURATION) {
      cachePlanilha.delete(key);
    }
  }
  
  // Limpa cache de autenticação
  for (const [key, value] of cacheAuth.entries()) {
    if (agora - value.timestamp > CACHE_AUTH_DURATION) {
      cacheAuth.delete(key);
    }
  }
}

// Executa a limpeza do cache a cada hora
setInterval(limparCacheAntigo, 60 * 60 * 1000);

// Processa operações pendentes em lote
function iniciarProcessamentoBatch() {
  setInterval(async () => {
    try {
      for (const [spreadsheetId, operacoes] of operacoesPendentes.entries()) {
        if (operacoes.length === 0) continue;
        
        if (LOGGING.verbose) console.log(`Processando lote de ${operacoes.length} operações para planilha ${spreadsheetId}`);
        
        const clienteAuth = operacoes[0].auth;
        const requests = operacoes.map(op => op.request);
        
        try {
          await sheets.spreadsheets.batchUpdate({
            auth: clienteAuth,
            spreadsheetId: spreadsheetId,
            resource: { requests }
          });
          
          // Notifica os callbacks de sucesso
          operacoes.forEach(op => {
            if (op.onSuccess) op.onSuccess();
          });
          
        } catch (erro) {
          if (LOGGING.errors) console.error(`Erro ao processar lote para planilha ${spreadsheetId}:`, erro);
          
          // Notifica os callbacks de erro
          operacoes.forEach(op => {
            if (op.onError) op.onError(erro);
          });
        }
        
        // Limpa a fila de operações desta planilha
        operacoesPendentes.set(spreadsheetId, []);
      }
    } catch (erro) {
      if (LOGGING.errors) console.error('Erro no processamento em lote:', erro);
    }
  }, INTERVALO_PROCESSAMENTO);
}

// Inicia o processamento em lote ao carregar o módulo
iniciarProcessamentoBatch();

// Adiciona uma operação à fila de processamento em lote
function adicionarOperacaoBatch(spreadsheetId, auth, request, onSuccess, onError) {
  if (!operacoesPendentes.has(spreadsheetId)) {
    operacoesPendentes.set(spreadsheetId, []);
  }
  
  operacoesPendentes.get(spreadsheetId).push({
    auth,
    request,
    onSuccess,
    onError
  });
  
  if (LOGGING.verbose) console.log(`Operação adicionada ao lote para planilha ${spreadsheetId}. Total: ${operacoesPendentes.get(spreadsheetId).length}`);
}

// ID do suporte técnico
const SUPPORT_ID = '657014871228940336';

// Importar o modelo Servidor
const { Servidor } = require('../models/Servidor');

/**
 * Função para acessar a planilha Google Sheets
 * Configura e retorna o cliente de autenticação
 */
async function acessarPlanilha(servidor) {
  try {
    if (!servidor || !servidor.spreadsheetId || !servidor.sheetName) {
      throw new Error('Configurações do servidor inválidas');
    }

    // Verifica se já temos autenticação em cache
    const cacheKey = `auth-${servidor.spreadsheetId}`;
    const cachedAuth = cacheAuth.get(cacheKey);
    
    if (cachedAuth && (Date.now() - cachedAuth.timestamp < CACHE_AUTH_DURATION)) {
      if (LOGGING.verbose) console.log('Usando autenticação em cache');
      return cachedAuth.client;
    }

    const credentialsPath = process.env.GOOGLE_CREDENTIALS_PATH || './credentials.json';
    
    if (!fs.existsSync(credentialsPath)) {
      throw new Error(`Arquivo de credenciais não encontrado em: ${credentialsPath}`);
    }

    const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
    
    if (!credentials.client_email || !credentials.private_key) {
      throw new Error('Credenciais do Google inválidas');
    }

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const client = await auth.getClient();
    
    // Testa o acesso à planilha
    await sheets.spreadsheets.get({
      auth: client,
      spreadsheetId: servidor.spreadsheetId,
    });
    
    // Armazena no cache
    cacheAuth.set(cacheKey, {
      client,
      timestamp: Date.now()
    });

    return client;
  } catch (erro) {
    if (LOGGING.errors) console.error('Erro ao acessar planilha:', erro);
    throw new Error(`Erro ao acessar planilha: ${erro.message}`);
  }
}

/**
 * Lista os IDs de todas as abas visíveis da planilha
 */
async function listarIdsAbasVisiveis(clienteAuth, servidor) {
  try {
    const res = await sheets.spreadsheets.get({
      auth: clienteAuth,
      spreadsheetId: servidor.spreadsheetId,
    });

    if (LOGGING.debug) {
    console.log('Abas visíveis e seus IDs:');
    res.data.sheets.forEach(aba => {
      if (!aba.properties.hidden) {
        console.log(`Nome: ${aba.properties.title}, ID: ${aba.properties.sheetId}`);
      }
    });
    }
  } catch (erro) {
    if (LOGGING.errors) console.error('Erro ao listar abas visíveis da planilha:', erro);
  }
}

/**
 * Obtém o ID da aba pelo nome
 */
async function obterIdAba(clienteAuth, servidor, nomeAba) {
  try {
    // Verifica cache
    const cacheKey = `sheetId-${servidor.spreadsheetId}-${nomeAba}`;
    const cachedData = cachePlanilha.get(cacheKey);
    
    if (cachedData && (Date.now() - cachedData.timestamp < CACHE_PLANILHA_DURATION)) {
      if (LOGGING.verbose) console.log(`ID da aba "${nomeAba}" encontrado no cache`);
      return cachedData.id;
    }
    
    const res = await sheets.spreadsheets.get({
      auth: clienteAuth,
      spreadsheetId: servidor.spreadsheetId,
    });

    const aba = res.data.sheets.find(aba => aba.properties.title === nomeAba);
    if (aba) {
      // Armazena no cache
      cachePlanilha.set(cacheKey, {
        id: aba.properties.sheetId,
        timestamp: Date.now()
      });
      
      return aba.properties.sheetId;
    } else {
      throw new Error('Aba não encontrada');
    }
  } catch (erro) {
    console.error('Erro ao obter o ID da aba:', erro);
    throw new Error('Erro ao obter o ID da aba');
  }
}

/**
 * Encontra a linha na planilha pelo ID do usuário
 * Usa cache para melhorar performance em múltiplas chamadas
 */
async function encontrarLinhaPorIdUsuario(clienteAuth, servidor, idUsuario) {
  try {
    // Verifica se o usuário está no cache e se o cache ainda é válido
    const cacheKey = `${servidor.spreadsheetId}-${servidor.sheetName}-${idUsuario}`;
    const cacheData = cacheUsuarios.get(cacheKey);
    
    if (cacheData && (Date.now() - cacheData.timestamp) < CACHE_DURATION) {
      if (LOGGING.verbose) console.log(`Usuário encontrado no cache: ${idUsuario}`);
      return cacheData.linha;
    }

    if (LOGGING.verbose) {
    console.log('Procurando usuário na planilha:', {
      idUsuario,
      spreadsheetId: servidor.spreadsheetId,
      sheetName: servidor.sheetName
    });
    }

    // Primeiro verifica se a planilha existe e é acessível
    try {
      await sheets.spreadsheets.get({
        auth: clienteAuth,
        spreadsheetId: servidor.spreadsheetId,
      });
    } catch (erro) {
      if (LOGGING.errors) console.error('Erro ao acessar planilha:', erro);
      throw new Error('Não foi possível acessar a planilha. Verifique se o ID está correto e se a planilha existe.');
    }

    // Verifica se a aba existe
    try {
      const res = await sheets.spreadsheets.get({
        auth: clienteAuth,
        spreadsheetId: servidor.spreadsheetId,
        ranges: [`${servidor.sheetName}!A1`],
        includeGridData: false
      });

      const sheetExists = res.data.sheets.some(sheet => sheet.properties.title === servidor.sheetName);
      if (!sheetExists) {
        throw new Error(`A aba "${servidor.sheetName}" não foi encontrada na planilha.`);
      }
    } catch (erro) {
      if (LOGGING.errors) console.error('Erro ao verificar aba:', erro);
      throw new Error(`Erro ao verificar a aba "${servidor.sheetName}": ${erro.message}`);
    }

    // Busca os valores da coluna A
    const res = await sheets.spreadsheets.values.get({
      auth: clienteAuth,
      spreadsheetId: servidor.spreadsheetId,
      range: `${servidor.sheetName}!A:A`,
    });

    // Verifica se a resposta contém dados válidos
    if (!res.data) {
      if (LOGGING.errors) console.error('Resposta da API não contém dados:', res);
      throw new Error('Resposta da API inválida');
    }

    // Se não houver valores, a planilha está vazia
    if (!res.data.values || res.data.values.length === 0) {
      if (LOGGING.verbose) console.log('Planilha está vazia');
      return null;
    }

    const linhas = res.data.values;
    if (LOGGING.verbose) console.log(`Total de linhas encontradas: ${linhas.length}`);

    // Procura o usuário nas linhas
    for (let i = 0; i < linhas.length; i++) {
      const linha = linhas[i];
      if (linha && linha[0] === idUsuario) {
        if (LOGGING.verbose) console.log(`Usuário encontrado na linha ${i + 1}`);
        // Atualiza o cache
        cacheUsuarios.set(cacheKey, {
          linha: i + 1,
          timestamp: Date.now()
        });
        return i + 1;
      }
    }

    if (LOGGING.verbose) console.log('Usuário não encontrado na planilha');
    return null;
  } catch (erro) {
    if (LOGGING.errors) {
    console.error('Erro ao procurar usuário na planilha:', erro);
    console.error('Stack trace:', erro.stack);
    }
    throw new Error(`Erro ao procurar usuário na planilha: ${erro.message}`);
  }
}

/**
 * Converte índice numérico da coluna em letra (ex: 1 = A, 27 = AA)
 */
function obterLetraColuna(indiceColuna) {
  let letra = '';
  while (indiceColuna > 0) {
    let resto = (indiceColuna - 1) % 26;
    letra = String.fromCharCode(65 + resto) + letra;
    indiceColuna = Math.floor((indiceColuna - 1) / 26);
  }
  return letra;
}

/**
 * Função para enviar log para o canal do Discord
 */
async function enviarLogParaCanal(client, embed, guildId) {
  try {
    if (LOGGING.verbose) console.log('Iniciando envio de log para o canal. GuildId:', guildId);
    
    const servidor = await Servidor.findOne({ guildId });
    if (!servidor || !servidor.channelId) {
      if (LOGGING.errors) {
      console.error('Configuração do canal de log não encontrada para o servidor:', guildId);
      }
      return;
    }
    
    if (LOGGING.verbose) {
    console.log('Canal de log configurado:', servidor.channelId);
    console.log('Buscando canal...');
    }
    
    const canal = await client.channels.fetch(servidor.channelId);
    if (canal) {
      if (LOGGING.verbose) console.log('Canal encontrado, enviando embed...');
      await canal.send({ embeds: [embed] });
      if (LOGGING.verbose) console.log('Log enviado com sucesso!');
    } else if (LOGGING.errors) {
      console.error('Canal de log não encontrado. ID:', servidor.channelId);
    }
  } catch (erro) {
    if (LOGGING.errors) {
    console.error('Erro ao enviar log para o canal:', erro);
    }
  }
}

/**
 * Registra no console o uso do comando de justificativa e envia o log para o canal do Discord
 */
async function registrarUso(client, nomeUsuario, idUsuario, justificativa, aba, celula, mensagemErro = '', mensagemUrl = '', guildId = null) {
  if (LOGGING.verbose) {
  console.log('Iniciando registro de uso do comando de justificativa');
  console.log('Usuário:', nomeUsuario, 'ID:', idUsuario);
  console.log('Aba:', aba, 'Célula:', celula);
  console.log('Mensagem de erro:', mensagemErro || 'Nenhum erro');
  console.log('URL da mensagem:', mensagemUrl || 'Nenhuma URL');
  console.log('GuildId:', guildId || 'Não fornecido');
  }
  
  const dataHora = moment().format('YYYY-MM-DD HH:mm:ss');
  const registroLog = `${dataHora} - Usuário: ${nomeUsuario} (ID: ${idUsuario}) - Justificativa: ${justificativa} - Aba: ${aba} - Célula: ${celula} - Erro: ${mensagemErro}`;
  if (LOGGING.verbose) console.log('Registro de log:', registroLog);

  // Limita a justificativa a 500 caracteres
  if (justificativa.length > 500) {
    if (LOGGING.verbose) console.log('Justificativa limitada a 500 caracteres');
    justificativa = justificativa.substring(0, 500) + '...';
  }

  // Cria a embed de log com formato melhorado
  if (LOGGING.verbose) console.log('Criando embed para o log...');
  const embed = new EmbedBuilder()
    .setTitle('📋 Log de Justificativa')
    .setColor(0x2B65EC)
    .setDescription('Um novo registro de justificativa foi processado pelo sistema.')
    .addFields(
      { 
        name: '👤 Usuário',
        value: `<@${idUsuario}>`,
        inline: true 
      },
      { 
        name: '📄 Aba',
        value: aba,
        inline: true 
      },
      { 
        name: '🎯 Célula',
        value: celula,
        inline: true 
      },
      { 
        name: '\u200B',
        value: '▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬',
        inline: false 
      },
      { 
        name: '📝 Justificativa Registrada',
        value: justificativa,
        inline: false 
      },
      { 
        name: '\u200B',
        value: '▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬',
        inline: false 
      },
      { 
        name: '🔧 Suporte',
        value: 'Em caso de problemas, contate:\n<@657014871228940336>',
        inline: false 
      }
    )
    .setThumbnail(client.user.displayAvatarURL({ dynamic: true, size: 256 }))
    .setFooter({ 
      text: 'Sistema de Justificativas • Log do Sistema',
      iconURL: client.user.displayAvatarURL()
    })
    .setTimestamp();

  // Envia o log para o canal do Discord
  if (guildId) {
    if (LOGGING.verbose) console.log('Enviando log para o canal...');
    await enviarLogParaCanal(client, embed, guildId);
    if (LOGGING.verbose) console.log('Registro de uso concluído!');
  } else if (LOGGING.verbose) {
    console.log('GuildId não fornecido, não é possível enviar log para o canal');
  }
}

/**
 * Manipula o comando de justificativa e exibe o modal
 */
async function manipularComandoJustificativa(interaction) {
  try {
    // NÃO vamos usar deferReply aqui, pois precisamos mostrar o modal
    // e não podemos fazer isso após responder à interação
    
    // Verificar se a interação ainda é válida
    if (interaction.replied || interaction.deferred) {
      if (LOGGING.errors) console.error('Interação já respondida ou diferida. Interação possivelmente expirada.');
      return;
    }
    
    const servidor = await Servidor.findOne({ guildId: interaction.guild.id });
    if (!servidor) {
      return interaction.reply({ 
        embeds: [new EmbedBuilder()
          .setTitle('⚠️ Configuração não encontrada')
          .setDescription('Use o comando `/painel` para configurar o servidor.')
          .setColor(0xFFA500)
          .setFooter({ text: 'Sistema de Justificativas', iconURL: interaction.guild.iconURL() })],
        ephemeral: true
      });
    }

    if (!servidor.spreadsheetId || !servidor.sheetName || !servidor.cargoPermitido) {
      return interaction.reply({ 
        embeds: [new EmbedBuilder()
          .setTitle('⚠️ Configuração incompleta')
          .setDescription('Use o comando `/painel` para configurar todos os campos necessários.')
          .setColor(0xFFA500)
          .setFooter({ text: 'Sistema de Justificativas', iconURL: interaction.guild.iconURL() })],
        ephemeral: true
      });
    }

    if (!interaction.member.roles.cache.has(servidor.cargoPermitido)) {
      return interaction.reply({ 
        embeds: [new EmbedBuilder()
          .setTitle('⚠️ Permissão negada')
          .setDescription('Você não tem permissão para usar este comando.')
          .setColor(0xFFA500)
          .setFooter({ text: 'Sistema de Justificativas', iconURL: interaction.guild.iconURL() })],
        ephemeral: true
      });
    }

    // Usamos Promise.all para fazer chamadas em paralelo e acelerar o processo
    let clienteAuth;
    try {
      clienteAuth = await acessarPlanilha(servidor);
    } catch (error) {
      if (LOGGING.errors) console.error('Erro ao acessar planilha:', error);
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setTitle('❌ Erro ao acessar planilha')
          .setDescription('Não foi possível acessar a planilha. Verifique as configurações e tente novamente.')
          .setColor(0xFF0000)
          .setFooter({ text: 'Sistema de Justificativas', iconURL: interaction.guild.iconURL() })],
        ephemeral: true
      });
    }
    
    const linha = await encontrarLinhaPorIdUsuario(clienteAuth, servidor, interaction.user.id);
    if (!linha) {
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setTitle('⚠️ Usuário não encontrado')
          .setDescription('Use o comando `/ponto` primeiro para se cadastrar.')
          .setColor(0xFFA500)
          .setFooter({ text: 'Sistema de Justificativas', iconURL: interaction.guild.iconURL() })],
        ephemeral: true
      });
    }

    // Criar modal para justificativa
    const modal = new ModalBuilder()
      .setCustomId('justificativaModal')
      .setTitle('Justificativa');

    const campoJustificativa = new TextInputBuilder()
      .setCustomId('justificativaInput')
      .setLabel('Digite sua justificativa')
      .setPlaceholder('Explique o motivo da sua ausência...')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(500);

    const linhaAcao = new ActionRowBuilder().addComponents(campoJustificativa);
    modal.addComponents(linhaAcao);

    // Verificar se a interação ainda é válida antes de mostrar o modal
    if (interaction.replied || interaction.deferred) {
      if (LOGGING.errors) console.error('Interação já respondida ou diferida antes de mostrar o modal.');
      return;
    }

    // Mostrar modal ANTES de qualquer resposta
    try {
      await interaction.showModal(modal);
    } catch (modalError) {
      if (modalError.code === 10062) { // Unknown interaction
        if (LOGGING.errors) console.error('A interação expirou antes de mostrar o modal.');
        return;
      }
      throw modalError; // Repassar outros erros
    }
    
  } catch (error) {
    if (LOGGING.errors) console.error('Erro ao manipular comando de justificativa:', error);
    
    // Tratamento especial para erro de interação desconhecida (expirada)
    if (error.code === 10062) {
      if (LOGGING.errors) console.log('Interação expirada para o comando justificativa, ignorando');
      return;
    }
    
    // Só tentamos responder se ainda não respondemos antes e a interação ainda é válida
    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ 
          embeds: [new EmbedBuilder()
            .setTitle('❌ Erro ao processar comando')
            .setDescription(`Ocorreu um erro ao processar seu comando. Se o problema persistir, procure o suporte <@${SUPPORT_ID}>.`)
            .setColor(0xFF0000)
            .setFooter({ text: 'Sistema de Justificativas', iconURL: interaction.guild.iconURL() })],
          ephemeral: true
        });
      }
    } catch (replyError) {
      if (replyError.code === 10062) {
        if (LOGGING.errors) console.log('Interação expirada para o comando justificativa, ignorando');
      } else {
        if (LOGGING.errors) console.error('Erro ao responder após falha:', replyError);
      }
    }
  }
}

/**
 * Manipula o envio do modal de justificativa
 */
async function manipularEnvioModal(interaction) {
  if (interaction.customId === 'justificativaModal') {
    try {
      // Usando deferReply com ephemeral para que a resposta inicial seja privada
      await interaction.deferReply({ ephemeral: true });
      
      const justificativa = interaction.fields.getTextInputValue('justificativaInput');
      // Inicializar variável 'celula' para evitar erro de referência
      let celula = 'N/A';
      
      // Verificar se a justificativa está vazia
      if (!justificativa || justificativa.trim() === '') {
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xFF0000)
              .setTitle('❌ Erro')
              .setDescription('A justificativa não pode estar vazia.')
              .setFooter({ text: 'Sistema de Justificativas', iconURL: interaction.guild.iconURL() })
          ],
          ephemeral: true
        });
      }

      // Verificar se o servidor está configurado
      const servidor = await Servidor.findOne({ guildId: interaction.guild.id });
      if (!servidor || !servidor.spreadsheetId || !servidor.sheetName) {
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xFF0000)
              .setTitle('❌ Erro')
              .setDescription('Este servidor não está configurado corretamente. Peça a um administrador para usar o comando `/painel` para configurar.')
              .setFooter({ text: 'Sistema de Justificativas', iconURL: interaction.guild.iconURL() })
          ],
          ephemeral: true
        });
      }

      try {
        // Processar a planilha em um bloco separado para capturar melhor os erros
        const clienteAuth = await acessarPlanilha(servidor);
        if (LOGGING.verbose) console.log('Iniciando acesso à planilha...');
        
        // Fazer buscas em paralelo para melhorar desempenho
        const [idAba, linha] = await Promise.all([
          obterIdAba(clienteAuth, servidor, servidor.sheetName),
          encontrarLinhaPorIdUsuario(clienteAuth, servidor, interaction.user.id)
        ]);
        
        if (!linha) {
          return interaction.editReply({
            embeds: [
              new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle('❌ Erro')
                .setDescription('Seu ID de usuário não foi encontrado na planilha. Entre em contato com um administrador.')
                .setFooter({ text: 'Sistema de Justificativas', iconURL: interaction.guild.iconURL() })
            ],
            ephemeral: true
          });
        }
        
        // Lógica para obter a data atual
        const dataAtual = new Date();
        const dia = dataAtual.getDate();
        const hora = moment().format('HH:mm:ss');
        
        // Mapear índice da coluna para a letra correspondente
        const indiceColuna = dia + 5; // Ajustado para começar da coluna F (índice 5)
        const letraColuna = obterLetraColuna(indiceColuna);
        celula = `${letraColuna}${linha}`;
        
        // Obter valor atual da célula
        const resValorAtual = await sheets.spreadsheets.values.get({
          auth: clienteAuth,
          spreadsheetId: servidor.spreadsheetId,
          range: `${servidor.sheetName}!${celula}`,
        });
        
        // Simplificamos a verificação do valor atual
        let valorAtual = '';
        let contemJustificativa = false;
        if (resValorAtual.data && resValorAtual.data.values && resValorAtual.data.values.length > 0 && resValorAtual.data.values[0].length > 0) {
          valorAtual = resValorAtual.data.values[0][0];
          contemJustificativa = valorAtual === 'J';
        }
        
        // Obter a nota atual, se existir
        let notaAtual = '';
        if (contemJustificativa) {
          const respostaCelula = await sheets.spreadsheets.get({
            auth: clienteAuth,
            spreadsheetId: servidor.spreadsheetId,
            ranges: [`${servidor.sheetName}!${celula}`],
            includeGridData: true,
          });
          
          notaAtual = respostaCelula.data.sheets[0]?.data[0]?.rowData[0]?.values[0]?.note || '';
        }
        
        // Cria o objeto de atualização de célula
        const updateRequest = {
          updateCells: {
            range: {
              sheetId: idAba,
              startRowIndex: linha - 1,
              endRowIndex: linha,
              startColumnIndex: indiceColuna - 1,
              endColumnIndex: indiceColuna,
            },
            rows: [
              {
                values: [
                  {
                    userEnteredValue: { stringValue: "J" },
                    note: `Nyx: [${hora}] ${justificativa}\n\n--- Justificativa anterior ---\n${notaAtual}`,
                  },
                ],
              },
            ],
            fields: 'userEnteredValue,note',
          },
        };
        
        // Variáveis para rastrear o estado da atualização
        let atualizacaoConcluida = false;
        let erroAtualizacao = null;
        
        // Adiciona a operação à fila de processamento em lote
        adicionarOperacaoBatch(
          servidor.spreadsheetId,
          clienteAuth,
          updateRequest,
          () => { atualizacaoConcluida = true; },
          (erro) => { erroAtualizacao = erro; }
        );
        
        // Capturar a mensagem enviada para usar sua URL no botão do log
        let mensagemEnviada;
        
        // Criar embed do cartão de justificativa (será visível para todos no canal)
        const embedCartao = new EmbedBuilder()
          .setColor(0x2ecc71) // Verde para sucesso
          .setTitle('📝 Nova Justificativa')
          .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
          .addFields(
            { name: '👤 Usuário', value: `<@${interaction.user.id}>`, inline: true },
            { name: '📅 Data', value: moment().format('DD/MM/YYYY HH:mm'), inline: true },
            { name: '📄 Aba', value: servidor.sheetName, inline: true },
            { name: '\u200B', value: '━━━━━━━━━━━━━━━━━━━━━━━', inline: false },
            { name: '✏️ Motivo da Justificativa', value: justificativa, inline: false },
            { name: '\u200B', value: '━━━━━━━━━━━━━━━━━━━━━━━', inline: false },
            { name: '📌 Observações', value: '• Justificativa registrada com sucesso!\n• Será registrado "J" na planilha\n• A justificativa será anexada à célula', inline: false }
          )
          .setFooter({ text: 'Sistema de Justificativas • Desenvolvido por Toca da Raposa', iconURL: interaction.guild.iconURL() })
          .setTimestamp();

        // Mensagem diferente se for uma justificativa adicional
        const mensagem = contemJustificativa 
          ? '✅ Nova justificativa registrada! Como você já tinha uma justificativa hoje, mantivemos um histórico de ambas.'
          : '✅ Sua justificativa foi registrada com sucesso!';

        // Envia uma mensagem privada para o usuário confirmando o registro
        await interaction.editReply({ 
          content: mensagem,
          ephemeral: true 
        });
        
        // Envia a embed do cartão de justificativa visível para todos no canal (sem botões aqui)
        mensagemEnviada = await interaction.channel.send({
          embeds: [embedCartao]
        });
        
        // Registro e log de uso - enviado para o canal configurado
        try {
          // Criar uma embed de log melhorada
          const logEmbed = new EmbedBuilder()
            .setTitle('📋 Log de Justificativa')
            .setColor(0x3498db) // Azul para log
            .setDescription('Um novo registro de justificativa foi processado pelo sistema.')
            .addFields(
              { name: '👤 Usuário', value: `<@${interaction.user.id}>`, inline: true },
              { name: '📄 Aba', value: servidor.sheetName, inline: true },
              { name: '🎯 Célula', value: celula, inline: true },
              { name: '\u200B', value: '━━━━━━━━━━━━━━━━━━━━━━━', inline: false },
              { name: '📝 Justificativa Registrada', value: justificativa, inline: false },
              { name: '\u200B', value: '━━━━━━━━━━━━━━━━━━━━━━━', inline: false },
              { name: '🔧 Suporte', value: 'Em caso de problemas, contate: <@657014871228940336>', inline: false }
            )
            .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true, size: 256 }))
            .setFooter({ text: 'Sistema de Justificativas', iconURL: interaction.guild.iconURL() })
            .setTimestamp();
          
          // URL correta da mensagem enviada
          const mensagemUrl = mensagemEnviada ? mensagemEnviada.url : `https://discord.com/channels/${interaction.guild.id}/${interaction.channel.id}`;
          
          // Criar linha de botões para o log - planilha e mensagem lado a lado
          const botoesLog = new ActionRowBuilder()
            .addComponents(
              new ButtonBuilder()
                .setLabel('Acessar Planilha')
                .setStyle(ButtonStyle.Link)
                .setURL(`https://docs.google.com/spreadsheets/d/${servidor.spreadsheetId}`)
                .setEmoji('📊'),
              new ButtonBuilder()
                .setLabel('Ir para Mensagem')
                .setStyle(ButtonStyle.Link)
                .setURL(mensagemUrl)
                .setEmoji('💬')
            );
          
          // Enviar diretamente para o canal do servidor configurado
          if (servidor.channelId) {
            try {
              const canal = await interaction.client.channels.fetch(servidor.channelId);
              if (canal) {
                await canal.send({ 
                  embeds: [logEmbed],
                  components: [botoesLog]
                });
                if (LOGGING.verbose) console.log(`Log enviado para o canal ${servidor.channelId}`);
              } else if (LOGGING.errors) {
                console.error('Canal de log não encontrado. ID:', servidor.channelId);
              }
            } catch (canalError) {
              if (LOGGING.errors) console.error('Erro ao enviar para o canal de log:', canalError);
            }
          }
          
          // Registrar uso no console para debug
          if (LOGGING.debug) {
            console.log(`Justificativa registrada: ${interaction.user.username} (${interaction.user.id}) - Célula: ${celula}`);
          }
          
        } catch (logError) {
          if (LOGGING.errors) console.error('Erro ao registrar uso (não crítico):', logError);
        }
        
        // Verifica se houve erro na atualização
        if (erroAtualizacao) {
          throw erroAtualizacao;
        }
      } catch (erro) {
        if (LOGGING.errors) console.error('Erro ao atualizar a planilha:', erro);
        
        await interaction.editReply({ 
          content: '❌ Houve um erro ao registrar sua justificativa. Tente novamente.',
          ephemeral: true
        });
        
        // Registro de erro não crítico
        try {
          if (LOGGING.errors) {
            await registrarUso(
              interaction.client, 
              interaction.user.username, 
              interaction.user.id, 
              justificativa, 
              servidor?.sheetName || 'N/A', 
              celula, 
              erro.message, 
              '', 
              interaction.guild.id
            );
          }
        } catch (logError) {
          if (LOGGING.errors) console.error('Erro ao registrar uso após falha (não crítico):', logError);
        }
      }
    } catch (error) {
      if (LOGGING.errors) console.error('Erro ao manipular envio do modal:', error);
      
      try {
        // Verificar se já respondeu para evitar erro de resposta dupla
        if (interaction.deferred) {
          await interaction.editReply({ 
            embeds: [new EmbedBuilder()
              .setTitle('❌ Erro ao processar justificativa')
              .setDescription(`Ocorreu um erro ao processar sua justificativa. Se o problema persistir, procure o suporte <@${SUPPORT_ID}>.`)
              .setColor(0xFF0000)
              .setFooter({ text: 'Sistema de Justificativas', iconURL: interaction.guild.iconURL() })],
            ephemeral: true
          });
        } else if (!interaction.replied) {
          await interaction.reply({ 
            embeds: [new EmbedBuilder()
              .setTitle('❌ Erro ao processar justificativa')
              .setDescription(`Ocorreu um erro ao processar sua justificativa. Se o problema persistir, procure o suporte <@${SUPPORT_ID}>.`)
              .setColor(0xFF0000)
              .setFooter({ text: 'Sistema de Justificativas', iconURL: interaction.guild.iconURL() })],
            ephemeral: true
          });
        }
      } catch (replyError) {
        if (LOGGING.errors) console.error('Erro ao responder após falha:', replyError);
      }
    }
  }
}

module.exports = { 
  handleJustificativaCommand: manipularComandoJustificativa, 
  handleModalSubmit: manipularEnvioModal 
};