import { Command } from 'commander';
import { ConfirmationType } from './config';
import { promptToIpfsMain, pushToIpfsMain, fetchIpfsHashMain } from './ipfs';
import { interact } from './interact';
import { marketplaceInteract } from './marketplace_interact';
import { deliverViaSafe } from './post_deliver';
import { queryMmMechsInfo, queryMechRequests } from './subgraph';
import { getToolsForAgents, getToolDescription, getToolIoSchema } from './tool_management';
import { getToolsForMarketplaceMech, getToolDescription as getMarketplaceToolDescription, getToolIoSchema as getMarketplaceToolIoSchema } from './marketplace_tool_management';
import { formatMechList, formatToolList, formatSchema, formatError, formatTransactionUrl, formatIpfsUrl } from './format';
import { readFileSync } from 'fs';
import { Web3 } from 'web3';
import { Contract } from 'web3-eth-contract';
import { join } from 'path';
import { waitForReceipt } from './wss';

const toPng = async (ipfsHash: string, path: string, requestId: string) => {
  console.log('To PNG command - to be implemented');
};

const toolsForAgents = async (agentId?: number, chainConfig: string = 'gnosis') => {
  try {
    const result = await getToolsForAgents(agentId, chainConfig);
    
    if (agentId !== undefined) {
      console.log(`Tools for Agent ${agentId}:`);
      if (result.tools && result.tools.length > 0) {
        console.log(formatToolList(result.tools));
      } else {
        console.log('No tools found');
      }
    } else {
      console.log('All Tools:');
      if (result.all_tools_with_identifiers && result.all_tools_with_identifiers.length > 0) {
        console.log(formatToolList(result.all_tools_with_identifiers));
      } else {
        console.log('No tools found');
      }
    }
  } catch (error) {
    console.error(formatError('Failed to fetch tools for agents', error));
    process.exit(1);
  }
};

const toolDescription = async (toolId: string, chainConfig: string = 'gnosis') => {
  try {
    const description = await getToolDescription(toolId, chainConfig);
    if (!description) {
      console.log('Tool description not found');
      return;
    }
    
    console.log(description);
  } catch (error) {
    console.error(formatError('Failed to fetch tool description', error));
    process.exit(1);
  }
};

const toolIoSchema = async (toolId: string, chainConfig: string = 'gnosis') => {
  try {
    const schema = await getToolIoSchema(toolId, chainConfig);
    if (!schema) {
      console.log('Tool IO schema not found');
      return;
    }
    
    console.log('Input Schema:');
    console.log(formatSchema(schema.input, 'input'));
    console.log('\nOutput Schema:');
    console.log(formatSchema(schema.output, 'output'));
  } catch (error) {
    console.error(formatError('Failed to fetch tool IO schema', error));
    process.exit(1);
  }
};

const toolsForMarketplaceMech = async (serviceId: number, chainConfig: string = 'gnosis') => {
  try {
    const result = await getToolsForMarketplaceMech(serviceId, chainConfig);
    if (!result || result.tools.length === 0) {
      console.log('No tools found for this marketplace mech');
      return;
    }
    
    console.log(formatToolList(result.tools));
  } catch (error) {
    console.error(formatError('Failed to fetch tools for marketplace mech', error));
    process.exit(1);
  }
};

const toolDescriptionForMarketplaceMech = async (toolId: string, chainConfig: string = 'gnosis') => {
  try {
    const description = await getMarketplaceToolDescription(toolId, chainConfig);
    if (!description) {
      console.log('Tool description not found');
      return;
    }
    
    console.log(description);
  } catch (error) {
    console.error(formatError('Failed to fetch tool description for marketplace mech', error));
    process.exit(1);
  }
};

const toolIoSchemaForMarketplaceMech = async (toolId: string, chainConfig: string = 'gnosis') => {
  try {
    const schema = await getMarketplaceToolIoSchema(toolId, chainConfig);
    if (!schema) {
      console.log('Tool IO schema not found');
      return;
    }
    
    console.log('Input Schema:');
    console.log(formatSchema(schema.input, 'input'));
    console.log('\nOutput Schema:');
    console.log(formatSchema(schema.output, 'output'));
  } catch (error) {
    console.error(formatError('Failed to fetch tool IO schema for marketplace mech', error));
    process.exit(1);
  }
};

// Chain maps (parity with Python scripts/utils.py)
const CHAIN_TO_NATIVE_BALANCE_TRACKER: { [chainId: number]: string } = {
  100: '0x21cE6799A22A3Da84B7c44a814a9c79ab1d2A50D',
  42161: '',
  137: '',
  8453: '0xB3921F8D8215603f0Bd521341Ac45eA8f2d274c1',
  42220: '',
  10: '',
};

