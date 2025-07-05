const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder } = require('discord.js');
const { Servidor } = require('../models/Servidor');

// Configuração do comando slash
const commandData = new SlashCommandBuilder()
    .setName('ajudar')
    .setDescription('Mostra informações sobre os comandos disponíveis')
    .setDMPermission(false);

const PAGES = {
  main: {
    title: '📚 Central de Ajuda',
    description: 'Bem-vindo ao menu de ajuda! Aqui você encontrará informações sobre todos os comandos disponíveis.\n\nSelecione uma opção abaixo para saber mais:',
    fields: [
      {
        name: '📝 Comandos Principais',
        value: '• `/ponto` - Inicia um novo cartão de ponto\n' +
               '• `/horas` - Mostra suas horas acumuladas\n' +
               '• `/top` - Mostra o ranking de horas\n' +
               '• `/justificativa` - Justifica suas horas (substitui as horas por "J")\n' +
               '• `/cartoes` - Visualiza seus cartões de ponto\n' +
               '• `/cancelar` - Cancela um cartão de ponto (apenas administradores)\n' +
               '• `/reportar` - Reporta um problema ao suporte (apenas para casos necessários)'
      },
      {
        name: '⚙️ Comandos Administrativos',
        value: '• `/cargos` - Gerencia cargos do servidor\n' +
               '• `/planilha` - Configura a planilha\n' +
               '• `/painel` - Exibe o painel de controle'
      }
    ],
    color: '#0099ff',
    footer: 'Selecione uma opção abaixo para saber mais'
  },
  tutorial: {
    title: '📖 Tutorial do Sistema',
    description: 'Aprenda a usar o sistema de ponto passo a passo:',
    fields: [
      {
        name: '📝 Como Iniciar',
        value: `
        1. Use **/ponto** para começar um novo cartão de ponto
        2. O bot criará uma mensagem com seu cartão de ponto
        3. Seu tempo começará a ser contabilizado automaticamente
        4. Use **/cartoes** para visualizar todos os seus cartões de ponto
        `
      },
      {
        name: '⏸️ Pausando e Retomando',
        value: `
        1. Use o botão **⏸️ Pausar** quando precisar fazer uma pausa
        2. Use o botão **🔄 Voltar** para retomar o cartão
        3. O tempo pausado não será contabilizado
        `
      },
      {
        name: '✅ Finalizando',
        value: `
        1. Use o botão **🔴 Finalizar** para encerrar seu cartão
        2. O tempo total será calculado automaticamente
        3. Seu cartão será arquivado para consulta futura
        4. Se precisar justificar uma ausência ou atraso, use o comando **/justificativa**
        5. Se precisar cancelar um cartão de ponto (apenas administradores), use o comando **/cancelar**
        `
      },
      {
        name: '⚠️ Importante',
        value: `
        • Não esqueça de finalizar seu cartão ao terminar
        • O tempo é calculado automaticamente
        • Administradores podem ajustar tempos se necessário
        • Apenas administradores podem cancelar cartões
        • Ao justificar um dia, as horas serão zeradas e aparecerá um "J" no lugar
        • A justificativa pode ser vista ao passar o mouse sobre o "J" na planilha
        `
      },
      {
        name: '📢 Sobre o comando /reportar',
        value: `
        • O comando **/reportar** deve ser usado apenas se necessário, para relatar problemas ou situações excepcionais.
        • Apenas usuários com o cargo <@&ID_DO_CARGO> podem utilizar este comando.
        • Use com responsabilidade para garantir o bom funcionamento do sistema.
        `
      }
    ],
    color: '#00ff00',
    footer: 'Selecione uma opção abaixo para navegar'
  },
  support: {
    title: '❓ Central de Suporte',
    description: 'Precisa de ajuda? Aqui estão suas opções:\n\nSelecione uma opção abaixo para navegar:',
    fields: [
      {
        name: '📞 Contato',
        value: 'Se você encontrar algum problema ou tiver dúvidas, entre em contato com o suporte: <@657014871228940336>'
      },
      {
        name: '⚠️ Problemas Comuns',
        value: '• Se o bot não responder, verifique se ele tem as permissões necessárias\n' +
               '• Se os botões não funcionarem, tente usar o comando novamente\n' +
               '• Se o ponto não estiver sendo registrado, verifique se você está no canal correto'
      }
    ],
    color: '#ff0000',
    footer: 'Selecione uma opção abaixo para navegar'
  }
};

