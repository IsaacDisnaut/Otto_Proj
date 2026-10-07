'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ChatBox from '@/components/ChatBox';
import ControlPanel from '@/components/ControlPanel';
import MqttLog, { type LogEntry } from '@/components/MqttLog';
import RobotFace from '@/components/RobotFace';
import { motionLabelTh } from '@/lib/motions';
import { useMqttBridge } from '@/hooks/useMqttBridge';
import { useStt, useTts } from '@/hooks/useSpeech';
import type { PublicConfig } from '@/lib/config';
import { isFace, type BridgeEvent, type ChatMessage, type Face, type MotionPayload } from '@/lib/types';

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const WELCOME: ChatMessage = {
  id: 'welcome',
  role: 'assistant',
  text:
    'สวัสดีครับ ผมออตโต้! 🤖\nคุยกับผมได้ทั้งพิมพ์และพูด (กดปุ่มไมโครโฟน) ผมจะตอบกลับพร้อมขยับตัวและเปลี่ยนสีหน้าให้ดูด้วยครับ',
  ts: Date.now(),
  face: 'happy',
};

/** ดึงข้อความจาก payload ที่หุ่นส่งมา (รองรับทั้ง JSON และข้อความเปล่า) */
function textFromPayload(payload: string, json: unknown): string {
  if (json && typeof json === 'object') {
    const o = json as Record<string, unknown>;
    for (const key of ['text', 'message', 'msg', 'speech', 'content', 'value']) {
      if (typeof o[key] === 'string' && (o[key] as string).trim()) return (o[key] as string).trim();
    }
    return payload.trim();
  }
  return payload.trim();
}

function faceFromPayload(payload: string, json: unknown): Face | null {
  if (json && typeof json === 'object') {
    const o = json as Record<string, unknown>;
    for (const key of ['face', 'emotion', 'expression', 'mood']) {
      if (isFace(o[key])) return o[key] as Face;
    }
    return null;
  }
  const trimmed = payload.trim().toLowerCase();
  return isFace(trimmed) ? trimmed : null;
}

