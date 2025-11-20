import { Web3 } from 'web3';
import { Contract } from 'web3-eth-contract';
import { get_mech_config, resolvePrivateKey, KeyConfig } from './config';
import { pushMetadataToIpfs, fetchIpfsHash, pushJsonToIpfs } from './ipfs';
import { watchForMarketplaceRequestIds, waitForReceipt } from './wss';
import { watchForMarketplaceData, watchForMechDataUrl } from './delivery';
import { readFileSync } from 'fs';
import axios from 'axios';
import { join } from 'path';

// Constants
const MAX_RETRIES = 3;
const WAIT_SLEEP = 3.0;
const TIMEOUT = 900.0; // Aligned with delivery.ts DEFAULT_TIMEOUT (15 minutes)
const IPFS_URL_TEMPLATE = 'https://gateway.autonolas.tech/ipfs/f01701220{}';
const MECH_OFFCHAIN_REQUEST_ENDPOINT = 'send_signed_requests';
const MECH_OFFCHAIN_DELIVER_ENDPOINT = 'fetch_offchain_info';

// ABI paths
const ABI_DIR_PATH = join(__dirname, 'abis');
const IMECH_ABI_PATH = join(ABI_DIR_PATH, 'IMech.json');
const ITOKEN_ABI_PATH = join(ABI_DIR_PATH, 'IToken.json');
const IERC1155_ABI_PATH = join(ABI_DIR_PATH, 'IERC1155.json');
const MARKETPLACE_ABI_PATH = join(ABI_DIR_PATH, 'MechMarketplace.json');
const BALANCE_TRACKER_NATIVE_ABI_PATH = join(ABI_DIR_PATH, 'BalanceTrackerFixedPriceNative.json');
const BALANCE_TRACKER_TOKEN_ABI_PATH = join(ABI_DIR_PATH, 'BalanceTrackerFixedPriceToken.json');
const BALANCE_TRACKER_NVM_NATIVE_ABI_PATH = join(ABI_DIR_PATH, 'BalanceTrackerNvmSubscriptionNative.json');
const BALANCE_TRACKER_NVM_TOKEN_ABI_PATH = join(ABI_DIR_PATH, 'BalanceTrackerNvmSubscriptionToken.json');

// Payment types (hardcoded hashes from Python)
export enum PaymentType {
  NATIVE = 'ba699a34be8fe0e7725e93dcbce1701b0211a8ca61330aaeb8a05bf2ec7abed1',
  TOKEN = '3679d66ef546e66ce9057c4a052f317b135bc8e8c509638f7966edfd4fcf45e9',
  NATIVE_NVM = '803dd08fe79d91027fc9024e254a0942372b92f3ccabc1bd19f4a5c2b251c316',
  TOKEN_NVM = '0d6fd99afa9c4c580fab5e341922c2a5c4b61d880da60506193d7bf88944dd14',
}

// Payment type to ABI path mapping
const PAYMENT_TYPE_TO_ABI_PATH: { [paymentType: string]: string } = {
  [PaymentType.NATIVE]: BALANCE_TRACKER_NATIVE_ABI_PATH,
  [PaymentType.TOKEN]: BALANCE_TRACKER_TOKEN_ABI_PATH,
  [PaymentType.NATIVE_NVM]: BALANCE_TRACKER_NVM_NATIVE_ABI_PATH,
  [PaymentType.TOKEN_NVM]: BALANCE_TRACKER_NVM_TOKEN_ABI_PATH,
};

// Chain to price token mapping
export const CHAIN_TO_PRICE_TOKEN: { [chainId: number]: string } = {
  1: '0x0001A500A6B18995B03f44bb040A5fFc28E45CB0',
  10: '0xFC2E6e6BCbd49ccf3A5f029c79984372DcBFE527',
  100: '0xcE11e14225575945b8E6Dc0D4F2dD4C570f79d9f',
  137: '0xFEF5d947472e72Efbb2E388c730B7428406F2F95',
  8453: '0x54330d28ca3357F294334BDC454a032e7f353416',
  42220: '0xFEF5d947472e72Efbb2E388c730B7428406F2F95',
};

