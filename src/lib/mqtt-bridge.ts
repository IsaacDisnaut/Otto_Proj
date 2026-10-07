import mqtt, { type MqttClient, type IClientOptions } from 'mqtt';
import { getMqttConfig, type MqttConfig } from './config';
import type { BridgeEvent } from './types';

type Listener = (event: BridgeEvent) => void;

interface Bridge {
  client: MqttClient | null;
  config: MqttConfig;
  connected: boolean;
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

/** เปิดการเชื่อมต่อ (ถ้ายังไม่เปิด) — เรียกซ้ำได้ ปลอดภัย */
export function ensureConnected(): Bridge {
  const b = store();
  if (b.client) return b;

  const cfg = b.config;
  const options: IClientOptions = {
    clientId: `${cfg.clientId}-${Math.random().toString(16).slice(2, 8)}`,
    reconnectPeriod: 4000,
    connectTimeout: 10000,
    clean: true,
  };
  if (cfg.username) options.username = cfg.username;
  if (cfg.password) options.password = cfg.password;

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
    if (b.connected) {
      b.connected = false;
      emitStatus();
    }
  });

  client.on('error', (err: Error) => {
    const changed = b.connected || b.lastError !== err.message;
    b.lastError = err.message;
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
