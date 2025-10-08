import { mkdtempSync } from 'fs';
import { writeFileSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'node:crypto';
import axios from 'axios';
import FormData from 'form-data';

const REGISTRY_ADD_URL = 'https://registry.autonolas.tech/api/v0/add';
const IPFS_URL_TEMPLATE = 'https://gateway.autonolas.tech/ipfs/{}';

export interface MetadataObject {
  prompt: string;
  tool: string;
  nonce: string;
  [key: string]: any;
}

export async function pushMetadataToIpfs(
  prompt: string,
  tool: string,
  extraAttributes?: Record<string, any>
): Promise<[string, string]> {
  const metadata: MetadataObject = { prompt, tool, nonce: randomUUID() };
  if (extraAttributes) Object.assign(metadata, extraAttributes);

  const formData = new FormData();
  const jsonBuffer = Buffer.from(JSON.stringify(metadata, null, 2), 'utf8');
  formData.append('file', jsonBuffer, { filename: 'metadata.json', contentType: 'application/json' });

  const params = { pin: 'true', 'cid-version': '1', 'wrap-with-directory': 'false' } as const;
  const response = await axios.post(REGISTRY_ADD_URL, formData, {
    params,
    timeout: 60000,
    responseType: 'text',
    headers: formData.getHeaders(),
  });
  if (response.status !== 200) throw new Error(`IPFS registry upload failed with status ${response.status}`);

  let lastHash: string | null = null;
  for (const line of String(response.data).trim().split('\n')) {
    if (!line.trim()) continue;
    try { const entry = JSON.parse(line); if (entry.Hash) lastHash = String(entry.Hash); } catch {}
  }
  if (!lastHash) throw new Error('IPFS registry upload did not return a CID');

  const afterVersionHex = extractCodecPlusMultihashHexFromCid(lastHash);
  const v1FileHashHex = `f01${afterVersionHex}`;
  const mhBuf = extractMultihashBufferFromCid(lastHash);
  if (mhBuf[0] !== 0x12 || mhBuf[1] !== 32) throw new Error('Unexpected multihash, expected sha2-256 32 bytes');
  const digestHex = mhBuf.slice(2, 34).toString('hex');
  return [`0x${digestHex}`, lastHash];
}

export async function pushJsonToIpfs(content: any): Promise<[string, string]> {
  const formData = new FormData();
  const jsonBuffer = Buffer.from(JSON.stringify(content, null, 2), 'utf8');
  formData.append('file', jsonBuffer, { filename: 'content.json', contentType: 'application/json' });

  const params = { pin: 'true', 'cid-version': '1', 'wrap-with-directory': 'false' } as const;
  const response = await axios.post(REGISTRY_ADD_URL, formData, {
    params,
    timeout: 60000,
    responseType: 'text',
    headers: formData.getHeaders(),
  });
  if (response.status !== 200) throw new Error(`IPFS registry upload failed with status ${response.status}`);

  let lastHash: string | null = null;
  for (const line of String(response.data).trim().split('\n')) {
    if (!line.trim()) continue;
    try { const entry = JSON.parse(line); if (entry.Hash) lastHash = String(entry.Hash); } catch {}
  }
  if (!lastHash) throw new Error('IPFS registry upload did not return a CID');

  const afterVersionHex = extractCodecPlusMultihashHexFromCid(lastHash);
  const v1FileHashHex = `f01${afterVersionHex}`;
  const mhBuf = extractMultihashBufferFromCid(lastHash);
  if (mhBuf[0] !== 0x12 || mhBuf[1] !== 32) throw new Error('Unexpected multihash, expected sha2-256 32 bytes');
  const digestHex = mhBuf.slice(2, 34).toString('hex');
  return [`0x${digestHex}`, lastHash];
}

export async function pushToIpfs(filePath: string): Promise<[string, string]> {
  const fileContent = readFileSync(filePath);
  const formData = new FormData();
  formData.append('file', fileContent, { filename: 'file' });

  const params = { pin: 'true', 'cid-version': '1', 'wrap-with-directory': 'false' } as const;
  const response = await axios.post(REGISTRY_ADD_URL, formData, {
    params,
    timeout: 60000,
    responseType: 'text',
    headers: formData.getHeaders(),
  });
  if (response.status !== 200) throw new Error(`Failed to upload file to IPFS: ${response.status}`);

  let lastHash: string | null = null;
  for (const line of String(response.data).trim().split('\n')) {
    if (!line.trim()) continue;
    try { const entry = JSON.parse(line); if (entry.Hash) lastHash = String(entry.Hash); } catch {}
  }
  if (!lastHash) throw new Error('IPFS registry upload did not return a CID');

  const afterVersionHex = extractCodecPlusMultihashHexFromCid(lastHash);
  const v1FileHashHex = `f01${afterVersionHex}`;
  return [lastHash, v1FileHashHex];
}

export async function fetchIpfsHash(
  prompt: string,
  tool: string,
  extraAttributes?: Record<string, any>
): Promise<[string, string, Buffer]> {
  const metadata: MetadataObject = { prompt, tool, nonce: randomUUID() };
  if (extraAttributes) Object.assign(metadata, extraAttributes);
  const tempDir = mkdtempSync('mech-client-');
  const fileName = join(tempDir, 'metadata.json');
  try {
    writeFileSync(fileName, JSON.stringify(metadata, null, ''), 'utf8');
    const ipfsData = readFileSync(fileName);
    return ['', '', ipfsData];
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

export async function fetchIpfsHashForJson(content: any): Promise<[string, string, Buffer]> {
  const tempDir = mkdtempSync('mech-client-');
  const fileName = join(tempDir, 'content.json');
  try {
    writeFileSync(fileName, JSON.stringify(content, null, ''), 'utf8');
    const ipfsData = readFileSync(fileName);
    return ['', '', ipfsData];
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

export function toV1(cidString: string): string { return cidString; }
export function cidToHex(cidString: string): string {
  const afterVersionHex = extractCodecPlusMultihashHexFromCid(cidString);
  return `f01${afterVersionHex}`;
}

export async function promptToIpfsMain(prompt: string, tool: string): Promise<void> {
  const [truncatedHash, fullHash] = await pushMetadataToIpfs(prompt, tool);
  console.log(`Visit url: ${IPFS_URL_TEMPLATE.replace('{}', fullHash)}`);
  console.log(`Hash for Request method: ${truncatedHash}`);
}

export async function pushToIpfsMain(filePath: string): Promise<void> {
  const [v1FileHash, v1FileHashHex] = await pushToIpfs(filePath);
  console.log(`IPFS file hash v1: ${v1FileHash}`);
  console.log(`IPFS file hash v1 hex: ${v1FileHashHex}`);
}

export async function fetchIpfsHashMain(prompt: string, tool: string): Promise<void> {
  const [v1FileHash] = await fetchIpfsHash(prompt, tool);
  if (v1FileHash) console.log(`IPFS file hash v1: ${v1FileHash}`);
  else console.log(`IPFS data prepared (hash computation skipped)`);
}

function decodeCidV1ToBytes(cidStr: string): Buffer {
  let b32 = cidStr.toLowerCase();
  if (b32.startsWith('b')) b32 = b32.slice(1);
  const padLen = (8 - (b32.length % 8)) % 8;
  const b32Padded = b32.toUpperCase() + '='.repeat(padLen);
  const base32Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of b32Padded) {
    if (ch === '=') break;
    const idx = base32Chars.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) { bytes.push((value >> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(bytes);
}

function extractCodecPlusMultihashHexFromCid(cidStr: string): string {
  if (cidStr.startsWith('Qm')) {
    const bs58 = require('bs58');
    const mh = Buffer.from(bs58.decode(cidStr));
    if (mh.length < 34) throw new Error('Multihash too short');
    const codec = Buffer.from([0x70]);
    return Buffer.concat([codec, mh]).toString('hex');
  }
  const cidBytes = decodeCidV1ToBytes(cidStr);
  let i = 0;
  if (cidBytes[i] === 0x01) i += 1;
  const afterVersion = cidBytes.slice(i);
  if (afterVersion.length < 35) throw new Error('CID too short');
  return afterVersion.toString('hex');
}

function extractMultihashBufferFromCid(cidStr: string): Buffer {
  if (cidStr.startsWith('Qm')) {
    const bs58 = require('bs58');
    const mh = Buffer.from(bs58.decode(cidStr));
    if (mh.length < 34) throw new Error('Multihash too short');
    return mh;
  }
  const cidBytes = decodeCidV1ToBytes(cidStr);
  let i = 0;
  if (cidBytes[i] === 0x01) i += 1;
  while (i < cidBytes.length) { const b = cidBytes[i++]; if ((b & 0x80) === 0) break; }
  if (i >= cidBytes.length) throw new Error('CID too short');
  const multihash = cidBytes.slice(i);
  if (multihash.length < 34) throw new Error('Multihash too short');
  return multihash;
}
