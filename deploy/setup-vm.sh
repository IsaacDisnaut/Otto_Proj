#!/usr/bin/env bash
# ===================================================================
#  ติดตั้งเว็บออตโต้บอทบน Azure VM (Ubuntu 22.04)
#
#  วิธีใช้ - รันบนเครื่อง VM:
#     sudo bash setup-vm.sh ottobot-xxxx.southeastasia.cloudapp.azure.com
#
#  รันซ้ำได้ ไม่พัง (idempotent)
# ===================================================================
set -euo pipefail

DOMAIN="${1:-}"
REPO="${REPO:-https://github.com/IsaacDisnaut/Otto_IOT_Proj.git}"
APP_DIR=/opt/ottobot
APP_USER=ottobot
NODE_MAJOR=20

if [[ -z "$DOMAIN" ]]; then
  echo "ใช้: sudo bash setup-vm.sh <ชื่อโดเมนของคุณ>" >&2
  echo "ตัวอย่าง: sudo bash setup-vm.sh ottobot-xxxx.southeastasia.cloudapp.azure.com" >&2
  exit 1
fi
if [[ $EUID -ne 0 ]]; then
  echo "ต้องรันด้วย sudo" >&2
  exit 1
fi

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

# ------------------------------------------------------------------
say "1/8 อัปเดตระบบและลงเครื่องมือพื้นฐาน"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg git ufw > /dev/null

# ------------------------------------------------------------------
say "2/8 เพิ่ม swap 2GB กัน build ล้มเพราะแรมหมด"
# next build กินแรมเยอะ ถ้าเครื่องมีแรม 2GB หรือน้อยกว่าจะถูก OOM killer ฆ่า
if [[ ! -f /swapfile ]]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile > /dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo "   เพิ่ม swap แล้ว"
else
  echo "   มี swap อยู่แล้ว ข้าม"
fi

# ------------------------------------------------------------------
say "3/8 ติดตั้ง Node.js ${NODE_MAJOR}"
if ! command -v node > /dev/null || [[ "$(node -v | cut -d. -f1)" != "v${NODE_MAJOR}" ]]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - > /dev/null
  apt-get install -y -qq nodejs > /dev/null
fi
echo "   node $(node -v) / npm $(npm -v)"

# ------------------------------------------------------------------
say "4/8 ติดตั้ง Caddy (ทำ HTTPS ให้อัตโนมัติ)"
if ! command -v caddy > /dev/null; then
  apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https > /dev/null
  curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y -qq caddy > /dev/null
fi
echo "   $(caddy version)"

# ------------------------------------------------------------------
say "5/8 ดึงโค้ดและ build"
id -u "$APP_USER" > /dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"

if [[ -d "$APP_DIR/.git" ]]; then
  git -C "$APP_DIR" fetch --quiet origin
  git -C "$APP_DIR" reset --hard --quiet origin/main
else
  rm -rf "$APP_DIR"
  git clone --quiet --depth 1 "$REPO" "$APP_DIR"
fi
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

# ลง dependency ให้ครบรวม devDependencies เพราะตอน build ต้องใช้ typescript
sudo -u "$APP_USER" bash -c "cd '$APP_DIR' && npm ci --no-audit --no-fund" \
  || sudo -u "$APP_USER" bash -c "cd '$APP_DIR' && npm install --no-audit --no-fund"
sudo -u "$APP_USER" bash -c "cd '$APP_DIR' && npm run build"
echo "   build เสร็จ"

# ------------------------------------------------------------------
say "6/8 ตั้งค่า systemd"
install -m 644 "$APP_DIR/deploy/ottobot-web.service" /etc/systemd/system/ottobot-web.service
systemctl daemon-reload
systemctl enable --now ottobot-web > /dev/null
echo "   ottobot-web: $(systemctl is-active ottobot-web)"

# ------------------------------------------------------------------
say "7/8 ตั้งค่า Caddy สำหรับ $DOMAIN"
mkdir -p /var/log/caddy
chown caddy:caddy /var/log/caddy
sed "s|YOUR_DOMAIN|${DOMAIN}|" "$APP_DIR/deploy/Caddyfile" > /etc/caddy/Caddyfile
caddy fmt --overwrite /etc/caddy/Caddyfile > /dev/null 2>&1 || true
caddy validate --config /etc/caddy/Caddyfile
systemctl restart caddy
echo "   caddy: $(systemctl is-active caddy)"

# ------------------------------------------------------------------
say "8/8 ตั้งไฟร์วอลล์ในเครื่อง"
# Azure NSG กันชั้นนอกอยู่แล้ว ufw เป็นชั้นสองกันพลาด
ufw allow 22/tcp   > /dev/null
ufw allow 80/tcp   > /dev/null
ufw allow 443/tcp  > /dev/null
ufw allow 8883/tcp > /dev/null
ufw --force enable > /dev/null
echo "   เปิด: 22, 80, 443, 8883 (พอร์ต 3000 และ 1883 ไม่เปิดออกนอก)"

cat <<EOF

===================================================================
 เสร็จแล้ว

 เว็บ:  https://${DOMAIN}
 หุ่น:  mqtts://${DOMAIN}:8883

 ยังเหลืออีก 2 อย่างที่ต้องทำเอง (ไฟล์ความลับไม่ได้อยู่ใน git)

 1) ใส่ API key ของ AI
      sudo -u ${APP_USER} nano ${APP_DIR}/config/ai.local.txt
    ใส่:
      PROVIDER_URL = https://openrouter.ai/api/v1/chat/completions
      MODEL = qwen/qwen3.8-max-0902
      API_KEY = <คีย์ของคุณ>

 2) ติดตั้ง HiveMQ แล้วชี้เว็บไปที่มัน
      sudo -u ${APP_USER} nano ${APP_DIR}/config/mqtt.local.txt
    ใส่ (broker อยู่เครื่องเดียวกัน จึงต่อผ่าน loopback ไม่ต้องเข้ารหัส):
      BROKER_URL = mqtt://127.0.0.1:1883
      USERNAME = <บัญชีใน HiveMQ>
      PASSWORD = <รหัสผ่าน>
      QOS = 1

 เสร็จแล้วสั่ง:  sudo systemctl restart ottobot-web

 ดู log:  journalctl -u ottobot-web -f
          journalctl -u caddy -f
===================================================================
EOF
