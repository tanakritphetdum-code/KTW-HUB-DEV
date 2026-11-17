// ===================================================================
// modules/approveService.js — Service Logic สำหรับ KTW HUB
// ===================================================================

        const N8N_BASE = 'https://n8n.ktw.co.th/webhook/';
        const empId = sessionStorage.getItem('emp_id') || '';
        const empName = sessionStorage.getItem('name') || '';
        const empEmail = sessionStorage.getItem('email') || '';

        // ดึงบทบาทจริงของระบบย่อย โดยรองรับกรณี Global Admin (emp_type === '1') ให้มีสิทธิ์เต็มเสมอ
        function getEffectiveRole(sessionRoleKey) {
            const isGlobalAdmin = (sessionStorage.getItem('emp_type') === '1');
            const val = sessionStorage.getItem(sessionRoleKey);
            if (val && val !== '0') return String(val);
            if (isGlobalAdmin) return '1';
            return val || '0';
        }

        // ตรวจสอบและดึงบทบาทสิทธิ์ของทุกระบบย่อยก่อนเรนเดอร์คิวอนุมัติ
        async function ensureRolesLoaded() {
            const currentEmp = sessionStorage.getItem('emp_id');
            const isGlobalAdmin = (sessionStorage.getItem('emp_type') === '1');

            if (isGlobalAdmin) {
                if (!sessionStorage.getItem('disassembly_role') || sessionStorage.getItem('disassembly_role') === '0') sessionStorage.setItem('disassembly_role', '1');
                if (!sessionStorage.getItem('ncr_role') || sessionStorage.getItem('ncr_role') === '0') sessionStorage.setItem('ncr_role', '1');
                if (!sessionStorage.getItem('claim_role') || sessionStorage.getItem('claim_role') === '0') sessionStorage.setItem('claim_role', '1');
                if (!sessionStorage.getItem('borrow_role') || sessionStorage.getItem('borrow_role') === '0') sessionStorage.setItem('borrow_role', '1');
            }

            if (!currentEmp) return;

            const ROLE_FETCHERS = [
                { key: 'disassembly_role', endpoint: 'get_disassembly_role' },
                { key: 'ncr_role', endpoint: 'get_ncr_role' },
                { key: 'claim_role', endpoint: 'get_role_claim_cus' }
            ];

            await Promise.all(ROLE_FETCHERS.map(async item => {
                try {
                    const res = await window.n8nFetch(`${item.endpoint}?empId=${encodeURIComponent(currentEmp)}`);
                    if (res.ok) {
                        const txt = await res.text();
                        if (txt && txt.trim()) {
                            const j = JSON.parse(txt);
                            const row = Array.isArray(j) ? (j[0] || {}) : j;
                            if (row.RoleId != null || row.role != null) {
                                sessionStorage.setItem(item.key, String(row.RoleId ?? row.role));
                            }
                        }
                    }
                } catch (e) {
                    console.warn(`โหลดสิทธิ์ ${item.key} ไม่สำเร็จ:`, e);
                }
            }));
        }

        // สีของแต่ละ stage (ใช้ทั้งจุด/แถบซ้าย/badge) — กำหนดตายตัวไว้ให้ Tailwind CDN สแกน class เจอครบ
        const ACCENT_MAP = {
            amber:   { dot: 'bg-amber-500',   border: 'border-amber-500',   badgeBg: 'bg-amber-50',   badgeText: 'text-amber-700',   badgeBorder: 'border-amber-200' },
            orange:  { dot: 'bg-orange-500',  border: 'border-orange-500',  badgeBg: 'bg-orange-50',  badgeText: 'text-orange-700',  badgeBorder: 'border-orange-200' },
            emerald: { dot: 'bg-emerald-500', border: 'border-emerald-500', badgeBg: 'bg-emerald-50', badgeText: 'text-emerald-700', badgeBorder: 'border-emerald-200' },
            blue:    { dot: 'bg-blue-500',    border: 'border-blue-500',    badgeBg: 'bg-blue-50',    badgeText: 'text-blue-700',    badgeBorder: 'border-blue-200' },
            indigo:  { dot: 'bg-indigo-500',  border: 'border-indigo-500',  badgeBg: 'bg-indigo-50',  badgeText: 'text-indigo-700',  badgeBorder: 'border-indigo-200' },
            rose:    { dot: 'bg-rose-500',    border: 'border-rose-500',    badgeBg: 'bg-rose-50',    badgeText: 'text-rose-700',    badgeBorder: 'border-rose-200' }
        };

        const APPROVAL_MODULES = [
            {
                key: 'disassembly',
                label: 'ระบบขอแกะอะไหล่ (Disassembly System)',
                description: 'การขออนุมัติถอดอะไหล่เพื่อจัดจำหน่ายหรือใช้เป็นอะไหล่บริการ',
                icon: 'wrench',
                themeColor: 'amber',
                sessionRoleKey: 'disassembly_role',
                queueEndpoint: 'get_pending_queue_disassembly',
                detailEndpoint: 'get_document_detail_disassembly',
                detailPayloadKey: 'docId',
                getDocId: d => d.DocId,
                isCancelled: d => d.Status === 'ยกเลิก' || d.IsDeleted === true || d.IsDeleted === 1,
                getItems: doc => doc.items || [],
                itemColumns: [
                    { label: 'Brand', render: i => i.Brand || '-' },
                    { label: 'KT Code ตัวเครื่อง', render: i => i.MachineCode || '-' },
                    { label: 'KT Code อะไหล่', render: i => i.PartCode },
                    { label: 'Description', render: i => i.PartDescription || '-' },
                    { label: 'Qty', render: i => i.Qty },
                    { label: 'PO', render: i => i.HasPO ? 'มี PO' : 'ไม่มี PO' },
                    { label: 'Remark / PO No.', render: i => i.RemarkOrPO || '-' }
                ],
                renderSummary: doc => `
                    <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div><span class="text-slate-400">วันที่:</span> <strong class="text-slate-800">${formatThaiDate(doc.DocDate)}</strong></div>
                        <div><span class="text-slate-400">วัตถุประสงค์:</span> <strong class="text-slate-800">${getPurposeLabelDisassembly(doc.Purpose)}</strong></div>
                        <div><span class="text-slate-400">ผู้ขออนุมัติ:</span> <strong class="text-slate-800">${doc.RequestedByName || '-'}</strong></div>
                    </div>
                    ${(doc.SkipApprover === true || Number(doc.SkipApprover) === 1) ? `
                    <div class="mt-3 pt-3 border-t border-slate-200 flex items-start gap-2">
                        <i data-lucide="fast-forward" class="w-4 h-4 text-orange-500 mt-0.5 shrink-0"></i>
                        <span class="text-xs text-orange-700 font-medium">แนบเอกสารแล้ว และ เลือกข้ามขั้นตอนผู้บริหารอนุมัติ</span>
                    </div>` : ''}
                `,
                renderPreviewPaper: doc => {
                    const items = doc.items || [];
                    const rows = items.map((item, i) => `
                        <tr>
                            <td class="border border-slate-300 px-4 py-3 text-center text-slate-500">${i + 1}</td>
                            <td class="border border-slate-300 px-4 py-3 break-words">${item.Brand || '-'}</td>
                            <td class="border border-slate-300 px-4 py-3 font-mono break-words">${item.MachineCode || '-'}</td>
                            <td class="border border-slate-300 px-4 py-3 font-mono break-words">${item.PartCode || '-'}</td>
                            <td class="border border-slate-300 px-4 py-3 break-words">${item.PartDescription || '-'}</td>
                            <td class="border border-slate-300 px-4 py-3 text-center whitespace-nowrap">${item.Qty ?? 0}</td>
                            <td class="border border-slate-300 px-4 py-3 text-center whitespace-nowrap">${item.HasPO ? 'มี PO' : 'ไม่มี PO'}</td>
                            <td class="border border-slate-300 px-4 py-3 break-words">${item.RemarkOrPO || '-'}</td>
                        </tr>
                    `).join('') || `<tr><td colspan="8" class="border border-slate-300 px-4 py-6 text-center text-slate-400">ไม่มีรายการอะไหล่</td></tr>`;

                    const sig = (label, name, sigImg) => `
                        <div class="flex-1 text-center space-y-1.5">
                            <div class="h-16 flex items-end justify-center">
                                ${sigImg ? `<img src="${sigImg}" class="max-h-[64px] mx-auto">` : ''}
                            </div>
                            <p class="text-sm font-medium text-slate-800">${name || '.....................................'}</p>
                            <div class="border-t border-slate-400 pt-1.5">
                                <p class="text-xs text-slate-500">${label}</p>
                            </div>
                        </div>
                    `;

                    return `
                        <div class="flex items-start justify-between border-b-2 border-slate-800 pb-6 mb-8">
                            <div>
                                <p class="text-sm font-bold text-orange-600 uppercase tracking-wider">KTW GROUP</p>
                                <p class="text-sm text-slate-500 mt-0.5">บริษัท เกรียงไทยวัฒนากรุ๊ป</p>
                                <h2 class="text-2xl font-bold mt-3">แบบฟอร์มขออนุมัติแกะอะไหล่</h2>
                            </div>
                            <div class="text-right text-sm text-slate-500 shrink-0">
                                <p>F-14-E02</p>
                                <p class="mt-0.5">สถานะ: ${doc.Status || '-'}</p>
                            </div>
                        </div>
                        <div class="grid grid-cols-1 sm:grid-cols-3 gap-6 text-sm mb-8">
                            <div><p class="text-slate-400">เลขที่เอกสาร</p><p class="font-mono font-bold text-base mt-0.5">${doc.DocId}</p></div>
                            <div><p class="text-slate-400">วันที่</p><p class="font-semibold text-base mt-0.5">${formatThaiDate(doc.DocDate)}</p></div>
                            <div><p class="text-slate-400">วัตถุประสงค์</p><p class="font-semibold text-base mt-0.5">${getPurposeLabelDisassembly(doc.Purpose)}</p></div>
                        </div>
                        <div class="overflow-x-auto mb-8 rounded-lg border border-slate-300">
                            <table class="w-full border-collapse text-sm" style="table-layout: fixed;">
                                <colgroup>
                                    <col style="width: 4%;"><col style="width: 10%;"><col style="width: 16%;"><col style="width: 16%;">
                                    <col style="width: 20%;"><col style="width: 8%;"><col style="width: 9%;"><col style="width: 17%;">
                                </colgroup>
                                <thead>
                                    <tr class="bg-slate-100">
                                        <th class="border border-slate-300 px-4 py-3">No.</th>
                                        <th class="border border-slate-300 px-4 py-3 text-left">Brand</th>
                                        <th class="border border-slate-300 px-4 py-3 text-left">KT Code ตัวเครื่อง</th>
                                        <th class="border border-slate-300 px-4 py-3 text-left">KT Code อะไหล่</th>
                                        <th class="border border-slate-300 px-4 py-3 text-left">Description</th>
                                        <th class="border border-slate-300 px-4 py-3">Qty</th>
                                        <th class="border border-slate-300 px-4 py-3">PO</th>
                                        <th class="border border-slate-300 px-4 py-3 text-left">Remark / PO No.</th>
                                    </tr>
                                </thead>
                                <tbody>${rows}</tbody>
                            </table>
                        </div>
                        <div class="flex gap-8 pt-10">
                            ${sig('ผู้ขออนุมัติแกะอะไหล่', doc.RequestedByName, null)}
                            ${sig('เจ้าหน้าที่การตลาด', doc.MarketingByName, doc.MarketingSignature)}
                            ${sig('ผู้บริหาร', doc.ApprovedByName, doc.ApprovedSignature)}
                        </div>
                    `;
                },
                buildApprovePayload: (docId, stageKey, comment, updatedPrices, odoNumber, _ncrFields, _swapFields, _claimFields, inboundNumber, reservationNumber) => ({
                    docId, actionByName: empName, actionByEmpId: empId, comment,
                    ...(odoNumber ? { odoNumber } : {}),
                    ...(inboundNumber ? { inboundNumber } : {}),
                    ...(reservationNumber ? { reservationNumber } : {})
                }),
                buildRejectPayload: (docId, stageKey, reason) => ({
                    docId, actionByName: empName, actionByEmpId: empId, reason
                }),
                stages: [
                    {
                        key: 'marketing',
                        label: 'เอกสารขอแกะอะไหล่ ที่ รอเจ้าหน้าที่การตลาด อนุมัติ',
                        accentColor: 'amber',
                        matchDoc: d => d.StepNo === 0,
                        recipientKeys: ['MarketingNotifyEmpId'],
                        canAct: role => role === '3' || role === '1',
                        approveEndpoint: 'marketing_approve_disassembly',
                        // ⚠️ ตั้งใจไม่มีปุ่มปฏิเสธที่ stage นี้ — เป็น stage แรกสุดหลังสร้างเอกสาร ไม่มีขั้นก่อนหน้าให้ถอยกลับไปแล้ว (ตรงกับกติกาเดียวกับ SWAP)
                        rejectEndpoint: null,
                        columns: [
                            { label: 'เลขที่เอกสาร', render: d => `<span class="font-mono font-medium text-slate-800">${d.DocId}</span>` },
                            { label: 'วันที่', render: d => formatThaiDate(d.DocDate) },
                            { label: 'วัตถุประสงค์', render: d => getPurposeLabelDisassembly(d.Purpose) },
                            { label: 'รายการ', render: d => `${d.ItemCount || 0} รายการ` },
                            { label: 'PO', render: d => getPOBadgeApprove(d) },
                            { label: 'ผู้ขออนุมัติ', render: d => d.RequestedByName || '-' }
                        ]
                    },
                    {
                        key: 'final',
                        label: 'เอกสารขอแกะอะไหล่ ที่ รอผู้อนุมัติ (อนุมัติขั้นสุดท้าย)',
                        accentColor: 'emerald',
                        matchDoc: d => d.StepNo === 1,
                        recipientKeys: ['ApproverNotifyEmpId'],
                        canAct: role => role === '2' || role === '1',
                        approveEndpoint: 'final_approve_disassembly',
                        rejectEndpoint: 'reject_disassembly',
                        // เปลี่ยนจาก "ปฏิเสธถาวร" เป็น "ถอยสถานะกลับ" ให้ตรงกับ SQL จริง (StepNo 0, เคลียร์ MarketingBy*)
                        rejectLabel: 'ตีกลับให้เจ้าหน้าที่การตลาดตรวจสอบใหม่',
                        rejectDescription: 'เอกสารนี้จะถูกส่งกลับไปที่คิว "รอเจ้าหน้าที่การตลาดอนุมัติ" อีกครั้ง ไม่ใช่การปฏิเสธถาวร กรุณาระบุเหตุผลที่ตีกลับ',
                        columns: [
                            { label: 'เลขที่เอกสาร', render: d => `<span class="font-mono font-medium text-slate-800">${d.DocId}</span>` },
                            { label: 'วันที่', render: d => formatThaiDate(d.DocDate) },
                            { label: 'วัตถุประสงค์', render: d => getPurposeLabelDisassembly(d.Purpose) },
                            { label: 'รายการ', render: d => `${d.ItemCount || 0} รายการ` },
                            { label: 'PO', render: d => getPOBadgeApprove(d) },
                            { label: 'เจ้าหน้าที่การตลาด', render: d => d.MarketingByName || '-' }
                        ]
                    },
                    {
                        key: 'warehouse',
                        label: 'เอกสารขอแกะอะไหล่ ที่ รอเจ้าหน้าที่คลังจัดสินค้า',
                        accentColor: 'amber',
                        matchDoc: d => d.StepNo === 2,
                        recipientKeys: ['WarehouseNotifyEmpId'],
                        // 🔓 Role-based: ทีมเดียวกัน (MCM/SPM) กดยืนยันแทนกันได้ ไม่จำเป็นต้องเป็นคนที่ถูกเลือกไว้ตอนสร้างเอกสาร
                        canAct: (role, doc) => {
                            if (role === '1') return true;
                            return role === '4' || role === '5';
                        },
                        approveButtonLabel: 'ย้าย Stock และ สินค้าส่งห้องช่างเรียบร้อยแล้ว',
                        approveEndpoint: 'warehouse_confirm_disassembly',
                        rejectEndpoint: null,
                        columns: [
                            { label: 'เลขที่เอกสาร', render: d => `<span class="font-mono font-medium text-slate-800">${d.DocId}</span>` },
                            { label: 'วันที่', render: d => formatThaiDate(d.DocDate) },
                            { label: 'วัตถุประสงค์', render: d => getPurposeLabelDisassembly(d.Purpose) },
                            { label: 'รายการ', render: d => `${d.ItemCount || 0} รายการ` },
                            { label: 'ผู้รับผิดชอบคลัง', render: d => d.WarehouseNotifyName || '-' }
                        ]
                    },
                    {
                        key: 'technician',
                        label: 'เอกสารขอแกะอะไหล่ ที่ รอเจ้าหน้าที่แผนกเทคนิคและช่าง',
                        accentColor: 'cyan',
                        matchDoc: d => d.StepNo === 3,
                        recipientKeys: ['TechnicianNotifyEmpId'],
                        // 🔓 Role-based: ทีมเดียวกัน (SRV) กดยืนยันแทนกันได้ ไม่จำเป็นต้องเป็นคนที่ถูกเลือกไว้ตอนสร้างเอกสาร
                        canAct: (role, doc) => {
                            if (role === '1') return true;
                            return role === '6';
                        },
                        approveButtonLabel: 'ยืนยันแกะอะไหล่เสร็จแล้ว',
                        approveEndpoint: 'technician_confirm_disassembly',
                        rejectEndpoint: null,
                        columns: [
                            { label: 'เลขที่เอกสาร', render: d => `<span class="font-mono font-medium text-slate-800">${d.DocId}</span>` },
                            { label: 'วันที่', render: d => formatThaiDate(d.DocDate) },
                            { label: 'วัตถุประสงค์', render: d => getPurposeLabelDisassembly(d.Purpose) },
                            { label: 'รายการ', render: d => `${d.ItemCount || 0} รายการ` },
                            { label: 'เจ้าหน้าที่คลัง', render: d => d.WarehouseByName || d.WarehouseNotifyName || '-' }
                        ]
                    },
                    {
                        key: 'scm',
                        label: 'เอกสารขอแกะอะไหล่ ที่ รอเจ้าหน้าที่แผนก SCM ตรวจสอบ',
                        accentColor: 'fuchsia',
                        matchDoc: d => d.StepNo === 5,
                        recipientKeys: ['ScmNotifyEmpId'],
                        // 🔓 Role-based: ทีมเดียวกัน (SCM) กดยืนยันแทนกันได้ ไม่จำเป็นต้องเป็นคนที่ถูกเลือกไว้ตอนสร้างเอกสาร
                        // Sequential: SCM ต้องยืนยันก่อน (พร้อมกรอกเลข ODO) แล้วค่อยส่งต่อคลังอะไหล่ ไม่ใช่ยืนยันคู่ขนาน
                        canAct: (role, doc) => {
                            if (role === '1') return true;
                            return role === '7';
                        },
                        approveButtonLabel: 'ยืนยันตรวจสอบเรียบร้อยแล้ว',
                        approveEndpoint: 'scm_confirm_disassembly',
                        rejectEndpoint: null,
                        columns: [
                            { label: 'เลขที่เอกสาร', render: d => `<span class="font-mono font-medium text-slate-800">${d.DocId}</span>` },
                            { label: 'วันที่', render: d => formatThaiDate(d.DocDate) },
                            { label: 'วัตถุประสงค์', render: d => getPurposeLabelDisassembly(d.Purpose) },
                            { label: 'รายการ', render: d => `${d.ItemCount || 0} รายการ` },
                            { label: 'เจ้าหน้าที่ช่าง', render: d => d.TechnicianByName || d.TechnicianNotifyName || '-' }
                        ]
                    },
                    {
                        key: 'parts_warehouse',
                        label: 'เอกสารขอแกะอะไหล่ ที่ รอเจ้าหน้าที่คลังอะไหล่รับของ',
                        accentColor: 'lime',
                        matchDoc: d => d.StepNo === 6,
                        recipientKeys: ['PartsWarehouseNotifyEmpId'],
                        // 🔓 Role-based: ทีมเดียวกัน (SPM) กดยืนยันแทนกันได้ ไม่จำเป็นต้องเป็นคนที่ถูกเลือกไว้ตอนสร้างเอกสาร
                        canAct: (role, doc) => {
                            if (role === '1') return true;
                            return role === '5';
                        },
                        approveButtonLabel: 'ยืนยันรับอะไหล่เรียบร้อยแล้ว',
                        approveEndpoint: 'parts_warehouse_confirm_disassembly',
                        rejectEndpoint: null,
                        columns: [
                            { label: 'เลขที่เอกสาร', render: d => `<span class="font-mono font-medium text-slate-800">${d.DocId}</span>` },
                            { label: 'วันที่', render: d => formatThaiDate(d.DocDate) },
                            { label: 'วัตถุประสงค์', render: d => getPurposeLabelDisassembly(d.Purpose) },
                            { label: 'รายการ', render: d => `${d.ItemCount || 0} รายการ` },
                            { label: 'เลข ODO', render: d => d.OdoNumber ? `<span class="font-mono font-semibold text-lime-700">${d.OdoNumber}</span>` : '-' },
                            { label: 'เจ้าหน้าที่ SCM', render: d => d.ScmByName || d.ScmNotifyName || '-' }
                        ]
                    }
                ]
            },
            {
                key: 'swap',
                label: 'ระบบขอสลับสินค้า (SWAP System)',
                description: 'การขออนุมัติสลับสินค้าทดแทน ชดเชย หรือสลับรุ่นระหว่างคลังสินค้า',
                icon: 'arrow-left-right',
                themeColor: 'blue',
                sessionRoleKey: 'emp_type',
                queueEndpoint: 'get_pending_queue_swap',
                detailEndpoint: 'GetDocumentDetail-KTW-switching-system',
                detailPayloadKey: 'documentId',
                getDocId: d => d.documentId,
                isCancelled: d => d.isDeleted === true || d.IsDeleted === true || d.IsDeleted === 1,
                getItems: doc => doc.products || doc.items || [],
                itemColumns: [
                    { label: 'รหัสสินค้า', render: p => p.prodCode || p.prod_code || '-' },
                    { label: 'รายละเอียด', render: p => p.description || '-' },
                    { label: 'จำนวนเข้า', render: p => `${p.qtyIn ?? p.qty_in ?? 0} ${p.unitIn || p.unit_in || ''}` },
                    { label: 'จำนวนออก', render: p => `${p.qtyOut ?? p.qty_out ?? 0} ${p.unitOut || p.unit_out || ''}` },
                    { label: 'ราคา', render: (p, idx, stageKey) => {
                        const price = p.price ?? 0;
                        // 🔒 ให้แก้ไขราคาได้เฉพาะ Stage 2 (SCM อนุมัติขั้นสุดท้าย) เท่านั้น — Stage 1 ยังคงแสดงผลอย่างเดียวเหมือนเดิม
                        // ⚠️ ใช้ p.no (ตรงกับ doc_item_no ในฐานข้อมูล) เป็นตัวระบุแถว ไม่ใช้ idx (array index 0-based)
                        //    เพราะ doc_item_no เริ่มนับที่ 1 ไม่ตรงกับ idx โดยตรง ถ้าใช้ idx ผิดจะ UPDATE ผิดแถว
                        if (stageKey === 'scm') {
                            const itemNo = p.no ?? (idx + 1);
                            return `<input type="number" step="0.01" min="0"
                                class="swap-price-input w-24 h-7 px-1.5 text-xs text-right border border-slate-200 rounded-md focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none"
                                data-item-no="${itemNo}"
                                data-original-price="${price}"
                                value="${price}">`;
                        }
                        return price.toLocaleString ? price.toLocaleString() : price;
                    } }
                ],
                renderSummary: doc => `
                    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        <div><span class="text-slate-400">วันที่:</span> <strong class="text-slate-800">${formatThaiDate(doc.date)}</strong></div>
                        <div>
                            <span class="text-slate-400">วัตถุประสงค์:</span>
                            <strong class="text-slate-800" id="swapPurposeText">${purposeLabelSwap(doc.purpose, doc.purposeDes)}</strong>
                            <button type="button" id="swapPurposeEditBtn" class="hidden ml-1 text-[11px] font-semibold text-brand-600 hover:text-brand-700 underline underline-offset-2" onclick="toggleSwapPurposeEdit()">แก้ไข</button>
                            <select id="signSwapMovementType" class="hidden ml-1 h-7 px-2 rounded-lg border border-slate-200 text-xs bg-white align-middle focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none">
                                <option value="309">309 : สลับสินค้ารุ่น</option>
                                <option value="921-922">921-922 : สลับสินค้ารุ่นเข้า/ออก</option>
                            </select>
                        </div>
                        <div><span class="text-slate-400">ผู้ขอสลับสินค้า:</span> <strong class="text-slate-800">${doc.preparedBy || '-'}</strong></div>
                        <div><span class="text-slate-400">หมายเหตุ:</span> <strong class="text-slate-800">${doc.remark || '-'}</strong></div>
                    </div>
                    ${doc.skipApprover ? `
                    <div class="mt-3 pt-3 border-t border-slate-200 flex items-start gap-2">
                        <i data-lucide="fast-forward" class="w-4 h-4 text-orange-500 mt-0.5 shrink-0"></i>
                        <span class="text-xs text-orange-700 font-medium">แนบเอกสารแล้ว และ เลือกข้ามขั้นตอนผู้บริหารอนุมัติ</span>
                    </div>` : ''}
                    ${doc.rejectReason ? `
                    <div class="mt-3 pt-3 border-t border-slate-200 flex items-start gap-2">
                        <i data-lucide="corner-down-left" class="w-4 h-4 text-red-500 mt-0.5 shrink-0"></i>
                        <span class="text-xs text-red-700"><strong>เหตุผลที่เคยถูกตีกลับ:</strong> ${doc.rejectReason}</span>
                    </div>` : ''}
                    ${doc.odoNo || doc.inboundDocMcm || doc.inboundDocSpm ? `
                    <div class="mt-3 pt-3 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div><span class="text-slate-400">เลข ODO:</span> <strong class="font-mono text-slate-800">${doc.odoNo || '-'}</strong></div>
                        <div><span class="text-slate-400">Inbound MCM:</span> <strong class="font-mono text-slate-800">${doc.inboundDocMcm || '-'}</strong></div>
                        <div><span class="text-slate-400">Inbound SPM:</span> <strong class="font-mono text-slate-800">${doc.inboundDocSpm || '-'}</strong></div>
                    </div>` : ''}
                `,
                renderPreviewPaper: doc => {
                    const products = doc.products || [];
                    const rows = products.map((p, i) => `
                        <tr>
                            <td class="border border-slate-300 px-4 py-3 text-center text-slate-500">${i + 1}</td>
                            <td class="border border-slate-300 px-4 py-3 font-mono break-words">${p.prodCode || '-'}</td>
                            <td class="border border-slate-300 px-4 py-3 break-words">${p.description || '-'}</td>
                            <td class="border border-slate-300 px-4 py-3 text-center whitespace-nowrap">${p.qtyIn ?? 0} ${p.unitIn || ''}</td>
                            <td class="border border-slate-300 px-4 py-3 text-center whitespace-nowrap">${p.qtyOut ?? 0} ${p.unitOut || ''}</td>
                            <td class="border border-slate-300 px-4 py-3 text-center whitespace-nowrap">${(p.price ?? 0).toLocaleString ? Number(p.price ?? 0).toLocaleString() : (p.price ?? 0)}</td>
                        </tr>
                    `).join('') || `<tr><td colspan="6" class="border border-slate-300 px-4 py-6 text-center text-slate-400">ไม่มีรายการสินค้า</td></tr>`;

                    const sig = (label, name) => `
                        <div class="flex-1 text-center space-y-1.5">
                            <div class="h-14"></div>
                            <p class="text-sm font-medium text-slate-800">${name || '.....................................'}</p>
                            <div class="border-t border-slate-400 pt-1.5">
                                <p class="text-xs text-slate-500">${label}</p>
                            </div>
                        </div>
                    `;

                    return `
                        <div class="flex items-start justify-between border-b-2 border-slate-800 pb-6 mb-8">
                            <div>
                                <p class="text-sm font-bold text-orange-600 uppercase tracking-wider">KTW GROUP</p>
                                <p class="text-sm text-slate-500 mt-0.5">บริษัท เกรียงไทยวัฒนากรุ๊ป</p>
                                <h2 class="text-2xl font-bold mt-3">ใบขอสลับสินค้า / เบิกอะไหล่</h2>
                            </div>
                            <div class="text-right text-sm text-slate-500 shrink-0">
                                <p>F-14-E05 แก้ไขครั้งที่ 01</p>
                            </div>
                        </div>
                        <div class="grid grid-cols-1 sm:grid-cols-3 gap-6 text-sm mb-8">
                            <div><p class="text-slate-400">เลขที่เอกสาร</p><p class="font-mono font-bold text-base mt-0.5">${doc.documentId}</p></div>
                            <div><p class="text-slate-400">วันที่</p><p class="font-semibold text-base mt-0.5">${formatThaiDate(doc.date)}</p></div>
                            <div><p class="text-slate-400">วัตถุประสงค์</p><p class="font-semibold text-base mt-0.5">${purposeLabelSwap(doc.purpose, doc.purposeDes)}</p></div>
                        </div>
                        <div class="overflow-x-auto mb-8 rounded-lg border border-slate-300">
                            <table class="w-full border-collapse text-sm" style="table-layout: fixed;">
                                <colgroup>
                                    <col style="width: 6%;"><col style="width: 16%;"><col style="width: 34%;">
                                    <col style="width: 14%;"><col style="width: 14%;"><col style="width: 16%;">
                                </colgroup>
                                <thead>
                                    <tr class="bg-slate-100">
                                        <th class="border border-slate-300 px-4 py-3">No.</th>
                                        <th class="border border-slate-300 px-4 py-3 text-left">รหัสสินค้า</th>
                                        <th class="border border-slate-300 px-4 py-3 text-left">รายละเอียดสินค้า</th>
                                        <th class="border border-slate-300 px-4 py-3">จำนวนเข้า</th>
                                        <th class="border border-slate-300 px-4 py-3">จำนวนออก</th>
                                        <th class="border border-slate-300 px-4 py-3">ราคา/หน่วย</th>
                                    </tr>
                                </thead>
                                <tbody>${rows}</tbody>
                            </table>
                        </div>
                        <div class="text-sm mb-6"><span class="text-slate-400">หมายเหตุ:</span> <span class="font-medium">${doc.remark || '-'}</span></div>
                        <div class="flex flex-col sm:flex-row gap-8 sm:gap-4 pt-10">
                            ${sig('ผู้ขออนุมัติสลับสินค้า', doc.preparedBy)}
                            ${sig('ผู้บริหาร', doc.approvedBy)}
                            ${sig('เจ้าหน้าที่แผนก SCM', doc.scmControl)}
                        </div>
                    `;
                },
                buildApprovePayload: (docId, stageKey, comment, updatedPrices, _odoNumber, _ncrFields, swapFields) => ({
                    documentId: docId,
                    approveStage: stageKey,
                    approverName: empName,
                    approverEmail: empEmail,
                    approverEmpId: empId,
                    comment,
                    approveDate: new Date().toISOString().substring(0, 10),
                    // 💰 รายการราคาที่แก้ไข (เฉพาะ stage 'scm') — array ว่างถ้าไม่มีการแก้ไขราคาเลย
                    updatedPrices: updatedPrices || [],
                    // 🔄 ODO / Inbound / ผู้รับต่อ (เฉพาะ stage 'scm') — ไม่ส่งเลยถ้าไม่ใช่ stage นี้
                    ...(swapFields ? { swapFields } : {})
                }),
                buildRejectPayload: (docId, stageKey, reason) => ({
                    documentId: docId,
                    approveStage: stageKey,
                    approverName: empName,
                    approverEmail: empEmail,
                    approverEmpId: empId,
                    comment: reason
                }),
                stages: [
                    {
                        key: 'executive',
                        label: 'เอกสารขอสลับสินค้า ที่ รอผู้บริหารอนุมัติ',
                        accentColor: 'blue',
                        matchDoc: d => !d.managerApproveDate,
                        recipientKeys: ['managerNotifyEmpId'],
                        canAct: role => role === '2' || role === '1',
                        approveEndpoint: 'approve_swap_product',
                        // ⚠️ ตั้งใจไม่มีปุ่ม "ส่งกลับ" ที่ stage นี้ — เป็น stage แรกสุดหลังสร้างเอกสาร ไม่มีขั้นก่อนหน้าให้ถอยกลับไปแล้ว
                        rejectEndpoint: null,
                        columns: [
                            { label: 'เลขที่เอกสาร', render: d => `<span class="font-mono font-medium text-slate-800">${d.documentId}</span>` },
                            { label: 'วันที่', render: d => formatThaiDate(d.date) },
                            { label: 'วัตถุประสงค์', render: d => purposeLabelSwap(d.purpose, d.purposeDes) },
                            { label: 'หมายเหตุ (Remark)', render: d => d.remark || '-' },
                            { label: 'จำนวนรายการ', render: d => `${d.itemCount || 0} รายการ` },
                            { label: 'ผู้ขอสลับสินค้า', render: d => d.preparedBy || '-' }
                        ]
                    },
                    {
                        key: 'scm',
                        label: 'เอกสารขอสลับสินค้า ที่ รอ SCM อนุมัติ (อนุมัติขั้นสุดท้าย)',
                        accentColor: 'indigo',
                        matchDoc: d => !!d.managerApproveDate && !d.scmApproveDate,
                        recipientKeys: ['scmNotifyEmpId'],
                        canAct: role => role === '3' || role === '1',
                        approveEndpoint: 'approve_swap_product',
                        rejectEndpoint: 'reject_swap_product',
                        // ⚠️ ความหมายต่างจาก Disassembly — ตัวนี้ "ถอยสถานะกลับ" ไปให้ผู้บริหารพิจารณาใหม่ ไม่ใช่ปฏิเสธถาวร
                        rejectLabel: 'ส่งกลับให้ผู้บริหารพิจารณาใหม่',
                        rejectDescription: 'เอกสารนี้จะถูกส่งกลับไปที่คิว "รอผู้บริหารอนุมัติ" อีกครั้ง ไม่ใช่การปฏิเสธถาวร กรุณาระบุเหตุผลที่ส่งกลับ',
                        columns: [
                            { label: 'เลขที่เอกสาร', render: d => `<span class="font-mono font-medium text-slate-800">${d.documentId}</span>` },
                            { label: 'วันที่', render: d => formatThaiDate(d.date) },
                            { label: 'วัตถุประสงค์', render: d => purposeLabelSwap(d.purpose, d.purposeDes) },
                            { label: 'หมายเหตุ (Remark)', render: d => d.remark || '-' },
                            { label: 'จำนวนรายการ', render: d => `${d.itemCount || 0} รายการ` },
                            // 🚀 เอกสาร Fast-track ไม่มีผู้บริหารเซ็นจริง — ต้องบอก SCM ให้ชัดว่าทำไมถึงข้ามมา
                            //    เช็คจาก skipApprover ที่ Backend ส่งมา (ไม่ใช่เดาจากข้อความใน approvedBy)
                            { label: 'ผู้บริหารที่อนุมัติ', render: d => d.skipApprover
                                ? '<span class="text-orange-600 font-medium">แนบเอกสารแล้ว และ เลือกข้ามขั้นตอนผู้บริหารอนุมัติ</span>'
                                : (d.approvedBy || '-') }
                        ]
                    }
                ]
            },
            {
                key: 'ncr',
                label: 'ระบบขออนุมัติ NCR (Non-Conformance Control Report)',
                description: 'รายงานสิ่งที่ไม่เป็นไปตามข้อกำหนด สินค้าชำรุด หรือปัญหาคุณภาพจากการรับเข้า',
                icon: 'file-warning',
                themeColor: 'rose',
                sessionRoleKey: 'ncr_role',
                queueEndpoint: 'get_pending_queue_ncr',
                detailEndpoint: 'get_document_detail_ncr',
                detailPayloadKey: 'docId',
                getDocId: d => d.DocId,
                isCancelled: d => d.IsDeleted === true || d.IsDeleted === 1,
                getItems: doc => doc.items || [],
                // 🆕 30/09/2569 : ราคาย้ายจากช่องรวมระดับเอกสาร (NcrDocument.ScmPrice) ไปเก็บทีละรายการใน NcrItem.Price แทน
                //    คอลัมน์ "ราคา" มีความหมายเฉพาะ NcrType = SCRAP_CLAIM_VENDOR เท่านั้น ประเภทอื่นไม่ต้องเห็นคอลัมน์นี้เลย
                //    จึงประกาศเป็นฟังก์ชัน (itemColumnsFor/colWidthsFor) แทน array คงที่ — ดู loadDocDetailIntoSignModal ที่รองรับ 2 แบบ
                // 🔧 03/10/2569 : ข้อ 9 — ไม่ต้องแสดงคอลัมน์ "ราคา" ตอนขั้น "รอเจ้าหน้าที่แผนกโลจิสติกส์ยืนยัน" (stageKey==='log')
                //    แม้เอกสารจะเป็นประเภท SCRAP เคลม VENDOR ก็ตาม — รับ stageKey เพิ่มเป็นพารามิเตอร์ที่ 2
                itemColumnsFor: (doc, stageKey) => {
                    const baseCols = [
                        { label: 'Prod.Code', render: i => i.ProdCode },
                        { label: 'Description', render: i => i.Description || '-' },
                        { label: 'Qty', render: i => i.Qty },
                        { label: 'หน่วย', render: i => i.Unit || '-' },
                        { label: 'ชื่อร้าน', render: i => i.ShopName || '-' },
                        { label: 'Remark', render: i => i.Remark || '-' }
                    ];
                    if (!doc || doc.NcrType !== 'SCRAP_CLAIM_VENDOR') return baseCols;
                    if (stageKey === 'log') return baseCols;
                    const priceCol = {
                        label: 'ราคา',
                        render: (item, idx, stageKey) => {
                            // ✏️ แก้ไขราคาได้เฉพาะ SCM คนที่ 1 (sub-step แรกของขั้น 'scm') เท่านั้น ขั้นอื่นแสดงผลอย่างเดียว
                            const isEditablePhase = stageKey === 'scm' && ncrScmVendorPhase(doc) === 'scm1';
                            if (isEditablePhase) {
                                const price = item.Price ?? '';
                                return `<input type="number" step="0.01" min="0"
                                    class="ncr-item-price-input w-24 h-7 px-1.5 text-xs text-right border border-slate-200 rounded-md focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none"
                                    data-item-id="${item.ItemId}"
                                    value="${price}"
                                    placeholder="ราคา *">`;
                            }
                            return (item.Price !== undefined && item.Price !== null && item.Price !== '')
                                ? Number(item.Price).toLocaleString() : '-';
                        }
                    };
                    return [...baseCols, priceCol];
                },
                // ความกว้างคอลัมน์ (เรียงตาม itemColumnsFor ด้านบน) — ประกาศไว้เพื่อให้ตารางหลักกับตาราง
                // "รายการอะไหล่ที่แยกได้" ใช้ colgroup ชุดเดียวกัน คอลัมน์จะได้ตรงแนวกันพอดี
                // ถ้าไม่ล็อกความกว้าง แต่ละตารางจะกาง column ตามความยาวข้อความของตัวเอง ทำให้เหลื่อมกัน
                colWidthsFor: (doc, stageKey) => (doc && doc.NcrType === 'SCRAP_CLAIM_VENDOR' && stageKey !== 'log')
                    ? ['13%', '23%', '7%', '9%', '16%', '15%', '17%']
                    : ['16%', '30%', '8%', '10%', '20%', '16%'],
                // ⚠️ NCR ประเภท "SCRAP แยกเป็นอะไหล่" มีตารางที่สอง (NcrPartsItem) ซึ่งเดิมไม่เคยถูกแสดงในหน้าอนุมัติเลย
                //    เพราะ getItems อ่านแค่ doc.items — ทั้งที่ webhook get_document_detail_ncr ส่ง doc.partsItems มาให้อยู่แล้ว
                //    ผลคือผู้อนุมัติเซ็นโดยไม่เห็นรายการอะไหล่ โดยเฉพาะขั้น SPM ที่เซ็น "ยืนยันรับอะไหล่เข้าคลัง"
                //    ระบบอื่น (SWAP/Disassembly) ไม่มีตารางที่สอง จึงไม่ต้องประกาศ getExtraSections
                getExtraSections: (doc, stageKey) => {
                    const widths = ['16%', '30%', '8%', '10%', '20%', '16%'];
                    const colgroup = widths.map(w => `<col style="width:${w}">`).join('');
                    // 🔒 ตาราง "รายการอะไหล่ที่แยกได้" มีความหมายเฉพาะ NcrType = SCRAP_PARTS เท่านั้น
                    //    ประเภทอื่น (SCRAP / SCRAP_CLAIM_VENDOR / OTHER) ต้องไม่แสดงในทุกขั้นตอน
                    //    ถึงจะมีข้อมูลค้างอยู่ใน NcrPartsItem ก็ตาม
                    // 🆕 26/09/2569 : รายการนี้เป็นของเจ้าหน้าที่แผนกรับเข้าคลังอะไหล่ (SPM) เป็นผู้กรอกตอนอนุมัติขั้น 'spm'
                    //    เท่านั้น (ผ่าน signNcrPartsItemsWrap) — ขั้นก่อนหน้า (mid_approve/mkt/scm/log) ยังไม่มีใครกรอก
                    //    ข้อมูลนี้เลย จึงไม่ต้องแสดงตารางนี้ให้เห็นเป็นแถวว่างๆ
                    // ⚠️ ตอนยังไม่อนุมัติ (สถานะ "รอเจ้าหน้าที่แผนกรับเข้าคลังอะไหล่") doc.partsItems อาจมีแถวเปล่าๆ ติดมา (ProdCode ว่าง)
                    //    ต้องกรองแถวเปล่าออก ไม่งั้นจะเห็นกล่องนี้โชว์แถว "-" ซ้อนกับตารางกรอกด้านล่างที่บังคับกรอกอยู่แล้ว
                    const rawParts = (doc.NcrType === 'SCRAP_PARTS' && stageKey === 'spm') ? (doc.partsItems || []) : [];
                    const parts = rawParts.filter(p => p && String(p.ProdCode || '').trim() !== '');
                    const cols = ['Prod.Code', 'Description', 'Qty', 'หน่วย', 'ชื่อร้าน', 'Remark'];
                    let html = '';

                    if (parts.length > 0) {
                        const rows = parts.map(p => `
                            <tr>
                                <td class="px-2 py-1.5 text-xs break-words">${p.ProdCode || '-'}</td>
                                <td class="px-2 py-1.5 text-xs break-words">${p.Description || '-'}</td>
                                <td class="px-2 py-1.5 text-xs">${p.Qty ?? 0}</td>
                                <td class="px-2 py-1.5 text-xs">${p.Unit || '-'}</td>
                                <td class="px-2 py-1.5 text-xs break-words">${p.ShopName || '-'}</td>
                                <td class="px-2 py-1.5 text-xs break-words">${p.Remark || '-'}</td>
                            </tr>
                        `).join('');
                        html += `
                            <div class="space-y-2">
                                <h4 class="font-bold text-slate-800 text-xs flex items-center gap-1.5">
                                    <i data-lucide="package-open" class="w-3.5 h-3.5 text-brand-500"></i>
                                    รายการอะไหล่ที่แยกได้
                                </h4>
                                <div class="border border-slate-200 rounded-xl overflow-hidden">
                                    <div class="overflow-x-auto">
                                        <table class="w-full text-left text-xs" style="table-layout:fixed">
                                            <colgroup>${colgroup}</colgroup>
                                            <thead>
                                                <tr class="bg-slate-100 border-b border-slate-200">
                                                    ${cols.map(c => `<th class="px-2 py-1.5 text-[10px] font-semibold text-slate-500 uppercase">${c}</th>`).join('')}
                                                </tr>
                                            </thead>
                                            <tbody class="divide-y divide-slate-100">${rows}</tbody>
                                        </table>
                                    </div>
                                </div>
                            </div>
                        `;
                    }

                    // 🔢 เลขที่เอกสารที่ SCM กรอกไว้ตอนอนุมัติ — คนที่เซ็นขั้นถัดไปต้องใช้อ้างอิงของจริง
                    //    MCM-LOG ใช้เลขที่ DO ตอนยืนยันปิดงาน / SPM ใช้เลขที่ Inbound ตอนยืนยันรับเข้าคลัง
                    const docNumbers = [];
                    if (stageKey === 'log' && doc.DoNumber) {
                        docNumbers.push({ label: ncrDoLabel(doc), value: doc.DoNumber });
                    }
                    if (stageKey === 'log' && doc.WaveNumber) {
                        docNumbers.push({ label: 'เลขที่ Wave', value: doc.WaveNumber });
                    }
                    if (stageKey === 'log' && doc.PoNumber) {
                        docNumbers.push({ label: 'เลขที่ PO', value: doc.PoNumber });
                    }
                    // ⚠️ ประเภท OTHER กรอกเลข Inbound ตอน SCM แต่ไม่มีขั้น SPM ต่อจาก LOG เลย (LOG คือขั้นสุดท้ายก่อนจบ)
                    //    ถ้าโชว์แค่ตอน 'spm' เลข Inbound ของ OTHER จะไม่มีที่ไหนแสดงให้เจ้าหน้าที่โลจิสติกส์เห็นเลย
                    //    จึงต้องโชว์ที่ขั้น 'log' ด้วย (ไม่กระทบ SCRAP_PARTS ซึ่งจะไปโชว์ซ้ำอีกทีตอน 'spm' อยู่แล้ว)
                    if ((stageKey === 'log' || stageKey === 'spm') && doc.InboundNumber) {
                        docNumbers.push({ label: 'เลขที่ Inbound', value: doc.InboundNumber });
                    }
                    if (docNumbers.length > 0) {
                        html += `
                            <div class="flex flex-wrap gap-3">
                                ${docNumbers.map(d => `
                                    <div class="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5">
                                        <i data-lucide="hash" class="w-3.5 h-3.5 text-brand-500"></i>
                                        <span class="text-xs text-slate-500">${d.label}:</span>
                                        <span class="text-sm font-mono font-semibold text-slate-800">${d.value}</span>
                                    </div>
                                `).join('')}
                            </div>
                        `;
                    }

                    return html;
                },
                renderSummary: doc => {
                    // 🆕 26/09/2569 : "สถานะการเคลม" มีความหมายเฉพาะ NcrType = SCRAP_CLAIM_VENDOR เท่านั้น
                    //    ประเภทอื่น (SCRAP/SCRAP_PARTS/OTHER) ไม่เกี่ยวข้อง แสดง "-" ให้เห็นเฉยๆ ทำให้หน้างานเข้าใจผิด จึงไม่ต้องแสดง
                    const summaryItems = [
                        { label: 'วันที่', value: formatThaiDate(doc.DocDate) },
                        { label: 'ประเภท NCR', value: ncrTypeLabelApprove(doc) },
                        doc.NcrType === 'SCRAP_CLAIM_VENDOR' ? { label: 'สถานะการเคลม', value: claimStatusTextApprove(doc) || '-' } : null,
                        { label: 'ผู้ขออนุมัติ', value: doc.CreatedByName || '-' },
                    ].filter(Boolean);
                    const colsClass = summaryItems.length === 3
                        ? 'grid-cols-1 sm:grid-cols-3'
                        : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4';
                    return `
                    <div class="grid ${colsClass} gap-4">
                        ${summaryItems.map(it => `
                            <div><span class="text-slate-400">${it.label}:</span> <strong class="text-slate-800">${it.value}</strong></div>
                        `).join('')}
                    </div>
                `;
                },
                renderPreviewPaper: doc => {
                    const items = doc.items || [];
                    // รายการอะไหล่ที่แยกได้ — มีเฉพาะ NcrType = SCRAP_PARTS ต้องพิมพ์ลงเอกสารจริงด้วย ไม่ใช่แค่โชว์บนหน้าจอ
                    const partsItems = doc.NcrType === 'SCRAP_PARTS' ? (doc.partsItems || []) : [];
                    const midLabel = doc.ClaimStatus === 'CLAIMABLE' ? 'เจ้าหน้าที่แผนก PQM' : 'ผู้บริหาร';
                    const rows = items.map((item, i) => `
                        <tr>
                            <td class="border border-slate-300 px-4 py-3 text-center text-slate-500">${i + 1}</td>
                            <td class="border border-slate-300 px-4 py-3 font-mono break-words">${item.ProdCode || '-'}</td>
                            <td class="border border-slate-300 px-4 py-3 break-words">${item.Description || '-'}</td>
                            <td class="border border-slate-300 px-4 py-3 text-center whitespace-nowrap">${item.Qty ?? 0}</td>
                            <td class="border border-slate-300 px-4 py-3 text-center whitespace-nowrap">${item.Unit || '-'}</td>
                            <td class="border border-slate-300 px-4 py-3 break-words">${item.ShopName || '-'}</td>
                            <td class="border border-slate-300 px-4 py-3 break-words">${item.Remark || '-'}</td>
                        </tr>
                    `).join('') || `<tr><td colspan="7" class="border border-slate-300 px-4 py-6 text-center text-slate-400">ไม่มีรายการ</td></tr>`;

                    const sig = (label, name, sigImg) => `
                        <div class="flex-1 text-center space-y-1.5">
                            <div class="h-16 flex items-end justify-center">
                                ${sigImg ? `<img src="${sigImg}" class="max-h-[64px] mx-auto">` : ''}
                            </div>
                            <p class="text-sm font-medium text-slate-800">${name || '.....................................'}</p>
                            <div class="border-t border-slate-400 pt-1.5">
                                <p class="text-xs text-slate-500">${label}</p>
                            </div>
                        </div>
                    `;

                    return `
                        <div class="flex items-start justify-between border-b-2 border-slate-800 pb-6 mb-8">
                            <div>
                                <p class="text-sm font-bold text-orange-600 uppercase tracking-wider">KTW GROUP</p>
                                <p class="text-sm text-slate-500 mt-0.5">บริษัท เกรียงไทยวัฒนากรุ๊ป</p>
                                <h2 class="text-2xl font-bold mt-3">แบบฟอร์ม NCR</h2>
                            </div>
                            <div class="text-right text-sm text-slate-500 shrink-0">
                                <p>F-15-E01 แก้ไขครั้งที่ 3</p>
                                <p class="mt-0.5">Movement Type: ${doc.MovementType || '-'}</p>
                            </div>
                        </div>
                        <div class="grid grid-cols-1 sm:grid-cols-3 gap-6 text-sm mb-8">
                            <div><p class="text-slate-400">เลขที่เอกสาร</p><p class="font-mono font-bold text-base mt-0.5">${doc.DocId}</p></div>
                            <div><p class="text-slate-400">วันที่</p><p class="font-semibold text-base mt-0.5">${formatThaiDate(doc.DocDate)}</p></div>
                            <div><p class="text-slate-400">ประเภท NCR</p><p class="font-semibold text-base mt-0.5">${ncrTypeLabelApprove(doc)}</p></div>
                        </div>
                        <div class="overflow-x-auto mb-8 rounded-lg border border-slate-300">
                            <table class="w-full border-collapse text-sm" style="table-layout: fixed;">
                                <colgroup>
                                    <col style="width: 4%;"><col style="width: 16%;"><col style="width: 32%;">
                                    <col style="width: 10%;"><col style="width: 10%;"><col style="width: 14%;"><col style="width: 14%;">
                                </colgroup>
                                <thead>
                                    <tr class="bg-slate-100">
                                        <th class="border border-slate-300 px-4 py-3">No.</th>
                                        <th class="border border-slate-300 px-4 py-3 text-left">Prod.Code</th>
                                        <th class="border border-slate-300 px-4 py-3 text-left">Description</th>
                                        <th class="border border-slate-300 px-4 py-3">Qty</th>
                                        <th class="border border-slate-300 px-4 py-3">หน่วย</th>
                                        <th class="border border-slate-300 px-4 py-3 text-left">ชื่อร้าน</th>
                                        <th class="border border-slate-300 px-4 py-3 text-left">Remark</th>
                                    </tr>
                                </thead>
                                <tbody>${rows}</tbody>
                            </table>
                        </div>
                        ${partsItems.length === 0 ? '' : `
                        <div class="pt-8">
                            <p class="text-base font-semibold text-slate-800 mb-3">รายการอะไหล่ที่แยกได้</p>
                            <table class="w-full border-collapse text-sm">
                                <thead>
                                    <tr class="bg-slate-100">
                                        <th class="border border-slate-300 px-4 py-3 w-12">#</th>
                                        <th class="border border-slate-300 px-4 py-3 text-left">Prod.Code</th>
                                        <th class="border border-slate-300 px-4 py-3 text-left">Description</th>
                                        <th class="border border-slate-300 px-4 py-3">Qty</th>
                                        <th class="border border-slate-300 px-4 py-3">หน่วย</th>
                                        <th class="border border-slate-300 px-4 py-3 text-left">ชื่อร้าน</th>
                                        <th class="border border-slate-300 px-4 py-3 text-left">Remark</th>
                                    </tr>
                                </thead>
                                <tbody>${partsItems.map((p, i) => `
                                    <tr>
                                        <td class="border border-slate-300 px-4 py-3 text-center text-slate-500">${i + 1}</td>
                                        <td class="border border-slate-300 px-4 py-3 font-mono break-words">${p.ProdCode || '-'}</td>
                                        <td class="border border-slate-300 px-4 py-3 break-words">${p.Description || '-'}</td>
                                        <td class="border border-slate-300 px-4 py-3 text-center whitespace-nowrap">${p.Qty ?? 0}</td>
                                        <td class="border border-slate-300 px-4 py-3 text-center whitespace-nowrap">${p.Unit || '-'}</td>
                                        <td class="border border-slate-300 px-4 py-3 break-words">${p.ShopName || '-'}</td>
                                        <td class="border border-slate-300 px-4 py-3 break-words">${p.Remark || '-'}</td>
                                    </tr>
                                `).join('')}</tbody>
                            </table>
                        </div>`}
                        <div class="flex gap-8 pt-10">
                            ${sig('ผู้ขออนุมัติเอกสาร NCR', doc.CreatedByName, null)}
                            ${sig(midLabel, doc.MidApproverName, doc.MidApproverSignature)}
                            ${sig('เจ้าหน้าที่แผนก SCM', doc.ScmName, doc.ScmSignature)}
                        </div>
                    `;
                },
                buildApprovePayload: (docId, stageKey, comment, _updatedPrices, _odoNumber, ncrFields) => ({
                    docId: docId,
                    approverName: empName,
                    approverEmpId: empId,
                    approverEmail: empEmail,
                    comment,
                    ...(ncrFields || {})
                }),
                buildRejectPayload: (docId, stageKey, reason) => ({
                    docId: docId,
                    actorName: empName,
                    actorEmpId: empId,
                    comment: reason
                }),
                stages: [
                    {
                        // ⚙️ StepNo 0 (รอบแรก) และ 2 (รอบสอง — Fast-track + เคลมไม่ได้) เข้าคิวเดียวกัน ผู้บริหารเซ็นเหมือนกันทั้งคู่
                        key: 'mid_approve',
                        label: 'เอกสาร NCR ที่ รอผู้บริหารอนุมัติ',
                        accentColor: 'amber',
                        matchDoc: d => d.StepNo === 0 || d.StepNo === 2,
                        recipientKeys: ['MidApproverNotifyEmpId'],
                        // 🔧 05/11/2569 : เลข Role NCR เรียงใหม่ (19/10/2569) — 2=ผู้บริหาร 3=MKT 4=MCM/LOG 5=SPM 7=SCM (เดิมในหน้านี้ยังใช้เลขเก่า ทำให้ MKT ไปเห็นคิวผู้บริหาร)
                        canAct: role => role === '2' || role === '1',
                        approveEndpoint: 'approve_ncr_mid',
                        // ⚙️ ปุ่มส่งกลับแสดงแบบ Dynamic ต่อเอกสาร (ดูใน openSignModal) — ไม่ใช่ per-stage แบบ SWAP/Disassembly
                        // เพราะ "Stage แรก" ของ NCR ไม่คงที่ (StepNo 0, 1 หรือ 3 แล้วแต่ประเภท/Fast-track)
                        rejectEndpoint: 'reject_ncr',
                        rejectLabel: 'ตีกลับให้ผู้สร้างเอกสารแก้ไข',
                        rejectDescription: 'เอกสารนี้จะถูกส่งกลับไปให้ผู้สร้างเอกสารแก้ไข แล้วกลับมารออนุมัติที่ขั้นนี้อีกครั้งโดยอัตโนมัติ ใช้ได้เฉพาะก่อนมีผู้อนุมัติขั้นใดเซ็นเท่านั้น กรุณาระบุเหตุผลที่ตีกลับ',
                        columns: [
                            { label: 'เลขที่เอกสาร', render: d => `<span class="font-mono font-medium text-slate-800">${d.DocId}</span>` },
                            { label: 'วันที่', render: d => formatThaiDate(d.DocDate) },
                            { label: 'ประเภท NCR', render: d => ncrTypeLabelApprove(d) },
                            { label: 'ชื่อร้าน', render: d => d.ShopName || '-' },
                            { label: 'ผู้ขออนุมัติ', render: d => d.CreatedByName || '-' }
                        ]
                    },
                    {
                        // ⚙️ StepNo=1 — เฉพาะ NcrType SCRAP_CLAIM_VENDOR เท่านั้นที่มาถึงขั้นนี้
                        key: 'mkt',
                        label: 'เอกสาร NCR ที่ รอเจ้าหน้าที่การตลาดพิจารณา',
                        accentColor: 'sky',
                        matchDoc: d => d.StepNo === 1,
                        recipientKeys: ['MarketingNotifyEmpId'],
                        canAct: role => role === '3' || role === '1',
                        approveEndpoint: 'approve_ncr_marketing',
                        rejectEndpoint: 'reject_ncr',
                        rejectLabel: 'ตีกลับให้ผู้สร้างเอกสารแก้ไข',
                        rejectDescription: 'เอกสารนี้จะถูกส่งกลับไปให้ผู้สร้างเอกสารแก้ไข แล้วกลับมารออนุมัติที่ขั้นนี้อีกครั้งโดยอัตโนมัติ ใช้ได้เฉพาะก่อนมีผู้อนุมัติขั้นใดเซ็นเท่านั้น กรุณาระบุเหตุผลที่ตีกลับ',
                        columns: [
                            { label: 'เลขที่เอกสาร', render: d => `<span class="font-mono font-medium text-slate-800">${d.DocId}</span>` },
                            { label: 'วันที่', render: d => formatThaiDate(d.DocDate) },
                            { label: 'ประเภท NCR', render: d => ncrTypeLabelApprove(d) },
                            { label: 'ชื่อร้าน', render: d => d.ShopName || '-' },
                            { label: 'ผู้บริหารอนุมัติโดย', render: d => d.MidApproverName || '-' },
                            { label: 'ผู้ขออนุมัติ', render: d => d.CreatedByName || '-' }
                        ]
                    },
                    {
                        key: 'scm',
                        label: 'เอกสาร NCR ที่ รอเจ้าหน้าที่ SCM',
                        accentColor: 'emerald',
                        matchDoc: d => d.StepNo === 3,
                        recipientKeys: ['ScmNotifyEmpId'],
                        canAct: role => role === '7' || role === '1',
                        approveEndpoint: 'approve_ncr_scm',
                        rejectEndpoint: 'reject_ncr',
                        rejectLabel: 'ตีกลับให้ผู้สร้างเอกสารแก้ไข',
                        rejectDescription: 'เอกสารนี้จะถูกส่งกลับไปให้ผู้สร้างเอกสารแก้ไข แล้วกลับมารออนุมัติที่ขั้นนี้อีกครั้งโดยอัตโนมัติ ใช้ได้เฉพาะก่อนมีผู้อนุมัติขั้นใดเซ็นเท่านั้น กรุณาระบุเหตุผลที่ตีกลับ',
                        columns: [
                            { label: 'เลขที่เอกสาร', render: d => `<span class="font-mono font-medium text-slate-800">${d.DocId}</span>` },
                            { label: 'วันที่', render: d => formatThaiDate(d.DocDate) },
                            { label: 'ประเภท NCR', render: d => ncrTypeLabelApprove(d) },
                            { label: 'สถานะการเคลม', render: d => getClaimStatusBadgeApprove(d) },
                            { label: 'ชื่อร้าน', render: d => d.ShopName || '-' },
                            { label: 'เจ้าหน้าที่การตลาดอนุมัติโดย', render: d => d.MarketingName || '-' },
                            // 🆕 29/09/2569 : NCR SCRAP เคลม VENDOR อยู่ในขั้น SCM ได้ถึง 3 sub-step — บอกให้ชัดว่าตอนนี้รออะไรอยู่
                            { label: 'ขั้นตอน SCM', render: d => ncrScmSubPhaseLabelApprove(d) }
                        ]
                    },
                    {
                        key: 'log',
                        label: 'เอกสาร NCR ที่ รอเจ้าหน้าที่แผนกโลจิสติกส์ยืนยัน',
                        accentColor: 'violet',
                        matchDoc: d => d.StepNo === 4,
                        recipientKeys: ['LogNotifyEmpId'],
                        canAct: role => role === '4' || role === '1',
                        approveEndpoint: 'approve_ncr_log',
                        rejectEndpoint: 'reject_ncr',
                        rejectLabel: 'ตีกลับให้ผู้สร้างเอกสารแก้ไข',
                        rejectDescription: 'เอกสารนี้จะถูกส่งกลับไปให้ผู้สร้างเอกสารแก้ไข แล้วกลับมารออนุมัติที่ขั้นนี้อีกครั้งโดยอัตโนมัติ ใช้ได้เฉพาะก่อนมีผู้อนุมัติขั้นใดเซ็นเท่านั้น กรุณาระบุเหตุผลที่ตีกลับ',
                        columns: [
                            { label: 'เลขที่เอกสาร', render: d => `<span class="font-mono font-medium text-slate-800">${d.DocId}</span>` },
                            { label: 'วันที่', render: d => formatThaiDate(d.DocDate) },
                            { label: 'ประเภท NCR', render: d => ncrTypeLabelApprove(d) },
                            { label: 'สถานะการเคลม', render: d => getClaimStatusBadgeApprove(d) },
                            // 🔧 29/09/2569 : เลิกใช้ป้าย "WO" แล้ว ("เลขที่ DO" ทุกประเภท) — ค่ายังอยู่คอลัมน์ DoNumber เดิม
                            { label: 'เลขที่ DO / wave', render: d => {
                                const tag = 'DO';
                                const wave = d.WaveNumber
                                    ? `<div class="text-[10px] text-slate-400 mt-0.5">Wave: <span class="font-mono">${d.WaveNumber}</span></div>` : '';
                                const main = d.DoNumber
                                    ? `<span class="text-[10px] font-bold text-slate-400 mr-1">${tag}</span><span class="font-mono">${d.DoNumber}</span>` : '-';
                                return `${main}${wave}`;
                            } },
                            { label: 'เจ้าหน้าที่ SCM อนุมัติโดย', render: d => d.ScmName || '-' }
                        ]
                    },
                    {
                        // ⚙️ เฉพาะ NcrType SCRAP_PARTS เท่านั้นที่มาถึงขั้นนี้ (อื่นๆ จบที่ 'log' ไปแล้ว)
                        key: 'spm',
                        label: 'เอกสาร NCR ที่ รอเจ้าหน้าที่แผนกรับเข้าคลังอะไหล่',
                        accentColor: 'cyan',
                        matchDoc: d => d.StepNo === 5,
                        recipientKeys: ['InboundAssigneeEmpId'],
                        canAct: role => role === '5' || role === '1',
                        approveEndpoint: 'approve_ncr_spm',
                        rejectEndpoint: 'reject_ncr',
                        rejectLabel: 'ตีกลับให้ผู้สร้างเอกสารแก้ไข',
                        rejectDescription: 'เอกสารนี้จะถูกส่งกลับไปให้ผู้สร้างเอกสารแก้ไข แล้วกลับมารออนุมัติที่ขั้นนี้อีกครั้งโดยอัตโนมัติ ใช้ได้เฉพาะก่อนมีผู้อนุมัติขั้นใดเซ็นเท่านั้น กรุณาระบุเหตุผลที่ตีกลับ',
                        columns: [
                            { label: 'เลขที่เอกสาร', render: d => `<span class="font-mono font-medium text-slate-800">${d.DocId}</span>` },
                            { label: 'วันที่', render: d => formatThaiDate(d.DocDate) },
                            { label: 'ประเภท NCR', render: d => ncrTypeLabelApprove(d) },
                            { label: 'เลขที่ Inbound', render: d => d.InboundNumber || '-' },
                            { label: 'เจ้าหน้าที่ SCM อนุมัติโดย', render: d => d.ScmName || '-' },
                            { label: 'ผู้ขออนุมัติ', render: d => d.CreatedByName || '-' }
                        ]
                    }
                ]
            },
            {
                // 🔄 28/09/2569 : โมดูล Claim (ระบบเคลมสินค้าลูกค้า) นำกลับเข้ามารวมใน KTW Inventory System อีกครั้ง
                //    ตามคำสั่งล่าสุด (ยกเลิกมติ SCM 15 ก.ย. 2569 ที่เคยให้แยกเป็นระบบเดี่ยว)
                //    ฟังก์ชันช่วยของ Claim (renderClaimSignAttachments / openClaimSignAttachment) และ
                //    บล็อก signClaimResultWrap เดิมที่เก็บไว้เฉยๆ ถูกเรียกใช้งานอีกครั้งผ่าน module นี้
                key: 'claim',
                label: 'ระบบเคลมสินค้าลูกค้า (Customer Claim System)',
                description: 'การพิจารณาคำร้องเคลม/ซ่อมสินค้าให้ลูกค้า',
                icon: 'headset',
                themeColor: 'emerald',
                sessionRoleKey: 'claim_role',
                queueEndpoint: 'get_pending_queue_claim_cus',
                detailEndpoint: 'get_document_detail_claim_cus',
                detailPayloadKey: 'docId',
                getDocId: d => d.DocId,
                isCancelled: d => d.IsDeleted === true || d.IsDeleted === 1,
                getItems: doc => doc.items || [],
                itemColumns: [
                    { label: 'Prod.Code', render: i => i.ProdCode },
                    { label: 'Description', render: i => i.Description || '-' },
                    { label: 'Qty', render: i => i.Qty },
                    { label: 'หน่วย', render: i => i.Unit || '-' },
                    { label: 'วันที่ซื้อ', render: i => formatThaiDate(i.PurchaseDate) },
                    { label: 'เลขที่บิล', render: i => i.BillNo || '-' },
                    { label: 'Remark', render: i => i.Remark || '-' }
                ],
                renderSummary: doc => `
                    <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div><span class="text-slate-400">วันที่:</span> <strong class="text-slate-800">${formatThaiDate(doc.DocDate)}</strong></div>
                        <div><span class="text-slate-400">วัตถุประสงค์:</span> <strong class="text-slate-800">${doc.Purpose || '-'}</strong></div>
                        <div><span class="text-slate-400">ลูกค้า:</span> <strong class="text-slate-800">${doc.CustomerName || '-'}${doc.CustomerPhone ? ` (${doc.CustomerPhone})` : ''}</strong></div>
                    </div>
                `,
                renderPreviewPaper: doc => {
                    const items = doc.items || [];
                    const rows = items.map((item, i) => `
                        <tr>
                            <td class="border border-slate-300 px-4 py-3 text-center text-slate-500">${i + 1}</td>
                            <td class="border border-slate-300 px-4 py-3 font-mono break-words">${item.ProdCode || '-'}</td>
                            <td class="border border-slate-300 px-4 py-3 break-words">${item.Description || '-'}</td>
                            <td class="border border-slate-300 px-4 py-3 text-center whitespace-nowrap">${item.Qty ?? 0}</td>
                            <td class="border border-slate-300 px-4 py-3 text-center whitespace-nowrap">${item.Unit || '-'}</td>
                            <td class="border border-slate-300 px-4 py-3 text-center whitespace-nowrap">${formatThaiDate(item.PurchaseDate)}</td>
                            <td class="border border-slate-300 px-4 py-3 break-words">${item.BillNo || '-'}</td>
                        </tr>
                    `).join('') || `<tr><td colspan="7" class="border border-slate-300 px-4 py-6 text-center text-slate-400">ไม่มีรายการ</td></tr>`;

                    const sig = (label, name, sigImg) => `
                        <div class="flex-1 text-center space-y-1.5">
                            <div class="h-16 flex items-end justify-center">
                                ${sigImg ? `<img src="${sigImg}" class="max-h-[64px] mx-auto">` : ''}
                            </div>
                            <p class="text-sm font-medium text-slate-800">${name || '.....................................'}</p>
                            <div class="border-t border-slate-400 pt-1.5">
                                <p class="text-xs text-slate-500">${label}</p>
                            </div>
                        </div>
                    `;

                    return `
                        <div class="flex items-start justify-between border-b-2 border-slate-800 pb-6 mb-8">
                            <div>
                                <p class="text-sm font-bold text-orange-600 uppercase tracking-wider">KTW GROUP</p>
                                <p class="text-sm text-slate-500 mt-0.5">บริษัท เกรียงไทยวัฒนากรุ๊ป</p>
                                <h2 class="text-2xl font-bold mt-3">แบบฟอร์มขอเคลมสินค้าลูกค้า</h2>
                            </div>
                            <div class="text-right text-sm text-slate-500 shrink-0">
                                <p>F-16-E01</p>
                                <p class="mt-0.5">สถานะ: ${doc.Status || '-'}</p>
                            </div>
                        </div>
                        <div class="grid grid-cols-1 sm:grid-cols-3 gap-6 text-sm mb-8">
                            <div><p class="text-slate-400">เลขที่เอกสาร</p><p class="font-mono font-bold text-base mt-0.5">${doc.DocId}</p></div>
                            <div><p class="text-slate-400">วันที่</p><p class="font-semibold text-base mt-0.5">${formatThaiDate(doc.DocDate)}</p></div>
                            <div><p class="text-slate-400">ลูกค้า</p><p class="font-semibold text-base mt-0.5">${doc.CustomerName || '-'}</p></div>
                        </div>
                        <div class="overflow-x-auto mb-8 rounded-lg border border-slate-300">
                            <table class="w-full border-collapse text-sm" style="table-layout: fixed;">
                                <colgroup>
                                    <col style="width: 4%;"><col style="width: 14%;"><col style="width: 28%;">
                                    <col style="width: 8%;"><col style="width: 10%;"><col style="width: 16%;"><col style="width: 20%;">
                                </colgroup>
                                <thead>
                                    <tr class="bg-slate-100">
                                        <th class="border border-slate-300 px-4 py-3">No.</th>
                                        <th class="border border-slate-300 px-4 py-3 text-left">Prod.Code</th>
                                        <th class="border border-slate-300 px-4 py-3 text-left">Description</th>
                                        <th class="border border-slate-300 px-4 py-3">Qty</th>
                                        <th class="border border-slate-300 px-4 py-3">หน่วย</th>
                                        <th class="border border-slate-300 px-4 py-3">วันที่ซื้อ</th>
                                        <th class="border border-slate-300 px-4 py-3 text-left">เลขที่บิล</th>
                                    </tr>
                                </thead>
                                <tbody>${rows}</tbody>
                            </table>
                        </div>
                        <div class="flex gap-8 pt-10">
                            ${sig('ผู้แจ้งเคลม', doc.CreatedByName, null)}
                            ${sig('เจ้าหน้าที่การตลาด', doc.MktByName, null)}
                        </div>
                    `;
                },
                // ⚠️ signature ตรงกับ mod.buildApprovePayload(docId, stageKey, comment, updatedPrices, odoNumber, ncrFields, swapFields, claimFields, inboundNumber, reservationNumber) ที่เรียกจริงใน submitSignature()
                buildApprovePayload: (docId, stageKey, comment, _updatedPrices, _odoNumber, _ncrFields, _swapFields, claimFields) => ({
                    docId, actorEmpId: empId, actorName: empName, comment,
                    decision: (claimFields && claimFields.decision) || 'APPROVE'
                }),
                // ตีกลับให้แก้ไข (REJECT_BACK) ใช้ webhook เดียวกับอนุมัติ (approve_claim_cus) — backend แยกพฤติกรรมจาก decision
                buildRejectPayload: (docId, stageKey, reason) => ({
                    docId, actorEmpId: empId, actorName: empName, comment: reason, decision: 'REJECT_BACK'
                }),
                stages: [
                    {
                        key: 'mkt',
                        label: 'เอกสารเคลมสินค้าลูกค้า ที่ รอเจ้าหน้าที่การตลาดพิจารณา',
                        accentColor: 'emerald',
                        // Role 1 (Admin) เห็นทุกใบ · Role 2 (ผู้บริหาร) / Role 3 (การตลาด) เห็นเฉพาะใบที่ ApproverRoleId ตรงกับ Role ตน
                        // (ตรงกับ SQL - Check Approve Claim Permission: @roleId = @appRole; ApproverRoleId ว่าง = 3)
                        matchDoc: d => {
                            if (d.Status !== 'PENDING_MKT') return false;
                            const r = getEffectiveRole('claim_role');
                            return r === '1' || String(d.ApproverRoleId ?? 3) === r;
                        },
                        recipientKeys: ['MktNotifyEmpId'],
                        canAct: role => role === '1' || role === '2' || role === '3',
                        approveEndpoint: 'approve_claim_cus',
                        rejectEndpoint: 'approve_claim_cus',
                        rejectLabel: 'ตีกลับให้แก้ไข',
                        rejectDescription: 'เอกสารนี้จะถูกส่งกลับไปให้ผู้แจ้งเคลมแก้ไข กรุณาระบุเหตุผลที่ตีกลับ',
                        columns: [
                            { label: 'เลขที่เอกสาร', render: d => `<span class="font-mono font-medium text-slate-800">${d.DocId}</span>` },
                            { label: 'วันที่', render: d => formatThaiDate(d.DocDate) },
                            { label: 'ลูกค้า', render: d => d.CustomerName || '-' },
                            { label: 'เบอร์โทร', render: d => d.CustomerPhone || '-' },
                            { label: 'วัตถุประสงค์', render: d => d.Purpose || '-' },
                            { label: 'รายการ', render: d => `${d.ItemCount || 0} รายการ` }
                        ]
                    }
                ]
            }
            ,{
                key: 'borrow',
                custom: true,   // ระบบนี้ใช้สิทธิ์จาก Permission (borrow_my_perms) + ปุ่มอนุมัติ/ปฏิเสธ/รับคืนของตัวเอง ไม่ผ่านหน้าต่างเซ็นชื่อ
                label: 'ระบบขออนุมัติยืมสินค้าหน้าร้าน (Borrow)',
                description: 'อนุมัติ/ปฏิเสธเอกสารยืมสินค้าหน้าร้านสำหรับถ่ายคลิปหรือใช้งานภายใน (การรับคืนทำที่หน้าประวัติเอกสารยืม-คืนสินค้า)',
                icon: 'package-open',
                themeColor: 'orange',
                sessionRoleKey: 'borrow_role',
                getDocId: d => d.docNo,
                isCancelled: () => false,
                fetchQueue: async () => {
                    for (let i = 0; i < 60 && !window.brwFetchQueue; i++) await new Promise(r => setTimeout(r, 50));
                    return window.brwFetchQueue ? window.brwFetchQueue() : [];
                },
                stages: [
                    {
                        key: 'approve',
                        label: 'เอกสารยืมที่รออนุมัติ / ส่งมอบ',
                        accentColor: 'orange',
                        rejectEndpoint: null,
                        canAct: () => !!(window.brwCan && (window.brwCan('APPROVE') || window.brwCan('REJECT_BACK'))),
                        matchDoc: d => d.status === 'รออนุมัติ',
                        columns: [
                            { label: 'เลขที่เอกสาร', render: d => `<button type="button" onclick="brwOpenDetail('${String(d.docNo).replace(/[^A-Za-z0-9-]/g, '')}')" class="font-mono font-semibold text-slate-800 hover:underline hover:text-orange-600" title="ดูรายละเอียดเอกสาร">${d.docNo}</button>` },
                            { label: 'ผู้ขออนุมัติ', render: d => d.borrowerName || d.borrowerEmpId || '-' },
                            { label: 'วัตถุประสงค์', render: d => d.purpose || '-' },
                            { label: 'รายการสินค้า', wrap: true, render: d => window.brwItemsStack ? window.brwItemsStack(d.itemsSummary) : '-' },
                            { label: 'วันที่ยืมสินค้า', render: d => formatThaiDate(d.borrowDate) },
                            { label: 'วันที่คืนสินค้า', render: d => formatThaiDate(d.dueDate) }
                        ],
                        renderActions: d => window.brwApproveActions ? window.brwApproveActions(d) : ''
                    }
                ]
            }
        ];

        let queueDataByModule = {};
        let currentSystemTab = 'all';

        // ===================================================================
        // สถานะพับ/กาง ของแต่ละระบบ — จำไว้ข้ามการรีเฟรชหน้า (ต่อเครื่อง/เบราว์เซอร์)
        // ===================================================================
        const COLLAPSE_STORAGE_KEY = 'ktw_approve_collapsed_modules';

        function getCollapsedModuleKeys() {
            try {
                return JSON.parse(localStorage.getItem(COLLAPSE_STORAGE_KEY) || '[]');
            } catch (e) {
                return [];
            }
        }

        function isModuleCollapsed(moduleKey) {
            return getCollapsedModuleKeys().includes(moduleKey);
        }

        function setModuleCollapsed(moduleKey, collapsed) {
            const list = getCollapsedModuleKeys();
            const idx = list.indexOf(moduleKey);
            if (collapsed && idx === -1) list.push(moduleKey);
            if (!collapsed && idx !== -1) list.splice(idx, 1);
            localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify(list));
        }

        function toggleModuleCollapse(moduleKey) {
            setModuleCollapsed(moduleKey, !isModuleCollapsed(moduleKey));
            const stagesContainer = document.getElementById(`module-stages-${moduleKey}`);
            const icon = document.getElementById(`icon-acc-${moduleKey}`);
            if (stagesContainer) stagesContainer.classList.toggle('hidden');
            if (icon) icon.classList.toggle('rotate-180');
        }

        // พับ/กางทุกระบบพร้อมกันทีเดียว (ปุ่มลัดเผื่อมีหลายระบบ)
        function collapseAllModules(shouldCollapse) {
            const allKeys = APPROVAL_MODULES.map(m => m.key);
            localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify(shouldCollapse ? allKeys : []));
            renderAllModules();
        }

        function formatThaiDate(dateStr) {
            if (!dateStr) return '-';
            const d = new Date(dateStr);
            if (isNaN(d)) return dateStr;
            return d.toLocaleDateString('th-TH-u-ca-buddhist', { day: '2-digit', month: 'short', year: 'numeric' });
        }

        function getPurposeLabelDisassembly(purpose) {
            return purpose === 'REPAIR' ? 'เพื่อซ่อม' : 'เพื่อขาย/เพื่อเคลม';
        }

        // Badge สถานะ "มี PO" ของเอกสาร Disassembly — ดึงจาก field HasPO ระดับเอกสาร
        // ⚠️ ต้องให้ SQL ของ get_all_disassembly_document_status ส่ง field นี้มาด้วย (ดูรายละเอียดที่เคยแนะนำไว้ก่อนหน้านี้)
        function getPOBadgeApprove(doc) {
            if (doc.HasPO === undefined || doc.HasPO === null) {
                return '<span class="text-slate-300">-</span>';
            }
            return doc.HasPO
                ? '<span class="inline-flex items-center whitespace-nowrap rounded-lg px-2 py-0.5 text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-100">มี PO</span>'
                : '<span class="inline-flex items-center whitespace-nowrap rounded-lg px-2 py-0.5 text-[11px] font-bold bg-slate-100 text-slate-600 border border-slate-200">ไม่มี PO</span>';
        }

        // Badge สถานะการเคลมของเอกสาร NCR
        // ⚠️ ClaimStatus เป็น NULL จนกว่าการตลาดจะเลือก — ห้ามใช้ ternary ตรง ๆ
        //    ไม่งั้นเอกสารที่ยังไม่ถึงขั้นการตลาดจะขึ้นว่า "เคลมไม่ได้" ทั้งที่ยังไม่มีใครตัดสิน
        // NCR ประเภท SCRAP ใช้ "เลขที่ WO" ประเภทอื่นใช้ "เลขที่ DO" — ค่าเก็บในคอลัมน์ DoNumber เดียวกัน
        function ncrDoLabel(doc) {
            // 🔧 29/09/2569 : ยกเลิกป้าย "เลขที่ WO" — ใช้ "เลขที่ DO" ทุกประเภท NCR (หน้างานตกลง)
            //    ค่ายังเก็บในคอลัมน์ DoNumber เดิม ไม่กระทบ backend
            return 'เลขที่ DO';
        }

        // 🆕 29/09/2569 : NCR ประเภท SCRAP เคลม VENDOR — หา sub-step ปัจจุบันของขั้น SCM จากข้อมูลเอกสาร
        //    scm1 = ยังไม่มีใครกรอก DO/ราคา, scm2 = SCM1 กรอกแล้วรอ SCM2 กรอก PO, scm_head = ครบแล้วรอหัวหน้า SCM ตัดสิน
        function ncrScmVendorPhase(doc) {
            if (!doc || !doc.Scm1At) return 'scm1';
            if (!doc.PurchaserAt) return 'scm2';
            return 'scm_head';
        }

        // 🆕 29/09/2569 : ป้ายบอก sub-step ปัจจุบันในตาราง "เอกสาร NCR ที่ รอเจ้าหน้าที่ SCM"
        function ncrScmSubPhaseLabelApprove(d) {
            if (d.NcrType !== 'SCRAP_CLAIM_VENDOR') return '<span class="text-slate-300">-</span>';
            const phase = ncrScmVendorPhase(d);
            const map = {
                scm1: 'รอ SCM คนที่ 1 (DO+ราคา)',
                scm2: 'รอ SCM คนที่ 2 (PO)',
                scm_head: 'รอหัวหน้า SCM อนุมัติ'
            };
            return `<span class="inline-flex items-center whitespace-nowrap rounded-lg px-2 py-0.5 text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-100">${map[phase]}</span>`;
        }

        // 🆕 29/09/2569 : รายชื่อ SCM (RoleId=4) สำหรับให้ SCM คนที่ 1 เลือก SCM คนที่ 2 — cache ไว้ในตัวแปรเดียวกับ session
        // 🔄 30/09/2569 : เพิ่ม scmSecondCandidates (คนที่ถูกติ๊ก "SCM คนที่ 2" จาก Employees.html ไม่ว่า role หลักจะเป็นอะไร) แยกจาก scm (RoleId=4 ล้วนๆ) เพื่อไม่ให้ปนกับช่อง "เจ้าหน้าที่แผนก SCM" ตัวหลักตอนสร้างเอกสาร
        let ncrRoleMembersCache = null;
        async function loadNcrRoleMembersForSign() {
            if (ncrRoleMembersCache) return ncrRoleMembersCache;
            try {
                const res = await n8nFetch(N8N_BASE + 'get_ncr_role_members');
                const parsed = await res.json();
                const data = Array.isArray(parsed) ? parsed[0] : parsed;
                ncrRoleMembersCache = {
                    scm: (data && data.scm) || [],
                    scmSecondCandidates: (data && data.scmSecondCandidates) || []
                };
            } catch (e) {
                console.warn('[NCR] get_ncr_role_members โหลดไม่สำเร็จ', e);
                ncrRoleMembersCache = { scm: [], scmSecondCandidates: [] };
            }
            return ncrRoleMembersCache;
        }

        // ============================================================================
        // 🆕 25/09/2569 : NCR "รายการอะไหล่ที่แยกได้" — กรอกโดย เจ้าหน้าที่แผนกรับเข้าคลังอะไหล่ (stage 'spm')
        //    ย้ายมาจากหน้าสร้างเอกสาร (ncr_form.html) — Mirror โครงสร้าง/ชื่อ class เดียวกันทุกจุด
        //    (item-prod-code, item-description ฯลฯ) เพื่อให้ใช้ autocomplete เอนจินเดียวกันได้เลย
        // ============================================================================
        let signNcrPartsItemRowCounter = 0;

        function addSignNcrPartsItemRow() {
            signNcrPartsItemRowCounter++;
            const rowId = 'sign-parts-item-row-' + signNcrPartsItemRowCounter;
            const tbody = document.getElementById('signNcrPartsItemRowsBody');
            const tr = document.createElement('tr');
            tr.id = rowId;
            tr.className = 'border-b border-slate-100 last:border-0';
            tr.innerHTML = `
                <td class="px-2 py-2 text-xs text-slate-400 text-center row-index">${tbody.children.length + 1}</td>
                <td class="px-2 py-1.5">
                    <input type="text" class="item-prod-code w-full h-9 px-2 rounded-md border border-slate-200 text-xs focus:ring-1 focus:ring-brand-500 outline-none" placeholder="ระบุรหัสอะไหล่" oninput="handleCodeAutocomplete(this)" autocomplete="off" style="text-align:center;">
                </td>
                <td class="px-2 py-1.5"><input type="text" class="item-description w-full h-9 px-2 rounded-md border border-slate-200 text-xs focus:ring-1 focus:ring-brand-500 outline-none" placeholder="ระบุรหัสอะไหล่ก่อน รายละเอียดจะเติมให้อัตโนมัติ" style="text-align:center;"></td>
                <td class="px-2 py-1.5"><input type="number" min="0" step="0.01" class="item-qty w-full h-9 px-2 rounded-md border border-slate-200 text-xs focus:ring-1 focus:ring-brand-500 outline-none" value="1" style="text-align:center;"></td>
                <td class="px-2 py-1.5"><input type="text" class="item-unit w-full h-9 px-2 rounded-md border border-slate-200 text-xs focus:ring-1 focus:ring-brand-500 outline-none" placeholder="ระบุหน่วย" style="text-align:center;"></td>
                <td class="px-2 py-1.5 text-center">
                    <button type="button" onclick="removeSignNcrPartsItemRow('${rowId}')" class="p-1 rounded text-slate-300 hover:text-red-500 hover:bg-red-50">
                        <i data-lucide="x" class="w-3.5 h-3.5"></i>
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
            lucide.createIcons();
        }

        function removeSignNcrPartsItemRow(rowId) {
            const row = document.getElementById(rowId);
            if (row) row.remove();
            document.querySelectorAll('#signNcrPartsItemRowsBody tr').forEach((tr, idx) => {
                const cell = tr.querySelector('.row-index');
                if (cell) cell.textContent = idx + 1;
            });
        }

        // includeEmptyRows = true -> ใช้ตอน validate (จับแถวที่เผลอเว้น Prod.Code ว่างไว้)
        function collectSignNcrPartsItemsData(includeEmptyRows = false) {
            const rows = document.querySelectorAll('#signNcrPartsItemRowsBody tr');
            const all = Array.from(rows).map(tr => ({
                prodCode: tr.querySelector('.item-prod-code').value.trim(),
                description: tr.querySelector('.item-description').value.trim(),
                qty: parseFloat(tr.querySelector('.item-qty').value) || 0,
                unit: tr.querySelector('.item-unit').value.trim(),
                shopName: '', // 🆕 26/09/2569 : ตัดช่องกรอกชื่อร้านออกจากตารางนี้ (ผู้สร้างเอกสารกรอกไว้แล้วตอนสร้างเอกสาร)
                remark: ''
            }));
            return includeEmptyRows ? all : all.filter(r => r.prodCode !== '');
        }

        // ================= Autocomplete Prod.Code (webhook ร่วมกับ ncr_form.html / disassembly_form.html) =================
        let autocompleteTimer = null;
        let activeAutocompleteInput = null;

        function getGlobalDropdown() {
            let dropdown = document.getElementById('globalAutocompleteDropdown');
            if (!dropdown) {
                dropdown = document.createElement('div');
                dropdown.id = 'globalAutocompleteDropdown';
                dropdown.className = 'hidden fixed z-[9999] bg-white border border-slate-200 rounded-lg shadow-2xl max-h-64 overflow-y-auto';
                document.body.appendChild(dropdown);
            }
            return dropdown;
        }

        function positionDropdownUnderInput(dropdown, inputEl) {
            const rect = inputEl.getBoundingClientRect();
            const minWidth = 280;
            dropdown.style.top = rect.bottom + 4 + 'px';
            dropdown.style.left = rect.left + 'px';
            dropdown.style.width = Math.max(rect.width, minWidth) + 'px';
            const dropdownWidth = Math.max(rect.width, minWidth);
            if (rect.left + dropdownWidth > window.innerWidth - 16) {
                dropdown.style.left = window.innerWidth - dropdownWidth - 16 + 'px';
            }
        }

        function hideGlobalDropdown() {
            const dropdown = document.getElementById('globalAutocompleteDropdown');
            if (dropdown) dropdown.classList.add('hidden');
            activeAutocompleteInput = null;
        }

        function handleCodeAutocomplete(inputEl) {
            clearTimeout(autocompleteTimer);
            const value = inputEl.value.trim();
            activeAutocompleteInput = inputEl;
            if (value.length < 2) {
                hideGlobalDropdown();
                return;
            }
            autocompleteTimer = setTimeout(async () => {
                try {
                    const res = await n8nFetch(`${N8N_BASE}autocomplete?code=${encodeURIComponent(value)}`, {
                        headers: { 'content-type': 'application/json; charset=utf-8' }
                    });
                    if (!res.ok) return;
                    const results = await res.json();
                    if (activeAutocompleteInput === inputEl) {
                        renderAutocompleteDropdown(inputEl, Array.isArray(results) ? results : []);
                    }
                } catch (err) {
                    console.error('autocomplete error', err);
                }
            }, 300);
        }

        function stockStatusBadge(status) {
            const map = {
                lowStock: '<span class="px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 text-[10px] font-medium">low stock</span>',
                inStock: '<span class="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600 text-[10px] font-medium">in stock</span>',
                outOfStock: '<span class="px-1.5 py-0.5 rounded bg-red-50 text-red-600 text-[10px] font-medium">out of stock</span>'
            };
            return map[status] || '';
        }

        function renderAutocompleteDropdown(inputEl, results) {
            const dropdown = getGlobalDropdown();
            if (results.length === 0) {
                dropdown.classList.add('hidden');
                return;
            }
            dropdown.innerHTML = '';
            results.forEach(item => {
                const code = item.code || item.Code || '';
                const name = item.name || item.Name || '';
                const manufacturers = item.manufacturers || item.Manufacturers || '';
                const stockstatus = item.stockstatus || item.stockStatus || '';

                const row = document.createElement('div');
                row.className = 'px-3 py-2 text-xs hover:bg-orange-50 cursor-pointer border-b border-slate-50 last:border-0';

                const topLine = document.createElement('div');
                topLine.className = 'flex items-center justify-between gap-2';
                const codeSpan = document.createElement('span');
                codeSpan.className = 'font-mono font-semibold text-slate-800';
                codeSpan.textContent = code;
                topLine.appendChild(codeSpan);
                const badgeHtml = stockStatusBadge(stockstatus);
                if (badgeHtml) {
                    const badgeWrap = document.createElement('span');
                    badgeWrap.innerHTML = badgeHtml; // ป้ายสถานะเป็น HTML คงที่ที่เรา generate เอง ไม่ใช่ข้อมูลดิบจาก item จึงปลอดภัย
                    topLine.appendChild(badgeWrap.firstElementChild || badgeWrap);
                }
                row.appendChild(topLine);

                const bottomLine = document.createElement('div');
                bottomLine.className = 'text-slate-500 mt-0.5';
                bottomLine.textContent = (manufacturers ? manufacturers + ' — ' : '') + name;
                row.appendChild(bottomLine);

                // 🆕 03/10/2569 : ใช้ addEventListener + closure แทน onclick='...${JSON.stringify(...)}'
                //    เดิมฝัง JSON ลงใน inline onclick ที่ครอบด้วย single quote ('...') — ถ้าชื่ออะไหล่จาก DB
                //    มีเครื่องหมาย ' (apostrophe) หลุดมา จะตัด attribute ขาดกลางคัน ทำให้กดรายการไม่ติด
                //    (ค้างเป็นแถบไฮไลต์ กดไม่เข้า) แก้โดยสร้าง element จริงแล้วผูก event ตรงๆ ไม่ง้อการ escape เลย
                row.addEventListener('click', () => selectAutocompleteItem({ code, name }));

                dropdown.appendChild(row);
            });
            positionDropdownUnderInput(dropdown, inputEl);
            dropdown.classList.remove('hidden');
        }

        function selectAutocompleteItem(item) {
            if (!activeAutocompleteInput) return;
            const row = activeAutocompleteInput.closest('tr');
            activeAutocompleteInput.value = item.code;
            if (row && item.name) {
                const descInput = row.querySelector('.item-description');
                if (descInput) descInput.value = item.name;
            }
            hideGlobalDropdown();
        }

        document.addEventListener('click', (e) => {
            if (!e.target.closest('.item-prod-code') && !e.target.closest('#globalAutocompleteDropdown')) {
                hideGlobalDropdown();
            }
        });
        document.addEventListener('scroll', (e) => {
            const dropdown = document.getElementById('globalAutocompleteDropdown');
            if (dropdown && (e.target === dropdown || dropdown.contains(e.target))) return;
            hideGlobalDropdown();
        }, true);
        window.addEventListener('resize', hideGlobalDropdown);

        function claimStatusTextApprove(doc) {
            const v = String(doc.ClaimStatus || '').trim();
            if (v === 'CLAIMABLE') return 'เคลมได้';
            if (v === 'NOT_CLAIMABLE') return 'เคลมไม่ได้';
            return '';
        }

        function getClaimStatusBadgeApprove(doc) {
            const label = claimStatusTextApprove(doc);
            if (!label) return '<span class="text-slate-300">-</span>';
            return label === 'เคลมได้'
                ? '<span class="inline-flex items-center whitespace-nowrap rounded-lg px-2 py-0.5 text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-100">เคลมได้</span>'
                : '<span class="inline-flex items-center whitespace-nowrap rounded-lg px-2 py-0.5 text-[11px] font-bold bg-slate-100 text-slate-600 border border-slate-200">เคลมไม่ได้</span>';
        }

        // ⚠️ รหัส 921 เปลี่ยนความหมายแล้ว (เดิม "เบิกอะไหล่ใส่ตัวเครื่อง" → ใหม่ "สลับสินค้ารุ่นเข้า")
        //    เอกสารเก่าจึงต้องอ่านชื่อจาก movement_type_des ของตัวเอง (พารามิเตอร์ des)
        //    map ด้านล่างเป็นแค่ fallback สำหรับเอกสารที่ยังไม่มีค่านั้น
        function purposeLabelSwap(p, des) {
            const saved = String(des || '').trim();
            if (saved) return saved;
            const map = { '309': '309 : สลับสินค้ารุ่น', '921-922': '921-922 : สลับสินค้ารุ่นเข้า/ออก', '921': '921-922 : สลับสินค้ารุ่นเข้า/ออก', '922': '921-922 : สลับสินค้ารุ่นเข้า/ออก' };
            return map[String(p)] || (p || '-');
        }

        function ncrTypeLabelApprove(doc) {
            const map = {
                SCRAP: 'SCRAP',
                SCRAP_PARTS: 'SCRAP แยกเป็นอะไหล่',
                SCRAP_CLAIM_VENDOR: 'SCRAP เคลม VENDOR',
                OTHER: doc.OtherTypeNote ? `อื่นๆ: ${doc.OtherTypeNote}` : 'อื่นๆ'
            };
            return map[doc.NcrType] || (doc.NcrType || '-');
        }

        function normalizeSwapQueueDoc(d) {
            return {
                documentId: d.documentId ?? d.doc_id,
                date: d.date ?? d.crdate ?? d.create_date,
                purpose: d.purpose ?? d.movement_type,
                purposeDes: d.purposeDes ?? d.movement_type_des ?? '',
                preparedBy: d.preparedBy ?? d.emp_name,
                // ⚠️ query จริงใน n8n ใช้ alias emp_approve / approve_date / scm_date
                // (ไม่ใช่ manager_approve / manager_approve_date / scm_approve_date แบบ raw column)
                approvedBy: d.approvedBy ?? d.emp_approve ?? d.manager_approve,
                managerApproveDate: d.managerApproveDate ?? d.approve_date ?? d.manager_approve_date,
                scmControl: d.scmControl ?? d.scm_approve,
                scmApproveDate: d.scmApproveDate ?? d.scm_date ?? d.scm_approve_date,
                remark: d.remark ?? d.remark_doc,
                status: d.status ?? d.status_doc,
                // ⚠️ ชื่อ field จริงจาก SQL ยังไม่ทราบแน่ชัด — ใส่ fallback หลายชื่อไว้กันเหนียว
                // ถ้า SQL ของ get_all_swap_document_status ยังไม่มีคอลัมน์นี้ ต้องเพิ่ม COUNT(*) รายการสินค้าเข้าไปด้วย
                itemCount: d.itemCount ?? d.ItemCount ?? d.item_count ?? 0,
                isDeleted: d.isDeleted ?? d.IsDeleted ?? false,
                // 🚀 Fast-track — SQL Server ส่ง BIT มาเป็น boolean ผ่าน n8n จึงต้องรับทั้ง true และ 1
                managerNotifyEmpId: d.managerNotifyEmpId ?? d.manager_notify_emp_id ?? '',
                scmNotifyEmpId: d.scmNotifyEmpId ?? d.scm_notify_emp_id ?? '',
                skipApprover: d.skipApprover === true || d.skip_approver === true
                              || Number(d.skipApprover) === 1 || Number(d.skip_approver) === 1
            };
        }

        // ==========================================================================================
        // FETCH DATA
        // ==========================================================================================
        async function fetchAllQueues() {
            const syncIcon = document.getElementById('syncIcon');
            const syncText = document.getElementById('syncText');
            if (syncIcon) syncIcon.classList.add('animate-spin');
            if (syncText) syncText.textContent = 'กำลังโหลด...';

            await Promise.all(APPROVAL_MODULES.map(async (mod) => {
                try {
                    if (mod.fetchQueue) { queueDataByModule[mod.key] = (await mod.fetchQueue()).filter(d => !mod.isCancelled(d)); return; }
                    const res = await n8nFetch(N8N_BASE + mod.queueEndpoint);
                    if (!res.ok) throw new Error('โหลดข้อมูลไม่สำเร็จ: ' + res.status);
                    // ⚠️ อ่าน text ก่อนเสมอ แล้วค่อย parse เอง
                    //    SQL node ที่ปิด Always Output Data ไว้ (ตามที่ควรเป็น) จะทำให้ n8n คืน body ว่าง
                    //    เมื่อไม่มีเอกสารค้าง — res.json() จะโยน "Unexpected end of JSON input"
                    //    แล้วขึ้น toast ว่าโหลดคิวไม่สำเร็จ ทั้งที่ความจริงคือ "ไม่มีเอกสารรอดำเนินการ"
                    const rawText = await res.text();
                    const raw = rawText && rawText.trim() ? JSON.parse(rawText) : [];
                    // ทิ้ง item ว่างที่หลุดมาจาก node ที่ยังเปิด Always Output Data อยู่ ({} ไม่มี DocId)
                    let list = (Array.isArray(raw) ? raw : [])
                        .filter(d => d && Object.keys(d).length > 0);

                    if (mod.key === 'swap') {
                        list = list.map(normalizeSwapQueueDoc);
                    }

                    queueDataByModule[mod.key] = list.filter(d => !mod.isCancelled(d));
                } catch (err) {
                    console.error(`โหลดคิวระบบ ${mod.label} ไม่สำเร็จ:`, err);
                    queueDataByModule[mod.key] = queueDataByModule[mod.key] || [];
                    showNotification('โหลดข้อมูลบางส่วนไม่สำเร็จ', `ไม่สามารถโหลดคิวของระบบ ${mod.label} ได้ กด "ซิงค์ข้อมูลล่าสุด" อีกครั้งภายหลัง`, 'warning');
                }
            }));

            renderSystemTabs();
            renderAllModules();
            filterApprovalTables();

            if (syncIcon) syncIcon.classList.remove('animate-spin');
            if (syncText) syncText.textContent = 'ซิงค์ข้อมูลล่าสุด';
        }

        // ==========================================================================================
        // แท็บกรองระบบ (รวมทุกระบบ / ต่อระบบ) — สร้างแบบไดนามิกพร้อมจำนวนรายการจริง
        // ==========================================================================================
        function computeModuleTotal(mod) {
            const role = getEffectiveRole(mod.sessionRoleKey);
            const docs = queueDataByModule[mod.key] || [];
            // 🔒 นับเฉพาะ stage ที่ role นี้มีสิทธิ์อนุมัติจริงเท่านั้น (Admin ครอบคลุมอยู่แล้ว เพราะทุก canAct เช็ค role==='1' ด้วย)
            return mod.stages.reduce((sum, stage) => {
                if (!stage.canAct(role)) return sum;
                return sum + docs.filter(stage.matchDoc).length;
            }, 0);
        }

        function renderSystemTabs() {
            const bar = document.getElementById('systemTabsBar');

            // 🔒 แสดง tab เฉพาะระบบที่ role นี้มีสิทธิ์อนุมัติอย่างน้อย 1 stage (Admin ผ่านเงื่อนไขนี้เสมอ)
            const visibleModules = APPROVAL_MODULES.filter(mod => {
                const role = getEffectiveRole(mod.sessionRoleKey);
                return mod.stages.some(stage => stage.canAct(role));
            });

            const grandTotal = visibleModules.reduce((sum, mod) => sum + computeModuleTotal(mod), 0);

            document.getElementById('totalPendingBadge').textContent = `${grandTotal} รายการค้าง`;

            const allTabActive = currentSystemTab === 'all';
            let html = `
                <button onclick="filterSystemTab('all')" id="tab-system-all"
                    class="system-tab-btn px-4 py-2 text-xs font-medium rounded-xl transition-all flex items-center gap-2 whitespace-nowrap ${allTabActive ? 'bg-brand-500 text-white font-semibold shadow-sm' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'}">
                    <i data-lucide="layers" class="w-4 h-4"></i>
                    <span>ทั้งหมดทุกระบบ</span>
                    <span class="ml-1 px-1.5 py-0.5 text-[10px] rounded-full font-bold ${allTabActive ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-600'}">${grandTotal}</span>
                </button>
            `;

            html += visibleModules.map(mod => {
                const total = computeModuleTotal(mod);
                const accent = ACCENT_MAP[mod.themeColor] || ACCENT_MAP.amber;
                const isActive = currentSystemTab === mod.key;
                return `
                    <button onclick="filterSystemTab('${mod.key}')" id="tab-system-${mod.key}"
                        class="system-tab-btn px-4 py-2 text-xs font-medium rounded-xl transition-all flex items-center gap-2 whitespace-nowrap ${isActive ? 'bg-brand-500 text-white font-semibold shadow-sm' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'}">
                        <span class="w-2.5 h-2.5 rounded-full ${isActive ? 'bg-white' : accent.dot}"></span>
                        <span>${mod.label.split('(')[0].trim()}</span>
                        <span class="ml-1 px-1.5 py-0.5 text-[10px] rounded-full font-bold ${isActive ? 'bg-white/20 text-white' : accent.badgeBg + ' ' + accent.badgeText}">${total}</span>
                    </button>
                `;
            }).join('');

            bar.innerHTML = html;
            lucide.createIcons();
        }

        function filterSystemTab(sysKey) {
            currentSystemTab = sysKey;
            renderSystemTabs();

            APPROVAL_MODULES.forEach(mod => {
                const block = document.getElementById(`block-${mod.key}`);
                if (!block) return;
                const shouldShow = (sysKey === 'all' || sysKey === mod.key);
                block.style.display = shouldShow ? 'block' : 'none';
            });

            // เปิด accordion ของระบบที่ถูกเลือกอัตโนมัติ ถ้าบังเอิญพับอยู่ (กันงงว่าทำไมไม่เห็นตาราง)
            if (sysKey !== 'all' && isModuleCollapsed(sysKey)) {
                setModuleCollapsed(sysKey, false);
                const stagesContainer = document.getElementById(`module-stages-${sysKey}`);
                const icon = document.getElementById(`icon-acc-${sysKey}`);
                if (stagesContainer) stagesContainer.classList.remove('hidden');
                if (icon) icon.classList.add('rotate-180');
            }

            filterApprovalTables();
        }

        // ค้นหาแบบ Live ในทุกตาราง (ทำงานร่วมกับแท็บกรองระบบ — ซ่อนแถวที่ไม่ตรงคำค้นเฉพาะใน block ที่โชว์อยู่)
        function filterApprovalTables() {
            const query = (document.getElementById('globalSearchInput').value || '').trim().toLowerCase();
            document.querySelectorAll('.approval-table tbody tr').forEach(row => {
                if (!query) { row.style.display = ''; return; }
                const text = row.textContent.toLowerCase();
                row.style.display = text.includes(query) ? '' : 'none';
            });
        }

        // ==========================================================================================
        // เรนเดอร์ทุก Module + Stage แบบไดนามิก
        // ==========================================================================================
        // ==========================================================================================
        // 🆕 ปุ่ม "ซ่อนเอกสารของคนอื่น" — ค่าเริ่มต้นเปิดทุกครั้งที่เข้าหน้า (ไม่จำค่า) กดปิดเองเมื่อต้องการอนุมัติแทนเพื่อนร่วมทีม
        //    "เอกสารของคนอื่น" = เอกสารที่ระบุผู้รับในขั้นนั้นเป็นคนอื่น; เอกสารที่ไม่ระบุผู้รับ (เป็นคิวกลางของทีม) จะแสดงเสมอ
        //    ซ่อนเฉพาะการแสดงผล ไม่ได้ตัดสิทธิ์อนุมัติแทนกัน
        // ==========================================================================================
        let hideOthersDocs = true;
        // ผู้รับเอกสารของแต่ละขั้น = ค่าในคอลัมน์ที่ระบุใน stage.recipientKeys (รหัสพนักงานที่เลือกไว้ตอนสร้างเอกสาร)
        // ไม่ระบุ/ว่าง = ไม่มีผู้รับเฉพาะคน (คิวกลางของทีม) → ไม่ซ่อน
        function isOthersDoc(doc, stage) {
            const keys = (stage && Array.isArray(stage.recipientKeys)) ? stage.recipientKeys : [];
            const me = String(empId).trim().toLowerCase();
            const ids = keys.map(k => doc && doc[k]).filter(v => v != null && String(v).trim() !== '').map(v => String(v).trim().toLowerCase());
            if (!ids.length) return false;
            return !ids.includes(me);
        }
        function toggleHideOthers() {
            hideOthersDocs = !hideOthersDocs;
            renderSystemTabs();
            renderAllModules();
            filterApprovalTables();
        }

        function renderAllModules() {
            const container = document.getElementById('approvalModulesContainer');
            let hasAnyPermission = false;

            container.innerHTML = APPROVAL_MODULES.map((mod, modIdx) => {
                const role = getEffectiveRole(mod.sessionRoleKey);
                const docs = queueDataByModule[mod.key] || [];
                const themeAccent = ACCENT_MAP[mod.themeColor] || ACCENT_MAP.amber;

                // 🔒 ถ้า role นี้ไม่มีสิทธิ์อนุมัติ stage ไหนเลยในระบบนี้ ไม่ต้องแสดง module ทั้งก้อน (Admin ผ่านเงื่อนไขนี้เสมอ)
                const hasPermissionInModule = mod.stages.some(stage => stage.canAct(role));
                if (!hasPermissionInModule) return '';

                let totalPendingForModule = 0;

                const stagesHTML = mod.stages.map((stage, stageIdx) => {
                    const canAct = stage.canAct(role);
                    if (canAct) hasAnyPermission = true;

                    // 🔒 เข้มงวดสุด: เห็นเฉพาะ stage ที่มีสิทธิ์อนุมัติจริงเท่านั้น (Admin ครอบคลุมอยู่แล้ว เพราะทุก canAct เช็ค role==='1' ด้วย)
                    if (!canAct) return '';

                    const allStageDocs = docs.filter(stage.matchDoc);
                    const stageDocs = hideOthersDocs ? allStageDocs.filter(d => !isOthersDoc(d, stage)) : allStageDocs;
                    const hiddenOthersCount = allStageDocs.length - stageDocs.length;
                    totalPendingForModule += stageDocs.length;
                    const hideBtnHtml = `<label class="inline-flex items-center gap-2 cursor-pointer select-none" title="เปิด = ซ่อนเอกสารที่ส่งถึงคนอื่น เหลือเฉพาะของคุณ / ปิด = เห็นทุกใบ (เช่น อนุมัติแทนเพื่อนร่วมทีม)" onclick="event.stopPropagation()">
                        <span class="sw"><input type="checkbox" ${hideOthersDocs ? 'checked' : ''} onchange="toggleHideOthers()" aria-label="ซ่อนเอกสารของคนอื่น"><span></span></span>
                        <span class="text-[11px] font-semibold text-slate-600">ซ่อนเอกสารของคนอื่น</span>
                    </label>`;

                    const accent = ACCENT_MAP[stage.accentColor] || ACCENT_MAP.amber;
                    const isFirstStage = stage.rejectEndpoint === null;
                    const isLastStage = stageIdx === mod.stages.length - 1;
                    const stageTagHtml = mod.custom ? '' : isFirstStage
                        ? `<span class="text-[11px] text-amber-700 font-medium bg-amber-50 px-2 py-0.5 rounded border border-amber-200 shrink-0">ขั้นตอนแรก</span>`
                        : (isLastStage ? `<span class="text-[11px] text-emerald-700 font-medium bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 shrink-0">ขั้นตอนสุดท้าย</span>` : '');

                    const theadCols = stage.columns.map(c => `<th class="py-3 px-4 text-[11px] font-bold text-slate-600 uppercase tracking-wider whitespace-nowrap">${c.label}</th>`).join('')
                        + `<th class="py-3 px-4 text-[11px] font-bold text-slate-600 uppercase tracking-wider text-center whitespace-nowrap">จัดการ</th>`;

                    const rowsHTML = stageDocs.length === 0
                        ? `<tr><td colspan="${stage.columns.length + 1}" class="px-4 py-8 text-center text-sm text-slate-400">${hiddenOthersCount > 0 ? `ไม่มีเอกสารที่ส่งถึงคุณ (ซ่อนเอกสารของคนอื่นอยู่ ${hiddenOthersCount} รายการ)` : 'ไม่มีเอกสารรอดำเนินการ'}</td></tr>`
                        : stageDocs.map(doc => {
                            const docId = mod.getDocId(doc);
                            const tds = stage.columns.map((c, ci) => {
                                const cellContent = c.render(doc);
                                // เพิ่มปุ่มคัดลอกเลขที่เอกสารในคอลัมน์แรกเท่านั้น (สอดคล้องกับที่คอลัมน์แรกมักเป็นเลขที่เอกสาร)
                                if (ci === 0) {
                                    return `<td class="py-3.5 px-4 text-sm text-slate-600 whitespace-nowrap">
                                        <div class="flex items-center gap-1.5 group">
                                            <span>${cellContent}</span>
                                            <button title="คัดลอกเลขที่เอกสาร" onclick="copyText('${docId}')" class="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-slate-600 transition-opacity">
                                                <i data-lucide="copy" class="w-3 h-3"></i>
                                            </button>
                                        </div>
                                    </td>`;
                                }
                                return `<td class="py-3.5 px-4 text-sm text-slate-600 ${c.wrap ? '' : 'whitespace-nowrap'}">${cellContent}</td>`;
                            }).join('');
                            const canActThisDoc = stage.canAct(role, doc);
                            const actionBtn = stage.renderActions ? stage.renderActions(doc) : canActThisDoc
                                ? `<button onclick="openSignModal('${mod.key}', '${stage.key}', '${docId}')" class="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold bg-brand-500 text-white hover:bg-brand-600 shadow-xs active:scale-95">
                                     <i data-lucide="file-signature" class="w-3.5 h-3.5"></i> ตรวจสอบ/เซ็น
                                   </button>`
                                : `<button onclick="viewOnly('${mod.key}', '${stage.key}', '${docId}')" class="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-medium text-slate-500 hover:bg-slate-100">
                                     <i data-lucide="eye" class="w-3.5 h-3.5"></i> ดูรายละเอียด
                                   </button>`;
                            return `<tr class="hover:bg-slate-50/70 transition-colors group">${tds}<td class="py-3.5 px-4 text-center whitespace-nowrap">${actionBtn}</td></tr>`;
                        }).join('');

                    return `
                        <div class="space-y-3">
                            <div class="flex flex-wrap items-center justify-between gap-2 border-l-4 ${accent.border} pl-3 py-0.5">
                                <div class="flex items-center gap-2 flex-wrap">
                                    <span class="w-2 h-2 rounded-full ${accent.dot}"></span>
                                    <h3 class="text-xs sm:text-sm font-bold text-slate-800">${stage.label}</h3>
                                    <span class="text-xs text-slate-400 font-medium">(${stageDocs.length} รายการ${hiddenOthersCount > 0 ? ` · ซ่อน ${hiddenOthersCount}` : ''})</span>
                                </div>
                                <div class="flex items-center gap-2 flex-wrap">${hideBtnHtml}${stageTagHtml}</div>
                            </div>
                            <div class="overflow-x-auto rounded-xl border border-slate-200 shadow-xs">
                                <table class="w-full text-left border-collapse approval-table min-w-[800px]">
                                    <thead><tr class="bg-slate-100/70 border-b border-slate-200">${theadCols}</tr></thead>
                                    <tbody class="divide-y divide-slate-100 text-xs bg-white">${rowsHTML}</tbody>
                                </table>
                            </div>
                        </div>
                    `;
                }).join('');

                const collapsed = isModuleCollapsed(mod.key);
                const blockDisplay = (currentSystemTab === 'all' || currentSystemTab === mod.key) ? 'block' : 'none';

                return `
                    <div class="system-block" id="block-${mod.key}" style="display:${blockDisplay};">
                        <div class="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
                            <div onclick="toggleModuleCollapse('${mod.key}')" class="p-4 bg-slate-50/80 hover:bg-slate-100/80 border-b border-slate-200 cursor-pointer transition-colors flex items-center justify-between select-none gap-3">
                                <div class="flex items-center gap-3 min-w-0">
                                    <div class="p-2 ${themeAccent.badgeBg} ${themeAccent.badgeText} rounded-xl shadow-xs shrink-0">
                                        <i data-lucide="${mod.icon}" class="w-5 h-5"></i>
                                    </div>
                                    <div class="min-w-0">
                                        <div class="flex items-center gap-2 flex-wrap">
                                            <h2 class="text-sm sm:text-base font-bold text-slate-900">${mod.label}</h2>
                                            <span class="px-2.5 py-0.5 text-xs font-semibold ${themeAccent.badgeBg} ${themeAccent.badgeText} rounded-full border ${themeAccent.badgeBorder}">
                                                ${totalPendingForModule} เอกสารรอดำเนินการ
                                            </span>
                                        </div>
                                        <p class="text-xs text-slate-500 truncate">${mod.description}</p>
                                    </div>
                                </div>
                                <i data-lucide="chevron-down" id="icon-acc-${mod.key}" class="w-5 h-5 text-slate-400 transition-transform duration-300 shrink-0 ${collapsed ? '' : 'rotate-180'}"></i>
                            </div>
                            <div id="module-stages-${mod.key}" class="p-4 sm:p-5 space-y-6 accordion-content ${collapsed ? 'hidden' : ''}">
                                ${stagesHTML}
                            </div>
                        </div>
                    </div>
                `;
            }).join('');

            document.getElementById('noPermissionNotice').classList.toggle('hidden', hasAnyPermission);
            lucide.createIcons();
        }

        function getModule(key) {
            return APPROVAL_MODULES.find(m => m.key === key);
        }
        function getStage(mod, stageKey) {
            return mod.stages.find(s => s.key === stageKey);
        }

        // คัดลอกเลขที่เอกสารไปยัง Clipboard
        function copyText(text) {
            if (navigator.clipboard) {
                navigator.clipboard.writeText(text).catch(() => {});
            }
            showNotification('คัดลอกแล้ว', `คัดลอกเลขที่เอกสาร ${text} ไปยังคลิปบอร์ดแล้ว`, 'success');
        }

        // ==========================================================================================
        // SIGN MODAL
        // ==========================================================================================
        // ===================================================================
        // SWAP: รายชื่อ MCM / SPM สำหรับ dropdown ใน Sign Modal
        // ใช้ webhook เดิม get_swap_role_members ที่เพิ่ม role 6/7 เข้าไปแล้ว
        // ⚠️ อ่านด้วย text() ก่อนเสมอ กัน response ว่างแล้ว res.json() โยน error
        // cache ไว้ เรียกครั้งเดียวต่อการเปิดหน้า
        // ===================================================================
        let swapRoleMembersCache = null;

        async function loadSwapRoleMembersForSign() {
            if (swapRoleMembersCache) return swapRoleMembersCache;
            try {
                // ⚠️ Webhook - Get SWAP Role Members ตั้งเป็น GET (swap_product.html ก็เรียกแบบ GET)
                //    ห้ามยิง POST — n8n จะคืน 404 ที่ไม่มี CORS header แล้ว browser จะรายงานเป็น CORS error
                //    ทำให้ไล่บั๊กผิดทาง ทั้งที่ต้นเหตุคือ method ไม่ตรงกับ webhook
                const res = await n8nFetch(N8N_BASE + 'get_swap_role_members');
                if (!res.ok) throw new Error('HTTP ' + res.status);
                const rawText = await res.text();
                const parsed = rawText && rawText.trim() ? JSON.parse(rawText) : {};
                // รองรับทั้งกรณี Respond to Webhook คืน object ตรง ๆ และกรณีห่อเป็น array 1 item
                const data = Array.isArray(parsed) ? (parsed[0] || {}) : (parsed || {});
                swapRoleMembersCache = {
                    mcm: Array.isArray(data.mcm) ? data.mcm : [],
                    spm: Array.isArray(data.spm) ? data.spm : []
                };
                if (!swapRoleMembersCache.mcm.length && !swapRoleMembersCache.spm.length) {
                    console.warn('[SWAP] get_swap_role_members ตอบกลับแล้วแต่ไม่มีรายชื่อ MCM/SPM — ตรวจสิทธิ์พนักงาน role 6/7', parsed);
                }
            } catch (e) {
                console.warn('[SWAP] โหลดรายชื่อ MCM/SPM ไม่สำเร็จ', e);
                swapRoleMembersCache = { mcm: [], spm: [] };
            }
            return swapRoleMembersCache;
        }

        function fillSwapNotifySelect(selectId, members, emptyLabel) {
            const sel = document.getElementById(selectId);
            if (!sel) return;
            sel.innerHTML = `<option value="">${emptyLabel}</option>` + members.map(m =>
                `<option value="${m.empId}" data-name="${m.name}" data-email="${m.email}">${m.name} (${m.empId})</option>`
            ).join('');
            sel.value = '';
        }

        // 🔄 SWAP stage 'scm': สลับระหว่างโหมดแสดงผล (ข้อความ + ปุ่ม "แก้ไข") กับโหมดแก้ไข (dropdown เลือกวัตถุประสงค์ใหม่)
        //    open === false บังคับกลับไปโหมดแสดงผล (ใช้ตอนเปิด modal ใหม่ทุกครั้ง และตอนกด "ยกเลิก" — คืนค่า dropdown กลับเป็นค่าเดิมของเอกสารด้วย)
        //    ไม่ส่ง argument = สลับสถานะปัจจุบัน
        let swapPurposeOriginalCode = '309';
        function toggleSwapPurposeEdit(open) {
            const text = document.getElementById('swapPurposeText');
            const btn = document.getElementById('swapPurposeEditBtn');
            const select = document.getElementById('signSwapMovementType');
            if (!text || !btn || !select) return;
            const opening = typeof open === 'boolean' ? open : select.classList.contains('hidden');
            if (!opening) select.value = swapPurposeOriginalCode;
            text.classList.toggle('hidden', opening);
            select.classList.toggle('hidden', !opening);
            btn.textContent = opening ? 'ยกเลิก' : 'แก้ไข';
        }

        async function openSignModal(moduleKey, stageKey, docId) {
            const mod = getModule(moduleKey);
            const stage = getStage(mod, stageKey);

            document.getElementById('signModuleKey').value = moduleKey;
            document.getElementById('signDocId').value = docId;
            document.getElementById('signStageKey').value = stageKey;
            document.getElementById('signModalSystemName').textContent = `${mod.label} — ${stage.label}`;
            document.getElementById('signModalDocIdText').textContent = docId;
            document.getElementById('signComment').value = '';
            document.getElementById('signSignerName').textContent = empName || 'ผู้ใช้งานปัจจุบัน';

            // 🏷️ ปุ่มพิมพ์บัตรขอแกะอะไหล่ — โชว์เฉพาะระบบ Disassembly เท่านั้น (ทุก stage เพราะอาจต้องพิมพ์ซ้ำ/พิมพ์ล่วงหน้าได้)
            document.getElementById('signStickerBtn').classList.toggle('hidden', moduleKey !== 'disassembly');

            // 📝 Disassembly stage 'marketing': บังคับกรอกความเห็น — เปลี่ยนป้าย/placeholder ให้เห็นชัดว่าบังคับ (หน้างานตกลง 22/09/2026)
            const isDisassemblyMarketingStage = moduleKey === 'disassembly' && stageKey === 'marketing';
            document.getElementById('signCommentLabel').innerHTML = isDisassemblyMarketingStage
                ? 'ความเห็นประกอบการอนุมัติ <span class="text-red-500">*</span>'
                : 'ความเห็นประกอบการอนุมัติ (ถ้ามี)';
            document.getElementById('signComment').placeholder = isDisassemblyMarketingStage
                ? 'กรุณาระบุความเห็นประกอบการอนุมัติ (บังคับกรอก)'
                : 'เช่น ตรวจสอบแล้วถูกต้อง / ให้เร่งดำเนินการ';

            const rejectBtn = document.getElementById('signRejectBtn');
            rejectBtn.classList.toggle('hidden', !stage.rejectEndpoint);
            if (stage.rejectEndpoint) {
                document.getElementById('signRejectBtnText').textContent = stage.rejectLabel || 'ปฏิเสธเอกสาร';
            }

            document.getElementById('submitSignBtnText').textContent = stage.approveButtonLabel || 'ยืนยันอนุมัติ';

            // 🔢 ช่องกรอกเลข ODO — แสดงเฉพาะ Disassembly stage 'scm' เท่านั้น (บังคับกรอกก่อนกดยืนยัน)
            const odoWrap = document.getElementById('signOdoNumberWrap');
            const isOdoStage = moduleKey === 'disassembly' && stageKey === 'scm';
            odoWrap.classList.toggle('hidden', !isOdoStage);
            document.getElementById('signOdoNumber').value = '';

            // 🆕 24/09/2569 : ช่องกรอกเลข Inbound — แสดงเฉพาะ Disassembly stage 'scm' เท่านั้น (ไม่บังคับกรอก)
            const inboundWrap = document.getElementById('signInboundNumberWrap');
            inboundWrap.classList.toggle('hidden', !isOdoStage);
            document.getElementById('signInboundNumber').value = '';

            // 🆕 24/09/2569 (เพิ่มรอบ 2) : ช่องกรอกเลข Reservation — แสดงเฉพาะ Disassembly stage 'scm' เท่านั้น (ไม่บังคับกรอก)
            const reservationWrap = document.getElementById('signReservationNumberWrap');
            reservationWrap.classList.toggle('hidden', !isOdoStage);
            document.getElementById('signReservationNumber').value = '';

            // 🔄 SWAP stage 'scm' — ช่อง ODO / Inbound / dropdown ผู้รับต่อ (ทุกช่องไม่บังคับ)
            const swapWrap = document.getElementById('signSwapInboundWrap');
            const isSwapScmStage = moduleKey === 'swap' && stageKey === 'scm';
            swapWrap.classList.toggle('hidden', !isSwapScmStage);
            if (isSwapScmStage) {
                document.getElementById('signSwapOdo').value = '';
                document.getElementById('signSwapInboundMcm').value = '';
                document.getElementById('signSwapInboundSpm').value = '';
                // ไม่ await เพื่อไม่ให้ modal ค้างรอ — dropdown จะเติมรายชื่อเองเมื่อโหลดเสร็จ
                loadSwapRoleMembersForSign().then(m => {
                    fillSwapNotifySelect('signSwapMcmNotify', m.mcm, '-- ไม่ส่งต่อให้ MCM --');
                    fillSwapNotifySelect('signSwapSpmNotify', m.spm, '-- ไม่ส่งต่อให้ SPM --');
                });
            }

            // 🏷️ NCR: ช่องสถานะการเคลม (stage 'mkt') — reset ทุกครั้งที่เปิด modal ใหม่
            const claimWrap = document.getElementById('signNcrClaimStatusWrap');
            const isNcrClaimStage = moduleKey === 'ncr' && stageKey === 'mkt';
            claimWrap.classList.toggle('hidden', !isNcrClaimStage);
            document.querySelectorAll('input[name="signNcrClaimStatus"]').forEach(r => r.checked = false);

            // 🧾 CLAIM: ช่องผลการพิจารณา (stage 'mkt') — reset ทุกครั้งที่เปิด modal ใหม่
            const claimResultWrap = document.getElementById('signClaimResultWrap');
            const isClaimMktStage = moduleKey === 'claim' && stageKey === 'mkt';
            claimResultWrap.classList.toggle('hidden', !isClaimMktStage);
            document.querySelectorAll('input[name="signClaimResult"]').forEach(r => { r.checked = false; r.disabled = false; });

            // 🏷️ NCR: ช่องเลขที่ DO/Inbound/PO (stage 'scm') — ซ่อนไว้ก่อน รอ loadDocDetailIntoSignModal เปิดช่องย่อยตาม NcrType
            const docNumbersWrap = document.getElementById('signNcrDocNumbersWrap');
            const isNcrScmStage = moduleKey === 'ncr' && stageKey === 'scm';
            docNumbersWrap.classList.toggle('hidden', !isNcrScmStage);
            document.getElementById('signNcrDoWrap').classList.add('hidden');
            document.getElementById('signNcrInboundWrap').classList.add('hidden');
            document.getElementById('signNcrPoWrap').classList.add('hidden');
            document.getElementById('signNcrDoNumber').value = '';
            document.getElementById('signNcrInboundNumber').value = '';
            document.getElementById('signNcrPoNumber').value = '';
            document.getElementById('signNcrWaveNumber').value = '';
            document.getElementById('signNcrWaveWrap').classList.add('hidden');
            document.getElementById('signNcrDoLabel').textContent = 'เลขที่ DO';
            document.getElementById('signNcrDoNumber').placeholder = 'ระบุเลขที่ DO (ถ้ามี)';

            // 🆕 25/09/2569 : NCR "รายการอะไหล่ที่แยกได้" (stage 'spm' เท่านั้น) — reset ทุกครั้งที่เปิด modal ใหม่ เริ่มด้วย 1 แถวว่าง
            const partsItemsWrap = document.getElementById('signNcrPartsItemsWrap');
            const isNcrSpmStage = moduleKey === 'ncr' && stageKey === 'spm';
            partsItemsWrap.classList.toggle('hidden', !isNcrSpmStage);
            if (isNcrSpmStage) {
                document.getElementById('signNcrPartsItemRowsBody').innerHTML = '';
                addSignNcrPartsItemRow();
            }

            await loadDocDetailIntoSignModal(mod, docId, stageKey);

            // 🔄 SWAP stage 'scm': เติมค่าวัตถุประสงค์ปัจจุบันของเอกสารลง dropdown ให้ SCM แก้ไขก่อนอนุมัติ
            //    รหัสเก่า 921/922 (ความหมายเดิม) ก็ map เข้า 921-922 เหมือนกับ purposeLabelSwap()
            if (isSwapScmStage && currentSignDoc) {
                const rawPurpose = String(currentSignDoc.purpose ?? currentSignDoc.movement_type ?? '').trim();
                const normalizedPurpose = ['921', '922', '921-922'].includes(rawPurpose) ? '921-922' : (rawPurpose || '309');
                swapPurposeOriginalCode = normalizedPurpose;
                document.getElementById('signSwapMovementType').value = normalizedPurpose;
                // แสดงปุ่ม "แก้ไข" เฉพาะขั้น SCM และเริ่มต้นทุกครั้งที่เปิด modal ด้วยโหมดแสดงผล (ไม่ใช่โหมดแก้ไข)
                const editBtn = document.getElementById('swapPurposeEditBtn');
                if (editBtn) editBtn.classList.remove('hidden');
                toggleSwapPurposeEdit(false);
            }

            // 🏷️ NCR: ปุ่ม "ตีกลับ" ต้อง Dynamic ต่อเอกสาร ไม่ใช่ per-stage แบบ SWAP/Disassembly
            // เพราะ "Stage แรก" ของ NCR ไม่คงที่ (StepNo 0, 1 หรือ 3 แล้วแต่ประเภท/Fast-track)
            // เงื่อนไข: ซ่อนปุ่มถ้ามีผู้อนุมัติขั้นใดขั้นหนึ่งเซ็นไปแล้ว (ไม่ว่าเอกสารจะอยู่ StepNo ไหนตอนนี้)
            if (moduleKey === 'ncr' && currentSignDoc) {
                const hasAnyApproval = !!(currentSignDoc.MidApproverName || currentSignDoc.MarketingName
                    || currentSignDoc.ScmName || currentSignDoc.LogByName || currentSignDoc.InboundConfirmByName);
                rejectBtn.classList.toggle('hidden', hasAnyApproval);
            }

            // 🏷️ NCR: เปิดช่องย่อยตามประเภท NCR ของเอกสารที่เพิ่งโหลดมา — ทุกช่องไม่บังคับกรอก
            //    SCRAP              : เลขที่ WO, Wave
            //    SCRAP_PARTS        : เลขที่ DO, Inbound
            //    SCRAP_CLAIM_VENDOR : เลขที่ DO, PO
            //    OTHER              : เลขที่ DO, Wave, Inbound, PO
            //    ⚠️ ต้องตรงกับ n8n node "Code - Validate SCM Document Numbers"
            if (isNcrScmStage && currentSignDoc) {
                const ncrType = currentSignDoc.NcrType;
                const isVendor = ncrType === 'SCRAP_CLAIM_VENDOR';

                document.getElementById('signNcrScmVendorWrap').classList.toggle('hidden', !isVendor);
                document.getElementById('signNcrScm1Wrap').classList.add('hidden');
                document.getElementById('signNcrScm2Wrap').classList.add('hidden');
                document.getElementById('signNcrScmHeadWrap').classList.add('hidden');

                if (isVendor) {
                    // 🆕 29/09/2569 : VENDOR ใช้ฟอร์ม 3 sub-step แทน — ซ่อนช่องกรอกเลขที่อ้างอิงแบบเดิมทั้งหมด
                    document.getElementById('signNcrDoWrap').classList.add('hidden');
                    document.getElementById('signNcrWaveWrap').classList.add('hidden');
                    document.getElementById('signNcrInboundWrap').classList.add('hidden');
                    document.getElementById('signNcrPoWrap').classList.add('hidden');

                    const phase = ncrScmVendorPhase(currentSignDoc);
                    if (phase === 'scm1') {
                        document.getElementById('signNcrScm1Wrap').classList.remove('hidden');
                        document.getElementById('signNcrScm1Do').value = '';
                        // 🔧 30/09/2569 : ราคาย้ายไปกรอกทีละรายการในตารางด้านบนแล้ว ไม่มีช่อง signNcrScm1Price ให้ reset อีกต่อไป
                        loadNcrRoleMembersForSign().then(m => {
                            // 🔄 30/09/2569 : เปลี่ยนมาใช้ m.scmSecondCandidates (คนที่ถูกติ๊ก "SCM คนที่ 2" จาก Employees.html) แทน m.scm (ซึ่งกลับไปหมายถึง RoleId=4 ล้วนๆ เหมือนเดิม เพื่อไม่ให้ปนกับช่อง "เจ้าหน้าที่แผนก SCM" ตัวหลัก)
                            fillSwapNotifySelect('signNcrScm2Select', m.scmSecondCandidates.filter(x => x.empId !== empId), '-- เลือก SCM คนที่ 2 --');
                        });
                    } else if (phase === 'scm2') {
                        document.getElementById('signNcrScm2Wrap').classList.remove('hidden');
                        document.getElementById('signNcrScm2DoDisplay').textContent = currentSignDoc.DoNumber || '-';
                        document.getElementById('signNcrScm2Po').value = '';
                    } else {
                        document.getElementById('signNcrScmHeadWrap').classList.remove('hidden');
                        document.getElementById('signNcrScmHeadDoDisplay').textContent = currentSignDoc.DoNumber || '-';
                        // 🔧 30/09/2569 : ราคาแสดงเป็นรายรายการในตาราง "รายการที่เกี่ยวข้องกับเอกสารนี้" ด้านบนแล้ว (อ่านอย่างเดียว) ไม่ต้องมีสรุปราคารวมตรงนี้อีก
                        document.getElementById('signNcrScmHeadPoDisplay').textContent = currentSignDoc.PoNumber || '-';
                        document.querySelectorAll('input[name="signNcrScmHeadDecision"]').forEach(r => r.checked = false);
                    }
                } else {
                    const showDo = ['SCRAP', 'SCRAP_PARTS', 'OTHER'].includes(ncrType);
                    const showWave = ['SCRAP', 'OTHER'].includes(ncrType);
                    const showInbound = ['SCRAP_PARTS', 'OTHER'].includes(ncrType);
                    const showPo = ['OTHER'].includes(ncrType);
                    document.getElementById('signNcrDoWrap').classList.toggle('hidden', !showDo);
                    document.getElementById('signNcrWaveWrap').classList.toggle('hidden', !showWave);
                    document.getElementById('signNcrInboundWrap').classList.toggle('hidden', !showInbound);
                    document.getElementById('signNcrPoWrap').classList.toggle('hidden', !showPo);

                    const doLabel = ncrDoLabel(currentSignDoc);
                    document.getElementById('signNcrDoLabel').textContent = doLabel;
                    document.getElementById('signNcrDoNumber').placeholder = 'ระบุ' + doLabel + (ncrType === 'SCRAP' || ncrType === 'SCRAP_PARTS' ? '' : ' (ถ้ามี)');

                    // 🆕 30/09/2569 : SCRAP บังคับกรอกเลขที่ DO + Wave, SCRAP_PARTS บังคับกรอกเลขที่ DO + Inbound (หน้างานตกลง)
                    //    ป้ายต้องตรงกับเงื่อนไขบังคับใน submitSignature() ด้านล่างเป๊ะๆ — ไม่งั้นหน้าจอกับ validation จะขัดกันเอง
                    const doRequired = (ncrType === 'SCRAP' || ncrType === 'SCRAP_PARTS');
                    const waveRequired = (ncrType === 'SCRAP');
                    const inboundRequired = (ncrType === 'SCRAP_PARTS');
                    const setMark = (id, required) => {
                        const el = document.getElementById(id);
                        if (!el) return;
                        el.textContent = required ? '*' : '(ไม่บังคับ)';
                        el.className = required ? 'text-red-500 font-normal' : 'text-slate-400 font-normal';
                    };
                    setMark('signNcrDoRequiredMark', doRequired);
                    setMark('signNcrWaveRequiredMark', waveRequired);
                    setMark('signNcrInboundRequiredMark', inboundRequired);
                }
            }

            const modal = document.getElementById('signModal');
            const box = document.getElementById('signModalBox');
            modal.classList.remove('hidden');
            setTimeout(() => {
                box.classList.remove('scale-95', 'opacity-0');
                box.classList.add('scale-100', 'opacity-100');
            }, 10);
            lucide.createIcons();
        }

        async function viewOnly(moduleKey, stageKey, docId) {
            await openSignModal(moduleKey, stageKey, docId);
            document.getElementById('submitSignBtn').classList.add('hidden');
            document.getElementById('signRejectBtn').classList.add('hidden');
            document.getElementById('signComment').disabled = true;
            document.getElementById('signOdoNumber').disabled = true;
            document.getElementById('signInboundNumber').disabled = true;
            document.getElementById('signReservationNumber').disabled = true;
            ['signSwapMovementType', 'signSwapOdo', 'signSwapInboundMcm', 'signSwapInboundSpm', 'signSwapMcmNotify', 'signSwapSpmNotify']
                .forEach(id => { const el = document.getElementById(id); if (el) el.disabled = true; });
            const swapPurposeEditBtn = document.getElementById('swapPurposeEditBtn');
            if (swapPurposeEditBtn) swapPurposeEditBtn.classList.add('hidden');
            document.querySelectorAll('input[name="signNcrClaimStatus"]').forEach(r => r.disabled = true);
            document.querySelectorAll('input[name="signClaimResult"]').forEach(r => r.disabled = true);
            document.getElementById('signNcrDoNumber').disabled = true;
            document.getElementById('signNcrInboundNumber').disabled = true;
            document.getElementById('signNcrPoNumber').disabled = true;
            document.getElementById('signNcrWaveNumber').disabled = true;
            // 🆕 29/09/2569 : ฟอร์ม SCM VENDOR 3 sub-step
            document.getElementById('signNcrScm1Do').disabled = true;
            document.getElementById('signNcrScm2Select').disabled = true;
            document.getElementById('signNcrScm2Po').disabled = true;
            document.querySelectorAll('input[name="signNcrScmHeadDecision"]').forEach(r => r.disabled = true);
            // 🆕 30/09/2569 : ช่องราคารายรายการในตารางหลัก (ดูได้อย่างเดียว)
            document.querySelectorAll('#signItemsBody .ncr-item-price-input').forEach(el => el.disabled = true);
        }

        // 🗂️ เก็บข้อมูลเอกสารล่าสุดที่โหลดเข้า Sign Modal ไว้ใช้ซ้ำตอนกดปุ่ม "ตัวอย่างเอกสาร" (ไม่ต้อง fetch ซ้ำ)
        let currentSignDoc = null;
        let currentSignMod = null;

        // 📎 แสดงไฟล์แนบใน Sign Modal — รูปภาพโชว์ preview ได้เลย, PDF/อื่นๆ ให้กดเปิดในแท็บใหม่
        //    Backend ส่ง base64 มาแล้ว (ไม่ต้อง fetch เพิ่ม) จึงสร้าง data URL ตรงๆ ได้
        // 🧾 CLAIM: ไฟล์แนบเป็น "หลายไฟล์" เก็บเป็น array คนละรูปแบบกับระบบอื่น
        //    (SWAP/Disassembly/NCR เก็บไฟล์เดียวเป็น column บนหัวเอกสาร)
        //    จึงต้องแยกทางเดินตั้งแต่ต้นฟังก์ชัน ไม่ไปยุ่งกับ logic เดิมของ 3 ระบบนั้น
        function renderClaimSignAttachments(doc, wrap, box) {
            const groups = [
                { title: 'ไฟล์แนบตอนรับเรื่อง', list: doc.attachmentsCreate || [] },
                { title: 'ไฟล์แนบตอนปิดงาน',   list: doc.attachmentsClose  || [] }
            ].filter(g => g.list.length > 0);

            if (groups.length === 0) {
                wrap.classList.add('hidden');
                box.innerHTML = '';
                return;
            }

            box.innerHTML = groups.map(g => `
                <div class="space-y-2">
                    <div class="text-[11px] font-semibold text-slate-500">${g.title} (${g.list.length})</div>
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 items-start">
                        ${g.list.map(a => {
                            const isImage = /^image\//i.test(a.FileType || '');
                            const isPdf = /pdf/i.test(a.FileType || '') || /\.pdf$/i.test(a.FileName || '');
                            const dataUrl = `data:${a.FileType || 'application/octet-stream'};base64,${a.FileBase64 || ''}`;
                            return `
                            <div class="rounded-lg border border-slate-200 bg-white p-2.5 space-y-2">
                                <div class="flex items-center gap-2">
                                    <i data-lucide="${isImage ? 'image' : 'file-text'}" class="w-3.5 h-3.5 text-brand-600 shrink-0"></i>
                                    <span class="text-xs text-slate-700 truncate flex-1">${a.FileName}</span>
                                    <button type="button" onclick="openClaimSignAttachment('${a.AttachmentId}')"
                                        class="shrink-0 px-2.5 py-1 rounded-md bg-brand-50 text-brand-700 text-[11px] font-semibold hover:bg-brand-100">เปิดดู</button>
                                    <a href="${dataUrl}" download="${a.FileName}"
                                        class="shrink-0 px-2.5 py-1 rounded-md bg-slate-100 text-slate-700 text-[11px] font-semibold hover:bg-slate-200">ดาวน์โหลด</a>
                                </div>
                                ${isImage
                                    ? `<img src="${dataUrl}" alt="${a.FileName}" class="max-h-56 mx-auto rounded-lg border border-slate-200">`
                                    : `<div class="flex items-center gap-2 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
                                         <i data-lucide="${isPdf ? 'file-text' : 'file'}" class="w-4 h-4 text-slate-400 shrink-0"></i>
                                         <span class="text-[11px] text-slate-500">${isPdf ? 'ไฟล์ PDF — กดเปิดดูหรือดาวน์โหลด' : 'ไฟล์แนบ — กดเปิดดูหรือดาวน์โหลด'}</span>
                                       </div>`}
                            </div>`;
                        }).join('')}
                    </div>
                </div>`).join('');
            wrap.classList.remove('hidden');
            lucide.createIcons();
        }

        // เปิดไฟล์แนบของ Claim ในแท็บใหม่ — ใช้ Blob เพราะ Chrome บล็อก data URL ขนาดใหญ่
        function openClaimSignAttachment(attachmentId) {
            const doc = currentSignDoc;
            if (!doc) return;
            const all = [...(doc.attachmentsCreate || []), ...(doc.attachmentsClose || [])];
            const found = all.find(a => String(a.AttachmentId) === String(attachmentId));
            if (!found || !found.FileBase64) {
                showNotification('เปิดไฟล์ไม่สำเร็จ', 'ไม่พบข้อมูลไฟล์แนบ กรุณาปิดแล้วเปิดเอกสารใหม่', 'error');
                return;
            }
            try {
                const bin = atob(found.FileBase64);
                const bytes = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                const url = URL.createObjectURL(new Blob([bytes], { type: found.FileType || 'application/octet-stream' }));
                window.open(url, '_blank');
                setTimeout(() => URL.revokeObjectURL(url), 60000);
            } catch (e) {
                showNotification('เปิดไฟล์ไม่สำเร็จ', 'ไฟล์แนบอาจเสียหาย กรุณาลองดาวน์โหลดแทน', 'error');
            }
        }

        // 📎 22/09/2569 : NCR — ไฟล์แนบสูงสุด 3 ไฟล์/เอกสาร (doc.attachments = [{ sortOrder, fileName, fileType, fileBase64 }])
        //    ใช้ดีไซน์การ์ดเดียวกับ renderClaimSignAttachments แต่เป็นกลุ่มเดียว (ไม่แยกตอนรับเรื่อง/ปิดงาน)
        function renderNcrSignAttachments(doc, wrap, box) {
            const list = (doc.attachments || []).filter(a => a && a.fileBase64);
            if (list.length === 0) {
                wrap.classList.add('hidden');
                box.innerHTML = '';
                return;
            }

            // 🔧 25/09/2569 : แยกเรนเดอร์ 2 แบบ — รูปภาพเรียง 3 รูปในแถวเดียวไปทางขวา,
            //    ไฟล์อื่น (ส่วนใหญ่คือ PDF) เรียงต่อกันลงล่างแบบเต็มความกว้าง/สูงกล่อง
            const withMeta = list.map((a, idx) => {
                const isImage = /^image\//i.test(a.fileType || '');
                const isPdf = /pdf/i.test(a.fileType || '') || /\.pdf$/i.test(a.fileName || '');
                const dataUrl = `data:${a.fileType || 'application/octet-stream'};base64,${a.fileBase64 || ''}`;
                return { a, idx, isImage, isPdf, dataUrl };
            });

            const cardHtml = ({ a, idx, isImage, isPdf, dataUrl }) => `
                <div class="rounded-lg border border-slate-200 bg-white p-2.5 space-y-2">
                    <div class="flex items-center gap-2">
                        <i data-lucide="${isImage ? 'image' : 'file-text'}" class="w-3.5 h-3.5 text-brand-600 shrink-0"></i>
                        <span class="text-xs text-slate-700 truncate flex-1">${a.fileName || 'เอกสารแนบ'}</span>
                        <button type="button" onclick="openNcrSignAttachment(${idx})"
                            class="shrink-0 px-2.5 py-1 rounded-md bg-brand-50 text-brand-700 text-[11px] font-semibold hover:bg-brand-100">เปิดดู</button>
                        <a href="${dataUrl}" download="${a.fileName || 'attachment'}"
                            class="shrink-0 px-2.5 py-1 rounded-md bg-slate-100 text-slate-700 text-[11px] font-semibold hover:bg-slate-200">ดาวน์โหลด</a>
                    </div>
                    ${isImage
                        ? `<img src="${dataUrl}" alt="${a.fileName || ''}" class="w-full h-72 object-cover rounded-lg border border-slate-200">`
                        : // 🔧 03/10/2569 : ข้อ 8 — เลิกแสดง PDF แบบ <iframe> เต็มหน้า (เดิมสูง 1100px ทำให้ต้องเลื่อนดูมาก)
                          //    เปลี่ยนเป็นแสดงเป็นรายการสั้นๆ + ปุ่ม "เปิดดู"/"ดาวน์โหลด" ที่มีอยู่แล้วด้านบนเหมือนไฟล์อื่นๆ
                          // 🔧 03/10/2569 (เพิ่ม) : ตัดกล่องข้อความ "ไฟล์ PDF/ไฟล์แนบ — กดเปิดดูหรือดาวน์โหลด" ออกทั้งหมด
                          //    (ซ้ำซ้อนกับปุ่ม "เปิดดู"/"ดาวน์โหลด" ที่มีอยู่แล้วด้านบนการ์ด) ไม่ต้องแสดงอะไรเพิ่มสำหรับไฟล์ที่ไม่ใช่รูปภาพ
                          ''}
                </div>`;

            const images = withMeta.filter(x => x.isImage);
            const others = withMeta.filter(x => !x.isImage);

            const imagesHtml = images.length
                ? `<div class="grid grid-cols-3 gap-2 items-start">${images.map(cardHtml).join('')}</div>`
                : '';
            const othersHtml = others.length
                ? `<div class="space-y-2">${others.map(cardHtml).join('')}</div>`
                : '';

            box.innerHTML = `
                <div class="space-y-2">
                    <div class="text-[11px] font-semibold text-slate-500">ไฟล์แนบทั้งหมด (${list.length})</div>
                    ${imagesHtml}
                    ${othersHtml}
                </div>`;
            wrap.classList.remove('hidden');
            lucide.createIcons();
        }

        // เปิดไฟล์แนบของ NCR ในแท็บใหม่ — ใช้ Blob เพราะ Chrome บล็อก data URL ขนาดใหญ่
        function openNcrSignAttachment(idx) {
            const doc = currentSignDoc;
            if (!doc) return;
            const list = (doc.attachments || []).filter(a => a && a.fileBase64);
            const found = list[idx];
            if (!found) {
                showNotification('เปิดไฟล์ไม่สำเร็จ', 'ไม่พบข้อมูลไฟล์แนบ กรุณาปิดแล้วเปิดเอกสารใหม่', 'error');
                return;
            }
            try {
                const bin = atob(found.fileBase64);
                const bytes = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                const url = URL.createObjectURL(new Blob([bytes], { type: found.fileType || 'application/octet-stream' }));
                window.open(url, '_blank');
                setTimeout(() => URL.revokeObjectURL(url), 60000);
            } catch (e) {
                showNotification('เปิดไฟล์ไม่สำเร็จ', 'ไฟล์แนบอาจเสียหาย กรุณาลองดาวน์โหลดแทน', 'error');
            }
        }

        function renderSignAttachment(doc) {
            const wrap = document.getElementById('signAttachmentWrap');
            const box = document.getElementById('signAttachmentBox');
            if (!wrap || !box) return;

            // Claim ใช้ array หลายไฟล์ แยกไปอีกทางตั้งแต่ต้น
            if (doc && (Array.isArray(doc.attachmentsCreate) || Array.isArray(doc.attachmentsClose))) {
                renderClaimSignAttachments(doc, wrap, box);
                return;
            }

            // 📎 22/09/2569 : NCR รองรับไฟล์แนบสูงสุด 3 ไฟล์ต่อเอกสารแล้ว — เก็บเป็น doc.attachments (array)
            //    ต้องเช็คก่อนเส้นทางไฟล์เดี่ยวเดิมด้านล่าง (ซึ่งยังใช้กับ SWAP/Disassembly ต่อไป)
            if (doc && Array.isArray(doc.attachments) && doc.attachments.length > 0) {
                renderNcrSignAttachments(doc, wrap, box);
                return;
            }

            // ⚠️ ต้องเช็คเข้มกว่าแค่ falsy — เพราะ SQL อาจส่ง null กลับมาเป็น string "null"/"undefined"
            //    หรือ n8n ส่ง empty item มาเมื่อไม่มีแถวใน SwapAttachment (Always Output Data)
            const rawBase64 = doc && (doc.attachmentBase64 ?? doc.AttachmentBase64);
            const base64 = (typeof rawBase64 === 'string' && rawBase64.trim() !== ''
                && rawBase64 !== 'null' && rawBase64 !== 'undefined') ? rawBase64.trim() : '';
            // ⚠️ แต่ละระบบส่งชื่อ field มาไม่เหมือนกัน — SWAP ใช้ hasAttachment (h เล็ก)
            //    ส่วน Disassembly/NCR ใช้ HasAttachment (H ใหญ่) จึงต้องรับทั้ง 2 แบบ
            const rawFlag = doc && (doc.hasAttachment ?? doc.HasAttachment);
            const hasAttachFlag = rawFlag === true || Number(rawFlag) === 1;
            const fileName = (doc && (doc.attachmentFileName || doc.AttachmentFileName)) || 'เอกสารแนบ';
            const fileType = (doc && (doc.attachmentFileType || doc.AttachmentFileType)) || '';

            // ต้องมีทั้ง flag ในเอกสาร และไฟล์จริง ถึงจะแสดงส่วนนี้
            if (!base64 || !hasAttachFlag) {
                wrap.classList.add('hidden');
                box.innerHTML = '';
                return;
            }

            const dataUrl = `data:${fileType || 'application/octet-stream'};base64,${base64}`;
            const isImage = /^image\//i.test(fileType);

            box.innerHTML = `
                <div class="flex items-center justify-between gap-3 flex-wrap">
                    <div class="flex items-center gap-2 min-w-0">
                        <i data-lucide="${isImage ? 'image' : 'file-text'}" class="w-4 h-4 text-brand-600 shrink-0"></i>
                        <span class="text-xs font-medium text-slate-700 truncate">${fileName}</span>
                    </div>
                    <div class="flex items-center gap-2">
                        <button type="button" onclick="openSignAttachment()"
                            class="px-3 py-1.5 text-xs font-medium rounded-lg bg-brand-50 text-brand-700 hover:bg-brand-100 transition-colors flex items-center gap-1">
                            <i data-lucide="external-link" class="w-3 h-3"></i>เปิดดู
                        </button>
                        <a href="${dataUrl}" download="${fileName}"
                            class="px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors flex items-center gap-1">
                            <i data-lucide="download" class="w-3 h-3"></i>ดาวน์โหลด
                        </a>
                    </div>
                </div>
                ${isImage ? `<img src="${dataUrl}" alt="${fileName}" class="mt-3 max-h-64 mx-auto rounded-lg border border-slate-200">` : ''}
            `;
            wrap.classList.remove('hidden');
            lucide.createIcons();
        }

        // เปิดไฟล์แนบในแท็บใหม่ — ใช้ Blob แทน data URL ตรงๆ เพราะ Chrome บล็อกการเปิด data URL ขนาดใหญ่ใน tab ใหม่
        function openSignAttachment() {
            const doc = currentSignDoc;
            const base64 = doc && (doc.attachmentBase64 || doc.AttachmentBase64);
            if (!base64) return;
            const fileType = (doc.attachmentFileType || doc.AttachmentFileType) || 'application/octet-stream';
            try {
                const bin = atob(base64);
                const bytes = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                const url = URL.createObjectURL(new Blob([bytes], { type: fileType }));
                window.open(url, '_blank');
                // ปล่อย memory หลังเปิดแล้ว (ให้เวลาเบราว์เซอร์โหลดก่อน)
                setTimeout(() => URL.revokeObjectURL(url), 60000);
            } catch (e) {
                showNotification('เปิดไฟล์ไม่สำเร็จ', 'ไฟล์แนบอาจเสียหาย กรุณาลองดาวน์โหลดแทน', 'error');
            }
        }

        async function loadDocDetailIntoSignModal(mod, docId, stageKey) {
            const summary = document.getElementById('signDocSummary');
            const itemsHead = document.getElementById('signItemsHead');
            const itemsBody = document.getElementById('signItemsBody');
            const extraSections = document.getElementById('signExtraSections');
            summary.innerHTML = '<p class="col-span-3 text-slate-400">กำลังโหลด...</p>';
            itemsHead.innerHTML = '';
            itemsBody.innerHTML = '';
            // ต้องล้างทุกครั้งที่เปิด modal ใหม่ ไม่งั้นตารางอะไหล่ของเอกสารใบก่อนจะค้างอยู่บนเอกสารใบถัดไป
            extraSections.innerHTML = '';
            document.getElementById('signAttachmentWrap').classList.add('hidden');
            currentSignDoc = null;
            currentSignMod = mod;

            try {
                const res = await n8nFetch(N8N_BASE + mod.detailEndpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ [mod.detailPayloadKey]: docId })
                });
                const raw = await res.json();
                const doc = Array.isArray(raw) ? raw[0] : raw;
                currentSignDoc = doc;

                summary.innerHTML = mod.renderSummary(doc);
                renderSignAttachment(doc);

                // 🆕 30/09/2569 : itemColumns/colWidths รองรับเป็นฟังก์ชันได้ (mod.itemColumnsFor(doc)/mod.colWidthsFor(doc))
                //    ใช้กับ NCR ประเภท SCRAP เคลม VENDOR ที่ต้องมีคอลัมน์ "ราคา" เพิ่มเฉพาะประเภทนี้เท่านั้น
                //    module อื่นที่ยังประกาศ itemColumns/colWidths แบบ array เดิม ทำงานเหมือนเดิมทุกประการ
                const itemColumns = typeof mod.itemColumnsFor === 'function' ? mod.itemColumnsFor(doc, stageKey) : mod.itemColumns;
                const colWidths = typeof mod.colWidthsFor === 'function' ? mod.colWidthsFor(doc, stageKey) : mod.colWidths;

                // ล็อกความกว้างคอลัมน์ให้ตารางหลัก เมื่อ module ประกาศ colWidths ไว้
                // จำเป็นสำหรับ NCR ที่มีตารางที่สอง (รายการอะไหล่ที่แยกได้) ต้องให้คอลัมน์ตรงแนวกัน
                const itemsTable = document.getElementById('signItemsTable');
                const oldColgroup = itemsTable.querySelector('colgroup');
                if (oldColgroup) oldColgroup.remove();
                itemsTable.style.tableLayout = '';
                if (Array.isArray(colWidths) && colWidths.length === itemColumns.length) {
                    itemsTable.style.tableLayout = 'fixed';
                    const cg = document.createElement('colgroup');
                    cg.innerHTML = colWidths.map(w => `<col style="width:${w}">`).join('');
                    itemsTable.insertBefore(cg, itemsTable.firstChild);
                }

                itemsHead.innerHTML = `<tr class="bg-slate-100 border-b border-slate-200">${
                    itemColumns.map(c => `<th class="px-2 py-1.5 text-[10px] font-semibold text-slate-500 uppercase">${c.label}</th>`).join('')
                }</tr>`;

                const items = mod.getItems(doc);
                itemsBody.innerHTML = items.length === 0
                    ? `<tr><td colspan="${itemColumns.length}" class="px-2 py-4 text-center text-xs text-slate-400">ไม่มีรายการ</td></tr>`
                    : items.map((item, idx) => `
                        <tr>
                            ${itemColumns.map(c => `<td class="px-2 py-1.5 text-xs">${c.render(item, idx, stageKey)}</td>`).join('')}
                        </tr>
                    `).join('');

                // ตารางเสริมของระบบที่ประกาศ getExtraSections ไว้ (ตอนนี้มีแค่ NCR — ตารางอะไหล่ที่แยกได้ + เลขที่ DO/Inbound)
                // ส่ง stageKey ไปด้วย เพราะบางอย่างต้องโชว์เฉพาะบางขั้น (เลขที่ DO ให้ MCM-LOG / เลขที่ Inbound ให้ SPM)
                extraSections.innerHTML = typeof mod.getExtraSections === 'function'
                    ? (mod.getExtraSections(doc, stageKey) || '')
                    : '';

                // renderSummary/renderSignAttachment อาจใส่ไอคอน lucide ไว้ ต้องสร้างไอคอนหลัง render เสมอ
                lucide.createIcons();
            } catch (err) {
                summary.innerHTML = `<p class="col-span-3 text-red-500">โหลดข้อมูลไม่สำเร็จ: ${err.message}</p>`;
            }
        }

        function closeSignModal() {
            const modal = document.getElementById('signModal');
            const box = document.getElementById('signModalBox');
            box.classList.remove('scale-100', 'opacity-100');
            box.classList.add('scale-95', 'opacity-0');
            setTimeout(() => {
                modal.classList.add('hidden');
                document.getElementById('submitSignBtn').classList.remove('hidden');
                document.getElementById('signRejectBtn').classList.remove('hidden');
                document.getElementById('signComment').disabled = false;
                document.getElementById('signOdoNumber').disabled = false;
                document.getElementById('signInboundNumber').disabled = false;
                document.getElementById('signReservationNumber').disabled = false;
                ['signSwapMovementType', 'signSwapOdo', 'signSwapInboundMcm', 'signSwapInboundSpm', 'signSwapMcmNotify', 'signSwapSpmNotify']
                    .forEach(id => { const el = document.getElementById(id); if (el) el.disabled = false; });
                document.querySelectorAll('input[name="signNcrClaimStatus"]').forEach(r => r.disabled = false);
                document.getElementById('signNcrDoNumber').disabled = false;
                document.getElementById('signNcrInboundNumber').disabled = false;
                document.getElementById('signNcrPoNumber').disabled = false;
                document.getElementById('signNcrWaveNumber').disabled = false;
            }, 200);
        }

        // 📄 เปิดดูตัวอย่างเอกสาร — ใช้ข้อมูลที่ Sign Modal โหลดไว้แล้ว (currentSignDoc) ไม่ fetch ซ้ำ
        function openPreviewFromSignModal() {
            if (!currentSignDoc || !currentSignMod) {
                showNotification('ยังโหลดข้อมูลไม่เสร็จ', 'กรุณารอสักครู่แล้วลองใหม่อีกครั้ง', 'warning');
                return;
            }
            const paper = document.getElementById('previewDocPaperApprove');
            paper.innerHTML = currentSignMod.renderPreviewPaper(currentSignDoc);

            const modal = document.getElementById('previewDocModal');
            const box = document.getElementById('previewDocModalBox');
            modal.classList.remove('hidden');
            setTimeout(() => {
                box.classList.remove('scale-95', 'opacity-0');
                box.classList.add('scale-100', 'opacity-100');
            }, 10);
            lucide.createIcons();
        }

        function closePreviewDocModal() {
            const modal = document.getElementById('previewDocModal');
            const box = document.getElementById('previewDocModalBox');
            box.classList.remove('scale-100', 'opacity-100');
            box.classList.add('scale-95', 'opacity-0');
            setTimeout(() => modal.classList.add('hidden'), 200);
        }

        // ===================================================================
        // 🏷️ พิมพ์บัตรขอแกะอะไหล่ (Sticker) — ขนาดจริง 8x4cm (Honeywell PC42e-t, 200dpi)
        // 🆕 23/09/2569 — ใช้ currentSignDoc ที่ Sign Modal โหลดไว้แล้ว ไม่ fetch ซ้ำ (เหมือน openPreviewFromSignModal)
        // Grouping: 1 ใบต่อ 1 กลุ่ม MachineCode ที่ไม่ซ้ำกันในเอกสาร
        // เว้นว่างให้เขียนมือหน้างาน: เบอร์เครื่อง (Serial Number), อะไหล่ที่แกะ, ช่าง
        // ===================================================================
        function groupItemsByMachineCode(items) {
            const order = [];
            const map = {};
            (items || []).forEach(item => {
                const key = item.MachineCode || '-';
                if (!map[key]) {
                    map[key] = { machineCode: item.MachineCode || '', remarks: [] };
                    order.push(key);
                }
                const r = (item.RemarkOrPO || '').trim();
                if (r && !map[key].remarks.includes(r)) map[key].remarks.push(r);
            });
            return order.map(key => map[key]);
        }

        function escapeHtmlSticker(v) {
            if (v === null || v === undefined) return '';
            return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        }

        function buildStickerCardHtml(doc, group) {
            const remark = group.remarks.join(', ') || '-';
            return `
        <div class="sticker-card">
            <div class="sticker-header">
                <span>KTW GROUP — บัตรขอแกะอะไหล่</span>
                <span>F-14-E03</span>
            </div>
            <div class="sticker-line">
                <div class="sticker-field">
                    <span class="sticker-field-lbl">เลขที่เอกสาร</span>
                    <span class="sticker-field-val">${escapeHtmlSticker(doc.DocId)}</span>
                </div>
                <div class="sticker-field">
                    <span class="sticker-field-lbl">วันที่</span>
                    <span class="sticker-field-val">${escapeHtmlSticker(formatThaiDate(doc.DocDate))}</span>
                </div>
            </div>
            <div class="sticker-line">
                <div class="sticker-field">
                    <span class="sticker-field-lbl">รุ่น</span>
                    <span class="sticker-field-val">${escapeHtmlSticker(group.machineCode) || '-'}</span>
                </div>
                <div class="sticker-field">
                    <span class="sticker-field-lbl">เบอร์เครื่อง</span>
                    <span class="sticker-field-val"></span>
                </div>
            </div>
            <div class="sticker-block">
                <span class="sticker-field-lbl">อะไหล่ที่แกะ</span>
                <div class="sticker-blank-area"></div>
            </div>
            <div class="sticker-line sticker-line-tall">
                <div class="sticker-field">
                    <span class="sticker-field-lbl">หมายเหตุ</span>
                    <span class="sticker-field-val">${escapeHtmlSticker(remark)}</span>
                </div>
            </div>
            <div class="sticker-line sticker-footer-line">
                <div class="sticker-field">
                    <span class="sticker-field-lbl">ผู้ขอแกะอะไหล่</span>
                    <span class="sticker-field-val">${escapeHtmlSticker(doc.RequestedByName) || '-'}</span>
                </div>
                <div class="sticker-field">
                    <span class="sticker-field-lbl">ช่าง</span>
                    <span class="sticker-field-val"></span>
                </div>
            </div>
        </div>`;
        }

        let currentStickerGroups = [];

        function printPartsStickerFromSignModal() {
            if (!currentSignDoc || !currentSignMod) {
                showNotification('ยังโหลดข้อมูลไม่เสร็จ', 'กรุณารอสักครู่แล้วลองใหม่อีกครั้ง', 'warning');
                return;
            }
            const items = currentSignMod.getItems(currentSignDoc) || [];
            if (items.length === 0) {
                showNotification('ไม่มีรายการอะไหล่', 'เอกสารนี้ยังไม่มีรายการอะไหล่ ไม่สามารถสร้างบัตรขอแกะอะไหล่ได้', 'error');
                return;
            }

            currentStickerGroups = groupItemsByMachineCode(items);

            document.getElementById('stickerPreviewDocId').textContent = currentSignDoc.DocId;
            document.getElementById('stickerCountText').textContent = currentStickerGroups.length;
            document.getElementById('stickerPreviewList').innerHTML = currentStickerGroups.map(g => `
            <div class="bg-white rounded-lg shadow-sm border border-slate-300 p-2">
                ${buildStickerCardHtml(currentSignDoc, g)}
            </div>`).join('');

            const modal = document.getElementById('stickerPreviewModal');
            const box = document.getElementById('stickerPreviewModalBox');
            modal.classList.remove('hidden');
            setTimeout(() => {
                box.classList.remove('scale-95', 'opacity-0');
                box.classList.add('scale-100', 'opacity-100');
            }, 10);
            lucide.createIcons();
        }

        function closeStickerPreviewModal() {
            const modal = document.getElementById('stickerPreviewModal');
            const box = document.getElementById('stickerPreviewModalBox');
            box.classList.remove('scale-100', 'opacity-100');
            box.classList.add('scale-95', 'opacity-0');
            setTimeout(() => modal.classList.add('hidden'), 200);
        }

        // ตั้งค่า @page ให้เป็นขนาดสติ๊กเกอร์ (80mm x 40mm แนวนอน) เฉพาะตอนพิมพ์บัตร แล้วเอาออกหลังพิมพ์เสร็จ
        // 🔧 23/09/2569 (รอบ 3) : แปะท้าย <body> แทน <head> — กฎ @page ยึดลำดับ DOM ไม่ใช่เวลาที่แทรกด้วย JS
        // ต้องมาทีหลังกฎ @page อื่นๆ ในหน้าเสมอเพื่อให้ชนะ cascade จริง (เหมือนที่แก้ใน disassembly_form.html)
        function setStickerPageStyle(enable) {
            let tag = document.getElementById('stickerPageSizeStyle');
            if (enable) {
                if (!tag) {
                    tag = document.createElement('style');
                    tag.id = 'stickerPageSizeStyle';
                }
                document.body.appendChild(tag);
                tag.textContent = '@media print { @page { size: 80mm 40mm; margin: 0; } }';
            } else if (tag) {
                tag.remove();
            }
        }

        function printStickers() {
            if (!currentSignDoc || currentStickerGroups.length === 0) return;
            const printArea = document.getElementById('stickerPrintArea');
            printArea.innerHTML = currentStickerGroups.map(g => buildStickerCardHtml(currentSignDoc, g)).join('');

            setStickerPageStyle(true);
            document.body.classList.add('printing-stickers');
            window.print();
            setTimeout(() => {
                document.body.classList.remove('printing-stickers');
                setStickerPageStyle(false);
                printArea.innerHTML = '';
            }, 500);
        }

        async function submitSignature() {
            const moduleKey = document.getElementById('signModuleKey').value;
            const docId = document.getElementById('signDocId').value;
            const stageKey = document.getElementById('signStageKey').value;
            const comment = document.getElementById('signComment').value.trim();

            const mod = getModule(moduleKey);
            const stage = getStage(mod, stageKey);

            // 💰 รวบรวมราคาที่แก้ไข (เฉพาะแถวที่ค่าต่างจากราคาเดิมจริงๆ) — ปัจจุบันมีเฉพาะ SWAP stage 'scm' เท่านั้นที่มี input ราคาให้แก้
            // ใช้ itemNo (ตรงกับ doc_item_no ในฐานข้อมูล) ไม่ใช่ array index เพื่อป้องกันอัปเดตผิดแถว
            const updatedPrices = [];
            document.querySelectorAll('#signItemsBody .swap-price-input').forEach(input => {
                const newPrice = parseFloat(input.value) || 0;
                const originalPrice = parseFloat(input.dataset.originalPrice) || 0;
                if (newPrice !== originalPrice) {
                    updatedPrices.push({
                        itemNo: Number(input.dataset.itemNo),
                        oldPrice: originalPrice,
                        newPrice: newPrice
                    });
                }
            });

            // 🔢 เลข ODO — บังคับกรอกเฉพาะ Disassembly stage 'scm' เท่านั้น
            let odoNumber = '';
            const odoWrap = document.getElementById('signOdoNumberWrap');
            if (!odoWrap.classList.contains('hidden')) {
                odoNumber = document.getElementById('signOdoNumber').value.trim();
                if (!odoNumber) {
                    showNotification('กรุณาระบุเลข ODO', 'ต้องกรอกเลข ODO ก่อนยืนยัน เพื่อแจ้งให้เจ้าหน้าที่คลังอะไหล่ทราบ', 'warning');
                    return;
                }
            }

            // 🆕 24/09/2569 : เลข Inbound — Disassembly stage 'scm' เท่านั้น (ไม่บังคับกรอก)
            let inboundNumber = '';
            const inboundWrap = document.getElementById('signInboundNumberWrap');
            if (!inboundWrap.classList.contains('hidden')) {
                inboundNumber = document.getElementById('signInboundNumber').value.trim();
            }

            // 🆕 24/09/2569 (เพิ่มรอบ 2) : เลข Reservation — Disassembly stage 'scm' เท่านั้น (ไม่บังคับกรอก)
            let reservationNumber = '';
            const reservationWrap = document.getElementById('signReservationNumberWrap');
            if (!reservationWrap.classList.contains('hidden')) {
                reservationNumber = document.getElementById('signReservationNumber').value.trim();
            }

            // 🏷️ NCR: เก็บค่าฟิลด์เฉพาะ stage 'mkt' (สถานะการเคลม — บังคับ) และ 'scm' (เลขที่ DO/WO, Wave, Inbound, PO — ไม่บังคับทุกช่อง)
            let ncrFields = null;
            if (moduleKey === 'ncr' && stageKey === 'mkt') {
                const checked = document.querySelector('input[name="signNcrClaimStatus"]:checked');
                if (!checked) {
                    showNotification('กรุณาระบุสถานะการเคลม', 'เลือก "เคลมได้" หรือ "เคลมไม่ได้" ก่อนยืนยัน', 'warning');
                    return;
                }
                ncrFields = { claimStatus: checked.value };
            }
            if (moduleKey === 'ncr' && stageKey === 'scm') {
                ncrFields = {};
                const ncrType = currentSignDoc ? currentSignDoc.NcrType : null;
                const isVendor = ncrType === 'SCRAP_CLAIM_VENDOR';

                if (isVendor) {
                    // 🆕 29/09/2569 : NCR SCRAP เคลม VENDOR — ฟอร์ม 3 sub-step (SCM1 → SCM2 → หัวหน้า SCM)
                    const phase = ncrScmVendorPhase(currentSignDoc);
                    if (phase === 'scm1') {
                        const doVal = document.getElementById('signNcrScm1Do').value.trim();
                        const scm2Sel = document.getElementById('signNcrScm2Select');
                        const scm2Opt = scm2Sel.selectedIndex > 0 ? scm2Sel.options[scm2Sel.selectedIndex] : null;

                        // 🔧 30/09/2569 : ราคาย้ายมากรอกทีละรายการในตาราง "รายการที่เกี่ยวข้องกับเอกสารนี้" ด้านบน
                        //    (อาจมีหลายรายการต่อเอกสาร — บังคับกรอกราคาให้ครบทุกแถวก่อนยืนยัน)
                        const priceInputs = document.querySelectorAll('#signItemsBody .ncr-item-price-input');
                        const itemPrices = [];
                        let hasMissingPrice = priceInputs.length === 0;
                        priceInputs.forEach(input => {
                            const priceVal = input.value.trim();
                            if (!priceVal || parseFloat(priceVal) <= 0) hasMissingPrice = true;
                            itemPrices.push({ itemId: input.dataset.itemId, price: parseFloat(priceVal) || 0 });
                        });

                        if (!doVal || hasMissingPrice || !scm2Opt) {
                            showNotification('ข้อมูลไม่ครบ', 'กรุณาระบุเลขที่ DO, ราคาของทุกรายการในตาราง และเลือก SCM คนที่ 2 ให้ครบก่อนยืนยัน', 'warning');
                            return;
                        }
                        ncrFields = {
                            scmPhase: 'scm1',
                            doNumber: doVal,
                            itemPrices: itemPrices,
                            scm2EmpId: scm2Opt.value,
                            scm2Name: scm2Opt.dataset.name || '',
                            scm2Email: scm2Opt.dataset.email || ''
                        };
                    } else if (phase === 'scm2') {
                        const poVal = document.getElementById('signNcrScm2Po').value.trim();
                        if (!poVal) {
                            showNotification('ข้อมูลไม่ครบ', 'กรุณาระบุเลขที่ PO ก่อนยืนยัน', 'warning');
                            return;
                        }
                        ncrFields = { scmPhase: 'scm2', poNumber: poVal };
                    } else {
                        const decision = document.querySelector('input[name="signNcrScmHeadDecision"]:checked');
                        if (!decision) {
                            showNotification('กรุณาเลือกผลการตรวจสอบ', 'เลือก "อนุมัติ" หรือ "ไม่อนุมัติ" ก่อนยืนยัน', 'warning');
                            return;
                        }
                        if (decision.value === 'REJECT' && !comment) {
                            showNotification('กรุณาระบุเหตุผล', 'การไม่อนุมัติต้องระบุเหตุผลในช่องความเห็น เพื่อให้ผู้ขอเอกสารทราบสาเหตุ', 'warning');
                            return;
                        }
                        ncrFields = { scmPhase: 'scm_head', decision: decision.value };
                    }
                } else {
                    const doWrap = document.getElementById('signNcrDoWrap');
                    const inboundWrap = document.getElementById('signNcrInboundWrap');
                    const poWrap = document.getElementById('signNcrPoWrap');
                    const waveWrap = document.getElementById('signNcrWaveWrap');

                    const doVal = !doWrap.classList.contains('hidden') ? document.getElementById('signNcrDoNumber').value.trim() : '';
                    const waveVal = !waveWrap.classList.contains('hidden') ? document.getElementById('signNcrWaveNumber').value.trim() : '';
                    const inboundVal = !inboundWrap.classList.contains('hidden') ? document.getElementById('signNcrInboundNumber').value.trim() : '';
                    const poVal = !poWrap.classList.contains('hidden') ? document.getElementById('signNcrPoNumber').value.trim() : '';

                    // 🆕 29/09/2569 : SCRAP บังคับกรอกเลขที่ DO + Wave, SCRAP_PARTS บังคับกรอกเลขที่ DO + Inbound (หน้างานตกลง)
                    //    ประเภทอื่น (OTHER) ยังไม่บังคับเหมือนเดิม
                    if (ncrType === 'SCRAP' && (!doVal || !waveVal)) {
                        showNotification('ข้อมูลไม่ครบ', 'กรุณาระบุเลขที่ DO และเลขที่ Wave ให้ครบก่อนยืนยัน', 'warning');
                        return;
                    }
                    if (ncrType === 'SCRAP_PARTS' && (!doVal || !inboundVal)) {
                        showNotification('ข้อมูลไม่ครบ', 'กรุณาระบุเลขที่ DO และเลขที่ Inbound ให้ครบก่อนยืนยัน', 'warning');
                        return;
                    }

                    // ส่งไปเฉพาะช่องที่มองเห็นและกรอกค่าไว้ (ช่องว่าง → n8n เก็บเป็น NULL)
                    if (doVal) ncrFields.doNumber = doVal;
                    if (waveVal) ncrFields.waveNumber = waveVal;
                    if (inboundVal) ncrFields.inboundNumber = inboundVal;
                    if (poVal) ncrFields.poNumber = poVal;
                }
            }

            // 🆕 25/09/2569 : NCR stage 'spm' — เจ้าหน้าที่แผนกรับเข้าคลังอะไหล่กรอก "รายการอะไหล่ที่แยกได้" ตอนนี้แทนที่จะกรอกตอนสร้างเอกสาร
            //    บังคับอย่างน้อย 1 แถวที่มีรหัสอะไหล่ (ย้ายเงื่อนไขเดิมจาก ncr_form.html มาไว้ที่นี่)
            if (moduleKey === 'ncr' && stageKey === 'spm') {
                const partsItemsRaw = collectSignNcrPartsItemsData(true);
                const partsItems = collectSignNcrPartsItemsData();
                if (partsItemsRaw.length === 0 || partsItemsRaw.some(i => !i.prodCode)) {
                    showNotification('ข้อมูลไม่ครบ', 'กรุณาระบุรหัสอะไหล่ในรายการอะไหล่ที่แยกได้ ให้ครบทุกแถว อย่างน้อย 1 รายการ', 'error');
                    return;
                }
                ncrFields = { partsItems };
            }

            // 🔄 SWAP stage 'scm': เก็บค่า ODO / Inbound / ผู้รับต่อ
            //    ตั้งใจไม่ validate อะไรเลย ทุกช่องไม่บังคับกรอกตามที่หน้างานตกลง
            //    ไม่เลือกผู้รับ = ส่งค่าว่าง -> SQL เก็บ NULL -> ไม่ CC ใครในอีเมล
            let swapFields = null;
            if (moduleKey === 'swap' && stageKey === 'scm') {
                const pick = (selId) => {
                    const sel = document.getElementById(selId);
                    const opt = sel && sel.selectedIndex > 0 ? sel.options[sel.selectedIndex] : null;
                    return opt
                        ? { empId: opt.value, name: opt.dataset.name || '', email: opt.dataset.email || '' }
                        : { empId: '', name: '', email: '' };
                };
                const mcm = pick('signSwapMcmNotify');
                const spm = pick('signSwapSpmNotify');
                const movementTypeCode = document.getElementById('signSwapMovementType').value;
                const MOVEMENT_TYPE_DES_MAP = { '309': '309 : สลับสินค้ารุ่น', '921-922': '921-922 : สลับสินค้ารุ่นเข้า/ออก' };
                swapFields = {
                    movementType: movementTypeCode,
                    movementTypeDes: MOVEMENT_TYPE_DES_MAP[movementTypeCode] || '',
                    odoNo: document.getElementById('signSwapOdo').value.trim(),
                    inboundDocMcm: document.getElementById('signSwapInboundMcm').value.trim(),
                    inboundDocSpm: document.getElementById('signSwapInboundSpm').value.trim(),
                    mcmNotifyEmpId: mcm.empId, mcmNotifyName: mcm.name, mcmNotifyEmail: mcm.email,
                    spmNotifyEmpId: spm.empId, spmNotifyName: spm.name, spmNotifyEmail: spm.email
                };
            }

            // 🧾 CLAIM stage 'mkt': ต้องเลือกผลการพิจารณาก่อน และถ้า "ไม่อนุมัติ" ต้องมีเหตุผลด้วย
            //    (ฝั่ง n8n ก็เช็คซ้ำใน Code - Validate Claim Decision อยู่แล้ว ไม่ได้เชื่อหน้าเว็บอย่างเดียว)
            let claimFields = null;
            if (moduleKey === 'claim' && stageKey === 'mkt') {
                const picked = document.querySelector('input[name="signClaimResult"]:checked');
                if (!picked) {
                    showNotification('กรุณาเลือกผลการพิจารณา', 'เลือก "อนุมัติให้เคลม / ซ่อม" หรือ "ไม่อนุมัติ" ก่อนยืนยัน', 'warning');
                    return;
                }
                if (picked.value === 'NOT_APPROVE' && !comment) {
                    showNotification('กรุณาระบุเหตุผล', 'การไม่อนุมัติต้องระบุเหตุผลในช่องความเห็น เพื่อให้ผู้รับเรื่องอธิบายลูกค้าได้', 'warning');
                    return;
                }
                claimFields = { decision: picked.value };
            }

            // 📝 Disassembly stage 'marketing': บังคับกรอกความเห็นประกอบการอนุมัติ (หน้างานตกลง 22/09/2026)
            //    เฉพาะขั้นเจ้าหน้าที่การตลาดเท่านั้น ขั้นอื่นของ Disassembly ยังไม่บังคับเหมือนเดิม
            if (moduleKey === 'disassembly' && stageKey === 'marketing' && !comment) {
                showNotification('กรุณาระบุความเห็น', 'ต้องกรอกความเห็นประกอบการอนุมัติก่อนยืนยัน (เฉพาะขั้นเจ้าหน้าที่การตลาด)', 'warning');
                return;
            }

            const payload = mod.buildApprovePayload(docId, stageKey, comment, updatedPrices, odoNumber, ncrFields, swapFields, claimFields, inboundNumber, reservationNumber);

            // 🆕 29/09/2569 : NCR SCRAP เคลม VENDOR ขั้น SCM แยกเป็น 3 webhook ตาม sub-step — override endpoint ของ stage เดิม
            let approveEndpoint = stage.approveEndpoint;
            if (moduleKey === 'ncr' && stageKey === 'scm' && ncrFields && ncrFields.scmPhase) {
                approveEndpoint = ncrFields.scmPhase === 'scm1' ? 'approve_ncr_scm1'
                    : ncrFields.scmPhase === 'scm2' ? 'approve_ncr_scm2'
                    : 'approve_ncr_scm_head';
            }

            const btn = document.getElementById('submitSignBtn');
            btn.disabled = true;

            try {
                const res = await n8nFetch(N8N_BASE + approveEndpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const result = await res.json().catch(() => ({}));
                if (!res.ok || result.success === false) {
                    throw new Error(result.error || 'อนุมัติไม่สำเร็จ');
                }
                closeSignModal();
                // Claim ที่เลือก "ไม่อนุมัติ" ไม่ควรขึ้นข้อความว่า "อนุมัติสำเร็จ" — คนละความหมายกันคนละเรื่อง
                const isNotApprove = claimFields && claimFields.decision === 'NOT_APPROVE';
                showNotification(
                    isNotApprove ? 'บันทึกผลเรียบร้อย' : 'อนุมัติสำเร็จ',
                    isNotApprove
                        ? `บันทึกผล "ไม่อนุมัติ" ของเอกสารเลขที่ ${docId} เรียบร้อยแล้ว`
                        : `บันทึกการอนุมัติเอกสารเลขที่ ${docId} เรียบร้อยแล้ว`,
                    'success'
                );
                await fetchAllQueues();
            } catch (err) {
                showNotification('อนุมัติไม่สำเร็จ', err.message || 'เกิดข้อผิดพลาดไม่ทราบสาเหตุ', 'error');
            } finally {
                btn.disabled = false;
            }
        }

        function openRejectModal() {
            const moduleKey = document.getElementById('signModuleKey').value;
            const stageKey = document.getElementById('signStageKey').value;
            const mod = getModule(moduleKey);
            const stage = getStage(mod, stageKey);

            document.getElementById('rejectReason').value = '';
            document.getElementById('rejectModalTitle').textContent = stage.rejectLabel || 'ปฏิเสธเอกสาร';
            document.getElementById('rejectModalDescription').textContent = stage.rejectDescription
                || 'กรุณาระบุเหตุผลในการปฏิเสธเอกสารนี้ เพื่อแจ้งให้ผู้ขออนุมัติทราบ';
            document.getElementById('confirmRejectBtn').textContent = `ยืนยัน${stage.rejectLabel || 'ปฏิเสธเอกสาร'}`;

            document.getElementById('rejectModal').classList.remove('hidden');
        }

        function closeRejectModal() {
            document.getElementById('rejectModal').classList.add('hidden');
        }

        async function submitReject() {
            const moduleKey = document.getElementById('signModuleKey').value;
            const docId = document.getElementById('signDocId').value;
            const stageKey = document.getElementById('signStageKey').value;
            const reason = document.getElementById('rejectReason').value.trim();

            if (!reason) {
                showNotification('ข้อมูลไม่ครบ', 'กรุณาระบุเหตุผลในการปฏิเสธ', 'error');
                return;
            }

            const mod = getModule(moduleKey);
            const stage = getStage(mod, stageKey);
            if (!stage.rejectEndpoint || !mod.buildRejectPayload) {
                showNotification('ยังไม่รองรับ', `ระบบ ${mod.label} ยังไม่มีฟีเจอร์ปฏิเสธเอกสาร`, 'error');
                return;
            }

            try {
                const res = await n8nFetch(N8N_BASE + stage.rejectEndpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(mod.buildRejectPayload(docId, stageKey, reason))
                });
                const result = await res.json().catch(() => ({}));
                if (!res.ok || result.success === false) {
                    throw new Error(result.error || 'ปฏิเสธเอกสารไม่สำเร็จ');
                }
                closeRejectModal();
                closeSignModal();
                showNotification('ปฏิเสธสำเร็จ', `ปฏิเสธเอกสารเลขที่ ${docId} เรียบร้อยแล้ว`, 'success');
                await fetchAllQueues();
            } catch (err) {
                showNotification('ปฏิเสธไม่สำเร็จ', err.message || 'เกิดข้อผิดพลาดไม่ทราบสาเหตุ', 'error');
            }
        }

        // ==========================================================================================
        // TOAST NOTIFICATION (คงรูปแบบเดียวกับหน้าอื่นในระบบ)
        // ==========================================================================================
        function showNotification(title, message, type = 'success') {
            const container = document.getElementById('toast-container');
            if (!container) return;

            const toast = document.createElement('div');
            toast.className = `transform translate-y-2 opacity-0 transition-all duration-300 pointer-events-auto flex items-start gap-3 bg-white border border-slate-200 rounded-2xl p-4 shadow-xl max-w-sm border-l-4 ${
                type === 'success' ? 'border-l-emerald-500' : type === 'warning' ? 'border-l-amber-500' : 'border-l-red-500'
            }`;

            let icon = 'check-circle';
            let iconColor = 'text-emerald-500';
            if (type === 'warning') { icon = 'alert-triangle'; iconColor = 'text-amber-500'; }
            else if (type === 'error') { icon = 'alert-circle'; iconColor = 'text-red-500'; }

            toast.innerHTML = `
                <div class="mt-0.5 ${iconColor}"><i data-lucide="${icon}" class="w-5 h-5"></i></div>
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

            setTimeout(() => { toast.classList.remove('translate-y-2', 'opacity-0'); }, 10);
            setTimeout(() => {
                toast.classList.add('opacity-0', 'translate-y-[-10px]');
                setTimeout(() => toast.remove(), 300);
            }, 6000);
        }

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

        window.onload = async function () {
            if (typeof renderSidebar === 'function') renderSidebar();
            const mobileSidebarContainer = document.getElementById('mobile-sidebar-content');
            const sidebarContainer = document.getElementById('sidebar-container');
            if (mobileSidebarContainer && sidebarContainer) {
                mobileSidebarContainer.innerHTML = sidebarContainer.innerHTML;
            }
            await ensureRolesLoaded();
            fetchAllQueues().then(() => {
                // มาจากปุ่ม "ตรวจสอบ" ในหน้า Main (?system=ncr|swap|disassembly|claim) → เปิดแท็บของระบบนั้นเลย
                const sys = new URLSearchParams(window.location.search).get('system');
                if (sys && !new URLSearchParams(window.location.search).get('doc') && APPROVAL_MODULES.some(m => m.key === sys)) {
                    filterSystemTab(sys);
                }
                return openFromUrlIfNeeded();
            });
            lucide.createIcons();
        };

        // ===================================================================
        // เปิด Sign Modal อัตโนมัติจากลิงก์อีเมล (?doc=DocId&module=swap|disassembly|ncr)
        // ===================================================================
        function getUrlParams() {
            const params = new URLSearchParams(window.location.search);
            return {
                docId: params.get('doc'),
                moduleKey: params.get('module')
            };
        }

        async function openFromUrlIfNeeded() {
            const { docId, moduleKey } = getUrlParams();
            if (!docId) return;

            // Borrow: เปิดหน้ารายละเอียดเอกสาร (พร้อมปุ่มอนุมัติ/ปฏิเสธ) อัตโนมัติ — ไม่ต้องอยู่ในคิวก็เปิดดูได้
            if (moduleKey === 'borrow') {
                if (window.brwOpenDetail) await window.brwOpenDetail(docId);
                cleanUrlParams();
                return;
            }

            const candidateModules = moduleKey ? [getModule(moduleKey)].filter(Boolean) : APPROVAL_MODULES.filter(m => !m.custom);

            let foundMod = null;
            let foundDoc = null;

            for (const mod of candidateModules) {
                const docs = queueDataByModule[mod.key] || [];
                const match = docs.find(d => String(mod.getDocId(d)) === String(docId));
                if (match) {
                    foundMod = mod;
                    foundDoc = match;
                    break;
                }
            }

            if (!foundMod || !foundDoc) {
                showNotification('ไม่พบเอกสารในคิว', `ไม่พบเอกสาร ${docId} ในคิวที่รอดำเนินการ (อาจถูกดำเนินการไปแล้ว หรือคุณไม่มีสิทธิ์เข้าถึงขั้นตอนนี้)`, 'warning');
                cleanUrlParams();
                return;
            }

            const stage = foundMod.stages.find(s => s.matchDoc(foundDoc));
            if (!stage) {
                showNotification('ไม่พบขั้นตอนที่ตรงกัน', `เอกสาร ${docId} อาจได้รับการดำเนินการไปแล้วครบทุกขั้นตอน`, 'warning');
                cleanUrlParams();
                return;
            }

            const role = getEffectiveRole(foundMod.sessionRoleKey);
            const canAct = stage.canAct(role);

            if (canAct) {
                await openSignModal(foundMod.key, stage.key, docId);
            } else {
                await viewOnly(foundMod.key, stage.key, docId);
            }

            cleanUrlParams();
        }

        function cleanUrlParams() {
            const cleanUrl = window.location.pathname;
            window.history.replaceState({}, document.title, cleanUrl);
        }
