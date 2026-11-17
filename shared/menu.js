// ===================================================================
// shared/menu.js — Sidebar Navigation กลางสำหรับ KTW HUB
// ===================================================================
// - รวมโมดูลทุกระบบไว้ใน SYSTEM_MODULES
// - คำนวณเส้นทางลิงก์อัตโนมัติ (ไม่ว่าจะอยู่หน้าแรก หรืออยู่ในโฟลเดอร์ pages/)
// - ตรวจสอบสิทธิ์การมองเห็นเมนูร่วมกับ KTWPerm (perm.js)
// - Export ให้ main.html นำข้อมูลไปวาดการ์ดหน้าแรกอัตโนมัติ (Dynamic Portal)
// ===================================================================

const SYSTEM_MODULES = [
    {
        key: 'swap',
        permKey: 'SWAP',
        sessionRoleKey: 'emp_type',
        name: 'สลับสินค้า',
        desc: 'ขออนุมัติสลับสินค้า ชำรุด/เปลี่ยนรุ่น/ทดแทน',
        roleLabels: {
            '0': 'พนักงานทั่วไป (Staff)',
            '1': 'ผู้ดูแลระบบ (Admin)',
            '2': 'ผู้บริหารอนุมัติ (Approver)',
            '3': 'SCM Inventory Control',
            '6': 'MCM (เจ้าหน้าที่คลังเครื่อง)',
            '7': 'SPM (เจ้าหน้าที่คลังอะไหล่)'
        },
        isAdmin: (role) => role === '1',
        canApprove: (role) => ['1', '2', '3', '6', '7'].includes(role),
        nav: { file: 'swap.html', icon: 'package-plus', label: 'ขออนุมัติสลับสินค้า' }
    },
    {
        key: 'disassembly',
        permKey: 'DIS',
        sessionRoleKey: 'disassembly_role',
        name: 'แกะอะไหล่',
        desc: 'ขออนุมัติแกะแยกชิ้นส่วนเครื่องจักรเพื่อเป็นอะไหล่',
        roleLabels: {
            '0': 'พนักงานทั่วไป (Staff)',
            '1': 'ผู้ดูแลระบบ (Admin)',
            '2': 'ผู้บริหารอนุมัติ (Approver)',
            '3': 'เจ้าหน้าที่การตลาด (Marketing Officer)',
            '4': 'MCM (เจ้าหน้าที่คลังเครื่อง)',
            '5': 'SPM (เจ้าหน้าที่คลังอะไหล่)',
            '6': 'SRV (เจ้าหน้าที่แผนกเทคนิคและช่าง)',
            '7': 'SCM (เจ้าหน้าที่แผนก SCM)'
        },
        isAdmin: (role) => role === '1',
        canApprove: (role) => ['1', '2', '3', '4', '5', '6', '7'].includes(role),
        nav: { file: 'disassembly.html', icon: 'wrench', label: 'ขออนุมัติแกะอะไหล่' }
    },
    {
        key: 'ncr',
        permKey: 'NCR',
        sessionRoleKey: 'ncr_role',
        name: 'เอกสาร NCR',
        desc: 'รายงานและติดตามปัญหาสินค้าไม่ได้มาตรฐาน (Non-Conformance)',
        roleLabels: {
            '0': 'พนักงานทั่วไป (Staff)',
            '1': 'ผู้ดูแลระบบ (Admin)',
            '2': 'ผู้อนุมัติ (Approver / ผู้บริหาร)',
            '3': 'เจ้าหน้าที่การตลาด (MKT)',
            '4': 'MCM (เจ้าหน้าที่คลังเครื่อง / LOG)',
            '5': 'SPM (เจ้าหน้าที่คลังอะไหล่)',
            '6': 'SRV (เจ้าหน้าที่เทคนิคและช่าง)',
            '7': 'SCM (เจ้าหน้าที่แผนก SCM)',
            '8': 'PQM (บริหารจัดการคุณภาพสินค้า)'
        },
        isAdmin: (role) => role === '1',
        canApprove: (role) => ['1', '2', '3', '4', '5', '7', '8'].includes(role),
        nav: { file: 'ncr.html', icon: 'file-warning', label: 'ขออนุมัติเอกสาร NCR' }
    },
    {
        key: 'claim',
        permKey: 'CLM',
        sessionRoleKey: 'claim_role',
        name: 'เคลมสินค้าลูกค้า',
        desc: 'ระบบขออนุมัติเคลมสินค้าลูกค้า (แบบฟอร์ม F-16-E01)',
        roleLabels: {
            '0': 'พนักงานทั่วไป (Staff)',
            '1': 'ผู้ดูแลระบบ (Admin)',
            '2': 'ผู้อนุมัติ (Approver / ผู้บริหาร)',
            '3': 'เจ้าหน้าที่การตลาด (MKT)',
            '4': 'MCM (เจ้าหน้าที่คลังเครื่อง / LOG)',
            '5': 'SPM (เจ้าหน้าที่คลังอะไหล่)',
            '6': 'SRV (เจ้าหน้าที่เทคนิคและช่าง)'
        },
        isAdmin: (role) => role === '1',
        canApprove: (role) => ['1', '2', '3'].includes(role),
        navVisibleRoles: ['1', '2', '3', '6'],
        nav: { file: 'claim.html', icon: 'headset', label: 'ขออนุมัติเคลมสินค้าลูกค้า' }
    },
    {
        key: 'borrow',
        permKey: 'BRW',
        sessionRoleKey: 'borrow_role',
        name: 'ยืมสินค้าหน้าร้าน',
        desc: 'ระบบเบิกยืมและส่งคืนสินค้าหน้าร้าน (CTS)',
        roleLabels: {
            '0': 'พนักงานทั่วไป (Staff)',
            '1': 'ผู้ดูแลระบบ (Admin)',
            '2': 'CTS หน้าร้าน (ส่งมอบ/รับคืน)'
        },
        isAdmin: (role) => role === '1',
        canApprove: (role) => ['1', '2'].includes(role),
        nav: { file: 'borrow.html', icon: 'package-open', label: 'ขออนุมัติยืมสินค้าหน้าร้าน' }
    },
    {
        key: 'pettycash',
        permKey: 'PCS',
        sessionRoleKey: 'pettycash_role',
        name: 'บันทึกเงินสดย่อย',
        desc: 'ระบบบันทึกและควบคุมการเบิกจ่ายเงินสดย่อยประจำแผนก',
        roleLabels: { '0': 'ไม่มีสิทธิ์', '1': 'ผู้ดูแลระบบ (Admin)', '2': 'ผู้ใช้งาน' },
        isAdmin: (role) => role === '1',
        canApprove: () => false,
        nav: { file: 'pettycash.html', icon: 'wallet', label: 'บันทึกเงินสดย่อย' }
    }
];

