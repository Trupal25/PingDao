# Uptime Client

A client-side monitoring tool for decentralized physical infrastructure (DePIN) with Solana blockchain incentives. This client connects to a central application server, reports system metrics, and receives rewards through Solana tokens for maintaining high uptime.

## Features

- System monitoring (CPU, memory, disk, network, uptime)
- Geolocation tracking for distributed node mapping
- Real-time communication via WebSockets with main application
- Solana blockchain integration for incentives
- SPL token support for custom token rewards
- Automatic reward distribution based on uptime
- Local API for accessing metrics and status

## Resilience Features

- Persistent metrics storage between client restarts
- Exponential backoff with jitter for connection retries
- Graceful shutdown and recovery mechanisms
- Message queuing for high-priority communications
- Automatic re-registration if node becomes unknown to server
- Timeout protection for resource-intensive operations
- Periodic connection health checks

## Requirements

- Node.js 18 or higher
- Internet connection for geolocation and blockchain operations
- Solana wallet (for receiving rewards)
- Access to a running main application server

## Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/uptime-client.git
cd uptime-client
```

2. Run the setup script:
```bash
npm run setup
```

The setup script will guide you through the configuration process, including:
- Client configuration
- Main application server connection details
- Solana wallet setup
- Monitoring parameters
- Reward settings

3. Start the client:
```bash
npm start
```

## Registration Process

The client automatically registers with the main application server using your Solana public key. The registration process:

1. Collects system information and geolocation data
2. Sends registration request to the main application
3. Receives a unique node ID from the main application
4. Establishes a WebSocket connection for real-time communication
5. Begins monitoring and reporting metrics

You can configure auto-registration by setting `AUTO_REGISTER=true` in your `.env` file and providing your public key.

## Client API Endpoints

- `GET /health`: Check if the client is running
- `GET /metrics`: Get current system metrics
- `GET /status`: Get registration status and connection information

## WebSocket Communication

The client establishes a WebSocket connection to the main application for real-time communication. This enables:
- Immediate metric reporting
- Task assignments from the main application
- Real-time reward notifications
- Low-latency status updates

## Solana Integration

The client integrates with Solana blockchain to receive rewards for maintaining high uptime. Rewards can be distributed in:
- Native SOL tokens
- Custom SPL tokens (requires token mint address)

To set up Solana rewards:

1. Create a Solana wallet
2. Configure the network and RPC URL in your `.env` file
3. Provide your public key during setup

## Geolocation

The client automatically detects its geographical location to help map the distribution of nodes in the DePIN network. This information is sent during registration and includes:
- City and country
- Latitude and longitude
- IP address (for network topology)

## Configuration

Configuration is loaded from environment variables and defaults defined in `config/default.js`.

Key configuration options:

- `mainApp.apiUrl`: URL of the main application API server
- `mainApp.wsUrl`: Main application WebSocket server URL
- `user.publicKey`: Your Solana public key for receiving rewards
- `monitoring.interval`: How often to collect metrics (in milliseconds)
- `solana.rewardAmount`: Amount to reward per period
- `solana.rewardInterval`: How often to distribute rewards (in milliseconds)

## Development

For development with auto-restart:

```bash
npm run dev
```

## License

MIT 