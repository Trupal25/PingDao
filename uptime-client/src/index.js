require('dotenv').config();
const express = require('express');
const cron = require('node-cron');
const config = require('../config/default');
const logger = require('./utils/logger');
const monitor = require('./services/monitor');
const solanaService = require('./services/solana');
const userService = require('./services/user');
const websocketService = require('./services/websocket');

// Initialize the express app
const app = express();
const PORT = config.client.port;
const HOST = config.client.host;

// Middleware
app.use(express.json());

// Routes
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'UP', timestamp: new Date() });
});

app.get('/metrics', async (req, res) => {
  try {
    const metrics = await monitor.getMetrics();
    res.status(200).json(metrics);
  } catch (error) {
    logger.error('Error fetching metrics', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch metrics' });
  }
});

// Get client status
app.get('/status', (req, res) => {
  try {
    if (!userService.isRegistered()) {
      return res.status(200).json({
        registered: false,
        message: 'Client not registered with main application'
      });
    }
    
    const userData = userService.getUserData();
    const solanaConnected = solanaService.isConnected();
    const websocketConnected = websocketService.isSocketConnected();
    
    res.status(200).json({
      registered: true,
      nodeId: userData.nodeId,
      publicKey: userData.publicKey,
      registrationTime: userData.registrationTime,
      lastPing: userData.lastPing,
      geolocation: userData.geolocation,
      connections: {
        solana: solanaConnected,
        websocket: websocketConnected
      },
      mainAppUrl: config.mainApp.apiUrl
    });
  } catch (error) {
    logger.error('Error fetching status', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch status' });
  }
});

// Initialize services
async function init() {
  try {
    // Initialize user service
    userService.init();
    
    // Initialize Solana service
    await solanaService.init();
    
    // Initialize monitoring service
    monitor.init();
    
    // Initialize WebSocket service
    websocketService.init();
    
    // Schedule status updates
    const statusUpdateInterval = Math.ceil(config.user.statusUpdateInterval / 60000);
    cron.schedule(`*/${statusUpdateInterval} * * * *`, async () => {
      if (userService.isRegistered()) {
        await userService.updateStatus();
      }
    });
    
    // Auto-register if configured
    if (config.user.autoRegister && config.user.publicKey) {
      setTimeout(async () => {
        if (!userService.isRegistered()) {
          logger.info('Auto-registering with main application');
          await userService.registerUser({ publicKey: config.user.publicKey });
        }
      }, 5000); // Wait 5 seconds before auto-registering
    }
    
    // Start the client server
    const server = app.listen(PORT, HOST, () => {
      logger.info(`Uptime Client listening on ${HOST}:${PORT}`);
      logger.info(`Main application at: ${config.mainApp.apiUrl}`);
    });
    
    // Handle graceful shutdown
    setupGracefulShutdown(server);
    
  } catch (error) {
    logger.error('Failed to initialize services', { error: error.message });
    process.exit(1);
  }
}

// Setup graceful shutdown
function setupGracefulShutdown(server) {
  // Handle termination signals
  const signals = ['SIGTERM', 'SIGINT'];
  
  signals.forEach(signal => {
    process.on(signal, async () => {
      logger.info(`Received ${signal}, shutting down gracefully...`);
      
      // Notify main application about shutdown
      if (userService.isRegistered() && websocketService.isSocketConnected()) {
        logger.info('Notifying main application about shutdown');
        websocketService.send('disconnect', { 
          nodeId: userService.getUserData().nodeId,
          reason: 'shutdown'
        });
        
        // Give WebSocket time to send the message
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      // Close HTTP server
      server.close(() => {
        logger.info('HTTP server closed');
        
        // Perform any cleanup needed
        logger.info('Cleaning up resources...');
        
        // Exit process
        logger.info('Shutdown complete');
        process.exit(0);
      });
      
      // Force exit if graceful shutdown takes too long
      setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
      }, 10000); // 10 seconds
    });
  });
}

// Start the application
init(); 