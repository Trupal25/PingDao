#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execSync } = require('child_process');
const crypto = require('crypto');
const axios = require('axios');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Generate a random string for API key
function generateApiKey() {
  return crypto.randomBytes(16).toString('hex');
}

// Ask a question and get user input
function askQuestion(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}

// Get user's geolocation
async function getGeolocation() {
  try {
    console.log('Fetching geolocation data...');
    const response = await axios.get('https://ipapi.co/json/');
    
    if (response.data) {
      const geoData = {
        ip: response.data.ip,
        city: response.data.city,
        region: response.data.region,
        country: response.data.country_name,
        countryCode: response.data.country_code,
        latitude: response.data.latitude,
        longitude: response.data.longitude
      };
      
      console.log(`Location detected: ${geoData.city}, ${geoData.country} (${geoData.latitude}, ${geoData.longitude})`);
      return geoData;
    }
  } catch (error) {
    console.error('Failed to get geolocation:', error.message);
  }
  
  return null;
}

// Main setup function
async function setup() {
  console.log('Uptime Client Setup');
  console.log('===================');
  
  // Install dependencies
  console.log('\nInstalling dependencies...');
  try {
    execSync('npm install', { stdio: 'inherit' });
    console.log('Dependencies installed successfully.');
  } catch (error) {
    console.error('Failed to install dependencies:', error.message);
    process.exit(1);
  }
  
  // Create data directory
  const dataDir = path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    console.log('Created data directory');
  }
  
  // Get geolocation
  const geoData = await getGeolocation();
  
  // Create .env file
  console.log('\nConfiguring environment variables...');
  
  // Default values
  const defaults = {
    PORT: '3002',
    HOST: 'localhost',
    MAIN_APP_API_URL: 'http://localhost:3001/api',
    MAIN_APP_WS_URL: 'http://localhost:3001',
    MONITORING_INTERVAL: '60000',
    SOLANA_NETWORK: 'devnet',
    SOLANA_RPC_URL: 'https://api.devnet.solana.com',
    SOLANA_REWARD_AMOUNT: '0.1',
    SOLANA_REWARD_INTERVAL: '86400000',
    AUTO_REGISTER: 'true',
    STATUS_UPDATE_INTERVAL: '300000'
  };
  
  // Get user input
  const config = {};
  
  // Client configuration
  console.log('\n-- Client Configuration --');
  config.PORT = await askQuestion(`Port (default: ${defaults.PORT}): `) || defaults.PORT;
  config.HOST = await askQuestion(`Host (default: ${defaults.HOST}): `) || defaults.HOST;
  
  // Main application configuration
  console.log('\n-- Main Application Configuration --');
  config.MAIN_APP_API_URL = await askQuestion(`Main Application API URL (default: ${defaults.MAIN_APP_API_URL}): `) || defaults.MAIN_APP_API_URL;
  config.MAIN_APP_WS_URL = await askQuestion(`Main Application WebSocket URL (default: ${defaults.MAIN_APP_WS_URL}): `) || defaults.MAIN_APP_WS_URL;
  
  // User configuration
  console.log('\n-- User Configuration --');
  config.USER_PUBLIC_KEY = await askQuestion('Your Solana Public Key (required): ');
  
  while (!config.USER_PUBLIC_KEY) {
    console.log('Public key is required for registration and receiving rewards.');
    config.USER_PUBLIC_KEY = await askQuestion('Your Solana Public Key (required): ');
  }
  
  config.AUTO_REGISTER = await askQuestion(`Auto-register on startup? (true/false, default: ${defaults.AUTO_REGISTER}): `) || defaults.AUTO_REGISTER;
  
  // Solana configuration
  console.log('\n-- Solana Configuration --');
  config.SOLANA_NETWORK = await askQuestion(`Solana Network (default: ${defaults.SOLANA_NETWORK}): `) || defaults.SOLANA_NETWORK;
  config.SOLANA_RPC_URL = await askQuestion(`Solana RPC URL (default: ${defaults.SOLANA_RPC_URL}): `) || defaults.SOLANA_RPC_URL;
  
  const useTokens = await askQuestion('Do you want to configure SPL token rewards? (y/n): ');
  if (useTokens.toLowerCase() === 'y') {
    config.SOLANA_REWARD_TOKEN_MINT = await askQuestion('Token Mint Address: ');
    config.SOLANA_WALLET_PRIVATE_KEY = await askQuestion('Wallet Private Key (for sending rewards): ');
  }
  
  config.SOLANA_REWARD_AMOUNT = await askQuestion(`Reward Amount (default: ${defaults.SOLANA_REWARD_AMOUNT}): `) || defaults.SOLANA_REWARD_AMOUNT;
  config.SOLANA_REWARD_INTERVAL = await askQuestion(`Reward Interval in ms (default: ${defaults.SOLANA_REWARD_INTERVAL}): `) || defaults.SOLANA_REWARD_INTERVAL;
  
  // Monitoring configuration
  console.log('\n-- Monitoring Configuration --');
  config.MONITORING_INTERVAL = await askQuestion(`Monitoring Interval in ms (default: ${defaults.MONITORING_INTERVAL}): `) || defaults.MONITORING_INTERVAL;
  config.STATUS_UPDATE_INTERVAL = await askQuestion(`Status Update Interval in ms (default: ${defaults.STATUS_UPDATE_INTERVAL}): `) || defaults.STATUS_UPDATE_INTERVAL;
  
  // Logging configuration
  console.log('\n-- Logging Configuration --');
  config.LOG_LEVEL = await askQuestion('Log Level (error, warn, info, debug, default: info): ') || 'info';
  config.LOG_FILE = await askQuestion('Log File (default: uptime-client.log): ') || 'uptime-client.log';
  
  // Generate .env file content
  let envContent = '';
  for (const [key, value] of Object.entries(config)) {
    if (value) {
      envContent += `${key}=${value}\n`;
    }
  }
  
  // Write .env file
  try {
    fs.writeFileSync(path.join(__dirname, '.env'), envContent);
    console.log('\n.env file created successfully.');
  } catch (error) {
    console.error('Failed to create .env file:', error.message);
    process.exit(1);
  }
  
  console.log('\nSetup completed successfully!');
  console.log(`\nYou can now start the client with: npm start`);
  console.log(`The client will be available at: http://${config.HOST}:${config.PORT}`);
  console.log(`\nThis client will connect to the main application at: ${config.MAIN_APP_API_URL}`);
  console.log('\nAvailable client endpoints:');
  console.log('- GET  /health   - Check if the client is running');
  console.log('- GET  /metrics  - Get current system metrics');
  console.log('- GET  /status   - Get registration status and connection info');
  
  rl.close();
}

// Run setup
setup().catch(error => {
  console.error('Setup failed:', error);
  process.exit(1);
}); 