// --- sub-module block ---

// --- sub-module block ---
    // ===== Borrow (BRW): ปุ่มอนุมัติ/ปฏิเสธ/บันทึกรับคืน ของระบบ borrow ในโครง APPROVAL_MODULES =====
    // ปุ่มแสดงตามสิทธิ์ APPROVE / REJECT_BACK จาก Permission — ฝั่ง server (borrow_approve / borrow_reject) ตรวจซ้ำทุกครั้ง
    (function () {
        const N8N = 'https://n8n.ktw.co.th/webhook/';
        const empId = () => sessionStorage.getItem('emp_id') || '';
        const e = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
        let perms = new Set();
        async function post(path, body) {
            try {
                const res = await n8nFetch(N8N + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
                const t = await res.text(); let j = t && t.trim() ? JSON.parse(t) : null; if (Array.isArray(j)) j = j[0];
                return j || { success: false, error: 'ไม่ได้รับข้อมูลจากเซิร์ฟเวอร์ (HTTP ' + res.status + ')' };
            } catch (err) { console.error(path, err); return { success: false, error: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้' }; }
        }
        function note(msg, ok) {
            const d = document.createElement('div');
            d.className = 'fixed top-4 right-4 z-[9999] px-4 py-3 rounded-xl shadow-lg text-sm text-white ' + (ok ? 'bg-emerald-600' : 'bg-red-600');
            d.textContent = msg; document.body.appendChild(d); setTimeout(() => d.remove(), 3500);
        }
        function ask(title, bodyHtml, okLabel, okClass, onOk) {
            const m = document.createElement('div');
            m.className = 'fixed inset-0 z-[9998] flex items-center justify-center bg-black/40 p-4';
            m.innerHTML = `<div class="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-4">
                <h3 class="font-semibold text-slate-800">${title}</h3><div>${bodyHtml}</div>
                <div class="flex justify-end gap-2"><button type="button" data-x class="h-9 px-4 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50">ยกเลิก</button>
                <button type="button" data-ok class="h-9 px-4 rounded-lg text-sm font-medium text-white ${okClass}">${okLabel}</button></div></div>`;
            document.body.appendChild(m);
            m.querySelector('[data-x]').onclick = () => m.remove();
            m.querySelector('[data-ok]').onclick = async (ev) => {
                const btn = ev.currentTarget; btn.disabled = true;
                const done = await onOk(m);
                if (done) m.remove(); else btn.disabled = false;
            };
        }
        window.brwApprove = function (docNo) {
            ask('อนุมัติและส่งมอบของ', `<p class="text-sm text-slate-700">ยืนยันอนุมัติเอกสาร <b>${e(docNo)}</b> และส่งมอบของให้ผู้ยืมใช่หรือไม่</p>`, 'อนุมัติ', 'bg-emerald-600 hover:bg-emerald-700',
                async () => { const r = await post('borrow_approve', { actionByEmpId: empId(), docNo }); note(r.success ? 'อนุมัติเรียบร้อย' : (r.error || 'อนุมัติไม่สำเร็จ'), r.success); if (r.success) { closeDetail(); fetchAllQueues(); } return r.success; });
        };
        window.brwReject = function (docNo) {
            ask('ปฏิเสธเอกสาร', `<label class="block text-xs font-semibold text-slate-500 mb-1">เหตุผลที่ปฏิเสธ <span class="text-red-500">*</span></label><textarea data-reason rows="3" class="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm outline-none focus:ring-1 focus:ring-orange-500"></textarea>`, 'ปฏิเสธ', 'bg-red-600 hover:bg-red-700',
                async (m) => { const reason = m.querySelector('[data-reason]').value.trim(); if (!reason) { note('กรุณาระบุเหตุผล', false); return false; }
                    const r = await post('borrow_reject', { actionByEmpId: empId(), docNo, reason }); note(r.success ? 'ปฏิเสธเรียบร้อย' : (r.error || 'ปฏิเสธไม่สำเร็จ'), r.success); if (r.success) { closeDetail(); fetchAllQueues(); } return r.success; });
        };
        // โหลดสิทธิ์ + คิวของ Borrow ให้โครงหน้าอนุมัติ (APPROVAL_MODULES.borrow) — server ตรวจสิทธิ์ซ้ำทุก endpoint
        window.brwCan = k => perms.has(k);
        window.brwFetchQueue = async function () {
            const pr = await post('borrow_my_perms', { actorEmpId: empId() });
            perms = new Set(pr.success ? (pr.perms || []) : []);
            if (!perms.has('APPROVE') && !perms.has('REJECT_BACK')) return [];
            const j = await post('borrow_queue', { actorEmpId: empId() });
            if (!j.success) { note(j.error || 'โหลดคิวยืมสินค้าไม่สำเร็จ', false); return []; }
            return (j.data || []).filter(d => d.status === 'รออนุมัติ');   // หน้านี้อนุมัติ/ปฏิเสธเท่านั้น — บันทึกรับคืนทำที่ borrow_form.html (ประวัติเอกสารทุกคน > จัดการ)
        };
        // ปุ่มเดียว "ตรวจสอบ/เซ็น" เหมือนระบบเคลมสินค้าลูกค้า — กดแล้วเปิดหน้ารายละเอียดเต็ม แล้วอนุมัติ/ปฏิเสธในหน้านั้น (สิทธิ์ + กฎ CTS อนุมัติเอกสารตัวเองไม่ได้ ตรวจในหน้ารายละเอียดและที่ server)
        window.brwApproveActions = function (d) {
            const q = e(d.docNo);
            return `<button type="button" onclick="brwOpenDetail('${q}')" class="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold bg-brand-500 text-white hover:bg-brand-600 shadow-xs active:scale-95">
                <i data-lucide="file-signature" class="w-3.5 h-3.5"></i> ตรวจสอบ/เซ็น</button>`;
        };

        // ---------- หน้ารายละเอียดเอกสารยืม (ครบทุกข้อมูล + รูปสินค้า) พร้อมอนุมัติ/ปฏิเสธ ----------
        window.brwItemsStack = function (v) {
            const lines = String(v || '').split('\n').map(x => x.trim()).filter(Boolean);
            if (!lines.length) return '-';
            return lines.map((l, i) => `<div class="flex gap-1.5 text-xs leading-5"><span class="text-slate-300 shrink-0">${i + 1}.</span><span>${e(l)}</span></div>`).join('');
        };
        const fmtD = v => { if (!v) return '-'; const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/); if (!m) return e(v); const mo = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.']; return (+m[3]) + ' ' + mo[+m[2] - 1] + ' ' + (+m[1] + 543); };
        const fmtDT = v => { if (!v) return '-'; const m = String(v).match(/T(\d{2}:\d{2})/); return fmtD(v) + (m ? ' ' + m[1] + ' น.' : ''); };
        const qty = n => { const x = Number(n); return isNaN(x) ? '-' : String(+x.toFixed(3)); };
        window.closeDetail = function () { const m = document.getElementById('brwDetail'); if (m) m.remove(); };
        window.brwShowPhoto = function (src) {
            const m = document.createElement('div');
            m.className = 'fixed inset-0 z-[9997] flex items-center justify-center bg-black/80 p-4 cursor-zoom-out';
            m.innerHTML = `<img src="${src}" class="max-w-full max-h-full rounded-lg shadow-2xl">`;
            m.onclick = () => m.remove(); document.body.appendChild(m);
        };
        let detailPhotos = [];
        window.brwOpenDetail = async function (docNo) {
            closeDetail();
            const m = document.createElement('div');
            m.id = 'brwDetail';
            m.className = 'fixed inset-0 z-[9990] flex items-center justify-center bg-slate-900/60 p-4';
            m.innerHTML = `<div class="bg-white rounded-2xl shadow-2xl w-full max-w-[96vw] max-h-[92vh] flex flex-col">
                <div class="bg-gradient-to-r from-slate-900 to-slate-800 text-white p-5 flex items-center justify-between shrink-0 rounded-t-2xl">
                    <div><div class="text-[11px] text-orange-300 font-semibold tracking-wide">ขออนุมัติยืมสินค้าหน้าร้าน (Borrow)</div><div class="text-lg font-bold font-mono" data-title>${e(docNo)}</div></div>
                    <button type="button" onclick="closeDetail()" class="p-2 rounded-lg hover:bg-white/10"><i data-lucide="x" class="w-5 h-5"></i></button></div>
                <div class="p-5 overflow-y-auto flex-1 space-y-4" data-body><p class="text-center text-slate-400 py-10">กำลังโหลด...</p></div>
                <div class="p-4 border-t border-slate-200 flex flex-wrap justify-end items-center gap-2 shrink-0" data-actions></div></div>`;
            document.body.appendChild(m);
            m.addEventListener('click', ev => { if (ev.target === m) closeDetail(); });
            if (window.lucide) lucide.createIcons();
            const r = await post('borrow_detail', { actorEmpId: empId(), docNo });
            const body = m.querySelector('[data-body]');
            if (!r.success) { body.innerHTML = `<p class="text-center text-red-500 py-10">${e(r.error || 'โหลดเอกสารไม่สำเร็จ')}</p>`; return; }
            const doc = r.doc, items = r.items || [];
            detailPhotos = items.map(i => i.photo || '');
            // ===== โครงเดียวกับหน้าสร้าง/แก้ไขเอกสาร (borrow_form.html) แต่อ่านอย่างเดียว =====
            const lbl = t => `<label class="block text-xs font-semibold text-slate-500 mb-1.5">${t}</label>`;
            const ro = (v, cls = '') => `<input disabled value="${e(v ?? '')}" class="w-full h-10 px-3 rounded-lg border border-slate-200 bg-slate-50 text-sm text-slate-700 ${cls}" />`;
            const ro9 = v => `<input disabled value="${e(v ?? '')}" class="w-full h-9 px-2.5 rounded-lg border border-slate-200 bg-slate-100 text-xs text-slate-600" />`;
            const badgeCls = { 'รออนุมัติ': 'bg-amber-50 text-amber-700 border-amber-200', 'กำลังยืม': 'bg-blue-50 text-blue-700 border-blue-200', 'ปฏิเสธ': 'bg-red-50 text-red-700 border-red-200' }[doc.status] || 'bg-slate-50 text-slate-600 border-slate-200';
            m.querySelector('[data-title]').textContent = doc.docNo;
            const radios = ['ถ่ายคลิป', 'ใช้งานภายใน', 'อื่นๆ'].map(x => `<label class="flex items-center gap-1.5 text-sm ${doc.purpose === x ? 'text-slate-800 font-medium' : 'text-slate-400'}"><input type="radio" disabled ${doc.purpose === x ? 'checked' : ''} /> ${x}</label>`).join('')
                + (doc.purpose === 'อื่นๆ' ? `<input disabled value="${e(doc.purposeNote || '')}" class="flex-1 min-w-[180px] h-9 px-3 rounded-lg border border-slate-200 bg-slate-50 text-sm text-slate-700" />` : '');
            const rowsHtml = items.map((i, n) => `<tr>
                <td class="p-2 text-center text-slate-400 text-xs">${i.lineNum}</td>
                <td class="p-2">${ro(i.productCode, 'h-9 text-xs text-center')}</td><td class="p-2">${ro(i.productName, 'h-9 text-xs')}</td>
                <td class="p-2">${ro(qty(i.qtyBorrowed), 'h-9 text-xs text-right')}</td><td class="p-2">${ro(i.serialNo, 'h-9 text-xs')}</td><td class="p-2">${ro(i.remark, 'h-9 text-xs')}</td>
                <td class="p-2">${i.photo ? `<span class="inline-flex items-center gap-1"><img src="${e(i.photo)}" alt="" onclick="brwShowPhoto(detailPhotosAt(${n}))" class="w-9 h-9 object-cover rounded-md border border-slate-200 cursor-zoom-in"><button type="button" onclick="brwShowPhoto(detailPhotosAt(${n}))" class="h-8 px-2 rounded-md border border-slate-200 text-xs text-slate-600 hover:bg-slate-50">ดูรูป</button></span>` : '<span class="text-xs text-slate-300">ไม่มีรูป</span>'}</td></tr>`).join('');
            body.innerHTML = `
              <div class="grid grid-cols-1 lg:grid-cols-4 gap-4">
                <div class="lg:col-span-2">${lbl('วัตถุประสงค์')}<div class="flex flex-wrap items-center gap-x-4 gap-y-2 min-h-10">${radios}</div></div>
                <div>${lbl('เลขที่เอกสาร')}${ro(doc.docNo, 'font-mono')}</div>
                <div>${lbl('วันที่ยืม')}${ro(fmtD(doc.borrowDate))}</div>
              </div>
              <div class="grid grid-cols-1 lg:grid-cols-4 gap-4">
                <div>${lbl('กำหนดคืน')}${ro(fmtD(doc.dueDate))}</div>
                <div>${lbl('สถานะ')}<div class="min-h-10 flex items-center"><span class="text-xs font-semibold px-2.5 py-1 rounded-lg border ${badgeCls}">${e(doc.status)}</span></div></div>
                <div>${lbl('ผู้สร้างเอกสาร')}${ro(doc.createdByName || doc.createdByEmpId)}</div>
                <div>${lbl('สร้างเมื่อ')}${ro(fmtDT(doc.createdAt))}</div>
              </div>
              <div><h3 class="text-sm font-semibold text-slate-700 mb-2">รายการสินค้าที่ยืม</h3>
                <div class="border border-slate-200 rounded-xl overflow-x-auto"><table class="w-full table-fixed text-left border-collapse min-w-[1100px]">
                  <thead><tr class="bg-slate-50/75 border-b border-slate-200 text-xs font-semibold text-slate-500"><th class="p-3 w-10 text-center">#</th><th class="p-3">รหัสสินค้า</th><th class="p-3">รายละเอียดสินค้า</th><th class="p-3 w-24">จำนวน</th><th class="p-3 w-48">Serial</th><th class="p-3">หมายเหตุ</th><th class="p-3 w-48">รูปสินค้า</th></tr></thead>
                  <tbody class="divide-y divide-slate-100">${rowsHtml}</tbody></table></div></div>
              ${doc.remark ? `<div>${lbl('หมายเหตุเอกสาร')}${ro(doc.remark)}</div>` : ''}
              ${doc.rejectReason ? `<div class="text-sm bg-red-50 border border-red-100 text-red-700 rounded-xl p-3">เหตุผลที่ปฏิเสธ: ${e(doc.rejectReason)}</div>` : ''}
              <div class="border border-slate-200 rounded-xl p-4 space-y-3 bg-slate-50/50">
                <h3 class="text-sm font-semibold text-slate-700">ผู้เกี่ยวข้องกับเอกสาร</h3>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div class="space-y-1"><div class="text-[11px] font-semibold text-slate-500">ผู้ขออนุมัติยืมสินค้าหน้าร้าน</div><div class="text-[11px] text-slate-400">ชื่อ-นามสกุล</div>${ro9(doc.borrowerName || doc.borrowerEmpId)}<div class="text-[11px] text-slate-400">Email</div>${ro9(doc.borrowerEmail)}</div>
                  <div class="space-y-1"><div class="text-[11px] font-semibold text-slate-500">เจ้าหน้าที่หน้าร้าน (CTS)</div><div class="text-[11px] text-slate-400">ผู้รับเรื่อง</div>${ro9(doc.ctsEmpId ? (doc.ctsName || doc.ctsEmpId) : 'ทุกคนในทีม CTS')}<div class="text-[11px] text-slate-400">Email</div>${ro9(doc.ctsEmail)}</div>
                  <div class="space-y-1"><div class="text-[11px] font-semibold text-slate-500">ผู้อนุมัติ/ส่งมอบ</div><div class="text-[11px] text-slate-400">ชื่อ-นามสกุล</div>${ro9(doc.approvedByName || doc.approvedByEmpId)}<div class="text-[11px] text-slate-400">${doc.status === 'ปฏิเสธ' ? 'ปฏิเสธเมื่อ' : 'อนุมัติเมื่อ'}</div>${ro9(doc.approvedAt ? fmtDT(doc.approvedAt) : '')}</div>
                </div>
              </div>`;
            const mine = (String(doc.borrowerEmpId) === empId() || String(doc.createdByEmpId || '') === empId());
            const canSelf = await (async () => { const q = await post('borrow_queue', { actorEmpId: empId() }); const row = (q.data || [])[0]; return row ? Number(row.canSelfApprove) : 0; })();
            const act = m.querySelector('[data-actions]'); const q = e(doc.docNo);
            let h = '';
            if (doc.status === 'รออนุมัติ') {
                if (perms.has('APPROVE') && (!mine || canSelf)) h += `<button type="button" onclick="brwApprove('${q}')" class="h-10 px-5 rounded-lg text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700">อนุมัติ / ส่งมอบ</button>`;
                if (perms.has('REJECT_BACK')) h += `<button type="button" onclick="brwReject('${q}')" class="h-10 px-5 rounded-lg text-sm font-medium border border-red-200 text-red-600 hover:bg-red-50">ปฏิเสธ</button>`;
                if (mine && !canSelf) h += '<span class="text-xs text-slate-400 mr-auto">เอกสารของคุณ — ต้องให้ CTS คนอื่นอนุมัติ</span>';
                if (!h) h = '<span class="text-xs text-slate-400">คุณไม่มีสิทธิ์อนุมัติเอกสารนี้</span>';
            } else h = '<span class="text-xs text-slate-400 mr-auto">เอกสารนี้ไม่ได้อยู่ในสถานะรออนุมัติแล้ว (ดูอย่างเดียว)</span>';
            h += `<button type="button" onclick="closeDetail()" class="h-10 px-5 rounded-lg text-sm border border-slate-200 text-slate-600 hover:bg-slate-50">ปิด</button>`;
            act.innerHTML = h;
        };
        window.detailPhotosAt = n => detailPhotos[n] || '';
    })();
