// ===================================================================
// shared/devBanner.js — แถบแจ้งเตือนโหมดทดสอบ (DEV Environment Banner)
// ทำงานอัตโนมัติเมื่อ KTW_CONFIG.SHOW_DEV_BANNER = true
// ===================================================================

(function() {
    if (typeof window === 'undefined') return;

    function renderBanner() {
        if (!window.KTW_CONFIG || !window.KTW_CONFIG.SHOW_DEV_BANNER) return;
        if (document.getElementById('ktw-dev-banner')) return;

        const banner = document.createElement('div');
        banner.id = 'ktw-dev-banner';
        // ใช้ position: fixed เพื่อให้ลอยอยู่ด้านบนสุดตรงกลางจอ โดยไม่ไปรบกวน Flex Layout ของหน้าเว็บ
        banner.className = 'fixed top-2.5 left-1/2 -translate-x-1/2 z-[99999] bg-gradient-to-r from-amber-600 via-orange-600 to-amber-600 text-white text-xs font-semibold py-1 px-4 rounded-full shadow-lg border border-white/30 flex items-center gap-2 select-none pointer-events-none backdrop-blur-sm';
        banner.innerHTML = `
            <span class="w-2 h-2 rounded-full bg-white animate-pulse"></span>
            <span class="uppercase tracking-wider font-bold text-[10px] bg-black/20 px-1.5 py-0.5 rounded">DEV</span>
            <span>🛠️ โหมดทดสอบ — ข้อมูลไม่ส่งผลต่อระบบงานจริง</span>
        `;

        document.body.appendChild(banner);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', renderBanner);
    } else {
        renderBanner();
    }
})();
