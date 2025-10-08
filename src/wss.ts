import WebSocket from 'ws';
import { Web3 } from 'web3';
import { Contract } from 'web3-eth-contract';
import { getRequestDeliverSignatures, getMarketplaceRequestSignature } from './utils';

// Simple sleep function
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export interface WebSocketMessage {
  jsonrpc: string;
  id: number;
  method?: string;
  params?: any;
  result?: string;
}

export interface LogEntry {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  transactionHash: string;
  transactionIndex: string;
  blockHash: string;
  logIndex: string;
  removed: boolean;
}

export interface TransactionReceipt {
  transactionHash: string;
  transactionIndex: string;
  blockHash: string;
  blockNumber: string;
  from: string;
  to: string;
  cumulativeGasUsed: string;
  gasUsed: string;
  contractAddress: string | null;
  logs: LogEntry[];
  logsBloom: string;
  status: string;
}

/**
 * Register event handlers for WebSocket subscriptions
 *
 * @deprecated This function is deprecated for marketplace interactions.
 * Marketplace requests now use async delivery monitoring via RPC polling (see delivery.ts).
 * This function is only maintained for backward compatibility with legacy mech interactions.
 *
 * @param ws WebSocket connection
 * @param contractAddress Contract address to watch
 * @param userAddress User's Ethereum address
 * @param requestSignature Topic signature for Request event
 * @param deliverSignature Topic signature for Deliver event
 */
export function registerEventHandlers(
  ws: WebSocket,
  contractAddress: string,
  userAddress: string,
  requestSignature: string,
  deliverSignature: string
): void {
  // Subscribe to Request events
  const requestSubscription: WebSocketMessage = {
    jsonrpc: '2.0',
    id: 1,
    method: 'eth_subscribe',
    params: [
      'logs',
      {
        address: contractAddress,
        topics: [
          requestSignature,
          [`0x${'0'.repeat(24)}${userAddress.slice(2)}`],
        ],
      },
    ],
  };

  ws.send(JSON.stringify(requestSubscription));

  // Subscribe to Deliver events
  const deliverSubscription: WebSocketMessage = {
    jsonrpc: '2.0',
    id: 2,
    method: 'eth_subscribe',
    params: [
      'logs',
      {
        address: contractAddress,
        topics: [deliverSignature],
      },
    ],
  };

  ws.send(JSON.stringify(deliverSubscription));
}

/**
 * Wait for transaction receipt
 * @param txHash Transaction hash
 * @param web3 Web3 instance
 * @returns Transaction receipt
 */
export async function waitForReceipt(txHash: string, web3: Web3): Promise<any> {
  while (true) {
    try {
      const receipt = await web3.eth.getTransactionReceipt(txHash);
      if (receipt) {
        return receipt;
      }
    } catch (error) {
      // Receipt not ready yet, continue waiting
    }
    await sleep(1000); // Wait 1 second before retrying
  }
}

/**
 * Watch for request ID from WebSocket events
 * @param ws WebSocket connection
 * @param mechContract Mech contract instance
 * @param web3 Web3 instance
 * @param requestSignature Topic signature for Request event
 * @returns Request ID
 */
export async function watchForRequestId(
  ws: WebSocket,
  mechContract: Contract<any>,
  web3: Web3,
  requestSignature: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const messageHandler = async (data: WebSocket.Data) => {
      try {
        const message: WebSocketMessage = JSON.parse(data.toString());
        
        if (message.params?.result?.transactionHash) {
          const txHash = message.params.result.transactionHash;
          const txReceipt = await waitForReceipt(txHash, web3);
          
          if (txReceipt.logs.length > 0) {
            const eventSignature = txReceipt.logs[0].topics[0];
            if (eventSignature === requestSignature) {
              // Process the receipt to get the request ID
              // For now, extract request ID from logs directly
              const logs = txReceipt.logs;
              if (logs.length > 0) {
                // Extract request ID from the log data
                const logData = logs[0].data;
                const requestId = logData.slice(2); // Remove '0x' prefix
                ws.removeListener('message', messageHandler);
                resolve(requestId);
              }
            }
          }
        }
      } catch (error) {
        reject(error);
      }
    };

    ws.on('message', messageHandler);
  });
}

/**
 * Watch for marketplace request IDs from transaction receipt
 * @param marketplaceContract Marketplace contract instance
 * @param web3 Web3 instance
 * @param txHash Transaction hash
 * @returns List of request IDs
 */