const CHAIN_TO_TOKEN_BALANCE_TRACKER: { [chainId: number]: string } = {
  100: '0x53Bd432516707a5212A70216284a99A563aAC1D1',
  42161: '',
  137: '',
  8453: '0x43fB32f25dce34EB76c78C7A42C8F40F84BCD237',
  42220: '',
  10: '',
};

const ABI_DIR_PATH = join(__dirname, 'abis');
const ITOKEN_ABI_PATH = join(ABI_DIR_PATH, 'IToken.json');
const BALANCE_TRACKER_TOKEN_ABI_PATH = join(ABI_DIR_PATH, 'BalanceTrackerFixedPriceToken.json');

function getAbi(abiPath: string): any[] {
  const content = readFileSync(abiPath, 'utf8');
  return JSON.parse(content);
}

const depositNative = async (amount: string, key?: string, chainConfig?: string) => {
  try {
    const amtWei = BigInt(Math.floor(parseFloat(amount) * 1e18));
    const mechConfig = (await import('./config')).get_mech_config(chainConfig);
    const web3 = new Web3(mechConfig.rpc_url);
    const pk = (await import('./config')).getPrivateKey(key);
    const account = web3.eth.accounts.privateKeyToAccount(pk);
    web3.eth.accounts.wallet.add(account);

    const chainId = mechConfig.ledger_config.chain_id;
    const to = CHAIN_TO_NATIVE_BALANCE_TRACKER[chainId];
    if (!to) throw new Error('Native balance tracker not set for this chain');

    const tx = {
      from: account.address,
      to,
      value: '0x' + amtWei.toString(16),
      gas: String(mechConfig.gas_limit || 50000),
    } as any;

    const signed = await web3.eth.accounts.signTransaction(tx, pk);
    const sent = await web3.eth.sendSignedTransaction(signed.rawTransaction as string);
    const txHash = String(sent.transactionHash);
    const url = mechConfig.transaction_url.replace('{transaction_digest}', String(txHash));
    console.log(` - Transaction sent: ${url}`);
    console.log(' - Waiting for transaction receipt...');
    await waitForReceipt(String(txHash), web3);
    console.log('\nDeposit Successful');
  } catch (error) {
    console.error(formatError('Failed to deposit native balance', error));
    process.exit(1);
  }
};

const depositToken = async (amount: string, key?: string, chainConfig?: string) => {
  try {
    const amtWei = BigInt(Math.floor(parseFloat(amount) * 1e18));
    const mechConfig = (await import('./config')).get_mech_config(chainConfig);
    const web3 = new Web3(mechConfig.rpc_url);
    const pk = (await import('./config')).getPrivateKey(key);
    const account = web3.eth.accounts.privateKeyToAccount(pk);
    web3.eth.accounts.wallet.add(account);

    const chainId = mechConfig.ledger_config.chain_id;
    const tokenTracker = CHAIN_TO_TOKEN_BALANCE_TRACKER[chainId];
    const priceTokenMap = (await import('./marketplace_interact')).CHAIN_TO_PRICE_TOKEN as any; // reuse mapping
    const tokenAddress = priceTokenMap[chainId];
    if (!tokenTracker || !tokenAddress) throw new Error('Token or tracker not set for this chain');

    const tokenAbi = getAbi(ITOKEN_ABI_PATH);
    const token = new web3.eth.Contract(tokenAbi as any, tokenAddress);

    // Approve
    const approveTx = token.methods.approve(tokenTracker, amtWei.toString());
    const approveReceipt = await approveTx.send({ from: account.address, gas: String(mechConfig.gas_limit || 100000) });
    const approveHash = approveReceipt.transactionHash;
    console.log(` - Transaction sent: ${mechConfig.transaction_url.replace('{transaction_digest}', approveHash)}`);
    console.log(' - Waiting for transaction receipt...');
    await waitForReceipt(approveHash, web3);

    // Deposit
    const trackerAbi = getAbi(BALANCE_TRACKER_TOKEN_ABI_PATH);
    const tracker = new web3.eth.Contract(trackerAbi as any, tokenTracker);
    const depositTx = tracker.methods.deposit(amtWei.toString());
    const depositReceipt = await depositTx.send({ from: account.address, gas: String(mechConfig.gas_limit || 100000) });
    const depositHash = depositReceipt.transactionHash;
    console.log(` - Transaction sent: ${mechConfig.transaction_url.replace('{transaction_digest}', depositHash)}`);
    console.log(' - Waiting for transaction receipt...');
    await waitForReceipt(depositHash, web3);
    console.log('\nDeposit Successful');
  } catch (error) {
    console.error(formatError('Failed to deposit token balance', error));
    process.exit(1);
  }
};

