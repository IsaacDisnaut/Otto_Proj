'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { stripEmoji } from '@/lib/text';

/* ---------- ประกาศชนิดของ Web Speech API (บางเบราว์เซอร์ยังใช้ prefix webkit) ---------- */
interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence: number;
}
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: { length: number; [index: number]: SpeechRecognitionResultLike };
}
interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: Event & { error?: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/* ---------------------------- อ่านออกเสียง (TTS) ---------------------------- */

export interface TtsOptions {
  lang?: string;
  rate?: number;
  pitch?: number;
  voiceUri?: string;
}

export interface ServerTtsInfo {
  /** true = ให้เรียก /api/tts แทนเสียงในตัวเบราว์เซอร์ */
  useServer: boolean;
  provider: string;
  voice: string;
}

export function useTts(server?: ServerTtsInfo) {
  const [supported, setSupported] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [speaking, setSpeaking] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [voiceUri, setVoiceUri] = useState<string>('');
  const [rate, setRate] = useState(1);
  const [pitch, setPitch] = useState(1.1);
  const [error, setError] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  /** นับรอบการเล่น เพื่อทิ้งเสียงเก่าที่โหลดเสร็จช้ากว่า */
  const runRef = useRef(0);
  const serverRef = useRef(server);
  serverRef.current = server;

  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    setSupported(true);

    const load = () => {
      const list = window.speechSynthesis.getVoices();
      if (!list.length) return;
      setVoices(list);
      setVoiceUri((current) => {
        if (current && list.some((v) => v.voiceURI === current)) return current;
        const thai = list.find((v) => v.lang?.toLowerCase().startsWith('th'));
        return (thai ?? list[0]).voiceURI;
      });
    };
    load();
    window.speechSynthesis.addEventListener('voiceschanged', load);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load);
  }, []);

  const thaiVoiceAvailable = useMemo(
    () => voices.some((v) => v.lang?.toLowerCase().startsWith('th')),
    [voices],
  );

  const releaseAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
      audioRef.current = null;
    }
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    runRef.current += 1;
    releaseAudio();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setSpeaking(false);
  }, [releaseAudio]);

  /** เสียงสำรองของเบราว์เซอร์ ใช้เมื่อยังไม่ได้ตั้งค่า API หรือ API ล้มเหลว */
  const speakWithBrowser = useCallback(
    (text: string, opts: TtsOptions = {}) => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
      window.speechSynthesis.cancel();

      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = opts.lang ?? 'th-TH';
      utter.rate = opts.rate ?? rate;
      utter.pitch = opts.pitch ?? pitch;
      const wanted = opts.voiceUri ?? voiceUri;
      const voice = window.speechSynthesis.getVoices().find((v) => v.voiceURI === wanted);
      if (voice) utter.voice = voice;
      utter.onstart = () => setSpeaking(true);
      utter.onend = () => setSpeaking(false);
      utter.onerror = () => setSpeaking(false);
      window.speechSynthesis.speak(utter);
    },
    [pitch, rate, voiceUri],
  );

  const speak = useCallback(
    (text: string, opts: TtsOptions = {}) => {
      // ตัดอิโมจิก่อนเสมอ ทั้งเส้นทาง API และเสียงสำรองของเบราว์เซอร์
      const clean = stripEmoji(text);
      if (!clean) return;

      cancel();
      const run = runRef.current;
      setError(null);

      if (!serverRef.current?.useServer) {
        speakWithBrowser(clean, opts);
        return;
      }

      // เรียก API เสียงไทยฝั่งเซิร์ฟเวอร์
      setSpeaking(true);
      void (async () => {
        try {
          const res = await fetch('/api/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: clean }),
          });

          if (run !== runRef.current) return; // มีคำสั่งพูดใหม่มาแทนแล้ว

          if (!res.ok) {
            const detail = (await res.json().catch(() => null)) as { error?: string } | null;
            throw new Error(detail?.error ?? `เซิร์ฟเวอร์เสียงตอบกลับ ${res.status}`);
          }

          const blob = await res.blob();
          if (run !== runRef.current) return;

          const url = URL.createObjectURL(blob);
          objectUrlRef.current = url;
          const audio = new Audio(url);
          audioRef.current = audio;
          audio.onended = () => {
            if (run === runRef.current) setSpeaking(false);
          };
          audio.onerror = () => {
            if (run === runRef.current) setSpeaking(false);
          };
          await audio.play();
        } catch (err) {
          if (run !== runRef.current) return;
          setSpeaking(false);
          const message = err instanceof Error ? err.message : 'สร้างเสียงไม่สำเร็จ';
          // เบราว์เซอร์บล็อกการเล่นอัตโนมัติ ไม่ใช่ความผิดของ API จึงไม่ต้องถอยไปใช้เสียงเบราว์เซอร์
          if (err instanceof Error && err.name === 'NotAllowedError') {
            setError('เบราว์เซอร์บล็อกการเล่นเสียงอัตโนมัติ กดที่หน้าเว็บหนึ่งครั้งก่อน');
            return;
          }
          setError(`${message} — ใช้เสียงของเบราว์เซอร์แทนชั่วคราว`);
          speakWithBrowser(clean, opts);
        }
      })();
    },
    [cancel, speakWithBrowser],
  );

  useEffect(() => releaseAudio, [releaseAudio]);

  return {
    supported: supported || Boolean(server?.useServer),
    voices,
    voiceUri,
    setVoiceUri,
    rate,
    setRate,
    pitch,
    setPitch,
    speaking,
    speak,
    cancel,
    enabled,
    setEnabled,
    thaiVoiceAvailable,
    error,
    usingServer: Boolean(server?.useServer),
    provider: server?.provider ?? 'browser',
  };
}

