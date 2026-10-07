# รันเว็บออตโต้บอทบน Azure Virtual Machine

รันทั้ง **เว็บ** และ **HiveMQ broker** บน VM เครื่องเดียว ได้ที่อยู่สาธารณะถาวร
หุ่นกับเว็บจึงคุยกันได้จากที่ไหนก็ได้ ไม่ต้องเปิดพอร์ตที่เราเตอร์บ้าน

---

## ⚠️ อ่านก่อน: ทำไมต้องมี HTTPS

ปุ่มไมโครโฟน (STT) ใช้ Web Speech API ซึ่ง **เบราว์เซอร์ยอมให้ใช้เฉพาะบน `localhost` หรือ HTTPS เท่านั้น**

ถ้าเปิดเว็บด้วย `http://<ไอพี>:3000` ตรง ๆ **ปุ่มไมค์จะกดไม่ติดโดยไม่มีข้อความบอก**
เสียงพูด (TTS) ยังทำงานได้เพราะวิ่งผ่านเซิร์ฟเวอร์ แต่การสั่งงานด้วยเสียงจะใช้ไม่ได้เลย

ชุด deploy นี้จึงใช้ **Caddy** เป็นตัวรับหน้า ขอใบรับรองจาก Let's Encrypt ให้อัตโนมัติ
โดยอาศัยชื่อโดเมนฟรีที่ Azure แจกมากับ public IP:

```
<ชื่อที่คุณตั้ง>.<ภูมิภาค>.cloudapp.azure.com
```

ไม่ต้องซื้อโดเมน ไม่ต้องตั้งค่า DNS เอง

---

## ภาพรวม

```
                         Azure VM (Ubuntu 22.04)
                    ┌──────────────────────────────────┐
  เบราว์เซอร์  ──443──┤ Caddy ──► Next.js (127.0.0.1:3000)│
  (มือถือ/พีซี)      │              │                   │
                    │              │ mqtt://127.0.0.1  │
                    │              ▼      (loopback)   │
  หุ่น ESP32  ──8883─┤          HiveMQ broker           │
                    └──────────────────────────────────┘

  พอร์ตที่เปิดออกเน็ต : 22 (SSH เฉพาะ IP คุณ), 80, 443, 8883
  พอร์ตที่ไม่เปิด      : 3000 (เว็บ), 1883 (MQTT ไม่เข้ารหัส)
```

**ข้อดีของการรวมไว้เครื่องเดียว:** เว็บคุยกับ broker ผ่าน `127.0.0.1` ซึ่งไม่ออกไปไหน
จึงไม่ต้องเข้ารหัสและไม่ต้องเปิดพอร์ต 1883 ออกนอกเลย มีแต่หุ่นที่ต่อเข้ามาทาง TLS 8883

---

## ขั้นที่ 1 — สร้าง VM

ต้องมี [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) ในเครื่องคุณก่อน

```bash
az login

# ตั้งชื่อ DNS ที่ยังไม่มีใครใช้ (เปลี่ยน xxxx เป็นอะไรก็ได้)
DNS_LABEL=ottobot-xxxx
MY_IP=$(curl -s https://api.ipify.org)

az group create -n rg-ottobot -l southeastasia

az deployment group create \
  -g rg-ottobot \
  -f main.bicep \
  --parameters dnsLabel="$DNS_LABEL" \
               sshPublicKey="$(cat ~/.ssh/id_ed25519.pub)" \
               allowedSshSourceIp="${MY_IP}/32"
```

เสร็จแล้วจะได้ค่าออกมา เก็บ `fqdn` ไว้ใช้ขั้นถัดไป

> **ภูมิภาค** `southeastasia` (สิงคโปร์) ใกล้ไทยที่สุด ดีที่สุดเรื่องความหน่วง
>
> **SSH** เปิดให้เฉพาะ IP ของคุณ ถ้าเน็ตบ้านเปลี่ยน IP ต้องแก้กฎใหม่:
> ```bash
> az network nsg rule update -g rg-ottobot --nsg-name ottobot-nsg \
>   -n allow-ssh --source-address-prefixes "$(curl -s https://api.ipify.org)/32"
> ```