// Default marketplace request config
const CHAIN_TO_DEFAULT_MECH_MARKETPLACE_REQUEST_CONFIG: { [chainId: number]: any } = {
  100: {
    response_timeout: 300,
    payment_data: '0x',
  },
  8453: {
    response_timeout: 300,
    payment_data: '0x',
  },
};

export interface MarketplaceInteractOptions {
  prompts: string[];
  priorityMech: string;
  usePrepaid?: boolean;
  useOffchain?: boolean;
  mechOffchainUrl?: string;
  tools?: string[];
  // Optional: if provided, overrides default metadata shape and uploads these objects to IPFS as-is
  ipfsJsonContents?: Record<string, any>[];
  extraAttributes?: Record<string, any>;
  privateKeyPath?: string;
  keyConfig?: KeyConfig;
  retries?: number;
  timeout?: number;
  sleep?: number;
  postOnly?: boolean;
  chainConfig?: string;
  responseTimeout?: number;
}

export interface MechInfo {
  paymentType: string;
  // Lowercased, without 0x prefix; used for enum comparisons
  paymentTypeNormalized: string;
  serviceId: number;
  maxDeliveryRate: number;
  mechPaymentBalanceTracker: string;
  mechContract: Contract<any>;
}

export interface MarketplaceRequestConfig {
  mechMarketplaceContract?: string;
  priorityMechAddress?: string;
  deliveryRate?: number;
  paymentType?: string;
  responseTimeout?: number;
  paymentData?: string;
}

/**
 * Get contract ABI
 */
function getAbi(abiPath: string): any[] {
  try {
    const abiContent = readFileSync(abiPath, 'utf8');
    return JSON.parse(abiContent);
  } catch (error) {
    throw new Error(`Failed to load ABI from ${abiPath}: ${error}`);
  }
}

/**
 * Get contract instance
 */
function getContract(contractAddress: string, abi: any[], web3: Web3): Contract<any> {
  return new web3.eth.Contract(abi, contractAddress);
}

/**
 * Normalize a bytes32 hex string for comparison (lowercase, no 0x prefix)
 */
function normalizeHex32(value: string | undefined | null): string {
  if (!value) return '';
  const s = String(value).toLowerCase();
  return s.startsWith('0x') ? s.slice(2) : s;
}

/**
 * Get event signatures from ABI
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
 * Fetch mech info from marketplace
 */
async function fetchMechInfo(
  web3: Web3,
  mechMarketplaceContract: Contract<any>,
  priorityMechAddress: string
): Promise<MechInfo> {
  const imechAbi = getAbi(IMECH_ABI_PATH);
  const mechContract = getContract(priorityMechAddress, imechAbi, web3);
  
  // Call contract functions
  const paymentTypeBytes = await mechContract.methods.paymentType().call();
  const maxDeliveryRate = await mechContract.methods.maxDeliveryRate().call();
  const serviceId = await mechContract.methods.serviceId().call();
  
  console.log(`   Debug: Raw paymentTypeBytes from contract: ${paymentTypeBytes}`);
  console.log(`   Debug: Raw maxDeliveryRate from contract: ${maxDeliveryRate}`);
  console.log(`   Debug: Raw serviceId from contract: ${serviceId}`);
  
  const mechPaymentBalanceTracker = await mechMarketplaceContract.methods
    .mapPaymentTypeBalanceTrackers(paymentTypeBytes)
    .call();
  
  // Convert and normalize payment type for validation and usage
  const paymentTypeStr = String(paymentTypeBytes);
  const paymentTypeHex = paymentTypeStr.startsWith('0x') ? paymentTypeStr.toLowerCase() : `0x${paymentTypeStr.toLowerCase()}`;
  const paymentTypeForValidation = normalizeHex32(paymentTypeHex);
  
  // Validate payment type
  if (!Object.values(PaymentType).includes(paymentTypeForValidation as PaymentType)) {
    console.log('  - Invalid mech type detected.');
    console.log(`  - Received payment type: ${paymentTypeHex}`);
    console.log(`  - Expected values: ${Object.values(PaymentType).join(', ')}`);
    const expected = Object.values(PaymentType).join(', ');
    throw new Error(`Invalid mech payment type ${paymentTypeHex}; expected one of: ${expected}`);
  }
  
  return {
    paymentType: paymentTypeHex,
    paymentTypeNormalized: paymentTypeForValidation,
    serviceId: Number(serviceId),
    maxDeliveryRate: Number(maxDeliveryRate),
    mechPaymentBalanceTracker: String(mechPaymentBalanceTracker),
    mechContract,
  };
}

