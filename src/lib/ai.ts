import { getAiConfig, type AiConfig } from './config';
import { FACES, isFace, isMotion, type AiReply, type Face, type MotionName, type MotionPayload } from './types';
import { MOTION_COMMANDS, findMotion } from './motions';

export interface AiTurn {
  role: 'user' | 'assistant';
  content: string;
}

function systemPrompt(cfg: AiConfig): string {
  const persona =
    cfg.persona ||
    'คุณคือ "ออตโต้" หุ่นยนต์ตัวน้อยที่ร่าเริง เป็นมิตร และชอบช่วยเหลือ พูดภาษาไทยแบบเป็นกันเอง ตอบสั้นกระชับ';

  const motionList = MOTION_COMMANDS.map((m) => `${m.id} (${m.labelTh})`).join(', ');

  return `${persona}

คุณกำลังควบคุมหุ่นยนต์ Otto จริง ๆ ผ่าน MQTT ดังนั้น **ต้องตอบกลับเป็น JSON เท่านั้น** ห้ามมีข้อความอื่นนอก JSON และห้ามใส่ \`\`\` ครอบ

โครงสร้าง JSON ที่ต้องตอบ:
{
  "speech": "ข้อความภาษาไทยที่ออตโต้จะพูดออกลำโพง (สั้น เป็นธรรมชาติ ไม่ใส่ emoji)",
  "face": "หนึ่งในนี้: ${FACES.join(' | ')}",
  "motion": "หนึ่งในคำสั่งท่าทางด้านล่าง หรือ null ถ้าไม่ต้องขยับ"
}

คำสั่งท่าทางที่ใช้ได้ (ต้องสะกดตรงตัวเป๊ะ ๆ):
${motionList}

กติกาสำคัญ:
- "motion" ต้องเป็นชื่อคำสั่งจากรายการข้างบนเท่านั้น ห้ามคิดชื่อใหม่ ห้ามส่งมุมข้อต่อ
- ถ้าไม่จำเป็นต้องขยับ ให้ใส่ "motion": null
- "speech" ต้องเป็นภาษาไทยเสมอ (ยกเว้นผู้ใช้ขอภาษาอื่น)
- เลือก "face" ให้เข้ากับอารมณ์ของคำตอบทุกครั้ง

ตัวอย่าง:
{"speech":"สวัสดีครับ ยินดีที่ได้รู้จัก","face":"happy","motion":"wave"}
{"speech":"ตอนนี้เป็นเวลาบ่ายสองโมงครับ","face":"neutral","motion":null}`;
}

