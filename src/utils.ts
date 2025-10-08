import { Web3 } from 'web3';

/**
 * Sleep for a specified number of milliseconds
 * @param ms Milliseconds to sleep
 * @returns Promise that resolves after the specified time
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate topic ID from event signature using keccak256
 * @param event Event object with name and inputs
 * @returns Topic ID string (hex with 0x prefix)
 */
export function calculateTopicId(event: { name: string; inputs: Array<{ type: string }> }): string {
  let text = event.name;
  text += '(';
  for (const input of event.inputs) {
    text += input.type;
    text += ',';
  }
  text = text.slice(0, -1); // Remove last comma
  text += ')';
  
  // Use Web3 keccak256 to hash the signature
  return Web3.utils.keccak256(text);
}

/**
 * Get event signatures from ABI
 * @param abi Contract ABI
 * @returns Object with event signatures
 */
export function getEventSignatures(abi: any[]): { [key: string]: string } {
  const signatures: { [key: string]: string } = {};
  
  for (const item of abi) {
    if (item.type === 'event') {
      const topicId = calculateTopicId(item);
      signatures[item.name] = topicId;
    }
  }
  
  return signatures;
}

/**
 * Get specific event signatures for Request and Deliver events
 * @param abi Contract ABI
 * @returns Object with Request and Deliver event signatures
 */
export function getRequestDeliverSignatures(abi: any[]): { request: string; deliver: string } {
  const signatures = getEventSignatures(abi);
  return {
    request: signatures['Request'] || '',
    deliver: signatures['Deliver'] || ''
  };
}

/**
 * Get MarketplaceRequest event signature
 * @param abi Contract ABI
 * @returns MarketplaceRequest event signature
 */
export function getMarketplaceRequestSignature(abi: any[]): string {
  const signatures = getEventSignatures(abi);
  return signatures['MarketplaceRequest'] || '';
}