export default function Page() {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME]);
  const [busy, setBusy] = useState(false);
  const [face, setFace] = useState<Face>('neutral');
  const [faceSource, setFaceSource] = useState<'ai' | 'mqtt' | 'manual'>('manual');
  const [log, setLog] = useState<LogEntry[]>([]);
  const [autoReplyToRobot, setAutoReplyToRobot] = useState(true);
  const [autoSendVoice, setAutoSendVoice] = useState(true);
  const [voiceDraft, setVoiceDraft] = useState<{ text: string; nonce: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const serverTts = useMemo(
    () => ({
      useServer: config?.tts.useServer ?? false,
      provider: config?.tts.provider ?? 'browser',
      voice: config?.tts.voice ?? '',
    }),
    [config],
  );
  const tts = useTts(serverTts);
  const ttsRef = useRef(tts);
  ttsRef.current = tts;

  const pushMessage = useCallback((msg: Omit<ChatMessage, 'id' | 'ts'> & Partial<Pick<ChatMessage, 'id' | 'ts'>>) => {
    const full: ChatMessage = { id: msg.id ?? uid(), ts: msg.ts ?? Date.now(), ...msg } as ChatMessage;
    setMessages((prev) => [...prev, full]);
    return full;
  }, []);

  const pushLog = useCallback((entry: Omit<LogEntry, 'id'>) => {
    setLog((prev) => [{ id: uid(), ...entry }, ...prev].slice(0, 120));
  }, []);

  /* ------------------------------ โหลดค่าตั้งต้น ------------------------------ */

  const loadConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/config', { cache: 'no-store' });
      setConfig((await res.json()) as PublicConfig);
    } catch {
      /* ไม่เป็นไร ลองใหม่ได้ */
    }
  }, []);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  /* --------------------------- ส่งข้อความไปยัง AI --------------------------- */

  const busyRef = useRef(false);
  busyRef.current = busy;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const sendToAi = useCallback(
    async (text: string, from: 'user' | 'robot' = 'user') => {
      const clean = text.trim();
      if (!clean || busyRef.current) return;

      if (from === 'user') pushMessage({ role: 'user', text: clean });
      setBusy(true);
      busyRef.current = true;

      const history = messagesRef.current
        .filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'robot')
        .slice(-12)
        .map((m) => ({ role: (m.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant', content: m.text }));

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: clean, history }),
        });
        const data = (await res.json()) as {
          ok: boolean;
          error?: string;
          reply?: { speech: string; face: Face; motion: MotionPayload | null };
          offline?: boolean;
          aiError?: string | null;
          published?: { topic: string; ok: boolean; error?: string }[];
        };

        if (!data.ok || !data.reply) {
          pushMessage({ role: 'system', text: `เกิดข้อผิดพลาด: ${data.error ?? 'ไม่ทราบสาเหตุ'}`, error: true });
          return;
        }

        pushMessage({
          role: 'assistant',
          text: data.reply.speech,
          face: data.reply.face,
          motion: data.reply.motion ?? undefined,
          offline: data.offline,
        });
        setFace(data.reply.face);
        setFaceSource('ai');
        if (ttsRef.current.enabled) ttsRef.current.speak(data.reply.speech);

        if (data.aiError) {
          pushMessage({ role: 'system', text: `เรียก AI ไม่สำเร็จ จึงใช้โหมดออฟไลน์แทน — ${data.aiError}`, error: true });
        }
        const failed = data.published?.filter((p) => !p.ok) ?? [];
        if (failed.length) {
          pushMessage({
            role: 'system',
            text: `ส่งไปยังหุ่นยนต์ไม่สำเร็จ (${failed.map((f) => f.topic).join(', ')}) — ตรวจสอบการเชื่อมต่อ MQTT`,
            error: true,
          });
        }
      } catch (err) {
        pushMessage({
          role: 'system',
          text: `ติดต่อเซิร์ฟเวอร์ไม่ได้: ${err instanceof Error ? err.message : 'ไม่ทราบสาเหตุ'}`,
          error: true,
        });
      } finally {
        setBusy(false);
        busyRef.current = false;
      }
    },
    [pushMessage],
  );

  const sendToAiRef = useRef(sendToAi);
  sendToAiRef.current = sendToAi;
  const autoReplyRef = useRef(autoReplyToRobot);
  autoReplyRef.current = autoReplyToRobot;

  /* ------------------------ รับข้อความจาก MQTT (SSE) ------------------------ */

  const handleBridgeEvent = useCallback(
    (event: BridgeEvent) => {
      if (event.type !== 'message') return;
      const outgoing = event.kind === 'motion' || event.kind === 'speech';
      pushLog({ topic: event.topic, payload: event.payload, kind: event.kind, ts: event.ts, outgoing });

      switch (event.kind) {
        /* 2) ข้อความจากออตโต้บอท → เติมลงกล่องแชท */
        case 'chat': {
          const text = textFromPayload(event.payload, event.json);
          if (!text) return;
          const f = faceFromPayload(event.payload, event.json);
          pushMessage({ role: 'robot', text, fromMqtt: true, face: f ?? undefined });
          if (f) {
            setFace(f);
            setFaceSource('mqtt');
          }
          if (autoReplyRef.current) void sendToAiRef.current(text, 'robot');
          return;
        }

        /* 6) สีหน้าปัจจุบันของหุ่น */
        case 'face': {
          const f = faceFromPayload(event.payload, event.json);
          if (f) {
            setFace(f);
            setFaceSource('mqtt');
          }
          return;
        }

        case 'status': {
          const o = (event.json ?? {}) as Record<string, unknown>;
          const f = faceFromPayload(event.payload, event.json);
          if (f) {
            setFace(f);
            setFaceSource('mqtt');
          }
          const bits = Object.entries(o)
            .filter(([, v]) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
            .map(([k, v]) => `${k}: ${v}`);
          if (bits.length) setToast(`สถานะหุ่นยนต์ — ${bits.join(' · ')}`);
          return;
        }

        default:
          return;
      }
    },
    [pushLog, pushMessage],
  );

  const bridge = useMqttBridge(handleBridgeEvent);

  /* --------------------------------- เสียงพูด --------------------------------- */

  const stt = useStt({
    lang: 'th-TH',
    onFinal: (text) => {
      if (autoSendVoice) void sendToAiRef.current(text, 'user');
      else setVoiceDraft({ text, nonce: Date.now() });
    },
  });

  /* ------------------------------- ส่งออก MQTT ------------------------------- */

  const publish = useCallback(
    async (body: Record<string, unknown>, successNote?: string) => {
      try {
        const res = await fetch('/api/mqtt/publish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = (await res.json()) as { ok: boolean; error?: string };
        if (!data.ok) {
          pushMessage({ role: 'system', text: `ส่ง MQTT ไม่สำเร็จ: ${data.error ?? 'ไม่ทราบสาเหตุ'}`, error: true });
        } else if (successNote) {
          setToast(successNote);
        }
      } catch (err) {
        pushMessage({
          role: 'system',
          text: `ส่ง MQTT ไม่สำเร็จ: ${err instanceof Error ? err.message : 'ไม่ทราบสาเหตุ'}`,
          error: true,
        });
      }
    },
    [pushMessage],
  );

  const handleMotion = useCallback(
    (motion: MotionPayload, nextFace?: Face) => {
      if (nextFace) {
        setFace(nextFace);
        setFaceSource('manual');
      }
      void publish({ target: 'motion', payload: motion, face: nextFace }, `ส่งท่า "${motionLabelTh(motion.motion)}" แล้ว`);
    },
    [publish],
  );

  const handleSpeak = useCallback(
    (text: string) => {
      void publish({ target: 'speech', text, face }, 'ส่งข้อความให้หุ่นพูดแล้ว');
      if (tts.enabled) tts.speak(text);
    },
    [face, publish, tts],
  );

  const handleFacePick = useCallback(
    (next: Face) => {
      setFace(next);
      setFaceSource('manual');
      void publish({ target: 'motion', payload: null, face: next });
    },
    [publish],
  );

  const handleRawPublish = useCallback(
    (topic: string, payload: string) => {
      if (!topic) {
        pushMessage({ role: 'system', text: 'กรุณาระบุหัวข้อ (topic) ก่อนส่ง', error: true });
        return;
      }
      void publish({ topic, payload }, `ส่งไปที่ ${topic} แล้ว`);
    },
    [publish, pushMessage],
  );

  const handleReloadConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/config/reload', { method: 'POST' });
      const data = (await res.json()) as { ok: boolean; config: PublicConfig };
      if (data.ok) {
        setConfig(data.config);
        setToast('โหลดค่าจากไฟล์ใหม่แล้ว และกำลังเชื่อมต่อ MQTT อีกครั้ง');
        setTimeout(() => void bridge.refreshStatus(), 1500);
      }
    } catch {
      pushMessage({ role: 'system', text: 'โหลดค่าใหม่ไม่สำเร็จ', error: true });
    }
  }, [bridge, pushMessage]);

  // แจ้งเตือนเมื่อระบบเสียงมีปัญหา (เช่น API key ผิด หรือเบราว์เซอร์บล็อกเสียง)
  useEffect(() => {
    if (tts.error) setToast(tts.error);
  }, [tts.error]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3800);
    return () => clearTimeout(t);
  }, [toast]);

  const speechProps = useMemo(
    () => ({
      ttsSupported: tts.supported,
      ttsEnabled: tts.enabled,
      setTtsEnabled: tts.setEnabled,
      speaking: tts.speaking,
      speak: (text: string) => tts.speak(text),
      stopSpeaking: tts.cancel,
      sttSupported: stt.supported,
      listening: stt.listening,
      interim: stt.interim,
      sttError: stt.error,
      toggleListening: stt.toggle,
      autoSendVoice,
      setAutoSendVoice,
      voiceDraft,
    }),
    [autoSendVoice, stt, tts, voiceDraft],
  );

  const aiReady = config?.ai.configured ?? false;

  return (
    <main className="app">
      <div className="topbar">
        <div className="brand">
          <div className="brand-logo">🤖</div>
          <div>
            <h1>ออตโต้บอท คอนโทรล</h1>
            <p>ควบคุมหุ่นยนต์ Otto ด้วยเสียง ข้อความ และปัญญาประดิษฐ์ ผ่าน MQTT</p>
            <div style={{ display: 'flex', gap: 7, marginTop: 8, flexWrap: 'wrap' }}>
              <span className={`chip ${bridge.connected ? 'ok' : 'bad'}`}>
                <i className={`dot ${bridge.connected ? 'pulse' : ''}`} />
                MQTT {bridge.connected ? 'เชื่อมต่อแล้ว' : 'ยังไม่เชื่อมต่อ'}
              </span>
              <span className="chip">{bridge.brokerUrl || config?.mqtt.brokerUrl || '—'}</span>
              <span className={`chip ${aiReady ? 'ok' : 'warn'}`}>
                <i className="dot" />
                AI {aiReady ? config?.ai.model : 'โหมดออฟไลน์'}
              </span>
              <span className={`chip ${tts.usingServer ? 'ok' : 'warn'}`} title="ระบบเสียงพูดภาษาไทย">
                <i className="dot" />
                เสียง {tts.usingServer ? tts.provider : 'เบราว์เซอร์'}
              </span>
              <button
                type="button"
                className={`chip ${autoReplyToRobot ? 'ok' : ''}`}
                onClick={() => setAutoReplyToRobot((v) => !v)}
                title="เมื่อหุ่นส่งข้อความเข้ามา ให้ AI ตอบกลับอัตโนมัติ"
              >
                {autoReplyToRobot ? '⚡' : '⏸'} ตอบหุ่นอัตโนมัติ
              </button>
            </div>
          </div>
        </div>

        {/* 6) สีหน้าปัจจุบันของหุ่น — มุมขวาบน */}
        <RobotFace face={face} source={faceSource} connected={bridge.connected} onPick={handleFacePick} />
      </div>

      {!bridge.connected && bridge.error ? (
        <div className="banner">
          <span>⚠️</span>
          <div>
            เชื่อมต่อ MQTT ไม่ได้: <code>{bridge.error}</code>
            <br />
            ตรวจสอบว่า Mosquitto ทำงานอยู่ และค่า <code>BROKER_URL</code> ในไฟล์ <code>config/mqtt.txt</code> ถูกต้อง
          </div>
        </div>
      ) : null}

      {!aiReady ? (
        <div className="banner">
          <span>🧠</span>
          <div>
            ยังไม่ได้ตั้งค่า Generative AI — เปิดไฟล์ <code>config/ai.txt</code> แล้วกรอก{' '}
            <code>PROVIDER_URL</code> กับ <code>MODEL</code> จากนั้นกด &ldquo;โหลดค่าใหม่&rdquo; ในแท็บตั้งค่า
            <br />
            ระหว่างนี้เว็บยังใช้งานได้ในโหมดออฟไลน์ (สั่งท่าทางด้วยคำสั่งง่าย ๆ เช่น &ldquo;เต้น&rdquo; &ldquo;เดินหน้า&rdquo;)
          </div>
        </div>
      ) : null}

      <div className="layout">
        {/* 1) กล่องแชทที่พูดได้และฟังได้ */}
        <ChatBox
          messages={messages}
          busy={busy}
          onSend={(text) => void sendToAi(text, 'user')}
          onClear={() => setMessages([])}
          speech={speechProps}
        />

        <div>
          <ControlPanel
            config={config}
            busy={busy}
            onMotion={handleMotion}
            onFaceOnly={handleFacePick}
            onSpeak={handleSpeak}
            onRawPublish={handleRawPublish}
            onReloadConfig={() => void handleReloadConfig()}
          />
          <MqttLog entries={log} onClear={() => setLog([])} />
        </div>
      </div>

      {toast ? (
        <div
          className="chip ok"
          style={{
            position: 'fixed',
            bottom: 20,
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '10px 18px',
            fontSize: 13,
            zIndex: 60,
            boxShadow: 'var(--shadow)',
          }}
        >
          {toast}
        </div>
      ) : null}
    </main>
  );
}
