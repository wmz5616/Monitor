const crypto = require('crypto');
const mqtt = require('mqtt');

const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32ToBytes(base32) {
  const clean = base32.toUpperCase().replace(/[\s-]/g, '');
  let bits = '';
  for (let i = 0; i < clean.length; i++) {
    const val = BASE32_CHARS.indexOf(clean[i]);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, '0');
  }
  const bytes = Buffer.alloc(Math.floor(bits.length / 8));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(bits.substr(i * 8, 8), 2);
  }
  return bytes;
}

function computeTotp(secretKey, offset = 0) {
  const step = 30;
  const epoch = Math.floor(Date.now() / 1000);
  const counter = Math.floor(epoch / step) + offset;
  const buffer = Buffer.alloc(8);
  buffer.writeBigInt64BE(BigInt(counter));
  const keyBytes = base32ToBytes(secretKey);
  const hmac = crypto.createHmac('sha1', keyBytes).update(buffer).digest();
  const off = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[off] & 0x7f) << 24) |
    ((hmac[off + 1] & 0xff) << 16) |
    ((hmac[off + 2] & 0xff) << 8) |
    (hmac[off + 3] & 0xff);
  return (binary % 1000000).toString().padStart(6, '0');
}

function sha256Hex(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

async function testMqttHandshake() {
  console.log('[TEST] 开始模拟 Device B 和 Device A 的 MQTT TOTP 动态码配对握手...');
  const secretKey = 'J7K3M2ABCDEFGHIJ'; // 16 Base32 chars
  const currentCode = computeTotp(secretKey, 0);
  console.log('[TEST] Device B 生成动态码:', currentCode);

  const hash = sha256Hex('ln_totp_' + currentCode).slice(0, 16);
  const reqTopic = 'linknotify/v1/totp/req/' + hash;
  const resTopic = 'linknotify/v1/totp/res/' + hash;
  console.log('[TEST] reqTopic:', reqTopic);
  console.log('[TEST] resTopic:', resTopic);

  // 1. Device B 连接并订阅 reqTopic
  const clientB = mqtt.connect('wss://broker.emqx.io:8084/mqtt', { clientId: 'test_dev_b_' + Date.now() });
  
  await new Promise((resolve) => {
    clientB.on('connect', () => {
      console.log('[TEST] Device B MQTT 连接成功，订阅请求信道');
      clientB.subscribe(reqTopic, { qos: 1 }, resolve);
    });
  });

  clientB.on('message', (topic, buf) => {
    console.log('[TEST] Device B 收到消息:', topic);
    if (topic === reqTopic) {
      const req = JSON.parse(buf.toString());
      console.log('[TEST] Device B 收到配对请求, reqCode:', req.code);
      if (req.code === currentCode) {
        const payload = JSON.stringify({
          type: 'pair_res',
          code: currentCode,
          secretKey: secretKey,
          deviceName: 'Vivo X100 (另一部设备)',
          timestamp: Date.now()
        });
        clientB.publish(resTopic, payload, { qos: 1 });
        console.log('[TEST] Device B 已响应配对密钥');
      }
    }
  });

  // 2. Device A (手机端输入 6 位动态码) 发起配对
  let aReceivedSecret = null;
  const clientA = mqtt.connect('wss://broker.emqx.io:8084/mqtt', { clientId: 'test_dev_a_' + Date.now() });

  await new Promise((resolve) => {
    clientA.on('connect', () => {
      console.log('[TEST] Device A MQTT 连接成功，订阅响应信道');
      clientA.subscribe(resTopic, { qos: 1 }, () => {
        console.log('[TEST] Device A 发送配对请求: { code:', currentCode, '}');
        clientA.publish(reqTopic, JSON.stringify({
          type: 'pair_req',
          code: currentCode,
          clientTime: Date.now()
        }), { qos: 1 });
        resolve();
      });
    });
  });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('配对超时')), 10000);
    clientA.on('message', (topic, buf) => {
      console.log('[TEST] Device A 收到消息:', topic);
      if (topic === resTopic) {
        const res = JSON.parse(buf.toString());
        console.log('[TEST] Device A 收到响应:', res);
        const isValid = [0, -1, 1].some(off => computeTotp(res.secretKey, off) === currentCode);
        if (res.secretKey && isValid) {
          aReceivedSecret = res.secretKey;
          clearTimeout(timer);
          resolve();
        }
      }
    });
  });

  clientA.end(true);
  clientB.end(true);

  if (aReceivedSecret === secretKey) {
    console.log('[SUCCESS] 跨网 MQTT 动态码握手完全成功，密钥一致！');
    process.exit(0);
  } else {
    console.error('[FAIL] 密钥不匹配');
    process.exit(1);
  }
}

testMqttHandshake().catch(e => {
  console.error('[TEST ERROR]', e);
  process.exit(1);
});