const purchaseNvmSubscription = async (key: string, chainConfig: string) => {
  // Placeholder: Python uses Nevermined manager script; TS client currently does not implement it.
  console.log('Purchase NVM subscription is not implemented in the TypeScript client.');
  console.log('Please use the Python script scripts/nvm_subscribe.py for subscription purchase.');
  process.exit(1);
};

const fetchMmMechsInfo = async (chainConfig: string) => {
  try {
    const mechs = await queryMmMechsInfo(chainConfig);
    if (!mechs || mechs.length === 0) {
      console.log('No mechs found');
      return;
    }
    
    console.log(formatMechList(mechs));
  } catch (error) {
    console.error(formatError('Failed to fetch marketplace mechs info', error));
    process.exit(1);
  }
};

const deliver = async (requestId: string, resultFile: string, targetMech: string, multisig: string, key: string, chainConfig: string = 'base') => {
  try {
    const fs = require('fs');
    const resultData = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
    
    const result = await deliverViaSafe({
      requestId,
      resultContent: resultData,
      targetMechAddress: targetMech,
      safeAddress: multisig,
      privateKeyPath: key,
      chainConfig
    });
    
    if (result) {
      console.log('Delivery completed successfully');
      console.log(`Transaction hash: ${result.tx_hash}`);
      console.log(`Block number: ${result.block_number}`);
      console.log(`Gas used: ${result.gas_used}`);
    } else {
      console.log('Delivery failed');
    }
  } catch (error) {
    console.error(formatError('Failed to deliver result', error));
    process.exit(1);
  }
};

// Create the main CLI program
const program = new Command();

program
  .name('mechx')
  .description('Command-line tool for interacting with mechs')
  .version('1.0.0');

