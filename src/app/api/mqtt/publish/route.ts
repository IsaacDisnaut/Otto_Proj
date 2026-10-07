import { NextResponse } from 'next/server';
import { getMqttConfig } from '@/lib/config';
import { publish } from '@/lib/mqtt-bridge';
import { sanitizeMotion } from '@/lib/ai';
import { stripEmoji } from '@/lib/text';
import { isFace } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Body = {
  /** ทางลัด: motion | speech | control  (ถ้าไม่ระบุต้องส่ง topic มาเอง) */
  target?: 'motion' | 'speech' | 'control';
  topic?: string;
  payload?: unknown;
  text?: string;
  face?: unknown;
  qos?: 0 | 1 | 2;
  retain?: boolean;
};

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: 'รูปแบบ JSON ไม่ถูกต้อง' }, { status: 400 });
  }

  const cfg = getMqttConfig();
  let topic = body.topic?.trim() || '';
  let payload: string | object;

  switch (body.target) {
    case 'motion': {
      topic = topic || cfg.topics.motion;
      const motion = sanitizeMotion(body.payload);
      const face = isFace(body.face) ? body.face : undefined;
      // อนุญาตให้ส่งเฉพาะ "สีหน้า" ได้ โดยไม่ต้องมีท่าทาง (ตอนผู้ใช้กดเลือกหน้าเอง)
      if (!motion && !face) {
        return NextResponse.json({ ok: false, error: 'คำสั่งท่าทางไม่ถูกต้อง' }, { status: 400 });
      }
      payload = {
        ...(motion ? { motion: motion.motion } : {}),
        face: face ?? motion?.face,
        ts: Date.now(),
      };
      break;
    }
    case 'speech': {
      topic = topic || cfg.topics.speech;
      const text = stripEmoji((body.text ?? '').toString());
      if (!text) return NextResponse.json({ ok: false, error: 'ไม่มีข้อความที่จะให้พูด' }, { status: 400 });
      payload = { text, face: isFace(body.face) ? body.face : undefined, lang: 'th-TH', ts: Date.now() };
      break;
    }
    case 'control': {
      topic = topic || cfg.topics.controlOut;
      payload = (body.payload ?? {}) as object;
      break;
    }
    default: {
      if (!topic) return NextResponse.json({ ok: false, error: 'ต้องระบุ topic' }, { status: 400 });
      payload =
        typeof body.payload === 'string'
          ? body.payload
          : ((body.payload ?? body.text ?? '') as string | object);
    }
  }

  try {
    await publish(topic, payload, { qos: body.qos, retain: body.retain });
    return NextResponse.json({ ok: true, topic, payload });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'ส่งข้อความไม่สำเร็จ' },
      { status: 502 },
    );
  }
}