export async function watchForMarketplaceRequestIds(
  marketplaceContract: Contract<any>,
  web3: Web3,
  txHash: string
): Promise<string[]> {
  const txReceipt = await waitForReceipt(txHash, web3);
  const requestIds: string[] = [];
  const abi = marketplaceContract.options.jsonInterface || [];
  const web3Local = new Web3();
  
  for (const log of txReceipt.logs) {
    // Match MarketplaceRequest event by topic
    for (const item of abi) {
      if (item.type === 'event' && 'name' in item && item.name === 'MarketplaceRequest' && item.inputs) {
        let signature = 'MarketplaceRequest(';
        for (const input of item.inputs) signature += input.type + ',';
        signature = signature.slice(0, -1) + ')';
        const topic = Web3.utils.keccak256(signature);
        if (log.topics[0] === topic) {
          const decoded = web3Local.eth.abi.decodeLog(item.inputs, log.data, log.topics.slice(1));
          // Python expects requestIds as hex; ensure array handling
          const ids = Array.isArray(decoded.requestIds) ? decoded.requestIds : [decoded.requestIds];
          for (const id of ids) requestIds.push(String(id));
        }
      }
    }
  }
  return requestIds;
}

/**
 * Watch for data URL from WebSocket events
 * @param requestId Request ID to watch for
 * @param ws WebSocket connection
 * @param mechContract Mech contract instance
 * @param deliverSignature Topic signature for Deliver event
 * @param web3 Web3 instance
 * @returns Data URL or null
 */
export async function watchForDataUrlFromWss(
  requestId: string,
  ws: WebSocket,
  mechContract: Contract<any>,
  deliverSignature: string,
  web3: Web3
): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const messageHandler = async (data: WebSocket.Data) => {
      try {
        const message: WebSocketMessage = JSON.parse(data.toString());
        
        if (message.params?.result?.transactionHash) {
          const txHash = message.params.result.transactionHash;
          const txReceipt = await waitForReceipt(txHash, web3);
          
          if (txReceipt.logs.length > 0) {
            const eventSignature = txReceipt.logs[0].topics[0];
            if (eventSignature === deliverSignature) {
              // For now, extract data from logs directly
              const logs = txReceipt.logs;
              if (logs.length > 0) {
                const logData = logs[0].data;
                const dataHex = logData.slice(2); // Remove '0x' prefix
                ws.removeListener('message', messageHandler);
                resolve(`https://gateway.autonolas.tech/ipfs/f01701220${dataHex}`);
              }
            }
          }
        }
      } catch (error) {
        reject(error);
      }
    };

    ws.on('message', messageHandler);
    
    // Handle WebSocket connection errors
    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      ws.removeListener('message', messageHandler);
      reject(error);
    });

    ws.on('close', () => {
      console.error('WebSocket connection closed');
      console.error('Error: The WSS connection was likely closed by the remote party. Please, try using another WSS provider.');
      ws.removeListener('message', messageHandler);
      resolve(null);
    });
  });
}

/**
 * Watch for marketplace data URL from WebSocket events
 *
 * @deprecated This function is deprecated for marketplace interactions.
 * Use watchForMechDataUrl from delivery.ts instead, which uses async RPC polling
 * instead of WebSocket subscriptions.
 *
 * @param requestId Request ID to watch for
 * @param ws WebSocket connection
 * @param mechContract Mech contract instance
 * @param deliverSignature Topic signature for Deliver event
 * @param web3 Web3 instance
 * @returns Data URL or null
 */
export async function watchForMarketplaceDataUrlFromWss(
  requestId: string,
  ws: WebSocket,
  mechContract: Contract<any>,
  deliverSignature: string,
  web3: Web3
): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const messageHandler = async (data: WebSocket.Data) => {
      try {
        const message: WebSocketMessage = JSON.parse(data.toString());
        
        if (message.params?.result?.transactionHash) {
          const txHash = message.params.result.transactionHash;
          const txReceipt = await waitForReceipt(txHash, web3);
          
          const logs = txReceipt.logs;
          if (logs.length === 0) return;

          for (const log of logs) {
            if (log.topics && log.topics.length > 0 && log.topics[0] === deliverSignature) {
              // Compare requestId against indexed topic if present
              const indexedReq = log.topics[1]?.toLowerCase();
              const targetReq = requestId.toLowerCase();
              if (!indexedReq || (indexedReq !== targetReq && indexedReq !== `0x${targetReq.replace(/^0x/, '')}`)) {
                continue;
              }
              const deliverData = log.data.slice(2);
              ws.removeListener('message', messageHandler);
              resolve(`https://gateway.autonolas.tech/ipfs/f01701220${deliverData}`);
              return;
            }
          }
        }
      } catch (error) {
        reject(error);
      }
    };

    ws.on('message', messageHandler);
    
    // Handle WebSocket connection errors
    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      ws.removeListener('message', messageHandler);
      reject(error);
    });

    ws.on('close', () => {
      console.error('WebSocket connection closed');
      console.error('Error: The WSS connection was likely closed by the remote party. Please, try using another WSS provider.');
      ws.removeListener('message', messageHandler);
      resolve(null);
    });
  });
}

