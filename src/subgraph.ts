import axios from 'axios';
import { get_mech_config } from './config';

type GraphqlRequestFn = (typeof import('graphql-request'))['request'];

let cachedGraphqlRequest: GraphqlRequestFn | null = null;

async function getGraphqlRequest(): Promise<GraphqlRequestFn> {
  if (!cachedGraphqlRequest) {
    const mod = await import('graphql-request');
    cachedGraphqlRequest = mod.request;
  }
  return cachedGraphqlRequest;
}

// Constants
const RESULTS_LIMIT = 20;
const DEFAULT_TIMEOUT = 600.0;

// Chain to mech factory to mech type mapping
const CHAIN_TO_MECH_FACTORY_TO_MECH_TYPE: { [chain: string]: { [factory: string]: string } } = {
  gnosis: {
    "0x8b299c20F87e3fcBfF0e1B86dC0acC06AB6993EF": "Fixed Price Native",
    "0x31ffDC795FDF36696B8eDF7583A3D115995a45FA": "Fixed Price Token",
    "0x65fd74C29463afe08c879a3020323DD7DF02DA57": "NvmSubscription Native",
  },
  base: {
    "0x2E008211f34b25A7d7c102403c6C2C3B665a1abe": "Fixed Price Native",
    "0x97371B1C0cDA1D04dFc43DFb50a04645b7Bc9BEe": "Fixed Price Token",
    "0x847bBE8b474e0820215f818858e23F5f5591855A": "NvmSubscription Native",
    "0x7beD01f8482fF686F025628e7780ca6C1f0559fc": "NvmSubscription Token USDC",
  },
};

// Hard-coded agent addresses for different chains (from Python source)
const CHAIN_TO_ADDRESSES: { [chain: string]: { [agentId: number]: string } } = {
  gnosis: {
    3: "0xFf82123dFB52ab75C417195c5fDB87630145ae81",
    6: "0x77af31De935740567Cf4fF1986D04B2c964A786a",
    9: "0x552cea7bc33cbbeb9f1d90c1d11d2c6daeffd053",
    11: "0x9aDe7A78A39B39a44b7a084923E93AA0B19Fd690",
    19: "0x45b73d649c7b982548d5a6dd3d35e1c5c48997d0",
  },
  base: {
    1: "0x37C484cc34408d0F827DB4d7B6e54b8837Bf8BDA",
    2: "0x111D7DB1B752AB4D2cC0286983D9bd73a49bac6c",
    3: "0x111D7DB1B752AB4D2cC0286983D9bd73a49bac6c",
  },
  arbitrum: { 2: "0x1FDAD3a5af5E96e5a64Fc0662B1814458F114597" },
  polygon: { 2: "0xbF92568718982bf65ee4af4F7020205dE2331a8a" },
  celo: { 2: "0x230eD015735c0D01EA0AaD2786Ed6Bd3C6e75912" },
  optimism: { 2: "0xDd40E7D93c37eFD860Bd53Ab90b2b0a8D05cf71a" },
};

// GraphQL queries
const MM_MECHS_INFO_QUERY = `
query MechsOrderedByServiceDeliveries {
  meches(orderBy: service__totalDeliveries, orderDirection: desc) {
    address
    mechFactory
    service {
      id
      totalDeliveries
      metadata {
        metadata
      }
    }
  }
}
`;

export interface MechInfo {
  address: string;
  mechFactory: string;
  mech_type: string;
  service: {
    id: string;
    totalDeliveries: string;
    metadata?: {
      metadata: string;
    };
  };
}

export interface MechRequest {
  requestId: string;
  requester: string;
  mech: string;
  transactionHash: string;
  timestamp: string | null;
  request_data?: {
    url: string;
    json: any;
  } | null;
  delivery_data?: {
    url: string;
    json: any;
  } | null;
}

export interface QueryMechRequestsOptions {
  requester_address?: string;
  mech_address?: string;
  from_date?: string;
  to_date?: string;
  include_request_data?: boolean;
  include_delivery_data?: boolean;
  limit?: number;
  offset?: number;
}

/**
 * Convert YYYY-MM-DD string to epoch seconds (UTC at 00:00)
 */
function toEpoch(dateStr?: string): number | null {
  if (!dateStr) {
    return null;
  }
  const dt = new Date(dateStr + 'T00:00:00.000Z');
  return Math.floor(dt.getTime() / 1000);
}

/**
 * Convert YYYY-MM-DD string to epoch seconds at end of day (UTC 23:59:59)
 */