/**
 * Approve price tokens for token-based mechs
 */
async function approvePriceTokens(
  web3: Web3,
  wrappedToken: string,
  mechPaymentBalanceTracker: string,
  price: number,
  fromAddress: string
): Promise<string | null> {
  try {
    const itokenAbi = getAbi(ITOKEN_ABI_PATH);
    const tokenContract = getContract(wrappedToken, itokenAbi, web3);
    
    // Check current allowance first
    const currentAllowance = await tokenContract.methods.allowance(fromAddress, mechPaymentBalanceTracker).call();
    
    if (BigInt(String(currentAllowance)) >= BigInt(price)) {
      console.log('Sufficient allowance already exists');
      return 'allowance_exists';
    }
    
    // Approve tokens
    const tx = tokenContract.methods.approve(mechPaymentBalanceTracker, String(price));
    const receipt = await tx.send({ from: fromAddress });
    
    // Wait for transaction confirmation
    await web3.eth.getTransactionReceipt(receipt.transactionHash);
    
    return receipt.transactionHash;
  } catch (error) {
    console.error('Error approving tokens:', error);
    return null;
  }
}

/**
 * Check prepaid balances
 */
async function checkPrepaidBalances(
  web3: Web3,
  mechPaymentBalanceTracker: string,
  paymentType: string,
  maxDeliveryRate: number
): Promise<void> {
  // Use the default wallet account added from the private key
  const requester = web3.eth.accounts.wallet[0]?.address as string;
  
  if (paymentType === PaymentType.NATIVE || paymentType === PaymentType.TOKEN) {
    const paymentTypeName = paymentType === PaymentType.NATIVE ? 'native' : 'token';
    const paymentTypeAbiPath = PAYMENT_TYPE_TO_ABI_PATH[paymentType];
    
    const abi = getAbi(paymentTypeAbiPath);
    const balanceTrackerContract = getContract(mechPaymentBalanceTracker, abi, web3);
    
    const requesterBalance = await balanceTrackerContract.methods.mapRequesterBalances(requester).call();
    
    if (Number(requesterBalance) < maxDeliveryRate) {
      console.log(`  - Sender ${paymentTypeName} deposited balance low. Needed: ${maxDeliveryRate}, Actual: ${requesterBalance}`);
      console.log(`  - Sender Address: ${requester}`);
      console.log(`  - Please use deposit-${paymentTypeName} command to add balance`);
      throw new Error(`Insufficient ${paymentTypeName} deposited balance for ${requester}. Needed: ${maxDeliveryRate}, actual: ${requesterBalance}. Use deposit-${paymentTypeName} to add.`);
    }
    
    console.log(`  - Sender ${paymentTypeName} balance sufficient: ${requesterBalance}`);
  }
}

/**
 * Fetch requester NVM subscription balance
 */
async function fetchRequesterNvmSubscriptionBalance(
  requester: string,
  web3: Web3,
  mechPaymentBalanceTracker: string,
  paymentType: string
): Promise<number> {
  const paymentTypeAbiPath = PAYMENT_TYPE_TO_ABI_PATH[paymentType];
  const abi = getAbi(paymentTypeAbiPath);
  
  const nvmBalanceTrackerContract = getContract(mechPaymentBalanceTracker, abi, web3);
  
  // Get balance tracker balance
  const requesterBalanceTrackerBalance = await nvmBalanceTrackerContract.methods.mapRequesterBalances(requester).call();
  
  // Get subscription NFT address and token ID
  const subscriptionNftAddress = await nvmBalanceTrackerContract.methods.subscriptionNFT().call();
  const subscriptionId = await nvmBalanceTrackerContract.methods.subscriptionTokenId().call();
  
  // Get ERC1155 balance
  const ierc1155Abi = getAbi(IERC1155_ABI_PATH);
  const subscriptionNftContract = getContract(String(subscriptionNftAddress), ierc1155Abi, web3);
  
  const requesterBalance = await subscriptionNftContract.methods.balanceOf(requester, String(subscriptionId)).call();
  
  const totalBalance = Number(String(requesterBalanceTrackerBalance)) + Number(String(requesterBalance));
  
  console.log(`  - Balance tracker balance: ${requesterBalanceTrackerBalance}`);
  console.log(`  - ERC1155 subscription balance: ${requesterBalance}`);
  console.log(`  - Total NVM balance: ${totalBalance}`);
  
  return totalBalance;
}

