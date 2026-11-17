// ===================================================================
// modules/historyLogService.js — Service Logic สำหรับ KTW HUB
// ===================================================================

        // ================= สถานะข้อมูลหลัก =================
        let allLogs = [];               // ข้อมูล Log ทั้งหมดที่ดึงมาจาก webhook (เก็บไว้ในหน่วยความจำ กรอง/เรียงฝั่ง client)
        let filterMode = 'all';         // สำรองไว้เผื่อขยายในอนาคต (ไม่ใช้ในตอนนี้)

        // ระบบ Pagination
        let currentPage = 1;
        let pageSize = 25;

        // ระบบ Sort และตัวกรอง
        let sortColumn = 'log_time';
        let sortDirection = 'desc';
        let moduleFilter = 'all';
        let actionTypeFilter = 'all';
        let dateFromFilter = '';
        let dateToFilter = '';

        // ===== สิทธิ์ดู/ล้าง log แยกตามระบบ (8.5–8.8 VIEW_LOG, 8.1–8.4 CLEAR_LOG) =====
        // ไม่มีข้อมูลสิทธิ์ใหม่ → ทำงานแบบเดิม (เห็น/ล้างได้ทุกระบบ ตามที่หน้าเดิมอนุญาตให้ Admin)
        const LOG_SYSTEMS = [
            { key: 'SWAP', name: 'SWAP',         modules: ['SwapDocument', 'Employee'],                     clearEndpoint: 'clear_old_audit_log_swap' },
            { key: 'DIS',  name: 'Disassembly',  modules: ['DisassemblyDocument', 'DisassemblyEmployee'],   clearEndpoint: 'clear_old_logs_disassembly' },
            { key: 'NCR',  name: 'NCR',          modules: ['NcrDocument', 'NcrEmployee'],                   clearEndpoint: 'clear_old_logs_ncr' },
            { key: 'CLM',  name: 'Claim',        modules: ['ClaimDocument', 'ClaimEmployee'],               clearEndpoint: 'clear_old_logs_claim_cus' },
            { key: 'BRW',  name: 'Borrow',      modules: ['BorrowDocument', 'BorrowEmployee'],                               clearEndpoint: 'borrow_logs_clear' }
        ];
        const permReady = () => !!(window.KTWPerm && window.KTWPerm.isReady());
        const canViewLog = k => !permReady() || window.KTWPerm.can(k, 'VIEW_LOG');
        const canClearLog = k => !permReady() || window.KTWPerm.can(k, 'CLEAR_LOG');
        const sysOfModule = m => (LOG_SYSTEMS.find(x => x.modules.includes(m)) || {}).key;
        async function ensurePerm() {
            if (!window.KTWPerm) {
                await new Promise(r => { const t = setInterval(() => { if (window.KTWPerm) { clearInterval(t); r(); } }, 50); setTimeout(() => { clearInterval(t); r(); }, 2500); });
            }
            if (window.KTWPerm && !window.KTWPerm.isReady()) await window.KTWPerm.load();
        }
        // ซ่อนตัวเลือกส่วนงานของระบบที่ไม่มีสิทธิ์ดู และซ่อนปุ่มล้าง log ถ้าไม่มีสิทธิ์ล้างเลยสักระบบ
        function applyLogPermUI() {
            const sel = document.getElementById('filterModule');
            if (sel) [...sel.options].forEach(o => {
                if (o.value === 'all') return;
                if (o.value === 'PermissionLog') { o.hidden = o.disabled = permReady() && !window.KTWPerm.can('SWAP', 'MANAGE_PERMISSION'); return; }
                const k = sysOfModule(o.value); o.hidden = o.disabled = !canViewLog(k);
            });
            const btn = document.getElementById('openClearLogsBtn');
            if (btn) btn.classList.toggle('hidden', !LOG_SYSTEMS.some(x => canClearLog(x.key)));
        }

        const AUDIT_LOG_WEBHOOK_URL = 'https://n8n.ktw.co.th/webhook/get-audit-log?actorEmpId=' + encodeURIComponent(sessionStorage.getItem('emp_id') || '');
        const DISASSEMBLY_LOG_WEBHOOK_URL = 'https://n8n.ktw.co.th/webhook/get_all_disassembly_logs?actorEmpId=' + encodeURIComponent(sessionStorage.getItem('emp_id') || '');
        const NCR_LOG_WEBHOOK_URL = 'https://n8n.ktw.co.th/webhook/get_all_ncr_logs?actorEmpId=' + encodeURIComponent(sessionStorage.getItem('emp_id') || '');
        // 🔄 28/09/2569 : นำ Claim กลับเข้ามารวมใน Inventory System อีกครั้ง (ยกเลิกมติ SCM 15 ก.ย. 2569)
        // 🔧 29/09/2569 : เดิมชี้ไปที่ get_work_history_claim_cus ซึ่งเป็นคนละ endpoint กัน!
        //    - get_work_history_claim_cus = ดึงประวัติ "รายคน" (ต้องส่ง POST + body.empId) ใช้หน้าอื่น
        //    - get_all_claim_logs (ใหม่)   = ดึง log "ทั้งระบบ" ด้วย GET เฉยๆ เหมือน get_all_disassembly_logs/get_all_ncr_logs
        //    ต้องสร้าง node ใหม่ฝั่ง n8n ตาม guide ก่อนหน้านี้จึงจะใช้ได้ (ดู claim_n8n_backend_guide.md)
        const CLAIM_LOG_WEBHOOK_URL = 'https://n8n.ktw.co.th/webhook/get_all_claim_logs?actorEmpId=' + encodeURIComponent(sessionStorage.getItem('emp_id') || '');

        // ตั้งค่าการแสดงผลของแต่ละส่วนงาน (module) — รวมทั้ง SWAP, Disassembly, NCR และ Claim
        const MODULE_CONFIG = {
            SwapDocument:         { label: 'เอกสารสลับสินค้า (SWAP)',     class: 'bg-orange-50 text-brand-600 border-orange-100', icon: 'file-text' },
            Employee:             { label: 'จัดการพนักงาน (SWAP)',       class: 'bg-indigo-50 text-indigo-600 border-indigo-100', icon: 'user' },
            DisassemblyDocument:  { label: 'เอกสารแกะอะไหล่ (Disassembly)', class: 'bg-teal-50 text-teal-600 border-teal-100', icon: 'wrench' },
            DisassemblyEmployee:  { label: 'จัดการพนักงาน (Disassembly)', class: 'bg-purple-50 text-purple-600 border-purple-100', icon: 'user-cog' },
            NcrDocument:          { label: 'เอกสาร NCR',                 class: 'bg-rose-50 text-rose-600 border-rose-100', icon: 'file-warning' },
            NcrEmployee:          { label: 'จัดการพนักงาน (NCR)',        class: 'bg-pink-50 text-pink-600 border-pink-100', icon: 'user-cog' },
            ClaimDocument:        { label: 'เอกสารเคลมสินค้าลูกค้า (Claim)', class: 'bg-emerald-50 text-emerald-600 border-emerald-100', icon: 'headset' },
            ClaimEmployee:        { label: 'จัดการพนักงาน (Claim)',      class: 'bg-cyan-50 text-cyan-600 border-cyan-100', icon: 'user-cog' },
            BorrowDocument:       { label: 'ขออนุมัติยืมสินค้าหน้าร้าน (Borrow)', class: 'bg-amber-50 text-amber-600 border-amber-100', icon: 'package-open' },
            BorrowEmployee:       { label: 'จัดการพนักงาน (Borrow)',     class: 'bg-yellow-50 text-yellow-700 border-yellow-100', icon: 'user-cog' },
            // 🆕 ประวัติการเปลี่ยน "สิทธิ์รายข้อ/ระดับ/แผนก" จากระบบ Permission ใหม่ (perm.PermissionLog) — เห็นได้เฉพาะผู้มีสิทธิ์จัดการสิทธิ์
            PermissionLog:        { label: 'สิทธิ์รายข้อ (Permission)',  class: 'bg-violet-50 text-violet-600 border-violet-100', icon: 'shield-check' }
        };

        // ระบบ "เอกสาร" ที่รองรับปุ่มกู้คืน (Restore) เมื่อแถวนั้นเป็น action_type = DELETE
        // key = module name ตาม MODULE_CONFIG ด้านบน, value = { endpoint, idField }
        // Claim ใช้ webhook เดียว (delete_restore_claim_cus) สลับลบ/กู้คืนตาม field action — จึงต้องส่ง action:'RESTORE'
        //   และแสดงปุ่มเฉพาะเอกสารที่ "ยังถูกลบอยู่" (ไม่มี log RESTORE ที่ใหม่กว่า log DELETE ล่าสุดของใบนั้น)
        // sys = รหัสระบบใน Permission (ใช้ซ่อนปุ่มกู้คืนถ้าไม่มีสิทธิ์ RESTORE)
        const RESTORE_CONFIG = {
            SwapDocument:        { endpoint: 'restore_doc_swap_product', idField: 'documentId', sys: 'SWAP' },
            DisassemblyDocument: { endpoint: 'restore_doc_disassembly', idField: 'docId', sys: 'DIS' },
            NcrDocument:         { endpoint: 'restore_doc_ncr', idField: 'docId', sys: 'NCR' },
            ClaimDocument:       { endpoint: 'delete_restore_claim_cus', idField: 'docId', sys: 'CLM', extra: { action: 'RESTORE', reason: '' } }
        };
        // ซ่อนปุ่มกู้คืนถ้าสิทธิ์พร้อมแล้วแต่ไม่มี RESTORE (สิทธิ์ยังไม่พร้อม → แสดงตามเดิม ฝั่ง n8n ตรวจซ้ำอยู่แล้ว)
        function canRestoreModule(cfg) {
            return !(window.KTWPerm && window.KTWPerm.isReady()) || window.KTWPerm.can(cfg.sys, 'RESTORE');
        }
        // เอกสารนี้ยังอยู่ในสถานะถูกลบหรือไม่ (ดูจาก log ล่าสุดของใบนั้นว่าเป็น DELETE หรือ RESTORE)
        // แถว DELETE นี้ยังเป็น "เหตุการณ์ล่าสุด" ของเอกสารใบนั้นหรือไม่ (ถ้ามี RESTORE ที่ใหม่กว่า = กู้คืนไปแล้ว → ไม่แสดงปุ่ม)
        // ใช้ได้กับทุกระบบ — ถ้าลบซ้ำหลังกู้คืน จะมีปุ่มเฉพาะแถวลบล่าสุดเท่านั้น
        function isLatestDeleteRow(log) {
            const rows = allLogs.filter(l => l.module === log.module && String(l.entity_id) === String(log.entity_id) && (l.action_type === 'DELETE' || l.action_type === 'RESTORE'));
            if (!rows.length) return true;
            rows.sort((a, b) => (new Date(b.log_time) - new Date(a.log_time)) || ((Number(b.log_id) || 0) - (Number(a.log_id) || 0)));
            return rows[0] === log || (rows[0].action_type === 'DELETE' && rows[0].log_time === log.log_time && rows[0].log_id === log.log_id);
        }
        // แสดงเลขที่เอกสารหน้ารายละเอียด (เฉพาะ log ของเอกสาร) เพื่อไม่ต้องกด "ดูเพิ่มเติม"
        function descriptionWithDocId(log) {
            const desc = log.description || '-';
            const id = String(log.entity_id || '').trim();
            if (!id || !String(log.module || '').endsWith('Document') || desc.includes(id)) return escapeHtml(desc);
            return `<span class="font-mono font-semibold text-slate-800 bg-slate-100 px-1.5 py-0.5 rounded mr-1.5">${escapeHtml(id)}</span>${escapeHtml(desc)}`;
        }

        // ตั้งค่าการแสดงผลของแต่ละประเภทการกระทำ (action_type) — รวม action ของ Disassembly/NCR ที่ไม่มีใน SWAP ด้วย
        const ACTION_CONFIG = {
            CREATE:            { label: 'สร้างใหม่',              class: 'bg-emerald-50 text-emerald-600 border-emerald-100', icon: 'plus-circle' },
            UPDATE:            { label: 'แก้ไข',                  class: 'bg-amber-50 text-amber-600 border-amber-100', icon: 'pencil' },
            EDIT:              { label: 'แก้ไขเอกสาร',            class: 'bg-amber-50 text-amber-600 border-amber-100', icon: 'pencil' },
            MARKETING_APPROVE: { label: 'เจ้าหน้าที่การตลาดเซ็น', class: 'bg-yellow-50 text-yellow-700 border-yellow-100', icon: 'user-check' },
            FINAL_APPROVE:     { label: 'ผู้อนุมัติเซ็น',          class: 'bg-emerald-50 text-emerald-600 border-emerald-100', icon: 'shield-check' },
            APPROVE_MID:       { label: 'อนุมัติขั้นกลาง (PQM/ผู้อนุมัติ)', class: 'bg-yellow-50 text-yellow-700 border-yellow-100', icon: 'user-check' },
            APPROVE_SCM:       { label: 'อนุมัติขั้นสุดท้าย (SCM)', class: 'bg-emerald-50 text-emerald-600 border-emerald-100', icon: 'shield-check' },
            REJECT:            { label: 'ตีกลับ/ส่งกลับแก้ไข',    class: 'bg-red-50 text-red-500 border-red-100', icon: 'undo-2' },
            DELETE:            { label: 'ลบ',                    class: 'bg-red-50 text-red-500 border-red-100', icon: 'trash-2' },
            RESTORE:           { label: 'กู้คืน',                 class: 'bg-teal-50 text-teal-600 border-teal-100', icon: 'rotate-ccw' },
            UPDATE_ROLE:       { label: 'เปลี่ยนสิทธิ์',           class: 'bg-indigo-50 text-indigo-600 border-indigo-100', icon: 'user-cog' },
            // ✅ ค่า Action ของ Claim ด้านล่างนี้ตรวจสอบกับ n8n workflow จริง (KTW-CLAIM-CUS-PRD.json) แล้ว
            //    ตรงกับ Code - Validate Claim Decision (logAction = decision) และ Insert Audit Log node ต่าง ๆ
            APPROVE:           { label: 'อนุมัติให้เคลม',    class: 'bg-emerald-50 text-emerald-600 border-emerald-100', icon: 'shield-check' },
            REJECT_BACK:       { label: 'ตีกลับให้แก้ไข',          class: 'bg-amber-50 text-amber-600 border-amber-100', icon: 'undo-2' },
            // 🆕 แทน REJECT_BACK (ของเก่ายังคงไว้เพื่อแสดงประวัติเดิม)
            REQUEST_DOCS:      { label: 'ขอเอกสารเพิ่มเติม',        class: 'bg-amber-50 text-amber-600 border-amber-100', icon: 'file-plus' },
            NOT_APPROVE:       { label: 'ไม่อนุมัติ',               class: 'bg-red-50 text-red-500 border-red-100', icon: 'x-circle' },
            CLOSE:             { label: 'ปิดงาน',                  class: 'bg-slate-100 text-slate-600 border-slate-200', icon: 'check-circle-2' },
            // 🆕 ใช้กับปุ่ม "สถานะ" (ถอยสถานะ - Admin) ในหน้า claim_form.html — ต้องสร้าง node ฝั่ง n8n เพิ่มก่อนถึงจะมี log นี้จริง
            // Borrow (BRW) — action ที่ BorrowLog บันทึก
            RETURN:            { label: 'รับคืนสินค้า',            class: 'bg-blue-50 text-blue-600 border-blue-100', icon: 'package-check' },
            EXTEND:            { label: 'ขยายกำหนดคืน',            class: 'bg-amber-50 text-amber-600 border-amber-100', icon: 'calendar-plus' },
            CANCEL:            { label: 'ยกเลิกเอกสาร',            class: 'bg-red-50 text-red-500 border-red-100', icon: 'ban' },
            ROLE_UPDATE:       { label: 'เปลี่ยน Role',            class: 'bg-indigo-50 text-indigo-600 border-indigo-100', icon: 'user-cog' },
            CLEAR_LOG:         { label: 'ล้าง log',                class: 'bg-slate-100 text-slate-600 border-slate-200', icon: 'eraser' },
            PERM_OVERRIDE:     { label: 'สิทธิ์เฉพาะคน',          class: 'bg-violet-50 text-violet-600 border-violet-100', icon: 'shield-check' },
            PERM_LEVEL:        { label: 'เปลี่ยนระดับ',            class: 'bg-indigo-50 text-indigo-600 border-indigo-100', icon: 'user-cog' },
            PERM_DEPT:         { label: 'เปลี่ยนแผนกของสิทธิ์',    class: 'bg-indigo-50 text-indigo-600 border-indigo-100', icon: 'user-cog' },
            PERM_CONVERT:      { label: 'แปลงจาก Role เดิม',       class: 'bg-slate-100 text-slate-600 border-slate-200', icon: 'repeat' },
            PERM_TEMPLATE:     { label: 'แก้เทมเพลตสิทธิ์',         class: 'bg-amber-50 text-amber-600 border-amber-100', icon: 'layout-template' },
            ADMIN_REVERT:      { label: 'Admin ถอยสถานะ',           class: 'bg-amber-50 text-amber-700 border-amber-100', icon: 'undo-2' }
        };

        window.onload = function() {
            if (typeof renderSidebar === 'function') {
                renderSidebar();
            }

            const mobileSidebarContainer = document.getElementById('mobile-sidebar-content');
            const sidebarContainer = document.getElementById('sidebar-container');
            if (mobileSidebarContainer && sidebarContainer) {
                mobileSidebarContainer.innerHTML = sidebarContainer.innerHTML;
            }
            lucide.createIcons();

            ensurePerm().then(() => {
                if (window.KTWPerm && window.KTWPerm.isReady() && !window.KTWPerm.can('PORTAL', 'MENU_HISTORY')) { window.location.href = 'main.html'; return; }
                if (typeof renderSidebar === 'function') renderSidebar();
                applyLogPermUI();
                initAuditLogData();
            });
        };

        function toggleMobileMenu() {
            const mobileSidebar = document.getElementById('mobile-sidebar');
            const menuIcon = document.getElementById('mobileMenuBtn');
            const isHidden = mobileSidebar.classList.contains('hidden');

            if (isHidden) {
                mobileSidebar.classList.remove('hidden');
                menuIcon.setAttribute('data-lucide', 'x');
            } else {
                mobileSidebar.classList.add('hidden');
                menuIcon.setAttribute('data-lucide', 'menu');
            }
            lucide.createIcons();
        }

        // ================= ดึงข้อมูล Log จาก n8n =================
        // แปลงข้อมูล log ของ Disassembly (DisassemblyDocLog) ให้อยู่ในรูปแบบเดียวกับ audit_log ของ SWAP
        // เพื่อให้ตาราง/ตัวกรอง/Modal รายละเอียดตัวเดียวกันใช้แสดงผลได้ทั้งคู่ ไม่ต้องแยกโค้ด render
        function normalizeDisassemblyLog(row) {
            const isRoleChange = row.Action === 'UPDATE_ROLE';
            return {
                log_id: null,
                actor_emp_id: row.ActionByEmpId || '',
                actor_name: row.ActionBy || '',
                actor_email: '', // ไม่มีในตาราง DisassemblyDocLog ต้นทาง
                module: isRoleChange ? 'DisassemblyEmployee' : 'DisassemblyDocument',
                action_type: row.Action,
                entity_id: row.DocId || row.TargetEmpId || '',
                description: row.Detail || '',
                // OldStatus/NewStatus เป็น text ธรรมดา (ไม่ใช่ JSON) ห่อเป็น object ง่ายๆ ให้ renderDiffTable แสดงได้
                old_value: row.OldStatus ? JSON.stringify({ สถานะ: row.OldStatus }) : null,
                new_value: row.NewStatus ? JSON.stringify({ สถานะ: row.NewStatus }) : null,
                log_time: row.ActionAt
            };
        }

        // แปลงข้อมูล log ของ NCR (NcrDocLog) ให้อยู่ในรูปแบบเดียวกับ audit_log ของ SWAP
        // ⚠️ NcrDocLog เพิ่งเพิ่มคอลัมน์ OldStatus/NewStatus ทีหลัง (เดิมไม่มี ต่างจาก DisassemblyDocLog)
        //    log แถวเก่าที่บันทึกไว้ก่อนเพิ่มคอลัมน์จะเป็น NULL ทั้งคู่ → ปล่อยเป็น null ตามเดิม
        //    ไม่ต้องใส่ค่า placeholder เพราะ renderDiffTable รับ null ได้อยู่แล้ว (แสดงเป็น "ไม่มีข้อมูล")
        // 🆕 29/09/2569 : เพิ่มการแยก log "จัดการพนักงาน (NCR)" ออกจาก log เอกสาร
        //    ต้องมี node ฝั่ง n8n insert แถว Action='UPDATE_ROLE' ลง NcrDocLog ก่อน (ดู claim_ncr_employee_history_guide.md)
        function normalizeNcrLog(row) {
            const isRoleChange = row.Action === 'UPDATE_ROLE';
            return {
                log_id: row.LogId || null,
                actor_emp_id: row.ActionByEmpId || '',
                actor_name: row.ActionBy || '',
                actor_email: '', // ไม่มีในตาราง NcrDocLog ต้นทาง
                module: isRoleChange ? 'NcrEmployee' : 'NcrDocument',
                action_type: row.Action,
                entity_id: row.DocId || row.TargetEmpId || '',
                description: row.Detail || '',
                // OldStatus/NewStatus เป็น text ธรรมดา (ไม่ใช่ JSON) ห่อเป็น object ง่ายๆ ให้ renderDiffTable แสดงได้
                // (รูปแบบเดียวกับ normalizeDisassemblyLog เป๊ะ เพื่อให้ตาราง/Modal ตัวเดียวกันแสดงได้ทั้งสองระบบ)
                old_value: row.OldStatus ? JSON.stringify({ สถานะ: row.OldStatus }) : null,
                new_value: row.NewStatus ? JSON.stringify({ สถานะ: row.NewStatus }) : null,
                log_time: row.ActionAt
            };
        }

        // แปลงข้อมูล log ของ Claim (ClaimDocLog) ให้อยู่ในรูปแบบเดียวกับ audit_log ของ SWAP
        // สคีมา ClaimDocLog: LogId, DocId, Action, OldStatus, NewStatus, Detail, ActionByName, ActionByEmpId, ActionAt
        // 🆕 29/09/2569 : เพิ่มการแยก log "จัดการพนักงาน (Claim)" ออกจาก log เอกสาร
        //    ต้องมี node ฝั่ง n8n insert แถว Action='UPDATE_ROLE' ลง ClaimDocLog ก่อน (ดู claim_ncr_employee_history_guide.md)
        // แปลงแถว perm.PermissionLog (จาก perm_history แบบ all:true) ให้เข้ารูปแบบเดียวกัน
        function normalizePermLog(row) {
            const target = `${row.EmpId || ''}${row.TargetName ? ' (' + row.TargetName + ')' : ''}`;
            const what = row.ActionKey ? `สิทธิ์ ${row.ActionKey}` : ({ LEVEL: 'ระดับ', DEPT: 'แผนก' }[row.Kind] || row.Kind);
            const ov = row.OldValue, nv = row.NewValue;
            return {
                log_id: row.LogId || null,
                actor_emp_id: row.ChangedByEmpId || '',
                actor_name: row.ChangedByName || (row.ChangedByEmpId ? '' : 'ระบบ'),
                actor_email: '',
                module: 'PermissionLog',
                action_type: 'PERM_' + String(row.Kind || '').toUpperCase(),
                entity_id: row.EmpId || '',
                description: `[${row.SystemKey}] ${what} ของพนักงาน ${target}: ${ov || '-'} → ${nv || '-'}${row.Note ? ' — ' + row.Note : ''}`,
                old_value: ov ? JSON.stringify({ ค่า: ov }) : null,
                new_value: nv ? JSON.stringify({ ค่า: nv }) : null,
                log_time: row.ChangedAt
            };
        }

        function normalizeClaimLog(row) {
            const isRoleChange = row.Action === 'UPDATE_ROLE';
            return {
                log_id: row.LogId || null,
                actor_emp_id: row.ActionByEmpId || '',
                actor_name: row.ActionByName || '',
                actor_email: '', // ไม่มีในตาราง ClaimDocLog ต้นทาง
                module: isRoleChange ? 'ClaimEmployee' : 'ClaimDocument',
                action_type: row.Action,
                entity_id: row.DocId || row.TargetEmpId || '',
                description: row.Detail || '',
                old_value: row.OldStatus ? JSON.stringify({ สถานะ: row.OldStatus }) : null,
                new_value: row.NewStatus ? JSON.stringify({ สถานะ: row.NewStatus }) : null,
                log_time: row.ActionAt
            };
        }

        // ยืม-คืนสินค้าหน้าร้าน (BorrowLog) ให้อยู่ในรูปแบบเดียวกับ log ระบบอื่น
        function normalizeBorrowLog(row) {
            return {
                log_id: row.logId || null, actor_emp_id: row.actorEmpId || '', actor_name: row.actorName || '', actor_email: '',
                module: row.action === 'ROLE_UPDATE' ? 'BorrowEmployee' : 'BorrowDocument', action_type: row.action, entity_id: row.docNo || '', description: row.detail || '',
                old_value: null, new_value: null, log_time: row.at
            };
        }

        async function initAuditLogData() {
            const tbody = document.getElementById('auditLogTableBody');
            const syncIcon = document.getElementById('syncIcon');
            showTableSkeleton();
            if (syncIcon) syncIcon.classList.add('animate-spin');

            let swapLogs = [];
            let disassemblyLogs = [];
            let ncrLogs = [];
            let claimLogs = [];
            let borrowLogs = [];
            let anyError = false;

            // โหลด log ของ SWAP (audit_log) — เฉพาะระบบที่มีสิทธิ์ดู log
            if (canViewLog('SWAP')) try {
                const response = await n8nFetch(AUDIT_LOG_WEBHOOK_URL, { method: 'GET' });
                if (!response.ok) throw new Error(`Server returned status: ${response.status}`);
                const rawText = await response.text();
                swapLogs = rawText && rawText.trim() !== '' ? JSON.parse(rawText) : [];
                if (!Array.isArray(swapLogs)) swapLogs = [];
            } catch (error) {
                anyError = true;
                console.error('SWAP audit log fetch error:', error);
            }

            // โหลด log ของ Disassembly (DisassemblyDocLog) แล้ว normalize ให้ตรงกับรูปแบบเดียวกัน
            if (canViewLog('DIS')) try {
                const response = await n8nFetch(DISASSEMBLY_LOG_WEBHOOK_URL, { method: 'GET' });
                if (!response.ok) throw new Error(`Server returned status: ${response.status}`);
                const data = await response.json();
                disassemblyLogs = Array.isArray(data) ? data.map(normalizeDisassemblyLog) : [];
            } catch (error) {
                anyError = true;
                console.error('Disassembly log fetch error:', error);
            }

            // โหลด log ของ NCR (NcrDocLog) แล้ว normalize ให้ตรงกับรูปแบบเดียวกัน
            if (canViewLog('NCR')) try {
                const response = await n8nFetch(NCR_LOG_WEBHOOK_URL, { method: 'GET' });
                if (!response.ok) throw new Error(`Server returned status: ${response.status}`);
                const data = await response.json();
                ncrLogs = Array.isArray(data) ? data.map(normalizeNcrLog) : [];
            } catch (error) {
                anyError = true;
                console.error('NCR log fetch error:', error);
            }

            // โหลด log ของ Claim (ClaimDocLog) แล้ว normalize ให้ตรงกับรูปแบบเดียวกัน
            // ⚠️ ใช้ res.text() + JSON.parse() แบบมีเงื่อนไขเสมอ (ไม่ใช้ res.json() ตรงๆ) กัน n8n ตอบ body ว่างตอน 0 แถว
            if (canViewLog('CLM')) try {
                const response = await n8nFetch(CLAIM_LOG_WEBHOOK_URL, { method: 'GET' });
                if (!response.ok) throw new Error(`Server returned status: ${response.status}`);
                const rawText = await response.text();
                const data = rawText && rawText.trim() !== '' ? JSON.parse(rawText) : [];
                claimLogs = Array.isArray(data) ? data.map(normalizeClaimLog) : [];
            } catch (error) {
                anyError = true;
                console.error('Claim log fetch error:', error);
            }

            // ยืม-คืนสินค้าหน้าร้าน (BorrowLog) — POST borrow_logs (n8n ตรวจ VIEW_LOG ซ้ำ)
            if (canViewLog('BRW')) try {
                const response = await n8nFetch('https://n8n.ktw.co.th/webhook/borrow_logs', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ actorEmpId: sessionStorage.getItem('emp_id') || '', limit: 1000 })
                });
                const rawText = await response.text();
                const j = rawText && rawText.trim() ? JSON.parse(rawText) : null;
                const o = Array.isArray(j) ? j[0] : j;
                if (o && o.success && Array.isArray(o.data)) borrowLogs = o.data.map(normalizeBorrowLog);
            } catch (error) { console.error('Borrow log fetch error:', error); }

            // ประวัติสิทธิ์รายข้อ — เฉพาะผู้มีสิทธิ์จัดการสิทธิ์ (ฝั่ง n8n ตรวจซ้ำ) ถ้าไม่มีสิทธิ์/โหลดไม่ได้ ข้ามเงียบๆ ไม่นับเป็น error
            let permLogs = [];
            if (!permReady() || window.KTWPerm.can('SWAP', 'MANAGE_PERMISSION')) try {
                const response = await n8nFetch('https://n8n.ktw.co.th/webhook/perm_history', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ actorEmpId: sessionStorage.getItem('emp_id') || '', all: true })
                });
                if (response.ok) {
                    const data = await response.json();
                    permLogs = data && data.success && Array.isArray(data.logs) ? data.logs.map(normalizePermLog) : [];
                }
            } catch (error) { console.warn('perm log fetch skipped:', error); }

            allLogs = [...swapLogs, ...disassemblyLogs, ...ncrLogs, ...claimLogs, ...borrowLogs, ...permLogs];

            if (anyError && allLogs.length === 0) {
                showNotification('โหลดข้อมูลไม่สำเร็จ', 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์เพื่อดึงประวัติการทำงานได้ กรุณาลองใหม่อีกครั้ง', 'error');
            } else if (anyError) {
                showNotification('โหลดข้อมูลบางส่วน', 'ระบบใดระบบหนึ่งโหลด log ไม่สำเร็จ ข้อมูลที่แสดงอาจไม่ครบทุกระบบ กด "ซิงค์ข้อมูลล่าสุด" อีกครั้งภายหลัง', 'warning');
            }

            currentPage = 1;
            calculateLogStatistics();
            renderAuditLogTable();
            if (syncIcon) syncIcon.classList.remove('animate-spin');
        }

        // ================= สถิติภาพรวม =================
        function calculateLogStatistics() {
            const total = allLogs.length;
            const docCount = allLogs.filter(l => l.module === 'SwapDocument' || l.module === 'DisassemblyDocument' || l.module === 'NcrDocument').length;
            const employeeCount = allLogs.filter(l => l.module === 'Employee' || l.module === 'DisassemblyEmployee').length;

            // ⚠️ ห้ามใช้ toISOString() เพราะแปลงเป็น UTC (ไทย -7 ชม.) ทำให้ช่วง 00:00-07:00 น. นับเป็นวันก่อนหน้า
            const now = new Date();
            const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
            const deleteTodayCount = allLogs.filter(l => {
                if (l.action_type !== 'DELETE') return false;
                const logDateStr = (l.log_time || '').slice(0, 10);
                return logDateStr === todayStr;
            }).length;

            document.getElementById('statTotal').textContent = total.toLocaleString('th-TH');
            document.getElementById('statSwapDoc').textContent = docCount.toLocaleString('th-TH');
            document.getElementById('statEmployee').textContent = employeeCount.toLocaleString('th-TH');
            document.getElementById('statDeleteToday').textContent = deleteTodayCount.toLocaleString('th-TH');
        }

        // ================= Skeleton Loading =================
        function showTableSkeleton() {
            const tbody = document.getElementById('auditLogTableBody');
            if (!tbody) return;
            let rows = '';
            for (let i = 0; i < 6; i++) {
                rows += `
                    <tr class="animate-pulse">
                        <td class="p-4"><div class="h-3 w-28 bg-slate-100 rounded"></div></td>
                        <td class="p-4"><div class="h-3 w-24 bg-slate-100 rounded"></div></td>
                        <td class="p-4"><div class="h-5 w-20 bg-slate-100 rounded-full"></div></td>
                        <td class="p-4"><div class="h-5 w-16 bg-slate-100 rounded-full"></div></td>
                        <td class="p-4"><div class="h-3 w-64 bg-slate-100 rounded"></div></td>
                        <td class="p-4"><div class="h-6 w-16 bg-slate-100 rounded mx-auto"></div></td>
                    </tr>`;
            }
            tbody.innerHTML = rows;
        }

        // ================= การพิมพ์ในช่องค้นหา =================
        function onLogSearchInput(value) {
            const clearBtn = document.getElementById('clearLogSearchBtn');
            if (value.trim() !== "") {
                clearBtn.classList.remove('hidden');
            } else {
                clearBtn.classList.add('hidden');
            }
            currentPage = 1;
            renderAuditLogTable();
        }

        function clearLogSearchInput() {
            const searchInput = document.getElementById('searchActor');
            searchInput.value = "";
            document.getElementById('clearLogSearchBtn').classList.add('hidden');
            currentPage = 1;
            renderAuditLogTable();
        }

        // ================= ตัวกรอง Module / Action Type / วันที่ =================
        function onLogFilterChange() {
            moduleFilter = document.getElementById('filterModule').value;
            actionTypeFilter = document.getElementById('filterActionType').value;
            dateFromFilter = document.getElementById('filterDateFrom').value;
            dateToFilter = document.getElementById('filterDateTo').value;
            currentPage = 1;
            renderAuditLogTable();
        }

        function resetLogFilters() {
            document.getElementById('searchActor').value = '';
            document.getElementById('clearLogSearchBtn').classList.add('hidden');
            document.getElementById('filterModule').value = 'all';
            document.getElementById('filterActionType').value = 'all';
            document.getElementById('filterDateFrom').value = '';
            document.getElementById('filterDateTo').value = '';

            moduleFilter = 'all';
            actionTypeFilter = 'all';
            dateFromFilter = '';
            dateToFilter = '';
            sortColumn = 'log_time';
            sortDirection = 'desc';
            currentPage = 1;

            renderAuditLogTable();
        }

        // ================= Sort =================
        function setLogSortColumn(key) {
            if (sortColumn === key) {
                sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
            } else {
                sortColumn = key;
                sortDirection = 'asc';
            }
            currentPage = 1;
            renderAuditLogTable();
        }

        function updateLogSortHeaderIcons() {
            const icon = document.getElementById('sort-icon-log_time');
            if (!icon) return;
            if (sortColumn === 'log_time') {
                icon.setAttribute('data-lucide', sortDirection === 'asc' ? 'chevron-up' : 'chevron-down');
                icon.className = 'w-3 h-3 text-brand-600';
            } else {
                icon.setAttribute('data-lucide', 'chevrons-up-down');
                icon.className = 'w-3 h-3 text-slate-300';
            }
        }

        // ================= Pagination =================
        function onLogPageSizeChange(value) {
            pageSize = parseInt(value, 10) || 25;
            currentPage = 1;
            renderAuditLogTable();
        }

        function goToLogPage(page) {
            currentPage = page;
            renderAuditLogTable();
            const tableSection = document.getElementById('auditLogTableBody');
            if (tableSection) {
                tableSection.closest('.rounded-xl')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }

        function renderPaginationControls(totalItems, totalPages) {
            const infoText = document.getElementById('paginationInfoText');
            const controls = document.getElementById('paginationControls');
            if (!infoText || !controls) return;

            if (totalItems === 0) {
                infoText.textContent = 'ไม่พบรายการ';
                controls.innerHTML = '';
                return;
            }

            const startItem = (currentPage - 1) * pageSize + 1;
            const endItem = Math.min(currentPage * pageSize, totalItems);
            infoText.textContent = `แสดง ${startItem}-${endItem} จาก ${totalItems} รายการ`;

            if (totalPages <= 1) {
                controls.innerHTML = '';
                return;
            }

            const btnBase = "h-7 min-w-7 px-2 rounded-lg text-[11px] font-semibold transition-all inline-flex items-center justify-center";
            const btnInactive = `${btnBase} border border-slate-200 text-slate-600 hover:bg-slate-50`;
            const btnActive = `${btnBase} bg-slate-900 text-white`;
            const btnDisabled = `${btnBase} border border-slate-100 text-slate-300 cursor-not-allowed`;

            let html = '';
            html += currentPage === 1
                ? `<span class="${btnDisabled}"><i data-lucide="chevron-left" class="w-3.5 h-3.5"></i></span>`
                : `<button onclick="goToLogPage(${currentPage - 1})" class="${btnInactive}"><i data-lucide="chevron-left" class="w-3.5 h-3.5"></i></button>`;

            const pagesToShow = new Set([1, totalPages, currentPage, currentPage - 1, currentPage + 1]);
            const sortedPages = [...pagesToShow].filter(p => p >= 1 && p <= totalPages).sort((a, b) => a - b);

            let lastPage = 0;
            sortedPages.forEach(p => {
                if (lastPage && p - lastPage > 1) {
                    html += `<span class="h-7 min-w-7 px-1 inline-flex items-center justify-center text-[11px] text-slate-400">...</span>`;
                }
                html += p === currentPage
                    ? `<span class="${btnActive}">${p}</span>`
                    : `<button onclick="goToLogPage(${p})" class="${btnInactive}">${p}</button>`;
                lastPage = p;
            });

            html += currentPage === totalPages
                ? `<span class="${btnDisabled}"><i data-lucide="chevron-right" class="w-3.5 h-3.5"></i></span>`
                : `<button onclick="goToLogPage(${currentPage + 1})" class="${btnInactive}"><i data-lucide="chevron-right" class="w-3.5 h-3.5"></i></button>`;

            controls.innerHTML = html;
            lucide.createIcons();
        }

        // ================= เรนเดอร์ตารางหลัก =================
        // สร้างปุ่ม "กู้คืน" สำหรับแถวที่เป็นเอกสารถูกลบ (module มีอยู่ใน RESTORE_CONFIG และ action_type = DELETE)
        function restoreButtonHTML(log) {
            const restoreCfg = RESTORE_CONFIG[log.module];
            if (!restoreCfg || log.action_type !== 'DELETE') return '';
            if (!canRestoreModule(restoreCfg)) return '';
            if (!isLatestDeleteRow(log)) return '';
            const entityId = escapeHtml(log.entity_id || '');
            return `
                <button
                    onclick="restoreDocumentGeneric('${log.module}', '${entityId}')"
                    class="inline-flex items-center gap-1 h-8 px-3 rounded-lg text-[11px] font-semibold bg-white border border-teal-200 hover:bg-teal-50 text-teal-600 transition-colors whitespace-nowrap"
                    title="กู้คืนเอกสารนี้"
                >
                    <i data-lucide="rotate-ccw" class="w-3 h-3"></i>
                    กู้คืน
                </button>
            `;
        }

        // กู้คืนเอกสารที่ถูก soft-delete ของระบบที่ระบุ (module เดียวกับที่ใช้ใน MODULE_CONFIG/RESTORE_CONFIG)
        async function restoreDocumentGeneric(moduleKey, entityId) {
            const restoreCfg = RESTORE_CONFIG[moduleKey];
            if (!restoreCfg) return;
            if (!confirm(`ยืนยันกู้คืนเอกสาร ${entityId} กลับมาใช้งาน?`)) return;

            const payload = { [restoreCfg.idField]: entityId };
            // ใส่ทั้งชื่อ field แบบเก่า/ใหม่กันปัญหาไม่ตรงกันระหว่าง 2 workflow (Disassembly ใช้ restoredByEmpId/restoredByName, SWAP ใช้ actorEmpId/actorName)
            payload.docId = entityId;
            payload.documentId = entityId;
            payload.restoredByEmpId = sessionStorage.getItem('emp_id') || '';
            payload.restoredByName = sessionStorage.getItem('name') || 'Admin';
            payload.actorEmpId = sessionStorage.getItem('emp_id') || '';
            payload.actorName = sessionStorage.getItem('name') || 'Admin';
            payload.actorEmail = sessionStorage.getItem('email') || '';
            if (restoreCfg.extra) Object.assign(payload, restoreCfg.extra);

            try {
                const res = await n8nFetch(`https://n8n.ktw.co.th/webhook/${restoreCfg.endpoint}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const result = await res.json().catch(() => ({}));
                if (!res.ok || result.success === false) {
                    throw new Error(result.error || 'กู้คืนไม่สำเร็จ');
                }
                showNotification('กู้คืนสำเร็จ', `กู้คืนเอกสาร ${entityId} เรียบร้อยแล้ว`, 'success');
                initAuditLogData();
            } catch (err) {
                showNotification('กู้คืนไม่สำเร็จ', err.message || 'เกิดข้อผิดพลาดไม่ทราบสาเหตุ', 'error');
            }
        }

        function renderAuditLogTable() {
            const tbody = document.getElementById('auditLogTableBody');
            if (!tbody) return;

            const searchKeyword = (document.getElementById('searchActor')?.value || '').trim().toLowerCase();

            let filteredList = allLogs.filter(log => {
                const matchKeyword = !searchKeyword ||
                    (log.actor_name || '').toLowerCase().includes(searchKeyword) ||
                    (log.entity_id || '').toLowerCase().includes(searchKeyword) ||
                    (log.description || '').toLowerCase().includes(searchKeyword) ||
                    (log.actor_email || '').toLowerCase().includes(searchKeyword);

                const matchModule = moduleFilter === 'all' || log.module === moduleFilter;
                const matchAction = actionTypeFilter === 'all' || log.action_type === actionTypeFilter;

                const logDateStr = (log.log_time || '').slice(0, 10);
                const matchDateFrom = !dateFromFilter || logDateStr >= dateFromFilter;
                const matchDateTo = !dateToFilter || logDateStr <= dateToFilter;

                return matchKeyword && matchModule && matchAction && matchDateFrom && matchDateTo;
            });

            // เรียงลำดับ (ค่าเริ่มต้น: วันเวลาล่าสุดก่อน)
            filteredList = [...filteredList].sort((a, b) => {
                const valA = a[sortColumn] || '';
                const valB = b[sortColumn] || '';
                if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
                if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
                return 0;
            });

            if (filteredList.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="6" class="p-8 text-center text-slate-400">
                            <div class="h-12 w-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-3 border border-slate-200">
                                <i data-lucide="history" class="w-6 h-6 text-slate-400"></i>
                            </div>
                            <p class="text-xs font-semibold text-slate-700">ไม่พบประวัติการทำงานตามตัวกรองนี้</p>
                            <p class="text-[10px] text-slate-400 mt-1">กรุณาลองเปลี่ยนคำค้นหาหรือตัวกรองด้านบน</p>
                        </td>
                    </tr>
                `;
                renderPaginationControls(0, 0);
                updateLogSortHeaderIcons();
                lucide.createIcons();
                return;
            }

            const totalItems = filteredList.length;
            const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
            if (currentPage > totalPages) currentPage = totalPages;
            if (currentPage < 1) currentPage = 1;

            const startIndex = (currentPage - 1) * pageSize;
            const pagedList = filteredList.slice(startIndex, startIndex + pageSize);

            tbody.innerHTML = pagedList.map((log, idx) => {
                const globalIndex = startIndex + idx;
                const moduleCfg = MODULE_CONFIG[log.module] || { label: log.module || '-', class: 'bg-slate-50 text-slate-500 border-slate-100', icon: 'circle' };
                const actionCfg = ACTION_CONFIG[log.action_type] || { label: log.action_type || '-', class: 'bg-slate-50 text-slate-500 border-slate-100', icon: 'circle' };

                return `
                    <tr class="hover:bg-slate-50/70 transition-colors">
                        <td class="p-4 text-slate-500 font-mono">${formatLogDateTime(log.log_time)}</td>
                        <td class="p-4">
                            <p class="font-semibold text-slate-800">${escapeHtml(log.actor_name || 'ไม่ทราบผู้ทำรายการ')}</p>
                            <p class="text-[10px] text-slate-400 font-mono">${escapeHtml(log.actor_emp_id || '-')}</p>
                        </td>
                        <td class="p-4">
                            <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] font-semibold ${moduleCfg.class}">
                                <i data-lucide="${moduleCfg.icon}" class="w-3 h-3"></i>
                                ${moduleCfg.label}
                            </span>
                        </td>
                        <td class="p-4">
                            <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] font-semibold ${actionCfg.class}">
                                <i data-lucide="${actionCfg.icon}" class="w-3 h-3"></i>
                                ${actionCfg.label}
                            </span>
                        </td>
                        <td class="p-4 text-slate-600">${descriptionWithDocId(log)}</td>
                        <td class="p-4 text-center">
                            <div class="flex items-center justify-center gap-1.5">
                                <button
                                    onclick="openLogDetailModal(${globalIndex})"
                                    data-log-list-index="${globalIndex}"
                                    class="inline-flex items-center gap-1 h-8 px-3 rounded-lg text-[11px] font-semibold bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 transition-colors whitespace-nowrap"
                                >
                                    <i data-lucide="eye" class="w-3 h-3"></i>
                                    ดูเพิ่มเติม
                                </button>
                                ${restoreButtonHTML(log)}
                            </div>
                        </td>
                    </tr>
                `;
            }).join('');

            // เก็บ reference ของรายการที่กำลังแสดงผลไว้ใช้ตอนเปิด Modal (อ้างอิงจาก index ในลิสต์ที่กรอง/เรียงแล้ว)
            window.__currentFilteredLogs = filteredList;

            renderPaginationControls(totalItems, totalPages);
            updateLogSortHeaderIcons();
            lucide.createIcons();
        }

        // ================= Modal รายละเอียด (Before/After Diff) =================
        function openLogDetailModal(index) {
            const log = (window.__currentFilteredLogs || [])[index];
            if (!log) return;

            const moduleCfg = MODULE_CONFIG[log.module] || { label: log.module || '-' };
            const actionCfg = ACTION_CONFIG[log.action_type] || { label: log.action_type || '-' };

            document.getElementById('logDetailSubtitle').textContent =
                `${moduleCfg.label} · ${actionCfg.label} · ${formatLogDateTime(log.log_time)} · โดย ${log.actor_name || 'ไม่ทราบผู้ทำรายการ'}`;

            const oldObj = safeParseJson(log.old_value);
            const newObj = safeParseJson(log.new_value);

            const body = document.getElementById('logDetailBody');
            let html = '';

            // สรุปข้อมูลผู้ทำรายการ
            html += `
                <div class="grid grid-cols-2 gap-3 sm:grid-cols-4 text-xs">
                    <div class="bg-slate-50 rounded-xl p-3">
                        <p class="text-[10px] font-semibold text-slate-400 uppercase mb-1">รหัสผู้ทำรายการ</p>
                        <p class="font-mono font-semibold text-slate-800">${escapeHtml(log.actor_emp_id || '-')}</p>
                    </div>
                    <div class="bg-slate-50 rounded-xl p-3">
                        <p class="text-[10px] font-semibold text-slate-400 uppercase mb-1">อีเมล</p>
                        <p class="font-semibold text-slate-800 truncate">${escapeHtml(log.actor_email || '-')}</p>
                    </div>
                    <div class="bg-slate-50 rounded-xl p-3">
                        <p class="text-[10px] font-semibold text-slate-400 uppercase mb-1">รหัสอ้างอิง</p>
                        <p class="font-mono font-semibold text-slate-800">${escapeHtml(log.entity_id || '-')}</p>
                    </div>
                    <div class="bg-slate-50 rounded-xl p-3">
                        <p class="text-[10px] font-semibold text-slate-400 uppercase mb-1">Log ID</p>
                        <p class="font-mono font-semibold text-slate-800">${escapeHtml(String(log.log_id ?? '-'))}</p>
                    </div>
                </div>
            `;

            if (!oldObj && !newObj) {
                html += `
                    <div class="text-center py-10 text-slate-400">
                        <i data-lucide="file-x" class="w-8 h-8 mx-auto mb-2"></i>
                        <p class="text-xs">ไม่มีข้อมูลรายละเอียดเพิ่มเติมสำหรับรายการนี้</p>
                    </div>
                `;
            } else {
                html += renderDiffTable(oldObj, newObj, log.action_type);
            }

            body.innerHTML = html;
            openModal('logDetailModal', 'logDetailModalContent');
            lucide.createIcons();
        }

        function closeLogDetailModal() {
            closeModal('logDetailModal', 'logDetailModalContent');
        }

        // แปลง JSON string เป็น object อย่างปลอดภัย (คืนค่า null ถ้า parse ไม่ผ่านหรือเป็นค่าว่าง)
        function safeParseJson(str) {
            if (!str || str === 'NULL' || str === 'null') return null;
            try {
                const parsed = typeof str === 'string' ? JSON.parse(str) : str;
                return (parsed && typeof parsed === 'object') ? parsed : null;
            } catch (e) {
                return null;
            }
        }

        // แปลง object ที่อาจซ้อนกันหลายชั้น (เช่น {header:{...}, items:[{...}]}) ให้แบนราบเป็น key:value เดียว
        // ใช้ dot-notation สำหรับ object ซ้อน และ [index] สำหรับ array กันชนกันของ key ระหว่างหลายส่วนงาน
        function flattenObject(obj, prefix = '') {
            let result = {};
            if (obj === null || obj === undefined) return result;

            Object.keys(obj).forEach(key => {
                const value = obj[key];
                const newKey = prefix ? `${prefix}.${key}` : key;

                if (Array.isArray(value)) {
                    if (value.length === 0) {
                        result[newKey] = '(ไม่มีรายการ)';
                    } else {
                        value.forEach((item, idx) => {
                            if (item && typeof item === 'object') {
                                Object.assign(result, flattenObject(item, `${newKey}[${idx + 1}]`));
                            } else {
                                result[`${newKey}[${idx + 1}]`] = item;
                            }
                        });
                    }
                } else if (value && typeof value === 'object') {
                    Object.assign(result, flattenObject(value, newKey));
                } else {
                    result[newKey] = value;
                }
            });

            return result;
        }

        // สร้างตาราง Before/After เปรียบเทียบความแตกต่างระหว่าง old_value กับ new_value
        function renderDiffTable(oldObj, newObj, actionType) {
            const flatOld = flattenObject(oldObj);
            const flatNew = flattenObject(newObj);
            const allKeys = [...new Set([...Object.keys(flatOld), ...Object.keys(flatNew)])];

            if (allKeys.length === 0) {
                return `<div class="text-center py-6 text-slate-400 text-xs">ไม่มีข้อมูลให้เปรียบเทียบ</div>`;
            }

            // ถ้า CREATE (ไม่มี old) หรือ DELETE (ไม่มี new) ให้แสดงแบบสรุปรายการเดียว ไม่ต้องขึ้นคอลัมน์คู่เทียบ
            const singleColumnMode = !oldObj || !newObj;

            let rows = allKeys.map(key => {
                const oldVal = flatOld[key];
                const newVal = flatNew[key];
                const hasChanged = !singleColumnMode && String(oldVal ?? '') !== String(newVal ?? '');
                const displayVal = singleColumnMode ? (newObj ? newVal : oldVal) : null;

                if (singleColumnMode) {
                    return `
                        <tr class="border-b border-slate-100 last:border-0">
                            <td class="py-2 pr-4 text-slate-400 font-medium align-top w-1/3">${escapeHtml(key)}</td>
                            <td class="py-2 text-slate-800">${escapeHtml(formatDiffValue(displayVal))}</td>
                        </tr>
                    `;
                }

                return `
                    <tr class="border-b border-slate-100 last:border-0 ${hasChanged ? 'diff-changed' : ''}">
                        <td class="py-2 pr-4 text-slate-400 font-medium align-top w-1/4">${escapeHtml(key)}</td>
                        <td class="py-2 pr-4 align-top ${hasChanged ? 'text-red-500 line-through decoration-red-300' : 'text-slate-500'}">${escapeHtml(formatDiffValue(oldVal))}</td>
                        <td class="py-2 align-top ${hasChanged ? 'text-emerald-600 font-semibold' : 'text-slate-500'}">${escapeHtml(formatDiffValue(newVal))}</td>
                    </tr>
                `;
            }).join('');

            if (singleColumnMode) {
                return `
                    <div>
                        <p class="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">
                            ${newObj ? 'ข้อมูลที่ถูกสร้าง' : 'ข้อมูลก่อนถูกลบ'}
                        </p>
                        <table class="w-full text-xs">
                            <tbody>${rows}</tbody>
                        </table>
                    </div>
                `;
            }

            return `
                <div>
                    <p class="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">เปรียบเทียบข้อมูลก่อน-หลัง (แถบสีส้ม = มีการเปลี่ยนแปลง)</p>
                    <table class="w-full text-xs">
                        <thead>
                            <tr class="text-[10px] font-semibold text-slate-400 uppercase">
                                <td class="pb-2 w-1/4">ฟิลด์ข้อมูล</td>
                                <td class="pb-2 w-3/8">ก่อนแก้ไข</td>
                                <td class="pb-2 w-3/8">หลังแก้ไข</td>
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
            `;
        }

        function formatDiffValue(val) {
            if (val === undefined || val === null || val === '') return '—';
            return String(val);
        }

        // ================= Modal ทั่วไป (เปิด/ปิด พร้อม transition) =================
        function openModal(modalId, contentId) {
            const modal = document.getElementById(modalId);
            const content = document.getElementById(contentId);
            modal.classList.remove('hidden');
            requestAnimationFrame(() => {
                content.classList.remove('scale-95', 'opacity-0');
                content.classList.add('scale-100', 'opacity-100');
            });
            document.body.style.overflow = 'hidden';
        }

        function closeModal(modalId, contentId) {
            const modal = document.getElementById(modalId);
            const content = document.getElementById(contentId);
            content.classList.remove('scale-100', 'opacity-100');
            content.classList.add('scale-95', 'opacity-0');
            document.body.style.overflow = '';
            setTimeout(() => {
                modal.classList.add('hidden');
            }, 200);
        }

        // ================= Utilities =================
        // ⚠️ SQL Server เก็บเวลาไทยอยู่แล้ว (GETDATE()) แต่ n8n ส่งกลับมาพร้อม 'Z' ต่อท้าย
        //    ทำให้ browser เข้าใจว่าเป็น UTC แล้วบวก +7 ให้อีกรอบ เวลาที่แสดงจึงเพี้ยนไป 7 ชั่วโมง
        //    จึงต้องอ่านตัวเลขจาก string ตรงๆ ไม่ผ่าน Date object เพื่อไม่ให้มีการแปลง timezone เลย
        function parseLogTimeParts(isoStr) {
            const m = String(isoStr || '').match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
            if (!m) return null;
            return {
                yyyy: m[1], mm: m[2], dd: m[3],
                hh: m[4], min: m[5], ss: m[6] || '00'
            };
        }

        function formatLogDateTime(isoStr) {
            if (!isoStr) return '-';
            const p = parseLogTimeParts(isoStr);
            if (p) {
                return `${p.dd}/${p.mm}/${Number(p.yyyy) + 543} ${p.hh}:${p.min}`;
            }
            // Fallback กรณีรูปแบบไม่ตรงที่คาดไว้
            const dt = new Date(isoStr);
            if (isNaN(dt)) return isoStr;
            const dd = String(dt.getDate()).padStart(2, '0');
            const mm = String(dt.getMonth() + 1).padStart(2, '0');
            const yyyy = dt.getFullYear() + 543;
            const hh = String(dt.getHours()).padStart(2, '0');
            const min = String(dt.getMinutes()).padStart(2, '0');
            return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
        }

        function escapeHtml(str) {
            const div = document.createElement('div');
            div.textContent = str;
            return div.innerHTML;
        }

        // ระบบกล่องแสดงผล Toast Notification
        // ================= ล้าง Log เก่า (ใช้ข้อมูลที่โหลดมาแล้วในเครื่อง คำนวณ preview โดยไม่ยิง webhook ใหม่) =================
        function openClearLogsModal() {
            document.getElementById('clearBeforeDate').value = '';
            document.getElementById('clearLogsPreview').classList.add('hidden');
            document.getElementById('previewClearBtn').classList.remove('hidden');
            document.getElementById('confirmClearBtn').classList.add('hidden');
            document.getElementById('clearLogsModal').classList.remove('hidden');
        }

        function closeClearLogsModal() {
            document.getElementById('clearLogsModal').classList.add('hidden');
        }

        function previewClearLogs() {
            const beforeDate = document.getElementById('clearBeforeDate').value;
            if (!beforeDate) { showNotification('ข้อมูลไม่ครบ', 'กรุณาเลือกวันที่ก่อน', 'error'); return; }

            const previewBox = document.getElementById('clearLogsPreview');
            previewBox.classList.remove('hidden');

            // ⚠️ เทียบเป็น string ตรงๆ ไม่แปลงผ่าน Date object เพราะ log_time มี 'Z' ต่อท้าย
            //    ถ้าใช้ new Date() เทียบ จะคลาดเคลื่อน 7 ชม. ทำให้จำนวนที่ preview ไม่ตรงกับที่ backend ลบจริง
            //    (backend ใช้ WHERE log_time < 'YYYY-MM-DDT00:00:00' เทียบ string เหมือนกัน)
            const clearable = LOG_SYSTEMS.filter(x => canClearLog(x.key));
            const clearableMods = new Set(clearable.flatMap(x => x.modules));
            const count = allLogs.filter(l => {
                if (!clearableMods.has(l.module)) return false;
                const p = parseLogTimeParts(l.log_time);
                if (!p) return false;
                return `${p.yyyy}-${p.mm}-${p.dd}` < beforeDate;
            }).length;

            if (count === 0) {
                previewBox.textContent = `ไม่พบ log ก่อนวันที่ ${beforeDate} เลย`;
                document.getElementById('confirmClearBtn').classList.add('hidden');
            } else {
                previewBox.textContent = `พบ ${count} รายการ log ก่อนวันที่ ${beforeDate} (เฉพาะระบบที่คุณมีสิทธิ์ล้าง: ${clearable.map(x => x.name).join(', ')}) — กด "ยืนยันลบถาวร" เพื่อดำเนินการ (กู้คืนไม่ได้)`;
                document.getElementById('confirmClearBtn').classList.remove('hidden');
            }
        }

        // ⚠️ ปัจจุบันมี webhook ลบ log เก่าแบบถาวรอยู่แล้วแค่ฝั่ง Disassembly (clear_old_logs_disassembly)
        // ฝั่ง SWAP (audit_log) ยังไม่มี endpoint แบบเดียวกัน — ถ้าต้องการให้ล้าง log เก่าได้ครบทั้ง 2 ระบบจริง
        // ต้องสร้าง n8n workflow ใหม่สำหรับ DELETE FROM [KTW-SWAP].[dbo].[audit_log] WHERE log_time < @beforeDate ก่อน
        async function confirmClearLogs() {
            const beforeDate = document.getElementById('clearBeforeDate').value;
            const targets = LOG_SYSTEMS.filter(x => canClearLog(x.key));
            if (!targets.length) { showNotification('ไม่มีสิทธิ์', 'คุณไม่มีสิทธิ์ล้าง log ของระบบใดเลย', 'error'); return; }
            if (!confirm(`ยืนยันลบ log ก่อนวันที่ ${beforeDate} แบบถาวร ของระบบ: ${targets.map(x => x.name).join(', ')}? การกระทำนี้ไม่สามารถย้อนกลับได้`)) return;

            const payload = {
                beforeDate: beforeDate,
                clearedByEmpId: sessionStorage.getItem('emp_id') || '',
                clearedByName: sessionStorage.getItem('name') || 'Admin'
            };

            let totalDeleted = 0;
            let hadError = false;
            const failed = [];

            // ล้างทีละระบบ เฉพาะระบบที่มีสิทธิ์ล้าง (ฝั่ง n8n ตรวจสิทธิ์ CLEAR_LOG ของแต่ละระบบซ้ำอีกชั้น)
            for (const sys of targets) {
                try {
                    const res = await n8nFetch('https://n8n.ktw.co.th/webhook/' + sys.clearEndpoint, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                    const result = await res.json().catch(() => ({}));
                    if (res.ok && result.success !== false) {
                        totalDeleted += result.DeletedCount ?? 0;
                    } else {
                        hadError = true; failed.push(sys.name);
                    }
                } catch (err) {
                    hadError = true; failed.push(sys.name);
                    console.error('ล้าง log ' + sys.name + ' ไม่สำเร็จ:', err);
                }
            }

            if (hadError && totalDeleted === 0) {
                showNotification('ล้าง Log ไม่สำเร็จ', 'ไม่สามารถลบ log เก่าได้ กรุณาลองใหม่ภายหลัง', 'error');
            } else {
                showNotification(hadError ? 'ล้าง Log สำเร็จบางระบบ' : 'ล้าง Log สำเร็จ', `ลบไปทั้งหมด ${totalDeleted} รายการ${hadError ? ' — ไม่สำเร็จ: ' + failed.join(', ') : ''}`, hadError ? 'warning' : 'success');
                closeClearLogsModal();
                initAuditLogData();
            }
        }


        function showNotification(title, message, type = 'success') {
            const container = document.getElementById('toast-container');
            if (!container) return;

            const toast = document.createElement('div');
            toast.className = `transform translate-y-2 opacity-0 transition-all duration-300 pointer-events-auto flex items-start gap-3 bg-white border border-slate-200 rounded-2xl p-4 shadow-xl max-w-sm border-l-4 ${
                type === 'success' ? 'border-l-emerald-500' : type === 'warning' ? 'border-l-amber-500' : 'border-l-red-500'
            }`;

            let icon = 'check-circle';
            let iconColor = 'text-emerald-500';
            if (type === 'warning') {
                icon = 'alert-triangle';
                iconColor = 'text-amber-500';
            } else if (type === 'error') {
                icon = 'alert-circle';
                iconColor = 'text-red-500';
            }

            toast.innerHTML = `
                <div class="mt-0.5 ${iconColor}">
                    <i data-lucide="${icon}" class="w-5 h-5"></i>
                </div>
                <div class="flex-1">
                    <h4 class="text-sm font-semibold text-slate-900">${title}</h4>
                    <p class="text-xs text-slate-500 mt-1 leading-relaxed">${message}</p>
                </div>
                <button type="button" onclick="this.parentElement.remove()" class="text-slate-400 hover:text-slate-600 transition-colors">
                    <i data-lucide="x" class="w-4 h-4"></i>
                </button>
            `;

            container.appendChild(toast);
            lucide.createIcons();

            setTimeout(() => {
                toast.classList.remove('translate-y-2', 'opacity-0');
            }, 10);

            setTimeout(() => {
                toast.classList.add('translate-y-2', 'opacity-0');
                setTimeout(() => toast.remove(), 300);
            }, 5000);
        }