// Main interact command
program
  .command('interact')
  .description('Interact with a mech specifying a prompt and tool')
  .option('--prompts <prompts...>', 'One or more prompts to send as a request. Can be repeated.')
  .option('--agent-id <id>', 'Id of the agent to be used')
  .option('--priority-mech <address>', 'Priority Mech to be used for Marketplace Requests')
  .option('--use-prepaid', 'Uses the prepaid model for marketplace requests')
  .option('--use-offchain', 'Uses the offchain model for marketplace requests')
  .option('--key <path>', 'Path to private key to use for request minting')
  .option('--tools <tools...>', 'One or more tools to be used. Can be repeated.')
  .option('--extra-attribute <key=value>', 'Extra attribute (key=value) to be included in the request metadata', (value: string, prev: string[] = []) => [...prev, value])
  .option('--confirm <type>', 'Data verification method (on-chain/off-chain)', (value) => {
    if (value !== ConfirmationType.ON_CHAIN && value !== ConfirmationType.OFF_CHAIN) {
      throw new Error(`Invalid confirmation type: ${value}. Must be 'on-chain' or 'off-chain'`);
    }
    return value;
  })
  .option('--retries <number>', 'Number of retries for sending a transaction', parseInt)
  .option('--timeout <seconds>', 'Timeout to wait for the transaction', parseFloat)
  .option('--sleep <seconds>', 'Amount of sleep before retrying the transaction', parseFloat)
  .option('--chain-config <config>', 'Id of the mech\'s chain configuration (stored configs/mechs.json)')
  .action(async (options) => {
    try {
      // Determine if this is a marketplace or legacy interaction
      if (options.priorityMech) {
        // Marketplace interaction
        const result = await marketplaceInteract({
          prompts: options.prompts,
          priorityMech: options.priorityMech,
          usePrepaid: options.usePrepaid,
          useOffchain: options.useOffchain,
          mechOffchainUrl: options.mechOffchainUrl || '',
          tools: options.tools,
          extraAttributes: options.extraAttribute ?
            options.extraAttribute.reduce((acc: any, attr: string) => {
              const [key, value] = attr.split('=');
              acc[key] = value;
              return acc;
            }, {}) : undefined,
          privateKeyPath: options.key,
          retries: options.retries,
          timeout: options.timeout,
          sleep: options.sleep,
          postOnly: options.postOnly,
          chainConfig: options.chainConfig
        });
        
        if (result) {
          console.log('Marketplace interaction completed successfully');
        } else {
          console.log('Marketplace interaction failed');
        }
      } else {
        // Legacy interaction
        const result = await interact({
          prompt: options.prompts[0], // Use first prompt for legacy mechs
          agentId: options.agentId,
          tool: options.tools?.[0], // Use first tool for legacy mechs
          extraAttributes: options.extraAttribute ? 
            options.extraAttribute.reduce((acc: any, attr: string) => {
              const [key, value] = attr.split('=');
              acc[key] = value;
              return acc;
            }, {}) : undefined,
          privateKeyPath: options.key,
          confirmationType: options.confirm ? ConfirmationType[options.confirm.toUpperCase() as keyof typeof ConfirmationType] : ConfirmationType.WAIT_FOR_BOTH,
          retries: options.retries,
          timeout: options.timeout,
          sleep: options.sleep,
          chainConfig: options.chainConfig
        });
        
        if (result) {
          console.log('Legacy interaction completed successfully');
        } else {
          console.log('Legacy interaction failed');
        }
      }
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  });

// Deliver command
program
  .command('deliver')
  .description('Deliver result via Gnosis Safe to AgentMech.deliverToMarketplace')
  .argument('<request-id>', 'Request ID to deliver')
  .argument('<result-file>', 'Path to result JSON file')
  .argument('<target-mech>', 'Target mech address')
  .argument('<safe-address>', 'Gnosis Safe address')
  .option('--key <path>', 'Path to private key file')
  .option('--chain-config <config>', 'Chain configuration')
  .option('--rpc-url <url>', 'RPC HTTP URL')
  .option('--no-wait', 'Do not wait for transaction confirmation')
  .action(async (requestId, resultFile, targetMech, safeAddress, options) => {
    try {
      const fs = require('fs');
      const resultContent = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
      
      const result = await deliverViaSafe({
        chainConfig: options.chainConfig || 'gnosis',
        requestId,
        resultContent,
        targetMechAddress: targetMech,
        safeAddress,
        privateKeyPath: options.key,
        rpcHttpUrl: options.rpcUrl,
        wait: options.wait !== false
      });
      
      console.log('Delivery result:', result);
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  });

// Fetch marketplace mechs info command
program
  .command('fetch-mm-mechs-info')
  .description('Fetch marketplace mechs info from subgraph')
  .option('--chain-config <config>', 'Chain configuration', 'gnosis')
  .action(async (options) => {
    try {
      await fetchMmMechsInfo(options.chainConfig);
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
      await toolsForAgents(options.agentId ? parseInt(options.agentId) : undefined, options.chainConfig);
    } catch (error) {
      console.error(formatError('Failed to fetch tools for agents', error));
      process.exit(1);
    }
  });

program
  .command('tool-description <unique-identifier>')
  .description('Get tool description (legacy)')
  .option('--chain-config <config>', 'Chain configuration', 'gnosis')
  .action(async (uniqueIdentifier, options) => {
    try {
      await toolDescription(uniqueIdentifier, options.chainConfig);
    } catch (error) {
      console.error(formatError('Failed to fetch tool description', error));
      process.exit(1);
    }
  });

program
  .command('tool-io-schema <unique-identifier>')
  .description('Get tool IO schema (legacy)')
  .option('--chain-config <config>', 'Chain configuration', 'gnosis')
  .action(async (uniqueIdentifier, options) => {
    try {
      const schema = await getToolIoSchema(uniqueIdentifier, options.chainConfig);
      console.log('Tool Schema:');
      console.log(JSON.stringify(schema, null, 2));
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  });

program
  .command('tools-for-marketplace-mech <service-id>')
  .description('List tools for marketplace mech')
  .option('--chain-config <config>', 'Chain configuration', 'gnosis')
  .action(async (serviceId, options) => {
    try {
      const result = await getToolsForMarketplaceMech(parseInt(serviceId), options.chainConfig);
      
      console.log(`Tools for Marketplace Mech (Service ID: ${serviceId}):`);
      if (result.tools && result.tools.length > 0) {
        result.tools.forEach(tool => {
          console.log(`  - ${tool.tool_name} (${tool.unique_identifier})`);
        });
      } else {
        console.log('  No tools found');
      }
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  });

program
  .command('tool-description-for-marketplace-mech <unique-identifier>')
  .description('Get tool description for marketplace mech')
  .option('--chain-config <config>', 'Chain configuration', 'gnosis')
  .action(async (uniqueIdentifier, options) => {
    try {
      const description = await getMarketplaceToolDescription(uniqueIdentifier, options.chainConfig);
      console.log(`Description: ${description}`);
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  });

program
  .command('tool-io-schema-for-marketplace-mech <unique-identifier>')
  .description('Get tool IO schema for marketplace mech')
  .option('--chain-config <config>', 'Chain configuration', 'gnosis')
  .action(async (uniqueIdentifier, options) => {
    try {
      const schema = await getMarketplaceToolIoSchema(uniqueIdentifier, options.chainConfig);
      console.log('Tool Schema:');
      console.log(JSON.stringify(schema, null, 2));
    } catch (error) {
      console.error('Error:', error);
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
      console.error('Error:', error);
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
      console.error('Error:', error);
      process.exit(1);
    }
  });

program
  .command('to-png <ipfs-hash> <path> <request-id>')
  .description('Convert a stability AI API\'s diffusion model output into a PNG format')
  .action(async (ipfsHash: string, path: string, requestId: string) => {
    try {
      await toPng(ipfsHash, path, requestId);
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  });

// All duplicate commands removed

program
  .command('tool-description <tool-id>')
  .description('Fetch and display the description of a specific tool')
  .option('--chain-config <config>', 'Chain configuration to use.', 'gnosis')
  .action(async (toolId: string, options) => {
    try {
      await toolDescription(toolId, options.chainConfig);
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  });

program
  .command('tool-io-schema <tool-id>')
  .description('Fetch and display the tool\'s name and description along with the input/output schema for a specific tool')
  .option('--chain-config <config>', 'Chain configuration to use.', 'gnosis')
  .action(async (toolId: string, options) => {
    try {
      await toolIoSchema(toolId, options.chainConfig);
    } catch (error) {
      console.error('Error:', error);
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
      await toolsForMarketplaceMech(serviceId, options.chainConfig);
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  });

program
  .command('tool-description-for-marketplace-mech <tool-id>')
  .description('Fetch and display the description of a specific tool for marketplace mechs')
  .option('--chain-config <config>', 'Chain configuration to use.', 'gnosis')
  .action(async (toolId: string, options) => {
    try {
      await toolDescriptionForMarketplaceMech(toolId, options.chainConfig);
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  });

program
  .command('tool-io-schema-for-marketplace-mech <tool-id>')
  .description('Fetch and display the tool\'s name and description along with the input/output schema for a specific tool for marketplace mechs')
  .option('--chain-config <config>', 'Chain configuration to use.', 'gnosis')
  .action(async (toolId: string, options) => {
    try {
      await toolIoSchemaForMarketplaceMech(toolId, options.chainConfig);
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  });

// Payment commands
program
  .command('deposit-native <amount>')
  .description('Deposits Native balance for prepaid requests')
  .option('--chain-config <config>', 'Id of the mech\'s chain configuration (stored configs/mechs.json)')
  .option('--key <path>', 'Path to private key to use for deposit')
  .action(async (amount: string, options) => {
    try {
      await depositNative(amount, options.key, options.chainConfig);
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  });

program
  .command('deposit-token <amount>')
  .description('Deposits Token balance for prepaid requests')
  .option('--chain-config <config>', 'Id of the mech\'s chain configuration (stored configs/mechs.json)')
  .option('--key <path>', 'Path to private key to use for deposit')
  .action(async (amount: string, options) => {
    try {
      await depositToken(amount, options.key, options.chainConfig);
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  });

program
  .command('purchase-nvm-subscription')
  .description('Allows to purchase nvm subscription for nvm mech requests')
  .requiredOption('--chain-config <config>', 'Id of the mech\'s chain configuration (stored configs/mechs.json)')
  .requiredOption('--key <path>', 'Path to private key to use for deposit')
  .action(async (options) => {
    try {
      await purchaseNvmSubscription(options.key, options.chainConfig);
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  });

// Marketplace info command
program
  .command('fetch-mm-mechs-info')
  .description('Fetches info of mm mechs')
  .requiredOption('--chain-config <config>', 'Id of the mech\'s chain configuration (stored configs/mechs.json)')
  .action(async (options) => {
    try {
      await fetchMmMechsInfo(options.chainConfig);
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  });

// Delivery command
program
  .command('deliver')
  .description('Deliver result via Gnosis Safe to AgentMech.deliverToMarketplace (production path)')
  .requiredOption('--request-id <id>', 'Request ID (hex or decimal)')
  .requiredOption('--result-file <path>', 'Path to JSON result file')
  .requiredOption('--target-mech <address>', 'AgentMech contract address')
  .requiredOption('--multisig <address>', 'Gnosis Safe address to execute the delivery')
  .requiredOption('--key <path>', 'Path to EOA private key for Safe exec signer')
  .option('--chain-config <config>', 'Chain config to use', 'base')
  .action(async (options) => {
    try {
      await deliver(options.requestId, options.resultFile, options.targetMech, options.multisig, options.key, options.chainConfig);
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  });

export default program;
