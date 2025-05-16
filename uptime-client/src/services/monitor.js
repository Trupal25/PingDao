const os = require('os');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const osUtils = require('os-utils');
const si = require('systeminformation');
const cron = require('node-cron');
const config = require('../../config/default');
const logger = require('../utils/logger');
const websocketService = require('./websocket');
const solanaService = require('./solana');

// Path for persisting monitoring data
const MONITORING_DATA_PATH = path.join(process.cwd(), 'data', 'monitoring.json');

// Store monitoring data
let monitoringData = {
  startTime: Date.now(),
  lastRewardTime: null,
  metrics: {
    cpu: {},
    memory: {},
    disk: {},
    network: {},
    uptime: {}
  },
  monitoringTasks: [],
  history: [],
  errors: {
    count: 0,
    lastError: null
  }
};

// Initialize monitoring
function init() {
  logger.info('Initializing monitoring service');
  
  // Load persisted data if it exists
  loadPersistedData();
  
  // Schedule metrics collection
  const intervalInMinutes = Math.ceil(config.monitoring.interval / 60000);
  const cronExpression = `*/${intervalInMinutes} * * * *`;
  
  cron.schedule(cronExpression, async () => {
    try {
      const metrics = await collectMetrics();
      processMetrics(metrics);
      
      // Reset error count on successful collection
      if (monitoringData.errors.count > 0) {
        logger.info('Metrics collection recovered after previous errors');
        monitoringData.errors.count = 0;
        monitoringData.errors.lastError = null;
      }
      
      // Persist data periodically
      persistData();
    } catch (error) {
      handleMetricsError(error);
    }
  });
  
  // Execute monitoring tasks if any are configured
  if (monitoringData.monitoringTasks.length > 0) {
    scheduleMonitoringTasks();
  }
  
  // Collect initial metrics
  collectMetrics().then(metrics => {
    processMetrics(metrics);
    logger.info('Initial metrics collected');
  }).catch(error => {
    handleMetricsError(error);
  });
  
  // Schedule periodic data persistence
  cron.schedule('*/30 * * * *', () => {
    persistData();
  });
  
  // Register shutdown handler for data persistence
  process.on('SIGTERM', () => persistData());
  process.on('SIGINT', () => persistData());
}

// Schedule monitoring tasks
function scheduleMonitoringTasks() {
  monitoringData.monitoringTasks.forEach(task => {
    // Parse interval to cron expression
    let cronExpression;
    if (typeof task.interval === 'number') {
      // Convert milliseconds to minutes for cron
      const minutes = Math.max(1, Math.ceil(task.interval / 60000));
      cronExpression = `*/${minutes} * * * *`;
    } else {
      // Use provided cron expression
      cronExpression = task.interval;
    }
    
    logger.info(`Scheduling monitoring task: ${task.name}`, {
      type: task.type,
      target: task.target,
      cron: cronExpression
    });
    
    cron.schedule(cronExpression, async () => {
      try {
        const result = await executeMonitoringTask(task);
        
        // Report task result to main application
        websocketService.send('taskResult', {
          taskId: task.id,
          taskType: task.type,
          target: task.target,
          result: result,
          timestamp: Date.now()
        });
        
        // Store result in history
        task.lastResult = result;
        task.lastRunTime = Date.now();
        
        // Persist updated task data
        persistData();
      } catch (error) {
        logger.error(`Error executing monitoring task: ${task.name}`, {
          error: error.message,
          task
        });
        
        // Report error to main application
        websocketService.send('taskError', {
          taskId: task.id,
          taskType: task.type,
          target: task.target,
          error: error.message,
          timestamp: Date.now()
        });
      }
    });
  });
}

// Execute a monitoring task
async function executeMonitoringTask(task) {
  logger.info(`Executing monitoring task: ${task.name}`);
  
  switch (task.type) {
    case 'http':
      return await checkHttpEndpoint(task);
    case 'ping':
      return await checkPing(task);
    case 'tcp':
      return await checkTcpPort(task);
    case 'dns':
      return await checkDns(task);
    default:
      throw new Error(`Unknown task type: ${task.type}`);
  }
}