window.SYSTEM_MODULES = SYSTEM_MODULES;

/**
 * คำนวณ Path ให้ถูกต้อง ไม่ว่าจะเปิดจากหน้า root (main.html) หรือเปิดจาก pages/
 */
function resolveNavPath(targetFile, isRootPage = false) {
    const isCurrentInPages = window.location.pathname.includes('/pages/');
    if (targetFile === 'main.html' || targetFile === 'index.html') {
        return isCurrentInPages ? '../' + targetFile : targetFile;
    }
    return isCurrentInPages ? targetFile : 'pages/' + targetFile;
}

/**
 * ฟังก์ชันวาด Sidebar Navigation
 */
function renderSidebar() {
    const sidebarContainer = document.getElementById('sidebar-container');
    if (!sidebarContainer) return;

    const empId = sessionStorage.getItem('emp_id') || '-';
    const empName = sessionStorage.getItem('name') || 'ผู้ใช้งาน';
    const empDep = sessionStorage.getItem('dep') || 'แผนก';

    const currentPath = window.location.pathname;
    const currentPageFile = currentPath.substring(currentPath.lastIndexOf('/') + 1) || 'main.html';
    const isCurrentInPages = currentPath.includes('/pages/');

    const activeClass = "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold bg-orange-50 text-orange-600 transition-colors shadow-sm shadow-orange-100";
    const inactiveClass = "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors";

    const isMainActive = currentPageFile === 'main.html' || currentPageFile === '';
    const isApproveActive = currentPageFile === 'approve.html';
    const isEmployeeActive = currentPageFile === 'employees.html';
    const isHistoryActive = currentPageFile === 'history_log.html';

    const P = window.KTWPerm;
    const permOn = !!(P && P.isReady());

    // คำนวณสิทธิ์ระบบย่อย
    const moduleNavHTML = SYSTEM_MODULES
        .filter(mod => {
            const role = sessionStorage.getItem(mod.sessionRoleKey) || '0';
            if (permOn) return P.can(mod.permKey, 'VIEW_MENU');
            return !mod.navVisibleRoles || mod.navVisibleRoles.includes(role);
        })
        .map(mod => {
            const isNavActive = currentPageFile === mod.nav.file;
            const targetHref = resolveNavPath(mod.nav.file);
            return `
                <a href="${targetHref}" class="${isNavActive ? activeClass : inactiveClass}">
                    <i data-lucide="${mod.nav.icon}" class="w-4 h-4"></i>
                    <span>${mod.nav.label}</span>
                </a>
            `;
        }).join('');

    const canApproveAny = permOn 
        ? P.can('PORTAL', 'MENU_APPROVE') 
        : SYSTEM_MODULES.some(m => m.canApprove(sessionStorage.getItem(m.sessionRoleKey) || '0'));

    const isAdminOfAny = SYSTEM_MODULES.some(m => m.isAdmin(sessionStorage.getItem(m.sessionRoleKey) || '0'));
    const showUserMenu = permOn ? P.can('PORTAL', 'MENU_USER') : isAdminOfAny;
    const showHistoryMenu = permOn ? P.can('PORTAL', 'MENU_HISTORY') : isAdminOfAny;

    const mainHref = resolveNavPath('main.html');
    const approveHref = resolveNavPath('approve.html');
    const employeesHref = resolveNavPath('employees.html');
    const historyHref = resolveNavPath('history_log.html');

    sidebarContainer.innerHTML = `
        <aside class="w-64 bg-white border-r border-slate-200 min-h-screen flex flex-col justify-between select-none shrink-0 shadow-sm">
            <div class="p-4 space-y-6">
                <!-- Brand Header -->
                <div class="flex items-center gap-3 px-2">
                    <div class="w-10 h-10 rounded-xl bg-orange-500 flex items-center justify-center text-white font-black text-lg shadow-md shadow-orange-500/20">
                        KTW
                    </div>
                    <div>
                        <h1 class="font-bold text-slate-800 text-base leading-tight">KTW HUB</h1>
                        <p class="text-[11px] text-orange-600 font-semibold tracking-wide uppercase">Center of Services</p>
                    </div>
                </div>

                <!-- Navigation Links -->
                <nav class="space-y-1">
                    <a href="${mainHref}" class="${isMainActive ? activeClass : inactiveClass}">
                        <i data-lucide="layout-dashboard" class="w-4 h-4"></i>
                        <span>หน้าหลัก (Portal)</span>
                    </a>

                    ${canApproveAny ? `
                    <a href="${approveHref}" class="${isApproveActive ? activeClass : inactiveClass}">
                        <i data-lucide="file-check-2" class="w-4 h-4"></i>
                        <span>การอนุมัติเอกสาร</span>
                    </a>` : ''}

                    <div class="pt-4 pb-1">
                        <p class="px-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider">ระบบงานในระบบ</p>
                    </div>

                    ${moduleNavHTML}

                    ${(showUserMenu || showHistoryMenu) ? `
                    <div class="pt-4 pb-1">
                        <p class="px-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider">ระบบจัดการ</p>
                    </div>` : ''}

                    ${showUserMenu ? `
                    <a href="${employeesHref}" class="${isEmployeeActive ? activeClass : inactiveClass}">
                        <i data-lucide="users" class="w-4 h-4"></i>
                        <span>การจัดการ User & Role</span>
                    </a>` : ''}

                    ${showHistoryMenu ? `
                    <a href="${historyHref}" class="${isHistoryActive ? activeClass : inactiveClass}">
                        <i data-lucide="history" class="w-4 h-4"></i>
                        <span>ประวัติการทำงาน (Audit)</span>
                    </a>` : ''}
                </nav>
            </div>

            <!-- User Profile & Logout -->
            <div class="p-4 border-t border-slate-100 bg-slate-50/50">
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-3 min-w-0">
                        <div class="w-9 h-9 rounded-full bg-slate-200 flex items-center justify-center font-bold text-slate-600 text-sm">
                            ${empName.charAt(0)}
                        </div>
                        <div class="min-w-0">
                            <p class="text-xs font-semibold text-slate-800 truncate">${empName}</p>
                            <p class="text-[10px] text-slate-400 truncate">${empDep} • ${empId}</p>
                        </div>
                    </div>
                    <button onclick="handleLogout()" class="p-2 text-slate-400 hover:text-red-500 rounded-lg hover:bg-white transition-colors" title="ออกจากระบบ">
                        <i data-lucide="log-out" class="w-4 h-4"></i>
                    </button>
                </div>
            </div>
        </aside>
    `;

    if (window.lucide) window.lucide.createIcons();
}

function handleLogout() {
    sessionStorage.clear();
    if (window.KTWPerm) window.KTWPerm.clear();
    const loginPath = resolveNavPath('index.html');
    window.location.href = loginPath;
}

window.renderSidebar = renderSidebar;
window.handleLogout = handleLogout;
