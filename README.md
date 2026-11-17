# 🏢 KTW HUB — Development & Cloud Staging (DEV)

ศูนย์รวมระบบบริการและจัดการสินค้าองค์กร **KTW (KTW Inventory & Service Portal)**  
สภาพแวดล้อมสำหรับการทดสอบและพัฒนาระบบใหม่ (Development & Staging) บน Cloud ผ่าน **Netlify** ก่อนนำขึ้นติดตั้งบน On-Premise Production Server ของบริษัท

---

## 🎯 วัตถุประสงค์และการปรับปรุงสถาปัตยกรรม (Modular Architecture)
โปรเจกต์นี้ได้รับการปรับปรุงโครงสร้างจากเดิมที่เป็นไฟล์ยักษ์ (Monolithic ขนาด 4,000+ บรรทัดต่อไฟล์) ให้กลายเป็นสถาปัตยกรรมแบบ **แยกโมดูลย่อย (Modular)** เพื่อ:
1. **แยกหน้าจอ (HTML Layout)** ออกจาก **ตรรกะการทำงาน (Logic / JavaScript Service)**
2. **รวมศูนย์การจัดการแคช (Browser Cache)** ไว้ที่ `version.js` จุดเดียวทั้งระบบ
3. **ลดจุดที่ต้องแก้ไขเมื่อมีระบบใหม่เพิ่มเข้ามา** จากเดิม 8–11 จุด เหลือเพียง **5 จุด** (ใช้เวลาไม่เกิน 5 นาที)
4. **รองรับการ Deploy ทดสอบบน Netlify** โดยไม่ติดปัญหา CORS ข้ามโดเมน ผ่าน Netlify Reverse Proxy (`_redirects`)

---

## 📁 โครงสร้างโฟลเดอร์ของระบบ (Project Structure)

```text
KTW-HUB-DEV/
├── index.html                   # หน้าเข้าสู่ระบบ (Modular Login Page & Authentication)
├── main.html                    # หน้าแรก Portal (Dynamic Hub อ่านการ์ดระบบจากเมนูอัตโนมัติ)
├── version.js                   # จุดควบคุมเวอร์ชันแคชส่วนกลาง (Cache Busting)
├── _redirects                   # คอนฟิก Netlify Proxy ส่งผ่านคำขอ /api/* ไป n8n แก้ CORS
├── README.md                    # เอกสารคู่มือและรายละเอียดระบบ
│
├── shared/                      # ทรัพยากรและสคริปต์แกนกลางที่ทุกระบบใช้ร่วมกัน
│   ├── config.js                # Environment Config (DEV / Netlify / Webhook Suffix)
│   ├── api.js                   # ตัวเชื่อมต่อ n8n Webhook (n8nFetch) พร้อม Header Auth
│   ├── menu.js                  # ตัวควบคุม Sidebar Navigation & จัดการ SYSTEM_MODULES
│   ├── perm.js                  # เครื่องมือตรวจสอบสิทธิ์พนักงาน (KTWPerm) ผ่าน perm_my
│   ├── devBanner.js             # แถบสีส้มแจ้งเตือนโหมดทดสอบ DEV บนหัวเว็บ
│   ├── utils/                   # ฟังก์ชันช่วยเหลือส่วนกลาง (formatters, notification)
│   └── components/              # คอมโพเนนต์ UI ส่วนกลาง (modalConfirm, auditLogTable)
│
├── pages/                       # รวมหน้าจอระบบงาน (มีเฉพาะโครงสร้างฟอร์ม สั้นและอ่านง่าย)
│   └── swap.html                # [ระบบนำร่อง] หน้าจอขออนุมัติสลับสินค้า (SWAP Product)
│
└── modules/                     # โค้ด Logic และ Service การทำงานแยกตามระบบ
    └── swapService.js           # [ระบบนำร่อง] ตรรกะการคำนวณและส่งข้อมูลเอกสาร SWAP
```

---

## 🚀 ความคืบหน้าการพัฒนา (Implementation Status)

- [x] **Phase 1: เตรียมโครงสร้าง & คอนฟิกกลาง**
  - จัดเตรียมโครงสร้างโฟลเดอร์แบบแยกสัดส่วน (`shared/`, `pages/`, `modules/`)
  - สร้าง `version.js` สำหรับคุมเวอร์ชันทั้งระบบ
  - สร้าง `shared/config.js` แยกคอนฟิกสภาพแวดล้อม DEV ออกจากโค้ดหน้างาน
  - สร้าง `shared/devBanner.js` แสดงแถบส้มเตือนโหมดทดสอบแบบ Floating Badge