function toEpochEnd(dateStr?: string): number | null {
  if (!dateStr) {
    return null;
  }
  const dt = new Date(dateStr + 'T23:59:59.999Z');
  return Math.floor(dt.getTime() / 1000);
}

/**
 * Build CIDv1 (base16) from 0x-prefixed hex bytes using f01701220 prefix
 */
function hexToCidV1(hexBytes: string): string {
  const hexClean = hexBytes.startsWith('0x') ? hexBytes.slice(2) : hexBytes;
  return `f01701220${hexClean}`;
}

/**
 * Fetch JSON from delivery URL (IPFS + request ID)
 */
async function fetchDeliveryJson(deliveryUrl: string, timeout: number = 10000): Promise<any> {
  try {
    const response = await axios.get(deliveryUrl, { timeout });
    return response.data;
  } catch (error) {
    return null;
  }
}

/**
 * Fetch JSON from IPFS gateway using on-chain/subgraph hash bytes
 */
async function fetchIpfsJson(ipfsHashHex: string, timeout: number = 10000): Promise<any> {
  const cid = hexToCidV1(ipfsHashHex);
  const url = `https://gateway.autonolas.tech/ipfs/${cid}`;
  try {
    const response = await axios.get(url, { timeout });
    return response.data;
  } catch (error) {
    return null;
  }
}

/**
 * Query MM mechs and related info from subgraph
 */
export async function queryMmMechsInfo(chainConfig: string): Promise<MechInfo[] | null> {
  const mechConfig = get_mech_config(chainConfig);
  if (!mechConfig.subgraph_url) {
    throw new Error(`Subgraph URL not set for chain config: ${chainConfig}`);
  }

  try {
    const gqlRequest = await getGraphqlRequest();
    const response = await gqlRequest(mechConfig.subgraph_url, MM_MECHS_INFO_QUERY) as any;
    
    const mechFactoryToMechType = Object.fromEntries(
      Object.entries(CHAIN_TO_MECH_FACTORY_TO_MECH_TYPE[chainConfig] || {}).map(([k, v]) => [k.toLowerCase(), v])
    );
    
    const filteredMechsData: MechInfo[] = [];
    for (const item of response.meches || []) {
      if (item.service && parseInt(item.service.totalDeliveries) > 0) {
        const mechType = mechFactoryToMechType[item.mechFactory.toLowerCase()];
        if (mechType) {
          filteredMechsData.push({
            ...item,
            mech_type: mechType
          });
        }
      }
    }
    
    return filteredMechsData.slice(0, RESULTS_LIMIT);
  } catch (error) {
    console.error('Error querying mechs info:', error);
    return null;
  }
}

/**
 * Query marketplace requests from the subgraph with optional IPFS data embedding
 */
