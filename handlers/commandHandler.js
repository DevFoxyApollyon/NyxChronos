const { handlePontoCommand } = require('../commands/ponto');
const { handleReabrirCommand } = require('../commands/reabrir');
const { handleTopCommand, handleTopPageCommand } = require('../commands/top');
const { handleHourCommand } = require('../commands/horas');
const { handleJustificativaCommand } = require('../commands/justificativa');
const { handleCancelarCommand } = require('../commands/cancelar');
const { handlePainelCommand, handleInteraction: handlePainelModal } = require('../commands/Painel');
const { handlePlanilhaCommand, handleInteraction: handlePlanilhaModal } = require('../commands/planilha');
const { handleCargosCommand } = require('../commands/cargos');
const { handleAjudarCommand, handleHelpButton } = require('../commands/ajudar');
const { handleReportarCommand, handleCategoriaSelect, handleReportModal } = require('../commands/reportar');
const { handleCartoesCommand } = require('../commands/cartoes');
const { EmbedBuilder } = require('discord.js');

// ID do administrador/suporte do sistema
const ADMIN_SUPPORT_ID = '657014871228940336';

// Sistema de monitoramento de performance
const PERFORMANCE_METRICS = {
  commandTimes: new Map(),
  slowCommands: new Map(),
  thresholds: {
    warning: 3000,    // Aviso para comandos acima de 3 segundos (antes era 1000ms)
    critical: 5000,   // Crítico para comandos acima de 5 segundos (antes era 3000ms)
    verySlowCount: 5  // Número de execuções muito lentas para considerar otimização
  },
  minimalLogging: true // Controla se devemos exibir menos logs 
};

// Limpar métricas antigas a cada hora
setInterval(() => {
  const now = Date.now();
  for (const [cmd, times] of PERFORMANCE_METRICS.commandTimes.entries()) {
    // Manter apenas os últimos 7 dias de métricas
    PERFORMANCE_METRICS.commandTimes.set(cmd, 
      times.filter(t => (now - t.timestamp) < 7 * 24 * 60 * 60 * 1000)
    );
  }
}, 60 * 60 * 1000);

/**
 * Registra métricas de performance de um comando
 * @param {string} commandName - Nome do comando executado
 * @param {number} executionTime - Tempo de execução em ms
 */
function recordCommandPerformance(commandName, executionTime) {
  // Ignorar métricas do comando cancelar pois ele tem seu próprio sistema de medição
  if (commandName === 'cancelar') {
    return;
  }

  if (!PERFORMANCE_METRICS.commandTimes.has(commandName)) {
    PERFORMANCE_METRICS.commandTimes.set(commandName, []);
  }
  
  const cmdTimes = PERFORMANCE_METRICS.commandTimes.get(commandName);
  cmdTimes.push({
    time: executionTime,
    timestamp: Date.now()
  });
  
  // Manter no máximo 100 registros por comando
  if (cmdTimes.length > 100) {
    cmdTimes.shift();
  }
  
  // Verificar se é um comando lento
  if (executionTime > PERFORMANCE_METRICS.thresholds.critical) {
    if (!PERFORMANCE_METRICS.slowCommands.has(commandName)) {
      PERFORMANCE_METRICS.slowCommands.set(commandName, 0);
    }
    
    const slowCount = PERFORMANCE_METRICS.slowCommands.get(commandName) + 1;
    PERFORMANCE_METRICS.slowCommands.set(commandName, slowCount);
    
    if (slowCount >= PERFORMANCE_METRICS.thresholds.verySlowCount) {
      console.warn(`⚠️ PERFORMANCE ALERT: O comando '${commandName}' é consistentemente lento (${slowCount} execuções > ${PERFORMANCE_METRICS.thresholds.critical}ms)`);
    }
  }
  
  // Log baseado no tempo de execução
  if (executionTime > PERFORMANCE_METRICS.thresholds.critical) {
    console.warn(`⚠️ Comando lento: '${commandName}' levou ${executionTime}ms para executar`);
  } else if (executionTime > PERFORMANCE_METRICS.thresholds.warning && !PERFORMANCE_METRICS.minimalLogging) {
    console.log(`ℹ️ Comando demorado: '${commandName}' levou ${executionTime}ms para executar`);
  }
}

