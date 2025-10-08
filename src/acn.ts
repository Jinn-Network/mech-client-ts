/**
 * ACN (Agent Communication Network) helpers
 * 
 * NOTE: ACN functionality is not implemented in the TypeScript version.
 * This module provides placeholder functions to maintain CLI parity with the Python version.
 * 
 * In the Python version, ACN provides off-chain confirmation for legacy mech interactions
 * using Open AEA-based P2P communication. The TypeScript version falls back to on-chain
 * confirmation for all confirmation types.
 */

/**
 * Watch for data URL from mech via ACN (not implemented)
 * 
 * @param crypto Crypto instance (unused in TypeScript version)
 * @returns Promise that resolves to null (ACN not supported)
 */
export async function watchForDataUrlFromMech(crypto: any): Promise<string | null> {
  console.warn('⚠️  ACN (Agent Communication Network) is not implemented in the TypeScript version.');
  console.warn('   Off-chain confirmation will fall back to on-chain confirmation.');
  console.warn('   This means OFF_CHAIN and WAIT_FOR_BOTH confirmation types will behave as ON_CHAIN.');
  
  // Return null to indicate ACN is not available
  return null;
}

/**
 * Issue ACN certificate (not implemented)
 * 
 * @param certRequest Certificate request (unused in TypeScript version)
 * @param crypto Crypto instance (unused in TypeScript version)
 */
export function issueCertificate(certRequest: any, crypto: any): void {
  console.warn('⚠️  ACN certificate issuance is not implemented in the TypeScript version.');
}

/**
 * Load ACN protocol (not implemented)
 */
export function loadAcnProtocol(): void {
  console.warn('⚠️  ACN protocol loading is not implemented in the TypeScript version.');
}

/**
 * Load libp2p client connection (not implemented)
 * 
 * @param crypto Crypto instance (unused in TypeScript version)
 * @returns null (ACN not supported)
 */
export function loadLibp2pClient(crypto: any): any {
  console.warn('⚠️  libp2p client loading is not implemented in the TypeScript version.');
  return null;
}

/**
 * Check if ACN is available
 * 
 * @returns false (ACN not supported in TypeScript version)
 */
export function isAcnAvailable(): boolean {
  return false;
}

/**
 * Get ACN availability message
 * 
 * @returns Message explaining ACN unavailability
 */
export function getAcnAvailabilityMessage(): string {
  return 'ACN (Agent Communication Network) is not available in the TypeScript version. Off-chain confirmation will fall back to on-chain confirmation.';
}