## ขั้นที่ 2 — ติดตั้งเว็บ

```bash
FQDN=ottobot-xxxx.southeastasia.cloudapp.azure.com

ssh azureuser@$FQDN
git clone https://github.com/IsaacDisnaut/Otto_IOT_Proj.git
sudo bash Otto_IOT_Proj/deploy/setup-vm.sh $FQDN
```

สคริปต์จะลง Node 20, Caddy, build เว็บ, ตั้ง systemd, เปิดไฟร์วอลล์ และขอใบรับรอง HTTPS
**รันซ้ำได้เรื่อย ๆ** ใช้เป็นคำสั่งอัปเดตเวอร์ชันใหม่ได้ด้วย

เสร็จแล้วเปิด `https://$FQDN` ได้เลย (ตอนนี้ AI กับ MQTT ยังไม่ทำงาน รอขั้นถัดไป)

## ขั้นที่ 3 — ติดตั้ง HiveMQ

```bash
# อัปโหลด license จากเครื่องคุณขึ้น VM
scp your-license.lic azureuser@$FQDN:~

ssh azureuser@$FQDN
cd /opt
sudo wget -q https://releases.hivemq.com/hivemq-latest.zip
sudo unzip -q hivemq-latest.zip && sudo mv hivemq-* hivemq
sudo cp ~/your-license.lic /opt/hivemq/license/
sudo useradd -r -d /opt/hivemq hivemq 2>/dev/null; sudo chown -R hivemq:hivemq /opt/hivemq
```

**ต้องเปิดการยืนยันตัวตนก่อนเปิดใช้งานจริง** — HiveMQ ที่ยังไม่ตั้งค่าจะให้ใครก็ต่อได้
เปิด extension **File RBAC** แล้วสร้างบัญชีไว้ ดูวิธีในเอกสาร HiveMQ รุ่นที่คุณใช้
หัวข้อ *Security / Authentication*

