/** @type {import('next').NextConfig} */
const nextConfig = {
  // แพ็กเกจที่ต้องรันจาก node_modules ตรง ๆ ห้าม bundle
  // (ws ถูก bundle แล้วฟังก์ชัน mask จะพัง ทำให้ TTS ค้าง)
  serverExternalPackages: ['mqtt', 'node-edge-tts', 'ws'],
};

export default nextConfig;
