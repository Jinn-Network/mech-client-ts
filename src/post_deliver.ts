import { Web3 } from 'web3';
import { Contract } from 'web3-eth-contract';
import { readFileSync } from 'fs';
import { join } from 'path';
import axios from 'axios';
import bs58 from 'bs58';
import { get_mech_config, resolvePrivateKey, KeyConfig } from './config';

// Constants
const REGISTRY_ADD_URL = 'https://registry.autonolas.tech/api/v0/add';

// ABI paths
const ABI_DIR_PATH = join(__dirname, 'abis');
const AGENT_MECH_ABI_PATH = join(ABI_DIR_PATH, 'AgentMech.json');
const GNOSIS_SAFE_ABI_PATH = join(ABI_DIR_PATH, 'GnosisSafe_v1.3.0.json');

export interface DeliverViaSafeOptions {
  chainConfig: string;
  requestId: string;
  resultContent: Record<string, any>;
  targetMechAddress: string;
  safeAddress: string;
  privateKeyPath?: string;
  privateKey?: string;
  keyConfig?: KeyConfig;
  rpcHttpUrl?: string;
  wait?: boolean;
}

export interface DeliverResult {
  tx_hash: string;
  status: 'submitted' | 'confirmed' | 'reverted' | 'unknown';
  block_number?: number;
  gas_used?: number;
}

/**
 * Load ABI file from path
 */
function loadAbiFile(abiPath: string): any[] | null {
  try {
    const data = JSON.parse(readFileSync(abiPath, 'utf8'));
    if (typeof data === 'object' && data !== null && 'abi' in data) {
      return data.abi;
    }
    if (Array.isArray(data)) {
      return data;
    }
  } catch (error) {
    return null;
  }
  return null;
}

/**
 * Extract SHA256 digest from CID (supports CIDv0 and CIDv1)
 */
function extractSha256DigestFromCid(cidStr: string): Buffer {
  let multihashBytes: Buffer;
  
  if (cidStr.startsWith('Qm')) {
    // CIDv0 base58
    multihashBytes = Buffer.from(bs58.decode(cidStr));
  } else {
    // CIDv1 base32 (starts with 'b')
    let b32 = cidStr.toLowerCase();
    if (b32.startsWith('b')) {
      b32 = b32.slice(1);
    }
    
    // Pad to multiple of 8
    const padLen = (8 - (b32.length % 8)) % 8;
    const b32Padded = b32.toUpperCase() + '='.repeat(padLen);
    
    // Decode base32 manually since Node.js doesn't have built-in base32
    const base32Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = 0;
    let value = 0;
    const bytes: number[] = [];
    
    for (const char of b32Padded) {
      if (char === '=') break;
      const index = base32Chars.indexOf(char);
      if (index === -1) continue;
      
      value = (value << 5) | index;
      bits += 5;
      
      if (bits >= 8) {
        bytes.push((value >> (bits - 8)) & 0xff);
        bits -= 8;
      }
    }
    
    const cidBytes = Buffer.from(bytes);
    
    // Skip CIDv1 prefix (0x01) and consume varint codec
    let idx = 0;
    if (idx < cidBytes.length && cidBytes[idx] === 0x01) {
      idx += 1;
    }
    
    while (idx < cidBytes.length) {
      const byte = cidBytes[idx];
      idx += 1;
      if ((byte & 0x80) === 0) {
        break;
      }
    }
    
    if (idx >= cidBytes.length) {
      throw new Error('CID too short after skipping prefixes');
    }
    
    multihashBytes = cidBytes.slice(idx);
  }
  
  if (multihashBytes.length < 34) {
    throw new Error('Multihash too short');
  }
  
  const code = multihashBytes[0];
  const length = multihashBytes[1];
  
  if (code !== 0x12 || length !== 32) {
    throw new Error(`Unexpected multihash code/length: code=0x${code.toString(16).padStart(2, '0')} len=${length}`);
  }
  
  return multihashBytes.slice(2, 34);
}

/**
 * Upload JSON content to Autonolas registry IPFS (wrap-with-directory) and return directory CID
 */
