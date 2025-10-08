import { Web3 } from 'web3';
import { Contract } from 'web3-eth-contract';
import { readFileSync } from 'fs';
import { join } from 'path';
import axios from 'axios';
import { get_mech_config } from './config';

// Constants
const COMPLEMENTARY_METADATA_HASH_ABI_PATH = join(__dirname, 'abis', 'ComplementaryServiceMetadata.json');
const DEFAULT_TIMEOUT = 10000;
const TOOLS = 'tools';
const TOOL_METADATA = 'toolMetadata';
const DEFAULT_CONFIG = 'gnosis';

export interface ToolInfo {
  tool_name: string;
  unique_identifier: string;
}

export interface ToolsForMarketplaceMech {
  service_id: number;
  tools: ToolInfo[];
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
 * Fetch tools for specified mech's service ID
 */
async function fetchTools(
  serviceId: number,
  web3: Web3,
  complementaryMetadataHashAddress: string,
  contractAbiPath: string
): Promise<{ tools: string[]; toolMetadata: any }> {
  const abi = getAbi(contractAbiPath);
  const metadataContract = getContract(complementaryMetadataHashAddress, abi, web3);
  
  const metadataUri = await metadataContract.methods.tokenURI(serviceId).call();
  console.log(`Fetching metadata from: ${metadataUri}`);
  
  // Check for zero hash (no metadata set)
  if (String(metadataUri).includes('f017012200000000000000000000000000000000000000000000000000000000000000000')) {
    console.log('Warning: Mech has no metadata set (zero hash)');
    return { tools: [], toolMetadata: {} };
  }
  
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
  };
  
  try {
    const response = await axios.get(String(metadataUri), { timeout: DEFAULT_TIMEOUT, headers });
    console.log(`Response status: ${response.status}`);
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error) && error.code === 'ECONNABORTED') {
      console.log('Timeout fetching metadata, returning empty tools');
      return { tools: [], toolMetadata: {} };
    }
    throw error;
  }
}

/**
 * Get tools for a given mech's service ID
 */
export async function getMechTools(
  serviceId: number,
  chainConfig: string = DEFAULT_CONFIG
): Promise<{ tools: string[]; toolMetadata: any } | null> {
  const mechConfig = get_mech_config(chainConfig);
  const web3 = new Web3(mechConfig.rpc_url);
  
  if (mechConfig.complementary_metadata_hash_address === '0x0000000000000000000000000000000000000000') {
    console.log(`Metadata hash not yet implemented on ${chainConfig}`);
    return null;
  }
  
  try {
    return await fetchTools(
      serviceId,
      web3,
      mechConfig.complementary_metadata_hash_address,
      COMPLEMENTARY_METADATA_HASH_ABI_PATH
    );
  } catch (error) {
    console.error(`An error occurred while fetching tools for mech with ${serviceId}:`, error);
    return null;
  }
}

/**
 * Get tools for specified mech's service ID
 */
export async function getToolsForMarketplaceMech(
  serviceId: number,
  chainConfig: string = DEFAULT_CONFIG
): Promise<ToolsForMarketplaceMech> {
  const emptyResponse: ToolsForMarketplaceMech = { service_id: serviceId, tools: [] };
  
  try {
    const result = await getMechTools(serviceId, chainConfig);
    
    if (!result) {
      return emptyResponse;
    }
    
    const tools = result[TOOLS] || [];
    const toolMetadata = result[TOOL_METADATA] || {};
    
    if (!Array.isArray(tools) || typeof toolMetadata !== 'object') {
      return emptyResponse;
    }
    
    const toolsWithIds: ToolInfo[] = tools.map(tool => ({
      tool_name: tool,
      unique_identifier: `${serviceId}-${tool}`
    }));
    
    return { service_id: serviceId, tools: toolsWithIds };
  } catch (error) {
    console.error('Error in getToolsForMarketplaceMech:', error);
    throw error;
  }
}

/**
 * Get tool description by unique identifier
 */
export async function getToolDescription(
  uniqueIdentifier: string,
  chainConfig: string = DEFAULT_CONFIG
): Promise<string> {
  const defaultResponse = 'Description not available';
  
  const { toolInfo } = await getToolMetadata(uniqueIdentifier, chainConfig);
  
  return toolInfo?.description || defaultResponse;
}

/**
 * Get tool IO schema by unique identifier
 */
export async function getToolIoSchema(
  uniqueIdentifier: string,
  chainConfig: string = DEFAULT_CONFIG
): Promise<{ name?: string; description?: string; input?: any; output?: any }> {
  const { toolInfo } = await getToolMetadata(uniqueIdentifier, chainConfig);
  
  if (toolInfo) {
    return {
      name: toolInfo.name,
      description: toolInfo.description,
      input: toolInfo.input,
      output: toolInfo.output
    };
  }
  
  return { input: {}, output: {} };
}

/**
 * Helper function to extract tool metadata from chain config and unique identifier
 */
async function getToolMetadata(
  uniqueIdentifier: string,
  chainConfig: string = DEFAULT_CONFIG
): Promise<{ toolName: string; toolInfo: any }> {
  const parts = uniqueIdentifier.split('-');
  
  if (parts.length < 2) {
    throw new Error(`Unexpected unique identifier format: ${uniqueIdentifier}`);
  }
  
  const serviceIdStr = parts[0];
  const toolParts = parts.slice(1);
  
  let serviceId: number;
  try {
    serviceId = parseInt(serviceIdStr);
  } catch (error) {
    throw new Error(`Unexpected unique identifier format: ${uniqueIdentifier}`);
  }
  
  const toolName = toolParts.join('-');
  
  const result = await getMechTools(serviceId, chainConfig);
  
  if (result && typeof result === 'object') {
    const toolMetadata = result[TOOL_METADATA] || {};
    const toolInfo = toolMetadata[toolName];
    
    if (typeof toolInfo === 'object' && toolInfo !== null) {
      return { toolName, toolInfo };
    }
  }
  
  return { toolName, toolInfo: null };
}

/**
 * Extract input schema from input data
 */
export function extractInputSchema(inputData: { [key: string]: any }): Array<[string, any]> {
  return Object.entries(inputData);
}

/**
 * Extract output schema from output data
 */
export function extractOutputSchema(outputData: { [key: string]: any }): Array<[string, string, string]> {
  const schema = outputData.schema || {};
  
  if (!schema.properties) {
    return [];
  }
  
  return Object.entries(schema.properties).map(([key, value]: [string, any]) => [
    key,
    value.type || '',
    value.description || ''
  ]);
}
