import fs from 'node:fs';
import mqtt, { type MqttClient, type IClientOptions } from 'mqtt';
import { getMqttConfig, type MqttConfig } from './config';
import type { BridgeEvent } from './types';

type Listener = (event: BridgeEvent) => void;

interface Bridge {
  client: MqttClient | null;
  config: MqttConfig;
  connected: boolean;
  /** true = เคยต่อติดอย่างน้อยหนึ่งครั้งแล้ว */
  everConnected: boolean;
  lastError: string | null;
  listeners: Set<Listener>;
  /** เก็บเหตุการณ์ล่าสุดไว้ให้ client ที่เพิ่งเปิดหน้าเว็บ */
  buffer: BridgeEvent[];
}

const GLOBAL_KEY = Symbol.for('ottobot.mqtt.bridge');
const BUFFER_SIZE = 100;

function createBridge(): Bridge {
  return {
    client: null,
    config: getMqttConfig(),
    connected: false,
    everConnected: false,
    lastError: null,
    listeners: new Set(),
    buffer: [],
  };
}

function store(): Bridge {
  const g = globalThis as unknown as Record<symbol, Bridge | undefined>;
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = createBridge();
  return g[GLOBAL_KEY]!;
}

function emit(event: BridgeEvent) {
  const b = store();
  // เก็บเฉพาะข้อความจริงไว้เล่นย้อนหลัง ส่วนสถานะจะส่งค่าล่าสุดให้ตอนเปิดช่อง SSE อยู่แล้ว
  if (event.type === 'message') {
    b.buffer.push(event);
    if (b.buffer.length > BUFFER_SIZE) b.buffer.splice(0, b.buffer.length - BUFFER_SIZE);
  }
  for (const listener of b.listeners) {
    try {
      listener(event);
    } catch {
      /* ผู้ฟังรายนั้นหลุดไปแล้ว ไม่ต้องทำอะไร */
    }
  }
}

function emitStatus(extra?: { error?: string }) {
  const b = store();
  emit({
    type: 'status',
    connected: b.connected,
    brokerUrl: b.config.brokerUrl,
    error: extra?.error ?? b.lastError ?? undefined,
    ts: Date.now(),
  });
}

type EventKind = 'chat' | 'control' | 'face' | 'status' | 'motion' | 'speech' | 'other';

function classify(topic: string, cfg: MqttConfig): EventKind {
  const t = cfg.topics;
  if (topic === t.chatIn) return 'chat';
  if (topic === t.controlOut) return 'control';
  if (topic === t.faceState) return 'face';
  if (topic === t.status) return 'status';
  if (topic === t.motion) return 'motion';
  if (topic === t.speech) return 'speech';
  return 'other';
}