// Função local para notificar problemas de performance
async function notifyPerformanceIssue(client, commandName, executionTime, interaction) {
  let mensagemLink = 'Não disponível';
  if (interaction.channel && interaction.id) {
    mensagemLink = `https://discord.com/channels/${interaction.guildId || '@me'}/${interaction.channel.id}/${interaction.id}`;
  }

  const embed = new EmbedBuilder()
    .setColor('#FFA500')
    .setTitle('⚠️ Comando Lento Detectado')
    .setDescription('O sistema detectou um comando que demorou mais do que o esperado para ser executado. Isso pode indicar lentidão ou sobrecarga.\n\n<@' + interaction.user.id + '> executou este comando.')
    .addFields(
      { name: '�� Comando', value: `\`${commandName}\``, inline: true },
      { name: '⏱️ Tempo de Execução', value: `**${executionTime}ms**`, inline: true },
      { name: '👤 Usuário', value: `<@${interaction.user.id}> (${interaction.user.tag})`, inline: false },
      { name: '🌐 Servidor', value: `${interaction.guild?.name || 'Desconhecido'} (${interaction.guildId || 'N/A'})`, inline: false },
      { name: '🕒 Data/Hora', value: `<t:${Math.floor(Date.now()/1000)}:F>`, inline: false },
      { name: '🔗 Canal', value: interaction.channel ? `<#${interaction.channel.id}> (${interaction.channel.id})` : 'N/A', inline: false },
      { name: '🔗 Link da Mensagem', value: mensagemLink !== 'Não disponível' ? `[Clique para ver a mensagem](${mensagemLink})` : 'Não disponível', inline: false }
    )
    .setFooter({
      text: 'Monitoramento de Performance • Toca da Raposa',
      iconURL: client.user.displayAvatarURL()
    })
    .setTimestamp();

  // Sugestão de boas práticas se o comando for recorrente
  if (executionTime > 10000) {
    embed.addFields({
      name: '💡 Dica',
      value: 'Este comando está levando mais de 10 segundos para ser executado. Considere revisar consultas ao banco de dados, chamadas externas ou lógica pesada.'
    });
  }

  try {
    const suporteUser = await client.users.fetch(ADMIN_SUPPORT_ID);
    await suporteUser.send({ embeds: [embed] });
  } catch (e) {
    console.error('Erro ao enviar DM de performance para o suporte:', e);
  }
}

/**
 * Manipula um comando Discord com monitoramento de performance
 */
async function handleCommand(interaction) {
    const commandName = interaction.commandName;
    let startTime;
    
    try {
        if (commandName === 'cancelar') {
            await handleCancelarCommand(interaction);
            return;
        }
        
        startTime = Date.now();
        
        // Processar comandos normalmente
        if (commandName === 'ponto') {
            await handlePontoCommand(interaction);
        } else if (commandName === 'reabrir') {
            await handleReabrirCommand(interaction);
        } else if (commandName === 'top') {
            await handleTopCommand(interaction);
        } else if (commandName === 'horas') {
            await handleHourCommand(interaction);
        } else if (commandName === 'justificativa') {
            await handleJustificativaCommand(interaction);
        } else if (commandName === 'painel') {
            await handlePainelCommand(interaction);
        } else if (commandName === 'planilha') {
            await handlePlanilhaCommand(interaction);
        } else if (commandName === 'cargos') {
            await handleCargosCommand(interaction);
        } else if (commandName === 'ajudar') {
            await handleAjudarCommand(interaction);
        } else if (commandName === 'reportar') {
            await handleReportarCommand(interaction);
        } else if (commandName === 'cartoes') {
            await handleCartoesCommand(interaction);
        } else {
            console.error(`Comando não encontrado: ${commandName}`);
            await interaction.reply({
                content: '❌ Este comando não está disponível no momento.',
                ephemeral: true
            });
        }
    } catch (error) {
        console.error('Erro ao processar o comando:', error);
        
        // Notificar o suporte/admin via DM
        try {
            const adminUser = await interaction.client.users.fetch(ADMIN_SUPPORT_ID);
            if (adminUser) {
                const erroEmbed = new EmbedBuilder()
                  .setColor('#ff0000')
                  .setTitle('❗ Erro crítico detectado no comando!')
                  .addFields(
                    { name: 'Comando', value: commandName, inline: false },
                    { name: 'Servidor', value: `${interaction.guild?.name || 'Desconhecido'} (${interaction.guildId || 'N/A'})`, inline: false },
                    { name: 'Usuário', value: `${interaction.user.tag} (${interaction.user.id})`, inline: false },
                    { name: 'Canal', value: `${interaction.channel?.id || 'N/A'}`, inline: false },
                    { name: 'Erro', value: `${error.message || error}`, inline: false }
                  )
                  .setTimestamp();
                await adminUser.send({ embeds: [erroEmbed] });
            }
        } catch (notifyError) {
            console.error('Erro ao notificar admin:', notifyError);
        }
        
        // Verificamos se é um erro de interação já respondida (comum em comandos como justificativa)
        if (error.code === 'InteractionAlreadyReplied') {
            console.log(`Interação já respondida para o comando ${commandName}, ignorando`);
        } 
        // Verificamos se é um erro de interação expirada
        else if (error.code === 10062) {
            console.log(`Interação expirada para o comando ${commandName}, ignorando`);
        } 
        // Outros tipos de erro
        else if (!interaction.replied && !interaction.deferred) {
            try {
                await interaction.reply({ 
                    content: `Ocorreu um erro ao processar o comando. Por favor, tente novamente.`,
                    ephemeral: true 
                });
            } catch (replyError) {
                console.error('Erro ao responder após falha:', replyError);
            }
        }
    } finally {
        if (commandName !== 'cancelar') {
            const executionTime = Date.now() - startTime;
            recordCommandPerformance(commandName, executionTime);

            if (executionTime > 5000) {
                await notifyPerformanceIssue(interaction.client, commandName, executionTime, interaction);
            }
        }
    }
}

