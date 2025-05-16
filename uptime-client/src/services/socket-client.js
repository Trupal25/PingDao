const io = require('socket.io-client');
const config = require('../../config/default');
const logger = require('../utils/logger');

let socket = null;
let isConnected = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;

// Connect to Uptime Kuma server
function connect() {
  logger.info('Connecting to Uptime Kuma server', { url: config.uptimeKuma.url });
  
  // Initialize socket connection
  socket = io(config.uptimeKuma.url, {
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: MAX_RECONNECT_ATTEMPTS
  });
  
  // Socket event handlers
  socket.on('connect', () => {
    isConnected = true;
    reconnectAttempts = 0;
    logger.info('Connected to Uptime Kuma server');
    
    // Authenticate with API key if provided
    if (config.uptimeKuma.apiKey) {
      socket.emit('auth', { apiKey: config.uptimeKuma.apiKey }, (response) => {
        if (response.ok) {
          logger.info('Authenticated with Uptime Kuma server');
        } else {
          logger.error('Authentication failed', { error: response.msg });
        }
      });
    }
    
    // Register as a client monitor
    registerMonitor();
  });
  
  socket.on('disconnect', (reason) => {
    isConnected = false;
    logger.warn('Disconnected from Uptime Kuma server', { reason });
  });
  
  socket.on('reconnect_attempt', (attempt) => {
    reconnectAttempts = attempt;
    logger.info('Attempting to reconnect to Uptime Kuma server', { attempt });
  });
  
  socket.on('reconnect_failed', () => {
    logger.error('Failed to reconnect to Uptime Kuma server after maximum attempts');
  });
  
  socket.on('error', (error) => {
    logger.error('Socket error', { error });
  });
  
  // Custom event handlers
  socket.on('requestMetrics', () => {
    logger.info('Metrics requested by Uptime Kuma server');
    const monitor = require('./monitor');
    monitor.collectMetrics().then(metrics => {
      sendMetrics(metrics);
    }).catch(error => {
      logger.error('Error collecting metrics for request', { error: error.message });
    });
  });
}

// Disconnect from Uptime Kuma server
function disconnect() {
  if (socket) {
    socket.disconnect();
    logger.info('Disconnected from Uptime Kuma server');
  }
}

// Register this client as a monitor
function registerMonitor() {
  if (!isConnected) {
    logger.warn('Cannot register monitor: Not connected to Uptime Kuma server');
    return;
  }
  
  const os = require('os');
  const monitorInfo = {
    type: 'client',
    name: os.hostname(),
    version: require('../../package.json').version,
    platform: os.platform(),
    arch: os.arch()
  };
  
  socket.emit('registerMonitor', monitorInfo, (response) => {
    if (response && response.ok) {
      logger.info('Registered as monitor with Uptime Kuma server', { id: response.monitorId });
    } else {
      logger.error('Failed to register as monitor', { error: response ? response.msg : 'Unknown error' });
    }
  });
}

// Send metrics to Uptime Kuma server
function sendMetrics(metrics) {
  if (!isConnected) {
    logger.warn('Cannot send metrics: Not connected to Uptime Kuma server');
    return;
  }
  
  socket.emit('metrics', metrics, (response) => {
    if (response && response.ok) {
      logger.debug('Metrics sent to Uptime Kuma server');
    } else {
      logger.error('Failed to send metrics', { error: response ? response.msg : 'Unknown error' });
    }
  });
}

// Check connection status
function isSocketConnected() {
  return isConnected;
}

module.exports = {
  connect,
  disconnect,
  sendMetrics,
  isSocketConnected
}; 