/** ดึงก้อน JSON ออกจากข้อความของโมเดล (เผื่อโมเดลใส่ ``` หรือข้อความนำ) */
export function extractJson(text: string): Record<string, unknown> | null {
  if (!text) return null;
  const withoutFence = text.replace(/```(?:json)?/gi, '').trim();
  const candidates = [withoutFence];
  const first = withoutFence.indexOf('{');
  const last = withoutFence.lastIndexOf('}');
  if (first !== -1 && last > first) candidates.push(withoutFence.slice(first, last + 1));
  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* ลองตัวถัดไป */
    }
  }
  return null;
}

/**
 * ตรวจคำสั่งท่าทางจาก AI ให้เหลือเฉพาะชื่อที่หุ่นรู้จักจริง
 * รับได้ทั้ง "wave" และ { "motion": "wave" } / { "name": "wave" }
 */
export function sanitizeMotion(input: unknown): MotionPayload | undefined {
  if (input == null) return undefined;

  if (typeof input === 'string') {
    const id = input.trim().toLowerCase();
    return isMotion(id) ? { motion: id } : undefined;
  }

  if (typeof input !== 'object') return undefined;
  const src = input as Record<string, unknown>;

  const raw = src.motion ?? src.name ?? src.command ?? src.action;
  const id = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!isMotion(id)) return undefined;

  return { motion: id, face: isFace(src.face) ? src.face : undefined };
}

function normalizeReply(parsed: Record<string, unknown> | null, fallbackText: string): AiReply {
  const speechRaw = parsed?.speech ?? parsed?.text ?? parsed?.message ?? fallbackText;
  const speech = String(speechRaw ?? '').trim() || fallbackText.trim() || 'ขอโทษครับ ผมยังไม่เข้าใจ';
  const face: Face = isFace(parsed?.face) ? (parsed!.face as Face) : 'neutral';
  const motion = sanitizeMotion(parsed?.motion);
  if (!motion) return { speech, face };

  // สีหน้าที่ AI เลือกไว้ระดับบนสุดคือสีหน้าที่จะแสดงจริง
  return { speech, face, motion: { motion: motion.motion, face: motion.face ?? face } };
}

/** เรียกผู้ให้บริการ AI ตามที่ตั้งค่าไว้ในไฟล์ config/ai.txt */
export async function askAi(userText: string, history: AiTurn[] = []): Promise<AiReply> {
  const cfg = getAiConfig();
  if (!cfg.configured) return offlineReply(userText);

  const messages = [
    { role: 'system' as const, content: systemPrompt(cfg) },
    ...history.slice(-cfg.historyLimit),
    { role: 'user' as const, content: userText },
  ];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  let res: Response;
  try {
    res = await fetch(cfg.providerUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        temperature: cfg.temperature,
        max_tokens: cfg.maxTokens,
        stream: false,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`ผู้ให้บริการ AI ไม่ตอบภายใน ${Math.round(cfg.timeoutMs / 1000)} วินาที`);
    }
    throw new Error(
      `เชื่อมต่อผู้ให้บริการ AI ไม่ได้ (${cfg.providerUrl}) — ตรวจสอบ PROVIDER_URL ในไฟล์ config/ai.txt`,
    );
  }

  try {
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      throw new Error(`ผู้ให้บริการ AI ตอบกลับ ${res.status}: ${detail}`);
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string }; text?: string }[];
      message?: { content?: string };
      content?: string;
    };
    const content =
      data.choices?.[0]?.message?.content ??
      data.choices?.[0]?.text ??
      data.message?.content ??
      data.content ??
      '';

    const reply = normalizeReply(extractJson(content), content);
    reply.raw = content;
    return reply;
  } finally {
    clearTimeout(timer);
  }
}

/** โหมดออฟไลน์ — ใช้เมื่อยังไม่ได้กรอก PROVIDER_URL / MODEL ในไฟล์ config */
export function offlineReply(userText: string): AiReply {
  const t = userText.toLowerCase();
  const has = (...words: string[]) => words.some((w) => t.includes(w));

  const pick = (id: MotionName, speech: string, face: Face): AiReply => ({
    speech,
    face,
    motion: { motion: id, face },
  });

  if (has('สวัสดี', 'หวัดดี', 'hello', 'hi', 'ดีจ้า')) return pick('wave', 'สวัสดีครับ ผมออตโต้เองครับ!', 'happy');
  if (has('โบกมือ', 'ทักทาย', 'wave')) return pick('wave', 'สวัสดีครับ!', 'happy');
  if (has('เดินหน้า', 'เดิน', 'forward', 'walk')) return pick('walk', 'เดินไปข้างหน้าครับ', 'neutral');
  if (has('ถอย', 'back')) return pick('back', 'ถอยหลังครับ', 'neutral');
  if (has('ซ้าย', 'left')) return pick('left', 'เลี้ยวซ้ายครับ', 'neutral');
  if (has('ขวา', 'right')) return pick('right', 'เลี้ยวขวาครับ', 'neutral');
  if (has('เต้น', 'โยก', 'dance', 'swing')) return pick('swing', 'ดูผมโยกตัวนะครับ!', 'happy');
  if (has('มูนวอล์ก', 'moonwalk')) return pick('moonwalk', 'มูนวอล์กเลยครับ!', 'cool');
  if (has('ย่อ', 'ยืด', 'updown')) return pick('updown', 'ย่อแล้วยืดครับ', 'happy');
  if (has('ก้ม', 'โค้ง', 'ไหว้', 'ขอบคุณ', 'thank', 'bend')) return pick('bend', 'ขอบคุณมากครับ', 'happy');
  if (has('สะบัด', 'สั่นขา', 'shake')) return pick('shake', 'สะบัดขาเล่นครับ', 'happy');
  if (has('ยกมือ', 'handsup')) return pick('handsup', 'ยกมือขึ้นแล้วครับ!', 'happy');
  if (has('เอามือลง', 'ลดมือ', 'handdown')) return pick('handdown', 'เอามือลงแล้วครับ', 'neutral');
  if (has('หยุด', 'stop', 'ยืน', 'home')) return pick('home', 'กลับมายืนท่าปกติแล้วครับ', 'neutral');
  if (has('รัก', 'love')) return { speech: 'ผมก็รักคุณนะครับ', face: 'love', motion: { motion: 'handsup', face: 'love' } };
  if (has('นอน', 'ง่วง', 'sleep')) return { speech: 'ง่วงแล้วครับ ราตรีสวัสดิ์', face: 'sleepy' };
  if (has('ชื่อ', 'คุณคือใคร', 'name')) return { speech: 'ผมชื่อออตโต้ครับ เป็นหุ่นยนต์ตัวน้อยของคุณ', face: 'happy' };

  return {
    speech:
      'ตอนนี้ยังไม่ได้ตั้งค่า AI ครับ (โหมดออฟไลน์) กรุณากรอก PROVIDER_URL และ MODEL ในไฟล์ config/ai.txt แต่ผมยังสั่งท่าทางง่าย ๆ ได้ เช่น "เดินหน้า" "โบกมือ" "มูนวอล์ก"',
    face: 'confused',
  };
}