// Check HTTP endpoint
async function checkHttpEndpoint(task) {
  const startTime = Date.now();
  
  try {
    // Set timeout and other options
    const options = {
      timeout: task.timeout || 10000,
      method: task.method || 'GET',
      headers: task.headers || {},
      validateStatus: null // Don't throw on any status code
    };
    
    // Add request body if specified
    if (task.body && (options.method === 'POST' || options.method === 'PUT')) {
      options.data = task.body;
    }
    
    // Execute request
    const response = await axios(task.target, options);
    
    // Calculate response time
    const responseTime = Date.now() - startTime;
    
    // Check if status code is valid
    const validStatusCodes = task.validStatusCodes || [200];
    const isValidStatus = validStatusCodes.includes(response.status);
    
    // Check response content if keyword is specified
    let contentValid = true;
    if (task.keyword && response.data) {
      const responseText = typeof response.data === 'string' 
        ? response.data 
        : JSON.stringify(response.data);
      contentValid = responseText.includes(task.keyword);
    }
    
    // Check response time threshold
    const isResponseTimeValid = !task.maxResponseTime || responseTime <= task.maxResponseTime;
    
    return {
      success: isValidStatus && contentValid && isResponseTimeValid,
      statusCode: response.status,
      responseTime,
      contentValid,
      responseTimeValid: isResponseTimeValid,
      timestamp: Date.now()
    };
  } catch (error) {
    // Handle network errors
    return {
      success: false,
      error: error.message,
      responseTime: Date.now() - startTime,
      timestamp: Date.now()
    };
  }
}

// Check ping
async function checkPing(task) {
  // Implementation for ping check
  // This would typically use a ping library
  return {
    success: false,
    error: 'Ping check not implemented yet',
    timestamp: Date.now()
  };
}

// Check TCP port
async function checkTcpPort(task) {
  // Implementation for TCP port check
  // This would typically use a TCP connection library
  return {
    success: false,
    error: 'TCP check not implemented yet',
    timestamp: Date.now()
  };
}

// Check DNS
async function checkDns(task) {
  // Implementation for DNS check
  // This would typically use a DNS resolution library
  return {
    success: false,
    error: 'DNS check not implemented yet',
    timestamp: Date.now()
  };
}

