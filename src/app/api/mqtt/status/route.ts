import { NextResponse } from 'next/server';
import { ensureConnected, status } from '@/lib/mqtt-bridge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  ensureConnected();
  return NextResponse.json(status());
}