/**
 * Create WebSocket connection and wait for it to open
 * @param wssEndpoint WebSocket endpoint URL
 * @param timeoutMs Timeout in milliseconds (default: 10000)
 * @returns Promise that resolves to WebSocket connection when open
 */
export async function createWebSocketConnection(wssEndpoint: string, timeoutMs: number = 10000): Promise<WebSocket> {
  const ws = new WebSocket(wssEndpoint);

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error(`WebSocket connection timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    ws.on('open', () => {
      clearTimeout(timeout);
      resolve(ws);
    });

    ws.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

/**
 * Decode event log using contract ABI
 * @param log Log entry from blockchain
 * @param contract Contract instance with ABI
 * @returns Decoded event data
 */
export function decodeEventLog(log: LogEntry, contract: Contract<any>): any {
  try {
    // Find the event in the contract ABI that matches the first topic
    const eventTopic = log.topics[0];
    const events = contract.options.jsonInterface?.filter(item => item.type === 'event') || [];
    
    for (const event of events) {
      // Type guard to ensure we have an event with name and inputs
      if ('name' in event && 'inputs' in event && event.inputs) {
        // Calculate topic for this event
        let signature = event.name + '(';
        for (const input of event.inputs) {
          signature += input.type + ',';
        }
        signature = signature.slice(0, -1) + ')';
        const calculatedTopic = Web3.utils.keccak256(signature);
        
        if (calculatedTopic === eventTopic) {
          // Use Web3's decodeLog method instead
          const web3 = new Web3();
          return web3.eth.abi.decodeLog(event.inputs, log.data, log.topics.slice(1));
        }
      }
    }
    
    return null;
  } catch (error) {
    console.error('Error decoding event log:', error);
    return null;
  }
}

/**
 * Process Request event log
 * @param log Log entry
 * @param contract Contract instance
 * @returns Processed request data
 */
export function processRequestEvent(log: LogEntry, contract: Contract<any>): any {
  const decoded = decodeEventLog(log, contract);
  if (decoded) {
    return {
      requestId: decoded.requestId,
      requester: decoded.requester,
      tool: decoded.tool,
      data: decoded.data,
      blockNumber: log.blockNumber,
      transactionHash: log.transactionHash
    };
  }
  return null;
}

/**
 * Process Deliver event log
 * @param log Log entry
 * @param contract Contract instance
 * @returns Processed deliver data
 */
export function processDeliverEvent(log: LogEntry, contract: Contract<any>): any {
  const decoded = decodeEventLog(log, contract);
  if (decoded) {
    return {
      requestId: decoded.requestId,
      dataUrl: decoded.dataUrl,
      blockNumber: log.blockNumber,
      transactionHash: log.transactionHash
    };
  }
  return null;
}

/**
 * Process MarketplaceRequest event log
 * @param log Log entry
 * @param contract Contract instance
 * @returns Processed marketplace request data
 */
export function processMarketplaceRequestEvent(log: LogEntry, contract: Contract<any>): any {
  const decoded = decodeEventLog(log, contract);
  if (decoded) {
    return {
      requestIds: decoded.requestIds,
      requester: decoded.requester,
      blockNumber: log.blockNumber,
      transactionHash: log.transactionHash
    };
  }
  return null;
}

/**
 * Get event signatures for a contract
 * @param contract Contract instance
 * @returns Event signatures
 */
export function getContractEventSignatures(contract: Contract<any>): { [key: string]: string } {
  const abi = contract.options.jsonInterface || [];
  const signatures: { [key: string]: string } = {};
  
  for (const item of abi) {
    if (item.type === 'event' && 'name' in item && 'inputs' in item && item.inputs) {
      let signature = item.name + '(';
      for (const input of item.inputs) {
        signature += input.type + ',';
      }
      signature = signature.slice(0, -1) + ')';
      signatures[item.name] = Web3.utils.keccak256(signature);
    }
  }
  
  return signatures;
}