**ตั้ง TLS listener พอร์ต 8883** สำหรับให้หุ่นต่อเข้ามา — ในไฟล์ `/opt/hivemq/conf/config.xml`
ใช้ใบรับรองที่ Caddy ขอมาแล้วได้ (เป็นใบจริงจาก Let's Encrypt หุ่นจึงตรวจสอบได้ ไม่ต้องใช้ `setInsecure()`)
แต่ต้องแปลงเป็น Java keystore ก่อน และต้องแปลงใหม่ทุกครั้งที่ใบรับรองต่ออายุ (ทุก ~90 วัน)
ถ้าอยากง่ายกว่า ใช้ใบรับรองที่ออกเองแล้วให้หุ่นใช้ `setInsecure()` ก็ได้

จากนั้นรัน HiveMQ ด้วย systemd (ตัวติดตั้งของ HiveMQ มี unit file ให้)

## ขั้นที่ 4 — ใส่ค่าความลับ

ไฟล์ `*.local.txt` ไม่ได้อยู่ใน git จึงต้องสร้างบน VM เอง **และจะไม่หายตอนอัปเดตโค้ด**

```bash
# AI
sudo -u ottobot tee /opt/ottobot/config/ai.local.txt > /dev/null <<EOF
PROVIDER_URL = https://openrouter.ai/api/v1/chat/completions
MODEL = qwen/qwen3.8-max-0902
API_KEY = <คีย์ของคุณ>
EOF

# MQTT - broker อยู่เครื่องเดียวกัน ต่อผ่าน loopback ไม่ต้องเข้ารหัส
sudo -u ottobot tee /opt/ottobot/config/mqtt.local.txt > /dev/null <<EOF
BROKER_URL = mqtt://127.0.0.1:1883
USERNAME = <บัญชีใน HiveMQ>
PASSWORD = <รหัสผ่าน>
QOS = 1
EOF

sudo systemctl restart ottobot-web
```

## ขั้นที่ 5 — ชี้หุ่นมาที่ VM

ในโค้ด ESP32 (ดูตัวอย่างเต็มท้ายไฟล์ [`../config/topics.txt`](../config/topics.txt)):

```cpp
const char* MQTT_HOST = "ottobot-xxxx.southeastasia.cloudapp.azure.com";
const int   MQTT_PORT = 8883;
const char* MQTT_USER = "บัญชีใน HiveMQ";
const char* MQTT_PASS = "รหัสผ่าน";
```

---

## ค่าใช้จ่ายโดยประมาณ

| รายการ | ต่อเดือน |
|---|---|
| VM `Standard_B2s` (2 vCPU / 4 GB) | ~$30–35 |
| ดิสก์ StandardSSD 32 GB | ~$2–3 |
| Public IP แบบ Static | ~$3–4 |
| **รวม** | **~$40** |

ราคาเปลี่ยนตามภูมิภาคและช่วงเวลา เช็คจริงที่ [Azure Pricing Calculator](https://azure.microsoft.com/pricing/calculator/)

**ลดค่าใช้จ่ายได้โดย:**
- ใช้ `Standard_B1s` (1 vCPU / 1 GB, ~$9/เดือน) — ประหยัดกว่ามาก แต่แรมตึงสำหรับ HiveMQ (JVM) + Next.js
  ถ้าจะใช้ ให้ build ในเครื่องตัวเองแล้วคัดลอก `.next/` ขึ้นไป อย่า build บน VM
- **ปิดเครื่องตอนไม่ใช้** — `az vm deallocate -g rg-ottobot -n ottobot-vm` แล้วจะไม่คิดค่า compute
  (ยังคิดค่าดิสก์กับ IP) เปิดกลับด้วย `az vm start`
- ซื้อ Reserved Instance 1 ปี ลดได้ ~40% ถ้าจะใช้ยาว

---

## คำสั่งที่ใช้บ่อย

```bash
# ดู log
journalctl -u ottobot-web -f
journalctl -u caddy -f

# รีสตาร์ต
sudo systemctl restart ottobot-web

# อัปเดตเป็นโค้ดเวอร์ชันใหม่
sudo bash /opt/ottobot/deploy/setup-vm.sh $FQDN

# เช็คสถานะ MQTT ที่เว็บมองเห็น
curl -s localhost:3000/api/mqtt/status
```

---

## แก้ปัญหา

| อาการ | สาเหตุที่น่าจะเป็น |
|---|---|
| ปุ่มไมค์กดไม่ติด | เปิดเว็บด้วย `http://` หรือด้วย IP ต้องเข้าผ่าน `https://<โดเมน>` และใช้ Chrome/Edge |
| HTTPS ขึ้นใบรับรองไม่ถูกต้อง | พอร์ต 80 ไม่ได้เปิด Let's Encrypt ตรวจโดเมนไม่ได้ — ดู `journalctl -u caddy` |
| เว็บขึ้น 502 | `ottobot-web` ไม่ทำงาน — `systemctl status ottobot-web` |
| ข้อความจากหุ่นไม่โผล่ในแชท | SSE ถูก buffer — ตรวจว่า `/etc/caddy/Caddyfile` มีส่วน `@sse` กับ `flush_interval -1` |
| MQTT ต่อไม่ติด | ดูข้อความเตือนในแท็บตั้งค่าบนเว็บ ระบบจะบอกสาเหตุและวิธีแก้ให้ |
| หุ่นต่อ 8883 ไม่ได้ | NSG ยังไม่เปิด 8883 หรือ HiveMQ ยังไม่ได้ตั้ง TLS listener |
| `next build` ถูกฆ่ากลางทาง | แรมไม่พอ — สคริปต์เพิ่ม swap 2GB ให้แล้ว ถ้ายังไม่ไหวให้ขยับเป็น B2s |

---

## หมายเหตุความถูกต้อง

ไฟล์ในโฟลเดอร์นี้ยังไม่ได้ deploy ขึ้น Azure จริง เพราะต้องใช้บัญชีของคุณ
สิ่งที่ตรวจแล้ว: `ottobot-web.service` ผ่าน `systemd-analyze verify`,
`setup-vm.sh` ผ่าน `bash -n`, Caddyfile ใช้ tab เป็น indent ตามที่ Caddy ต้องการ
ส่วน `main.bicep` ยังไม่ได้ `az bicep build` เพราะเครื่องนี้ไม่มี Azure CLI
แนะนำให้รัน `az deployment group validate` ก่อน create จริง
