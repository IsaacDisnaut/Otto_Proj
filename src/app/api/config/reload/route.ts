import { NextResponse } from 'next/server';
import { getPublicConfig } from '@/lib/config';
import { reload, status } from '@/lib/mqtt-bridge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** อ่านไฟล์ config ใหม่ทั้งหมด แล้วเชื่อมต่อ MQTT ใหม่ */
export async function POST() {
  await reload();
  return NextResponse.json({ ok: true, config: getPublicConfig(), mqtt: status() });
}
