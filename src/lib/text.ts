/**
 * เครื่องมือจัดการข้อความก่อนนำไปอ่านออกเสียง
 * ใช้ได้ทั้งฝั่งเซิร์ฟเวอร์และเบราว์เซอร์ (ห้าม import โมดูลของ Node ในไฟล์นี้)
 */

/**
 * อักขระที่ไม่ควรอ่านออกเสียง — อิโมจิ, ตัวปรับสีผิว, ธง, ตัวเชื่อม ZWJ
 * และ variation selector ที่ทำให้อักขระธรรมดากลายเป็นอิโมจิ
 */
const EMOJI_RE =
  /[\p{Extended_Pictographic}\p{Emoji_Presentation}\p{Emoji_Modifier}\p{Regional_Indicator}️︎⃣‍]/gu;

/**
 * ตัดอิโมจิออกจากข้อความ เพื่อไม่ให้ระบบอ่านชื่ออิโมจิออกมาเป็นเสียง
 * (เช่น "ดีใจ😊มาก" จะไม่ถูกอ่านว่า "ดีใจ หน้ายิ้ม มาก")
 *
 * ตัวอักษรไทย ตัวเลข และเครื่องหมายวรรคตอนปกติจะไม่ถูกแตะต้อง
 */
export function stripEmoji(text: string): string {
  if (!text) return '';
  return text
    .replace(EMOJI_RE, '')
    // ช่องว่างที่เหลือจากการตัดอิโมจิ ยุบให้เหลือช่องเดียว
    .replace(/[ \t]{2,}/g, ' ')
    // กันช่องว่างค้างหน้าเครื่องหมายวรรคตอน
    .replace(/[ \t]+([,.!?;:])/g, '$1')
    // กันบรรทัดว่างเกินจำเป็น
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();
}

/** true = ข้อความนี้ไม่มีอะไรให้อ่านออกเสียงแล้ว (มีแต่อิโมจิหรือช่องว่าง) */
export function isSpeakable(text: string): boolean {
  return stripEmoji(text).length > 0;
}
