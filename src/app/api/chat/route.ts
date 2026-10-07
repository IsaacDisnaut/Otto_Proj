import { NextResponse } from 'next/server';
import { askAi, offlineReply, type AiTurn } from '@/lib/ai';
import { getAiConfig, getMqttConfig } from '@/lib/config';
import { stripEmoji } from '@/lib/text';
import { publish } from '@/lib/mqtt-bridge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Body {
  text?: string;
  history?: AiTurn[];
  /** ส่งท่าทาง/คำพูดไปยังหุ่นผ่าน MQTT หรือไม่ (ค่าเริ่มต้น: ส่ง) */
  sendToRobot?: boolean;
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: 'รูปแบบ JSON ไม่ถูกต้อง' }, { status: 400 });
  }

  const text = (body.text ?? '').trim();
  if (!text) return NextResponse.json({ ok: false, error: 'กรุณาพิมพ์ข้อความ' }, { status: 400 });

  const aiCfg = getAiConfig();
  const history = Array.isArray(body.history)
    ? body.history
        .filter((t) => t && (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string')
        .map((t) => ({ role: t.role, content: t.content.slice(0, 2000) }))
    : [];

  let reply;
  let aiError: string | null = null;
  try {
    reply = await askAi(text, history);
  } catch (err) {
    aiError = err instanceof Error ? err.message : 'เรียก AI ไม่สำเร็จ';
    reply = offlineReply(text);
  }

  // ส่งคำพูดและท่าทางไปให้ออตโต้บอทผ่าน MQTT (คนละ topic ตามที่ตั้งค่าไว้)
  const published: { topic: string; ok: boolean; error?: string }[] = [];
  if (body.sendToRobot !== false) {
    const topics = getMqttConfig().topics;
    const jobs: { topic: string; payload: object }[] = [
      // ส่งข้อความที่ตัดอิโมจิแล้วให้หุ่น เพราะหุ่นจะเอาไปอ่านออกเสียงต่อ
      {
        topic: topics.speech,
        payload: { text: stripEmoji(reply.speech), face: reply.face, lang: 'th-TH', ts: Date.now() },
      },
    ];
    if (reply.motion) {
      jobs.push({
        topic: topics.motion,
        payload: { motion: reply.motion.motion, face: reply.motion.face ?? reply.face, ts: Date.now() },
      });
    }
    for (const job of jobs) {
      try {
        await publish(job.topic, job.payload);
        published.push({ topic: job.topic, ok: true });
      } catch (err) {
        published.push({
          topic: job.topic,
          ok: false,
          error: err instanceof Error ? err.message : 'ส่งไม่สำเร็จ',
        });
      }
    }
  }

  return NextResponse.json({
    ok: true,
    reply: { speech: reply.speech, face: reply.face, motion: reply.motion ?? null },
    offline: !aiCfg.configured || Boolean(aiError),
    aiError,
    published,
  });
}