// Add a new monitoring task
function addMonitoringTask(task) {
  // Generate ID if not provided
  if (!task.id) {
    task.id = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  // Set default name if not provided
  if (!task.name) {
    task.name = `${task.type}_${task.target}`;
  }
  
  // Add task to monitoring tasks
  monitoringData.monitoringTasks.push(task);
  
  // Schedule the new task
  scheduleMonitoringTask(task);
  
  // Persist updated tasks
  persistData();
  
  return task.id;
}

// Schedule a single monitoring task
function scheduleMonitoringTask(task) {
  // Parse interval to cron expression
  let cronExpression;
  if (typeof task.interval === 'number') {
    // Convert milliseconds to minutes for cron
    const minutes = Math.max(1, Math.ceil(task.interval / 60000));
    cronExpression = `*/${minutes} * * * *`;
  } else {
    // Use provided cron expression
    cronExpression = task.interval;
  }
  
  logger.info(`Scheduling monitoring task: ${task.name}`, {
    type: task.type,
    target: task.target,
    cron: cronExpression
  });
  
  cron.schedule(cronExpression, async () => {
    try {
      const result = await executeMonitoringTask(task);
      
      // Report task result to main application
      websocketService.send('taskResult', {
        taskId: task.id,
        taskType: task.type,
        target: task.target,
        result: result,
        timestamp: Date.now()
      });
      
      // Store result in history
      task.lastResult = result;
      task.lastRunTime = Date.now();
      
      // Persist updated task data
      persistData();
    } catch (error) {
      logger.error(`Error executing monitoring task: ${task.name}`, {
        error: error.message,
        task
      });
    }
  });
}

// Remove a monitoring task
function removeMonitoringTask(taskId) {
  const index = monitoringData.monitoringTasks.findIndex(task => task.id === taskId);
  
  if (index !== -1) {
    monitoringData.monitoringTasks.splice(index, 1);
    persistData();
    return true;
  }
  
  return false;
}

// Load persisted monitoring data
function loadPersistedData() {
  try {
    // Create data directory if it doesn't exist
    const dataDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    if (fs.existsSync(MONITORING_DATA_PATH)) {
      const data = JSON.parse(fs.readFileSync(MONITORING_DATA_PATH, 'utf8'));
      
      // Restore persisted data
      if (data) {
        // Keep the current startTime if restarting
        const currentStartTime = monitoringData.startTime;
        
        // Merge persisted data with default structure
        monitoringData = {
          ...monitoringData,
          ...data,
          // Always use the earlier start time
          startTime: Math.min(currentStartTime, data.startTime || currentStartTime)
        };
        
        logger.info('Loaded persisted monitoring data', {
          historyEntries: monitoringData.history.length,
          taskCount: monitoringData.monitoringTasks ? monitoringData.monitoringTasks.length : 0,
          lastRewardTime: monitoringData.lastRewardTime ? 
            new Date(monitoringData.lastRewardTime).toISOString() : 'none'
        });
      }
    } else {
      logger.info('No persisted monitoring data found, starting fresh');
    }
  } catch (error) {
    logger.error('Failed to load persisted monitoring data', { error: error.message });
  }
}

// Persist monitoring data to disk
function persistData() {
  try {
    // Create a copy of the data to persist
    const dataToPersist = {
      startTime: monitoringData.startTime,
      lastRewardTime: monitoringData.lastRewardTime,
      history: monitoringData.history,
      monitoringTasks: monitoringData.monitoringTasks,
      // Don't persist current metrics as they'll be refreshed
    };
    
    fs.writeFileSync(MONITORING_DATA_PATH, JSON.stringify(dataToPersist, null, 2));
    logger.debug('Monitoring data persisted to disk');
    return true;
  } catch (error) {
    logger.error('Failed to persist monitoring data', { error: error.message });
    return false;
  }
}

// Handle metrics collection errors
function handleMetricsError(error) {
  monitoringData.errors.count++;
  monitoringData.errors.lastError = {
    timestamp: Date.now(),
    message: error.message
  };
  
  logger.error('Error collecting metrics', { 
    error: error.message, 
    count: monitoringData.errors.count 
  });
  
  // If we have persistent errors, try to recover
  if (monitoringData.errors.count >= 5) {
    logger.warn('Persistent metrics collection errors detected, attempting recovery');
    
    // Try to reconnect WebSocket if that might be the issue
    if (!websocketService.isSocketConnected()) {
      logger.info('WebSocket disconnected, attempting to reconnect');
      websocketService.connect();
    }
  }
}

// Collect system metrics
async function collectMetrics() {
  const metrics = {
    timestamp: Date.now(),
    system: {
      platform: os.platform(),
      arch: os.arch(),
      hostname: os.hostname(),
      uptime: os.uptime()
    },
    cpu: {},
    memory: {},
    disk: {},
    network: {}
  };
  
  try {
    // Collect CPU metrics
    if (config.monitoring.metrics.cpu) {
      const cpuLoad = await new Promise((resolve) => {
        osUtils.cpuUsage((value) => {
          resolve(value);
        });
      });
      
      metrics.cpu = {
        usage: cpuLoad * 100,
        cores: os.cpus().length,
        model: os.cpus()[0].model,
        speed: os.cpus()[0].speed
      };
    }
    
    // Collect memory metrics
    if (config.monitoring.metrics.memory) {
      const totalMemory = os.totalmem();
      const freeMemory = os.freemem();
      const usedMemory = totalMemory - freeMemory;
      
      metrics.memory = {
        total: totalMemory,
        free: freeMemory,
        used: usedMemory,
        usagePercentage: (usedMemory / totalMemory) * 100
      };
    }
    
    // Collect disk metrics with timeout protection
    if (config.monitoring.metrics.disk) {
      try {
        const diskInfo = await Promise.race([
          si.fsSize(),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Disk metrics collection timeout')), 5000)
          )
        ]);
        
        metrics.disk = diskInfo.map(disk => ({
          fs: disk.fs,
          type: disk.type,
          size: disk.size,
          used: disk.used,
          available: disk.available,
          usagePercentage: disk.use
        }));
      } catch (error) {
        logger.warn('Failed to collect disk metrics', { error: error.message });
        metrics.disk = { error: error.message };
      }
    }
    
    // Collect network metrics with timeout protection
    if (config.monitoring.metrics.network) {
      try {
        const networkStats = await Promise.race([
          si.networkStats(),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Network metrics collection timeout')), 5000)
          )
        ]);
        
        metrics.network = networkStats.map(net => ({
          interface: net.iface,
          rxBytes: net.rx_bytes,
          txBytes: net.tx_bytes,
          rxErrors: net.rx_errors,
          txErrors: net.tx_errors
        }));
      } catch (error) {
        logger.warn('Failed to collect network metrics', { error: error.message });
        metrics.network = { error: error.message };
      }
    }
    
    // Collect uptime metrics
    if (config.monitoring.metrics.uptime) {
      metrics.uptime = {
        system: os.uptime(),
        process: process.uptime(),
        client: (Date.now() - monitoringData.startTime) / 1000
      };
    }
    
    // Add monitoring tasks status if any
    if (monitoringData.monitoringTasks.length > 0) {
      metrics.tasks = monitoringData.monitoringTasks.map(task => ({
        id: task.id,
        name: task.name,
        type: task.type,
        target: task.target,
        lastRunTime: task.lastRunTime,
        lastResult: task.lastResult ? {
          success: task.lastResult.success,
          timestamp: task.lastResult.timestamp
        } : null
      }));
    }
    
    return metrics;
  } catch (error) {
    logger.error('Error in collectMetrics', { error: error.message });
    throw error;
  }
}

