const { 
  Connection, 
  PublicKey, 
  Keypair, 
  Transaction, 
  SystemProgram,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
  clusterApiUrl
} = require('@solana/web3.js');
const { 
  Token, 
  TOKEN_PROGRAM_ID, 
  ASSOCIATED_TOKEN_PROGRAM_ID 
} = require('@solana/spl-token');
const config = require('../../config/default');
const logger = require('../utils/logger');

let connection = null;
let wallet = null;
let tokenMintAddress = null;
let tokenAccount = null;

// Initialize Solana connection and wallet
async function init() {
  try {
    logger.info('Initializing Solana service', { network: config.solana.network });
    
    // Initialize connection
    const rpcUrl = config.solana.rpcUrl || clusterApiUrl(config.solana.network);
    connection = new Connection(rpcUrl, 'confirmed');
    
    // Check if connection is working
    await connection.getVersion();
    logger.info('Connected to Solana network', { endpoint: rpcUrl });
    
    // Initialize wallet from private key if provided
    if (config.solana.walletPrivateKey) {
      try {
        const secretKey = Uint8Array.from(JSON.parse(config.solana.walletPrivateKey));
        wallet = Keypair.fromSecretKey(secretKey);
        logger.info('Wallet initialized', { publicKey: wallet.publicKey.toString() });
        
        // Check wallet balance
        const balance = await connection.getBalance(wallet.publicKey);
        logger.info('Wallet balance', { 
          balance: `${balance / LAMPORTS_PER_SOL} SOL`,
          publicKey: wallet.publicKey.toString()
        });
      } catch (error) {
        logger.error('Failed to initialize wallet from private key', { error: error.message });
        // Create a new wallet as fallback
        wallet = Keypair.generate();
        logger.warn('Generated new wallet', { publicKey: wallet.publicKey.toString() });
      }
    } else {
      // Create a new wallet if no private key is provided
      wallet = Keypair.generate();
      logger.warn('No wallet private key provided, generated new wallet', { 
        publicKey: wallet.publicKey.toString() 
      });
    }
    
    // Initialize token mint address if provided
    if (config.solana.rewardTokenMint) {
      try {
        tokenMintAddress = new PublicKey(config.solana.rewardTokenMint);
        logger.info('Token mint address initialized', { 
          tokenMint: tokenMintAddress.toString() 
        });
        
        // Get token account info
        await initializeTokenAccount();
      } catch (error) {
        logger.error('Failed to initialize token mint', { error: error.message });
      }
    }
    
    return true;
  } catch (error) {
    logger.error('Failed to initialize Solana service', { error: error.message });
    throw new Error(`Solana initialization failed: ${error.message}`);
  }
}

// Initialize token account
async function initializeTokenAccount() {
  if (!connection || !wallet || !tokenMintAddress) {
    logger.warn('Cannot initialize token account: Missing connection, wallet, or token mint');
    return;
  }
  
  try {
    // Create token instance
    const token = new Token(
      connection,
      tokenMintAddress,
      TOKEN_PROGRAM_ID,
      wallet
    );
    
    // Get or create associated token account
    const associatedTokenAccount = await token.getOrCreateAssociatedAccountInfo(
      wallet.publicKey
    );
    
    tokenAccount = associatedTokenAccount.address;
    
    logger.info('Token account initialized', { 
      tokenAccount: tokenAccount.toString() 
    });
    
    // Get token balance
    const tokenBalance = await token.getAccountInfo(tokenAccount);
    logger.info('Token balance', { 
      balance: tokenBalance.amount.toNumber(),
      decimals: tokenBalance.decimals
    });
  } catch (error) {
    logger.error('Failed to initialize token account', { error: error.message });
  }
}

// Find associated token address
async function findAssociatedTokenAddress(walletAddress, tokenMint) {
  return (
    await PublicKey.findProgramAddress(
      [
        walletAddress.toBuffer(),
        TOKEN_PROGRAM_ID.toBuffer(),
        tokenMint.toBuffer(),
      ],
      ASSOCIATED_TOKEN_PROGRAM_ID
    )
  )[0];
}

