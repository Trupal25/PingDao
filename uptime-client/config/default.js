module.exports = {
  // Client configuration
  client: {
    port: process.env.PORT || 3002,
    host: process.env.HOST || 'localhost'
  },
  
  // Main application configuration
  mainApp: {
    apiUrl: process.env.MAIN_APP_API_URL || 'http://localhost:3001/api',
    wsUrl: process.env.MAIN_APP_WS_URL || 'http://localhost:3001'
  },
  
  // Uptime Kuma server configuration (legacy)
  uptimeKuma: {
    url: process.env.UPTIME_KUMA_URL || 'http://localhost:3001',
    apiKey: process.env.UPTIME_KUMA_API_KEY || '',
  },
  
  // Monitoring configuration
  monitoring: {
    interval: process.env.MONITORING_INTERVAL || 60000, // 1 minute in milliseconds
    metrics: {
      cpu: true,
      memory: true,
      disk: true,
      network: true,
      uptime: true
    }
  },
  
  // Solana configuration
  solana: {
    network: process.env.SOLANA_NETWORK || 'devnet', // 'devnet', 'testnet', or 'mainnet-beta'
    rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com',
    walletPrivateKey: process.env.SOLANA_WALLET_PRIVATE_KEY || '',
    rewardTokenMint: process.env.SOLANA_REWARD_TOKEN_MINT || '',
    rewardAmount: process.env.SOLANA_REWARD_AMOUNT || 0.1, // Amount of tokens to reward per successful monitoring period
    rewardInterval: process.env.SOLANA_REWARD_INTERVAL || 86400000 // 24 hours in milliseconds
  },
  
  // User configuration
  user: {
    publicKey: process.env.USER_PUBLIC_KEY || '',
    autoRegister: process.env.AUTO_REGISTER === 'true' || false,
    statusUpdateInterval: process.env.STATUS_UPDATE_INTERVAL || 300000 // 5 minutes in milliseconds
  },
  
  // WebSocket configuration
  websocket: {
    reconnectInterval: process.env.WS_RECONNECT_INTERVAL || 5000, // 5 seconds in milliseconds
    maxReconnectAttempts: process.env.WS_MAX_RECONNECT_ATTEMPTS || 10
  },
  
  // Logging configuration
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    file: process.env.LOG_FILE || 'uptime-client.log'
  }
}; 