// ===================================================================
// version.js — จุดควบคุมเวอร์ชันกลางสำหรับ KTW HUB
// เมื่อมีการอัปเดตระบบ ให้เปลี่ยนเลขเวอร์ชันในไฟล์นี้เพียงจุดเดียว
// เบราว์เซอร์ของผู้ใช้ทุกคนจะทำการโหลดสคริปต์เวอร์ชันล่าสุดให้อัตโนมัติ (Cache Busting)
// ===================================================================

const KTW_VERSION = '20261117.01';
window.KTW_VERSION = KTW_VERSION;

/**
 * ฟังก์ชันช่วยโหลด JavaScript พร้อมแนบพารามิเตอร์เวอร์ชันอัตโนมัติ
 * @param {string} src - Path ของไฟล์สคริปต์
 */
function loadKTWScript(src) {
    const separator = src.includes('?') ? '&' : '?';
    document.write(`<script src="${src}${separator}v=${KTW_VERSION}"><\/script>`);
}

/**
 * ฟังก์ชันช่วยโหลด CSS พร้อมแนบพารามิเตอร์เวอร์ชันอัตโนมัติ
 * @param {string} href - Path ของไฟล์สไตล์ชีต
 */
function loadKTWStyle(href) {
    const separator = href.includes('?') ? '&' : '?';
    document.write(`<link rel="stylesheet" href="${href}${separator}v=${KTW_VERSION}">`);
}
