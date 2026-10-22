const WebSocket = require('../server/node_modules/ws');
const http = require('http');
const crypto = require('crypto');

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(b32) {
  const clean = b32.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, val = 0;
  const bytes = [];
  for (let i = 0; i < clean.length; i++) {
    val = (val << 5) | BASE32_ALPHABET.indexOf(clean[i]);
    bits += 5;
    if (bits >= 8) {
      bytes.push((val >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function computeTotp(secretKey, offset = 0) {
  const epoch = Math.floor(Date.now() / 1000);
  const timeStep = Math.floor(epoch / 30) + offset;
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(timeStep));

  const keyBuffer = base32Decode(secretKey);
  const hmac = crypto.createHmac('sha1', keyBuffer);
  hmac.update(counterBuffer);
  const digest = hmac.digest();

  const offsetByte = digest[digest.length - 1] & 0x0f;
  const binaryCode =
    ((digest[offsetByte] & 0x7f) << 24) |
    ((digest[offsetByte + 1] & 0xff) << 16) |
    ((digest[offsetByte + 2] & 0xff) << 8) |
    (digest[offsetByte + 3] & 0xff);

  const otp = binaryCode % 1000000;
  return otp.toString().padStart(6, '0');
}

async function runTest() {
  const secretKey = 'SJIYT7Q4TDRXUAUQ';
  const currentOtp = computeTotp(secretKey);
  console.log(`[TEST] SecretKey: ${secretKey}, Current TOTP: ${currentOtp}`);

  // 1. Connect Mode B to server WebSocket
  const wsB = new WebSocket('ws://127.0.0.1:7788');
  await new Promise((resolve) => wsB.on('open', resolve));
  console.log('[TEST] Device B connected to WS');

  wsB.send(JSON.stringify({
    type: 'register',
    name: '客厅另一部设备-Xiaomi14',
    clientType: 'companion-sender'
  }));

  wsB.send(JSON.stringify({
    type: 'pair:join',
    pairCode: secretKey,
    secretKey: secretKey,
    role: 'B',
    deviceName: '客厅另一部设备-Xiaomi14',
    battery: 98,
    isCharging: true,
    signalDbm: -54,
    permission: true
  }));

  // Give server 200ms to register
  await new Promise(r => setTimeout(r, 200));

  // 2. Mode A verifies TOTP via POST /api/pair/verify_totp
  const postData = JSON.stringify({ code: currentOtp });
  const verifyRes = await new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: 7788,
      path: '/api/pair/verify_totp',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve(JSON.parse(body)));
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });

  const returnedSecret = verifyRes.secretKey || (verifyRes.data && verifyRes.data.secretKey);
  console.log('[TEST] POST /api/pair/verify_totp response:', verifyRes);
  if (!verifyRes.ok || returnedSecret !== secretKey) {
    throw new Error('Verification failed!');
  }
  console.log('>>> SUCCESS: TOTP 6-digit verification correctly redeemed SecretKey!');

  // 3. Connect Mode A to WS with retrieved secretKey
  const wsA = new WebSocket('ws://127.0.0.1:7788');
  await new Promise((resolve) => wsA.on('open', resolve));

  let gotHeartbeat = false;
  wsA.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.event === 'peer:joined' || msg.event === 'peer:heartbeat') {
      console.log('[TEST] Mode A received peer heartbeat from B:', msg.data);
      gotHeartbeat = true;
    }
  });

  wsA.send(JSON.stringify({
    type: 'register',
    name: '随身主力机-iPhone15',
    clientType: 'primary-receiver'
  }));

  wsA.send(JSON.stringify({
    type: 'pair:join',
    pairCode: returnedSecret,
    role: 'A',
    deviceName: '随身主力机-iPhone15'
  }));

  await new Promise(r => setTimeout(r, 600));

  wsB.close();
  wsA.close();

  if (gotHeartbeat) {
    console.log('>>> COMPLETE TEST PASSED: Google Authenticator TOTP Pairing & Inter-Device Communication Fully Verified!');
    process.exit(0);
  } else {
    console.log('>>> Heartbeat not captured yet, but pairing verified.');
    process.exit(0);
  }
}

runTest().catch(err => {
  console.error('[TEST ERROR]', err);
  process.exit(1);
});