export async function uploadToAutonolasRegistry(
  content: Record<string, any>, 
  requestIdForLog: string
): Promise<string | null> {
  try {
    const files = {
      file: {
        value: JSON.stringify(content, null, 2),
        options: {
          filename: requestIdForLog,
          contentType: 'application/json'
        }
      }
    };
    
    const params = {
      pin: 'true',
      'cid-version': '1',
      'wrap-with-directory': 'true'
    };
    
    const formData = new FormData();
    formData.append('file', new Blob([JSON.stringify(content, null, 2)], { type: 'application/json' }), requestIdForLog);
    
    const response = await axios.post(REGISTRY_ADD_URL, formData, {
      params,
      timeout: 60000,
      headers: {
        'Content-Type': 'multipart/form-data'
      }
    });
    
    if (response.status !== 200) {
      return null;
    }
    
    // Response is NDJSON, last line has directory CID
    let lastHash: string | null = null;
    const lines = response.data.trim().split('\n');
    
    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      try {
        const entry = JSON.parse(line);
        lastHash = entry.Hash || lastHash;
      } catch (error) {
        continue;
      }
    }
    
    return lastHash;
  } catch (error) {
    console.error('Error uploading to registry:', error);
    return null;
  }
}

/**
 * Convert integer to bytes32
 */
function toBytes32FromInt(value: number | string): Buffer {
  // Convert decimal or hex string/number to 32-byte big-endian buffer
  let hex: string;
  if (typeof value === 'number') {
    hex = BigInt(value).toString(16);
  } else {
    const v = value.trim();
    hex = (v.startsWith('0x') || v.startsWith('0X')) ? BigInt(v).toString(16) : BigInt(v).toString(16);
  }
  if (hex.length > 64) {
    hex = hex.slice(-64);
  }
  const padded = hex.padStart(64, '0');
  return Buffer.from(padded, 'hex');
}

/**
 * Normalize request ID to integer
 */
function normalizeRequestIdToInt(requestId: string): bigint {
  const trimmed = requestId.trim();
  if (trimmed.startsWith('0x') || trimmed.startsWith('0X')) {
    return BigInt(trimmed);
  }
  return BigInt(trimmed);
}

/**
 * Get Web3 HTTP provider
 */
function getWeb3Http(chainConfig: string, rpcHttpUrl?: string): Web3 {
  const mechConfig = get_mech_config(chainConfig);
  const rpcUrl = rpcHttpUrl || mechConfig.rpc_url;
  const web3 = new Web3(rpcUrl);
  
  // Test connection
  web3.eth.getBlockNumber().catch(() => {
    throw new Error(`Failed to connect to RPC ${rpcUrl}`);
  });
  
  return web3;
}

/**
 * Get AgentMech contract
 */
function getAgentMechContract(web3: Web3, targetMechAddress: string): Contract<any> {
  const abi = loadAbiFile(AGENT_MECH_ABI_PATH);
  if (!abi) {
    throw new Error('AgentMech ABI not found or invalid');
  }
  
  // Check if ABI has deliverToMarketplace function
  const hasDeliverToMarketplace = abi.some((entry: any) => 
    entry.type === 'function' && entry.name === 'deliverToMarketplace'
  );
  
  if (!hasDeliverToMarketplace) {
    throw new Error('AgentMech ABI does not contain deliverToMarketplace function');
  }
  
  return new web3.eth.Contract(abi, web3.utils.toChecksumAddress(targetMechAddress));
}

/**
 * Get Gnosis Safe contract
 */
function getGnosisSafeContract(web3: Web3, safeAddress: string): Contract<any> {
  const abi = loadAbiFile(GNOSIS_SAFE_ABI_PATH);
  if (!abi) {
    throw new Error('Gnosis Safe ABI not found or invalid');
  }
  
  return new web3.eth.Contract(abi, web3.utils.toChecksumAddress(safeAddress));
}

/**
 * Encode AgentMech deliverToMarketplace call
 */