// Process collected metrics
function processMetrics(metrics) {
  // Update monitoring data
  monitoringData.metrics = {
    cpu: metrics.cpu,
    memory: metrics.memory,
    disk: metrics.disk,
    network: metrics.network,
    uptime: metrics.uptime
  };
  
  // Keep history (last 100 entries)
  monitoringData.history.push({
    timestamp: metrics.timestamp,
    cpu: metrics.cpu.usage,
    memory: metrics.memory.usagePercentage,
    uptime: metrics.uptime.client
  });
  
  if (monitoringData.history.length > 100) {
    monitoringData.history.shift();
  }
  
  // Send metrics to main application via WebSocket
  if (websocketService.isSocketConnected()) {
    websocketService.sendMetrics(metrics);
  } else {
    logger.warn('WebSocket disconnected, metrics not sent to main application');
  }
  
  logger.info('Metrics collected and processed', {
    cpu: `${metrics.cpu.usage.toFixed(2)}%`,
    memory: `${metrics.memory.usagePercentage.toFixed(2)}%`,
    uptime: `${metrics.uptime.client.toFixed(2)}s`
  });
}

// Distribute rewards based on uptime
async function distributeRewards() {
  // Check if it's time to distribute rewards
  const now = Date.now();
  if (monitoringData.lastRewardTime && 
      (now - monitoringData.lastRewardTime) < config.solana.rewardInterval) {
    logger.info('Not yet time for reward distribution');
    return;
  }
  
  // Calculate uptime percentage since last reward
  const totalTime = monitoringData.lastRewardTime ? 
    now - monitoringData.lastRewardTime : 
    now - monitoringData.startTime;
  
  const uptimePercentage = (monitoringData.metrics.uptime.client * 1000 / totalTime) * 100;
  
  // Only reward if uptime is above 90%
  if (uptimePercentage >= 90) {
    try {
      // Calculate reward amount based on uptime percentage
      const rewardMultiplier = uptimePercentage / 100;
      const rewardAmount = config.solana.rewardAmount * rewardMultiplier;
      
      // Send reward transaction
      const txId = await solanaService.sendReward(rewardAmount);
      
      logger.info('Reward distributed successfully', {
        uptime: `${uptimePercentage.toFixed(2)}%`,
        reward: rewardAmount,
        txId
      });
      
      // Update last reward time
      monitoringData.lastRewardTime = now;
    } catch (error) {
      logger.error('Failed to distribute rewards', { error: error.message });
    }
  } else {
    logger.info('Uptime too low for rewards', { uptime: `${uptimePercentage.toFixed(2)}%` });
  }
}

// Get current metrics
async function getMetrics() {
  // If we don't have metrics yet, collect them
  if (!monitoringData.metrics.cpu.usage) {
    try {
      const metrics = await collectMetrics();
      processMetrics(metrics);
    } catch (error) {
      logger.error('Error collecting metrics for API request', { error: error.message });
    }
  }
  
  return {
    current: monitoringData.metrics,
    history: monitoringData.history,
    uptime: {
      since: monitoringData.startTime,
      lastReward: monitoringData.lastRewardTime
    },
    tasks: monitoringData.monitoringTasks.map(task => ({
      id: task.id,
      name: task.name,
      type: task.type,
      target: task.target,
      lastRunTime: task.lastRunTime,
      lastResult: task.lastResult
    })),
    status: {
      errors: monitoringData.errors.count,
      lastError: monitoringData.errors.lastError,
      healthy: monitoringData.errors.count < 3
    }
  };
}

module.exports = {
  init,
  collectMetrics,
  getMetrics,
  addMonitoringTask,
  removeMonitoringTask
}; 