// Função para gerar a embed de comandos
function generateCommandsEmbed(interaction) {
    return new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle('📚 Central de Ajuda')
        .setDescription('Aqui está a lista de todos os comandos e funcionalidades disponíveis:')
        .addFields(
            {
                name: '🔄 Sistema de Ponto',
                value: `
                O sistema de ponto funciona através de botões interativos:
                
                **🟢 Iniciar** - Inicia um novo cartão de ponto
                **⏸️ Pausar** - Pausa o cartão de ponto atual
                **🔄 Voltar** - Retoma o cartão de ponto pausado
                **🔴 Finalizar** - Finaliza o cartão de ponto atual
                **❌ Cancelar** - Cancela um cartão de ponto (apenas administradores)
                `
            },
            {
                name: '⚙️ Comandos de Administração',
                value: `
                **/painel** - Configura o painel de administração
                **/planilha** - Configura a planilha do servidor
                **/cargos** - Gerencia cargos do servidor
                `
            }
        )
        .setFooter({
            text: 'Sistema de Ponto • Desenvolvido por toca da raposa',
            iconURL: interaction.guild.iconURL() || null
        })
        .setTimestamp();
}

// Função para gerar a embed de tutorial
function generateTutorialEmbed(interaction) {
    return new EmbedBuilder()
        .setColor('#00ff00')
        .setTitle('🎓 Tutorial do Sistema de Ponto')
        .setDescription('Aprenda a usar o sistema de ponto passo a passo:')
        .addFields(
            {
                name: '📝 Como Iniciar',
                value: `
                1. Use **/ponto** para começar um novo cartão de ponto
                2. O bot criará uma mensagem com seu cartão de ponto
                3. Seu tempo começará a ser contabilizado automaticamente
                4. Use **/cartoes** para visualizar todos os seus cartões de ponto
                `
            },
            {
                name: '⏸️ Pausando e Retomando',
                value: `
                1. Use o botão **⏸️ Pausar** quando precisar fazer uma pausa
                2. Use o botão **🔄 Voltar** para retomar o cartão
                3. O tempo pausado não será contabilizado
                `
            },
            {
                name: '✅ Finalizando',
                value: `
                1. Use o botão **🔴 Finalizar** para encerrar seu cartão
                2. O tempo total será calculado automaticamente
                3. Seu cartão será arquivado para consulta futura
                4. Se precisar justificar uma ausência ou atraso, use o comando **/justificativa**
                5. Se precisar cancelar um cartão de ponto (apenas administradores), use o comando **/cancelar**
                `
            },
            {
                name: '⚠️ Importante',
                value: `
                • Não esqueça de finalizar seu cartão ao terminar
                • O tempo é calculado automaticamente
                • Administradores podem ajustar tempos se necessário
                • Apenas administradores podem cancelar cartões
                • Ao justificar um dia, as horas serão zeradas e aparecerá um "J" no lugar
                • A justificativa pode ser vista ao passar o mouse sobre o "J" na planilha
                `
            }
        )
        .setFooter({
            text: 'Sistema de Ponto • Desenvolvido por toca da raposa',
            iconURL: interaction.guild.iconURL() || null
        })
        .setTimestamp();
}

// Função para gerar a embed de suporte
function generateSupportEmbed(interaction) {
    return new EmbedBuilder()
        .setColor('#ff0000')
        .setTitle('🆘 Central de Suporte')
        .setDescription('Precisa de ajuda? Aqui estão as opções de suporte:')
        .addFields(
            {
                name: '📞 Suporte Técnico',
                value: `
                • Entre em contato com os administradores do servidor
                • Use o canal de suporte do servidor
                • Reporte problemas imediatamente
                `
            },
            {
                name: '❓ Perguntas Frequentes',
                value: `
                • Consulte o tutorial usando **/ajudar**
                • Verifique as regras do servidor
                • Leia os avisos no canal de anúncios
                `
            },
            {
                name: '📢 Informações Importantes',
                value: `
                • Mantenha seu cartão de ponto atualizado
                • Use os botões corretamente
                • Siga as instruções dos administradores
                • Não abuse do sistema de ponto
                `
            }
        )
        .setFooter({
            text: 'Sistema de Ponto • Desenvolvido por toca da raposa',
            iconURL: interaction.guild.iconURL() || null
        })
        .setTimestamp();
}

