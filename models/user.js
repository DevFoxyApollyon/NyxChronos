const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  userId: { 
    type: String, 
    required: true,
    unique: true,
    index: true
  },
  totalTime: { 
    type: Number, 
    default: 0 
  },
  lastActivity: {
    type: Date,
    default: Date.now
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true, // Adiciona campos createdAt e updatedAt automaticamente
});

// Adicionar índice para userId
userSchema.index({ userId: 1 }, { unique: true });

// Índice para buscas por tempo total (ranking)
userSchema.index({ totalTime: -1 });

const User = mongoose.model('User', userSchema);

module.exports = { User };

//aqui tmb nao filho de cruscredo