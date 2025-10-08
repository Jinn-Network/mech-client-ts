import { readFileSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';

// Constants
export const PRIVATE_KEY_FILE_PATH = 'ethereum_private_key.txt';
export const MECH_CONFIGS_PATH = join(__dirname, 'configs', 'mechs.json');
export const ABI_DIR_PATH = join(__dirname, 'abis');

// Interfaces
export interface LedgerConfig {
  address: string;
  chain_id: number;
  poa_chain: boolean;
  default_gas_price_strategy: string;
  is_gas_estimation_enabled: boolean;
}

export interface MechMarketplaceRequestConfig {
  mech_marketplace_contract?: string;
  priority_mech_address?: string;
  delivery_rate?: number;
  payment_type?: string;
  response_timeout?: number;
  payment_data?: string;
}

export interface MechConfig {
  agent_registry_contract: string;
  service_registry_contract: string;
  complementary_metadata_hash_address: string;
  rpc_url: string;
  /**
   * @deprecated wss_endpoint is deprecated for marketplace interactions.
   * Only used for legacy mech interactions. Marketplace now uses async RPC polling.
   */
  wss_endpoint: string;
  ledger_config: LedgerConfig;
  gas_limit: number;
  transaction_url: string;
  subgraph_url: string;
  price: number;
  mech_marketplace_contract: string;
  priority_mech_address?: string;
}

/**
 * @deprecated ConfirmationType is deprecated and only maintained for backward compatibility
 * with legacy mech interactions. Marketplace interactions now use async delivery monitoring
 * via RPC polling instead of WebSocket-based confirmation.
 */
export enum ConfirmationType {
  ON_CHAIN = 'on-chain',
  OFF_CHAIN = 'off-chain',
  WAIT_FOR_BOTH = 'wait-for-both',
}

// Configuration classes with environment overrides
export class LedgerConfigImpl implements LedgerConfig {
  address: string;
  chain_id: number;
  poa_chain: boolean;
  default_gas_price_strategy: string;
  is_gas_estimation_enabled: boolean;

  constructor(config: LedgerConfig) {
    this.address = config.address;
    this.chain_id = config.chain_id;
    this.poa_chain = config.poa_chain;
    this.default_gas_price_strategy = config.default_gas_price_strategy;
    this.is_gas_estimation_enabled = config.is_gas_estimation_enabled;
    
    this.applyEnvironmentOverrides();
  }

  private applyEnvironmentOverrides(): void {
    const address = process.env.MECHX_LEDGER_ADDRESS;
    if (address) {
      this.address = address;
    }

    const chain_id = process.env.MECHX_LEDGER_CHAIN_ID;
    if (chain_id) {
      this.chain_id = parseInt(chain_id, 10);
    }

    const poa_chain = process.env.MECHX_LEDGER_POA_CHAIN;
    if (poa_chain) {
      this.poa_chain = poa_chain.toLowerCase() === 'true';
    }

    const default_gas_price_strategy = process.env.MECHX_LEDGER_DEFAULT_GAS_PRICE_STRATEGY;
    if (default_gas_price_strategy) {
      this.default_gas_price_strategy = default_gas_price_strategy;
    }

    const is_gas_estimation_enabled = process.env.MECHX_LEDGER_IS_GAS_ESTIMATION_ENABLED;
    if (is_gas_estimation_enabled) {
      this.is_gas_estimation_enabled = is_gas_estimation_enabled.toLowerCase() === 'true';
    }
  }
}

export class MechConfigImpl implements MechConfig {
  agent_registry_contract: string;
  service_registry_contract: string;
  complementary_metadata_hash_address: string;
  rpc_url: string;
  wss_endpoint: string;
  ledger_config: LedgerConfig;
  gas_limit: number;
  transaction_url: string;
  subgraph_url: string;
  price: number;
  mech_marketplace_contract: string;
  priority_mech_address?: string;

  constructor(config: MechConfig) {
    this.agent_registry_contract = config.agent_registry_contract;
    this.service_registry_contract = config.service_registry_contract;
    this.complementary_metadata_hash_address = config.complementary_metadata_hash_address;
    this.rpc_url = config.rpc_url;
    this.wss_endpoint = config.wss_endpoint;
    this.ledger_config = new LedgerConfigImpl(config.ledger_config);
    this.gas_limit = config.gas_limit;
    this.transaction_url = config.transaction_url;
    this.subgraph_url = config.subgraph_url;
    this.price = config.price;
    this.mech_marketplace_contract = config.mech_marketplace_contract;
    this.priority_mech_address = config.priority_mech_address;
    
    this.applyEnvironmentOverrides();
  }

  private applyEnvironmentOverrides(): void {
    const agent_registry_contract = process.env.MECHX_AGENT_REGISTRY_CONTRACT;
    if (agent_registry_contract) {
      this.agent_registry_contract = agent_registry_contract;
    }

    const service_registry_contract = process.env.MECHX_SERVICE_REGISTRY_CONTRACT;
    if (service_registry_contract) {
      this.service_registry_contract = service_registry_contract;
    }

    // Priority: MECHX_CHAIN_RPC > RPC_URL (for backwards compatibility)
    const rpc_url = process.env.MECHX_CHAIN_RPC || process.env.RPC_URL;
    if (rpc_url) {
      this.rpc_url = rpc_url;
    }

    const wss_endpoint = process.env.MECHX_WSS_ENDPOINT;
    if (wss_endpoint) {
      this.wss_endpoint = wss_endpoint;
    }

    const gas_limit = process.env.MECHX_GAS_LIMIT;
    if (gas_limit) {
      this.gas_limit = parseInt(gas_limit, 10);
    }

    const transaction_url = process.env.MECHX_TRANSACTION_URL;
    if (transaction_url) {
      this.transaction_url = transaction_url;
    }

    const subgraph_url = process.env.MECHX_SUBGRAPH_URL;
    if (subgraph_url) {
      this.subgraph_url = subgraph_url;
    }
  }
}

// Configuration loader function
export function get_mech_config(chain_config?: string): MechConfigImpl {
  const configData = JSON.parse(readFileSync(MECH_CONFIGS_PATH, 'utf8'));
  
  if (!chain_config) {
    chain_config = Object.keys(configData)[0];
  }

  if (!configData[chain_config]) {
    throw new Error(`Chain config '${chain_config}' not found in mechs.json`);
  }

  const entry = { ...configData[chain_config] };
  const ledger_config = new LedgerConfigImpl(entry.ledger_config);

  const mech_config = new MechConfigImpl({
    ...entry,
    ledger_config: ledger_config as LedgerConfig,
  });

  return mech_config;
}

// Utility function to get private key from environment variable or file
export function getPrivateKey(customPath?: string): string {
  // First try environment variable
  const envPrivateKey = process.env.MECH_PRIVATE_KEY;
  if (envPrivateKey) {
    return envPrivateKey.trim();
  }
  
  // Fall back to file if no environment variable
  const keyPath = customPath || PRIVATE_KEY_FILE_PATH;
  checkPrivateKeyFile(keyPath);
  return readFileSync(keyPath, 'utf8').trim();
}

// Utility function to get private key path (for backward compatibility)
export function getPrivateKeyPath(customPath?: string): string {
  // If a custom path is provided, prefer it
  if (customPath) return customPath;

  // If MECH_PRIVATE_KEY is set, ensure a local file exists populated with it
  const envPrivateKey = process.env.MECH_PRIVATE_KEY;
  if (envPrivateKey && envPrivateKey.trim().length > 0) {
    try {
      // Write or overwrite the default file path so downstream code can keep reading from a file
      writeFileSync(PRIVATE_KEY_FILE_PATH, envPrivateKey.trim(), { encoding: 'utf8' });
    } catch (_) {
      // Best-effort; if write fails, downstream check may still throw
    }
  }
  return PRIVATE_KEY_FILE_PATH;
}

// Utility function to check if private key file exists
export function checkPrivateKeyFile(privateKeyPath: string): void {
  // If MECH_PRIVATE_KEY is present, auto-create the file to keep legacy flows working
  const envPrivateKey = process.env.MECH_PRIVATE_KEY;
  if (envPrivateKey && envPrivateKey.trim().length > 0) {
    try {
      writeFileSync(privateKeyPath, envPrivateKey.trim(), { encoding: 'utf8' });
      return;
    } catch (_) {
      // If writing fails, fall through to exists check
    }
  }
  if (!existsSync(privateKeyPath)) {
    throw new Error(`Private key file '${privateKeyPath}' does not exist!`);
  }
}
