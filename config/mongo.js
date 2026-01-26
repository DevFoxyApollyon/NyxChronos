const mongoose = require('mongoose');

async function connectToMongoDB(retries = 5) {
    const { MONGODB_URI } = process.env;
    for (let i = 0; i < retries; i++) {
        try {
            await mongoose.connect(MONGODB_URI, {
                serverSelectionTimeoutMS: 5000,
                retryWrites: true,
                w: 'majority',
                maxPoolSize: 50,
                minPoolSize: 5,
                socketTimeoutMS: 45000,
                connectTimeoutMS: 10000,
                maxIdleTimeMS: 60000,
                useNewUrlParser: true,
                useUnifiedTopology: true
            });
            console.log('✅ Conectado ao MongoDB');
            return mongoose.connection;
        } catch (error) {
            console.error(`❌ Tentativa ${i + 1}/${retries} falhou:`, error);
            if (i === retries - 1) {
                process.exit(1);
            }
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
}

module.exports = connectToMongoDB; 