export async function queryMechRequests(
  chainConfig: string = 'base',
  options: QueryMechRequestsOptions = {}
): Promise<MechRequest[]> {
  const {
    requester_address,
    mech_address,
    from_date,
    to_date,
    include_request_data = false,
    include_delivery_data = false,
    limit = 100,
    offset = 0
  } = options;

  const mechConfig = get_mech_config(chainConfig);
  if (!mechConfig.subgraph_url) {
    throw new Error(`Subgraph URL not set for chain config: ${chainConfig}`);
  }

  try {
    // Build where clause
    const whereParts: string[] = [];
    if (requester_address) {
      whereParts.push(`requester: "${requester_address.toLowerCase()}"`);
    }
    if (mech_address) {
      whereParts.push(`priorityMech: "${mech_address.toLowerCase()}"`);
    }
    
    const fromTs = toEpoch(from_date);
    const toTs = toEpochEnd(to_date);
    if (fromTs !== null) {
      whereParts.push(`blockTimestamp_gte: ${fromTs}`);
    }
    if (toTs !== null) {
      whereParts.push(`blockTimestamp_lte: ${toTs}`);
    }

    const whereClause = whereParts.length > 0 ? `where: { ${whereParts.join(', ')} }` : '';

    // 1) Base query: marketplaceRequests
    const mrQuery = `
      query {
        marketplaceRequests(${whereClause} orderBy: blockTimestamp, orderDirection: desc, first: ${limit}, skip: ${offset}) {
          id
          requester
          priorityMech
          requestIds
          transactionHash
          blockNumber
          blockTimestamp
        }
      }
    `;

    const gqlRequest = await getGraphqlRequest();
    const mrResponse = await gqlRequest(mechConfig.subgraph_url, mrQuery) as any;
    const marketplaceRequests = mrResponse.marketplaceRequests || [];
    
    if (marketplaceRequests.length === 0) {
      return [];
    }

    // Collect requestIds
    const requestIds: string[] = [];
    for (const item of marketplaceRequests) {
      for (const rid of item.requestIds || []) {
        if (typeof rid === 'string') {
          requestIds.push(rid);
        }
      }
    }

    // Deduplicate
    const uniqueRequestIds = [...new Set(requestIds)];

    // 2) Correlate to requests for ipfsHash, mech, sender
    const requestMap: { [key: string]: any } = {};
    if (uniqueRequestIds.length > 0) {
      const idsCsv = uniqueRequestIds.map(id => `"${id}"`).join(', ');
      const reqQuery = `
        query {
          requests(where: { requestId_in: [${idsCsv}] }) {
            requestId
            ipfsHash
            sender { id }
            mech
            transactionHash
            blockNumber
            blockTimestamp
          }
        }
      `;
      
      const reqResponse = await gqlRequest(mechConfig.subgraph_url, reqQuery) as any;
      for (const r of reqResponse.requests || []) {
        requestMap[(r.requestId || '').toLowerCase()] = r;
      }
    }

    // 3) Correlate deliveries (Deliver entity has ipfsHash per request)
    const deliveryMap: { [key: string]: any } = {};
    if (uniqueRequestIds.length > 0) {
      const idsCsv = uniqueRequestIds.map(id => `"${id}"`).join(', ');
      const delQuery = `
        query {
          delivers(where: { requestId_in: [${idsCsv}] }) {
            requestId
            ipfsHash
            mech
            transactionHash
            blockNumber
            blockTimestamp
          }
        }
      `;
      
      const delResponse = await gqlRequest(mechConfig.subgraph_url, delQuery) as any;
      for (const d of delResponse.delivers || []) {
        deliveryMap[(d.requestId || '').toLowerCase()] = d;
      }
    }

    // 4) Build final results
    const results: MechRequest[] = [];
    for (const mr of marketplaceRequests) {
      for (const rid of mr.requestIds || []) {
        const ridKey = (rid || '').toLowerCase();
        const req = requestMap[ridKey];
        const dev = deliveryMap[ridKey];

        // Base
        const ts = parseInt(mr.blockTimestamp || '0');
        const item: MechRequest = {
          requestId: rid,
          requester: mr.requester,
          mech: req?.mech || mr.priorityMech,
          transactionHash: req?.transactionHash || mr.transactionHash,
          timestamp: ts ? new Date(ts * 1000).toISOString() + 'Z' : null,
        };

        // Request metadata
        if (include_request_data && req?.ipfsHash) {
          const ipfsHex = req.ipfsHash;
          const cid = hexToCidV1(ipfsHex);
          const url = `https://gateway.autonolas.tech/ipfs/${cid}`;
          item.request_data = {
            url,
            json: await fetchIpfsJson(ipfsHex),
          };
        } else {
          item.request_data = null;
        }

        // Delivery payload from Deliver.ipfsHash
        if (include_delivery_data && dev?.ipfsHash) {
          const dataHex = dev.ipfsHash;
          const cid = hexToCidV1(dataHex);
          const baseUrl = `https://gateway.autonolas.tech/ipfs/${cid}`;
          // Use hex request ID directly (not integer)
          const deliveryUrl = `${baseUrl}/${rid}`;
          item.delivery_data = {
            url: deliveryUrl,
            json: await fetchDeliveryJson(deliveryUrl),
          };
        } else {
          item.delivery_data = null;
        }

        results.push(item);
      }
    }

    return results;
  } catch (error) {
    console.error('Error querying mech requests:', error);
    return [];
  }
}

/**
 * Query agent address from hard-coded addresses
 */
export function queryAgentAddress(
  agentId: number,
  chainConfig?: string
): string | null {
  if (!chainConfig) {
    throw new Error("Chain config not specified");
  }
  
  const chainAddresses = CHAIN_TO_ADDRESSES[chainConfig];
  if (!chainAddresses) {
    return null;
  }
  
  return chainAddresses[agentId] || null;
}

/**
 * Query agent address from subgraph (placeholder for future implementation)
 */
export async function queryAgentAddressFromSubgraph(
  agentId: number,
  chainConfig?: string
): Promise<string | null> {
  // This would be implemented to query a subgraph
  // For now, fall back to hard-coded addresses
  return queryAgentAddress(agentId, chainConfig);
}
