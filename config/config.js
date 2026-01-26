const { SlashCommandBuilder } = require('discord.js');

const commands = [
  // Comando de ponto
  new SlashCommandBuilder()
    .setName('ponto')
    .setDescription('inicia um bate-ponto'), 
  // Comando de reabrir cartão
  new SlashCommandBuilder()
    .setName('reabrir')
    .setDescription('Reabre um cartão de ponto finalizado pelo ID da mensagem.')
    .addStringOption(option =>
      option.setName('id')
        .setDescription('ID da mensagem do cartão a ser reaberto.')
        .setRequired(true)
    ),
  // Comando top 10
  new SlashCommandBuilder()
    .setName('top')
    .setDescription('Mostra o top 10 usuários com mais horas acumuladas'),
  // Comando horas
  new SlashCommandBuilder()
    .setName('horas')
    .setDescription('Mostra quantas horas você tem'),
  // Comando justificativa
  new SlashCommandBuilder()
    .setName('justificativa')
    .setDescription('Justifique suas horas caso não consiga'),
  // Comando cancelar
  new SlashCommandBuilder()
    .setName('cancelar')
    .setDescription('Cancela um cartão de ponto e informa o motivo.'),
  // Comando painel
  new SlashCommandBuilder()
    .setName('painel')
    .setDescription('Comando para exibir um painel com informações e opções'),
  // Comando planilha
  new SlashCommandBuilder()
    .setName('planilha')
    .setDescription('Abre um menu para selecionar a aba da planilha onde os dados serão enviados'),
  // Comando cargos
  new SlashCommandBuilder()
    .setName('cargos')
    .setDescription('Gerencia os cargos permitidos e responsáveis por horas do servidor'),
  // Comando ajudar
  new SlashCommandBuilder()
    .setName('ajudar')
    .setDescription('Mostra informações sobre os comandos disponíveis')
    .setDMPermission(false),
  // Comando reportar
  new SlashCommandBuilder()
    .setName('reportar')
    .setDescription('📢 Reportar um problema, sugestão ou dúvida sobre o bot')
    .setDMPermission(false),
  // Comando cartoes
  new SlashCommandBuilder()
    .setName('cartoes')
    .setDescription('Lista todos os cartões abertos e pausados')
    .setDMPermission(false),
].map(command => command.toJSON());

module.exports = { commands };