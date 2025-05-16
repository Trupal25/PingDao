const axios = require('axios');
const fs = require('fs');
const path = require('path');
const config = require('../../config/default');
const logger = require('../utils/logger');

// User data storage path
const USER_DATA_PATH = path.join(process.cwd(), 'data', 'user.json');

// Default user data
let userData = {
  registered: false,
  publicKey: null,
  nodeId: null,
  geolocation: null,
  registrationTime: null,
  lastPing: null
};

// Initialize user service
function init() {
  logger.info('Initializing user service');
  
  // Create data directory if it doesn't exist
  const dataDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    logger.info('Created data directory');
  }
  
  // Load user data if exists
  if (fs.existsSync(USER_DATA_PATH)) {
    try {
      userData = JSON.parse(fs.readFileSync(USER_DATA_PATH, 'utf8'));
      logger.info('Loaded existing user data', { 
        publicKey: userData.publicKey, 
        registered: userData.registered 
      });
    } catch (error) {
      logger.error('Failed to load user data', { error: error.message });
    }
  }
}

// Save user data to file
function saveUserData() {
  try {
    fs.writeFileSync(USER_DATA_PATH, JSON.stringify(userData, null, 2));
    logger.debug('User data saved');
    return true;
  } catch (error) {
    logger.error('Failed to save user data', { error: error.message });
    return false;
  }
}

// Register user with main application server
async function registerUser(userInfo) {
  try {
    logger.info('Registering with main application server');
    
    // Get geolocation data
    const geoData = await getGeolocation();
    
    // Prepare registration data
    const registrationData = {
      publicKey: userInfo.publicKey,
      nodeType: 'monitor',
      system: {
        os: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        hostname: require('os').hostname()
      },
      geolocation: geoData,
      capabilities: {
        metrics: config.monitoring.metrics,
        interval: config.monitoring.interval
      }
    };
    
    // Send registration request to main application server
    const response = await axios.post(
      `${config.mainApp.apiUrl}/nodes/register`, 
      registrationData,
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );
    
    if (response.data && response.data.success) {
      // Update user data
      userData = {
        registered: true,
        publicKey: userInfo.publicKey,
        nodeId: response.data.nodeId,
        geolocation: geoData,
        registrationTime: Date.now(),
        lastPing: Date.now()
      };
      
      // Save user data
      saveUserData();
      
      logger.info('User registered successfully with main application', { 
        nodeId: userData.nodeId,
        publicKey: userData.publicKey 
      });
      
      return {
        success: true,
        nodeId: userData.nodeId
      };
    } else {
      throw new Error(response.data.message || 'Registration failed');
    }
  } catch (error) {
    logger.error('Failed to register with main application', { error: error.message });
    return {
      success: false,
      error: error.message
    };
  }
}

// Update user status with main application server
async function updateStatus() {
  if (!userData.registered || !userData.nodeId) {
    logger.warn('Cannot update status: User not registered');
    return false;
  }
  
  try {
    // Prepare status update data
    const statusData = {
      nodeId: userData.nodeId,
      publicKey: userData.publicKey,
      status: 'active',
      timestamp: Date.now()
    };
    
    // Send status update to main application server
    const response = await axios.post(
      `${config.mainApp.apiUrl}/nodes/status`, 
      statusData,
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );
    
    if (response.data && response.data.success) {
      // Update last ping time
      userData.lastPing = Date.now();
      saveUserData();
      
      logger.debug('Status updated successfully');
      return true;
    } else {
      throw new Error(response.data.message || 'Status update failed');
    }
  } catch (error) {
    logger.error('Failed to update status', { error: error.message });
    return false;
  }
}

// Get user's geolocation
async function getGeolocation() {
  try {
    // Use IP-based geolocation service
    const response = await axios.get('https://ipapi.co/json/');
    
    if (response.data) {
      const geoData = {
        ip: response.data.ip,
        city: response.data.city,
        region: response.data.region,
        country: response.data.country_name,
        countryCode: response.data.country_code,
        latitude: response.data.latitude,
        longitude: response.data.longitude,
        timezone: response.data.timezone
      };
      
      logger.info('Retrieved geolocation data', { 
        city: geoData.city, 
        country: geoData.country 
      });
      
      return geoData;
    }
  } catch (error) {
    logger.error('Failed to get geolocation', { error: error.message });
    // Return minimal geolocation data if API fails
    return {
      ip: null,
      city: null,
      country: null,
      latitude: null,
      longitude: null
    };
  }
}

// Check if user is registered
function isRegistered() {
  return userData.registered;
}

// Get user data
function getUserData() {
  return { ...userData };
}

module.exports = {
  init,
  registerUser,
  updateStatus,
  getGeolocation,
  isRegistered,
  getUserData
}; 