/* ---------------------------- ฟังเสียงพูด (STT) ---------------------------- */

export interface UseSttArgs {
  lang?: string;
  /** เรียกเมื่อได้ข้อความสมบูรณ์ (ผู้ใช้พูดจบ) */
  onFinal?: (text: string) => void;
}

export function useStt({ lang = 'th-TH', onFinal }: UseSttArgs = {}) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const finalRef = useRef(onFinal);
  finalRef.current = onFinal;

  useEffect(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;
    setSupported(true);

    const recognition = new Ctor();
    recognition.lang = lang;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setListening(true);
      setError(null);
    };
    recognition.onresult = (event) => {
      let finalText = '';
      let interimText = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const transcript = result[0]?.transcript ?? '';
        if (result.isFinal) finalText += transcript;
        else interimText += transcript;
      }
      setInterim(interimText);
      if (finalText.trim()) {
        setInterim('');
        finalRef.current?.(finalText.trim());
      }
    };
    recognition.onerror = (event) => {
      const code = (event as { error?: string }).error ?? 'unknown';
      const messages: Record<string, string> = {
        'not-allowed': 'เบราว์เซอร์ไม่อนุญาตให้ใช้ไมโครโฟน',
        'service-not-allowed': 'เบราว์เซอร์ไม่อนุญาตให้ใช้ไมโครโฟน',
        'no-speech': 'ไม่ได้ยินเสียงพูด ลองอีกครั้ง',
        'audio-capture': 'ไม่พบไมโครโฟน',
        network: 'เชื่อมต่อบริการรู้จำเสียงไม่ได้',
        aborted: '',
      };
      const message = messages[code] ?? `เกิดข้อผิดพลาด: ${code}`;
      if (message) setError(message);
      setListening(false);
    };
    recognition.onend = () => {
      setListening(false);
      setInterim('');
    };

    recognitionRef.current = recognition;
    return () => {
      recognition.onresult = null;
      recognition.onend = null;
      recognition.onerror = null;
      try {
        recognition.abort();
      } catch {
        /* หยุดไปแล้ว */
      }
      recognitionRef.current = null;
    };
  }, [lang]);

  const start = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    try {
      recognition.start();
    } catch {
      /* กำลังทำงานอยู่แล้ว */
    }
  }, []);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  const toggle = useCallback(() => {
    if (listening) stop();
    else start();
  }, [listening, start, stop]);

  return { supported, listening, interim, error, start, stop, toggle };
}
