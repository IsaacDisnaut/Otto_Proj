'use client';

import type { BridgeEvent } from '@/lib/types';

export interface LogEntry {
  id: string;
  topic: string;
  payload: string;
  kind: Extract<BridgeEvent, { type: 'message' }>['kind'];
  ts: number;
  outgoing?: boolean;
}

const KIND_LABEL: Record<LogEntry['kind'], string> = {
  chat: 'แชท',
  control: 'ควบคุม',
  face: 'สีหน้า',
  status: 'สถานะ',
  motion: 'ท่าทาง',
  speech: 'คำพูด',
  other: 'อื่น ๆ',
};

export default function MqttLog({ entries, onClear }: { entries: LogEntry[]; onClear: () => void }) {
  return (
    <section className="card">
      <header className="card-head">
        <div className="card-title">
          <span className="icon">🧾</span> บันทึกข้อความ MQTT
        </div>
        <button type="button" className="btn sm ghost" onClick={onClear}>
          ล้าง
        </button>
      </header>
      <div className="card-body">
        {entries.length === 0 ? (
          <p className="empty">ยังไม่มีข้อความ — เมื่อออตโต้บอทส่งข้อมูลเข้ามา จะแสดงที่นี่</p>
        ) : (
          <div className="log">
            {entries.map((e) => (
              <div className={`log-item kind-${e.kind}`} key={e.id}>
                <span className="time">{new Date(e.ts).toLocaleTimeString('th-TH')}</span>
                <span className="topic">
                  {e.outgoing ? '▲' : '▼'} {e.topic}
                </span>{' '}
                <span style={{ color: 'var(--dim)' }}>[{KIND_LABEL[e.kind]}]</span>
                <div className="payload">{e.payload}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