function safeJson(payload: string): unknown | null {
  const trimmed = payload.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function inboundTopics(cfg: MqttConfig): string[] {
  const t = cfg.topics;
  return Array.from(new Set([t.chatIn, t.faceState, t.status].filter(Boolean)));
}

const TLS_PORTS = new Set([8883, 8884, 8886, 443]);

/**
 * ตรวจค่าตั้งที่คนพลาดบ่อยก่อนจะพยายามต่อ
 * สำคัญเพราะบางกรณี broker ปิดการเชื่อมต่อเงียบ ๆ โดยไม่ส่ง error อะไรมาเลย
 * (เช่น พูด MQTT ธรรมดาใส่พอร์ต TLS) ผู้ใช้จะเห็นแค่ "ยังไม่เชื่อมต่อ" ลอย ๆ
 */
function configHint(cfg: MqttConfig): string | null {
  let port: number | null = null;
  let host = '';
  try {
    const url = new URL(cfg.brokerUrl);
    port = url.port ? Number(url.port) : null;
    host = url.hostname.toLowerCase();
  } catch {
    return `BROKER_URL ไม่ถูกรูปแบบ (${cfg.brokerUrl}) — ต้องเป็นแบบ mqtts://host:8883`;
  }

  const isCloudBroker = /hivemq\.cloud$|hivemq\.com$/.test(host);

  if (!cfg.secure && port !== null && TLS_PORTS.has(port)) {
    return `พอร์ต ${port} เป็นพอร์ตแบบเข้ารหัส แต่ BROKER_URL ใช้ mqtt:// — ต้องแก้เป็น mqtts://${host}:${port}`;
  }
  if (!cfg.secure && isCloudBroker) {
    return `HiveMQ Cloud รับการเชื่อมต่อแบบเข้ารหัสเท่านั้น — ต้องแก้ BROKER_URL เป็น mqtts://${host}:8883`;
  }
  if (cfg.secure && port === 1883) {
    return `พอร์ต 1883 เป็นพอร์ตแบบไม่เข้ารหัส แต่ BROKER_URL ใช้ mqtts:// — ใช้ mqtt://${host}:1883 หรือเปลี่ยนพอร์ตเป็น 8883`;
  }
  if (isCloudBroker && !cfg.username) {
    return 'HiveMQ Cloud ต้องใส่ USERNAME และ PASSWORD — สร้างได้ที่เมนู Access Management ในหน้า console (แนะนำให้ใส่ในไฟล์ config/mqtt.local.txt)';
  }
  return null;
}

/** แปลข้อความผิดพลาดที่เจอบ่อยตอนต่อ broker บนคลาวด์ ให้เป็นภาษาไทยที่บอกวิธีแก้ */
function explainError(message: string, cfg: MqttConfig): string {
  const m = message.toLowerCase();
  // ถ้าค่าตั้งดูผิดอยู่แล้ว ให้พ่วงคำเตือนไปกับ error จริงด้วย
  // ไม่งั้น error ระดับเครือข่ายจะกลบคำเตือนที่ชี้สาเหตุจริงกว่า
  const hint = configHint(cfg);
  const withHint = (text: string) => (hint ? `${text} | ${hint}` : text);

  if (m.includes('bad user name') || m.includes('bad username') || m.includes('not authorized')) {
    return withHint(`${message} — ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง ตรวจ USERNAME/PASSWORD (แนะนำให้เก็บรหัสผ่านไว้ในไฟล์ config/mqtt.local.txt)`);
  }
  if (m.includes('self signed') || m.includes('self-signed') || m.includes('unable to verify')) {
    return withHint(`${message} — ใบรับรองของ broker ตรวจไม่ผ่าน ถ้าเป็น broker ที่ออกใบรับรองเอง ให้ตั้ง CA_FILE หรือ REJECT_UNAUTHORIZED = false`);
  }
  if (m.includes('wrong version number') || m.includes('packet parsing') || m.includes('epROTO')) {
    return withHint(`${message} — ดูเหมือนพอร์ตกับโปรโตคอลไม่ตรงกัน: TLS ต้องใช้ mqtts:// (พอร์ต 8883) ส่วนแบบไม่เข้ารหัสใช้ mqtt:// (พอร์ต 1883)`);
  }
  if (m.includes('enotfound') || m.includes('eai_again')) {
    return withHint(`${message} — หาที่อยู่ broker ไม่พบ ตรวจ BROKER_URL ว่าพิมพ์ถูก (${cfg.brokerUrl})`);
  }
  if (m.includes('econnrefused')) {
    return withHint(`${message} — broker ปฏิเสธการเชื่อมต่อ ตรวจว่าพอร์ตถูกต้องและ broker เปิดอยู่`);
  }
  if (m.includes('etimedout') || m.includes('timeout')) {
    return withHint(`${message} — ต่อไม่ติดภายในเวลาที่กำหนด ตรวจอินเทอร์เน็ตและไฟร์วอลล์ (พอร์ต ${
      cfg.secure ? '8883' : '1883'
    } ขาออกต้องเปิด)`);
  }
  if (m.includes('identifier rejected')) {
    return withHint(`${message} — broker ไม่รับ CLIENT_ID นี้ ลองเปลี่ยนค่า CLIENT_ID ให้สั้นลงหรือไม่ซ้ำกับเครื่องอื่น`);
  }
  return withHint(message);
}

/** เปิดการเชื่อมต่อ (ถ้ายังไม่เปิด) — เรียกซ้ำได้ ปลอดภัย */
export function ensureConnected(): Bridge {
  const b = store();
  if (b.client) return b;

  const cfg = b.config;
  const options: IClientOptions = {
    // broker ส่วนใหญ่ (รวม HiveMQ Cloud) ต้องใช้ clientId ไม่ซ้ำกัน
    clientId: `${cfg.clientId}-${Math.random().toString(16).slice(2, 8)}`,
    reconnectPeriod: 4000,
    connectTimeout: cfg.connectTimeoutMs,
    keepalive: cfg.keepalive,
    protocolVersion: cfg.protocolVersion,
    clean: true,
  };
  if (cfg.username) options.username = cfg.username;
  if (cfg.password) options.password = cfg.password;

  // ต่อแบบเข้ารหัส เช่น HiveMQ Cloud (mqtts:// พอร์ต 8883)
  if (cfg.secure) {
    options.rejectUnauthorized = cfg.rejectUnauthorized;
    if (cfg.caFile) {
      try {
        options.ca = [fs.readFileSync(cfg.caFile)];
      } catch (err) {
        b.lastError = `อ่านไฟล์ CA ไม่ได้ (${cfg.caFile}): ${
          err instanceof Error ? err.message : String(err)
        }`;
        emitStatus();
        return b;
      }
    }
  }

  // แจ้งเตือนล่วงหน้าถ้าค่าตั้งดูผิดชัด ๆ ข้อความนี้จะถูกล้างทันทีที่ต่อติด
  b.lastError = configHint(cfg);

  let client: MqttClient;
  try {
    client = mqtt.connect(cfg.brokerUrl, options);
  } catch (err) {
    b.lastError = err instanceof Error ? err.message : String(err);
    emitStatus();
    return b;
  }
  b.client = client;

  client.on('connect', () => {
    b.connected = true;
    b.everConnected = true;
    b.lastError = null;
    const topics = inboundTopics(cfg);
    if (topics.length) {
      client.subscribe(topics, { qos: cfg.qos }, (err) => {
        if (err) {
          b.lastError = `subscribe ล้มเหลว: ${err.message}`;
          emitStatus();
        }
      });
    }
    emitStatus();
  });

  client.on('reconnect', () => {
    if (b.connected) {
      b.connected = false;
      emitStatus();
    }
  });

  client.on('close', () => {
    const wasConnected = b.connected;
    b.connected = false;

    // broker บางตัวตัดการเชื่อมต่อเงียบ ๆ โดยไม่ส่ง error มาเลย
    // ถ้าไม่เคยต่อติดและไม่มีข้อความอะไร ต้องบอกผู้ใช้ว่าเกิดอะไรขึ้น
    if (!b.everConnected && !b.lastError) {
      b.lastError =
        `ต่อ ${b.config.brokerUrl} ไม่ติด และ broker ไม่ได้แจ้งสาเหตุกลับมา — ` +
        'ตรวจที่อยู่/พอร์ต, ตรวจว่าใช้ mqtts:// คู่กับพอร์ต 8883 และตรวจ USERNAME/PASSWORD';
      emitStatus();
      return;
    }
    if (wasConnected) emitStatus();
  });

  client.on('error', (err: Error) => {
    const detail = explainError(err.message, b.config);
    const changed = b.connected || b.lastError !== detail;
    b.lastError = detail;
    b.connected = false;
    if (changed) emitStatus();
  });

  client.on('message', (topic: string, payload: Buffer) => {
    const text = payload.toString('utf8');
    emit({
      type: 'message',
      topic,
      payload: text,
      json: safeJson(text),
      kind: classify(topic, b.config),
      ts: Date.now(),
    });
  });

  return b;
}

export function subscribeEvents(listener: Listener): () => void {
  const b = ensureConnected();
  b.listeners.add(listener);
  return () => {
    b.listeners.delete(listener);
  };
}

export function recentEvents(): BridgeEvent[] {
  return [...store().buffer];
}

export function status() {
  const b = store();
  return {
    connected: b.connected,
    brokerUrl: b.config.brokerUrl,
    clientId: b.config.clientId,
    topics: b.config.topics,
    subscribed: inboundTopics(b.config),
    secure: b.config.secure,
    everConnected: b.everConnected,
    error: b.lastError,
  };
}

export async function publish(
  topic: string,
  payload: string | object,
  opts?: { qos?: 0 | 1 | 2; retain?: boolean },
): Promise<void> {
  const b = ensureConnected();
  if (!b.client) throw new Error(b.lastError || 'ยังไม่ได้เชื่อมต่อ MQTT');
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const qos = opts?.qos ?? b.config.qos;
  const retain = opts?.retain ?? b.config.retain;

  await new Promise<void>((resolve, reject) => {
    b.client!.publish(topic, body, { qos, retain }, (err) => (err ? reject(err) : resolve()));
  });

  // สะท้อนกลับให้หน้าเว็บเห็นใน log ว่าส่งอะไรออกไป
  emit({
    type: 'message',
    topic,
    payload: body,
    json: safeJson(body),
    kind: classify(topic, b.config),
    ts: Date.now(),
  });
}

/** อ่านไฟล์ config ใหม่แล้วต่อ broker ใหม่ */
export async function reload(): Promise<void> {
  const b = store();
  const old = b.client;
  b.client = null;
  b.connected = false;
  b.everConnected = false;
  b.lastError = null;
  if (old) {
    await new Promise<void>((resolve) => old.end(true, {}, () => resolve()));
  }
  b.config = getMqttConfig();
  ensureConnected();
}

export function currentConfig(): MqttConfig {
  return store().config;
}
