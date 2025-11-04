# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.2] - 2025-10-29

### 🔒 Security Fix

**CRITICAL:** Removed vulnerability where `MECH_PRIVATE_KEY` environment variable was automatically written to `ethereum_private_key.txt` in the workspace root, potentially exposing private keys to AI agents and IPFS telemetry uploads.

### ✨ Added

- **New `KeyConfig` interface** for explicit private key source configuration:
  - `source: 'value'` - Direct key value
  - `source: 'file'` - Explicit file path (outside workspace)
  - `source: 'env'` - Environment variable (no file creation)
  - `source: 'operate'` - OLAS `.operate` directory integration
- **New `resolvePrivateKey()` function** - Secure key resolution with multiple source support
- **New `resolveOperateKey()` helper** - Reads keys from `.operate/services/sc-*/keys.json`
- Support for `OPERATE_HOME` environment variable to specify custom `.operate` location
- Comprehensive JSDoc documentation for all new functions

### 🔄 Changed

- `deliverViaSafe()` now accepts optional `keyConfig?: KeyConfig` parameter
- `marketplaceInteract()` now accepts optional `keyConfig?: KeyConfig` parameter
- Key resolution now prioritizes KeyConfig (if provided) over legacy parameters

### 🗑️ Deprecated

- `getPrivateKey()` - Use `resolvePrivateKey()` instead
- `getPrivateKeyPath()` - No longer writes files; use `resolvePrivateKey()` instead
- `checkPrivateKeyFile()` - No longer writes files; use `resolvePrivateKey()` instead

**Note:** All deprecated functions remain available for backward compatibility but no longer perform file-writing operations.

### 🐛 Fixed

- **SECURITY:** Eliminated automatic file creation from environment variables
- `getPrivateKeyPath()` no longer creates `ethereum_private_key.txt` in workspace
- `checkPrivateKeyFile()` no longer creates files from environment variables
- Keys stored in `.operate` directories are now accessible via fallback chain

### 📝 Documentation

- Added "Private Key Management" section to README.md
- Documented all KeyConfig source types with usage examples
- Added security best practices and warnings
- Added backward compatibility examples
- Documented `.operate` directory structure and integration

### ♻️ Backward Compatibility

✅ **100% backward compatible** - All existing code continues to work:

- `privateKey` and `privateKeyPath` parameters still supported
- `MECH_PRIVATE_KEY` environment variable still works (now via secure fallback chain)
- Legacy functions (`getPrivateKey`, `getPrivateKeyPath`, `checkPrivateKeyFile`) still available
- **Key improvement:** Environment variables no longer trigger file creation

### 🔧 Migration Guide

#### No code changes required

Existing code continues to work without modification. The vulnerability is eliminated because `MECH_PRIVATE_KEY` env var no longer triggers file creation.

#### Recommended (when convenient)

Use `KeyConfig` for explicit, secure key management:

```typescript
import { deliverViaSafe, KeyConfig } from '@jinn-network/mech-client-ts';

// Option 1: Use .operate directory (recommended for OLAS services)
const keyConfig: KeyConfig = { source: 'operate' };

await deliverViaSafe({
  chainConfig: 'base',
  requestId: '0x123',
  resultContent: {},
  targetMechAddress: '0xabc',
  safeAddress: '0xdef',
  keyConfig,  // Explicit and secure
});
```

---

## [1.1.0] - 2025-01-06

### 🚀 New Features - Python Parity Release

This release brings the TypeScript mech-client to full feature parity with the Python `mech-client-python` implementation. The client now uses async delivery monitoring via RPC polling instead of WebSocket subscriptions for marketplace interactions.

### ✨ Added

- **New `delivery.ts` module** with async delivery monitoring functions:
  - `watchForMarketplaceData()` - Polls marketplace contract for delivery mech assignments
  - `watchForMechDataUrl()` - Polls mech contract logs for Deliver events via RPC
  - Uses configurable timeouts (default: 900s / 15 minutes)
  - Uses configurable polling interval (default: 3.0s)
  - Fully async, no WebSocket dependencies

### 🔄 Changed

- `MarketplaceInteractOptions` interface no longer accepts `confirmationType` parameter (deprecated)
- Renamed `deliver.ts` to `post_deliver.ts` to match Python structure
  - If you import `deliverViaSafe`, update imports from `mech-client-ts/dist/deliver.js` to `mech-client-ts/dist/post_deliver.js`
- Marketplace interactions now use async RPC polling for delivery monitoring instead of WebSocket subscriptions
- `waitForMarketplaceDataUrl()` function completely rewritten to use two-step async monitoring:
  1. Poll marketplace for delivery mech assignment
  2. Poll delivery mech logs for IPFS hash
- Improved request ID handling with proper normalization for delivery monitoring

### 🗑️ Deprecated

- `ConfirmationType` enum is deprecated (only maintained for backward compatibility with legacy mechs)
- `wss_endpoint` config field is deprecated for marketplace interactions (only used for legacy mechs)
- `registerEventHandlers()` function is deprecated for marketplace (use async delivery monitoring)
- `watchForMarketplaceDataUrlFromWss()` function is deprecated (use `watchForMechDataUrl` from `delivery.ts`)

### 🐛 Fixed

- Removed all WebSocket connection creation and cleanup for marketplace interactions
- Fixed potential memory leaks from unclosed WebSocket connections
- Improved error handling in delivery monitoring

### 📝 Documentation

- Added comprehensive JSDoc comments to new delivery monitoring functions
- Updated function signatures with detailed parameter descriptions
- Added deprecation notices to all deprecated functions and interfaces

### ⚙️ Internal

- Removed WebSocket dependencies from marketplace interaction flow
- Improved code organization by separating delivery monitoring logic
- Better alignment with Python implementation patterns
- Cleaner separation of concerns between marketplace and legacy mech interactions

### 🔧 Migration Guide

#### If you use `postOnly: true` (most integrations):
**No changes needed!** Your code will continue to work as before. The refactor only affects the delivery monitoring code path, which is not executed when `postOnly: true`.

#### If you use full delivery monitoring (not postOnly):
1. Remove the `confirmationType` parameter from `marketplaceInteract()` calls
2. The client now automatically uses async RPC polling for delivery monitoring
3. No WebSocket setup required

#### If you use `deliverViaSafe`:
Update your import:
```typescript
// Before:
import { deliverViaSafe } from 'mech-client-ts/dist/deliver.js';

// After:
import { deliverViaSafe } from 'mech-client-ts/dist/post_deliver.js';
```

#### If you use CLI:
The `--confirm` option has been removed for marketplace interactions. It's still available for legacy mech interactions.

### 🎯 What's Next

- Publish to npm as official TypeScript client
- Add comprehensive test suite
- Create example integrations
- Potential submission to Autonolas organization

---

## [1.0.6] - Previous Release

Previous versions maintained for reference. See git history for details.
