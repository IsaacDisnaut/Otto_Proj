import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ออตโต้บอท คอนโทรล | ระบบควบคุมหุ่นยนต์ด้วย AI',
  description:
    'เว็บแอปควบคุมหุ่นยนต์ Otto ผ่าน MQTT พร้อมกล่องแชทที่พูดได้-ฟังได้ และสมองกลจาก Generative AI',
};

export const viewport: Viewport = {
  themeColor: '#f4f7fc',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+Thai:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
        <link
          rel="icon"
          href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🤖</text></svg>"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