// Função para criar os botões de navegação
function createNavigationButtons() {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('help_commands')
                .setLabel('Comandos')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('📝'),
            new ButtonBuilder()
                .setCustomId('help_tutorial')
                .setLabel('📖 Tutorial do Sistema')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('help_support')
                .setLabel('❓ Suporte')
                .setStyle(ButtonStyle.Success)
                .setEmoji('🆘')
        );
}

async function handleAjudarCommand(interaction) {
  // Buscar o cargo permitido do banco de dados
  const servidor = await Servidor.findOne({ guildId: interaction.guildId });
  const cargoPermitidoId = servidor?.cargoPermitido || 'ID_DO_CARGO';

  // Atualizar o campo do tutorial dinamicamente
  const tutorialFields = [
    {
      name: '📝 Como Iniciar',
      value: `
      1. Use **/ponto** para começar um novo cartão de ponto
      2. O bot criará uma mensagem com seu cartão de ponto
      3. Seu tempo começará a ser contabilizado automaticamente
      4. Use **/cartoes** para visualizar todos os seus cartões de ponto
      `
    },
    {
      name: '⏸️ Pausando e Retomando',
      value: `
      1. Use o botão **⏸️ Pausar** quando precisar fazer uma pausa
      2. Use o botão **🔄 Voltar** para retomar o cartão
      3. O tempo pausado não será contabilizado
      `
    },
    {
      name: '✅ Finalizando',
      value: `
      1. Use o botão **🔴 Finalizar** para encerrar seu cartão
      2. O tempo total será calculado automaticamente
      3. Seu cartão será arquivado para consulta futura
      4. Se precisar justificar uma ausência ou atraso, use o comando **/justificativa**
      5. Se precisar cancelar um cartão de ponto (apenas administradores), use o comando **/cancelar**
      `
    },
    {
      name: '⚠️ Importante',
      value: `
      • Não esqueça de finalizar seu cartão ao terminar
      • O tempo é calculado automaticamente
      • Administradores podem ajustar tempos se necessário
      • Apenas administradores podem cancelar cartões
      • Ao justificar um dia, as horas serão zeradas e aparecerá um "J" no lugar
      • A justificativa pode ser vista ao passar o mouse sobre o "J" na planilha
      `
    },
    {
      name: '📢 Sobre o comando /reportar',
      value: `
      • O comando **/reportar** deve ser usado apenas se necessário, para relatar problemas ou situações excepcionais.
      • Apenas usuários com o cargo <@&${cargoPermitidoId}> podem utilizar este comando.
      • Use com responsabilidade para garantir o bom funcionamento do sistema.
      `
    }
  ];

  // Atualizar os campos do menu principal dinamicamente
  const mainFields = [
    {
      name: '📝 Comandos Principais',
      value: '• `/ponto` - Inicia um novo cartão de ponto\n' +
             '• `/horas` - Mostra suas horas acumuladas\n' +
             '• `/top` - Mostra o ranking de horas\n' +
             '• `/justificativa` - Justifica suas horas (substitui as horas por "J")\n' +
             '• `/cartoes` - Visualiza seus cartões de ponto\n' +
             '• `/cancelar` - Cancela um cartão de ponto (apenas administradores)\n' +
             '• `/reportar` - Reporta um problema ao suporte (apenas para casos necessários)\n' +
             `• Apenas usuários com o cargo <@&${cargoPermitidoId}> podem usar /reportar.`
    },
    {
      name: '⚙️ Comandos Administrativos',
      value: '• `/cargos` - Gerencia cargos do servidor\n' +
             '• `/planilha` - Configura a planilha\n' +
             '• `/painel` - Exibe o painel de controle'
    }
  ];

  const embed = new EmbedBuilder()
    .setTitle('📚 Central de Ajuda')
    .setDescription('Bem-vindo ao menu de ajuda! Aqui você encontrará informações sobre todos os comandos disponíveis.\n\nSelecione uma opção abaixo para saber mais:')
    .setColor('#5865F2')
    .setThumbnail(interaction.guild.iconURL({ dynamic: true }) || null)
    .addFields(
      {
        name: '📝 Comandos Principais',
        value: '• `/ponto` - Inicia um novo cartão de ponto\n' +
               '• `/horas` - Mostra suas horas acumuladas\n' +
               '• `/top` - Mostra o ranking de horas\n' +
               '• `/justificativa` - Justifica suas horas (substitui as horas por "J")\n' +
               '• `/cartoes` - Visualiza seus cartões de ponto\n' +
               '• `/cancelar` - Cancela um cartão de ponto (apenas administradores)\n' +
               '• `/reportar` - Reporta um problema ao suporte (apenas para casos necessários)\n' +
               `• Apenas usuários com o cargo <@&${cargoPermitidoId}> podem usar /reportar.`
      },
      {
        name: '\u200B',
        value: '━━━━━━━━━━━━━━━━━━━━━━━',
        inline: false
      },
      {
        name: '⚙️ Comandos Administrativos',
        value: '• `/cargos` - Gerencia cargos do servidor\n' +
               '• `/planilha` - Configura a planilha\n' +
               '• `/painel` - Exibe o painel de controle'
      },
      {
        name: '\u200B',
        value: '━━━━━━━━━━━━━━━━━━━━━━━',
        inline: false
      },
      {
        name: 'ℹ️ Dicas Rápidas',
        value: '• Use os botões abaixo para navegar entre tutorial e suporte.\n• Se tiver dúvidas, clique em "❓ Suporte".'
      }
    )
    .setFooter({
      text: 'Sistema de Ponto • Desenvolvido por Toca da Raposa',
      iconURL: interaction.client.user.displayAvatarURL()
    })
    .setTimestamp();

  const tutorialEmbed = new EmbedBuilder()
    .setTitle(PAGES.tutorial.title)
    .setDescription(PAGES.tutorial.description)
    .setColor(PAGES.tutorial.color)
    .addFields(tutorialFields)
    .setFooter({ text: PAGES.tutorial.footer })
    .setTimestamp();

  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('help_tutorial')
        .setLabel('📖 Tutorial do Sistema')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('help_support')
        .setLabel('❓ Suporte')
        .setStyle(ButtonStyle.Secondary)
    );

  const message = await interaction.reply({ embeds: [embed], components: [row], fetchReply: true });

  // Configurar o timeout para deletar a mensagem após 5 minutos
  setTimeout(async () => {
    try {
      await message.delete();
    } catch (error) {
      console.error('Erro ao deletar mensagem:', error);
    }
  }, 5 * 60 * 1000); // 5 minutos em milissegundos

  // Salvar o tutorialEmbed para uso nos botões
  interaction.client._ajudaTutorialEmbed = tutorialEmbed;
}