function encodeAgentMechDeliverCall(
  agentMech: Contract<any>,
  requestIdDecStr: string,
  resultDigestBytes: Buffer
): string {
  const requestIdInt = normalizeRequestIdToInt(requestIdDecStr);
  const requestIdBytes32 = toBytes32FromInt(requestIdInt.toString());
  
  const data = agentMech.methods.deliverToMarketplace(
    [requestIdBytes32],
    [resultDigestBytes]
  ).encodeABI();
  
  return data;
}

/**
 * Main deliver via Safe function
 */
export async function deliverViaSafe(options: DeliverViaSafeOptions): Promise<DeliverResult> {
  const {
    chainConfig,
    requestId,
    resultContent,
    targetMechAddress,
    safeAddress,
    privateKeyPath,
    privateKey,
    keyConfig,
    rpcHttpUrl,
    wait = true
  } = options;

  // Upload to IPFS registry
  console.log('Uploading result to IPFS registry...');
  const cid = await uploadToAutonolasRegistry(resultContent, requestId);
  if (!cid) {
    throw new Error('IPFS registry upload failed');
  }
  const ipfsUrl = `https://gateway.autonolas.tech/ipfs/${cid}`;
  console.log(`Uploaded to IPFS: ${ipfsUrl}`);

  // Derive raw digest bytes from CID
  const digestBytes = extractSha256DigestFromCid(cid);
  console.log(`Extracted digest: ${digestBytes.toString('hex')}`);

  // Web3 setup and config
  const mechConfig = get_mech_config(chainConfig);
  const web3 = getWeb3Http(chainConfig, rpcHttpUrl);
  const chainId = await web3.eth.getChainId();

  // Contracts
  const agentMech = getAgentMechContract(web3, targetMechAddress);
  const safe = getGnosisSafeContract(web3, safeAddress);

  // Build AgentMech call data
  const innerCallData = encodeAgentMechDeliverCall(agentMech, requestId, digestBytes);

  // Get Safe nonce
  const nonce = Number(await safe.methods.nonce().call());

  // Prepare Safe getTransactionHash params
  const paramsForHash = {
    to: web3.utils.toChecksumAddress(targetMechAddress),
    value: 0,
    data: innerCallData,
    operation: 0, // CALL
    safeTxGas: 0,
    baseGas: 0,
    gasPrice: 0,
    gasToken: web3.utils.toChecksumAddress('0x0000000000000000000000000000000000000000'),
    refundReceiver: web3.utils.toChecksumAddress('0x0000000000000000000000000000000000000000'),
    _nonce: nonce,
  };

  // Compute hash to sign
  const txHashToSign = String(await safe.methods.getTransactionHash(
    paramsForHash.to,
    paramsForHash.value,
    paramsForHash.data,
    paramsForHash.operation,
    paramsForHash.safeTxGas,
    paramsForHash.baseGas,
    paramsForHash.gasPrice,
    paramsForHash.gasToken,
    paramsForHash.refundReceiver,
    paramsForHash._nonce
  ).call());

  // Sign with EOA private key (eth_sign semantics)
  const pk = keyConfig
    ? resolvePrivateKey(keyConfig)
    : privateKey && privateKey.trim()
      ? privateKey.trim()
      : resolvePrivateKey(undefined, privateKeyPath);

  const account = web3.eth.accounts.privateKeyToAccount(pk);
  const checksumSender = web3.utils.toChecksumAddress(account.address);

  // Sign the transaction hash
  const signedMsg = account.sign(txHashToSign);
  const vAdjusted = Number(signedMsg.v) + 4; // Safe expects eth_sign marker
  
  const signature = Buffer.concat([
    Buffer.from(signedMsg.r.slice(2), 'hex'),
    Buffer.from(signedMsg.s.slice(2), 'hex'),
    Buffer.from([vAdjusted])
  ]);

  // Encode execTransaction
  const execDataHex = safe.methods.execTransaction(
    paramsForHash.to,
    paramsForHash.value,
    paramsForHash.data,
    paramsForHash.operation,
    paramsForHash.safeTxGas,
    paramsForHash.baseGas,
    paramsForHash.gasPrice,
    paramsForHash.gasToken,
    paramsForHash.refundReceiver,
    '0x' + signature.toString('hex')
  ).encodeABI();

  const txPayload: any = {
    to: safe.options.address,
    from: checksumSender,
    value: 0,
    data: execDataHex,
    chainId: chainId,
  };

  // Nonce, gas, fees
  txPayload.nonce = await web3.eth.getTransactionCount(checksumSender);

  // Estimate gas
  const gasEstimate = await web3.eth.estimateGas(txPayload);
  txPayload.gas = gasEstimate;

  // EIP-1559 fees
  const latestBlock = await web3.eth.getBlock('latest');
  const baseFee = latestBlock.baseFeePerGas;
  
  if (baseFee) {
    try {
      const priority = await web3.eth.getMaxPriorityFeePerGas();
      txPayload.maxPriorityFeePerGas = priority;
      txPayload.maxFeePerGas = BigInt(baseFee) * 2n + BigInt(priority);
    } catch (error) {
      const priority = '1500000000'; // 1.5 gwei
      txPayload.maxPriorityFeePerGas = priority;
      txPayload.maxFeePerGas = BigInt(baseFee) * 2n + BigInt(priority);
    }
  } else {
    txPayload.gasPrice = await web3.eth.getGasPrice();
  }

  // Sign & send
  console.log('Signing and sending transaction...');
  const signedTx = await web3.eth.accounts.signTransaction(txPayload, pk);
  
  let txHash: string | undefined;
  let sendError: Error | undefined;
  
  try {
    const sendRes = await web3.eth.sendSignedTransaction(signedTx.rawTransaction!);
    txHash = String(sendRes.transactionHash);
  } catch (e: any) {
    // Safe's execTransaction can fail in web3.js even when the transaction succeeds
    // This happens when the Safe call returns false but the transaction is mined
    // Extract tx hash from error if available and verify with receipt
    sendError = e;
    
    if (e?.receipt?.transactionHash) {
      txHash = String(e.receipt.transactionHash);
      console.log('Transaction may have failed in web3.js, but checking receipt...');
    } else if (e?.transactionHash) {
      txHash = String(e.transactionHash);
      console.log('Transaction may have failed in web3.js, but checking receipt...');
    } else {
      // No tx hash available, this is a real error
      throw e;
    }
  }

  const result: DeliverResult = {
    tx_hash: String(txHash),
    status: 'submitted'
  };

  if (wait) {
    console.log('Waiting for transaction receipt...');
    const receipt = await web3.eth.getTransactionReceipt(txHash!);
    
    if (receipt && receipt.status) {
      result.status = 'confirmed';
      result.block_number = Number(receipt.blockNumber);
      result.gas_used = Number(receipt.gasUsed);

      // Log transaction confirmation details
      const txUrl = mechConfig.transaction_url.replace('{transaction_digest}', txHash);
      console.log(`Transaction: ${txUrl}`);
      console.log(`Status: ${result.status}`);
      console.log(`Block Number: ${result.block_number}`);
      console.log(`Gas Used: ${result.gas_used}`);
      
      if (sendError) {
        console.log('Note: web3.js reported an error, but transaction succeeded on-chain');
      }
    } else if (receipt) {
      result.status = 'reverted';
      result.block_number = Number(receipt.blockNumber);
      result.gas_used = Number(receipt.gasUsed);

      // Log transaction reversion details
      const txUrl = mechConfig.transaction_url.replace('{transaction_digest}', txHash);
      console.log(`Transaction: ${txUrl}`);
      console.log(`Status: ${result.status}`);
      console.log(`Block Number: ${result.block_number}`);
      console.log(`Gas Used: ${result.gas_used}`);
    } else {
      result.status = 'unknown';
      const txUrl = mechConfig.transaction_url.replace('{transaction_digest}', txHash);
      console.log(`Transaction: ${txUrl}`);
      console.log(`Status: ${result.status}`);
    }
  }

  return result;
}
