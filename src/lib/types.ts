/** ชนิดข้อมูลกลาง ใช้ร่วมกันทั้งฝั่งเซิร์ฟเวอร์และเบราว์เซอร์ */

export const FACES = [
  'neutral',
  'happy',
  'sad',
  'angry',
  'surprised',
  'love',
  'sleepy',
  'confused',
  'wink',
  'cool',
] as const;

export type Face = (typeof FACES)[number];

export const FACE_LABEL_TH: Record<Face, string> = {
  neutral: 'ปกติ',
  happy: 'ยิ้ม',
  sad: 'เศร้า',
  angry: 'โกรธ',
  surprised: 'ตกใจ',
  love: 'รัก',
  sleepy: 'ง่วง',
  confused: 'งง',
  wink: 'ขยิบตา',
  cool: 'เท่',
};

export function isFace(v: unknown): v is Face {
  return typeof v === 'string' && (FACES as readonly string[]).includes(v);
}

/** คำสั่งท่าทางที่ออตโต้บอทรู้จัก (เฟิร์มแวร์มีฟังก์ชันเหล่านี้อยู่แล้ว) */
export const MOTIONS = [
  'walk',
  'back',
  'left',
  'right',
  'home',
  'swing',
  'updown',
  'bend',
  'shake',
  'moonwalk',
  'wave',
  'handsup',
  'handdown',
] as const;

export type MotionName = (typeof MOTIONS)[number];

export function isMotion(v: unknown): v is MotionName {
  return typeof v === 'string' && (MOTIONS as readonly string[]).includes(v);
}

/** สิ่งที่ส่งไปที่ topic ottobot/cmd */
export interface MotionPayload {
  motion: MotionName;
  face?: Face;
  ts?: number;
}

export interface SpeechPayload {
  text: string;
  face?: Face;
  lang?: string;
  ts?: number;
}

/** ข้อความในกล่องแชท */
export type ChatRole = 'user' | 'assistant' | 'robot' | 'system';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  ts: number;
  face?: Face;
  motion?: MotionPayload;
  /** true = ได้มาจาก MQTT (หุ่นส่งมา) */
  fromMqtt?: boolean;
  /** true = ตอบด้วยโหมดออฟไลน์ เพราะยังไม่ตั้งค่า AI */
  offline?: boolean;
  error?: boolean;
}

/** เหตุการณ์ที่ส่งจากเซิร์ฟเวอร์ไปเบราว์เซอร์ผ่าน SSE */
export type BridgeEvent =
  | { type: 'status'; connected: boolean; brokerUrl: string; error?: string; ts: number }
  | {
      type: 'message';
      topic: string;
      payload: string;
      json: unknown | null;
      kind: 'chat' | 'control' | 'face' | 'status' | 'motion' | 'speech' | 'other';
      ts: number;
    };

export interface AiReply {
  /** ข้อความที่แสดงในแชท / ให้หุ่นพูด */
  speech: string;
  face: Face;
  motion?: MotionPayload;
  /** ข้อความดิบจากโมเดล (เผื่อ debug) */
  raw?: string;
}
