// ===================================================================
// shared/config.js — การตั้งค่าสภาพแวดล้อม (Environment Configuration)
// สำหรับสภาพแวดล้อม DEV (Development & Netlify Staging)
// ===================================================================

(function() {
    // ตรวจสอบว่ากำลังรันอยู่บน Netlify หรือไม่
    const isNetlify = typeof window !== 'undefined' && 
                      (window.location.hostname.includes('netlify.app') || window.location.hostname.includes('netlify.live'));

    window.KTW_CONFIG = {
        // ระบุ Environment ปัจจุบัน: 'DEV' หรือ 'PRD'
        ENV: 'DEV',
        IS_DEV: true,
        
        // หากรันบน Netlify ให้เรียกผ่าน Netlify Proxy (/api/) เพื่อแก้ปัญหา CORS 100%
        // หากรันบน Localhost / On-premise ให้เรียกตรงไปที่ n8n.ktw.co.th
        BASE_WEBHOOK_URL: isNetlify ? '/api/' : 'https://n8n.ktw.co.th/webhook/',
        
        // สำหรับ DEV ทุก webhook จะต่อท้ายด้วย -dev เพื่อชี้ไปที่ Database ชุดทดสอบ
        WEBHOOK_SUFFIX: '-dev',
        
        // Header Authentication สำหรับ Webhook ของ n8n
        API_KEY_HEADER: 'X-KTW-API-Key',
        API_KEY_VALUE: 'e6766791596b0cf09d3885bd16cb9e6001bd0e1034dd111191a6302d13597e95',
        
        // แสดงแถบสีส้มด้านบนหน้าจอแจ้งเตือนว่าเป็นโหมดทดสอบ
        SHOW_DEV_BANNER: true,
        
        // ข้อมูลประกอบ
        APP_TITLE: 'KTW HUB (DEV)',
        IS_NETLIFY: isNetlify
    };
})();
