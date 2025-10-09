# mech-client-ts

[![npm version](https://img.shields.io/npm/v/@jinn-network/mech-client-ts.svg)](https://www.npmjs.com/package/@jinn-network/mech-client-ts)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

TypeScript client for [Autonolas AI Mechs](https://github.com/valory-xyz/mech) with full feature parity with [mech-client-python](https://github.com/valory-xyz/mech-client).

Part of the [Jinn Network](https://github.com/Jinn-Network) ecosystem.

## ⚠️ AI-Generated Code Notice

This project was primarily generated using AI assistance. While functional, users should be aware:

- **Code Review Recommended**: Thoroughly review and test all functionality before using in production
- **Active Development**: The codebase may contain patterns or implementations that need refinement
- **Community Contributions Welcome**: We encourage experienced developers to review, improve, and contribute to the codebase
- **Use at Your Own Risk**: Test extensively in your specific use case before deployment

We welcome issues, pull requests, and feedback to improve code quality and reliability.

## Features

- ✅ **Full Python Parity** - v0.0.1+ matches mech-client-python functionality
- ✅ **Async Delivery Monitoring** - RPC polling for reliable delivery detection (no WebSockets required for marketplace)
- ✅ **CLI Tool & Library** - Use as `mechx` command or import as TypeScript library
- ✅ **Marketplace & Legacy Mechs** - Support for both marketplace and legacy mech interactions
- ✅ **TypeScript Types** - Full type definitions included
- ✅ **Modern Architecture** - Clean separation of concerns, well-documented

## Installation

```bash
npm install @jinn-network/mech-client-ts
# or
yarn add @jinn-network/mech-client-ts
```

## Quick Start

### As a CLI Tool

After installation, use the `mechx` command:

```bash
# Send a request to a mech via marketplace
mechx interact \
  --prompts "your prompt" \
  --priority-mech <mech-address> \
  --tools <tool-name> \
  --chain-config base \
  --post-only \
  --key <private-key-file>

# Deliver a result (for mech workers)
mechx deliver \
  --request-id <request-id> \
  --result-file <result-file> \
  --target-mech <mech-address> \
  --multisig <safe-address> \
  --key <private-key-file> \
  --chain-config base
```

### As a Library

```typescript
import { marketplaceInteract } from '@jinn-network/mech-client-ts';

// Send a request to a mech via marketplace
const result = await marketplaceInteract({
  prompts: ['Your AI prompt here'],
  priorityMech: '0x...', // Mech address
  chainConfig: 'base',
  postOnly: true, // Just post, don't wait for delivery
  // ... other options
});

console.log('Request ID:', result.requestIds[0]);
```

See [MIGRATION.md](MIGRATION.md) for detailed usage examples and migration guide.

## What's Different from mech-client-python?

This TypeScript client achieves full feature parity with the Python client:

- **Same delivery monitoring approach** - Uses async RPC polling instead of WebSockets
- **Same configuration structure** - Chain configs, mech ABIs, etc.
- **Same CLI interface** - Similar command structure and options
- **Better for TypeScript projects** - Native TypeScript types and modern async/await patterns

## Documentation

- [CHANGELOG.md](CHANGELOG.md) - Version history and feature additions
- [MIGRATION.md](MIGRATION.md) - Detailed migration guide and usage examples
- [Python Client](https://github.com/valory-xyz/mech-client) - Official Python implementation
- [Autonolas Mechs](https://github.com/valory-xyz/mech) - Smart contracts and architecture

## Development

### Building from Source

```bash
# Clone the repository
git clone https://github.com/Jinn-Network/mech-client-ts.git
cd mech-client-ts

# Install dependencies
yarn install

# Build
yarn build

# Run tests
yarn test
```

### Available Scripts

- `yarn build` - Compile TypeScript to JavaScript
- `yarn dev` - Run in development mode with ts-node
- `yarn start` - Run the compiled JavaScript
- `yarn test` - Run tests

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for development workflow and guidelines.

For bug reports and feature requests, please use [GitHub Issues](https://github.com/Jinn-Network/mech-client-ts/issues).

## License

Apache-2.0 - See [LICENSE](LICENSE) for details.

## Credits

- Built by [Jinn Network](https://github.com/Jinn-Network)
- Based on [mech-client-python](https://github.com/valory-xyz/mech-client) by Valory
- For use with [Autonolas AI Mechs](https://github.com/valory-xyz/mech)

## Links

- [npm Package](https://www.npmjs.com/package/@jinn-network/mech-client-ts)
- [GitHub Repository](https://github.com/Jinn-Network/mech-client-ts)
- [Jinn Network](https://github.com/Jinn-Network)
- [Autonolas](https://github.com/valory-xyz)
