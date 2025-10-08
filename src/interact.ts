import { Web3 } from 'web3';
import { Contract } from 'web3-eth-contract';
import WebSocket from 'ws';
import { get_mech_config, getPrivateKey, ConfirmationType } from './config';
import { queryAgentAddress } from './subgraph';
import { pushMetadataToIpfs } from './ipfs';
import { 
  createWebSocketConnection, 
  registerEventHandlers, 
  watchForRequestId, 
  watchForDataUrlFromWss 
} from './wss';
import { watchForDataUrlFromMech, isAcnAvailable, getAcnAvailabilityMessage } from './acn';
import { readFileSync } from 'fs';
import { join } from 'path';
import axios from 'axios';

// Constants
const MAX_RETRIES = 3;
const WAIT_SLEEP = 3.0;
const TIMEOUT = 300.0;

export interface InteractOptions {
  prompt: string;
  agentId: number;
  tool?: string;
  extraAttributes?: Record<string, any>;
  privateKeyPath?: string;
  confirmationType?: ConfirmationType;
  retries?: number;
  timeout?: number;
  sleep?: number;
  postOnly?: boolean;
  chainConfig?: string;
}

export interface InteractResult {
  transactionHash?: string;
  transactionUrl?: string;
  requestId?: string;
  data?: any;
}

/**
 * Verify or retrieve tool for agent
 * @param agentId Agent ID
 * @param web3 Web3 instance
 * @param tool Tool name (optional)
 * @param agentRegistryContract Agent registry contract address
 * @returns Tool name
 */
async function verifyOrRetrieveTool(
  agentId: number,
  web3: Web3,
  tool?: string,
  agentRegistryContract?: string
): Promise<string> {
  // For now, return the provided tool or a default
  // In a real implementation, this would query the agent registry
  if (tool) {
    return tool;
  }
  
  // Default tool selection (this would normally query available tools)
  return 'openai-gpt-3.5-turbo';
}

/**
 * Get contract ABI
 * @param abiPath Path to ABI file
 * @returns ABI object
 */
function getAbi(abiPath: string): any[] {
  try {
    const abiContent = readFileSync(abiPath, 'utf8');
    const data = JSON.parse(abiContent);
    if (typeof data === 'object' && data !== null && 'abi' in data) {
      return data.abi;
    }
    if (Array.isArray(data)) {
      return data;
    }
    throw new Error(`Invalid ABI format in ${abiPath}`);
  } catch (error) {
    throw new Error(`Failed to load ABI from ${abiPath}: ${error}`);
  }
}

/**
 * Get contract instance
 * @param contractAddress Contract address
 * @param abi Contract ABI
 * @param web3 Web3 instance
 * @returns Contract instance
 */
function getContract(contractAddress: string, abi: any[], web3: Web3): Contract<any> {
  return new web3.eth.Contract(abi, contractAddress);
}

/**
 * Get event signatures from ABI
 * @param abi Contract ABI
 * @returns Object with event signatures
 */
function getEventSignatures(abi: any[]): { request: string; deliver: string } {
  const signatures: { request: string; deliver: string } = { request: '', deliver: '' };
  
  for (const item of abi) {
    if (item.type === 'event') {
      if (item.name === 'Request') {
        signatures.request = `0x${item.name.toLowerCase()}`; // Simplified
      } else if (item.name === 'Deliver') {
        signatures.deliver = `0x${item.name.toLowerCase()}`; // Simplified
      }
    }
  }
  
  return signatures;
}

/**
 * Send request to mech contract
 * @param web3 Web3 instance
 * @param mechContract Mech contract instance
 * @param gasLimit Gas limit
 * @param prompt Request prompt
 * @param tool Tool name
 * @param extraAttributes Extra attributes
 * @param price Price for the request
 * @param retries Number of retries
 * @param timeout Timeout in seconds
 * @param sleep Sleep between retries
 * @returns Transaction hash
 */
async function sendRequest(
  web3: Web3,
  mechContract: Contract<any>,
  gasLimit: number,
  prompt: string,
  tool: string,
  extraAttributes?: Record<string, any>,
  price: number = 10_000_000_000_000_000,
  retries?: number,
  timeout?: number,
  sleep?: number
): Promise<string | null> {
  // Upload metadata to IPFS
  const [truncatedHash, cidString] = await pushMetadataToIpfs(prompt, tool, extraAttributes);
  console.log(`  - Prompt uploaded: https://gateway.autonolas.tech/ipfs/${cidString}`);
  
  const methodName = 'request';
  const methodArgs = { data: truncatedHash };
  
  const tries = retries || MAX_RETRIES;
  const timeoutMs = (timeout || TIMEOUT) * 1000;
  const sleepMs = (sleep || WAIT_SLEEP) * 1000;
  const deadline = Date.now() + timeoutMs;
  
  for (let attempt = 0; attempt < tries && Date.now() < deadline; attempt++) {
    try {
      // Get accounts from web3
      const accounts = await web3.eth.getAccounts();
      const from = accounts[0]; // Use first account
      
      // Build transaction
      const tx = mechContract.methods[methodName](methodArgs.data);
      
      // Send transaction
      const receipt = await tx.send({
        from,
        value: String(price),
        gas: String(gasLimit),
      });
      
      return receipt.transactionHash;
    } catch (error) {
      console.log(`Error occurred while sending the transaction: ${error}; Retrying in ${sleepMs}ms`);
      await new Promise(resolve => setTimeout(resolve, sleepMs));
    }
  }
  
  return null;
}