/**
 * Verify tools against mech metadata
 */
async function verifyTools(tools: string[], serviceId: number, chainConfig?: string): Promise<void> {
  // Implementation would query mech tools from metadata
  // For now, just log the verification
  console.log(`Verifying tools: ${tools.join(', ')} for service ID: ${serviceId}`);
}

/**
 * Send marketplace request
 */
async function sendMarketplaceRequest(
  web3: Web3,
  marketplaceContract: Contract<any>,
  gasLimit: number,
  prompts: string[],
  tools: string[],
  methodArgsData: MarketplaceRequestConfig,
  extraAttributes?: Record<string, any>,
  ipfsJsonContents?: Record<string, any>[],
  price: number = 3_000_000_000_000,
  retries?: number,
  timeout?: number,
  sleep?: number
): Promise<string | null> {
  const numRequests = prompts.length;
  const tries = retries || MAX_RETRIES;
  const timeoutMs = (timeout || TIMEOUT) * 1000;
  const sleepMs = (sleep || WAIT_SLEEP) * 1000;
  const deadline = Date.now() + timeoutMs;
  
  // Upload metadata to IPFS for each prompt
  const ipfsHashes: string[] = [];
  for (let i = 0; i < prompts.length; i++) {
    if (ipfsJsonContents && ipfsJsonContents[i]) {
      const [truncatedHash, cidString] = await pushJsonToIpfs(ipfsJsonContents[i]);
      ipfsHashes.push(truncatedHash);
      console.log(`  - Prompt uploaded: https://gateway.autonolas.tech/ipfs/${cidString}`);
    } else {
      const [truncatedHash, cidString] = await pushMetadataToIpfs(prompts[i], tools[i] || 'default-tool', extraAttributes);
      ipfsHashes.push(truncatedHash);
      console.log(`  - Prompt uploaded: https://gateway.autonolas.tech/ipfs/${cidString}`);
    }
  }
  
  let lastError: unknown = null;

  for (let attempt = 0; attempt < tries && Date.now() < deadline; attempt++) {
    try {
      const from = web3.eth.accounts.wallet[0]?.address as string;
      
      // Build marketplace request transaction
      // Convert payment type to hex string (Python adds 0x prefix)
      const paymentTypeHex = methodArgsData.paymentType?.startsWith('0x') 
        ? methodArgsData.paymentType 
        : `0x${methodArgsData.paymentType || ''}`;
      
      // Convert address to checksum format (like Python does)
      const priorityMechChecksum = web3.utils.toChecksumAddress(methodArgsData.priorityMechAddress || '');
      
      // Mirror Python: use `request` for a single prompt, else `requestBatch`
      const tx = (ipfsHashes.length === 1)
        ? marketplaceContract.methods.request(
            ipfsHashes[0],
            methodArgsData.deliveryRate,
            paymentTypeHex,
            priorityMechChecksum,
            methodArgsData.responseTimeout || 300,
            methodArgsData.paymentData || '0x'
          )
        : marketplaceContract.methods.requestBatch(
            ipfsHashes,
            methodArgsData.deliveryRate,
            paymentTypeHex,
            priorityMechChecksum,
            methodArgsData.responseTimeout || 300,
            methodArgsData.paymentData || '0x'
          );
      
      // Try gas estimation first, fallback to configured gas limit
      let gasEstimate;
      try {
        gasEstimate = await tx.estimateGas({ from, value: String(price) });
        console.log(`   Gas estimate: ${gasEstimate}`);
      } catch (gasError) {
        console.log(`   Gas estimation failed: ${gasError}, using configured limit: ${gasLimit}`);
        gasEstimate = gasLimit;
      }

      // Mirror Python: explicit EIP-1559 and nonce handling
      const pendingNonce = await web3.eth.getTransactionCount(from, 'pending');
      const latestBlock = await web3.eth.getBlock('latest');
      const baseFee = (latestBlock as any).baseFeePerGas ? BigInt((latestBlock as any).baseFeePerGas) : BigInt(0);
      const maxPriorityFeePerGas = baseFee > BigInt(0) ? baseFee / BigInt(10) : BigInt(1000000); // 10% of base or fallback
      const maxFeePerGas = baseFee > BigInt(0) ? baseFee + maxPriorityFeePerGas * BigInt(2) : BigInt(2000000);

      const sendParams: any = {
        from,
        value: String(price),
        gas: String(gasEstimate),
        nonce: pendingNonce,
        type: '0x2',
        maxFeePerGas: `0x${maxFeePerGas.toString(16)}`,
        maxPriorityFeePerGas: `0x${maxPriorityFeePerGas.toString(16)}`,
        // chainId is inferred from provider; add if needed
      };

      const receipt = await tx.send(sendParams);
      
      return receipt.transactionHash;
    } catch (error) {
      console.log(`Error occurred while sending the transaction: ${error}; Retrying in ${sleepMs}ms`);
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, sleepMs));
    }
  }

  if (lastError) {
    if (lastError instanceof Error) {
      throw lastError;
    }
    throw new Error(typeof lastError === 'string' ? lastError : JSON.stringify(lastError));
  }

  return null;
}