/**
 * Manipula interações de modal com monitoramento de performance
 */
async function handleModalSubmit(interaction) {
    const modalId = interaction.customId;
    const startTime = Date.now();
    
    try {
        // Processar modals normalmente
        if (modalId === 'serverConfigModal') {
            await handlePainelModal(interaction);
        } else if (modalId === 'justificativaModal') {
            const { handleModalSubmit: manipularEnvioModal } = require('../commands/justificativa');
            await manipularEnvioModal(interaction);
        } else if (modalId === 'planilha_alterar_id_modal') {
            await handlePlanilhaModal(interaction);
        } else if (modalId === 'cancelar-modal') {
            // Não precisamos fazer nada aqui, o código em cancelar.js já lida com isso
        } else if (modalId.startsWith('report_modal_')) {
            await handleReportModal(interaction);
        } else if (modalId.startsWith('report_response_')) {
            await handleResponseModal(interaction);
        }
    } catch (error) {
        console.error('Erro ao processar modal:', error);
        
        // Notificar o suporte/admin via DM
        try {
            const adminUser = await interaction.client.users.fetch(ADMIN_SUPPORT_ID);
            if (adminUser) {
                const erroEmbed = new EmbedBuilder()
                  .setColor('#ff0000')
                  .setTitle('❗ Erro crítico detectado no modal!')
                  .addFields(
                    { name: 'Modal', value: modalId, inline: false },
                    { name: 'Servidor', value: `${interaction.guild?.name || 'Desconhecido'} (${interaction.guildId || 'N/A'})`, inline: false },
                    { name: 'Usuário', value: `${interaction.user.tag} (${interaction.user.id})`, inline: false },
                    { name: 'Canal', value: `${interaction.channel?.id || 'N/A'}`, inline: false },
                    { name: 'Erro', value: `${error.message || error}`, inline: false }
                  )
                  .setTimestamp();
                await adminUser.send({ embeds: [erroEmbed] });
            }
        } catch (notifyError) {
            console.error('Erro ao notificar admin:', notifyError);
        }
        
        // Não tentamos responder se for erro de interação já respondida
        if (error.code === 'InteractionAlreadyReplied' || error.code === 10062) {
            console.log(`Interação já respondida/expirada para o modal ${modalId}, ignorando`);
        } 
        else if (!interaction.replied && !interaction.deferred) {
            try {
                await interaction.reply({
                    content: 'Erro ao processar o formulário. Por favor, tente novamente.',
                    ephemeral: true
                });
            } catch (replyError) {
                console.error('Erro ao responder após falha do modal:', replyError);
            }
        }
    } finally {
        // Registra o tempo de execução
        const executionTime = Date.now() - startTime;
        recordCommandPerformance(`modal:${modalId}`, executionTime);
    }
}

/**
 * Manipula interações de botão
 */
async function handleButtonInteraction(interaction, client) {
    try {
        const customId = interaction.customId;

        // Verificar se é um botão do comando /ajudar
        if (customId.startsWith('help_')) {
            await handleHelpButton(interaction);
            return;
        }

        // Verificar se é um botão do ranking
        if (customId.startsWith('ranking_')) {
            // Ignorar estes botões pois eles são tratados pelo coletor no topHandler
            return;
        }

        // Para todos os outros botões, verificar se está em um servidor
        if (!interaction.guild) {
            return interaction.reply({ 
                content: 'Este botão só pode ser usado em um servidor.', 
                ephemeral: true 
            });
        }

        // Encaminhar para o handler de botões original
        const { handleButtonInteraction: originalButtonHandler } = require('./buttonHandler');
        await originalButtonHandler(interaction, client);
    } catch (error) {
        console.error('Erro ao processar interação de botão:', error);
        
        if (error.code === 'InteractionAlreadyReplied' || error.code === 10062) {
            console.log(`Interação já respondida/expirada para botão, ignorando`);
        } 
        else if (!interaction.replied && !interaction.deferred) {
            try {
                await interaction.reply({
                    content: 'Erro ao processar a interação. Por favor, tente novamente.',
                    ephemeral: true
                });
            } catch (replyError) {
                console.error('Erro ao responder após falha do botão:', replyError);
            }
        }
    }
}

async function handleSelectMenu(interaction) {
    const menuId = interaction.customId;
    
    if (menuId === 'categoria_reporte') {
        await handleCategoriaSelect(interaction);
    }
}

// Exportar funções e métricas
module.exports = { 
    handleCommand, 
    handleModalSubmit,
    handleButtonInteraction,
    handleSelectMenu,
    getPerformanceMetrics: () => PERFORMANCE_METRICS
};