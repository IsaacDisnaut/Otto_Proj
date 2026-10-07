import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getTtsConfig, type TtsConfig } from './config';
import { stripEmoji } from './text';

export interface SynthResult {
  audio: ArrayBuffer;
  contentType: string;
}

/** ขนาดข้อความสูงสุดที่ยอมส่งให้ผู้ให้บริการ (กันเผลอส่งข้อความยาวผิดปกติ) */
const MAX_CHARS = 2000;

function fail(message: string): never {
  throw new Error(message);
}

async function readError(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return '';
  }
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const buf = Buffer.from(b64, 'base64');
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

/* ------------------------------ Google Cloud ------------------------------ */

async function google(text: string, cfg: TtsConfig, signal: AbortSignal): Promise<SynthResult> {
  // PROVIDER_URL ใส่ได้ถ้าต้องผ่าน proxy หรือ gateway ของตัวเอง
  const base = cfg.providerUrl || 'https://texttospeech.googleapis.com/v1/text:synthesize';
  const url = `${base}${base.includes('?') ? '&' : '?'}key=${encodeURIComponent(cfg.apiKey)}`;
  const voice = cfg.voice || 'th-TH-Neural2-C';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: { text },
      voice: { languageCode: cfg.lang || 'th-TH', name: voice },
      audioConfig: { audioEncoding: 'MP3', speakingRate: cfg.speed, pitch: cfg.pitch },
    }),
    signal,
  });
  if (!res.ok) fail(`Google TTS ตอบกลับ ${res.status}: ${await readError(res)}`);

  const data = (await res.json()) as { audioContent?: string };
  if (!data.audioContent) fail('Google TTS ไม่ได้ส่งไฟล์เสียงกลับมา');
  return { audio: base64ToArrayBuffer(data.audioContent), contentType: 'audio/mpeg' };
}

/* --------------------------------- Azure --------------------------------- */

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function azure(text: string, cfg: TtsConfig, signal: AbortSignal): Promise<SynthResult> {
  const lang = cfg.lang || 'th-TH';
  const voice = cfg.voice || 'th-TH-PremwadeeNeural';
  // Azure รับความเร็วเป็นเปอร์เซ็นต์เทียบกับปกติ เช่น 1.2 -> "+20%"
  const ratePct = Math.round((cfg.speed - 1) * 100);
  const rate = `${ratePct >= 0 ? '+' : ''}${ratePct}%`;

  const ssml =
    `<speak version='1.0' xml:lang='${lang}'>` +
    `<voice xml:lang='${lang}' name='${voice}'>` +
    `<prosody rate='${rate}'>${escapeXml(text)}</prosody>` +
    `</voice></speak>`;

  const url = cfg.providerUrl || `https://${cfg.region}.tts.speech.microsoft.com/cognitiveservices/v1`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': cfg.apiKey,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
      'User-Agent': 'ottobot-web',
    },
    body: ssml,
    signal,
  });
  if (!res.ok) fail(`Azure TTS ตอบกลับ ${res.status}: ${await readError(res)}`);
  return { audio: await res.arrayBuffer(), contentType: 'audio/mpeg' };
}

/* --------------------------------- OpenAI -------------------------------- */

async function openai(text: string, cfg: TtsConfig, signal: AbortSignal): Promise<SynthResult> {
  const url = cfg.providerUrl || 'https://api.openai.com/v1/audio/speech';
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model || 'gpt-4o-mini-tts',
      voice: cfg.voice || 'nova',
      input: text,
      response_format: 'mp3',
      speed: cfg.speed,
    }),
    signal,
  });
  if (!res.ok) fail(`OpenAI TTS ตอบกลับ ${res.status}: ${await readError(res)}`);
  return { audio: await res.arrayBuffer(), contentType: 'audio/mpeg' };
}

/* ---------------------------- Edge (ไม่ต้องใช้ key) ---------------------------- */

/** แปลงตัวคูณความเร็ว (1.2) เป็นรูปแบบเปอร์เซ็นต์ที่ Edge ต้องการ ('+20%') */
function toPercent(multiplier: number): string {
  const pct = Math.round((multiplier - 1) * 100);
  return `${pct >= 0 ? '+' : ''}${pct}%`;
}

/** โฟลเดอร์เก็บไฟล์เสียงชั่วคราวของ edge */
const EDGE_TMP_DIR = path.join(os.tmpdir(), 'ottobot-tts');
const STALE_MS = 5 * 60 * 1000;

/**
 * เก็บกวาดไฟล์ที่ค้างเกิน 5 นาที
 * จำเป็นเพราะเวลาสังเคราะห์ไม่สำเร็จ ไลบรารีจะทิ้งไฟล์เปล่าไว้หลังจากที่เราลบไปแล้ว
 */
async function sweepStaleFiles(): Promise<void> {
  try {
    const now = Date.now();
    for (const name of await fs.readdir(EDGE_TMP_DIR)) {
      const target = path.join(EDGE_TMP_DIR, name);
      const stat = await fs.stat(target).catch(() => null);
      if (stat && now - stat.mtimeMs > STALE_MS) await fs.unlink(target).catch(() => {});
    }
  } catch {
    /* ยังไม่มีโฟลเดอร์ หรืออ่านไม่ได้ ก็ข้ามไป */
  }
}

