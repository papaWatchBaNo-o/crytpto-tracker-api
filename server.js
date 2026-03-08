const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const cryptoRoutes = require('./routes/crypto');

const app = express();

const isProduction = process.env.NODE_ENV === 'production';
const isDevelopment = !isProduction;
const PORT = Number(process.env.PORT) || 5000;

const defaultOrigins = [
  'https://realcryptotracker.netlify.app',
  'https://papawatchbano-o.github.io',
  'https://papawatchbano-o.github.io/crypto-tracker-frontend',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

const envOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const allowedOrigins = new Set([...defaultOrigins, ...envOrigins]);

const corsOptions = {
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) {
      return callback(null, true);
    }

    if (isDevelopment) {
      console.warn(`CORS blocked: ${origin}`);
    }

    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

let requestCount = 0;
if (isDevelopment) {
  app.use((req, res, next) => {
    requestCount += 1;
    console.log(`[${requestCount}] ${new Date().toISOString()} ${req.method} ${req.originalUrl}`);
    next();
  });
}

app.disable('x-powered-by');
app.use(cors(corsOptions));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

app.get('/health', (req, res) => {
  const dbConnected = mongoose.connection.readyState === 1;

  res.status(dbConnected ? 200 : 503).json({
    status: dbConnected ? 'healthy' : 'unhealthy',
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    database: dbConnected ? 'connected' : 'disconnected',
  });
});

app.get('/api/health', (req, res) => {
  const dbConnected = mongoose.connection.readyState === 1;

  res.status(dbConnected ? 200 : 503).json({
    status: dbConnected ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/crypto', cryptoRoutes);

app.use((req, res) => {
  res.status(404).json({
    error: 'Route not found',
    ...(isDevelopment && { path: req.originalUrl, method: req.method }),
  });
});

app.use((err, req, res, next) => {
  if (isDevelopment) {
    console.error(err.stack || err);
  } else {
    console.error('Request error', {
      message: err.message,
      path: req.originalUrl,
      method: req.method,
      timestamp: new Date().toISOString(),
    });
  }

  const status = err.statusCode || err.status || 500;
  res.status(status).json({
    error: status >= 500 ? 'Internal server error' : err.message,
    ...(isDevelopment && status >= 500 ? { details: err.message } : {}),
  });
});

const validateRequiredEnv = () => {
  const requiredKeys = ['MONGODB_URI', 'JWT_SECRET'];
  const missing = requiredKeys.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    console.error(`Missing required environment variable(s): ${missing.join(', ')}`);
    process.exit(1);
  }
};

const connectToDatabase = async () => {
  const mongooseOptions = {
    maxPoolSize: isProduction ? 10 : 5,
    serverSelectionTimeoutMS: isProduction ? 7000 : 30000,
    socketTimeoutMS: isProduction ? 45000 : 0,
  };

  await mongoose.connect(process.env.MONGODB_URI, mongooseOptions);

  mongoose.connection.on('error', (error) => {
    console.error('MongoDB error:', error.message);
  });

  mongoose.connection.on('disconnected', () => {
    console.warn('MongoDB disconnected');
  });

  if (isDevelopment) {
    const dbType = process.env.MONGODB_URI.includes('mongodb+srv') ? 'MongoDB Atlas' : 'MongoDB';
    console.log(`Database connected (${dbType})`);
  }
};

let server;

const startServer = async () => {
  validateRequiredEnv();

  try {
    await connectToDatabase();

    server = app.listen(PORT, () => {
      console.log('='.repeat(44));
      console.log('Crypto Tracker API');
      console.log('='.repeat(44));
      console.log(`Environment: ${isProduction ? 'production' : 'development'}`);
      console.log(`Port: ${PORT}`);
      console.log(`Started: ${new Date().toISOString()}`);
      if (isDevelopment) {
        console.log(`Health: http://localhost:${PORT}/health`);
      }
      console.log('='.repeat(44));
    });
  } catch (error) {
    console.error('Failed to start server:', error.message);
    process.exit(1);
  }
};

const gracefulShutdown = (signal) => {
  console.log(`${signal} received. Shutting down...`);

  const exitWithCode = (code) => {
    process.exit(code);
  };

  if (!server) {
    mongoose.connection.close().finally(() => exitWithCode(0));
    return;
  }

  server.close(() => {
    mongoose.connection.close().finally(() => exitWithCode(0));
  });
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});

startServer();
