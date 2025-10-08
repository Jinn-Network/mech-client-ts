# Migration Guide: v1.x to v2.0

This guide helps you migrate from mech-client-ts v1.x to v2.0.

## Overview

Version 2.0 brings the TypeScript client to full feature parity with the Python `mech-client-python` by replacing WebSocket-based delivery monitoring with async RPC polling.

## Breaking Changes Summary

1. `confirmationType` parameter removed from marketplace interactions
2. `deliver.ts` renamed to `post_deliver.ts`
3. WebSocket connections no longer used for marketplace interactions

## Migration Scenarios

### Scenario 1: You use `postOnly: true` (Most Common)

**✅ No changes needed!**

If your code looks like this:
```typescript
const result = await marketplaceInteract({
  prompts: ['Your prompt'],
  priorityMech: '0x...',
  postOnly: true,  // ← You use this
  chainConfig: 'base'
});
```

**You're good to go!** The refactor only affects the delivery monitoring path, which isn't executed when `postOnly: true`.

### Scenario 2: You use `deliverViaSafe` for Safe-based delivery

**⚠️ Update your import path**

```typescript
// Before (v1.x):
import { deliverViaSafe } from 'mech-client-ts/dist/deliver.js';

// After (v2.0):
import { deliverViaSafe } from 'mech-client-ts/dist/post_deliver.js';
```

The function signature and behavior remain unchanged.

### Scenario 3: You use full delivery monitoring (without postOnly)

**⚠️ Remove `confirmationType` parameter**

```typescript
// Before (v1.x):
import { ConfirmationType } from 'mech-client-ts/dist/config.js';

const result = await marketplaceInteract({
  prompts: ['Your prompt'],
  priorityMech: '0x...',
  confirmationType: ConfirmationType.WAIT_FOR_BOTH,  // ← Remove this
  chainConfig: 'base'
});

// After (v2.0):
const result = await marketplaceInteract({
  prompts: ['Your prompt'],
  priorityMech: '0x...',
  // confirmationType removed - async delivery monitoring used automatically
  chainConfig: 'base'
});
```

**What changed:**
- No more WebSocket connections
- Automatic async RPC polling for delivery monitoring
- Cleaner, more reliable delivery detection
- Better timeout handling

### Scenario 4: You use the CLI

**⚠️ `--confirm` option removed for marketplace interactions**

```bash
# Before (v1.x):
mechx interact \
  --prompts "Your prompt" \
  --priority-mech "0x..." \
  --confirm "on-chain"  # ← Remove this

# After (v2.0):
mechx interact \
  --prompts "Your prompt" \
  --priority-mech "0x..."
  # --confirm removed
```

**Note:** The `--confirm` option is still available for legacy mech interactions (when using `--agent-id`).

### Scenario 5: You import WebSocket utilities

**⚠️ Functions deprecated for marketplace use**

If you directly use:
- `registerEventHandlers()`
- `watchForMarketplaceDataUrlFromWss()`

These are deprecated for marketplace interactions. Use the new async delivery monitoring:

```typescript
// Before (v1.x):
import { watchForMarketplaceDataUrlFromWss } from 'mech-client-ts/dist/wss.js';

// After (v2.0):
import { watchForMechDataUrl } from 'mech-client-ts/dist/delivery.js';

// New async delivery monitoring
const dataUrls = await watchForMechDataUrl(
  requestIds,        // Array of request IDs
  fromBlock,         // Starting block number
  mechAddress,       // Mech contract address
  deliverSignature,  // Event signature
  web3Instance,      // Web3 instance
  timeout            // Optional timeout in seconds
);
```

## Detailed API Changes

### `MarketplaceInteractOptions` Interface

```typescript
// v1.x
interface MarketplaceInteractOptions {
  prompts: string[];
  priorityMech: string;
  confirmationType?: ConfirmationType;  // ← Removed
  // ... other fields
}

// v2.0
interface MarketplaceInteractOptions {
  prompts: string[];
  priorityMech: string;
  // confirmationType removed
  // ... other fields
}
```

### New `delivery.ts` Module

```typescript
/**
 * Watch for marketplace data (delivery mech assignments)
 */
export async function watchForMarketplaceData(
  requestIds: string[],
  marketplaceContract: Contract<any>,
  timeout?: number
): Promise<Record<string, string>>;

/**
 * Watch for mech data URLs (IPFS hashes from Deliver events)
 */
export async function watchForMechDataUrl(
  requestIds: string[],
  fromBlock: number,
  mechContractAddress: string,
  mechDeliverSignature: string,
  web3: Web3,
  timeout?: number
): Promise<Record<string, string>>;
```

## Configuration Changes

### `wss_endpoint` Deprecated

The `wss_endpoint` field in `MechConfig` is deprecated for marketplace interactions:

```typescript
// v1.x
const config = {
  // ...
  wss_endpoint: 'wss://...',  // Required for marketplace
};

// v2.0
const config = {
  // ...
  wss_endpoint: 'wss://...',  // Optional, only for legacy mechs
  rpc_url: 'https://...',     // Now primary for marketplace
};
```

## Testing Your Migration

### 1. Update Dependencies

```bash
npm install mech-client-ts@^2.0.0
# or
yarn add mech-client-ts@^2.0.0
```

### 2. Update Imports

Check all files that import from `mech-client-ts`:

```bash
# Find all imports
grep -r "from 'mech-client-ts" .
grep -r "from \"mech-client-ts" .
```

### 3. Build and Test

```bash
# Build your project
npm run build

# Run your tests
npm test

# Test marketplace interactions
# - For postOnly: Should work immediately
# - For full monitoring: Verify delivery detection works
```

### 4. Runtime Validation

For Jinn-specific integrations:

```typescript
// Test dispatch_new_job
import { dispatchNewJob } from './gemini-agent/mcp/tools/dispatch_new_job.js';
const result = await dispatchNewJob(/* params */);
console.log('Request IDs:', result.request_ids);

// Test worker delivery
// Verify deliverViaSafe still works correctly
```

## Common Issues and Solutions

### Issue: "Cannot find module 'mech-client-ts/dist/deliver.js'"

**Solution:** Update import to `mech-client-ts/dist/post_deliver.js`

### Issue: "Property 'confirmationType' does not exist"

**Solution:** Remove `confirmationType` from your `marketplaceInteract()` calls

### Issue: "WebSocket connection errors"

**Solution:** These should no longer occur! The new version doesn't use WebSockets for marketplace interactions.

### Issue: "Delivery timeout"

**Solution:** The default timeout is now 900s (15 minutes). You can customize it:

```typescript
await marketplaceInteract({
  // ...
  timeout: 600,  // 10 minutes in seconds
});
```

## Rollback Plan

If you encounter issues:

1. **Pin to v1.x:**
   ```json
   {
     "dependencies": {
       "mech-client-ts": "^1.0.6"
     }
   }
   ```

2. **Report the issue:** [GitHub Issues](https://github.com/your-repo/mech-client-ts/issues)

3. **Contact support:** For urgent issues in production

## Benefits of v2.0

✅ **More Reliable:** RPC polling is more stable than WebSocket connections
✅ **Simpler:** No WebSocket setup or management required
✅ **Python Parity:** Same behavior as mech-client-python
✅ **Better Error Handling:** Clearer timeouts and retry logic
✅ **Cleaner Code:** Separation of concerns between marketplace and legacy mechs

## Questions?

- Check the [CHANGELOG](./CHANGELOG.md) for detailed changes
- Review the [README](./README.md) for usage examples
- Open an issue on GitHub for support

---

**Happy migrating! 🚀**
