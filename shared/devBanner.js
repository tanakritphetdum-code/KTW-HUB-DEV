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
        banner.className = 'w-full bg-gradient-to-r from-amber-600 via-orange-600 to-amber-600 text-white text-xs sm:text-sm font-medium py-1.5 px-4 text-center shadow-md flex items-center justify-center gap-2 select-none relative z-50';
        banner.innerHTML = `
            <span class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-white/20 uppercase tracking-wider">DEV ENVIRONMENT</span>
            <span>🛠️ โหมดทดสอบ (DEV) — บันทึกข้อมูลลงตารางทดสอบเท่านั้น ไม่ส่งผลต่อระบบงานจริง</span>
            ${window.KTW_CONFIG.IS_NETLIFY ? '<span class="text-[11px] bg-black/20 px-2 py-0.5 rounded">Netlify Cloud Staging</span>' : ''}
        `;

        document.body.prepend(banner);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', renderBanner);
    } else {
        renderBanner();
    }
})();
