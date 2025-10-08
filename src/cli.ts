#!/usr/bin/env node

import { Command } from 'commander';
import { interact } from './interact';
import { deliverViaSafe } from './post_deliver';
import { getToolsForAgents, getToolDescription, getToolIoSchema } from './tool_management';
import { 
  getToolsForMarketplaceMech, 
  getToolDescription as getMarketplaceToolDescription, 
  getToolIoSchema as getMarketplaceToolIoSchema 
} from './marketplace_tool_management';
import { promptToIpfsMain, pushToIpfsMain } from './ipfs';
import { formatError } from './format';
import { queryMmMechsInfo } from './subgraph';
import { marketplaceInteract } from './marketplace_interact';

const program = new Command();

program
  .name('mechx')
  .description('TypeScript client for interacting with Mechs')
  .version('1.0.0');

// Main interact command
program
  .command('interact')
  .description('Interact with a mech specifying a prompt and tool')
  .option('--prompts <prompts...>', 'One or more prompts to send as a request')
  .option('--agent-id <id>', 'Agent ID for legacy mechs')
  .option('--priority-mech <address>', 'Priority Mech address for marketplace requests')
  .option('--use-prepaid <bool>', 'Use prepaid payment model')
  .option('--use-offchain <bool>', 'Use offchain payment model')
  .option('--key <path>', 'Path to private key file')
  .option('--tools <tools...>', 'One or more tools to use')
  .option('--ipfs-json-file <path>', 'Path to JSON file to upload as request metadata (overrides legacy prompt/tool metadata)')
  .option('--extra-attribute <attributes...>', 'Extra attributes (key=value)')
  .option('--confirm <type>', 'Confirmation method (on-chain/off-chain)')
  .option('--retries <number>', 'Number of retries')
  .option('--timeout <number>', 'Timeout in seconds')
  .option('--sleep <number>', 'Sleep between retries')
  .option('--chain-config <config>', 'Chain configuration', 'gnosis')
  .option('--post-only', 'Send request and return immediately without waiting for delivery')
  .action(async (options) => {
    try {
      // If priority-mech is provided, use marketplace interact
      if (options.priorityMech) {
        let ipfsJsonContents: Record<string, any>[] | undefined = undefined;
        if (options.ipfsJsonFile) {
          const fs = require('fs');
          const payload = JSON.parse(fs.readFileSync(options.ipfsJsonFile, 'utf8'));
          ipfsJsonContents = Array.isArray(payload) ? payload : [payload];
        }
        await marketplaceInteract({
          prompts: options.prompts,
          priorityMech: options.priorityMech,
          usePrepaid: options.usePrepaid,
          useOffchain: options.useOffchain,
          tools: options.tools,
          ipfsJsonContents,
          privateKeyPath: options.key,
          retries: options.retries,
          timeout: options.timeout,
          sleep: options.sleep,
          postOnly: options.postOnly,
          chainConfig: options.chainConfig
        });
      } else {
        // Use legacy interact
        await interact({
          prompt: options.prompts[0],
          agentId: parseInt(options.agentId),
          tool: options.tools?.[0],
          privateKeyPath: options.key,
          confirmationType: options.confirm,
          retries: options.retries,
          timeout: options.timeout,
          sleep: options.sleep,
          postOnly: options.postOnly,
          chainConfig: options.chainConfig
        });
      }
    } catch (error) {
      console.error(formatError('Failed to interact with mech', error));
      process.exit(1);
    }
  });

// Deliver command
program
  .command('deliver')
  .description('Deliver result via Gnosis Safe to AgentMech.deliverToMarketplace')
  .option('--request-id <id>', 'Request ID (hex or decimal)')
  .option('--result-file <path>', 'Path to JSON file containing the result')
  .option('--target-mech <address>', 'AgentMech contract address')
  .option('--multisig <address>', 'Gnosis Safe address')
  .option('--key <path>', 'Path to private key file')
  .option('--chain-config <config>', 'Chain configuration to use', 'base')
  .action(async (options) => {
    try {
      // Read result file and convert to resultContent
      const fs = require('fs');
      const resultContent = JSON.parse(fs.readFileSync(options.resultFile, 'utf8'));
      
      await deliverViaSafe({
        chainConfig: options.chainConfig,
        requestId: options.requestId,
        resultContent: resultContent,
        targetMechAddress: options.targetMech,
        safeAddress: options.multisig,
        privateKeyPath: options.key
      });
    } catch (error) {
      console.error(formatError('Failed to deliver result', error));
      process.exit(1);
    }
  });