// Send reward to the user
async function sendReward(amount) {
  if (!connection || !wallet) {
    throw new Error('Solana service not initialized');
  }
  
  try {
    // Get recipient wallet from config or use a default
    const recipientPublicKey = new PublicKey(
      process.env.RECIPIENT_WALLET || wallet.publicKey.toString()
    );
    
    // Check if token mint is available
    if (tokenMintAddress && tokenAccount) {
      // Send SPL token reward
      return await sendTokenReward(recipientPublicKey, amount);
    } else {
      // Send SOL reward as fallback
      return await sendSolReward(recipientPublicKey, amount);
    }
  } catch (error) {
    logger.error('Failed to send reward', { error: error.message });
    throw new Error(`Reward transaction failed: ${error.message}`);
  }
}

// Send SOL reward
async function sendSolReward(recipientPublicKey, amount) {
  // Convert amount to lamports
  const lamports = amount * LAMPORTS_PER_SOL;
  
  // Create a simple SOL transfer transaction
  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: recipientPublicKey,
      lamports
    })
  );
  
  // Send and confirm transaction
  const signature = await sendAndConfirmTransaction(
    connection,
    transaction,
    [wallet]
  );
  
  logger.info('SOL reward transaction sent', { 
    signature,
    amount: `${amount} SOL`,
    recipient: recipientPublicKey.toString()
  });
  
  return {
    txId: signature,
    amount,
    token: 'SOL'
  };
}

// Send SPL token reward
async function sendTokenReward(recipientPublicKey, amount) {
  // Create token instance
  const token = new Token(
    connection,
    tokenMintAddress,
    TOKEN_PROGRAM_ID,
    wallet
  );
  
  // Get token info to determine decimals
  const tokenInfo = await token.getMintInfo();
  const adjustedAmount = amount * Math.pow(10, tokenInfo.decimals);
  
  // Find or create recipient's associated token account
  const recipientTokenAccount = await findAssociatedTokenAddress(
    recipientPublicKey,
    tokenMintAddress
  );
  
  // Check if the recipient token account exists
  const recipientAccountInfo = await connection.getAccountInfo(recipientTokenAccount);
  
  let transaction = new Transaction();
  
  // If recipient token account doesn't exist, create it
  if (!recipientAccountInfo) {
    logger.info('Creating associated token account for recipient');
    transaction.add(
      Token.createAssociatedTokenAccountInstruction(
        ASSOCIATED_TOKEN_PROGRAM_ID,
        TOKEN_PROGRAM_ID,
        tokenMintAddress,
        recipientTokenAccount,
        recipientPublicKey,
        wallet.publicKey
      )
    );
  }
  
  // Add token transfer instruction
  transaction.add(
    Token.createTransferInstruction(
      TOKEN_PROGRAM_ID,
      tokenAccount,
      recipientTokenAccount,
      wallet.publicKey,
      [],
      adjustedAmount
    )
  );
  
  // Send and confirm transaction
  const signature = await sendAndConfirmTransaction(
    connection,
    transaction,
    [wallet]
  );
  
  logger.info('Token reward transaction sent', { 
    signature,
    amount: adjustedAmount,
    token: tokenMintAddress.toString(),
    recipient: recipientPublicKey.toString()
  });
  
  return {
    txId: signature,
    amount: adjustedAmount / Math.pow(10, tokenInfo.decimals),
    token: tokenMintAddress.toString()
  };
}

// Verify a transaction
async function verifyTransaction(signature) {
  try {
    const status = await connection.getSignatureStatus(signature);
    return {
      confirmed: status.value !== null && status.value.confirmationStatus === 'confirmed',
      status: status.value
    };
  } catch (error) {
    logger.error('Failed to verify transaction', { error: error.message });
    return { confirmed: false, error: error.message };
  }
}

// Get wallet public key
function getWalletPublicKey() {
  return wallet ? wallet.publicKey.toString() : null;
}

// Get connection status
function isConnected() {
  return !!connection;
}

module.exports = {
  init,
  sendReward,
  verifyTransaction,
  getWalletPublicKey,
  isConnected
}; 