/**
 * Wait for data URL from various sources
 * @param requestId Request ID
 * @param ws WebSocket connection
 * @param mechContract Mech contract instance
 * @param subgraphUrl Subgraph URL
 * @param deliverSignature Deliver event signature
 * @param web3 Web3 instance
 * @param confirmationType Confirmation type
 * @returns Data URL or null
 */
async function waitForDataUrl(
  requestId: string,
  ws: WebSocket,
  mechContract: Contract<any>,
  subgraphUrl: string,
  deliverSignature: string,
  web3: Web3,
  confirmationType: ConfirmationType = ConfirmationType.WAIT_FOR_BOTH
): Promise<string | null> {
  // Check ACN availability and warn user if needed
  if (!isAcnAvailable() && (confirmationType === ConfirmationType.OFF_CHAIN || confirmationType === ConfirmationType.WAIT_FOR_BOTH)) {
    console.warn(getAcnAvailabilityMessage());
  }
  
  // Handle different confirmation types
  if (confirmationType === ConfirmationType.OFF_CHAIN) {
    // ACN not available, fall back to on-chain
    console.log('⚠️  OFF_CHAIN confirmation not available, falling back to ON_CHAIN confirmation');
    return await watchForDataUrlFromWss(
      requestId,
      ws,
      mechContract,
      deliverSignature,
      web3
    );
  } else if (confirmationType === ConfirmationType.ON_CHAIN) {
    // Use WebSocket-based on-chain confirmation
    return await watchForDataUrlFromWss(
      requestId,
      ws,
      mechContract,
      deliverSignature,
      web3
    );
  } else if (confirmationType === ConfirmationType.WAIT_FOR_BOTH) {
    // ACN not available, so WAIT_FOR_BOTH behaves as ON_CHAIN
    console.log('⚠️  WAIT_FOR_BOTH confirmation not fully available (ACN not supported), using ON_CHAIN confirmation');
    return await watchForDataUrlFromWss(
      requestId,
      ws,
      mechContract,
      deliverSignature,
      web3
    );
  }
  
  // Default fallback
  return await watchForDataUrlFromWss(
    requestId,
    ws,
    mechContract,
    deliverSignature,
    web3
  );
}

/**
 * Main interact function for legacy mechs
 * @param options Interaction options
 * @returns Interaction result
 */
export async function interact(options: InteractOptions): Promise<InteractResult | null> {
  const {
    prompt,
    agentId,
    tool,
    extraAttributes,
    privateKeyPath,
    confirmationType = ConfirmationType.WAIT_FOR_BOTH,
    retries,
    timeout,
    sleep,
    postOnly = false,
    chainConfig
  } = options;

  // Get configuration
  const mechConfig = get_mech_config(chainConfig);
  const ledgerConfig = mechConfig.ledger_config;
  
  // Query agent address
  const contractAddress = queryAgentAddress(agentId, chainConfig);
  if (!contractAddress) {
    throw new Error(`Agent with ID ${agentId} does not exist!`);
  }

  // Get private key from environment variable or file
  const privateKey = getPrivateKey(privateKeyPath);

  // Initialize Web3 and WebSocket
  const web3 = new Web3(mechConfig.rpc_url);
  const ws = await createWebSocketConnection(mechConfig.wss_endpoint);

  // Add account using private key
  const account = web3.eth.accounts.privateKeyToAccount(privateKey);
  web3.eth.accounts.wallet.add(account);

  // Verify or retrieve tool
  const selectedTool = await verifyOrRetrieveTool(
    agentId,
    web3,
    tool,
    mechConfig.agent_registry_contract
  );

  // Load contract ABI and create contract instance
  const abi = getAbi(join(__dirname, 'abis', 'AgentMech.json'));
  const mechContract = getContract(contractAddress, abi, web3);
  
  // Get event signatures
  const { request: requestSignature, deliver: deliverSignature } = getEventSignatures(abi);
  
  // Register event handlers
  registerEventHandlers(
    ws,
    contractAddress,
    account.address,
    requestSignature,
    deliverSignature
  );

  console.log('Sending Mech request...');
  const price = mechConfig.price || 10_000_000_000_000_000;
  
  // Send request
  const transactionDigest = await sendRequest(
    web3,
    mechContract,
    mechConfig.gas_limit,
    prompt,
    selectedTool,
    extraAttributes,
    price,
    retries,
    timeout,
    sleep
  );

  if (!transactionDigest) {
    console.log('Unable to send request');
    return null;
  }

  const transactionUrlFormatted = mechConfig.transaction_url.replace('{transaction_digest}', transactionDigest);
  console.log(`  - Transaction sent: ${transactionUrlFormatted}`);
  console.log('  - Waiting for transaction receipt...');

  // Watch for request ID
  const requestId = await watchForRequestId(
    ws,
    mechContract,
    web3,
    requestSignature
  );
  
  console.log(`  - Created on-chain request with ID ${requestId}`);
  console.log('');

  if (postOnly) {
    return {
      transactionHash: transactionDigest,
      transactionUrl: transactionUrlFormatted,
      requestId: requestId,
    };
  }

  console.log('Waiting for Mech deliver...');
  
  // Wait for data URL
  const dataUrl = await waitForDataUrl(
    requestId,
    ws,
    mechContract,
    mechConfig.subgraph_url,
    deliverSignature,
    web3,
    confirmationType
  );

  if (dataUrl) {
    console.log(`  - Data arrived: ${dataUrl}`);
    
    try {
      const response = await axios.get(`${dataUrl}/${requestId}`, { timeout: 60000 });
      const data = response.data;
      console.log('  - Data from agent:');
      console.log(JSON.stringify(data, null, 2));
      return data;
    } catch (error) {
      console.error('Error fetching data:', error);
      return null;
    }
  }

  return null;
}
