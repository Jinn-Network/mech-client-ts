// -*- coding: utf-8 -*-
// ------------------------------------------------------------------------------
//
//   Copyright 2025 Valory AG
//
//   Licensed under the Apache License, Version 2.0 (the "License");
//   you may not use this file except in compliance with the License.
//   You may obtain a copy of the License at
//
//       http://www.apache.org/licenses/LICENSE-2.0
//
//   Unless required by applicable law or agreed to in writing, software
//   distributed under the License is distributed on an "AS IS" BASIS,
//   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//   See the License for the specific language governing permissions and
//   limitations under the License.
//
// ------------------------------------------------------------------------------

/**
 * Onchain delivery helpers - async polling-based monitoring
 * Ported from mech_client/delivery.py
 */

import { Web3 } from 'web3';
import { Contract } from 'web3-eth-contract';

// Constants matching Python implementation
export const WAIT_SLEEP = 3.0; // seconds
export const DELIVERY_MECH_INDEX = 1;
export const DEFAULT_TIMEOUT = 900.0; // 15 minutes in seconds
export const IPFS_URL_TEMPLATE = 'https://gateway.autonolas.tech/ipfs/f01701220{}';
const ADDRESS_ZERO = '0x0000000000000000000000000000000000000000';

/**
 * Helper to sleep for a specified duration
 */
function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

/**
 * Watches for marketplace data on-chain by polling the marketplace contract.
 *
 * This function polls the marketplace contract's `mapRequestIdInfos` function
 * to check when a delivery mech has been assigned to each request ID.
 *
 * @param requestIds - Array of request IDs (hex strings without 0x prefix) to monitor
 * @param marketplaceContract - The marketplace contract instance
 * @param timeout - Optional timeout in seconds (default: 900s / 15 minutes)
 * @returns Promise resolving to a mapping of request ID -> delivery mech address
 *
 * @example
 * ```typescript
 * const deliveryMechs = await watchForMarketplaceData(
 *   ['abc123...', 'def456...'],
 *   marketplaceContract,
 *   600 // 10 minutes
 * );
 * // Returns: { 'abc123...': '0x1234...', 'def456...': '0x5678...' }
 * ```
 */
export async function watchForMarketplaceData(
  requestIds: string[],
  marketplaceContract: Contract<any>,
  timeout?: number
): Promise<Record<string, string>> {
  const requestIdsData: Record<string, string> = {};
  const startTime = Date.now();
  const timeoutMs = (timeout ?? DEFAULT_TIMEOUT) * 1000;

  while (true) {
    // Check timeout at the start of each iteration
    const elapsedTime = Date.now() - startTime;
    if (elapsedTime >= timeoutMs) {
      console.log('Timeout reached. Returning collected data.');
      return requestIdsData;
    }

    for (const requestId of requestIds) {
      // Convert request ID to bytes32 format (add 0x prefix if missing)
      const requestIdHex = requestId.startsWith('0x') ? requestId : `0x${requestId}`;

      try {
        // Call mapRequestIdInfos(bytes32) on the marketplace contract
        const requestIdInfo = await marketplaceContract.methods
          .mapRequestIdInfos(requestIdHex)
          .call();

        // Skip to next iteration if response is malformed (don't return early)
        if (!Array.isArray(requestIdInfo) || requestIdInfo.length <= DELIVERY_MECH_INDEX) {
          continue;
        }

        const deliveryMech = String(requestIdInfo[DELIVERY_MECH_INDEX]);

        // Skip to next iteration if delivery mech format is invalid (don't return early)
        if (!deliveryMech || !deliveryMech.startsWith('0x')) {
          continue;
        }

        // If delivery mech is assigned (not ADDRESS_ZERO), record it
        if (deliveryMech.toLowerCase() !== ADDRESS_ZERO.toLowerCase()) {
          requestIdsData[requestId] = deliveryMech;
        }
      } catch (error) {
        console.error(`Error fetching marketplace data for request ${requestId}:`, error);
        // Continue to next iteration on error instead of returning
        continue;
      }
    }

    // If we have delivery mechs for all requests, return
    if (Object.keys(requestIdsData).length === requestIds.length) {
      return requestIdsData;
    }

    // Sleep between polling iterations
    await sleep(WAIT_SLEEP);
  }
}

/**
 * Watches for mech data URLs on-chain by polling for Deliver events.
 *
 * This function uses eth_getLogs to incrementally scan for Deliver events
 * from a specific mech contract, extracts the IPFS hash from the event data,
 * and returns URLs for each request ID.
 *
 * @param requestIds - Array of request IDs (hex strings without 0x prefix) to monitor
 * @param fromBlock - Starting block number to scan from
 * @param mechContractAddress - The mech contract address to watch
 * @param mechDeliverSignature - Topic signature for the Deliver event (hex string without 0x)
 * @param web3 - Web3 instance for making RPC calls
 * @param timeout - Optional timeout in seconds (default: 900s / 15 minutes)
 * @returns Promise resolving to a mapping of request ID -> IPFS data URL
 *
 * @example
 * ```typescript
 * const dataUrls = await watchForMechDataUrl(
 *   ['abc123...', 'def456...'],
 *   12345678, // from block
 *   '0x9876...', // mech address
 *   '1234abcd...', // deliver signature
 *   web3Instance,
 *   600 // 10 minutes
 * );
 * // Returns: { 'abc123...': 'https://gateway.autonolas.tech/ipfs/f01701220...', ... }
 * ```
 */