- [x] **Phase 2: ปรับปรุงระบบแกนกลาง (Core Shared Services)**
  - พัฒนา `shared/api.js` รองรับการยิง Webhook ตรงไปยัง n8n พร้อม DEV rewrite
  - พัฒนา `shared/perm.js` รองรับระบบ Permission กลาง (perm_my)
  - พัฒนา `shared/menu.js` คำนวณเส้นทางลิงก์และสิทธิ์อัตโนมัติ
  - พัฒนา `main.html` ฉบับ Dynamic Portal (วาดการ์ดระบบงานจาก `menu.js` อัตโนมัติ)
  - พัฒนา `index.html` หน้า Login ดีไซน์ทันสมัยแบบ Non-blocking
- [x] **Phase 3: แยกโมดูลระบบนำร่อง (Pilot Module - SWAP Product)**
  - แยกหน้าจอ `pages/swap.html` (ลดขนาดเหลือ ~66 KB)
  - สกัด Logic การทำงานทั้งหมดออกเป็น `modules/swapService.js` (~178 KB)
- [x] **Phase 4: ทดสอบการทำงานจริงบน Local Server (เสร็จสมบูรณ์)**
  - ทดสอบ End-to-End: Login ➔ หน้า Portal ➔ กรอกฟอร์ม SWAP ➔ n8n Webhook (-dev) ➔ SQL Database (-Dev)
  - ปรับปรุง Layout ไม่ให้เกิดการเลื่อนหลุดเฟรม และใส่ Cache-Control
- [x] **Phase 5: แปลงระบบที่เหลือทั้งหมดครบถ้วน 100% (Completed)**
  - `pages/approve.html` + `modules/approveService.js` (ศูนย์กลางการอนุมัติเอกสารทุกระบบ)
  - `pages/disassembly.html` + `modules/disassemblyService.js` (ขออนุมัติแกะอะไหล่)
  - `pages/ncr.html` + `modules/ncrService.js` (เอกสาร NCR)
  - `pages/claim.html` + `modules/claimService.js` (เคลมสินค้าลูกค้า)
  - `pages/borrow.html` + `modules/borrowService.js` (ยืมสินค้าหน้าร้าน)
  - `pages/pettycash.html` + `modules/pettycashService.js` (บันทึกเงินสดย่อย)
  - `pages/employees.html` + `modules/employeeService.js` (การจัดการ User & Role)
  - `pages/history_log.html` + `modules/historyLogService.js` (ประวัติการทำงาน Audit Log)

---

## ⚙️ การทำงานร่วมกับ Netlify & n8n หลังบ้าน

### 1. การแก้ไขปัญหา CORS ผ่าน `_redirects`
เมื่อเว็บรันอยู่บน Netlify (เช่น `https://*.netlify.app`) การเรียก API ไปยัง `https://n8n.ktw.co.th` โดยตรงอาจติดปัญหา Browser CORS  
ระบบได้แก้ไขด้วยกฎ **Netlify Rewrite Proxy**:
```text
/api/*  https://n8n.ktw.co.th/webhook/:splat  200!
```
Netlify Edge Server จะทำหน้าที่เป็นตัวกลางส่งต่อคำขอ พร้อมแนบ Header `X-KTW-API-Key` และ Request Body ครบ 100% ทำให้เบราว์เซอร์ไม่เกิดข้อผิดพลาด

### 2. ความปลอดภัยและการแยกฐานข้อมูล (Database Isolation)
* ในสภาพแวดล้อม DEV ทุกการส่งคำขอ Webhook จะถูกเติม Suffix `-dev` อัตโนมัติ (เช่น `/create_swap-dev`)
* n8n Server จะบันทึกข้อมูลลงเฉพาะ **ตารางชุดทดสอบ (SQL Tables ชุด -Dev)** เท่านั้น ไม่ส่งผลกระทบต่อข้อมูลงานจริงของบริษัท

---

## 🛠️ ขั้นตอนการเพิ่มระบบใหม่ในอนาคต (5 ขั้นตอน)
เมื่อมีระบบงานใหม่เพิ่มเข้ามา สามารถทำได้ง่ายดายโดยไม่ต้องรื้อระบบเดิม:
1. **สร้างหน้าจอ**: `pages/[ชื่อระบบ].html`
2. **สร้างตรรกะ**: `modules/[ชื่อระบบ]Service.js`
3. **เพิ่มชื่อในเมนู**: เติม 5 บรรทัดใน `SYSTEM_MODULES` ที่ `shared/menu.js`
4. **เปิดทาง Webhook**: เพิ่มชื่อ Webhook ใน `DEV_PATHS` ที่ `shared/api.js`
5. **รีเฟรชแคชผู้ใช้**: ปรับเลขวันที่ใน `version.js` บรรทัดเดียว
