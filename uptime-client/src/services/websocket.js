const WebSocket = require('ws');
const config = require('../../config/default');
const logger = require('../utils/logger');
const monitor = require('./monitor');
const solanaService = require('./solana');
const userService = require('./user');

let ws = null;
let isConnected = false;
let reconnectAttempts = 0;
let reconnectTimeout = null;
let pingInterval = null;
let messageHandlers = {};
let pendingMessages = [];
let connectionStartTime = null;

// Initialize WebSocket connection
function init() {
  logger.info('Initializing WebSocket service');
  connect();
  
  // Register message handlers
  registerMessageHandlers();
  
  // Schedule periodic connection check
  setInterval(() => {
    checkConnection();
  }, 60000); // Check every minute
}

// Connect to WebSocket server
function connect() {
  try {
    const wsUrl = config.mainApp.wsUrl;
    logger.info('Connecting to main application WebSocket server', { url: wsUrl });
    
    // Close existing connection if any
    if (ws) {
      try {
        ws.terminate();
      } catch (error) {
        logger.debug('Error terminating existing WebSocket', { error: error.message });
      }
    }
    
    // Record connection start time
    connectionStartTime = Date.now();
    
    // Create new WebSocket connection
    ws = new WebSocket(wsUrl);
    
    // Setup event handlers
    ws.on('open', handleOpen);
    ws.on('message', handleMessage);
    ws.on('error', handleError);
    ws.on('close', handleClose);
    
  } catch (error) {
    logger.error('Failed to connect to main application WebSocket server', { error: error.message });
    scheduleReconnect();
  }
}

// Handle WebSocket open event
function handleOpen() {
  logger.info('Connected to main application WebSocket server');
  isConnected = true;
  reconnectAttempts = 0;
  
  // Clear any pending reconnect
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
  
  // Setup ping interval
  pingInterval = setInterval(() => {
    if (isConnected) {
      sendPing();
    }
  }, 30000); // 30 seconds
  
  // Authenticate if user is registered
  if (userService.isRegistered()) {
    const userData = userService.getUserData();
    authenticate(userData.nodeId, userData.publicKey);
  }
  
  // Send any pending messages
  if (pendingMessages.length > 0) {
    logger.info(`Sending ${pendingMessages.length} pending messages`);
    
    // Clone and clear pending messages
    const messagesToSend = [...pendingMessages];
    pendingMessages = [];
    
    // Send each pending message
    messagesToSend.forEach(message => {
      try {
        ws.send(JSON.stringify(message));
        logger.debug('Sent pending message', { type: message.type });
      } catch (error) {
        logger.error('Failed to send pending message', { error: error.message });
        // Re-queue important messages
        if (message.priority === 'high') {
          pendingMessages.push(message);
        }
      }
    });
  }
}

// Handle WebSocket message event
function handleMessage(data) {
  try {
    const message = JSON.parse(data);
    logger.debug('Received WebSocket message', { type: message.type });
    
    // Handle message based on type
    if (message.type && messageHandlers[message.type]) {
      messageHandlers[message.type](message);
    } else {
      logger.warn('Unknown message type', { type: message.type });
    }
  } catch (error) {
    logger.error('Failed to process WebSocket message', { error: error.message });
  }
}

// Handle WebSocket error event
function handleError(error) {
  logger.error('WebSocket error', { error: error.message });
  
  // If connection is very recent, increase backoff time
  if (connectionStartTime && Date.now() - connectionStartTime < 5000) {
    reconnectAttempts += 2; // Increase backoff more aggressively for immediate failures
  }
}

// Handle WebSocket close event
function handleClose(code, reason) {
  const reasonStr = reason ? reason.toString() : 'Unknown';
  logger.warn('WebSocket connection closed', { code, reason: reasonStr });
  isConnected = false;
  
  // Clear ping interval
  if (pingInterval) {
    clearInterval(pingInterval);
    pingInterval = null;
  }
  
  // Schedule reconnect
  scheduleReconnect();
}

// Schedule reconnection attempt
function scheduleReconnect() {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
  }
  
  reconnectAttempts++;
  
  if (reconnectAttempts <= config.websocket.maxReconnectAttempts) {
    // Exponential backoff with jitter
    const baseDelay = config.websocket.reconnectInterval;
    const maxDelay = Math.min(30000, baseDelay * Math.pow(2, reconnectAttempts - 1));
    const jitter = Math.random() * 0.3 * maxDelay;
    const delay = Math.min(maxDelay + jitter, 60000); // Cap at 60 seconds
    
    logger.info('Scheduling reconnection attempt', { 
      attempt: reconnectAttempts, 
      maxAttempts: config.websocket.maxReconnectAttempts,
      delay: Math.round(delay)
    });
    
    reconnectTimeout = setTimeout(() => {
      logger.info('Attempting to reconnect to main application');
      connect();
    }, delay);
  } else {
    logger.error('Maximum reconnection attempts reached, will try again in 5 minutes');
    
    // Reset reconnect attempts and try again after a longer delay
    reconnectTimeout = setTimeout(() => {
      reconnectAttempts = 0;
      logger.info('Retrying connection after cooldown period');
      connect();
    }, 300000); // 5 minutes
  }
}

