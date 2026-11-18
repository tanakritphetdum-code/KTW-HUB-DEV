// ===================================================================
// modules/pricePromotionService.js — Logic ขออนุมัติสร้างใบราคา/โปรโมชั่น
// KTW-9695: จัดการคำขอ, การตรวจสอบฟอร์ม, ไทม์ไลน์ และสายการอนุมัติ 2 กรณี
// ===================================================================

(function() {
    const STORAGE_KEY = 'KTW_PRICE_PROMOTION_DOCS';
    let allDocuments = [];
    let filteredDocuments = [];

    // Seed ข้อมูลตัวอย่างเริ่มต้นตามภาพ Image 2
    const INITIAL_SEED_DOCS = [
        {
            docId: 'PRC-202611-0001',
            docDate: '2026-11-14',
            brand: 'MAKITA',
            productHierarchy: 'M0100',
            title: 'promotion แถมเสื้อ',
            startDate: '2026-11-15',
            endDate: '2026-12-31',
            noExpiry: false,
            empId: '12504',
            createdByName: 'เจ้าหน้าที่การตลาด',
            approverName: 'ภูริชญา เทียนไชย',
            status: 'COMPLETED',
            docType: 'PROMOTION_SPECIAL',
            pageCount: 2,
            fileSizeMb: 5,
            filePath: '\\\\ktserver\\marketing\\makita_promo_nov2026.pdf',
            deliveryType: 'PATH',
            execName: 'คุณเอกพล ไววิทย์ลิขิต',
            execEmail: 'EKKAPHON@KTW.CO.TH',
            baName: 'คุณภูริชญา เทียนไชย',
            baEmail: 'BA@KTW.CO.TH',
            scmName: 'คุณอัจฉรา ธาราชีพ',
            scmEmail: 'ARCHARA@KTW.CO.TH',
            timeline: [
                { step: 'Step 1: การตลาด', action: 'ยื่นคำขอ', by: 'เจ้าหน้าที่การตลาด (12504)', time: '14/11/2026 09:30 น.', status: 'DONE' },
                { step: 'Step 2: ผู้บริหาร', action: 'อนุมัติ', by: 'คุณเอกพล ไววิทย์ลิขิต', time: '14/11/2026 10:15 น.', status: 'DONE' },
                { step: 'Step 3: ทีม BA', action: 'อนุมัติและจบที่ BA', by: 'คุณภูริชญา เทียนไชย', time: '14/11/2026 10:24 น.', status: 'DONE', comment: 'ตรวจสอบเงื่อนไขโปรโมชั่นแล้ว ถูกต้องครบถ้วน' }
            ]
        },
        {
            docId: 'PRC-202611-0002',
            docDate: '2026-11-14',
            brand: 'POLO (SPRAYER)',
            productHierarchy: 'P1100',
            title: 'promotion ต่อโปร',
            startDate: '2026-11-15',
            endDate: '9999-12-31',
            noExpiry: true,
            empId: '12504',
            createdByName: 'เจ้าหน้าที่การตลาด',
            approverName: 'คุณกมลชัย ไววิทย์ลิขิต',
            status: 'PENDING_EXEC',
            docType: 'PRICE_SHEET',
            pageCount: 1,
            fileSizeMb: 3,
            filePath: '\\\\ktserver\\marketing\\polo_price_sheet.pdf',
            deliveryType: 'PATH',
            execName: 'คุณกมลชัย ไววิทย์ลิขิต',
            execEmail: 'KAMOLCHAI@KTW.CO.TH',
            baName: 'คุณนภาพร ประสิทธิเม',
            baEmail: 'BA@KTW.CO.TH',
            scmName: 'คุณเขมจิรา รักสมยา',
            scmEmail: 'KHEMJIRA@KTW.CO.TH',
            timeline: [
                { step: 'Step 1: การตลาด', action: 'ยื่นคำขอ', by: 'เจ้าหน้าที่การตลาด (12504)', time: '14/11/2026 10:20 น.', status: 'DONE' },
                { step: 'Step 2: ผู้บริหาร', action: 'รอตรวจสอบ', by: 'คุณกมลชัย ไววิทย์ลิขิต', time: '-', status: 'PENDING' }
            ]
        }
    ];

    // โหลดข้อมูลจาก LocalStorage หรือ n8n
    function loadLocalDocuments() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed) && parsed.length > 0) return parsed;
            }
        } catch (e) {
            console.warn('โหลด LocalStorage ไม่สำเร็จ:', e);
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(INITIAL_SEED_DOCS));
        return INITIAL_SEED_DOCS;
    }

    function saveLocalDocuments(docs) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(docs));
        } catch (e) {
            console.warn('บันทึก LocalStorage ไม่สำเร็จ:', e);
        }
    }

    // เริ่มต้นโมดูล
    window.initPricePromotionService = async function() {
        await window.fetchPricePromotionList();
    };

    // ดึงรายการเอกสาร
    window.fetchPricePromotionList = async function() {
        const syncIcon = document.getElementById('sync-icon');
        if (syncIcon) syncIcon.classList.add('animate-spin');

        try {
            // ลองเรียกผ่าน n8n (ถ้ามี)
            if (window.n8nFetch) {
                try {
                    const res = await window.n8nFetch('get_all_price_promotion_documents');
                    if (res && res.ok) {
                        const data = await res.json();
                        if (Array.isArray(data) && data.length > 0) {
                            allDocuments = data;
                            renderTable();
                            updateSyncTime();
                            if (syncIcon) syncIcon.classList.remove('animate-spin');
                            return;
                        }
                    }
                } catch (apiErr) {
                    // Fallback to local storage
                }
            }
            allDocuments = loadLocalDocuments();
            renderTable();
            updateSyncTime();
        } finally {
            if (syncIcon) syncIcon.classList.remove('animate-spin');
        }
    };

    function updateSyncTime() {
        const el = document.getElementById('last-sync-time');
        if (!el) return;
        const now = new Date();
        const d = String(now.getDate()).padStart(2, '0');
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const y = now.getFullYear() + 543;
        const h = String(now.getHours()).padStart(2, '0');
        const min = String(now.getMinutes()).padStart(2, '0');
        el.textContent = `อัปเดตล่าสุด: ${d}/${m}/${y} ${h}:${min} น.`;
    }

    // ฟังก์ชันค้นหาและกรอง
    window.applyFilters = function() {
        const search = (document.getElementById('filter-search')?.value || '').trim().toLowerCase();
        const status = document.getElementById('filter-status')?.value || 'ALL';
        const brand = document.getElementById('filter-brand')?.value || 'ALL';
        const hierarchy = document.getElementById('filter-hierarchy')?.value || 'ALL';
        const date = document.getElementById('filter-date')?.value || '';

        filteredDocuments = allDocuments.filter(doc => {
            if (status !== 'ALL' && doc.status !== status) return false;
            if (brand !== 'ALL' && doc.brand !== brand) return false;
            if (hierarchy !== 'ALL' && doc.productHierarchy !== hierarchy) return false;
            if (date && doc.docDate !== date) return false;
            if (search) {
                const matchTitle = (doc.title || '').toLowerCase().includes(search);
                const matchBrand = (doc.brand || '').toLowerCase().includes(search);
                const matchEmp = (doc.empId || '').toLowerCase().includes(search);
                const matchDocId = (doc.docId || '').toLowerCase().includes(search);
                if (!matchTitle && !matchBrand && !matchEmp && !matchDocId) return false;
            }
            return true;
        });

        renderFilteredTable();
    };

    function renderTable() {
        filteredDocuments = [...allDocuments];
        renderFilteredTable();
    }

    function renderFilteredTable() {
        const tbody = document.getElementById('document-table-body');
        const countText = document.getElementById('record-count-text');
        if (!tbody) return;

        if (countText) countText.textContent = `แสดง ${filteredDocuments.length} รายการ (จากทั้งหมด ${allDocuments.length} รายการ)`;

        if (filteredDocuments.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="10" class="text-center py-10 text-slate-400">
                        <i data-lucide="inbox" class="w-8 h-8 mx-auto mb-2 opacity-50"></i>
                        <p class="font-medium text-xs">ไม่พบรายการเอกสารตามเงื่อนไขที่เลือก</p>
                    </td>
                </tr>
            `;
            if (window.lucide) window.lucide.createIcons();
            return;
        }

        tbody.innerHTML = filteredDocuments.map(doc => {
            const statusBadge = getStatusBadge(doc.status);
            const dateFmt = formatThaiDate(doc.docDate);
            const startFmt = formatThaiDate(doc.startDate);
            const endFmt = doc.noExpiry ? 'จนกว่าจะประกาศยกเลิก' : (doc.endDate === '9999-12-31' ? 'ไม่มีกำหนด' : formatThaiDate(doc.endDate));

            return `
                <tr class="hover:bg-slate-50/80 transition-colors border-b border-slate-100 group">
                    <td class="py-3 px-4 font-medium text-slate-900 whitespace-nowrap">${dateFmt}</td>
                    <td class="py-3 px-3 font-semibold text-slate-800 whitespace-nowrap">${doc.brand || '-'}</td>
                    <td class="py-3 px-3 font-mono text-[11px] text-slate-600 whitespace-nowrap">${doc.productHierarchy || '-'}</td>
                    <td class="py-3 px-4 max-w-xs truncate" title="${escapeHtml(doc.title)}">
                        <span class="font-semibold text-slate-900 block truncate">${escapeHtml(doc.title)}</span>
                        <span class="text-[10px] text-slate-400 font-mono">${doc.docId}</span>
                    </td>
                    <td class="py-3 px-3 text-slate-600 whitespace-nowrap">${startFmt}</td>
                    <td class="py-3 px-3 text-slate-600 whitespace-nowrap">${endFmt}</td>
                    <td class="py-3 px-3 font-mono text-slate-600 whitespace-nowrap">${doc.empId || '-'}</td>
                    <td class="py-3 px-3 text-slate-700 whitespace-nowrap">${doc.approverName || '-'}</td>
                    <td class="py-3 px-3 whitespace-nowrap">${statusBadge}</td>
                    <td class="py-3 px-4 text-center whitespace-nowrap">
                        <div class="inline-flex items-center gap-1 opacity-90 group-hover:opacity-100">
                            <button onclick="viewDocumentDetail('${doc.docId}')" title="ดูรายละเอียดและประวัติ"
                                class="p-1.5 rounded-lg text-slate-600 hover:text-orange-600 hover:bg-orange-50 transition-all">
                                <i data-lucide="eye" class="w-4 h-4"></i>
                            </button>
                            <button onclick="printDocument('${doc.docId}')" title="พิมพ์เอกสาร"
                                class="p-1.5 rounded-lg text-slate-600 hover:text-blue-600 hover:bg-blue-50 transition-all">
                                <i data-lucide="printer" class="w-4 h-4"></i>
                            </button>
                            ${(doc.status === 'REJECTED' || doc.status === 'PENDING_EXEC') ? `
                            <button onclick="cancelDocument('${doc.docId}')" title="ยกเลิกคำขอ"
                                class="p-1.5 rounded-lg text-slate-600 hover:text-red-600 hover:bg-red-50 transition-all">
                                <i data-lucide="rotate-ccw" class="w-4 h-4"></i>
                            </button>` : ''}
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

        if (window.lucide) window.lucide.createIcons();
    }

    function getStatusBadge(status) {
        switch (status) {
            case 'COMPLETED':
                return '<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200"><span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>เสร็จสิ้น</span>';
            case 'PENDING_EXEC':
                return '<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200"><span class="w-1.5 h-1.5 rounded-full bg-amber-500"></span>รอผู้บริหารอนุมัติ</span>';
            case 'PENDING_BA':
                return '<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-purple-50 text-purple-700 border border-purple-200"><span class="w-1.5 h-1.5 rounded-full bg-purple-500"></span>รอ BA อนุมัติ</span>';
            case 'PENDING_SCM':
                return '<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200"><span class="w-1.5 h-1.5 rounded-full bg-blue-500"></span>รอ SCM อนุมัติ</span>';
            case 'REJECTED':
                return '<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200"><span class="w-1.5 h-1.5 rounded-full bg-rose-500"></span>ตีกลับให้แก้ไข</span>';
            case 'CANCELLED':
                return '<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-600 border border-slate-200">ยกเลิก</span>';
            default:
                return `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-700">${status || '-'}</span>`;
        }
    }

    function formatThaiDate(dateStr) {
        if (!dateStr) return '-';
        const parts = String(dateStr).split('T')[0].split('-');
        if (parts.length < 3) return dateStr;
        const y = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10);
        const d = parseInt(parts[2], 10);
        if (isNaN(y) || isNaN(m) || isNaN(d)) return dateStr;
        return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y + 543}`;
    }

    function escapeHtml(str) {
        return String(str || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }

    // จัดการบันทึกคำขอจากฟอร์ม
    window.handleFormSubmit = async function(e) {
        e.preventDefault();
        const btn = document.getElementById('btn-save-request');
        if (btn) btn.disabled = true;

        try {
            const docDate = document.getElementById('doc_date').value;
            const brand = document.getElementById('brand').value.trim();
            const productHierarchy = document.getElementById('product_hierarchy').value;
            const pageCount = parseInt(document.getElementById('page_count').value, 10) || 1;
            const title = document.getElementById('title').value.trim();
            const startDate = document.getElementById('start_date').value;
            const noExpiry = document.getElementById('no_expiry').checked;
            const endDate = noExpiry ? '9999-12-31' : (document.getElementById('end_date').value || '9999-12-31');

            const docTypeEl = document.querySelector('input[name="doc_type"]:checked');
            const docType = docTypeEl ? docTypeEl.value : 'PRICE_SHEET';
            const replaceOld = document.getElementById('replace_old').checked;
            const oldPromoName = document.getElementById('old_promo_name').value.trim();

            const promoOver4 = document.querySelector('input[name="promo_names_over4"]:checked')?.value || 'NO';
            const priceChange = document.querySelector('input[name="price_change"]:checked')?.value || 'NO';
            const kcatalogPage = document.getElementById('kcatalog_page').value.trim();
            const hasNewProd = document.querySelector('input[name="has_new_product"]:checked')?.value || 'NO';
            const newProdDetail = document.getElementById('new_prod_detail').value.trim();
            const fileSizeMb = parseFloat(document.getElementById('file_size_mb').value) || 10;
            const fileDelivery = document.querySelector('input[name="file_delivery"]:checked')?.value || 'PATH';
            const filePath = document.getElementById('file_path').value.trim();
            const emailSentDate = document.getElementById('email_sent_date').value;
            const printCopy = document.querySelector('input[name="print_copy"]:checked')?.value || 'PRINT';
            const printQty = parseInt(document.getElementById('print_qty').value, 10) || 0;
            const printBwQty = parseInt(document.getElementById('print_bw_qty').value, 10) || 0;

            // ผู้เกี่ยวข้อง
            const mktName = document.getElementById('mkt_name').value;
            const mktEmail = document.getElementById('mkt_email').value;
            const execSelect = document.getElementById('exec_select');
            const execEmail = execSelect.value;
            const execName = execSelect.options[execSelect.selectedIndex]?.getAttribute('data-name') || '';

            const baSelect = document.getElementById('ba_select');
            const baEmail = baSelect.value;
            const baName = baSelect.options[baSelect.selectedIndex]?.getAttribute('data-name') || '';

            const scmSelect = document.getElementById('scm_select');
            const scmEmail = scmSelect.value;
            const scmName = scmSelect.options[scmSelect.selectedIndex]?.getAttribute('data-name') || '';

            const currentEmpId = sessionStorage.getItem('emp_id') || '13125';

            // สร้าง DocId
            const now = new Date();
            const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
            const seq = String(allDocuments.length + 1).padStart(4, '0');
            const docId = `PRC-${yearMonth}-${seq}`;

            const newDoc = {
                docId,
                docDate,
                brand,
                productHierarchy,
                pageCount,
                title,
                startDate,
                endDate,
                noExpiry,
                empId: currentEmpId,
                createdByName: mktName,
                createdByEmail: mktEmail,
                approverName: execName,
                status: 'PENDING_EXEC', // เริ่มต้นส่งไปให้ผู้บริหาร Step 2
                docType,
                replaceOld,
                oldPromoName,
                promoOver4,
                priceChange,
                kcatalogPage,
                hasNewProd,
                newProdDetail,
                fileSizeMb,
                fileDelivery,
                filePath,
                emailSentDate,
                printCopy,
                printQty,
                printBwQty,
                execName,
                execEmail,
                baName,
                baEmail,
                scmName,
                scmEmail,
                timeline: [
                    {
                        step: 'Step 1: เจ้าหน้าที่ดูแลสินค้า (การตลาด)',
                        action: 'จัดทำคำขอสำเร็จ',
                        by: `${mktName} (${currentEmpId})`,
                        time: `${formatThaiDate(docDate)} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')} น.`,
                        status: 'DONE',
                        comment: 'ยื่นคำขออนุมัติสร้างใบราคา/โปรโมชั่น'
                    },
                    {
                        step: 'Step 2: ผู้ตรวจเอกสาร (ผู้บริหาร)',
                        action: 'รอตรวจสอบและลงชื่ออนุมัติ',
                        by: execName,
                        email: execEmail,
                        time: '-',
                        status: 'PENDING'
                    }
                ]
            };

            // บันทึกคำขอ
            allDocuments.unshift(newDoc);
            saveLocalDocuments(allDocuments);

            // ปิด Modal & แจ้งเตือน
            window.closeCreateModal();
            renderTable();
            alert(`ยื่นคำขอสร้างใบราคา/โปรโมชั่นสำเร็จ!\nเลขที่เอกสาร: ${docId}\nระบบได้ส่งคำขอไปยัง ${execName} (${execEmail}) เรียบร้อยแล้ว`);
        } catch (err) {
            console.error('Error submitting form:', err);
            alert('เกิดข้อผิดพลาดในการบันทึกคำขอ: ' + err.message);
        } finally {
            if (btn) btn.disabled = false;
        }
    };

    // ดูรายละเอียดเอกสารและไทม์ไลน์
    window.viewDocumentDetail = function(docId) {
        const doc = allDocuments.find(d => d.docId === docId);
        if (!doc) return;

        document.getElementById('detail-doc-id').textContent = doc.docId;
        document.getElementById('detail-doc-title').textContent = doc.title;

        const body = document.getElementById('detail-modal-body');
        if (!body) return;

        const dateFmt = formatThaiDate(doc.docDate);
        const startFmt = formatThaiDate(doc.startDate);
        const endFmt = doc.noExpiry ? 'จนกว่าจะประกาศยกเลิก' : (doc.endDate === '9999-12-31' ? 'ไม่มีกำหนด' : formatThaiDate(doc.endDate));

        body.innerHTML = `
            <!-- Overview Grid -->
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 bg-slate-50 rounded-2xl border border-slate-200">
                <div>
                    <span class="text-slate-400 block text-[10px]">วันที่ออกเอกสาร</span>
                    <strong class="text-slate-800">${dateFmt}</strong>
                </div>
                <div>
                    <span class="text-slate-400 block text-[10px]">สินค้ายี่ห้อ</span>
                    <strong class="text-slate-800">${doc.brand}</strong>
                </div>
                <div>
                    <span class="text-slate-400 block text-[10px]">Product Hierarchy</span>
                    <strong class="text-slate-800 font-mono">${doc.productHierarchy}</strong>
                </div>
                <div>
                    <span class="text-slate-400 block text-[10px]">สถานะปัจจุบัน</span>
                    ${getStatusBadge(doc.status)}
                </div>
                <div class="col-span-2">
                    <span class="text-slate-400 block text-[10px]">ระยะเวลาใช้งาน</span>
                    <strong class="text-slate-800">${startFmt} ถึง ${endFmt}</strong>
                </div>
                <div>
                    <span class="text-slate-400 block text-[10px]">จำนวนหน้า</span>
                    <strong class="text-slate-800">${doc.pageCount} หน้า</strong>
                </div>
                <div>
                    <span class="text-slate-400 block text-[10px]">ขนาดไฟล์</span>
                    <strong class="text-slate-800">${doc.fileSizeMb} MB</strong>
                </div>
            </div>

            <!-- Checklist Summary -->
            <div class="space-y-2 p-4 bg-white rounded-2xl border border-slate-200">
                <h4 class="font-bold text-slate-800 flex items-center gap-1.5 text-xs">
                    <i data-lucide="check-square" class="w-4 h-4 text-orange-500"></i>
                    รายละเอียดและเช็คลิสต์ 7 ข้อ
                </h4>
                <ul class="space-y-1.5 text-slate-600 pl-5 list-disc text-[11px]">
                    <li><strong>ประเภทใบราคา:</strong> ${doc.docType} ${doc.replaceOld ? `(แทนของเดิม: ${doc.oldPromoName || '-'})` : ''}</li>
                    <li><strong>โปรโมชั่นเกิน 4 ชื่อ:</strong> ${doc.promoOver4 === 'YES' ? 'เกิน 4 ชื่อ' : 'ไม่เกิน'}</li>
                    <li><strong>ราคาตั้งสินค้า:</strong> ${doc.priceChange === 'YES' ? `เปลี่ยนจากเดิม (หน้า K-catalog: ${doc.kcatalogPage || '-'})` : 'ไม่เปลี่ยน'}</li>
                    <li><strong>มีสินค้าใหม่:</strong> ${doc.hasNewProd === 'YES' ? `มี (${doc.newProdDetail || '-'})` : 'ไม่มี'}</li>
                    <li><strong>Path File:</strong> ${doc.fileDelivery === 'PATH' ? (doc.filePath || 'ระบุบน Server') : `ส่ง Email (${doc.emailSentDate || '-'})`}</li>
                    <li><strong>การทำสำเนาแจก:</strong> ${doc.printCopy === 'PRINT' ? `ปริ้นส์จำนวน ${doc.printQty} แผ่น (ขาว-ดำ ${doc.printBwQty} แผ่น)` : 'ไม่ต้องปริ้นแจก'}</li>
                </ul>
            </div>

            <!-- Stakeholders -->
            <div class="space-y-2 p-4 bg-slate-50/70 rounded-2xl border border-slate-200">
                <h4 class="font-bold text-slate-800 flex items-center gap-1.5 text-xs">
                    <i data-lucide="users" class="w-4 h-4 text-blue-500"></i>
                    ผู้เกี่ยวข้องในสายการอนุมัติ
                </h4>
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-[11px]">
                    <div class="p-2.5 bg-white rounded-xl border border-slate-200">
                        <span class="text-slate-400 block text-[10px]">ผู้บริหาร (Step 2)</span>
                        <strong class="text-slate-800 block">${doc.execName || '-'}</strong>
                        <span class="text-slate-500 text-[10px]">${doc.execEmail || '-'}</span>
                    </div>
                    <div class="p-2.5 bg-white rounded-xl border border-slate-200">
                        <span class="text-slate-400 block text-[10px]">ทีม BA</span>
                        <strong class="text-slate-800 block">${doc.baName || '-'}</strong>
                        <span class="text-slate-500 text-[10px]">${doc.baEmail || '-'}</span>
                    </div>
                    <div class="p-2.5 bg-white rounded-xl border border-slate-200">
                        <span class="text-slate-400 block text-[10px]">ทีม SCM</span>
                        <strong class="text-slate-800 block">${doc.scmName || '-'}</strong>
                        <span class="text-slate-500 text-[10px]">${doc.scmEmail || '-'}</span>
                    </div>
                </div>
            </div>

            <!-- Timeline Flow -->
            <div class="space-y-3">
                <h4 class="font-bold text-slate-800 flex items-center gap-1.5 text-xs">
                    <i data-lucide="git-branch" class="w-4 h-4 text-emerald-500"></i>
                    ประวัติและไทม์ไลน์การดำเนินงาน (Workflow Timeline)
                </h4>
                <div class="space-y-3 pl-2">
                    ${(doc.timeline || []).map((tl, i) => `
                        <div class="flex items-start gap-3 relative">
                            ${i < (doc.timeline.length - 1) ? '<div class="absolute left-3.5 top-6 bottom-0 w-0.5 bg-slate-200"></div>' : ''}
                            <div class="w-7 h-7 rounded-full flex items-center justify-center shrink-0 z-10 ${
                                tl.status === 'DONE' ? 'bg-emerald-500 text-white shadow-xs' :
                                tl.status === 'REJECTED' ? 'bg-rose-500 text-white shadow-xs' : 'bg-slate-200 text-slate-500'
                            }">
                                <i data-lucide="${tl.status === 'DONE' ? 'check' : tl.status === 'REJECTED' ? 'x' : 'clock'}" class="w-3.5 h-3.5"></i>
                            </div>
                            <div class="flex-1 bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
                                <div class="flex items-center justify-between">
                                    <strong class="text-xs text-slate-800">${tl.step}</strong>
                                    <span class="text-[10px] text-slate-400">${tl.time}</span>
                                </div>
                                <p class="text-[11px] text-slate-600 mt-0.5">การกระทำ: <span class="font-semibold text-slate-800">${tl.action}</span> โดย ${tl.by}</p>
                                ${tl.comment ? `<div class="mt-1.5 p-2 bg-slate-50 rounded-lg text-[10px] text-slate-600 border border-slate-100">💬 Comment: ${escapeHtml(tl.comment)}</div>` : ''}
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;

        document.getElementById('detailModal').classList.remove('hidden');
        if (window.lucide) window.lucide.createIcons();
    };

    // ยกเลิกคำขอ
    window.cancelDocument = function(docId) {
        if (!confirm(`คุณต้องการยกเลิกคำขอเลขที่ ${docId} ใช่หรือไม่?`)) return;
        const doc = allDocuments.find(d => d.docId === docId);
        if (doc) {
            doc.status = 'CANCELLED';
            doc.timeline.push({
                step: 'ยกเลิกคำขอ',
                action: 'ผู้จัดทำขอยกเลิกคำขอ',
                by: sessionStorage.getItem('name') || 'การตลาด',
                time: new Date().toLocaleString('th-TH'),
                status: 'REJECTED',
                comment: 'ผู้จัดทำยกเลิกเอกสารนี้'
            });
            saveLocalDocuments(allDocuments);
            renderTable();
            alert(`ยกเลิกเอกสาร ${docId} เรียบร้อยแล้ว`);
        }
    };

    window.printDocument = function(docId) {
        window.print();
    };

})();
