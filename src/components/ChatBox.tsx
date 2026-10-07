'use client';

import { useEffect, useRef, useState } from 'react';
import { FACE_EMOJI } from './RobotFace';
import { motionLabelTh } from '@/lib/motions';
import { FACE_LABEL_TH, type ChatMessage } from '@/lib/types';

const QUICK_PROMPTS = [
  'สวัสดีออตโต้',
  'เต้นให้ดูหน่อย',
  'เดินไปข้างหน้า',
  'โบกมือทักทาย',
  'เล่าเรื่องตลกให้ฟัง',
  'ทำหน้าเศร้าซิ',
];

const ROLE_AVATAR: Record<ChatMessage['role'], string> = {
  user: '🧑',
  assistant: '🤖',
  robot: '📡',
  system: 'ℹ️',
};

const timeText = (ts: number) =>
  new Date(ts).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export interface ChatBoxProps {
  messages: ChatMessage[];
  busy: boolean;
  onSend: (text: string) => void;
  onClear: () => void;
  speech: {
    ttsSupported: boolean;
    ttsEnabled: boolean;
    setTtsEnabled: (v: boolean) => void;
    speaking: boolean;
    speak: (text: string) => void;
    stopSpeaking: () => void;
    sttSupported: boolean;
    listening: boolean;
    interim: string;
    sttError: string | null;
    toggleListening: () => void;
    autoSendVoice: boolean;
    setAutoSendVoice: (v: boolean) => void;
    /** ข้อความจากไมโครโฟนที่ยังไม่ส่ง (โหมด "พูดจบส่งทันที" = ปิด) */
    voiceDraft: { text: string; nonce: number } | null;
  };
}

export default function ChatBox({ messages, busy, onSend, onClear, speech }: ChatBoxProps) {
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy, speech.interim]);

  // เติมข้อความที่ได้จากไมโครโฟนลงช่องพิมพ์ (กรณีไม่ได้เปิด "พูดจบส่งทันที")
  const voiceNonce = speech.voiceDraft?.nonce ?? 0;
  useEffect(() => {
    const incoming = speech.voiceDraft?.text?.trim();
    if (!voiceNonce || !incoming) return;
    setDraft((current) => (current.trim() ? `${current.trim()} ${incoming}` : incoming));
    textareaRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceNonce]);

  const submit = () => {
    const text = draft.trim();
    if (!text || busy) return;
    onSend(text);
    setDraft('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <section className="card chat-card">
      <header className="card-head">
        <div className="card-title">
          <span className="icon">💬</span> กล่องแชทกับออตโต้บอท
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {speech.speaking ? (
            <button type="button" className="btn sm" onClick={speech.stopSpeaking}>
              ⏹ หยุดพูด
            </button>
          ) : null}
          <button type="button" className="btn sm ghost" onClick={onClear} title="ล้างประวัติการสนทนา">
            🗑 ล้างแชท
          </button>
        </div>
      </header>

      <div className="chat-scroll" ref={scrollRef}>
        {messages.map((m) => (
          <div className={`msg ${m.role}`} key={m.id}>
            <div className="msg-avatar">{ROLE_AVATAR[m.role]}</div>
            <div style={{ minWidth: 0 }}>
              <div className="bubble">{m.text}</div>
              <div className="msg-meta" style={m.role === 'user' ? { justifyContent: 'flex-end' } : undefined}>
                <span>{timeText(m.ts)}</span>
                {m.role === 'robot' ? <span className="msg-tag">📡 จากหุ่นยนต์</span> : null}
                {m.face && m.role !== 'user' ? (
                  <span className="msg-tag">
                    {FACE_EMOJI[m.face]} {FACE_LABEL_TH[m.face]}
                  </span>
                ) : null}
                {m.motion ? (
                  <span className="msg-tag motion">🦿 {motionLabelTh(m.motion.motion)}</span>
                ) : null}
                {m.offline ? <span className="msg-tag offline">โหมดออฟไลน์</span> : null}
                {m.role !== 'user' && m.role !== 'system' && speech.ttsSupported ? (
                  <button
                    type="button"
                    className="speak-btn"
                    onClick={() => speech.speak(m.text)}
                    title="อ่านออกเสียงข้อความนี้"
                  >
                    🔊 อ่าน
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ))}

        {busy ? (
          <div className="msg assistant">
            <div className="msg-avatar">🤖</div>
            <div className="bubble">
              <span className="typing">
                <i />
                <i />
                <i />
              </span>
            </div>
          </div>
        ) : null}
      </div>

      <div className="chat-input-area">
        <div className="quick-row">
          {QUICK_PROMPTS.map((p) => (
            <button key={p} type="button" className="quick" onClick={() => onSend(p)} disabled={busy}>
              {p}
            </button>
          ))}
        </div>

        {speech.listening ? (
          <p className="interim">
            🎙 กำลังฟัง… {speech.interim || <span style={{ opacity: 0.6 }}>พูดได้เลยครับ</span>}
          </p>
        ) : null}
        {speech.sttError ? (
          <p className="interim" style={{ borderStyle: 'solid' }}>
            ⚠️ {speech.sttError}
          </p>
        ) : null}

        <div className="chat-input-row">
          <button
            type="button"
            className={`btn icon-only ${speech.listening ? 'rec' : ''}`}
            onClick={speech.toggleListening}
            disabled={!speech.sttSupported}
            title={
              speech.sttSupported
                ? speech.listening
                  ? 'หยุดฟัง'
                  : 'พูดเพื่อป้อนข้อความ (STT)'
                : 'เบราว์เซอร์นี้ไม่รองรับการรู้จำเสียง ลองใช้ Chrome หรือ Edge'
            }
          >
            {speech.listening ? '⏺' : '🎙'}
          </button>

          <textarea
            ref={textareaRef}
            value={draft}
            placeholder="พิมพ์ข้อความถึงออตโต้บอท… (Enter เพื่อส่ง, Shift+Enter ขึ้นบรรทัดใหม่)"
            onChange={(e) => {
              setDraft(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = `${Math.min(160, e.target.scrollHeight)}px`;
            }}
            onKeyDown={handleKey}
          />

          <button type="button" className="btn primary" onClick={submit} disabled={busy || !draft.trim()}>
            ส่ง ➤
          </button>
        </div>

        <div className="chat-toolbar">
          <button
            type="button"
            className={`btn sm ${speech.ttsEnabled ? 'active' : ''}`}
            onClick={() => speech.setTtsEnabled(!speech.ttsEnabled)}
            disabled={!speech.ttsSupported}
            title="อ่านคำตอบของออตโต้ออกเสียงอัตโนมัติ"
          >
            {speech.ttsEnabled ? '🔊' : '🔇'} อ่านออกเสียงอัตโนมัติ
          </button>
          <button
            type="button"
            className={`btn sm ${speech.autoSendVoice ? 'active' : ''}`}
            onClick={() => speech.setAutoSendVoice(!speech.autoSendVoice)}
            disabled={!speech.sttSupported}
            title="พูดจบแล้วส่งข้อความทันที ไม่ต้องกดส่ง"
          >
            {speech.autoSendVoice ? '⚡' : '✍️'} พูดจบส่งทันที
          </button>
          {!speech.sttSupported ? (
            <span className="chip warn">ไมโครโฟน: ใช้ได้บน Chrome / Edge</span>
          ) : null}
        </div>
      </div>
    </section>
  );
}
