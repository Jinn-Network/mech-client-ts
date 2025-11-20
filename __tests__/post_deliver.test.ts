
import { deliverViaSafe, DeliverViaSafeOptions } from '../src/post_deliver';
import { Web3 } from 'web3';
import { mock, MockProxy } from 'jest-mock-extended';
import axios from 'axios';

// Mock dependencies
jest.mock('web3');
jest.mock('axios');
jest.mock('fs', () => ({
  readFileSync: jest.fn().mockReturnValue('{"abi": []}'),
  existsSync: jest.fn().mockReturnValue(true),
}));
jest.mock('path', () => ({
  join: (...args: string[]) => args.join('/'),
}));

describe('deliverViaSafe', () => {
  let web3Mock: MockProxy<any>;
  let ethMock: MockProxy<any>;
  let contractMock: MockProxy<any>;
  let methodMock: MockProxy<any>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup Web3 mocks
    web3Mock = mock<any>();
    ethMock = mock<any>();
    contractMock = mock<any>();
    methodMock = mock<any>();

    (Web3 as unknown as jest.Mock).mockImplementation(() => web3Mock);
    web3Mock.eth = ethMock;
    web3Mock.utils = {
      toChecksumAddress: (addr: string) => addr,
      keccak256: (val: string) => '0xhash',
    };

    ethMock.Contract.mockImplementation(() => contractMock);
    ethMock.getBlockNumber.mockResolvedValue(100n);
    ethMock.getChainId.mockResolvedValue(8453n);
    ethMock.accounts = {
      privateKeyToAccount: jest.fn().mockReturnValue({
        address: '0xSender',
        sign: jest.fn().mockReturnValue({
          r: '0x123',
          s: '0x456',
          v: '0x1b',
        }),
      }),
      signTransaction: jest.fn().mockResolvedValue({
        rawTransaction: '0xrawtx',
      }),
    };
    ethMock.getBlock.mockResolvedValue({
        baseFeePerGas: 1000000000n
    });
    ethMock.getMaxPriorityFeePerGas.mockResolvedValue(1500000000n);
    ethMock.getTransactionCount.mockResolvedValue(10n); // Default return
    ethMock.estimateGas.mockResolvedValue(21000n);
    ethMock.sendSignedTransaction.mockResolvedValue({
      transactionHash: '0xtxhash',
    });
    ethMock.getTransactionReceipt.mockResolvedValue({
        status: true,
        blockNumber: 105n,
        gasUsed: 21000n
    });

    // Contract method mocks
    contractMock.methods = {
      nonce: () => ({ call: jest.fn().mockResolvedValue(5n) }),
      getTransactionHash: () => ({ call: jest.fn().mockResolvedValue('0xsafehash') }),
      execTransaction: () => ({ encodeABI: jest.fn().mockReturnValue('0xexecData') }),
      deliverToMarketplace: () => ({ encodeABI: jest.fn().mockReturnValue('0xdeliverData') }),
    };

    // Axios mock for IPFS upload
    (axios.post as jest.Mock).mockResolvedValue({
        status: 200,
        data: '{"Hash": "bafybeic2giawnzibm25qs5mbhri3cnefkul4v3qhxmp7ebcl6nskhmbrxi"}'
    });
  });

  it('should use "pending" block for nonce to avoid "nonce too low" errors', async () => {
    const options: DeliverViaSafeOptions = {
      chainConfig: 'base',
      requestId: '0x123',
      resultContent: { output: 'test' },
      targetMechAddress: '0xMech',
      safeAddress: '0xSafe',
      privateKey: '0xPrivateKey',
      rpcHttpUrl: 'http://localhost:8545',
      wait: false,
    };

    await deliverViaSafe(options);

    // Verify that getTransactionCount was called with 'pending'
    expect(ethMock.getTransactionCount).toHaveBeenCalledWith('0xSender', 'pending');
  });
});
