'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { BridgeEvent } from '@/lib/types';

export interface BridgeState {
  connected: boolean;
  brokerUrl: string;
  error?: string;
  /** สถานะของช่อง SSE ระหว่างเบราว์เซอร์กับเว็บเซิร์ฟเวอร์ */
  streamOnline: boolean;
}

/**
 * ต่อช่อง SSE ไปที่ /api/mqtt/stream แล้วส่งทุกข้อความ MQTT กลับมาทาง callback
 */
export function useMqttBridge(onEvent: (event: BridgeEvent) => void) {
  const [state, setState] = useState<BridgeState>({
    connected: false,
    brokerUrl: '',
    streamOnline: false,
  });
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;
  const seenRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const connect = () => {
      if (stopped) return;
      source = new EventSource('/api/mqtt/stream');

      source.onopen = () => setState((s) => ({ ...s, streamOnline: true }));

      source.onmessage = (event) => {
        let parsed: BridgeEvent;
        try {
          parsed = JSON.parse(event.data) as BridgeEvent;
        } catch {
          return;
        }
        if (parsed.type === 'status') {
          setState((s) => ({
            ...s,
            connected: parsed.connected,
            brokerUrl: parsed.brokerUrl,
            error: parsed.error,
            streamOnline: true,
          }));
        }
        // กัน event ซ้ำตอนเชื่อมต่อใหม่ (เซิร์ฟเวอร์ส่ง buffer ย้อนหลังให้)
        if (parsed.type === 'message') {
          const key = `${parsed.ts}|${parsed.topic}|${parsed.payload}`;
          if (seenRef.current.has(key)) return;
          seenRef.current.add(key);
          if (seenRef.current.size > 300) {
            seenRef.current = new Set(Array.from(seenRef.current).slice(-150));
          }
        }
        handlerRef.current(parsed);
      };

      source.onerror = () => {
        setState((s) => ({ ...s, streamOnline: false }));
        source?.close();
        source = null;
        if (!stopped) retry = setTimeout(connect, 3000);
      };
    };

    connect();
    return () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      source?.close();
    };
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/mqtt/status', { cache: 'no-store' });
      const data = (await res.json()) as { connected: boolean; brokerUrl: string; error?: string | null };
      setState((s) => ({ ...s, connected: data.connected, brokerUrl: data.brokerUrl, error: data.error ?? undefined }));
    } catch {
      /* เดี๋ยว SSE จะอัปเดตให้เอง */
    }
  }, []);

  return { ...state, refreshStatus };
}