// Check if connection is healthy and reconnect if needed
function checkConnection() {
  if (!isConnected) {
    logger.info('Connection check: WebSocket is disconnected');
    if (!reconnectTimeout) {
      logger.info('No reconnection scheduled, connecting now');
      connect();
    }
    return false;
  }
  
  // Send a ping to verify connection is responsive
  try {
    sendPing();
    return true;
  } catch (error) {
    logger.error('Connection check failed', { error: error.message });
    
    // Force reconnect if sending ping fails
    isConnected = false;
    if (ws) {
      try {
        ws.terminate();
      } catch (e) {
        // Ignore errors during termination
      }
    }
    
    scheduleReconnect();
    return false;
  }
}

// Send a message to the server
function send(type, data = {}, priority = 'normal') {
  const message = {
    type,
    data,
    timestamp: Date.now(),
    priority // 'high', 'normal', or 'low'
  };
  
  if (!isConnected) {
    logger.warn('Cannot send message: WebSocket not connected');
    
    // Queue high priority messages for later sending
    if (priority === 'high') {
      logger.info('Queuing high priority message for later sending', { type });
      pendingMessages.push(message);
    }
    
    return false;
  }
  
  try {
    ws.send(JSON.stringify(message));
    return true;
  } catch (error) {
    logger.error('Failed to send WebSocket message', { error: error.message });
    
    // Queue high priority messages for later sending
    if (priority === 'high') {
      logger.info('Queuing high priority message after send failure', { type });
      pendingMessages.push(message);
    }
    
    // Connection might be broken
    checkConnection();
    
    return false;
  }
}

// Send a ping message
function sendPing() {
  send('ping', { 
    nodeId: userService.isRegistered() ? userService.getUserData().nodeId : null,
    timestamp: Date.now()
  }, 'low'); // Low priority as pings are frequent and not critical
}

// Authenticate with the server
function authenticate(nodeId, publicKey) {
  logger.info('Authenticating WebSocket connection with main application');
  send('authenticate', { nodeId, publicKey }, 'high');
}

// Send metrics to server
function sendMetrics(metrics) {
  if (!userService.isRegistered()) {
    logger.debug('Not sending metrics: User not registered');
    return false;
  }
  
  const userData = userService.getUserData();
  return send('metrics', {
    nodeId: userData.nodeId,
    publicKey: userData.publicKey,
    metrics
  }, 'normal');
}

// Register message handlers
function registerMessageHandlers() {
  // Authentication response
  messageHandlers.authResponse = (message) => {
    if (message.data.success) {
      logger.info('Authentication successful with main application');
    } else {
      logger.error('Authentication failed with main application', { error: message.data.error });
      
      // If authentication failed due to unknown node, try to re-register
      if (message.data.error && message.data.error.includes('unknown node')) {
        logger.info('Node unknown to main application, attempting to re-register');
        
        // Reset registration status
        const publicKey = userService.getUserData().publicKey;
        if (publicKey) {
          setTimeout(() => {
            userService.registerUser({ publicKey });
          }, 5000);
        }
      }
    }
  };
  
  // Ping response
  messageHandlers.pong = (message) => {
    logger.debug('Received pong from main application');
  };
  
  // Request for metrics
  messageHandlers.requestMetrics = async (message) => {
    logger.info('Received metrics request from main application');
    const metrics = await monitor.collectMetrics();
    sendMetrics(metrics);
  };
  
  // Reward notification
  messageHandlers.reward = (message) => {
    logger.info('Received reward notification from main application', { 
      amount: message.data.amount,
      txId: message.data.txId
    });
    
    // Verify transaction if we have a txId
    if (message.data.txId) {
      solanaService.verifyTransaction(message.data.txId)
        .then(result => {
          if (result.confirmed) {
            logger.info('Reward transaction confirmed on Solana', { txId: message.data.txId });
          } else {
            logger.warn('Reward transaction not confirmed', { 
              txId: message.data.txId,
              status: result.status
            });
          }
        })
        .catch(error => {
          logger.error('Failed to verify reward transaction', { error: error.message });
        });
    }
  };
  
  // Task assignment
  messageHandlers.task = async (message) => {
    logger.info('Received task assignment from main application', { taskId: message.data.taskId });
    
    // Process task based on type
    const taskResult = {
      taskId: message.data.taskId,
      nodeId: userService.getUserData().nodeId,
      success: false,
      result: null,
      error: null
    };
    
    try {
      switch (message.data.type) {
        case 'collectMetrics':
          taskResult.result = await monitor.collectMetrics();
          taskResult.success = true;
          break;
          
        case 'checkEndpoint':
          // Implement endpoint checking logic
          break;
          
        case 'updateConfig':
          // Handle remote configuration updates
          if (message.data.config) {
            logger.info('Received configuration update from main application');
            // Apply relevant configuration changes
            taskResult.success = true;
          }
          break;
          
        default:
          throw new Error(`Unknown task type: ${message.data.type}`);
      }
    } catch (error) {
      taskResult.error = error.message;
    }
    
    // Send task result back to server
    send('taskResult', taskResult, 'high');
  };
  
  // Server disconnect notification
  messageHandlers.serverShutdown = (message) => {
    logger.warn('Main application server is shutting down', {
      reason: message.data.reason,
      estimatedDowntime: message.data.estimatedDowntime
    });
    
    // Increase reconnection delay to avoid unnecessary reconnection attempts
    reconnectAttempts = Math.max(reconnectAttempts, 5);
  };
}

// Check if WebSocket is connected
function isSocketConnected() {
  return isConnected;
}

module.exports = {
  init,
  connect,
  send,
  sendMetrics,
  isSocketConnected,
  checkConnection
}; 