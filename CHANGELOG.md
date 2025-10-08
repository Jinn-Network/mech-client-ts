# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
