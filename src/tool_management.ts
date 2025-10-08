import { Web3 } from 'web3';
import { Contract } from 'web3-eth-contract';
import { readFileSync } from 'fs';
import { join } from 'path';
import axios from 'axios';
import { get_mech_config } from './config';

// Constants
const AGENT_REGISTRY_ABI_PATH = join(__dirname, 'abis', 'AgentRegistry.json');
const DEFAULT_TIMEOUT = 10000;

export interface ToolWithId {
  tool_name: string;
  unique_identifier: string;
  is_marketplace_supported?: boolean;
}

export interface AgentToolsResult {
  agent_id?: number;
  tools?: ToolWithId[];
  all_tools_with_identifiers?: ToolWithId[];
  agent_tools_map?: { [agentId: number]: string[] };
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
 * Fetch tools for a given agent ID from AgentRegistry
 */
async function fetchTools(
  agentId: number,
  web3: Web3,
  agentRegistryContract: string,
  contractAbiPath: string,
  includeMetadata: boolean = false
): Promise<{ tools: string[]; toolMetadata: any } | null> {
  try {
    const abi = getAbi(contractAbiPath);
    const contract = getContract(agentRegistryContract, abi, web3);
    
    // Get tokenURI for the agent
    const tokenUri = await contract.methods.tokenURI(agentId).call();
    
    if (!tokenUri || String(tokenUri) === '') {
      return null;
    }
    
    // Fetch metadata from IPFS
    const response = await axios.get(String(tokenUri), { timeout: DEFAULT_TIMEOUT });
    const metadata = response.data;
    
    const tools = metadata.tools || [];
    const toolMetadata = includeMetadata ? (metadata.toolMetadata || {}) : {};
    
    return { tools, toolMetadata };
  } catch (error) {
    console.error(`Error fetching tools for agent ${agentId}:`, error);
    return null;
  }
}

/**
 * Get total supply of agents from AgentRegistry
 */
export async function getTotalSupply(chainConfig: string = 'gnosis'): Promise<number> {
  const mechConfig = get_mech_config(chainConfig);
  const web3 = new Web3(mechConfig.rpc_url);
  
  const abi = getAbi(AGENT_REGISTRY_ABI_PATH);
  const contract = getContract(mechConfig.agent_registry_contract, abi, web3);
  
  const totalSupply = await contract.methods.totalSupply().call();
  return Number(totalSupply);
}

/**
 * Get tools for a specific agent ID
 */
export async function getAgentTools(
  agentId: number,
  chainConfig: string = 'gnosis',
  includeMetadata: boolean = false
): Promise<{ tools: string[]; toolMetadata: any } | null> {
  try {
    const mechConfig = get_mech_config(chainConfig);
    const web3 = new Web3(mechConfig.rpc_url);
    
    return await fetchTools(
      agentId,
      web3,
      mechConfig.agent_registry_contract,
      AGENT_REGISTRY_ABI_PATH,
      includeMetadata
    );
  } catch (error) {
    console.error(`An error occurred while fetching tools for agent ${agentId}:`, error);
    return null;
  }
}

/**
 * Get tools for specified agents or all agents
 */
export async function getToolsForAgents(
  agentId?: number,
  chainConfig: string = 'gnosis'
): Promise<AgentToolsResult> {
  try {
    const totalSupply = await getTotalSupply(chainConfig);
    
    if (agentId !== undefined) {
      const result = await getAgentTools(agentId, chainConfig, true);
      
      if (result) {
        const { tools, toolMetadata } = result;
        
        if (Array.isArray(tools) && typeof toolMetadata === 'object') {
          const toolsWithIds: ToolWithId[] = tools.map(tool => ({
            tool_name: tool,
            unique_identifier: `${agentId}-${tool}`,
            is_marketplace_supported: toolMetadata[tool]?.isMechMarketplaceSupported || false
          }));
          
          return { agent_id: agentId, tools: toolsWithIds };
        } else {
          return { agent_id: agentId, tools: [] };
        }
      }
      
      return { agent_id: agentId, tools: [] };
    }
    
    // Get tools for all agents
    const allToolsWithIds: ToolWithId[] = [];
    const agentToolsMap: { [agentId: number]: string[] } = {};
    
    for (let currentAgentId = 1; currentAgentId <= totalSupply; currentAgentId++) {
      const result = await getAgentTools(currentAgentId, chainConfig, true);
      
      if (result) {
        const { tools, toolMetadata } = result;
        
        if (Array.isArray(tools) && typeof toolMetadata === 'object') {
          const toolsWithIds: ToolWithId[] = tools.map(tool => ({
            tool_name: tool,
            unique_identifier: `${currentAgentId}-${tool}`,
            is_marketplace_supported: toolMetadata[tool]?.isMechMarketplaceSupported || false
          }));
          
          agentToolsMap[currentAgentId] = tools;
          allToolsWithIds.push(...toolsWithIds);
        }
      }
    }
    
    return {
      all_tools_with_identifiers: allToolsWithIds,
      agent_tools_map: agentToolsMap
    };
  } catch (error) {
    console.error('Error in getToolsForAgents:', error);
    throw error;
  }
}

/**
 * Get tool description by unique identifier
 */
export async function getToolDescription(
  uniqueIdentifier: string,
  chainConfig: string = 'gnosis'
): Promise<string> {
  const parts = uniqueIdentifier.split('-');
  const agentId = parseInt(parts[0]);
  const toolName = parts.slice(1).join('-');
  
  const mechConfig = get_mech_config(chainConfig);
  const web3 = new Web3(mechConfig.rpc_url);
  
  const toolsResult = await fetchTools(
    agentId,
    web3,
    mechConfig.agent_registry_contract,
    AGENT_REGISTRY_ABI_PATH,
    true
  );
  
  if (toolsResult) {
    const { toolMetadata } = toolsResult;
    const toolInfo = toolMetadata[toolName];
    
    if (typeof toolInfo === 'object' && toolInfo !== null) {
      return toolInfo.description || 'Description not available';
    }
  }
  
  return 'Description not available';
}

/**
 * Get tool IO schema by unique identifier
 */
export async function getToolIoSchema(
  uniqueIdentifier: string,
  chainConfig: string = 'gnosis'
): Promise<{ name?: string; description?: string; input?: any; output?: any }> {
  const parts = uniqueIdentifier.split('-');
  const agentId = parseInt(parts[0]);
  const toolName = parts.slice(1).join('-');
  
  const mechConfig = get_mech_config(chainConfig);
  const web3 = new Web3(mechConfig.rpc_url);
  
  const toolsResult = await fetchTools(
    agentId,
    web3,
    mechConfig.agent_registry_contract,
    AGENT_REGISTRY_ABI_PATH,
    true
  );
  
  if (toolsResult) {
    const { toolMetadata } = toolsResult;
    const toolInfo = toolMetadata[toolName];
    
    if (typeof toolInfo === 'object' && toolInfo !== null) {
      return {
        name: toolInfo.name,
        description: toolInfo.description,
        input: toolInfo.input,
        output: toolInfo.output
      };
    }
  }
  
  return { input: {}, output: {} };
}