/**
 * Send offchain marketplace request
 */
async function sendOffchainMarketplaceRequest(
  web3: Web3,
  marketplaceContract: Contract<any>,
  mechOffchainUrl: string,
  prompt: string,
  tool: string,
  methodArgsData: MarketplaceRequestConfig,
  nonce: number,
  extraAttributes?: Record<string, any>
): Promise<any> {
  // Generate deterministic hash for offchain request
  const [truncatedHash, fullHash, ipfsData] = await fetchIpfsHash(prompt, tool, extraAttributes);
  
  // Get request ID
  const requestId = await marketplaceContract.methods.getRequestId(
    methodArgsData.priorityMechAddress,
    truncatedHash,
    nonce
  ).call();
  
  // Sign the request
  const from = web3.eth.accounts.wallet[0]?.address as string;
  
  const message = web3.utils.soliditySha3(
    { type: 'address', value: methodArgsData.priorityMechAddress },
    { type: 'bytes32', value: truncatedHash },
    { type: 'uint256', value: nonce }
  );
  
  const signature = await web3.eth.sign(message!, from);
  
  // Send offchain request
  try {
    const response = await axios.post(`${mechOffchainUrl}/${MECH_OFFCHAIN_REQUEST_ENDPOINT}`, {
      request_id: requestId,
      mech_address: methodArgsData.priorityMechAddress,
      ipfs_hash: truncatedHash,
      nonce: nonce,
      signature: signature,
      ipfs_data: ipfsData.toString('hex'),
    });
    
    return {
      request_id: requestId,
      response: response.data,
    };
  } catch (error) {
    console.error('Error sending offchain request:', error);
    return null;
  }
}

/**
 * Wait for marketplace data URL using async delivery monitoring
 *
 * This function implements the two-step delivery monitoring process:
 * 1. Poll marketplace contract for delivery mech assignment
 * 2. Poll delivery mech contract logs for Deliver event with IPFS hash
 */
async function waitForMarketplaceDataUrl(
  requestIds: string[],
  marketplaceContract: Contract<any>,
  fromBlock: number,
  deliverSignature: string,
  web3: Web3,
  timeout?: number
): Promise<Record<string, string>> {
  try {
    // Step 1: Watch for delivery mech addresses from marketplace
    console.log('Watching for delivery mech assignments...');
    const deliveryMechs = await watchForMarketplaceData(
      requestIds,
      marketplaceContract,
      timeout
    );

    if (Object.keys(deliveryMechs).length === 0) {
      console.log('No delivery mechs found');
      return {};
    }

    // Step 2: For each unique delivery mech, watch for data URLs
    const results: Record<string, string> = {};
    const mechToRequestIds: Record<string, string[]> = {};

    // Group request IDs by delivery mech
    for (const [requestId, deliveryMech] of Object.entries(deliveryMechs)) {
      if (!mechToRequestIds[deliveryMech]) {
        mechToRequestIds[deliveryMech] = [];
      }
      mechToRequestIds[deliveryMech].push(requestId);
    }

    // Watch for Deliver events from each delivery mech
    for (const [deliveryMech, reqIds] of Object.entries(mechToRequestIds)) {
      console.log(`Watching for Deliver events from mech ${deliveryMech}...`);
      const dataUrls = await watchForMechDataUrl(
        reqIds,
        fromBlock,
        deliveryMech,
        deliverSignature,
        web3,
        timeout
      );
      Object.assign(results, dataUrls);
    }

    return results;
  } catch (error) {
    console.error('Error waiting for marketplace data URLs:', error);
    return {};
  }
}

