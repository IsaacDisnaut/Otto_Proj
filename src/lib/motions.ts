import type { Face, MotionName } from './types';
import { MOTIONS } from './types';

/**
 * คำสั่งท่าทางที่เว็บส่งไปให้ออตโต้บอท
 * เว็บส่งแค่ "ชื่อคำสั่ง" ฝั่งเฟิร์มแวร์เป็นคนกำหนดว่าแต่ละท่าขยับอย่างไร
 */
export interface MotionCommand {
  id: MotionName;
  labelTh: string;
  emoji: string;
  /** สีหน้าที่เหมาะกับท่านี้ ใช้เมื่อผู้ใช้กดปุ่มเองโดยไม่ได้เลือกสีหน้า */
  face: Face;
}

export const MOTION_COMMANDS: MotionCommand[] = [
  { id: 'walk', labelTh: 'เดินหน้า', emoji: '🚶', face: 'neutral' },
  { id: 'back', labelTh: 'เดินถอยหลัง', emoji: '🔙', face: 'neutral' },
  { id: 'left', labelTh: 'เลี้ยวซ้าย', emoji: '↩️', face: 'neutral' },
  { id: 'right', labelTh: 'เลี้ยวขวา', emoji: '↪️', face: 'neutral' },
  { id: 'home', labelTh: 'ท่ายืนปกติ', emoji: '🧍', face: 'neutral' },
  { id: 'swing', labelTh: 'โยกตัว', emoji: '🎵', face: 'happy' },
  { id: 'updown', labelTh: 'ย่อ-ยืด', emoji: '↕️', face: 'happy' },
  { id: 'bend', labelTh: 'ก้มตัว', emoji: '🙇', face: 'neutral' },
  { id: 'shake', labelTh: 'สะบัดขา', emoji: '🦵', face: 'happy' },
  { id: 'moonwalk', labelTh: 'มูนวอล์ก', emoji: '🕺', face: 'cool' },
  { id: 'wave', labelTh: 'โบกมือ', emoji: '👋', face: 'happy' },
  { id: 'handsup', labelTh: 'ยกมือขึ้น', emoji: '🙌', face: 'happy' },
  { id: 'handdown', labelTh: 'เอามือลง', emoji: '👇', face: 'neutral' },
];

export const MOTION_IDS = MOTIONS;

export function findMotion(id: string): MotionCommand | undefined {
  return MOTION_COMMANDS.find((m) => m.id === id);
}

/** ชื่อไทยของท่า ไว้แสดงในแชท */
export function motionLabelTh(id: string): string {
  return findMotion(id)?.labelTh ?? id;
}