async function edge(text: string, cfg: TtsConfig): Promise<SynthResult> {
  // โหลดตอนใช้งานจริง เพื่อไม่ให้ไปถ่วงตอนเริ่มเซิร์ฟเวอร์
  const { EdgeTTS } = await import('node-edge-tts');

  await fs.mkdir(EDGE_TMP_DIR, { recursive: true });
  void sweepStaleFiles();

  const file = path.join(
    EDGE_TMP_DIR,
    `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp3`,
  );

  const tts = new EdgeTTS({
    voice: cfg.voice || 'th-TH-PremwadeeNeural',
    lang: cfg.lang || 'th-TH',
    outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
    rate: toPercent(cfg.speed),
    pitch: `${cfg.pitch >= 0 ? '+' : ''}${Math.round(cfg.pitch)}Hz`,
    timeout: cfg.timeoutMs,
  });

  try {
    // ไลบรารี reject ด้วยข้อความธรรมดา ไม่ใช่ Error จึงต้องแปลงเองให้ข้อความไม่หาย
    await tts.ttsPromise(text, file).catch((err: unknown) => {
      const detail = err instanceof Error ? err.message : String(err);
      if (/timed out/i.test(detail)) {
        fail(
          `บริการเสียงของ Edge ไม่ตอบภายใน ${Math.round(cfg.timeoutMs / 1000)} วินาที — ` +
            `ตรวจว่าชื่อเสียงใน VOICE ถูกต้อง (เช่น th-TH-PremwadeeNeural) และเครื่องต่ออินเทอร์เน็ตอยู่`,
        );
      }
      fail(`บริการเสียงของ Edge ขัดข้อง: ${detail}`);
    });

    const buf = await fs.readFile(file);
    if (!buf.byteLength) fail('บริการเสียงของ Edge ส่งไฟล์เสียงเปล่ากลับมา — ตรวจชื่อเสียงใน VOICE');
    return {
      audio: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
      contentType: 'audio/mpeg',
    };
  } finally {
    await fs.unlink(file).catch(() => {
      /* ไฟล์ชั่วคราวลบไม่ได้ก็ไม่เป็นไร เดี๋ยว sweepStaleFiles เก็บให้ */
    });
  }
}

/* --------------------------------- Custom -------------------------------- */

async function custom(text: string, cfg: TtsConfig, signal: AbortSignal): Promise<SynthResult> {
  if (!cfg.providerUrl) fail('ยังไม่ได้ใส่ PROVIDER_URL ในไฟล์ config/tts.txt');

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) {
    headers[cfg.authHeader || 'Authorization'] = cfg.authPrefix
      ? `${cfg.authPrefix} ${cfg.apiKey}`
      : cfg.apiKey;
  }

  const res = await fetch(cfg.providerUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ text, voice: cfg.voice, lang: cfg.lang, speed: cfg.speed }),
    signal,
  });
  if (!res.ok) fail(`ผู้ให้บริการเสียงตอบกลับ ${res.status}: ${await readError(res)}`);

  const type = res.headers.get('content-type') ?? '';

  // แบบที่ 1 — ส่งไฟล์เสียงกลับมาตรง ๆ
  if (type.startsWith('audio/')) {
    return { audio: await res.arrayBuffer(), contentType: type };
  }

  // แบบที่ 2 และ 3 — ส่ง JSON กลับมา
  const data = (await res.json()) as Record<string, unknown>;

  for (const key of ['audioContent', 'audio', 'data', 'audio_base64']) {
    const value = data[key];
    if (typeof value === 'string' && value.length > 100 && !value.startsWith('http')) {
      return { audio: base64ToArrayBuffer(value), contentType: 'audio/mpeg' };
    }
  }

  for (const key of ['audio_url', 'url', 'link', 'audioUrl']) {
    const value = data[key];
    if (typeof value === 'string' && value.startsWith('http')) {
      const file = await fetch(value, { signal });
      if (!file.ok) fail(`ดาวน์โหลดไฟล์เสียงไม่สำเร็จ (${file.status})`);
      return {
        audio: await file.arrayBuffer(),
        contentType: file.headers.get('content-type') ?? 'audio/mpeg',
      };
    }
  }

  fail('ไม่พบไฟล์เสียงในคำตอบของผู้ให้บริการ — ตรวจรูปแบบคำตอบในไฟล์ config/tts.txt');
}

/* --------------------------------- ทางเข้า -------------------------------- */

/** สังเคราะห์เสียงพูดจากข้อความ ตามผู้ให้บริการที่ตั้งไว้ในไฟล์ config/tts.txt */
export async function synthesize(text: string): Promise<SynthResult> {
  const cfg = getTtsConfig();
  // ตัดอิโมจิทิ้ง ไม่งั้นระบบจะอ่านชื่ออิโมจิออกมาเป็นเสียง
  const clean = stripEmoji(text).slice(0, MAX_CHARS);
  if (!clean) fail('ไม่มีข้อความที่จะอ่าน (เหลือแต่อิโมจิ)');
  if (cfg.provider === 'browser') fail('ตั้งค่าให้ใช้เสียงของเบราว์เซอร์อยู่ (PROVIDER = browser)');
  if (!cfg.configured) fail(`ยังตั้งค่า ${cfg.provider} ไม่ครบในไฟล์ config/tts.txt`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    switch (cfg.provider) {
      case 'google':
        return await google(clean, cfg, controller.signal);
      case 'azure':
        return await azure(clean, cfg, controller.signal);
      case 'openai':
        return await openai(clean, cfg, controller.signal);
      case 'edge':
        return await edge(clean, cfg);
      default:
        return await custom(clean, cfg, controller.signal);
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      fail(`ผู้ให้บริการเสียงไม่ตอบภายใน ${Math.round(cfg.timeoutMs / 1000)} วินาที`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
