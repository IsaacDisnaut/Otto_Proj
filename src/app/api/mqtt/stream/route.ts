import { ensureConnected, recentEvents, status, subscribeEvents } from '@/lib/mqtt-bridge';
import type { BridgeEvent } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * ช่องทาง Server-Sent Events: เซิร์ฟเวอร์ต่อ MQTT ให้ แล้วส่งต่อทุกข้อความมาที่เบราว์เซอร์
 * (เบราว์เซอร์จึงไม่ต้องต่อ WebSocket กับ Mosquitto เอง)
 */
export async function GET(request: Request) {
  ensureConnected();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (event: BridgeEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
        }
      };

      // แจ้งสถานะปัจจุบัน + ข้อความย้อนหลังที่ค้างอยู่ใน buffer
      const s = status();
      send({ type: 'status', connected: s.connected, brokerUrl: s.brokerUrl, error: s.error ?? undefined, ts: Date.now() });
      for (const event of recentEvents().slice(-25)) send(event);

      const unsubscribe = subscribeEvents(send);
      const keepAlive = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(': ping\n\n'));
        } catch {
          closed = true;
        }
      }, 20000);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(keepAlive);
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* ปิดไปแล้ว */
        }
      };

      request.signal.addEventListener('abort', cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
