import { NextResponse } from 'next/server';
import { synthesize } from '@/lib/tts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** รับข้อความ แล้วคืนไฟล์เสียงภาษาไทยที่สังเคราะห์จากผู้ให้บริการที่ตั้งค่าไว้ */
export async function POST(request: Request) {
  let text = '';
  try {
    const body = (await request.json()) as { text?: string };
    text = (body.text ?? '').toString();
  } catch {
    return NextResponse.json({ ok: false, error: 'รูปแบบ JSON ไม่ถูกต้อง' }, { status: 400 });
  }

  if (!text.trim()) {
    return NextResponse.json({ ok: false, error: 'ไม่มีข้อความที่จะอ่าน' }, { status: 400 });
  }

  try {
    const { audio, contentType } = await synthesize(text);
    return new Response(audio, {
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(audio.byteLength),
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'สร้างเสียงไม่สำเร็จ' },
      { status: 502 },
    );
  }
}