// Função para lidar com as interações dos botões
async function handleHelpButton(interaction) {
  const page = interaction.customId.split('_')[1];
  
  // Se estiver no menu principal e clicar em "Menu Principal", não faz nada
  if (page === 'main' && interaction.message.embeds[0].title === PAGES.main.title) {
    return;
  }

  let embed;
  if (page === 'tutorial' && interaction.client._ajudaTutorialEmbed) {
    embed = interaction.client._ajudaTutorialEmbed;
  } else {
    embed = new EmbedBuilder()
      .setTitle(PAGES[page].title)
      .setDescription(PAGES[page].description)
      .setColor(PAGES[page].color)
      .addFields(PAGES[page].fields)
      .setFooter({ text: PAGES[page].footer })
      .setTimestamp();
  }

  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('help_main')
        .setLabel('🏠 Menu Principal')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(page === 'main'), // Desabilita o botão se já estiver na página principal
      new ButtonBuilder()
        .setCustomId('help_tutorial')
        .setLabel('📖 Tutorial do Sistema')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === 'tutorial'), // Desabilita o botão se já estiver na página de tutorial
      new ButtonBuilder()
        .setCustomId('help_support')
        .setLabel('❓ Suporte')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === 'support') // Desabilita o botão se já estiver na página de suporte
    );

  await interaction.update({ embeds: [embed], components: [row] });
}

module.exports = { 
    data: commandData,
    handleAjudarCommand,
    handleHelpButton
}; 