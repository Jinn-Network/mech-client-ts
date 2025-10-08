const { spawnSync } = require('child_process');
const { readFileSync, writeFileSync, existsSync } = require('fs');
const { join, dirname } = require('path');
const https = require('https');

const CLIENT_DIR = dirname(__dirname);

function run(cmd, expectOk = true) {
  const p = spawnSync(cmd[0], cmd.slice(1), { cwd: CLIENT_DIR, encoding: 'utf8' });
  if (expectOk && p.status !== 0) {
    throw new Error(`Failed: ${cmd.join(' ')}\n${p.stdout}`);
  }
  return p.stdout;
}

describe('TypeScript MEC client E2E', () => {
  test('request (+optional deliver)', () => {
    const distEntry = join(CLIENT_DIR, 'dist', 'index.js');
    if (!existsSync(distEntry)) {
      console.warn('dist/index.js not found; build first with `yarn build`. Skipping.');
      return;
    }

    const ethKey = join(CLIENT_DIR, 'ethereum_private_key.txt');
    const mechKey = join(CLIENT_DIR, 'mech_private_key.txt');
    if (!existsSync(ethKey) || !existsSync(mechKey)) {
      throw new Error('Missing key files (ethereum_private_key.txt or mech_private_key.txt)');
    }

    const priorityMech = '0xab15f8d064b59447bd8e9e89dd3fa770abf5eeb7';
    const safeAddress = '0x0ca9F2a6b6b4d8459f887C04f2D7de5442662392';

    // Request (post-only)
    const reqOut = run([
      'node', 'dist/index.js', 'interact',
      '--prompts', 'e2e test (typescript)',
      '--priority-mech', priorityMech,
      '--tools', 'openai-gpt-3.5-turbo',
      '--chain-config', 'base',
      '--post-only',
      '--key', 'ethereum_private_key.txt',
    ]);

    const resultPath = join(CLIENT_DIR, 'result.json');
    if (!existsSync(resultPath)) throw new Error('result.json not created');
    const data = JSON.parse(readFileSync(resultPath, 'utf8'));
    if (!String(data.requestId || '').trim()) throw new Error('requestId missing in result.json');

    // Verify request IPFS URL is present in logs and resolvable
    const m = reqOut.match(/Prompt uploaded:\s*(https:\/\/gateway\.autonolas\.tech\/ipfs\/\S+)/);
    if (!m) throw new Error('Did not find request IPFS URL in output');
    const requestIpfsUrl = m[1];
    const req = spawnSync(process.execPath, ['-e', `require('https').get('${requestIpfsUrl}', r=>{let b='';r.on('data',c=>b+=c);r.on('end',()=>{console.log(b)})})`], { encoding: 'utf8' });
    if (req.status !== 0) throw new Error('Failed to fetch request IPFS URL');
    const ipfsJson = JSON.parse(req.stdout);
    if (ipfsJson.prompt !== 'e2e test (typescript)' || ipfsJson.tool !== 'openai-gpt-3.5-turbo') {
      throw new Error('IPFS request content mismatch');
    }

    if (process.env.RUN_ONCHAIN_E2E === '1') {
      writeFileSync(resultPath, JSON.stringify({
        requestId: String(data.requestId),
        result: 'test delivered (typescript)',
        metadata: { tool: 'openai-gpt-3.5-turbo' },
      }));

      const out = run([
        'node', 'dist/index.js', 'deliver',
        '--request-id', String(data.requestId),
        '--result-file', 'result.json',
        '--target-mech', priorityMech,
        '--multisig', safeAddress,
        '--key', 'mech_private_key.txt',
        '--chain-config', 'base',
      ]);
      if (!/Transaction Hash:/i.test(out) || !/Status:\s*confirmed/i.test(out)) {
        throw new Error('Delivery logs missing confirmation lines');
      }

      // Extract CID from upload log (Uploaded to IPFS with CID: ...)
      const cm = out.match(/Uploaded to IPFS with CID:\s*(\S+)/);
      if (!cm) throw new Error('Missing CID in deliver output');
      const cid = cm[1];
      const deliverUrl = `https://gateway.autonolas.tech/ipfs/${cid}/${String(data.requestId)}`;
      const dr = spawnSync(process.execPath, ['-e', `require('https').get('${deliverUrl}', r=>{let b='';r.on('data',c=>b+=c);r.on('end',()=>{console.log(b)})})`], { encoding: 'utf8' });
      if (dr.status !== 0) throw new Error('Failed to fetch deliver IPFS URL');
      const delivered = JSON.parse(dr.stdout);
      const expected = JSON.parse(readFileSync(resultPath, 'utf8'));
      if (JSON.stringify(delivered) !== JSON.stringify(expected)) {
        throw new Error('Delivered IPFS content mismatch');
      }
    }
  });
});