export async function watchForMechDataUrl(
  requestIds: string[],
  fromBlock: number,
  mechContractAddress: string,
  mechDeliverSignature: string,
  web3: Web3,
  timeout?: number
): Promise<Record<string, string>> {
  const results: Record<string, string> = {};
  const startTime = Date.now();
  const timeoutMs = (timeout ?? DEFAULT_TIMEOUT) * 1000;

  // Ensure deliver signature has 0x prefix for topics filter
  const deliverTopic = mechDeliverSignature.startsWith('0x')
    ? mechDeliverSignature
    : `0x${mechDeliverSignature}`;

  let currentFromBlock = fromBlock;

  /**
   * Helper to fetch logs from chain
   */
  const getLogs = async (fromBlockNum: number): Promise<any[]> => {
    try {
      const logs = await web3.eth.getPastLogs({
        fromBlock: fromBlockNum,
        toBlock: 'latest',
        address: mechContractAddress,
        topics: [deliverTopic],
      });
      return logs;
    } catch (error) {
      console.error('Error fetching logs:', error);
      return [];
    }
  };

  /**
   * Helper to decode event data from log
   * Deliver event structure: Deliver(bytes32 requestId, uint256 deliveryRate, bytes deliveryData)
   */
  const getEventData = (log: any): { requestId: string; deliveryData: string } | null => {
    try {
      // The log.data contains non-indexed parameters: uint256 deliveryRate + bytes deliveryData
      // We need to decode: [bytes32, uint256, bytes]
      const dataTypes = ['bytes32', 'uint256', 'bytes'];
      const dataHex = log.data.startsWith('0x') ? log.data.slice(2) : log.data;
      const dataBuffer = Buffer.from(dataHex, 'hex');

      // Decode using web3's ABI decoder
      const decoded = web3.eth.abi.decodeParameters(dataTypes, log.data);

      // Extract request ID from first indexed topic (topic[1])
      // topic[0] is event signature, topic[1] is indexed requestId
      let requestIdHex = '';
      if (log.topics && log.topics.length > 1) {
        requestIdHex = log.topics[1];
      } else if (decoded[0]) {
        // Fallback: use decoded requestId if topics unavailable
        requestIdHex = String(decoded[0]);
      }

      // Remove 0x prefix for consistency with request IDs
      const requestId = requestIdHex.startsWith('0x')
        ? requestIdHex.slice(2).toLowerCase()
        : requestIdHex.toLowerCase();

      // Extract delivery data (bytes) - this is the IPFS hash
      const deliveryDataBytes = decoded[2];
      let deliveryDataHex = '';

      if (typeof deliveryDataBytes === 'string') {
        deliveryDataHex = deliveryDataBytes.startsWith('0x')
          ? deliveryDataBytes.slice(2)
          : deliveryDataBytes;
      } else if (Buffer.isBuffer(deliveryDataBytes)) {
        deliveryDataHex = deliveryDataBytes.toString('hex');
      }

      return { requestId, deliveryData: deliveryDataHex };
    } catch (error) {
      console.error('Error decoding event data:', error);
      return null;
    }
  };

  while (true) {
    const logs = await getLogs(currentFromBlock);
    let latestBlock = currentFromBlock;

    for (const log of logs) {
      latestBlock = Math.max(latestBlock, Number(log.blockNumber));

      const eventData = getEventData(log);
      if (!eventData) {
        continue;
      }

      const { requestId, deliveryData } = eventData;

      // Skip if already processed
      if (requestId in results) {
        continue;
      }

      // Check if this request ID is one we're watching for
      // Normalize both for comparison (remove 0x prefix, lowercase)
      const normalizedRequestId = requestId.toLowerCase().replace(/^0x/, '');
      const normalizedRequestIds = requestIds.map(id =>
        id.toLowerCase().replace(/^0x/, '')
      );

      if (normalizedRequestIds.includes(normalizedRequestId)) {
        // Format IPFS URL using the delivery data
        results[requestId] = IPFS_URL_TEMPLATE.replace('{}', deliveryData);
      }

      // If we have data for all requests, return
      if (Object.keys(results).length === requestIds.length) {
        return results;
      }
    }

    // Move to next block range
    currentFromBlock = latestBlock + 1;

    // Sleep between polling iterations
    await sleep(WAIT_SLEEP);

    // Check timeout
    const elapsedTime = Date.now() - startTime;
    if (elapsedTime >= timeoutMs) {
      console.log('Timeout reached. Returning collected data.');
      return results;
    }
  }
}
