'use client';

import { useState } from 'react';
import { MOTION_COMMANDS } from '@/lib/motions';
import { FACES, FACE_LABEL_TH, type Face, type MotionPayload } from '@/lib/types';
import type { PublicConfig } from '@/lib/config';

export interface ControlPanelProps {
  config: PublicConfig | null;
  busy: boolean;
  onMotion: (motion: MotionPayload, face?: Face) => void;
  onFaceOnly: (face: Face) => void;
  onSpeak: (text: string) => void;
  onRawPublish: (topic: string, payload: string) => void;
  onReloadConfig: () => void;
}

type Tab = 'motion' | 'manual' | 'settings';

export default function ControlPanel({
  config,
  busy,
  onMotion,
  onFaceOnly,
  onSpeak,
  onRawPublish,
  onReloadConfig,
}: ControlPanelProps) {
  const [tab, setTab] = useState<Tab>('motion');
  const [withFace, setWithFace] = useState(true);
  const [speakText, setSpeakText] = useState('');
  const [rawTopic, setRawTopic] = useState('');
  const [rawPayload, setRawPayload] = useState('{\n  "action": "ping"\n}');

  const topics = config?.mqtt.topics;

  return (
    <section className="card">
      <header className="card-head">
        <div className="card-title">
          <span className="icon">🎛</span> แผงควบคุมออตโต้บอท
        </div>
      </header>

      <div className="card-body">
        <div className="tabs">
          <button type="button" className={tab === 'motion' ? 'active' : ''} onClick={() => setTab('motion')}>
            ท่าทาง
          </button>
          <button type="button" className={tab === 'manual' ? 'active' : ''} onClick={() => setTab('manual')}>
            สั่งเอง
          </button>
          <button type="button" className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>
            ตั้งค่า
          </button>
        </div>

        {tab === 'motion' ? (
          <>
            <p className="hint" style={{ marginTop: 0, marginBottom: 11 }}>
              กดเพื่อส่งคำสั่งท่าทางไปที่หัวข้อ <code className="mono">{topics?.motion ?? '...'}</code>
              <br />
              หุ่นจะได้รับ JSON เช่น <code className="mono">{'{"motion":"walk","face":"neutral"}'}</code>
            </p>

            <div className="preset-grid">
              {MOTION_COMMANDS.map((cmd) => (
                <button
                  key={cmd.id}
                  type="button"
                  className="preset"
                  disabled={busy}
                  title={`ส่งคำสั่ง ${cmd.id}`}
                  onClick={() => onMotion({ motion: cmd.id }, withFace ? cmd.face : undefined)}
                >
                  <em>{cmd.emoji}</em>
                  {cmd.labelTh}
                  <code className="mono" style={{ color: 'var(--dim)', fontSize: 10 }}>
                    {cmd.id}
                  </code>
                </button>
              ))}
            </div>

            <div className="switch-row" style={{ marginTop: 12 }}>
              <span className="label">ส่งสีหน้าที่เข้ากับท่าไปด้วย</span>
              <button
                type="button"
                className={`btn sm ${withFace ? 'active' : ''}`}
                onClick={() => setWithFace((v) => !v)}
              >
                {withFace ? 'เปิด' : 'ปิด'}
              </button>
            </div>

            <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '14px 0 13px' }} />

            <div className="card-title" style={{ fontSize: 13, marginBottom: 9 }}>
              <span className="icon">😀</span> ส่งเฉพาะสีหน้า (ไม่ขยับตัว)
            </div>
            <div className="preset-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(78px, 1fr))' }}>
              {FACES.map((f) => (
                <button
                  key={f}
                  type="button"
                  className="preset"
                  disabled={busy}
                  title={`ส่งสีหน้า ${f}`}
                  onClick={() => onFaceOnly(f)}
                >
                  {FACE_LABEL_TH[f]}
                  <code className="mono" style={{ color: 'var(--dim)', fontSize: 10 }}>
                    {f}
                  </code>
                </button>
              ))}
            </div>
          </>
        ) : null}

        {tab === 'manual' ? (
          <>
            <div className="field">
              <label htmlFor="speak-text">
                ให้ออตโต้พูด → <code className="mono">{topics?.speech ?? '...'}</code>
              </label>
              <input
                id="speak-text"
                type="text"
                value={speakText}
                placeholder="เช่น สวัสดีครับ ยินดีที่ได้รู้จัก"
                onChange={(e) => setSpeakText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && speakText.trim()) {
                    onSpeak(speakText.trim());
                    setSpeakText('');
                  }
                }}
              />
            </div>
            <button
              type="button"
              className="btn primary sm"
              disabled={busy || !speakText.trim()}
              onClick={() => {
                onSpeak(speakText.trim());
                setSpeakText('');
              }}
            >
              🗣 ส่งข้อความให้หุ่นพูด
            </button>

            <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '16px 0 13px' }} />

            <div className="field">
              <label htmlFor="raw-topic">ส่ง MQTT ดิบ — หัวข้อ (topic)</label>
              <input
                id="raw-topic"
                type="text"
                value={rawTopic}
                placeholder={topics?.controlOut ?? 'ottobot/control/out'}
                onChange={(e) => setRawTopic(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="raw-payload">เนื้อหา (payload)</label>
              <textarea
                id="raw-payload"
                value={rawPayload}
                onChange={(e) => setRawPayload(e.target.value)}
                spellCheck={false}
              />
            </div>
            <button
              type="button"
              className="btn sm"
              disabled={busy}
              onClick={() => onRawPublish(rawTopic.trim() || topics?.controlOut || '', rawPayload)}
            >
              📤 ส่งข้อความนี้
            </button>
          </>
        ) : null}

        {tab === 'settings' ? (
          <>
            <div className="card-title" style={{ fontSize: 13, marginBottom: 9 }}>
              <span className="icon">🧠</span> Generative AI
            </div>
            <dl className="topic-table" style={{ marginBottom: 14 }}>
              <dt>สถานะ</dt>
              <dd>
                {config?.ai.configured ? (
                  <span className="chip ok">
                    <i className="dot" /> ตั้งค่าแล้ว
                  </span>
                ) : (
                  <span className="chip warn">
                    <i className="dot" /> ยังไม่ได้ตั้งค่า (โหมดออฟไลน์)
                  </span>
                )}
              </dd>
              <dt>Provider URL</dt>
              <dd>{config?.ai.providerUrl || '— ว่าง —'}</dd>
              <dt>Model</dt>
              <dd>{config?.ai.model || '— ว่าง —'}</dd>
              <dt>API key</dt>
              <dd>{config?.ai.hasApiKey ? '•••••• (มีแล้ว)' : '— ไม่ได้ใส่ —'}</dd>
            </dl>
            <p className="hint" style={{ marginTop: 0 }}>
              แก้ไขค่าได้ที่ไฟล์ <code className="mono">config/ai.txt</code> แล้วกดปุ่มด้านล่างเพื่อโหลดใหม่
              โดยไม่ต้องรีสตาร์ตเซิร์ฟเวอร์
            </p>

            <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '14px 0' }} />

            <div className="card-title" style={{ fontSize: 13, marginBottom: 9 }}>
              <span className="icon">🔊</span> เสียงพูดภาษาไทย (TTS)
            </div>
            <dl className="topic-table" style={{ marginBottom: 10 }}>
              <dt>สถานะ</dt>
              <dd>
                {config?.tts.useServer ? (
                  <span className="chip ok">
                    <i className="dot" /> ใช้ API เสียงไทย
                  </span>
                ) : (
                  <span className="chip warn">
                    <i className="dot" /> ใช้เสียงของเบราว์เซอร์
                  </span>
                )}
              </dd>
              <dt>ผู้ให้บริการ</dt>
              <dd>{config?.tts.provider ?? '—'}</dd>
              <dt>เสียง</dt>
              <dd>{config?.tts.voice || '— ค่าเริ่มต้น —'}</dd>
            </dl>
            <p className="hint" style={{ marginTop: 0 }}>
              ตั้งค่าได้ที่ไฟล์ <code className="mono">config/tts.txt</code>
              {config?.tts.useServer ? null : (
                <>
                  {' '}— เสียงไทยในเบราว์เซอร์คุณภาพต่ำ แนะนำให้ตั้ง <code className="mono">PROVIDER</code> เป็น{' '}
                  <code className="mono">google</code> หรือ <code className="mono">azure</code>
                </>
              )}
            </p>

            <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '14px 0' }} />

            <div className="card-title" style={{ fontSize: 13, marginBottom: 9 }}>
              <span className="icon">📡</span> MQTT (Mosquitto)
            </div>
            <dl className="topic-table">
              <dt>Broker</dt>
              <dd>{config?.mqtt.brokerUrl ?? '—'}</dd>
              <dt>การเข้ารหัส</dt>
              <dd>
                {config?.mqtt.secure ? (
                  <span className="chip ok">
                    <i className="dot" /> TLS (ข้ามเครือข่ายได้)
                  </span>
                ) : (
                  <span className="chip warn">
                    <i className="dot" /> ไม่เข้ารหัส (ใช้ในวงแลน)
                  </span>
                )}
              </dd>
              <dt>บัญชีผู้ใช้</dt>
              <dd>{config?.mqtt.hasCredentials ? '•••••• (ตั้งไว้แล้ว)' : '— ไม่ได้ใส่ —'}</dd>
              <dt>รับ · แชท</dt>
              <dd>{topics?.chatIn ?? '—'}</dd>
              <dt>รับ · สีหน้า</dt>
              <dd>{topics?.faceState ?? '—'}</dd>
              <dt>รับ · สถานะ</dt>
              <dd>{topics?.status ?? '—'}</dd>
              <dt>ส่ง · ท่าทาง</dt>
              <dd>{topics?.motion ?? '—'}</dd>
              <dt>ส่ง · คำพูด</dt>
              <dd>{topics?.speech ?? '—'}</dd>
              <dt>ส่ง · ควบคุม</dt>
              <dd>{topics?.controlOut ?? '—'}</dd>
            </dl>
            <p className="hint">
              แก้ไขได้ที่ไฟล์ <code className="mono">config/mqtt.txt</code>
            </p>

            <button type="button" className="btn primary sm" style={{ marginTop: 6 }} onClick={onReloadConfig}>
              🔄 โหลดค่าใหม่ + ต่อ MQTT ใหม่
            </button>
          </>
        ) : null}
      </div>
    </section>
  );
}
