const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();

const isProduction = process.env.NODE_ENV === 'production';
const isDevelopment = !isProduction;

const allowedOrigins = [
  'https://sabbath-1.github.io',
  'https://sabbath-1.github.io/crypto-tracker-frontend',
  'http://localhost:3000',
];

let requestCount = 0;
app.use((req, res, next) => {
  requestCount++;
  if (isDevelopment) {
    console.log(`[${requestCount}] ${new Date().toISOString()} - ${req.method} ${req.url}`);
  }
  next();
});

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) === -1) {
      if (isDevelopment) {
        console.warn('🚫 CORS blocked:', origin);
      }
      const error = isDevelopment 
        ? new Error(`CORS blocked: ${origin}`)
        : new Error('Not allowed by CORS');
      return callback(error, false);
    }
    return callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.disable('x-powered-by');

app.get('/health', (req, res) => {
  const dbStatus = mongoose.connection.readyState;
  const status = dbStatus === 1 ? 'healthy' : 'unhealthy';
  
  res.status(dbStatus === 1 ? 200 : 503).json({
    status: status,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    database: dbStatus === 1 ? 'connected' : 'disconnected',
    memory: process.memoryUsage(),
    environment: process.env.NODE_ENV || 'development'
  });
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/crypto', require('./routes/crypto'));

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('❌ FATAL: MONGODB_URI environment variable is required');
  console.error('💡 For local dev: Add to .env file');
  console.error('💡 For production: Set in Render dashboard');
  process.exit(1); 
}

if (!process.env.JWT_SECRET) {
  console.error('❌ FATAL: JWT_SECRET environment variable is required');
  console.error('💡 For local dev: Add to .env file');
  console.error('💡 For production: Set in Render dashboard');
  process.exit(1);
}

const mongooseOptions = {
  maxPoolSize: isProduction ? 10 : 5, 
  serverSelectionTimeoutMS: isProduction ? 5000 : 30000,
  socketTimeoutMS: isProduction ? 45000 : 0,
};

mongoose.connect(MONGODB_URI, mongooseOptions)
.then(() => {
  console.log('✅ MongoDB connected successfully');
  if (isDevelopment) {
    console.log(`📦 Database: ${MONGODB_URI.includes('mongodb+srv') ? 'MongoDB Atlas (Cloud)' : 'Local'}`);
  }
})
.catch(err => {
  console.error('❌ MongoDB connection FAILED:', err.message);
  if (isProduction) {
    console.log('🔄 Will retry connection in 10 seconds...');
    setTimeout(() => {
      mongoose.connect(MONGODB_URI, mongooseOptions)
        .catch(e => console.error('Retry also failed:', e.message));
    }, 10000);
  } else {
    process.exit(1);
  }
});

mongoose.connection.on('error', err => {
  console.error('MongoDB error:', err.message);
});

mongoose.connection.on('disconnected', () => {
  console.warn('MongoDB disconnected. Attempting to reconnect...');
});

app.use((req, res) => {
  if (isDevelopment) {
    console.warn(`404: ${req.method} ${req.url}`);
  }
  res.status(404).json({ 
    error: 'Route not found',
    ...(isDevelopment && { path: req.url, method: req.method })
  });
});

app.use((err, req, res, next) => {
  if (isDevelopment) {
    console.error('💥 Error stack:', err.stack);
  } else {
    console.error('💥 Production error:', {
      message: err.message,
      path: req.path,
      method: req.method,
      timestamp: new Date().toISOString()
    });
  }
  
  const statusCode = err.statusCode || err.status || 500;
  
  const response = {
    error: 'Internal server error',
    ...(isDevelopment && { 
      message: err.message,
      stack: err.stack 
    }),
    ...(err.name === 'ValidationError' && { details: err.errors })
  };
  
  res.status(statusCode).json(response);
});


const PORT = process.env.PORT || 5000;

process.on('SIGTERM', () => {
  console.log('SIGTERM received. Closing server gracefully...');
  server.close(() => {
    console.log('Server closed');
    mongoose.connection.close(false, () => {
      console.log('MongoDB connection closed');
      process.exit(0);
    });
  });
});

const server = app.listen(PORT, () => {
  console.log('='.repeat(50));
  console.log(`🚀 Crypto Tracker API`);
  console.log('='.repeat(50));
  console.log(`📡 Environment: ${isProduction ? 'PRODUCTION' : 'DEVELOPMENT'}`);
  console.log(`📍 Port: ${PORT}`);
  console.log(`⏰ Started: ${new Date().toISOString()}`);
  console.log('='.repeat(50));
  
  if (isDevelopment) {
    console.log(`🔗 Local: http://localhost:${PORT}`);
    console.log(`🔗 Health: http://localhost:${PORT}/health`);
  }
});