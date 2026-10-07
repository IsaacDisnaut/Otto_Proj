import fs from 'node:fs';
import path from 'node:path';

export type ConfigMap = Record<string, string>;

const CONFIG_DIR = path.join(process.cwd(), 'config');

/**
 * อ่านไฟล์ข้อความรูปแบบ `KEY = VALUE` ทีละบรรทัด
 * - บรรทัดว่าง และบรรทัดที่ขึ้นต้นด้วย # หรือ ; จะถูกข้าม
 * - ค่าที่ครอบด้วย " หรือ ' จะถูกถอดเครื่องหมายออกให้
 */
export function parseTextConfig(raw: string): ConfigMap {
  const out: ConfigMap = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim().toUpperCase().replace(/[\s-]+/g, '_');
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function readConfigFile(name: string): ConfigMap {
  // ไฟล์ *.local.txt จะถูกใช้ทับไฟล์หลัก ถ้ามี (สะดวกเวลาไม่อยาก commit ค่าจริง)
  const base = path.join(CONFIG_DIR, `${name}.txt`);
  const local = path.join(CONFIG_DIR, `${name}.local.txt`);
  const merged: ConfigMap = {};
  for (const file of [base, local]) {
    try {
      if (fs.existsSync(file)) Object.assign(merged, parseTextConfig(fs.readFileSync(file, 'utf8')));
    } catch {
      /* อ่านไม่ได้ก็ข้ามไป */
    }
  }
  return merged;
}

export interface AiConfig {
  providerUrl: string;
  model: string;
  apiKey: string;
  temperature: number;
  maxTokens: number;
  historyLimit: number;
  timeoutMs: number;
  persona: string;
  configured: boolean;
}

export type TtsProvider = 'edge' | 'google' | 'azure' | 'openai' | 'custom' | 'browser';

export interface TtsConfig {
  provider: TtsProvider;
  apiKey: string;
  voice: string;
  lang: string;
  speed: number;
  pitch: number;
  timeoutMs: number;
  region: string;
  providerUrl: string;
  model: string;
  authHeader: string;
  authPrefix: string;
  /** true = เรียก API ฝั่งเซิร์ฟเวอร์ได้ (ไม่ใช่โหมด browser และมีค่าที่จำเป็นครบ) */
  configured: boolean;
}

export interface MqttConfig {
  brokerUrl: string;
  username: string;
  password: string;
  clientId: string;
  topics: {
    chatIn: string;
    faceState: string;
    status: string;
    motion: string;
    speech: string;
    controlOut: string;
  };
  qos: 0 | 1 | 2;
  retain: boolean;
  /** true = ต่อแบบเข้ารหัส (mqtts:// หรือ wss://) ใช้เวลาข้ามเครือข่าย */
  secure: boolean;
  /** false = ยอมรับใบรับรองที่ตรวจไม่ผ่าน (ใช้กับ broker ที่ออกใบรับรองเอง) */
  rejectUnauthorized: boolean;
  /** 4 = MQTT 3.1.1, 5 = MQTT 5 */
  protocolVersion: 4 | 5;
  /** ไฟล์ใบรับรอง CA (.pem) สำหรับ broker ที่ใช้ CA ของตัวเอง */
  caFile: string;
  keepalive: number;
  connectTimeoutMs: number;
}

const num = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const bool = (v: string | undefined, fallback = false) =>
  v == null || v === '' ? fallback : /^(1|true|yes|on)$/i.test(v.trim());

export function getAiConfig(): AiConfig {
  const c = readConfigFile('ai');
  const providerUrl = (c.PROVIDER_URL || process.env.AI_PROVIDER_URL || '').trim();
  const model = (c.MODEL || process.env.AI_MODEL || '').trim();
  return {
    providerUrl,
    model,
    apiKey: (c.API_KEY || process.env.AI_API_KEY || '').trim(),
    temperature: num(c.TEMPERATURE, 0.7),
    maxTokens: num(c.MAX_TOKENS, 800),
    historyLimit: Math.max(0, num(c.HISTORY_LIMIT, 12)),
    timeoutMs: num(c.TIMEOUT_MS, 60000),
    persona: c.PERSONA || '',
    configured: Boolean(providerUrl && model),
  };
}

export function getTtsConfig(): TtsConfig {
  const c = readConfigFile('tts');
  const raw = (c.PROVIDER || 'browser').trim().toLowerCase();
  const provider: TtsProvider = (
    ['edge', 'google', 'azure', 'openai', 'custom', 'browser'].includes(raw) ? raw : 'browser'
  ) as TtsProvider;

  const apiKey = (c.API_KEY || process.env.TTS_API_KEY || '').trim();
  const providerUrl = (c.PROVIDER_URL || '').trim();
  const region = (c.REGION || '').trim();

  // แต่ละเจ้าต้องการค่าไม่เท่ากัน จึงเช็คแยก
  let configured = false;
  if (provider === 'edge') configured = true; // ไม่ต้องใช้ API key
  else if (provider === 'google' || provider === 'openai') configured = Boolean(apiKey);
  else if (provider === 'azure') configured = Boolean(apiKey && (region || providerUrl));
  else if (provider === 'custom') configured = Boolean(providerUrl);

  return {
    provider,
    apiKey,
    voice: (c.VOICE || '').trim(),
    lang: (c.LANG || 'th-TH').trim(),
    speed: Math.min(4, Math.max(0.25, num(c.SPEED, 1))),
    pitch: Math.min(20, Math.max(-20, num(c.PITCH, 0))),
    timeoutMs: num(c.TIMEOUT_MS, 30000),
    region,
    providerUrl,
    model: (c.MODEL || 'gpt-4o-mini-tts').trim(),
    authHeader: (c.AUTH_HEADER || 'Authorization').trim(),
    authPrefix: (c.AUTH_PREFIX ?? 'Bearer').trim(),
    configured,
  };
}

export function getMqttConfig(): MqttConfig {
  const c = readConfigFile('mqtt');
  const qos = num(c.QOS, 0);
  const brokerUrl = (c.BROKER_URL || 'mqtt://localhost:1883').trim();
  const secure = /^(mqtts|wss|ssl|tls):/i.test(brokerUrl);
  const version = num(c.PROTOCOL_VERSION, 4);
  return {
    brokerUrl,
    secure,
    rejectUnauthorized: bool(c.REJECT_UNAUTHORIZED, true),
    protocolVersion: (version === 5 ? 5 : 4) as 4 | 5,
    caFile: (c.CA_FILE || '').trim(),
    keepalive: Math.max(10, num(c.KEEPALIVE, 60)),
    // ต่อข้ามอินเทอร์เน็ตช้ากว่าในวงแลน จึงรอนานกว่าเดิม
    connectTimeoutMs: Math.max(3000, num(c.CONNECT_TIMEOUT_MS, secure ? 20000 : 10000)),
    username: (c.USERNAME || '').trim(),
    password: (c.PASSWORD || '').trim(),
    clientId: (c.CLIENT_ID || 'ottobot-web').trim(),
    topics: {
      chatIn: (c.TOPIC_CHAT_IN || 'ottobot/chat/in').trim(),
      faceState: (c.TOPIC_FACE_STATE || 'ottobot/face/state').trim(),
      status: (c.TOPIC_STATUS || 'ottobot/status').trim(),
      motion: (c.TOPIC_CMD || c.TOPIC_MOTION || 'ottobot/cmd').trim(),
      speech: (c.TOPIC_SPEECH || 'ottobot/speech').trim(),
      controlOut: (c.TOPIC_CONTROL_OUT || 'ottobot/control/out').trim(),
    },
    qos: (qos === 1 || qos === 2 ? qos : 0) as 0 | 1 | 2,
    retain: bool(c.RETAIN, false),
  };
}

/** ค่าที่ปลอดภัยพอจะส่งไปให้เบราว์เซอร์ (ไม่มี API key / รหัสผ่าน) */
export function getPublicConfig() {
  const ai = getAiConfig();
  const mqtt = getMqttConfig();
  const tts = getTtsConfig();
  return {
    tts: {
      provider: tts.provider,
      voice: tts.voice,
      lang: tts.lang,
      configured: tts.configured,
      /** true = ให้เบราว์เซอร์เรียก /api/tts แทนเสียงในตัวเบราว์เซอร์ */
      useServer: tts.provider !== 'browser' && tts.configured,
    },
    ai: {
      providerUrl: ai.providerUrl,
      model: ai.model,
      configured: ai.configured,
      hasApiKey: Boolean(ai.apiKey),
      persona: ai.persona,
    },
    mqtt: {
      brokerUrl: mqtt.brokerUrl,
      clientId: mqtt.clientId,
      secure: mqtt.secure,
      hasCredentials: Boolean(mqtt.username),
      topics: mqtt.topics,
      qos: mqtt.qos,
      retain: mqtt.retain,
    },
  };
}

export type PublicConfig = ReturnType<typeof getPublicConfig>;
