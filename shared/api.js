// ===================================================================
// shared/api.js — Wrapper กลางสำหรับเรียก n8n Webhook ในระบบ KTW HUB
// ===================================================================
// - ดึงการตั้งค่าจาก window.KTW_CONFIG (shared/config.js)
// - แนบ Header Authentication (X-KTW-API-Key) อัตโนมัติทุก request
// - รองรับ Netlify Proxy (/api/) เพื่อแก้ปัญหา CORS เมื่อรันบน Netlify
// - ต่อท้าย '-dev' อัตโนมัติเมื่ออยู่ในโหมด DEV เพื่อลง Database ชุดทดสอบ
// ===================================================================

(function() {
    // โหลด config เริ่มต้น (ถ้ายังไม่มี KTW_CONFIG ให้ใช้ fallback DEV)
    const cfg = window.KTW_CONFIG || {
        ENV: 'DEV',
        IS_DEV: true,
        BASE_WEBHOOK_URL: 'https://n8n.ktw.co.th/webhook/',
        WEBHOOK_SUFFIX: '-dev',
        API_KEY_HEADER: 'X-KTW-API-Key',
        API_KEY_VALUE: 'e6766791596b0cf09d3885bd16cb9e6001bd0e1034dd111191a6302d13597e95',
        IS_NETLIFY: false
    };

    // รายชื่อ Webhook ทั้งหมดในระบบ DEV
    const DEV_PATHS = new Set([
        "AddUser-KTW-switching-system", "CheckRoll-User-KTW-switching-system", "Check_login", 
        "DeleteUser-KTW-switching-system", "Edit_swap_product", "Forgot-Password-KTW-switching-system", 
        "GetDocumentDetail-KTW-switching-system", "Register-User-KTW-switching-system", 
        "UpdateRoll-User-KTW-switching-system", "UpdateUser-KTW-switching-system", 
        "admin_revert_stage_claim_cus", "admin_revert_stage_disassembly", "admin_revert_stage_ncr", 
        "admin_revert_stage_swap", "approve_claim_cus", "approve_ncr_log", "approve_ncr_marketing", 
        "approve_ncr_mid", "approve_ncr_scm", "approve_ncr_scm1", "approve_ncr_scm2", 
        "approve_ncr_scm_head", "approve_ncr_spm", "approve_swap_product", "cancel_document_disassembly", 
        "cancel_document_ncr", "cancel_document_swap", "check_ref_document_disassembly", 
        "clear_old_audit_log_swap", "clear_old_logs_disassembly", "clear_old_logs_ncr", 
        "close_claim_cus", "create_disassembly_document", "create_document_claim_cus", 
        "create_ncr_document", "create_swap_product", "delete_brand_rule_claim_cus", 
        "delete_doc_disassembly", "delete_doc_ncr", "delete_doc_swap_product", 
        "delete_restore_claim_cus", "edit-delete-ncr-attachment", "edit_disassembly_document", 
        "edit_document_claim_cus", "edit_ncr_document", "final_approve_disassembly", 
        "get-audit-log", "get_all_claim_logs", "get_all_disassembly_document_status", 
        "get_all_disassembly_logs", "get_all_document_status_claim_cus", 
        "get_all_employee_roles_claim_cus", "get_all_employee_roles_disassembly", 
        "get_all_employee_roles_ncr", "get_all_ncr_document_status", "get_all_ncr_logs", 
        "get_all_swap_document_status", "get_dashboard_count_claim_cus", "get_disassembly_role", 
        "get_disassembly_role_members", "get_docflow_claim_cus", "get_docflow_disassembly", 
        "get_docflow_ncr", "get_docflow_swap_product", "get_document_detail_claim_cus", 
        "get_document_detail_disassembly", "get_document_detail_ncr", 
        "get_monthly_report_summary_claim_cus", "get_ncr_role", "get_ncr_role_members", 
        "get_pending_queue_claim_cus", "get_pending_queue_disassembly", "get_pending_queue_ncr", 
        "get_pending_queue_swap", "get_pending_summary_disassembly", "get_pending_summary_ncr", 
        "get_pending_summary_switching_system", "get_role_claim_cus", "get_role_members_claim_cus", 
        "get_swap_role_members", "history-doc-create-day-switching-system", 
        "history_doc_create_day_claim_cus", "history_doc_create_day_disassembly", 
        "history_doc_create_day_ncr", "marketing_approve_disassembly", 
        "parts_warehouse_confirm_disassembly", "reject_disassembly", "reject_ncr", 
        "reject_swap_product", "restore_doc_disassembly", "restore_doc_ncr", 
        "restore_doc_swap_product", "save_brand_care_roles_claim_cus", "save_brand_rule_claim_cus", 
        "scm_confirm_disassembly", "send_monthly_report_claim_cus", "technician_confirm_disassembly", 
        "update_employee_role_claim_cus", "update_employee_role_disassembly", 
        "update_employee_role_ncr", "warehouse_confirm_disassembly", "borrow_create", 
        "borrow_list", "borrow_detail", "borrow_queue", "borrow_approve", "borrow_reject", 
        "borrow_return", "borrow_extend", "borrow_cancel", "borrow_edit", "borrow_dashboard", 
        "borrow_logs", "borrow_logs_clear", "borrow_my_perms", "borrow_roles_list", 
        "borrow_role_update", "borrow_cts_users", "GetPassword-User-KTW-switching-system", 
        "clear_old_logs_claim_cus", "perm_catalog", "perm_history", "perm_my", "perm_save", 
        "perm_users", "pcs_my_perms", "pcs_categories", "pcs_period_list", "pcs_period_detail", 
        "pcs_period_save", "pcs_period_close", "pcs_expense_save", "pcs_advance_save"
    ]);

    // endpoint ที่อ่านอย่างเดียว
    const READONLY_RE = /^(get[_-]|autocomplete$|history_doc_create_day_)/;

    /**
     * แปลง URL ให้ถูกต้องตาม Environment (DEV/PRD) และแพลตฟอร์ม (Netlify Proxy หรือ Direct)
     */
    function resolveWebhookUrl(rawUrl) {
        let path = rawUrl;
        let queryAndHash = '';

        // ตัด base URL เดิมออกถ้ามี (เช่น https://n8n.ktw.co.th/webhook/)
        const origBase = 'https://n8n.ktw.co.th/webhook/';
        if (path.startsWith(origBase)) {
            path = path.slice(origBase.length);
        } else if (path.startsWith('/api/')) {
            path = path.slice('/api/'.length);
        }

        // แยก Query String
        const cut = path.search(/[?#]/);
        if (cut !== -1) {
            queryAndHash = path.slice(cut);
            path = path.slice(0, cut);
        }

        // ในโหมด DEV: ต่อท้าย -dev ถ้าอยู่ใน whitelist
        if (cfg.IS_DEV) {
            if (DEV_PATHS.has(path) && !path.endsWith(cfg.WEBHOOK_SUFFIX)) {
                path = path + cfg.WEBHOOK_SUFFIX;
            } else if (!DEV_PATHS.has(path) && !READONLY_RE.test(path)) {
                console.warn('[DEV] บล็อก webhook ที่ไม่อยู่ใน whitelist:', path);
                return { blocked: true, path: path };
            }
        }

        // รวม URL ปลายทาง: ถ้าอยู่บน Netlify จะส่งผ่าน /api/ เพื่อแก้ปัญหา CORS
        const targetBase = cfg.BASE_WEBHOOK_URL;
        return { url: targetBase + path + queryAndHash };
    }

    /**
     * ฟังก์ชันยิง n8n Webhook ส่วนกลาง
     * @param {string} url - Webhook Path หรือ URL เต็ม
     * @param {object} options - Fetch options (method, headers, body)
     */
    function n8nFetch(url, options = {}) {
        const resolved = resolveWebhookUrl(String(url));
        if (resolved.blocked) {
            return Promise.resolve(new Response(
                JSON.stringify({ 
                    success: false, 
                    status: 'error', 
                    message: `[DEV] Endpoint "${resolved.path}" ยังไม่ได้ลงทะเบียนในระบบทดสอบ` 
                }),
                { status: 403, headers: { 'Content-Type': 'application/json' } }
            ));
        }

        const mergedHeaders = {
            ...(options.headers || {}),
            [cfg.API_KEY_HEADER]: cfg.API_KEY_VALUE
        };

        return fetch(resolved.url, { ...options, headers: mergedHeaders });
    }

    // Export เข้า Window ให้ทุกหน้าเรียกใช้ได้ทันที
    window.n8nFetch = n8nFetch;
    window.resolveWebhookUrl = resolveWebhookUrl;
})();
