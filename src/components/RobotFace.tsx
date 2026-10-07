'use client';

import { useEffect, useMemo, useState } from 'react';
import { FACE_COLOR, FACE_PATTERNS } from '@/lib/face-patterns';
import { FACES, FACE_LABEL_TH, type Face } from '@/lib/types';

const FACE_EMOJI: Record<Face, string> = {
  neutral: '😐',
  happy: '😊',
  sad: '😢',
  angry: '😠',
  surprised: '😲',
  love: '😍',
  sleepy: '😴',
  confused: '😕',
  wink: '😉',
  cool: '😎',
};

export interface RobotFaceProps {
  face: Face;
  /** ที่มาของหน้าปัจจุบัน: จาก AI, จากหุ่นผ่าน MQTT, หรือผู้ใช้เลือกเอง */
  source: 'ai' | 'mqtt' | 'manual';
  connected: boolean;
  onPick?: (face: Face) => void;
  /** แสดงแถวเลือกหน้าด้านล่างจอ */
  showPicker?: boolean;
}

const SOURCE_LABEL: Record<RobotFaceProps['source'], string> = {
  ai: 'จาก AI',
  mqtt: 'จากหุ่นยนต์ (MQTT)',
  manual: 'ตั้งเอง',
};

/** จอ LED แสดงสีหน้าปัจจุบันของออตโต้บอท (มุมขวาบนของเว็บ) */
export default function RobotFace({ face, source, connected, onPick, showPicker = true }: RobotFaceProps) {
  const [blink, setBlink] = useState(false);
  const pattern = FACE_PATTERNS[face] ?? FACE_PATTERNS.neutral;
  const color = FACE_COLOR[face] ?? FACE_COLOR.neutral;

  // กะพริบตาเป็นระยะให้ดูมีชีวิต
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timeout = setTimeout(() => {
        setBlink(true);
        setTimeout(() => setBlink(false), 120);
        schedule();
      }, 2600 + Math.random() * 3800);
    };
    schedule();
    return () => clearTimeout(timeout);
  }, []);

  const grid = useMemo(
    () =>
      pattern.map((row, y) => (
        <div className="led-row" key={y}>
          {row.split('').map((cell, x) => (
            <div key={x} className={cell === '#' ? 'led on' : 'led'} />
          ))}
        </div>
      )),
    [pattern],
  );

  return (
    <div className="face-dock">
      <div className="face-panel">
        <div className="face-panel-head">
          <span>หน้าจอออตโต้บอท</span>
          <span className={`chip ${connected ? 'ok' : 'bad'}`} style={{ padding: '2px 8px', fontSize: 10.5 }}>
            <i className={`dot ${connected ? 'pulse' : ''}`} />
            {connected ? 'ออนไลน์' : 'ออฟไลน์'}
          </span>
        </div>

        <div
          className={`led-screen ${blink ? 'blink' : ''}`}
          style={{ ['--led-color' as string]: color }}
          role="img"
          aria-label={`สีหน้าปัจจุบัน: ${FACE_LABEL_TH[face]}`}
        >
          {grid}
        </div>

        <div className="face-caption">
          <div>
            <div className="face-name">
              {FACE_EMOJI[face]} {FACE_LABEL_TH[face]}
            </div>
            <div className="face-source">{SOURCE_LABEL[source]}</div>
          </div>
          <code className="mono" style={{ color: 'var(--dim)' }}>
            {face}
          </code>
        </div>

        {showPicker && onPick ? (
          <div className="face-picker">
            {FACES.map((f) => (
              <button
                key={f}
                type="button"
                className={f === face ? 'active' : ''}
                title={FACE_LABEL_TH[f]}
                aria-label={`ตั้งหน้าเป็น ${FACE_LABEL_TH[f]}`}
                onClick={() => onPick(f)}
              >
                {FACE_EMOJI[f]}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export { FACE_EMOJI };
