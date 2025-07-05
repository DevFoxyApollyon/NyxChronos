const mongoose = require('mongoose');

const pointCardSchema = new mongoose.Schema({
  userId: { 
    type: String, 
    required: [true, 'userId é obrigatório'],
    trim: true
  },
  startTime: { type: Date, required: true },
  totalPausedTime: { type: Number, default: 0 },
  lastPauseStart: { type: Date },
  isPaused: { type: Boolean, default: false },
  finished: { type: Boolean, default: false },
  endTime: { type: Date },
  history: [{ action: String, time: Date, user: String }],
  totalTime: { type: Number },
  accumulatedTime: { type: Number, default: 0 },
  fourHoursNotified: { type: Boolean, default: false },
  channelId: { type: String, required: true },
  messageId: { type: String, required: true, unique: true },
  lastInteractionTime: { type: Date },
  canceledBy: { type: String },
  canceled: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  status: { type: String, enum: ['active', 'finished', 'error', 'error_sheets'], default: 'active' },
  guildId: { 
    type: String, 
    required: [true, 'guildId é obrigatório'],
    trim: true
  },
  workPeriods: [{
    start: Date,
    end: Date,
    pauseIntervals: [{
      start: Date,
      end: Date
    }]
  }],
  totalAccumulatedTime: { type: Number, default: 0 },
  previousAccumulatedTime: { type: Number, default: 0 },
  lastVoiceChannelName: { type: String },
  lastVoiceChannelLeftAt: { type: Date },
  lastVoiceChannelJoinedAt: { type: Date, default: null },
});

// Criar índice TTL para expirar documentos após 4 dias
pointCardSchema.index({ createdAt: 1 }, { expireAfterSeconds: 345600 });

// Índices adicionais para otimizar consultas frequentes
pointCardSchema.index({ userId: 1, guildId: 1 });
pointCardSchema.index({ guildId: 1, status: 1 });
pointCardSchema.index({ guildId: 1, finished: 1 });
pointCardSchema.index({ userId: 1, finished: 1 });
pointCardSchema.index({ messageId: 1 }, { unique: true });
pointCardSchema.index({ lastInteractionTime: -1 });

// Índice composto para buscar cartões ativos por usuário
pointCardSchema.index({ 
  userId: 1, 
  guildId: 1, 
  finished: 1, 
  status: 1 
}, { unique: true, partialFilterExpression: { finished: false, status: 'active' } });

// Índice para buscas relacionadas ao tempo de inatividade (usado em autoFinish)
pointCardSchema.index({ 
  status: 1, 
  finished: 1, 
  lastInteractionTime: 1 
});

// Adicionar método de validação personalizado
pointCardSchema.methods.validateSync = function() {
  if (!this.guildId) {
    throw new Error('guildId é obrigatório');
  }
};

const PointCard = mongoose.model('PointCard', pointCardSchema);

module.exports = { PointCard };