// Marketplace mechs info
program
  .command('fetch-mm-mechs-info')
  .description('Fetch marketplace mechs info')
  .option('--chain-config <config>', 'Chain configuration', 'gnosis')
  .action(async (options) => {
    try {
      const mechs = await queryMmMechsInfo(options.chainConfig);
      console.log(mechs);
    } catch (error) {
      console.error(formatError('Failed to fetch marketplace mechs info', error));
      process.exit(1);
    }
  });

// Tool management commands
program
  .command('tools-for-agents')
  .description('List tools for agents (legacy)')
  .option('--agent-id <id>', 'Specific agent ID to fetch tools for')
  .option('--chain-config <config>', 'Chain configuration', 'gnosis')
  .action(async (options) => {
    try {
      await getToolsForAgents(options.agentId ? parseInt(options.agentId) : undefined, options.chainConfig);
    } catch (error) {
      console.error(formatError('Failed to fetch tools for agents', error));
      process.exit(1);
    }
  });

program
  .command('tool-description <unique-identifier>')
  .description('Get tool description (legacy)')
  .option('--chain-config <config>', 'Chain configuration', 'gnosis')
  .action(async (uniqueIdentifier: string, options) => {
    try {
      await getToolDescription(uniqueIdentifier, options.chainConfig);
    } catch (error) {
      console.error(formatError('Failed to get tool description', error));
      process.exit(1);
    }
  });

program
  .command('tool-io-schema <unique-identifier>')
  .description('Get tool I/O schema (legacy)')
  .option('--chain-config <config>', 'Chain configuration', 'gnosis')
  .action(async (uniqueIdentifier: string, options) => {
    try {
      await getToolIoSchema(uniqueIdentifier, options.chainConfig);
    } catch (error) {
      console.error(formatError('Failed to get tool I/O schema', error));
      process.exit(1);
    }
  });

// Marketplace tool management commands
program
  .command('tools-for-marketplace-mech <service-id>')
  .description('Fetch and display tools for marketplace mechs')
  .option('--chain-config <config>', 'Chain configuration to use.', 'gnosis')
  .action(async (serviceId: number, options) => {
    try {
      await getToolsForMarketplaceMech(serviceId, options.chainConfig);
    } catch (error) {
      console.error(formatError('Failed to fetch tools for marketplace mech', error));
      process.exit(1);
    }
  });

program
  .command('tool-description-for-marketplace-mech <unique-identifier>')
  .description('Fetch and display the description of a specific tool for marketplace mechs')
  .option('--chain-config <config>', 'Chain configuration to use.', 'gnosis')
  .action(async (uniqueIdentifier: string, options) => {
    try {
      await getMarketplaceToolDescription(uniqueIdentifier, options.chainConfig);
    } catch (error) {
      console.error(formatError('Failed to get marketplace tool description', error));
      process.exit(1);
    }
  });

program
  .command('tool-io-schema-for-marketplace-mech <unique-identifier>')
  .description('Fetch and display the tool\'s name and description along with the input/output schema for a specific tool for marketplace mechs')
  .option('--chain-config <config>', 'Chain configuration to use.', 'gnosis')
  .action(async (uniqueIdentifier: string, options) => {
    try {
      await getMarketplaceToolIoSchema(uniqueIdentifier, options.chainConfig);
    } catch (error) {
      console.error(formatError('Failed to get marketplace tool I/O schema', error));
      process.exit(1);
    }
  });

// IPFS commands
program
  .command('prompt-to-ipfs <prompt> <tool>')
  .description('Upload a prompt and tool to IPFS as metadata')
  .action(async (prompt: string, tool: string) => {
    try {
      await promptToIpfsMain(prompt, tool);
    } catch (error) {
      console.error(formatError('Failed to upload prompt to IPFS', error));
      process.exit(1);
    }
  });

program
  .command('push-to-ipfs <file-path>')
  .description('Upload a file to IPFS')
  .action(async (filePath: string) => {
    try {
      await pushToIpfsMain(filePath);
    } catch (error) {
      console.error(formatError('Failed to upload file to IPFS', error));
      process.exit(1);
    }
  });

program.parse();