/**
 * Wait for offchain marketplace data
 */
async function waitForOffchainMarketplaceData(
  mechOffchainUrl: string,
  requestId: string
): Promise<any> {
  try {
    const response = await axios.get(`${mechOffchainUrl}/${MECH_OFFCHAIN_DELIVER_ENDPOINT}/${requestId}`);
    return response.data;
  } catch (error) {
    console.error('Error fetching offchain data:', error);
    return null;
  }
}

/**
 * Main marketplace interact function
 */
export async function marketplaceInteract(options: MarketplaceInteractOptions): Promise<any> {
  const {
    prompts,
    priorityMech,
    usePrepaid = false,
    useOffchain = false,
    mechOffchainUrl = '',
    tools = [],
    extraAttributes,
    privateKeyPath,
    keyConfig,
    retries,
    timeout,
    sleep,
    postOnly = false,
    chainConfig,
    responseTimeout
  } = options;

  // Get configuration
  const mechConfig = get_mech_config(chainConfig);
  const ledgerConfig = mechConfig.ledger_config;
  const priorityMechAddress = priorityMech;
  const mechMarketplaceContractAddress = mechConfig.mech_marketplace_contract;
  const chainId = ledgerConfig.chain_id;
  const numRequests = prompts.length;

  if (mechMarketplaceContractAddress === '0x0000000000000000000000000000000000000000') {
    console.log(`Mech Marketplace not yet supported on ${chainConfig}`);
    return null;
  }

  // Build marketplace request config
  const configValues = { ...CHAIN_TO_DEFAULT_MECH_MARKETPLACE_REQUEST_CONFIG[chainId] };
  if (!priorityMechAddress) {
    console.log('Priority Mech Address not provided');
    return null;
  }

  configValues.priorityMechAddress = priorityMechAddress;
  configValues.mechMarketplaceContract = mechMarketplaceContractAddress;
  if (responseTimeout !== undefined) {
    configValues.responseTimeout = responseTimeout;
  }

  // Initialize Web3
  const web3 = new Web3(mechConfig.rpc_url);

  // Load private key and add account
  const privateKey = keyConfig
    ? resolvePrivateKey(keyConfig)
    : resolvePrivateKey(undefined, privateKeyPath);
  const account = web3.eth.accounts.privateKeyToAccount(privateKey);
  web3.eth.accounts.wallet.add(account);

  // Load marketplace contract
  const marketplaceAbi = getAbi(MARKETPLACE_ABI_PATH);
  const mechMarketplaceContract = getContract(mechMarketplaceContractAddress, marketplaceAbi, web3);

  console.log('Fetching Mech Info...');
  const mechInfo = await fetchMechInfo(web3, mechMarketplaceContract, priorityMechAddress);
  
  configValues.deliveryRate = mechInfo.maxDeliveryRate;
  configValues.paymentType = mechInfo.paymentType;

  // Verify tools
  await verifyTools(tools, mechInfo.serviceId, chainConfig);

  // Load mech contract ABI and extract event signatures for delivery monitoring
  const imechAbi = getAbi(IMECH_ABI_PATH);
  const { deliver: marketplaceDeliverSignature } = getEventSignatures(imechAbi);

  console.log(`   Debug: Payment type detected: ${mechInfo.paymentType}`);
  console.log(`   Debug: Max delivery rate: ${mechInfo.maxDeliveryRate}`);
  console.log(`   Debug: Number of requests: ${numRequests}`);
  
  let price = 0;

  // Handle payment logic
  if (!usePrepaid) {
    price = mechInfo.maxDeliveryRate * numRequests;
    console.log(`   Debug: Calculated price: ${price} (maxDeliveryRate: ${mechInfo.maxDeliveryRate} * numRequests: ${numRequests})`);
    const pt = mechInfo.paymentTypeNormalized;
    if (pt === PaymentType.TOKEN) {
      console.log('Token Mech detected, approving wrapped token for price payment...');
      const priceToken = CHAIN_TO_PRICE_TOKEN[chainId];
      const approveTx = await approvePriceTokens(
        web3,
        priceToken,
        mechInfo.mechPaymentBalanceTracker,
        price,
        account.address
      );
      
      if (!approveTx) {
        console.log('Unable to approve allowance');
        return null;
      }

      const transactionUrlFormatted = mechConfig.transaction_url.replace('{transaction_digest}', approveTx);
      console.log(`  - Transaction sent: ${transactionUrlFormatted}`);
      console.log('  - Waiting for transaction receipt...');
      
      // Wait for receipt (simplified)
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Set price to 0 for token mechs
      price = 0;
      console.log(`   Debug: Token mech detected, price set to 0`);
    }
  } else {
    console.log('Prepaid request to be used, skipping payment');
    price = 0;
    await checkPrepaidBalances(
      web3,
      mechInfo.mechPaymentBalanceTracker,
      mechInfo.paymentTypeNormalized,
      mechInfo.maxDeliveryRate
    );
  }

  // Handle NVM mechs
  const pt = mechInfo.paymentTypeNormalized;
  const isNvmMech = pt === PaymentType.NATIVE_NVM || pt === PaymentType.TOKEN_NVM;
  if (isNvmMech) {
    const nvmMechType = pt === PaymentType.NATIVE_NVM ? 'native' : 'token';
    console.log(`${nvmMechType} Nevermined Mech detected, subscription credits to be used`);
    
    const requester = account.address;
    const requesterTotalBalanceBefore = await fetchRequesterNvmSubscriptionBalance(
      requester,
      web3,
      mechInfo.mechPaymentBalanceTracker,
      pt
    );
    
    if (requesterTotalBalanceBefore < price) {
      console.log(`  - Sender Subscription balance low. Needed: ${price}, Actual: ${requesterTotalBalanceBefore}`);
      console.log(`  - Sender Address: ${requester}`);
      throw new Error(`Insufficient Nevermined subscription balance for ${requester}. Needed: ${price}, actual: ${requesterTotalBalanceBefore}.`);
    }

    console.log(`  - Sender Subscription balance before request: ${requesterTotalBalanceBefore}`);
    price = 0; // Set price to 0 for NVM mechs
    console.log(`   Debug: NVM mech detected, price set to 0`);
  }

  console.log(`   Debug: Final price being sent: ${price}`);
  
  if (!useOffchain) {
    console.log('Sending Mech Marketplace request...');
    // Ensure we pass 0x-prefixed payment type to contract
    const ptForContract = `0x${pt}`;
    configValues.paymentType = ptForContract;
    let transactionDigest: string | null;
    try {
      transactionDigest = await sendMarketplaceRequest(
        web3,
        mechMarketplaceContract,
        mechConfig.gas_limit,
        prompts,
        tools,
        configValues,
        extraAttributes,
        options.ipfsJsonContents,
        price,
        retries,
        timeout,
        sleep,
      );
    } catch (error) {
      console.log('Unable to send request');
      throw error;
    }

    if (!transactionDigest) {
      console.log('Unable to send request');
      return null;
    }

    const transactionUrlFormatted = mechConfig.transaction_url.replace('{transaction_digest}', transactionDigest);
    console.log(`  - Transaction sent: ${transactionUrlFormatted}`);
    console.log('  - Waiting for transaction receipt...');

    // Get transaction receipt to extract block number (with retry loop)
    const txReceipt = await waitForReceipt(transactionDigest, web3);
    const fromBlock = Number(txReceipt.blockNumber);

    const requestIds = await watchForMarketplaceRequestIds(
      mechMarketplaceContract,
      web3,
      transactionDigest
    );

    // Use full-precision decimal strings to avoid scientific notation / precision loss
    const requestIdInts = requestIds.map((id: string) => (BigInt(id)).toString(10));

    // Normalize request IDs for delivery monitoring (remove 0x prefix)
    const normalizedRequestIds = requestIds.map((id: string) =>
      id.startsWith('0x') ? id.slice(2).toLowerCase() : id.toLowerCase()
    );

    if (requestIdInts.length === 1) {
      console.log(`  - Created on-chain request with ID ${requestIdInts[0]}`);
    } else {
      console.log(`  - Created on-chain requests with IDs: ${requestIdInts.join(', ')}`);
    }
    console.log('');

    if (postOnly) {
      return {
        transaction_hash: transactionDigest,
        transaction_url: transactionUrlFormatted,
        request_ids: requestIds,
        request_id_ints: requestIdInts,
      };
    }

    // Wait for data URLs for all requests (async polling-based)
    const dataUrls = await waitForMarketplaceDataUrl(
      normalizedRequestIds,
      mechMarketplaceContract,
      fromBlock,
      marketplaceDeliverSignature,
      web3,
      timeout
    );

    // Process and display data for each request
    const results: any[] = [];
    let hasData = false;

    for (let i = 0; i < requestIds.length; i++) {
      const requestId = requestIds[i];
      const requestIdInt = requestIdInts[i];
      const normalizedRequestId = normalizedRequestIds[i];

      const dataUrl = dataUrls[normalizedRequestId];

      if (dataUrl) {
        hasData = true;
        if (isNvmMech) {
          const requesterTotalBalanceAfter = await fetchRequesterNvmSubscriptionBalance(
            account.address,
            web3,
            mechInfo.mechPaymentBalanceTracker,
            mechInfo.paymentType
          );
          console.log(`  - Sender Subscription balance after delivery: ${requesterTotalBalanceAfter}`);
        }

        console.log(`  - Data arrived: ${dataUrl}`);
        try {
          const response = await axios.get(`${dataUrl}/${requestIdInt}`, { timeout: 60000 });
          const data = response.data;
          console.log('  - Data from agent:');
          console.log(JSON.stringify(data, null, 2));
          results.push({ requestId: requestIdInt, data });
        } catch (error) {
          console.error('Error fetching data:', error);
          results.push({ requestId: requestIdInt, error: String(error) });
        }
      } else {
        console.log(`  - No data received for request ${requestIdInt}`);
        results.push({ requestId: requestIdInt, data: null });
      }
    }

    // Return the results if we have any data, otherwise return null
    return hasData ? results : null;
  }

  // Offchain flow
  console.log('Sending Offchain Mech Marketplace request...');
  const currNonce = await mechMarketplaceContract.methods.mapNonces(account.address).call();
  const responses: any[] = [];

  for (let i = 0; i < numRequests; i++) {
    const response = await sendOffchainMarketplaceRequest(
      web3,
      mechMarketplaceContract,
      mechOffchainUrl,
      prompts[i],
      tools[i] || 'default-tool',
      configValues,
      Number(currNonce) + i,
      extraAttributes
    );
    responses.push(response);
  }

  if (!responses || responses.length !== numRequests) {
    return null;
  }

  const requestIds = responses.filter(resp => resp !== null).map(resp => resp.request_id);
  
  if (requestIds.length === 1) {
    console.log(`  - Created off-chain request with ID ${requestIds[0]}`);
  } else {
    console.log(`  - Created off-chain requests with IDs: ${requestIds.join(', ')}`);
  }
  console.log('');

  if (postOnly) {
    return {
      responses,
      request_ids: requestIds,
    };
  }

  console.log('Waiting for Offchain Mech Marketplace deliver...');

  // Wait for offchain data
  for (const requestId of requestIds) {
    const data = await waitForOffchainMarketplaceData(mechOffchainUrl, requestId);

    if (data) {
      const taskResult = data.task_result;
      const dataUrl = IPFS_URL_TEMPLATE.replace('{}', taskResult);
      console.log(`  - Data arrived: ${dataUrl}`);
      
      try {
        const response = await axios.get(`${dataUrl}/${requestId}`, { timeout: 60000 });
        const responseData = response.data;
        console.log('  - Data from agent:');
        console.log(JSON.stringify(responseData, null, 2));
      } catch (error) {
        console.error('Error fetching offchain data:', error);
      }
    }
  }

  return null;
}
