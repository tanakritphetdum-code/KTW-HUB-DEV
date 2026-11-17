// ===================================================================
// modules/swapService.js — Logic & API Service สำหรับระบบสลับสินค้า (SWAP Product)
// ===================================================================

      if (typeof handleLogout !== "function") {
        window.handleLogout = function () {
          sessionStorage.clear();
          window.location.reload();
        };
      }

      const currentUserName = sessionStorage.getItem("name") || "";
      const currentUserEmpType = sessionStorage.getItem("emp_type"); // '0' = พนักงานทั่วไป (Staff), '1' = Admin, อื่นๆ = Approver/SCM ฯลฯ
      const isAdminUser = currentUserEmpType === "1";

      // ===== สิทธิ์รายข้อจากระบบ Permission (fail-safe: ยังไม่พร้อม → ใช้กติกา Role เดิม) =====
      // ⚠️ ซ่อน/แสดงปุ่มเพื่อ UX เท่านั้น ตัวบังคับจริงอยู่ที่ n8n (Check Permission) ทุก endpoint
      const PSYS = "SWAP";
      function pReady() { return !!(window.KTWPerm && window.KTWPerm.isReady()); }
      function pcan(act, legacy) { return pReady() ? window.KTWPerm.can(PSYS, act) : !!legacy; }
      function pAnyOwn(any, own, isOwner, legacy) {
        return pReady() ? (window.KTWPerm.can(PSYS, any) || (window.KTWPerm.can(PSYS, own) && !!isOwner)) : !!legacy;
      }
      window.addEventListener("ktwperm", function (e) {
        if (typeof __permApply === "function") __permApply(!!(e.detail && e.detail.changed));
      });
      // 🆕 06/10/2569 : Role ที่ถอยสถานะเอกสารได้ = Admin ('1') และ SCM ('3')
      // ⚠️ ต้องตรงกับ emp_type IN ('1','3') ใน SQL - Admin Revert Stage SWAP เสมอ
      //    (SCM ของ SWAP คือ role 3 — ไม่ใช่ 4 เหมือน NCR)
      const _canRevertLegacy =
        currentUserEmpType === "1" || currentUserEmpType === "3";
      let canRevertStage = pcan("RETURN_STATUS", _canRevertLegacy);
      let editMode = false;
      let editingDocId = null;

      // ================= สิทธิ์การแก้ไขเอกสาร (Role-based Permission) =================
      // กติกา: Staff (emp_type = '0') แก้ไขได้เฉพาะเอกสารที่ตัวเองเป็นผู้สร้าง (preparedByEmail ตรงกับผู้ login)
      //         Admin / Approver / SCM (emp_type อื่นๆ ที่ไม่ใช่ '0') แก้ไขได้ทุกเอกสาร
      // ⚠️ นี่คือการซ่อน/ปิดปุ่มฝั่ง Frontend เพื่อ UX เท่านั้น ฝั่ง n8n/SQL (Edit_swap_product,
      //    GetDocumentDetail-KTW-switching-system) ต้องตรวจสิทธิ์ซ้ำอีกชั้นเสมอ ไม่ควรเชื่อฝั่ง client อย่างเดียว
      //
      // หมายเหตุสำคัญ: ลำดับการเช็คสิทธิ์ (จากแม่นยำสุดไปน้อยสุด)
      // 1) createdByEmpId (รหัสพนักงานของคนที่ login แล้ว submit จริง) — แม่นยำสุด ไม่มีปัญหาเรื่องอักขระแฝง/ตัวพิมพ์เล็ก-ใหญ่
      //    เพราะ emp_id เป็นรหัสตัวเลขล้วน เทียบตรงๆ ได้เลย
      // 2) createdByEmail (อีเมลของคนที่ submit จริง) — ใช้กับเอกสารที่สร้างก่อนมีการเก็บ emp_id
      // 3) preparedByEmail (อีเมลที่กรอกในฟอร์ม) — fallback สุดท้ายสำหรับเอกสารเก่ามากๆ ก่อนมี createdByEmail เลย
      // ฟังก์ชันทำความสะอาดอีเมลก่อนเปรียบเทียบ: ตัดอักขระที่มองไม่เห็นทุกชนิดออก
      // (ไม่ใช่แค่ .trim() เพราะบางครั้งข้อมูลจาก SQL/ฟอร์มมีอักขระแฝงกลาง-ท้ายสตริง
      //  เช่น non-breaking space, zero-width space ที่ trim() มาตรฐานตัดไม่หมด)
      function normalizeEmail(email) {
        if (!email) return "";
        return String(email)
          .replace(/[\s\u00A0\u200B\u200C\u200D\uFEFF]/g, "") // ตัดช่องว่างทุกชนิด + อักขระที่มองไม่เห็น
          .toLowerCase();
      }

      // ================= วัตถุประสงค์ (Movement Type) =================
      // ⚠️ รหัส 921 เปลี่ยนความหมายแล้ว (เดิม "เบิกอะไหล่ใส่ตัวเครื่อง" → ใหม่ "สลับสินค้ารุ่นเข้า")
      //    เอกสารเก่าจึงต้องอ่านชื่อจาก movement_type_des ที่บันทึกไว้ในตัวเอกสารเอง
      //    ห้ามแปลรหัสเป็นชื่อจาก map อย่างเดียว ไม่งั้นเอกสารเดือน ส.ค. จะขึ้นชื่อใหม่
      //    ทั้งที่เนื้อหาเป็นเรื่องเบิกอะไหล่
      // 21/09/2026: เหลือ 2 ตัวเลือก — 309 และ "921-922" (บันทึกลง movement_type ตามนี้ตรง ๆ)
      //   921 / 922 แยกกันไม่มีให้เลือกแล้ว เก็บไว้ใน map เพื่อแสดงผลเอกสารเก่าเท่านั้น
      const MOVEMENT_TYPES = [
        { code: "309", label: "309 : สลับสินค้ารุ่น" },
        { code: "921-922", label: "921-922 : สลับสินค้ารุ่นเข้า/ออก" },
      ];
      const MOVEMENT_LABEL_MAP = {
        ...Object.fromEntries(MOVEMENT_TYPES.map((m) => [m.code, m.label])),
        921: "921-922 : สลับสินค้ารุ่นเข้า/ออก",
        922: "921-922 : สลับสินค้ารุ่นเข้า/ออก",
      };

      // des = movement_type_des ของเอกสารนั้น (ถ้ามี) — ใช้ค่านี้ก่อนเสมอ
      function purposeLabel(p, des) {
        const saved = String(des ?? "").trim();
        if (saved) return saved;
        return MOVEMENT_LABEL_MAP[String(p)] || `Mov. ${p}`;
      }

      // ================= สิทธิ์แก้ไขเอกสาร แยกตามสถานะเอกสาร (3.1 / 3.2 / 3.3) =================
      // 3.1 สถานะ "รอ ผู้บริหาร อนุมัติ": Staff(0) แก้ไขได้เฉพาะเอกสารของตัวเอง / Roll อื่น (Admin,Approver,SCM) แก้ไขได้ทั้งหมด
      // 3.2 สถานะ "รอ SCM อนุมัติ": Staff(0) แก้ไขไม่ได้เลย / มีแค่ Admin(1) และ SCM(3) เท่านั้นที่แก้ไขได้ (Approver(2) แก้ไม่ได้)
      // 3.3 สถานะ "อนุมัติแล้ว": ทุก Roll ไม่มีสิทธิ์แก้ไข
      // เจ้าของเอกสาร: เทียบ emp_id ก่อน ถ้าเอกสารเก่าไม่มี emp_id ค่อยเทียบอีเมล
      function _swapIsOwner(item) {
        if (item.createdByEmpId && currentEmpId) {
          return String(item.createdByEmpId).trim() === String(currentEmpId).trim();
        }
        const itemEmail = normalizeEmail(item.createdByEmail || item.preparedByEmail);
        const myEmail = normalizeEmail(currentUserEmail);
        return !!itemEmail && !!myEmail && itemEmail === myEmail;
      }

      // แก้ไขได้เฉพาะ stage แรก ("รอ ผู้บริหาร อนุมัติ") | สิทธิ์: UPDATE_ANY หรือ UPDATE_OWN (เจ้าของ)
      function canEditDocument(item) {
        if (getHistoryDisplayStatus(item).label !== "รอ ผู้บริหาร อนุมัติ") return false;
        const own = _swapIsOwner(item);
        return pAnyOwn("UPDATE_ANY", "UPDATE_OWN", own, currentUserEmpType === "1" || own);
      }

      // ลบได้เฉพาะ stage แรก | สิทธิ์: DELETE_ANY หรือ DELETE_OWN (เจ้าของ)
      function canDeleteDocument(item) {
        if (getHistoryDisplayStatus(item).label !== "รอ ผู้บริหาร อนุมัติ") return false;
        return pAnyOwn("DELETE_ANY", "DELETE_OWN", _swapIsOwner(item), currentUserEmpType === "1");
      }

      // ยกเลิกได้เฉพาะ stage แรก | สิทธิ์: CANCEL_ANY หรือ CANCEL_OWN (เจ้าของ)
      // ⚠️ ฝั่ง SQL - Cancel Document SWAP ตรวจซ้ำอีกชั้นเสมอ
      function canCancelDocument(item) {
        if (getHistoryDisplayStatus(item).label !== "รอ ผู้บริหาร อนุมัติ") return false;
        const own = _swapIsOwner(item);
        return pAnyOwn("CANCEL_ANY", "CANCEL_OWN", own, currentUserEmpType === "1" || own);
      }

      // ⚠️ Auto-open: ถ้า URL มี ?doc=... (เช่น ลิงก์จากอีเมลแจ้งเตือน) ให้เปิดเอกสารนั้นให้อัตโนมัติ
      // ต้องรอ syncHistoryStatuses() โหลดเสร็จก่อน เพราะ editDocument() เช็คสิทธิ์แก้ไขจาก localStorage cache
      function openFromUrlIfNeeded() {
        const params = new URLSearchParams(window.location.search);
        const docId = params.get("doc");
        if (!docId) return;
        const mode = params.get("mode");

        // ล้าง query string ออกจาก URL หลังใช้งานแล้ว กันเปิดซ้ำถ้าผู้ใช้กด refresh หน้าเอง
        window.history.replaceState(
          {},
          document.title,
          window.location.pathname,
        );

        if (mode === "view") {
          // เอกสารเสร็จสิ้นแล้ว (เช่น จากอีเมล "อนุมัติเสร็จสมบูรณ์") → เปิดดูอย่างเดียว ไม่เปิดโหมดแก้ไข
          previewDocument(docId);
        } else {
          // ค่าเริ่มต้น → เปิดโหมดแก้ไข
          editDocument(docId);
        }
      }

      // ================= Dropdown ผู้บริหาร / SCM (ดึงจาก DB แทน Hardcode) =================
      let swapRoleMembers = { approver: [], scm: [] };

      async function loadSwapRoleMembers() {
        try {
          const res = await n8nFetch(
            "https://n8n.ktw.co.th/webhook/get_swap_role_members",
          );
          if (!res.ok) throw new Error("HTTP " + res.status);
          // อ่านเป็น text ก่อนแล้วค่อย parse เอง — ถ้า n8n คืน body ว่าง res.json() จะ throw
          // ทำให้ขึ้น "โหลดรายชื่อไม่สำเร็จ" ทั้งที่ความจริงคือ "ยังไม่มีใครถูกตั้ง role"
          const rawText = await res.text();
          const data = rawText && rawText.trim() ? JSON.parse(rawText) : {};
          swapRoleMembers = {
            approver: data.approver || [],
            scm: data.scm || [],
          };
          populateRoleDropdown("approvedBy", swapRoleMembers.approver);
          populateRoleDropdown("scmControl", swapRoleMembers.scm);
        } catch (err) {
          console.error("โหลดรายชื่อผู้เกี่ยวข้องไม่สำเร็จ:", err);
          showNotification(
            "โหลดรายชื่อไม่สำเร็จ",
            "ไม่สามารถดึงรายชื่อผู้บริหาร/SCM ได้ กรุณารีเฟรชหน้าใหม่",
            "warning",
          );
        }
      }

      function populateRoleDropdown(selectId, members) {
        const sel = document.getElementById(selectId);
        if (!sel) return;
        const current = sel.value;
        sel.innerHTML =
          '<option value="">-- เลือกชื่อ --</option>' +
          members
            .map(
              (m) =>
                `<option value="${m.name}" data-emp-id="${m.empId}" data-email="${m.email}">${m.name}</option>`,
            )
            .join("");
        if (current) sel.value = current;
      }

      // เลือกชื่อแล้วเติมอีเมล + EmpId ให้อัตโนมัติ (Pattern เดียวกับ NCR/Disassembly)
      function autoFillContactEmail(selectEl, emailInputId, empIdInputId, roleKey) {
        const opt = selectEl.options[selectEl.selectedIndex];
        const email = opt ? opt.getAttribute("data-email") || "" : "";
        const empId = opt ? opt.getAttribute("data-emp-id") || "" : "";
        const emailEl = document.getElementById(emailInputId);
        const empIdEl = document.getElementById(empIdInputId);
        if (emailEl) emailEl.value = email;
        if (empIdEl) empIdEl.value = empId;
      }

      // ================= เอกสารแนบ + Fast-track =================
      // เก็บ Base64 ของไฟล์ที่เพิ่งเลือกไว้ในตัวแปร (ส่งไปกับ payload ตอนกดบันทึก)
      let attachmentData = { base64: "", fileName: "", fileType: "" };
      // true = โหมดแก้ไขและยังใช้ไฟล์เดิมที่เคยอัปโหลดไว้ (ไม่ได้เลือกไฟล์ใหม่)
      let keepExistingAttachment = false;
      // ไฟล์แนบเดิมที่ดึงมาจาก SQL (ใช้สำหรับปุ่มเปิดดู/ดาวน์โหลดในโหมด Display/Edit)
      let existingAttachment = { base64: "", fileName: "", fileType: "" };

      // สร้าง Blob URL จากไฟล์เดิม — ใช้ Blob แทน data URL ตรงๆ เพราะ Chrome บล็อกการเปิด data URL ขนาดใหญ่
      function buildExistingAttachmentUrl() {
        if (!existingAttachment.base64) return null;
        try {
          const bin = atob(existingAttachment.base64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          return URL.createObjectURL(
            new Blob([bytes], {
              type: existingAttachment.fileType || "application/octet-stream",
            }),
          );
        } catch (e) {
          return null;
        }
      }

      function openExistingAttachment() {
        const url = buildExistingAttachmentUrl();
        if (!url) {
          showNotification("เปิดไฟล์ไม่สำเร็จ", "ไม่พบข้อมูลไฟล์แนบ", "error");
          return;
        }
        window.open(url, "_blank");
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      }

      function downloadExistingAttachment() {
        const url = buildExistingAttachmentUrl();
        if (!url) {
          showNotification("ดาวน์โหลดไม่สำเร็จ", "ไม่พบข้อมูลไฟล์แนบ", "error");
          return;
        }
        const a = document.createElement("a");
        a.href = url;
        a.download = existingAttachment.fileName || "attachment";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      }

      function onAttachmentToggle(hasAttachment) {
        const box = document.getElementById("attachmentBox");
        const chk = document.getElementById("skipApprover");
        const label = document.getElementById("skipApproverLabel");
        const hint = document.getElementById("skipApproverHint");

        box.classList.toggle("hidden", !hasAttachment);

        // 🔒 Fast-track เลือกได้เฉพาะเมื่อมีเอกสารแนบเท่านั้น (กฎเดียวกับ Backend Validation)
        //    ปิดปุ่มไว้เลยดีกว่าปล่อยให้ติ๊กแล้วมาเจอ Error ตอนกดบันทึก
        chk.disabled = !hasAttachment;
        label.classList.toggle("cursor-not-allowed", !hasAttachment);
        label.classList.toggle("opacity-50", !hasAttachment);
        label.classList.toggle("cursor-pointer", hasAttachment);
        hint.textContent = hasAttachment
          ? "เอกสารจะข้ามขั้นผู้บริหาร ส่งตรงไปรอ SCM อนุมัติทันที"
          : "ต้องแนบเอกสารประกอบก่อนจึงจะเลือกได้";

        if (!hasAttachment) {
          chk.checked = false;
          attachmentData = { base64: "", fileName: "", fileType: "" };
          existingAttachment = { base64: "", fileName: "", fileType: "" };
          keepExistingAttachment = false;
          const fileEl = document.getElementById("attachmentFile");
          if (fileEl) fileEl.value = "";
          document
            .getElementById("attachmentCurrentInfo")
            .classList.add("hidden");
          document
            .getElementById("attachmentExistingActions")
            .classList.add("hidden");
        }
        lucide.createIcons();
      }

      function onAttachmentFileChange(input) {
        const file = input.files && input.files[0];
        if (!file) return;

        const MAX_SIZE = 5 * 1024 * 1024; // 5 MB
        if (file.size > MAX_SIZE) {
          showNotification(
            "ไฟล์ใหญ่เกินไป",
            "ขนาดไฟล์ต้องไม่เกิน 5 MB กรุณาเลือกไฟล์ใหม่",
            "error",
          );
          input.value = "";
          return;
        }

        const reader = new FileReader();
        reader.onload = () => {
          // ตัด prefix "data:...;base64," ออก เก็บเฉพาะส่วน Base64 จริง
          const raw = String(reader.result);
          attachmentData = {
            base64: raw.includes(",") ? raw.split(",")[1] : raw,
            fileName: file.name,
            fileType: file.type || "",
          };
          keepExistingAttachment = false;
          existingAttachment = { base64: "", fileName: "", fileType: "" };
          const info = document.getElementById("attachmentCurrentInfo");
          document.getElementById("attachmentCurrentName").textContent =
            `แนบไฟล์: ${file.name}`;
          info.classList.remove("hidden");
          // เลือกไฟล์ใหม่แล้ว ปุ่มดูไฟล์เดิมไม่เกี่ยวข้องอีกต่อไป
          document
            .getElementById("attachmentExistingActions")
            .classList.add("hidden");
          lucide.createIcons();
        };
        reader.onerror = () => {
          showNotification("อ่านไฟล์ไม่สำเร็จ", "กรุณาลองเลือกไฟล์ใหม่", "error");
          input.value = "";
        };
        reader.readAsDataURL(file);
      }

      // ตั้งค่าส่วนเอกสารแนบ/Fast-track กลับเป็นค่าเริ่มต้น (ใช้ตอนเปิดฟอร์มสร้างใหม่)
      function resetAttachmentSection() {
        const radioNo = document.querySelector(
          'input[name="hasAttachmentRadio"][value="0"]',
        );
        if (radioNo) radioNo.checked = true;
        onAttachmentToggle(false);
      }

      window.onload = async function () {
        renderSidebar();

        const mobileSidebarContainer = document.getElementById(
          "mobile-sidebar-content",
        );
        if (mobileSidebarContainer) {
          mobileSidebarContainer.innerHTML =
            document.getElementById("sidebar-container").innerHTML;
        }
        lucide.createIcons();

        const today = new Date().toISOString().substring(0, 10);
        document.getElementById("docDate").value = today;

        document.getElementById("preparedBy").value = currentUserName;
        document.getElementById("preparedByEmail").value =
          sessionStorage.getItem("email") || currentUserEmail;

        initDocumentId();
        initHistory();
        addSampleRows();
        await loadSwapRoleMembers();
        await syncHistoryStatuses();
        openFromUrlIfNeeded();
      };

      // ฟังก์ชันแสดงสถานะ Document ID สำหรับเอกสารใหม่
      // หมายเหตุ: เลขที่เอกสารจริงจะถูก "สร้างที่ SQL Server" (ผ่าน SEQUENCE) ตอนกดบันทึกสำเร็จเท่านั้น
      // เพื่อป้องกันเลขซ้ำข้าม user/เครื่อง จึงไม่มีการเดาเลขล่วงหน้าจาก localStorage อีกต่อไป
      function initDocumentId() {
        const docIdInput = document.getElementById("docId");
        if (!docIdInput) return;

        docIdInput.value = "";
        docIdInput.placeholder = "ระบบจะออกเลขที่ให้อัตโนมัติหลังบันทึก";
      }

      // ฟังก์ชันเริ่มต้นประวัติเอกสารแบบ Dynamic
      function initHistory() {
        let history = localStorage.getItem("ktw_swap_history");
        if (!history) {
          const defaultHistory = [
            {
              documentId: "1000000000",
              date: "2026-06-23",
              purpose: "921",
              preparedBy: "tanakrit",
              preparedByEmail: "tanakrit@ktw.co.th",
              scmControl: "สมชาย ใจมั่น",
              scmControlEmail: "somchai@ktw.co.th",
              approvedBy: "มนัส พลดี",
              approvedByEmail: "manas@ktw.co.th",
              remark: "กรณีเบิกด่วน",
              status: "เสร็จสิ้น",
              products: [
                {
                  no: 1,
                  prodCode: "2.010.015",
                  description: "เครื่องเจียร 4 นิ้ว KTW",
                  qtyIn: 5,
                  unitIn: "เครื่อง",
                  qtyOut: 5,
                  unitOut: "เครื่อง",
                },
              ],
            },
          ];
          localStorage.setItem(
            "ktw_swap_history",
            JSON.stringify(defaultHistory),
          );
        }
        renderHistoryTable();

        // ดึงสถานะล่าสุดจริงจาก SQL Server มาทับค่าที่แคชไว้ใน localStorage
        // เพราะสถานะที่แคชไว้เป็นค่า ณ ตอนสร้าง/แก้ไขล่าสุดบนเบราว์เซอร์นี้เท่านั้น
        syncHistoryStatuses();
      }

      // ซิงค์สถานะ (status, approvedBy, scmControl) ของทุกเอกสารในตารางประวัติ
      // จาก SQL Server ผ่าน Webhook เดียวกับที่ปุ่ม Display ใช้ (GetDocumentDetail-KTW-switching-system)
      // จำเป็นเพราะเอกสารอาจถูกอนุมัติจากช่องทางอื่น (เช่น ลิงก์อนุมัติในอีเมล) ซึ่งไม่ได้อัปเดตกลับมาที่ localStorage ของเบราว์เซอร์นี้โดยอัตโนมัติ
      // ซิงค์ "รายการเอกสารทั้งหมด" จาก SQL Server ผ่าน N8n มาเป็นตัวหลัก (Source of Truth)
      // เดิมฟังก์ชันนี้แค่อัปเดตสถานะของเอกสารที่มีอยู่ใน localStorage อยู่แล้วเท่านั้น
      // ทำให้แต่ละเบราว์เซอร์/โดเมนเห็นรายการไม่ตรงกัน (เพราะ localStorage แยกกันคนละที่)
      // ตอนนี้ปรับให้ดึง "รายการทั้งหมด" จาก SQL มาสร้างใหม่ทุกครั้ง แล้วเก็บข้อมูลเสริม
      // (remark, products) จาก local cache เดิมไว้ ถ้ามีอยู่แล้ว เพื่อไม่ให้ข้อมูลหาย
      async function syncHistoryStatuses() {
        const syncBtn = document.getElementById("syncHistoryBtn");
        const syncIcon = document.getElementById("syncHistoryIcon");
        if (syncBtn) syncBtn.disabled = true;
        if (syncIcon) syncIcon.classList.add("animate-spin");

        // โหลด local cache เดิมไว้ก่อน เผื่อ webhook ล้มเหลวจะได้ไม่ทำข้อมูลหาย
        let history = JSON.parse(
          localStorage.getItem("ktw_swap_history") || "[]",
        );
        const localMap = {};
        history.forEach((item) => {
          localMap[item.documentId] = item;
        });

        const webhookUrl =
          "https://n8n.ktw.co.th/webhook/get_all_swap_document_status";

        let serverList = null;
        try {
          const res = await n8nFetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ empId: currentEmpId }),
          });

          if (!res.ok) {
            console.error(
              `[syncHistoryStatuses] webhook ตอบกลับ error status: ${res.status}`,
            );
          } else {
            const text = await res.text();
            if (!text) {
              console.warn(
                "[syncHistoryStatuses] N8n workflow ตอบกลับสำเร็จ (200) แต่ body ว่างเปล่า — เช็คที่ N8n Executions ว่า node ไหนพัง",
              );
            } else {
              let raw;
              try {
                raw = JSON.parse(text);
              } catch (parseErr) {
                console.warn(
                  "[syncHistoryStatuses] N8n ตอบกลับมาไม่ใช่ JSON:",
                  text,
                );
                raw = null;
              }

              if (raw) {
                serverList = Array.isArray(raw)
                  ? raw
                  : Array.isArray(raw.data)
                    ? raw.data
                    : [raw];
                // 🔍 DEBUG: เปิด Console (F12) ดูข้อมูลดิบทั้งหมดที่ได้จาก webhook ตรงนี้
                console.log(
                  "[syncHistoryStatuses] ข้อมูลดิบทั้งหมดจาก webhook:",
                  serverList,
                );
              }
            }
          }
        } catch (err) {
          console.error(
            "[syncHistoryStatuses] เรียก webhook ไม่สำเร็จ (network/CORS error):",
            err,
          );
        }

        if (serverList) {
          // สร้างรายการใหม่ทั้งหมดโดยยึด SQL เป็นความจริงหลัก
          // เอกสารไหนเคยมีข้อมูลเสริม (remark, products) ใน local cache อยู่แล้วจะเก็บไว้ไม่ทิ้ง
          history = serverList
            .map((d) => {
              const docId = d.documentId ?? d.doc_id ?? d.doc_no;
              const existing = localMap[docId] || {};
              return {
                documentId: docId,
                date: d.date ?? d.crdate ?? existing.date ?? "",
                purpose: d.purpose ?? d.movement_type ?? existing.purpose ?? "",
                purposeDes:
                  d.purposeDes ??
                  d.movement_type_des ??
                  existing.purposeDes ??
                  "",
                preparedBy:
                  d.preparedBy ?? d.emp_name ?? existing.preparedBy ?? "",
                preparedByEmail:
                  d.preparedByEmail ??
                  d.emp_email ??
                  existing.preparedByEmail ??
                  "",
                createdByEmail:
                  d.createdByEmail ??
                  d.created_by_email ??
                  existing.createdByEmail ??
                  "",
                createdByEmpId:
                  d.createdByEmpId ??
                  d.created_by_emp_id ??
                  existing.createdByEmpId ??
                  "",
                status:
                  d.status ?? d.status_doc ?? existing.status ?? "รอการอนุมัติ",
                approvedBy:
                  d.approvedBy ?? d.emp_approve ?? existing.approvedBy ?? "",
                approvedByEmail:
                  d.approvedByEmail ?? existing.approvedByEmail ?? "",
                approvedByEmpId:
                  d.manager_emp_id ?? existing.approvedByEmpId ?? "",
                scmControl:
                  d.scmControl ?? d.scm_approve ?? existing.scmControl ?? "",
                scmControlEmail:
                  d.scmControlEmail ?? existing.scmControlEmail ?? "",
                scmControlEmpId:
                  d.scm_emp_id ?? existing.scmControlEmpId ?? "",
                // ผู้ที่ถูกเลือกให้อนุมัติ (มีค่าตั้งแต่สร้างเอกสาร ต่างจากช่องผู้เซ็นจริงด้านบน)
                // ใช้ตัดสินว่าใครมีสิทธิ์เห็นเอกสารใบนี้ในหน้าประวัติ
                approverNotifyEmpId:
                  d.manager_notify_emp_id ??
                  existing.approverNotifyEmpId ??
                  "",
                scmNotifyEmpId:
                  d.scm_notify_emp_id ?? existing.scmNotifyEmpId ?? "",
                // Fast-track — ใช้ตัดสินสถานะในคอลัมน์ "สถานะ" ของตารางประวัติ
                skipApprover:
                  d.skipApprover ??
                  (d.skip_approver === undefined
                    ? existing.skipApprover
                    : Number(d.skip_approver) === 1) ??
                  false,
                remark: d.remark ?? existing.remark ?? "",
                products: existing.products ?? [],
              };
            })
            .filter((item) => item.documentId); // กันแถวที่ไม่มีเลขที่เอกสารหลุดเข้ามา

          localStorage.setItem("ktw_swap_history", JSON.stringify(history));
        }
        // ถ้า serverList เป็น null (webhook ล้มเหลวทั้งหมด) จะใช้ local cache เดิมที่มีอยู่ต่อไป ไม่ลบทิ้ง

        if (syncBtn) syncBtn.disabled = false;
        if (syncIcon) syncIcon.classList.remove("animate-spin");

        renderHistoryTable();
      }

      // ================= SORT & FILTER: ตารางประวัติเอกสาร =================

      // เก็บสถานะการเรียงลำดับปัจจุบัน (คอลัมน์ + ทิศทาง)
      let historySortState = { column: null, direction: "asc" };

      // เปิด/ปิด Dropdown filter ของคอลัมน์ที่กด โดยคำนวณตำแหน่งจากปุ่มจริง (position: fixed)
      // เพื่อไม่ให้ถูกตัดขอบโดย overflow-hidden/overflow-x-auto ของการ์ดตาราง
      function toggleHistoryFilterDropdown(event, column) {
        event.stopPropagation();
        const btn = event.currentTarget;
        const dropdown = document.getElementById(`filter-dropdown-${column}`);
        if (!dropdown) return;
        const wasHidden = dropdown.classList.contains("hidden");

        closeAllHistoryFilterDropdowns();

        if (wasHidden) {
          const rect = btn.getBoundingClientRect();
          dropdown.classList.remove("hidden");

          const dropdownWidth = dropdown.offsetWidth;
          let left = rect.right - dropdownWidth; // จัดชิดขอบขวาของปุ่มที่กด
          if (left < 8) left = 8;
          const maxLeft = window.innerWidth - dropdownWidth - 8;
          if (left > maxLeft) left = maxLeft;

          dropdown.style.top = rect.bottom + 6 + "px";
          dropdown.style.left = left + "px";
        }
      }

      // ปิด Dropdown filter ทั้งหมด
      function closeAllHistoryFilterDropdowns() {
        document
          .querySelectorAll(".history-filter-dropdown")
          .forEach((dd) => dd.classList.add("hidden"));
      }

      // ปิด Dropdown เมื่อคลิกนอกกรอบ หรือเลื่อนหน้าจอ (ป้องกันตำแหน่งเพี้ยน)
      document.addEventListener("click", function (e) {
        if (
          !e.target.closest(".history-filter-dropdown") &&
          !e.target.closest(".filter-toggle-btn")
        ) {
          closeAllHistoryFilterDropdowns();
        }
      });
      window.addEventListener("scroll", closeAllHistoryFilterDropdowns, true);
      window.addEventListener("resize", closeAllHistoryFilterDropdowns);

      // ไฮไลท์ไอคอน filter เป็นสีส้มถ้าคอลัมน์นั้นกำลังมีการกรองอยู่ และโชว์/ซ่อนปุ่ม "ล้างตัวกรองทั้งหมด"
      function updateHistoryFilterIndicators() {
        const filters = {
          documentId: document.getElementById("filter-documentId")?.value || "",
          date: document.getElementById("filter-date")?.value || "",
          purpose: document.getElementById("filter-purpose")?.value || "",
          preparedBy: document.getElementById("filter-preparedBy")?.value || "",
          createdByEmpId:
            document.getElementById("filter-createdByEmpId")?.value || "",
          displayStatus:
            document.getElementById("filter-displayStatus")?.value || "",
        };

        let anyActive = false;
        document.querySelectorAll(".filter-toggle-btn").forEach((btn) => {
          const col = btn.getAttribute("data-filter-col");
          if (filters[col]) {
            anyActive = true;
            btn.classList.add("text-orange-600", "bg-orange-50");
            btn.classList.remove("text-slate-400");
          } else {
            btn.classList.remove("text-orange-600", "bg-orange-50");
            btn.classList.add("text-slate-400");
          }
        });

        const resetBtn = document.getElementById("resetHistoryFiltersBtn");
        if (resetBtn) resetBtn.classList.toggle("hidden", !anyActive);
      }

      // เติมตัวเลือกใน Dropdown ของ วัตถุประสงค์ (Mov) และ ผู้สลับสินค้า แบบไม่ซ้ำ
      // อ้างอิงจากข้อมูล "ทั้งหมด" เสมอ (ไม่ใช่ข้อมูลหลังกรอง) เพื่อไม่ให้ตัวเลือกหายไปเวลากรองอยู่
      function populateHistoryFilterOptions(history) {
        const purposeSelect = document.getElementById("filter-purpose");
        const preparedBySelect = document.getElementById("filter-preparedBy");
        const empIdSelect = document.getElementById("filter-createdByEmpId");
        if (!purposeSelect || !preparedBySelect) return;

        const currentPurpose = purposeSelect.value;
        const currentPreparedBy = preparedBySelect.value;
        const currentEmpIdFilter = empIdSelect ? empIdSelect.value : "";

        const uniquePurposes = [
          ...new Set(history.map((h) => h.purpose).filter(Boolean)),
        ].sort();
        const uniquePreparedBy = [
          ...new Set(history.map((h) => h.preparedBy).filter(Boolean)),
        ].sort();
        const uniqueEmpIds = [
          ...new Set(history.map((h) => h.createdByEmpId).filter(Boolean)),
        ].sort();

        // ตัวกรองทำงานด้วย "รหัส" ไม่ใช่ชื่อ จึงแสดงรหัสนำหน้าด้วย
        // กันสับสนว่า 921 ใบไหนคือความหมายเก่า ใบไหนคือความหมายใหม่
        purposeSelect.innerHTML =
          '<option value="">ทั้งหมด</option>' +
          uniquePurposes
            .map(
              (p) =>
                `<option value="${p}">${MOVEMENT_LABEL_MAP[String(p)] || `${p} - อื่น ๆ`}</option>`,
            )
            .join("");
        preparedBySelect.innerHTML =
          '<option value="">ทั้งหมด</option>' +
          uniquePreparedBy
            .map((p) => `<option value="${p}">${p}</option>`)
            .join("");
        if (empIdSelect) {
          empIdSelect.innerHTML =
            '<option value="">ทั้งหมด</option>' +
            uniqueEmpIds
              .map((p) => `<option value="${p}">${p}</option>`)
              .join("");
        }

        // คืนค่าตัวเลือกที่เคยเลือกไว้ ถ้ายังมีอยู่ในรายการใหม่
        if (uniquePurposes.includes(currentPurpose))
          purposeSelect.value = currentPurpose;
        if (uniquePreparedBy.includes(currentPreparedBy))
          preparedBySelect.value = currentPreparedBy;
        if (empIdSelect && uniqueEmpIds.includes(currentEmpIdFilter))
          empIdSelect.value = currentEmpIdFilter;
      }

      // ถูกเรียกทุกครั้งที่ผู้ใช้พิมพ์/เลือกค่าใน Filter ใดๆ บนหัวคอลัมน์
      function onHistoryFilterChange() {
        renderHistoryTable();
      }

      // ล้างค่า Filter ทั้งหมดกลับเป็นค่าเริ่มต้น
      function resetHistoryFilters() {
        const docIdInput = document.getElementById("filter-documentId");
        const dateInput = document.getElementById("filter-date");
        const purposeSelect = document.getElementById("filter-purpose");
        const preparedBySelect = document.getElementById("filter-preparedBy");
        const empIdSelect = document.getElementById("filter-createdByEmpId");
        const displayStatusSelect = document.getElementById(
          "filter-displayStatus",
        );

        if (docIdInput) docIdInput.value = "";
        if (dateInput) dateInput.value = "";
        if (purposeSelect) purposeSelect.value = "";
        if (preparedBySelect) preparedBySelect.value = "";
        if (empIdSelect) empIdSelect.value = "";
        if (displayStatusSelect) displayStatusSelect.value = "";

        closeAllHistoryFilterDropdowns();
        renderHistoryTable();
      }

      // กรองข้อมูลตามเงื่อนไขที่กรอก/เลือกไว้ในแต่ละคอลัมน์
      function applyHistoryFilters(history) {
        const docIdVal = (
          document.getElementById("filter-documentId")?.value || ""
        )
          .trim()
          .toLowerCase();
        const dateVal = document.getElementById("filter-date")?.value || "";
        const purposeVal =
          document.getElementById("filter-purpose")?.value || "";
        const preparedByVal =
          document.getElementById("filter-preparedBy")?.value || "";
        const empIdVal =
          document.getElementById("filter-createdByEmpId")?.value || "";
        const displayStatusVal =
          document.getElementById("filter-displayStatus")?.value || "";

        return history.filter((item) => {
          if (
            docIdVal &&
            !String(item.documentId || "")
              .toLowerCase()
              .includes(docIdVal)
          )
            return false;
          if (dateVal && item.date !== dateVal) return false;
          if (purposeVal && item.purpose !== purposeVal) return false;
          if (preparedByVal && item.preparedBy !== preparedByVal) return false;
          if (empIdVal && item.createdByEmpId !== empIdVal) return false;
          if (
            displayStatusVal &&
            getHistoryDisplayStatus(item).label !== displayStatusVal
          )
            return false;
          return true;
        });
      }

      // เรียงลำดับข้อมูลตามคอลัมน์และทิศทางที่กำลัง active อยู่
      function sortHistoryData(history) {
        const { column, direction } = historySortState;
        if (!column) return history;

        // ลำดับขั้นความคืบหน้าจริงของสถานะ (ไม่ใช่เรียงตามตัวอักษร)
        const statusRank = {
          "รอ ผู้บริหาร อนุมัติ": 1,
          "รอ SCM อนุมัติ": 2,
          อนุมัติแล้ว: 3,
          ถูกปฏิเสธ: 4,
        };

        return [...history].sort((a, b) => {
          let valA, valB;

          if (column === "displayStatus") {
            valA = statusRank[getHistoryDisplayStatus(a).label] || 0;
            valB = statusRank[getHistoryDisplayStatus(b).label] || 0;
          } else if (column === "date") {
            valA = new Date(a[column] ?? "").getTime();
            valB = new Date(b[column] ?? "").getTime();
          } else {
            valA = String(a[column] ?? "").toLowerCase();
            valB = String(b[column] ?? "").toLowerCase();
          }

          if (valA < valB) return direction === "asc" ? -1 : 1;
          if (valA > valB) return direction === "asc" ? 1 : -1;
          return 0;
        });
      }

      // เมื่อกดหัวคอลัมน์: ถ้าเป็นคอลัมน์เดิมให้สลับ asc/desc, ถ้าเป็นคอลัมน์ใหม่ให้เริ่มที่ asc
      function sortHistoryBy(column) {
        if (historySortState.column === column) {
          historySortState.direction =
            historySortState.direction === "asc" ? "desc" : "asc";
        } else {
          historySortState.column = column;
          historySortState.direction = "asc";
        }
        renderHistoryTable();
      }

      // อัปเดตไอคอนลูกศรบนหัวคอลัมน์ให้ตรงกับสถานะการเรียงลำดับปัจจุบัน
      function updateHistorySortIcons() {
        document.querySelectorAll(".sort-icon").forEach((icon) => {
          const col = icon.getAttribute("data-col");
          if (col === historySortState.column) {
            icon.setAttribute(
              "data-lucide",
              historySortState.direction === "asc"
                ? "chevron-up"
                : "chevron-down",
            );
            icon.classList.remove("text-slate-400");
            icon.classList.add("text-orange-600");
          } else {
            icon.setAttribute("data-lucide", "chevrons-up-down");
            icon.classList.remove("text-orange-600");
            icon.classList.add("text-slate-400");
          }
        });
        lucide.createIcons();
      }

      // ฟังก์ชันแปลงวันที่สากลเป็นวันที่ภาษาไทย (พ.ศ.)
      function formatThaiDate(dateString) {
        const date = new Date(dateString);
        if (isNaN(date.getTime())) return dateString;
        const months = [
          "มกราคม",
          "กุมภาพันธ์",
          "มีนาคม",
          "เมษายน",
          "พฤษภาคม",
          "มิถุนายน",
          "กรกฎาคม",
          "สิงหาคม",
          "กันยายน",
          "ตุลาคม",
          "พฤศจิกายน",
          "ธันวาคม",
        ];
        return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear() + 543}`;
      }

      // ===================================================================
      // อ่านวันเวลาจาก DB แบบไม่ให้ JavaScript ตีความ timezone ใหม่
      // ===================================================================
      // ⚠️ n8n ส่งค่า DATETIME กลับมาเป็น ISO ที่มี Z ต่อท้าย (เช่น 2026-09-10T17:41:21.000Z)
      //    ทั้งที่ฝั่ง SQL ใช้ GETDATE() เก็บ "เวลาไทย" อยู่แล้ว
      //    ถ้าเอาไปเข้า new Date() แล้ว toLocaleString('th-TH') เบราว์เซอร์จะบวก 7 ชั่วโมงให้อีกรอบ
      //    กลายเป็นเวลาไทยซ้อนเวลาไทย — วิธีที่ถูกคืออ่านตัวเลขในสตริงตรงๆ
      //    (ชุดเดียวกับ formatLogDateTime() ใน history_log.html)
      function parseLogTimeParts(isoStr) {
        const m = String(isoStr || "").match(
          /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/,
        );
        if (!m) return null;
        return {
          yyyy: m[1],
          mm: m[2],
          dd: m[3],
          hh: m[4],
          min: m[5],
          ss: m[6] || "00",
        };
      }

      const THAI_MONTHS_FULL = [
        "มกราคม",
        "กุมภาพันธ์",
        "มีนาคม",
        "เมษายน",
        "พฤษภาคม",
        "มิถุนายน",
        "กรกฎาคม",
        "สิงหาคม",
        "กันยายน",
        "ตุลาคม",
        "พฤศจิกายน",
        "ธันวาคม",
      ];

      // วัน/เดือน/ปี เวลา — ใช้กับ log ในหน้า Docflow
      function formatThaiDateTime(value) {
        if (!value) return "-";
        const p = parseLogTimeParts(value);
        if (p) {
          return `${p.dd}/${p.mm}/${Number(p.yyyy) + 543} ${p.hh}:${p.min}`;
        }
        const dt = new Date(String(value).replace(/(\d)(AM|PM)$/i, "$1 $2"));
        if (isNaN(dt.getTime())) return String(value);
        const dd = String(dt.getDate()).padStart(2, "0");
        const mm = String(dt.getMonth() + 1).padStart(2, "0");
        const hh = String(dt.getHours()).padStart(2, "0");
        const min = String(dt.getMinutes()).padStart(2, "0");
        return `${dd}/${mm}/${dt.getFullYear() + 543} ${hh}:${min}`;
      }

      // "10 กันยายน 2569 17:41" — ใช้กับวันที่อนุมัติในแต่ละขั้นของ Docflow
      // รับได้ทั้ง ISO จาก DB และสตริงที่ถูกจัดรูปมาแล้ว เช่น "Sep 10 2026 5:41PM"
      // (ของเดิมส่งเข้า formatThaiDate() ซึ่ง new Date() แปลงไม่ได้ เลยคืนค่าดิบเป็นภาษาอังกฤษ)
      function formatThaiDateTimeLong(value) {
        if (!value) return "-";
        const p = parseLogTimeParts(value);
        if (p) {
          return `${Number(p.dd)} ${THAI_MONTHS_FULL[Number(p.mm) - 1]} ${Number(p.yyyy) + 543} ${p.hh}:${p.min} น.`;
        }
        // สตริงรูปแบบอื่น เช่น "Sep 10 2026 5:41PM" — เติมช่องว่างหน้า AM/PM ให้ new Date() อ่านออก
        const normalized = String(value).replace(/(\d)(AM|PM)$/i, "$1 $2");
        const dt = new Date(normalized);
        if (isNaN(dt.getTime())) return String(value);
        const hh = String(dt.getHours()).padStart(2, "0");
        const min = String(dt.getMinutes()).padStart(2, "0");
        return `${dt.getDate()} ${THAI_MONTHS_FULL[dt.getMonth()]} ${dt.getFullYear() + 543} ${hh}:${min} น.`;
      }

      // คำนวณสถานะที่จะแสดงในคอลัมน์ "สถานะ" ของตารางประวัติ
      // ใช้ Logic เดียวกับหน้า Docflow เป๊ะ เพื่อให้สอดคล้องกันเสมอ:
      //   - step2Done (ผู้บริหารอนุมัติ) ยังไม่เสร็จ -> "รอ ผู้บริหาร อนุมัติ"
      //   - step2Done เสร็จ แต่ step3Done (SCM อนุมัติ) ยังไม่เสร็จ -> "รอ SCM อนุมัติ"
      //   - step3Done เสร็จ -> "อนุมัติแล้ว"
      function getHistoryDisplayStatus(item) {
        const currentStatus = item.status || "รอการอนุมัติ";

        // เช็คสถานะ "ถูกปฏิเสธ" ก่อนเป็นอันดับแรก — ไม่งั้นจะหลุดไป fallback เป็น "รอ ผู้บริหาร อนุมัติ" ผิดๆ
        // (เพราะเอกสารที่ถูกปฏิเสธมักยังไม่มี approvedBy เหมือนเอกสารที่แค่ยังไม่ถูกดำเนินการ)
        if (currentStatus === "ถูกปฏิเสธ") {
          return {
            label: "ถูกปฏิเสธ",
            badgeClass: "bg-red-50 text-red-700 border border-red-100",
          };
        }

        // 🆕 06/10/2569 : เอกสารที่ถูกยกเลิก — ต้องเช็คก่อนกติกา step2Done/step3Done ด้านล่างเสมอ
        // ไม่งั้นเอกสารที่ยกเลิกจะตกไปเป็น "รอ ผู้บริหาร อนุมัติ" (ซึ่งทำให้ปุ่มแก้ไข/ลบ/ยกเลิกโผล่ผิด)
        if (currentStatus === "ยกเลิก") {
          return {
            label: "ยกเลิก",
            badgeClass: "bg-red-50 text-red-600 border border-red-100",
          };
        }

        // ⚠️ เอกสาร Fast-track (แนบเอกสาร + ติ๊ก "ไม่ผ่านผู้บริหาร") ถือว่าผ่านขั้นผู้บริหารแล้วตั้งแต่สร้าง
        //    ฝั่ง n8n เซ็ต status_doc = 'รอ SCM อนุมัติ' และ manager_approve_date = GETDATE() ให้ทันที
        //    แต่เงื่อนไขเดิมดูแค่คำว่า "อนุมัติแล้ว"/"เสร็จสิ้น" จึงตกไปเป็น "รอ ผู้บริหาร อนุมัติ" ผิดความจริง
        const step2Done =
          currentStatus === "รอ SCM อนุมัติ" ||
          item.skipApprover === true ||
          Number(item.skipApprover) === 1 ||
          (!!item.approvedBy &&
            (currentStatus.includes("อนุมัติแล้ว") ||
              currentStatus.includes("เสร็จสิ้น")));
        const step3Done =
          !!item.scmControl &&
          (currentStatus.includes("เสร็จสิ้น") ||
            (currentStatus.toLowerCase().includes("scm") &&
              currentStatus.includes("อนุมัติแล้ว")));

        if (step3Done) {
          return {
            label: "อนุมัติแล้ว",
            badgeClass:
              "bg-emerald-50 text-emerald-700 border border-emerald-100",
          };
        }
        if (step2Done) {
          return {
            label: "รอ SCM อนุมัติ",
            badgeClass: "bg-blue-50 text-blue-700 border border-blue-100",
          };
        }
        return {
          label: "รอ ผู้บริหาร อนุมัติ",
          badgeClass: "bg-amber-50 text-amber-700 border border-amber-100",
        };
      }

      // ฟังก์ชันเรนเดอร์ตารางประวัติจากข้อมูลจริงใน localStorage พร้อม 4 ปุ่มการจัดการ
      function __permApply(changed) {
        const nb = document.getElementById("btnNewDoc");
        if (nb) nb.style.display = pcan("CREATE", true) ? "" : "none";
        canRevertStage = pcan("RETURN_STATUS", _canRevertLegacy);
        if (changed && typeof syncHistoryStatuses === "function") syncHistoryStatuses();
        else renderHistoryTable();
      }

      function renderHistoryTable() {
        const tbody = document.getElementById("historyTableBody");
        if (!tbody) return;

        let fullHistory = JSON.parse(
          localStorage.getItem("ktw_swap_history") || "[]",
        );

        // 🔒 จำกัดการมองเห็น: Admin และ Role SCM เห็นทุกใบ | คนอื่นเห็นเฉพาะที่ตัวเองสร้าง หรือเคยอนุมัติ (ผู้บริหาร/SCM)
        // (ต้องตรงกับเงื่อนไขฝั่ง n8n/SQL ของ get_all_swap_document_status เสมอ ไม่งั้นข้อมูลที่ backend ส่งมาจะโดนกรองทิ้งซ้ำที่นี่)
        // ผู้ที่มีสิทธิ์อนุมัติ/ตรวจสอบทุก role (1 Admin, 2 Approver, 3 SCM) เห็นได้ทุกใบ
        // เดิมเปิดแค่ 1 กับ 3 ทำให้ Approver เห็นเฉพาะใบที่ตัวเองเซ็นไปแล้ว
        // Role ที่เห็นเอกสารได้ทุกใบ: 1 Admin, 2 Approver, 3 SCM, 6 MCM, 7 SPM
        // MCM/SPM ดูอย่างเดียว ไม่มีปุ่มอนุมัติ แต่ต้องเห็นทุกใบเพื่อตามของเข้าคลัง
        // ⚠️ ต้องตรงกับเงื่อนไข emp_type IN (...) ใน SQL - Get All Document Status เสมอ
        const canSeeAllHistory = pcan(
          "READ_ALL",
          ["1", "2", "3", "6", "7"].includes(currentUserEmpType),
        );
        if (!canSeeAllHistory) {
          // คนที่ไม่มี role เห็นเฉพาะใบที่ตัวเองสร้าง หรือถูกระบุชื่อไว้บนเอกสาร
          // ⚠️ ต้องเช็คทั้งช่อง notify (ผู้ที่ถูกเลือกให้อนุมัติ) และช่องผู้เซ็นจริง
          //    เพราะ approvedByEmpId จะมีค่าก็ต่อเมื่อเซ็นไปแล้วเท่านั้น
          const sameEmp = (a, b) =>
            String(a ?? "").trim() === String(b ?? "").trim();
          fullHistory = fullHistory.filter((item) =>
            [
              item.createdByEmpId,
              item.approvedByEmpId,
              item.approverNotifyEmpId,
              item.scmControlEmpId,
              item.scmNotifyEmpId,
            ].some((id) => sameEmp(id, currentEmpId)),
          );
        }

        // เติมตัวเลือก Dropdown filter จากข้อมูลทั้งหมดเสมอ (ก่อนกรอง)
        populateHistoryFilterOptions(fullHistory);

        if (fullHistory.length === 0) {
          tbody.innerHTML = `
                    <tr>
                        <td colspan="7" class="p-8 text-center text-slate-400">
                            <div class="h-11 w-11 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-3 border border-slate-200">
                                <i data-lucide="file-question" class="w-6 h-6 text-slate-400"></i>
                            </div>
                            ไม่มีประวัติเอกสารใบสลับสินค้าในขณะนี้
                        </td>
                    </tr>
                `;
          lucide.createIcons();
          updateHistoryFilterIndicators();
          return;
        }

        let history = applyHistoryFilters(fullHistory);
        history = sortHistoryData(history);

        if (history.length === 0) {
          tbody.innerHTML = `
                    <tr>
                        <td colspan="7" class="p-8 text-center text-slate-400">
                            <div class="h-11 w-11 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-3 border border-slate-200">
                                <i data-lucide="search-x" class="w-6 h-6 text-slate-400"></i>
                            </div>
                            ไม่พบเอกสารที่ตรงกับเงื่อนไขการค้นหา/กรอง
                        </td>
                    </tr>
                `;
          lucide.createIcons();
          updateHistoryFilterIndicators();
          return;
        }

        tbody.innerHTML = history
          .map((item) => {
            const statusInfo = getHistoryDisplayStatus(item);
            return `
                    <tr class="hover:bg-slate-50/50 transition-colors">
                        <td class="p-4 font-mono font-semibold text-slate-900">${item.documentId}</td>
                        <td class="p-4 text-slate-600 font-light">${formatThaiDate(item.date)}</td>
                        <td class="p-4">
                            <span class="text-slate-900 whitespace-nowrap">${purposeLabel(item.purpose, item.purposeDes)}</span>
                        </td>
                        <td class="p-4 text-slate-500 font-mono">${item.createdByEmpId || "-"}</td>
                        <td class="p-4 text-slate-700">${item.preparedBy}</td>
                        <td class="p-4">
                            <span class="inline-flex items-center whitespace-nowrap rounded-lg px-2.5 py-1 font-bold ${statusInfo.badgeClass}">${statusInfo.label}</span>
                        </td>
                        <td class="p-4 text-right">
                            <div class="flex items-center justify-end gap-1">
                                <!-- 0. ปุ่ม Preview (ดูตัวอย่างหน้าตาเอกสารก่อนพิมพ์) -->
                                <button onclick="previewDocument('${item.documentId}')" title="ดูตัวอย่างเอกสาร" class="p-1.5 rounded-lg text-slate-400 hover:bg-indigo-50 hover:text-indigo-600">
                                    <i data-lucide="file-text" class="w-4 h-4"></i>
                                </button>

                                <!-- 1. ปุ่ม Display — เฉพาะ Admin เท่านั้นที่เห็น (ตามข้อกำหนดสิทธิ์) -->
                                ${
                                  isAdminUser
                                    ? `
                                <button onclick="displayDocument('${item.documentId}')" title="ดูข้อมูล" class="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                                    <i data-lucide="eye" class="w-4 h-4"></i>
                                </button>`
                                    : ""
                                }

                                <!-- 2. ปุ่ม Edit (Staff แก้ไขได้เฉพาะเอกสารที่ตัวเองสร้าง / Admin แก้ไขได้ทุกเอกสาร ที่ stage แรกเท่านั้น) -->
                                <!-- ถ้าแก้ไขไม่ได้ ไม่แสดงปุ่มเลย (ไม่โชว์ล็อก) ให้เหมือนกับปุ่ม Delete ที่ซ่อนไปเลยเวลาไม่มีสิทธิ์ -->
                                ${
                                  canEditDocument(item)
                                    ? `
                                <button onclick="editDocument('${item.documentId}')" title="แก้ไข" class="p-1.5 rounded-lg text-slate-400 hover:bg-blue-50 hover:text-blue-600">
                                    <i data-lucide="pencil" class="w-4 h-4"></i>
                                </button>
                                `
                                    : ""
                                }

                                <!-- 3. ปุ่ม Docflow -->
                                <button onclick="showDocFlow('${item.documentId}')" title="ดูความเคลื่อนไหว" class="p-1.5 rounded-lg text-slate-400 hover:bg-purple-50 hover:text-purple-600">
                                    <i data-lucide="git-branch" class="w-4 h-4"></i>
                                </button>

                                <!-- 4. ปุ่ม Delete (Admin เท่านั้น และเฉพาะตอนเอกสารยังอยู่ stage แรก) -->
                                ${
                                  canDeleteDocument(item)
                                    ? `
                                <button onclick="openDeleteDocModal('${item.documentId}')" title="ลบใบสลับสินค้า" class="p-1.5 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600">
                                    <i data-lucide="trash-2" class="w-4 h-4"></i>
                                </button>
                                `
                                    : ""
                                }

                                <!-- 4.1 🆕 06/10/2569 : ปุ่มยกเลิกเอกสาร (ผู้สร้างหรือ Admin — เฉพาะสถานะ "รอ ผู้บริหาร อนุมัติ") -->
                                ${
                                  canCancelDocument(item)
                                    ? `
                                <button onclick="openCancelDocModal('${item.documentId}')" title="ยกเลิกเอกสาร" class="p-1.5 rounded-lg text-slate-400 hover:bg-orange-50 hover:text-orange-600">
                                    <i data-lucide="ban" class="w-4 h-4"></i>
                                </button>
                                `
                                    : ""
                                }

                                <!-- 5. 🆕 30/09/2569 : ปุ่มถอยสถานะ (Admin + SCM — เพิ่ม SCM 06/10/2569) — ใช้แก้เอกสารที่ระบุ Fast Track ผิด
                                     หรือกดอนุมัติผิดขั้น แล้วติดค้างจนแก้ไข/ลบไม่ได้อีก -->
                                ${
                                  canRevertStage && getHistoryDisplayStatus(item).label !== "ยกเลิก"
                                    ? `
                                <button onclick="openAdminRevertSwapModal('${item.documentId}')" title="ถอยสถานะเอกสาร (Admin/SCM)" class="p-1.5 rounded-lg text-slate-400 hover:bg-amber-50 hover:text-amber-600">
                                    <i data-lucide="undo-2" class="w-4 h-4"></i>
                                </button>
                                `
                                    : ""
                                }
                            </div>
                        </td>
                    </tr>
                `;
          })
          .join("");
        lucide.createIcons();
        updateHistorySortIcons();
        updateHistoryFilterIndicators();
      }

      // ================= POPUP MODAL ACTIONS =================

      // อะนิเมชันการเปิด-ปิด Modal
      function openModal(modalId, contentId) {
        const modal = document.getElementById(modalId);
        const content = document.getElementById(contentId);
        modal.classList.remove("hidden");
        setTimeout(() => {
          content.classList.remove("scale-95", "opacity-0");
          content.classList.add("scale-100", "opacity-100");
        }, 50);
      }

      function closeModal(modalId, contentId) {
        const modal = document.getElementById(modalId);
        const content = document.getElementById(contentId);
        content.classList.remove("scale-100", "opacity-100");
        content.classList.add("scale-95", "opacity-0");
        setTimeout(() => {
          modal.classList.add("hidden");
        }, 200);
      }

      // เปิดแบบฟอร์มการสร้างใบใหม่
      function openNewSwapModal() {
        editMode = false;
        editingDocId = null;

        document.getElementById("swapForm").reset();
        document.getElementById("productTableBody").innerHTML = "";
        // form.reset() ไม่ล้างตัวแปร attachmentData/keepExistingAttachment ที่เก็บไว้นอก DOM
        // ต้องเรียก reset เองเพื่อกันไฟล์แนบของเอกสารก่อนหน้าติดมากับเอกสารใหม่
        resetAttachmentSection();

        document.getElementById("formModalTitle").textContent =
          "สร้างคำขออนุมัติเอกสารสลับสินค้า";
        document.getElementById("formModeBadge").textContent = "";
        document.getElementById("submitBtnText").textContent =
          "บันทึกเอกสาร";

        setFormFieldsReadonly(false);
        setPreparedByLocked(false);

        initDocumentId();
        const today = new Date().toISOString().substring(0, 10);
        document.getElementById("docDate").value = today;
        document.getElementById("preparedBy").value = currentUserName;
        document.getElementById("preparedByEmail").value =
          sessionStorage.getItem("email") || currentUserEmail;

        addSampleRows();

        openModal("swapFullscreenModal", "swapModalContent");
      }

      // ปิดฟอร์ม
      function closeSwapModal() {
        closeModal("swapFullscreenModal", "swapModalContent");
      }

      // ล็อกเฉพาะช่อง "ลงชื่อผู้ขอสลับสินค้า" (ชื่อเท่านั้น ไม่รวมอีเมล) ตอนอยู่ใน edit mode
      // เพราะ backend (node "Microsoft SQL13") ไม่ได้บันทึกชื่อ (emp_name) ตอนแก้ไข ตั้งใจคงผู้สร้างเอกสารเดิมไว้เสมอ
      // ส่วน "Email ผู้ขอสลับสินค้า" (preparedByEmail) แก้ไขได้อิสระเสมอทั้ง 2 โหมด และบันทึกลง SQL จริง (emp_email)
      // ตอนสร้างเอกสารใหม่ (create mode) ชื่อยังคงแก้ไขได้อิสระตามปกติ ไม่ถูกล็อก
      function setPreparedByLocked(locked) {
        const nameInput = document.getElementById("preparedBy");
        const nameHint = document.getElementById("preparedByLockHint");

        if (nameInput) {
          if (locked) {
            nameInput.setAttribute("readonly", true);
            nameInput.classList.add(
              "bg-slate-50",
              "text-slate-500",
              "cursor-not-allowed",
            );
          } else {
            nameInput.removeAttribute("readonly");
            nameInput.classList.remove(
              "bg-slate-50",
              "text-slate-500",
              "cursor-not-allowed",
            );
          }
        }

        if (nameHint) nameHint.classList.toggle("hidden", !locked);
      }

      // คุมฟิลด์ให้อ่านอย่างเดียวหรือเขียนได้
      function setFormFieldsReadonly(readonly) {
        const form = document.getElementById("swapForm");
        const inputs = form.querySelectorAll(
          "input:not(#docId):not(#docDate):not([type='radio']):not([type='checkbox']):not([type='file']), textarea",
        );
        const radios = form.querySelectorAll('input[type="radio"]');

        inputs.forEach((input) => {
          if (readonly) {
            input.setAttribute("readonly", true);
            input.classList.add(
              "bg-slate-50",
              "text-slate-500",
              "cursor-not-allowed",
            );
          } else {
            input.removeAttribute("readonly");
            input.classList.remove(
              "bg-slate-50",
              "text-slate-500",
              "cursor-not-allowed",
            );
          }
        });

        radios.forEach((radio) => {
          radio.disabled = readonly;
        });

        // ⚠️ select / checkbox / file ใช้ readonly ไม่ได้ ต้องใช้ disabled เท่านั้น
        //    (ก่อนหน้านี้ตกหล่นไป ทำให้โหมดดูข้อมูลยังแก้ Dropdown และติ๊ก Fast-track ได้)
        form
          .querySelectorAll("select:not(#docStatus)")
          .forEach((sel) => {
            sel.disabled = readonly;
            sel.classList.toggle("bg-slate-50", readonly);
            sel.classList.toggle("text-slate-500", readonly);
            sel.classList.toggle("cursor-not-allowed", readonly);
          });

        const skipChk = document.getElementById("skipApprover");
        if (skipChk && readonly) skipChk.disabled = true;

        // ช่องอัปโหลดไฟล์ — โหมดดูข้อมูลไม่ต้องให้เลือกไฟล์ใหม่ ซ่อนไปเลยพร้อมข้อความบอกขนาดไฟล์
        const fileEl = document.getElementById("attachmentFile");
        if (fileEl) fileEl.classList.toggle("hidden", readonly);
        const fileHint = document.getElementById("attachmentFileHint");
        if (fileHint) fileHint.classList.toggle("hidden", readonly);

        // Radio "มี/ไม่มีเอกสารแนบ" ถูก disable ไปแล้วจาก radios.forEach ด้านบน

        // จัดการ select#docStatus ให้ disable ตลอด (status ถูก lock เสมอ)
        const docStatusEl = document.getElementById("docStatus");
        if (docStatusEl) {
          docStatusEl.disabled = true;
          docStatusEl.classList.add(
            "bg-slate-50",
            "text-slate-500",
            "cursor-not-allowed",
          );
        }

        const addBtn = document.getElementById("addNewRowBtn");
        const submitBtn = document.getElementById("submitBtn");
        const manageColHeader = document.getElementById("manageColHeader");
        // ⚠️ ต้องซ่อนทั้ง <th> และ <td> ของคอลัมน์ลบพร้อมกัน
        //    ถ้าซ่อนแค่ <th> จำนวนคอลัมน์ header กับ body จะไม่เท่ากัน
        //    คอลัมน์สุดท้ายที่ไม่มี header จะดูดพื้นที่ว่างทั้งหมดไป ทำให้คอลัมน์อื่นหดจนตารางเพี้ยน
        const manageCells = document.querySelectorAll(".manage-col-cell");

        if (readonly) {
          if (addBtn) addBtn.classList.add("hidden");
          if (submitBtn) submitBtn.classList.add("hidden");
          if (manageColHeader) manageColHeader.classList.add("hidden");
          manageCells.forEach((td) => td.classList.add("hidden"));
        } else {
          if (addBtn) addBtn.classList.remove("hidden");
          if (submitBtn) submitBtn.classList.remove("hidden");
          if (manageColHeader) manageColHeader.classList.remove("hidden");
          manageCells.forEach((td) => td.classList.remove("hidden"));

          // ปลดล็อกฟอร์มแล้ว ต้อง sync สถานะ Fast-track ใหม่ตามว่ามีเอกสารแนบอยู่ไหม
          // ไม่งั้น checkbox จะเปิดให้ติ๊กได้ทั้งที่ยังไม่ได้แนบไฟล์ (ขัดกับกฎฝั่ง Backend)
          const attachRadio = document.querySelector(
            'input[name="hasAttachmentRadio"]:checked',
          );
          const hasAtt = attachRadio && attachRadio.value === "1";
          const skipEl = document.getElementById("skipApprover");
          const skipLabel = document.getElementById("skipApproverLabel");
          const skipHint = document.getElementById("skipApproverHint");
          if (skipEl) skipEl.disabled = !hasAtt;
          if (skipLabel) {
            skipLabel.classList.toggle("cursor-not-allowed", !hasAtt);
            skipLabel.classList.toggle("opacity-50", !hasAtt);
            skipLabel.classList.toggle("cursor-pointer", !!hasAtt);
          }
          if (skipHint) {
            skipHint.textContent = hasAtt
              ? "เอกสารจะข้ามขั้นผู้บริหาร ส่งตรงไปรอ SCM อนุมัติทันที"
              : "ต้องแนบเอกสารประกอบก่อนจึงจะเลือกได้";
          }
        }
      }

      // ================= Mapping กลาง: SQL/n8n raw → format ที่ loadDocumentToForm ใช้งาน =================
      // ใช้ร่วมกันทั้ง Display และ Edit เพื่อกันไม่ให้ field เพี้ยนไปคนละทางแบบที่เจอปัญหาก่อนหน้านี้
      function mapRawDocToFormDoc(raw, docId) {
        // รองรับทั้ง Array (N8n return หลาย node) และ Object เดี่ยว
        const data = Array.isArray(raw) ? raw[0] : raw;

        // รายการสินค้า: รองรับทั้ง data.products / data.items และรองรับหลายชื่อ field ต่อ 1 รายการ
        const rawItems = data.products ?? data.items ?? [];
        const products = rawItems.map((p) => ({
          prodCode: p.prodCode ?? p.prod_code ?? p.PROD_CODE ?? "",
          description: p.description ?? p.prod_desc ?? p.PROD_DESCRIPTION ?? "",
          qtyIn: p.qtyIn ?? p.qty_in ?? p.QTY_IN ?? 0,
          unitIn: p.unitIn ?? p.unit_in ?? p.UNIT_IN ?? "",
          qtyOut: p.qtyOut ?? p.qty_out ?? p.QTY_OUT ?? 0,
          unitOut: p.unitOut ?? p.unit_out ?? p.UNIT_OUT ?? "",
          price: p.price ?? p.PRICE ?? 0,
        }));

        return {
          documentId: data.documentId ?? data.doc_id ?? docId,
          date: data.date ?? data.crdate ?? "",
          purpose: data.purpose ?? data.movement_type ?? "309",
          purposeDes: data.purposeDes ?? data.movement_type_des ?? "",
          // ข้อมูลรับเข้าคลัง (SCM กรอกตอนอนุมัติขั้นสุดท้าย) — ใช้แสดงใน Preview/พิมพ์
          odoNo: data.odoNo ?? data.odo_no ?? "",
          inboundDocMcm: data.inboundDocMcm ?? data.inbound_doc_mcm ?? "",
          inboundDocSpm: data.inboundDocSpm ?? data.inbound_doc_spm ?? "",
          mcmNotifyName: data.mcmNotifyName ?? data.mcm_notify_name ?? "",
          spmNotifyName: data.spmNotifyName ?? data.spm_notify_name ?? "",
          remark: data.remark ?? "",
          preparedBy: data.preparedBy ?? data.emp_name ?? "",
          preparedByEmail: data.preparedByEmail ?? data.emp_email ?? "",
          createdByEmail: data.createdByEmail ?? data.created_by_email ?? "",
          createdByEmpId: data.createdByEmpId ?? data.created_by_emp_id ?? "",
          scmControl: data.scmControl ?? data.scm_approve ?? "",
          scmControlEmail: data.scmControlEmail ?? data.scm_email ?? "",
          scmControlEmpId: data.scmControlEmpId ?? data.scm_notify_emp_id ?? "",
          approvedBy: data.approvedBy ?? data.emp_approve ?? "",
          approvedByEmail: data.approvedByEmail ?? data.approve_email ?? "",
          approvedByEmpId: data.approvedByEmpId ?? data.manager_notify_emp_id ?? "",
          scmSignature: data.scmSignature ?? data.scm_signature ?? "",
          approvedSignature: data.approvedSignature ?? data.emp_signature ?? "",
          // ✅ ความเห็นประกอบการอนุมัติ ทั้งจากผู้บริหารและ SCM (สำหรับแสดงใน Preview)
          approverComment: data.approverComment ?? data.manager_comment ?? "",
          scmComment: data.scmComment ?? data.scm_comment ?? "",
          // 📎 เอกสารแนบ + Fast-track — ถ้าไม่ map ตรงนี้ หน้า Display/Edit จะโชว์ "ไม่มีเอกสารแนบ" เสมอ
          //    แม้เอกสารจะมีไฟล์แนบอยู่จริง (ค่าที่ไม่ได้ map จะเป็น undefined → ตกไปทาง else)
          hasAttachment:
            data.hasAttachment === true || Number(data.has_attachment) === 1,
          skipApprover:
            data.skipApprover === true || Number(data.skip_approver) === 1,
          attachmentFileName:
            data.attachmentFileName ?? data.attachment_file_name ?? "",
          attachmentFileType:
            data.attachmentFileType ?? data.attachment_file_type ?? "",
          attachmentBase64:
            data.attachmentBase64 ?? data.attachment_base64 ?? "",
          description: data.description ?? "",
          status: data.status ?? "เสร็จสิ้น",
          products: products,
        };
      }

      // 👁️ ฟังก์ชัน Display (ดูข้อมูลอย่างเดียว - ดึงจาก SQL ผ่าน n8n)
      async function displayDocument(docId) {
        showNotification(
          "กำลังดึงข้อมูล",
          `กำลังดึงข้อมูลใบสลับสินค้า ${docId} จาก SQL Server...`,
          "warning",
        );

        // ลิงก์ Webhook ดึงรายละเอียดข้อมูลรายใบ
        const webhookUrl = `https://n8n.ktw.co.th/webhook/GetDocumentDetail-KTW-switching-system`;

        try {
          const response = await n8nFetch(webhookUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({ documentId: docId }),
          });

          if (response.ok) {
            const raw = await response.json();
            const doc = mapRawDocToFormDoc(raw, docId);

            loadDocumentToForm(doc);

            document.getElementById("formModalTitle").textContent =
              `ดูเอกสารใบสลับสินค้า (${docId})`;
            document.getElementById("formModeBadge").textContent =
              " · โหมดดูข้อมูล (ดึงจาก SQL)";
            setFormFieldsReadonly(true);

            openModal("swapFullscreenModal", "swapModalContent");
            showNotification(
              "โหลดสำเร็จ",
              `ดึงรายละเอียดใบงาน ${docId} เรียบร้อยแล้ว`,
              "success",
            );
          } else {
            throw new Error(`Server returned status: ${response.status}`);
          }
        } catch (error) {
          console.error("Fetch SQL Document error:", error);
          showNotification(
            "กำลังดึงฐานข้อมูลจำลอง",
            "ไม่สามารถดึงข้อมูลตรงจาก SQL ได้ ระบบดึงข้อมูลจากความจำเครื่องมาทดสอบแสดงผลแทน",
            "warning",
          );

          // แผนสำรอง: ดึงจาก Local Storage
          const history = JSON.parse(
            localStorage.getItem("ktw_swap_history") || "[]",
          );
          const doc = history.find((item) => item.documentId === docId);
          if (doc) {
            loadDocumentToForm(doc);
            document.getElementById("formModalTitle").textContent =
              `ดูเอกสารใบสลับสินค้า (${docId})`;
            document.getElementById("formModeBadge").textContent =
              " · โหมดดูข้อมูล (Local Backup)";
            setFormFieldsReadonly(true);
            openModal("swapFullscreenModal", "swapModalContent");
          }
        }
      }

      // 📄 ฟังก์ชัน Preview (ดูตัวอย่างหน้าตาเอกสารจริงแบบฟอร์มพิมพ์ - ดึงจาก SQL ผ่าน n8n)
      async function previewDocument(docId) {
        showNotification(
          "กำลังดึงข้อมูล",
          `กำลังดึงข้อมูลใบสลับสินค้า ${docId} เพื่อแสดงตัวอย่างเอกสาร...`,
          "warning",
        );

        const webhookUrl = `https://n8n.ktw.co.th/webhook/GetDocumentDetail-KTW-switching-system`;
        let doc = null;

        try {
          const response = await n8nFetch(webhookUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({ documentId: docId }),
          });

          if (response.ok) {
            const raw = await response.json();
            doc = mapRawDocToFormDoc(raw, docId);
            showNotification(
              "โหลดสำเร็จ",
              `ดึงรายละเอียดใบงาน ${docId} เรียบร้อยแล้ว`,
              "success",
            );
          } else {
            throw new Error(`Server returned status: ${response.status}`);
          }
        } catch (error) {
          console.error("previewDocument webhook error:", error);
          showNotification(
            "กำลังดึงฐานข้อมูลจำลอง",
            "ไม่สามารถดึงข้อมูลตรงจาก SQL ได้ ระบบดึงข้อมูลจากความจำเครื่องมาแสดงผลแทน",
            "warning",
          );

          const history = JSON.parse(
            localStorage.getItem("ktw_swap_history") || "[]",
          );
          doc = history.find((item) => item.documentId === docId) || null;
        }

        if (!doc) {
          showNotification(
            "ไม่พบเอกสาร",
            `ไม่พบข้อมูลใบสลับสินค้าเลขที่ ${docId}`,
            "error",
          );
          return;
        }

        renderPreviewPaper(doc);
        renderPreviewAttachment(doc);
        openModal("previewDocModal", "previewDocModalContent");
        lucide.createIcons();
      }

      // 📎 แสดงไฟล์แนบในหน้า Preview — ทุก Role ที่เห็นปุ่ม Preview ดูได้
      //    วางไว้นอกกระดาษ (previewDocPaper) เพื่อไม่ให้ปนไปกับฟอร์มตอนสั่งพิมพ์
      //    (ชุดเดียวกับ disassembly_form.html และ ncr_form.html เพื่อให้ทั้ง 3 ระบบหน้าตาเหมือนกัน)
      let previewAttachment = { base64: "", fileName: "", fileType: "" };

      function renderPreviewAttachment(doc) {
        const bar = document.getElementById("previewAttachmentBar");
        if (!bar) return;

        // SWAP ผ่าน mapRawDocToFormDoc มาแล้วจึงเป็นตัวเล็กเสมอ แต่รับตัวใหญ่ไว้ด้วยเผื่อเรียกจากที่อื่น
        const base64 = doc.attachmentBase64 || doc.AttachmentBase64 || "";
        const fileName = doc.attachmentFileName || doc.AttachmentFileName || "";
        const fileType = doc.attachmentFileType || doc.AttachmentFileType || "";
        const hasAtt =
          doc.hasAttachment === true || Number(doc.hasAttachment) === 1;

        if (!hasAtt || !base64) {
          bar.classList.add("hidden");
          bar.innerHTML = "";
          previewAttachment = { base64: "", fileName: "", fileType: "" };
          return;
        }

        previewAttachment = { base64, fileName, fileType };
        const isImage = /^image\//i.test(fileType);
        const dataUrl = `data:${fileType || "application/octet-stream"};base64,${base64}`;

        bar.innerHTML = `
          <div class="flex items-center justify-between gap-3 flex-wrap">
            <div class="flex items-center gap-2 min-w-0">
              <i data-lucide="paperclip" class="w-4 h-4 text-brand-500 shrink-0"></i>
              <span class="text-xs font-semibold text-slate-700">เอกสารแนบประกอบ:</span>
              <span class="text-xs text-slate-600 truncate">${fileName}</span>
            </div>
            <div class="flex items-center gap-2">
              <button type="button" onclick="openPreviewAttachment()"
                class="px-3 py-1.5 text-xs font-medium rounded-lg bg-brand-50 text-brand-700 hover:bg-brand-100 transition-colors flex items-center gap-1">
                <i data-lucide="external-link" class="w-3 h-3"></i>เปิดดู
              </button>
              <a href="${dataUrl}" download="${fileName}"
                class="px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors flex items-center gap-1">
                <i data-lucide="download" class="w-3 h-3"></i>ดาวน์โหลด
              </a>
            </div>
          </div>
          ${isImage ? `<img src="${dataUrl}" alt="${fileName}" class="mt-3 max-h-80 mx-auto rounded-lg border border-slate-200">` : ""}
        `;
        bar.classList.remove("hidden");
        lucide.createIcons();
      }

      // เปิดไฟล์แนบในแท็บใหม่ — ใช้ Blob เพราะ Chrome บล็อกการเปิด data URL ขนาดใหญ่
      function openPreviewAttachment() {
        if (!previewAttachment.base64) return;
        try {
          const bin = atob(previewAttachment.base64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          const url = URL.createObjectURL(
            new Blob([bytes], {
              type: previewAttachment.fileType || "application/octet-stream",
            }),
          );
          window.open(url, "_blank");
          setTimeout(() => URL.revokeObjectURL(url), 60000);
        } catch (e) {
          showNotification(
            "เปิดไฟล์ไม่สำเร็จ",
            "ไฟล์แนบอาจเสียหาย กรุณาลองดาวน์โหลดแทน",
            "error",
          );
        }
      }

      function closePreviewDocModal() {
        closeModal("previewDocModal", "previewDocModalContent");
      }

      // 🖨️ คัดลอกเนื้อหาเอกสารจาก Preview ไปวางใน #printArea แล้วค่อยสั่งพิมพ์
      // (ทำแบบนี้เพราะ modal ซ้อนอยู่ลึกในหน้าเว็บ ถ้าสั่งพิมพ์ตรงๆ จะโดนพื้นที่ของ element อื่นที่ถูกซ่อนไว้แต่ยังกินพื้นที่หน้าอยู่ ทำให้หน้าว่างเปล่า)
      function printPreviewDocument() {
        const paper = document.getElementById("previewDocPaper");
        const printArea = document.getElementById("printArea");
        if (paper && printArea) {
          printArea.innerHTML = paper.innerHTML;
        }
        window.print();
      }

      // สร้างหน้ากระดาษเอกสารสำหรับดูตัวอย่าง/พิมพ์ (รูปแบบใบขอสลับสินค้าจริง)
      function renderPreviewPaper(doc) {
        const paper = document.getElementById("previewDocPaper");
        if (!paper) return;

        const products =
          doc.products && doc.products.length > 0 ? doc.products : [];
        const rows =
          products
            .map(
              (p, i) => `
        <tr>
            <td class="border border-slate-300 px-4 py-3 text-xs text-center text-slate-500">${i + 1}</td>
            <td class="border border-slate-300 px-4 py-3 text-xs font-mono break-words">${p.prodCode || p.prod_code || "-"}</td>
            <td class="border border-slate-300 px-4 py-3 text-xs break-words">${p.description || "-"}</td>
            <td class="border border-slate-300 px-4 py-3 text-xs text-right whitespace-nowrap">${p.qtyIn ?? p.qty_in ?? 0} ${p.unitIn || p.unit_in || ""}</td>
            <td class="border border-slate-300 px-4 py-3 text-xs text-right whitespace-nowrap">${p.qtyOut ?? p.qty_out ?? 0} ${p.unitOut || p.unit_out || ""}</td>
            <td class="border border-slate-300 px-4 py-3 text-xs text-right whitespace-nowrap">${(p.price ?? 0).toLocaleString ? (p.price ?? 0).toLocaleString() : (p.price ?? 0)}</td>
        </tr>
    `,
            )
            .join("") ||
          `<tr><td colspan="6" class="border border-slate-300 px-4 py-6 text-center text-slate-400">ไม่มีรายการสินค้า</td></tr>`;

        const sigBlock = (label, name, sigImg) => `
        <div class="flex-1 text-center space-y-1.5">
            <div class="h-16 flex items-end justify-center">
                ${sigImg ? `<img src="${sigImg}" class="max-h-[64px] mx-auto">` : ""}
            </div>
            <p class="text-sm font-medium text-slate-800">${name || "....................................."}</p>
            <div class="border-t border-slate-400 pt-1.5">
                <p class="text-xs text-slate-500">${label}</p>
            </div>
        </div>
    `;

        paper.innerHTML = `
        <div class="flex items-start justify-between border-b-2 border-slate-800 pb-6 mb-8">
            <div>
                <p class="text-sm font-bold text-orange-600 uppercase tracking-wider">KTW GROUP</p>
                <p class="text-sm text-slate-500 mt-0.5">บริษัท เกรียงไทยวัฒนากรุ๊ป</p>
                <h2 class="text-2xl font-bold mt-3">ใบขอสลับสินค้า / เบิกอะไหล่</h2>
            </div>
            <div class="text-right text-sm text-slate-500 shrink-0">
                <p>F-14-E05 แก้ไขครั้งที่ 01</p>
                <p class="mt-0.5">Movement Type 309, 921, 922</p>
            </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-6 text-sm mb-8">
            <div><p class="text-slate-400">เลขที่เอกสาร</p><p class="font-mono font-bold text-base mt-0.5">${doc.documentId}</p></div>
            <div><p class="text-slate-400">วันที่</p><p class="font-semibold text-base mt-0.5">${formatThaiDate(doc.date)}</p></div>
            <div><p class="text-slate-400">วัตถุประสงค์</p><p class="font-semibold text-base mt-0.5">${purposeLabel(doc.purpose, doc.purposeDes)}</p></div>
        </div>

        <div class="overflow-x-auto mb-8 rounded-lg border border-slate-300">
            <table class="w-full border-collapse text-sm" style="table-layout: fixed;">
                <colgroup>
                    <col style="width: 6%;">
                    <col style="width: 16%;">
                    <col style="width: 34%;">
                    <col style="width: 14%;">
                    <col style="width: 14%;">
                    <col style="width: 16%;">
                </colgroup>
                <thead>
                    <tr class="bg-slate-100">
                        <th class="border border-slate-300 px-3 py-2 text-center text-[11px] font-semibold">No.</th>
                        <th class="border border-slate-300 px-3 py-2 text-center text-[11px] font-semibold">รหัสสินค้า</th>
                        <th class="border border-slate-300 px-3 py-2 text-center text-[11px] font-semibold">รายละเอียดสินค้า</th>
                        <th class="border border-slate-300 px-3 py-2 text-center text-[11px] font-semibold">จำนวนเข้า</th>
                        <th class="border border-slate-300 px-3 py-2 text-center text-[11px] font-semibold">จำนวนออก</th>
                        <th class="border border-slate-300 px-3 py-2 text-center text-[11px] font-semibold">ราคา/หน่วย</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>

        <div class="text-sm mb-6"><span class="text-slate-400">หมายเหตุ:</span> <span class="font-medium">${doc.remark || "-"}</span></div>

        <!-- กล่องความเห็นประกอบการอนุมัติ — โชว์เฉพาะตอนดู Preview บนหน้าจอ ไม่ต้องออกมาตอนพิมพ์เอกสารจริง -->
        <div class="no-print grid grid-cols-1 sm:grid-cols-2 gap-4 mb-10">
            <div class="border border-slate-200 rounded-lg p-4 bg-slate-50">
                <p class="text-xs text-slate-400 mb-1">ความเห็นจาก ผู้บริหารอนุมัติ</p>
                <p class="text-sm font-medium">${doc.approverComment || doc.approver_comment || "-"}</p>
            </div>
            <div class="border border-slate-200 rounded-lg p-4 bg-slate-50">
                <p class="text-xs text-slate-400 mb-1">ความเห็นจาก SCM (Inventory Control)</p>
                <p class="text-sm font-medium">${doc.scmComment || doc.scm_comment || "-"}</p>
            </div>
        </div>

        <!-- ข้อมูลรับเข้าคลัง (SCM กรอกตอนอนุมัติขั้นสุดท้าย)
             ขึ้นทั้งใน Preview และเอกสารที่พิมพ์ — ไม่ใส่ no-print
             โชว์เฉพาะเอกสารที่ SCM กรอกอย่างน้อย 1 ช่อง -->
        ${
          doc.odoNo || doc.inboundDocMcm || doc.inboundDocSpm
            ? `
        <div class="border border-slate-300 rounded-lg mb-8">
            <div class="px-4 py-2 border-b border-slate-300 bg-slate-50 text-[11px] font-semibold text-slate-600">ข้อมูลรับเข้าคลัง (บันทึกโดยเจ้าหน้าที่แผนก SCM)</div>
            <div class="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
                <div class="px-4 py-3">
                    <p class="text-[11px] text-slate-400">เลข ODO</p>
                    <p class="font-mono font-semibold text-sm mt-0.5">${doc.odoNo || "-"}</p>
                </div>
                <div class="px-4 py-3">
                    <p class="text-[11px] text-slate-400">Inbound (MCM - คลังเครื่อง)</p>
                    <p class="font-mono font-semibold text-sm mt-0.5">${doc.inboundDocMcm || "-"}</p>
                    <p class="text-[11px] text-slate-500 mt-0.5">${doc.mcmNotifyName || "-"}</p>
                </div>
                <div class="px-4 py-3">
                    <p class="text-[11px] text-slate-400">Inbound (SPM - คลังอะไหล่)</p>
                    <p class="font-mono font-semibold text-sm mt-0.5">${doc.inboundDocSpm || "-"}</p>
                    <p class="text-[11px] text-slate-500 mt-0.5">${doc.spmNotifyName || "-"}</p>
                </div>
            </div>
        </div>`
            : ""
        }

        <div class="flex flex-col sm:flex-row gap-8 sm:gap-4 pt-6">
            ${sigBlock("ผู้ขออนุมัติสลับสินค้า", doc.preparedBy || doc.emp_name)}
            ${sigBlock("ผู้บริหาร", doc.approvedBy || doc.emp_approve)}
            ${sigBlock("เจ้าหน้าที่แผนก SCM", doc.scmControl || doc.scm_approve)}
        </div>
    `;
      }

      // ✏️ ฟังก์ชัน Edit (ดึงข้อมูลแก้ไขจาก SQL ผ่าน n8n)
      async function editDocument(docId) {
        // 🔒 เช็คสิทธิ์ซ้ำอีกชั้นก่อนเปิดฟอร์มแก้ไข (กันกรณีเรียกฟังก์ชันตรงๆ ข้ามปุ่มที่ถูกล็อกไว้)
        const historyForCheck = JSON.parse(
          localStorage.getItem("ktw_swap_history") || "[]",
        );
        const docForCheck = historyForCheck.find(
          (item) => item.documentId === docId,
        );
        if (docForCheck && !canEditDocument(docForCheck)) {
          showNotification(
            "ไม่มีสิทธิ์แก้ไข",
            `คุณไม่มีสิทธิ์แก้ไขเอกสารเลขที่ ${docId} เนื่องจากไม่ใช่ผู้สร้างเอกสารนี้`,
            "error",
          );
          return;
        }

        showNotification(
          "กำลังดึงข้อมูล",
          "กำลังดึงรายละเอียดข้อมูลที่เกี่ยวข้องเพื่อแก้ไข...",
          "warning",
        );

        // 🔧 ใช้ POST + body แบบเดียวกับ Display (ของเดิมใช้ GET + query string ซึ่งอาจไม่ตรงกับ n8n webhook ที่ตั้งไว้)
        const webhookUrl = `https://n8n.ktw.co.th/webhook/GetDocumentDetail-KTW-switching-system`;

        try {
          const response = await n8nFetch(webhookUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({ documentId: docId }),
          });

          if (response.ok) {
            const raw = await response.json();
            const doc = mapRawDocToFormDoc(raw, docId);

            editMode = true;
            editingDocId = docId;

            loadDocumentToForm(doc);

            document.getElementById("formModalTitle").textContent =
              `แก้ไขเอกสารใบขออนุมัติสลับสินค้า (${docId})`;
            document.getElementById("formModeBadge").textContent =
              " · โหมดแก้ไขเอกสาร";
            document.getElementById("submitBtnText").textContent =
              "บันทึกการแก้ไขเอกสาร";
            setFormFieldsReadonly(false);
            setPreparedByLocked(true);

            openModal("swapFullscreenModal", "swapModalContent");
          } else {
            throw new Error(`Server returned status: ${response.status}`);
          }
        } catch (error) {
          console.error("Fetch SQL Document to edit error:", error);
          showNotification(
            "ดึงข้อมูลจำลองบนเครื่อง",
            "ไม่สามารถต่อฐานข้อมูลหลักเพื่อแก้ไขได้ ระบบเปิดสิทธิ์แก้ไขข้อมูลสำรองบนบราวเซอร์ให้ชั่วคราว",
            "warning",
          );

          const history = JSON.parse(
            localStorage.getItem("ktw_swap_history") || "[]",
          );
          const doc = history.find((item) => item.documentId === docId);
          if (doc) {
            editMode = true;
            editingDocId = docId;
            loadDocumentToForm(doc);
            document.getElementById("formModalTitle").textContent =
              `แก้ไขเอกสารใบขออนุมัติสลับสินค้า (${docId})`;
            document.getElementById("formModeBadge").textContent =
              " · โหมดแก้ไขเอกสาร (Local Backup)";
            document.getElementById("submitBtnText").textContent =
              "บันทึกการแก้ไขเอกสาร";
            setFormFieldsReadonly(false);
            setPreparedByLocked(true);
            openModal("swapFullscreenModal", "swapModalContent");
          }
        }
      }

      // ยัดข้อมูลใส่แบบฟอร์ม
      // เลือกชื่อใน Dropdown ให้ตรงกับข้อมูลเอกสารเดิม
      // ⚠️ เอกสารเก่าเก็บชื่อคนละรูปแบบกับ option (เช่น "10092 เขมจิรา รักสมยา" vs "เขมจิรา  รักสมยา")
      //    และ notify_emp_id เป็น NULL เพราะสร้างก่อนมี Column นี้
      //    จึงต้องไล่จับคู่หลายทาง: EmpId → Email → ชื่อแบบ normalize
      function selectRoleOption(selectId, empIdInputId, emailInputId, doc) {
        const sel = document.getElementById(selectId);
        const empIdEl = document.getElementById(empIdInputId);
        const emailEl = document.getElementById(emailInputId);
        if (!sel) return;

        // ถ้า Dropdown ยังโหลดไม่เสร็จ (มีแค่ option ว่าง) ให้รอแล้วค่อยลองใหม่
        // กันกรณีผู้ใช้กดแก้ไขเอกสารเร็วกว่าที่ get_swap_role_members จะตอบกลับ
        if (sel.options.length <= 1) {
          setTimeout(
            () => selectRoleOption(selectId, empIdInputId, emailInputId, doc),
            400,
          );
          return;
        }

        const wantEmpId = String(doc.empId || "").trim();
        const wantEmail = String(doc.email || "").trim().toLowerCase();
        // ตัดรหัสพนักงานนำหน้า, คำนำหน้า "คุณ" และยุบช่องว่างซ้ำ เพื่อเทียบชื่อแบบหลวมๆ
        const normalizeName = (s) =>
          String(s || "")
            .replace(/^\s*\d+\s*/, "")
            .replace(/^\s*คุณ\s*/, "")
            .replace(/\s+/g, " ")
            .trim();
        const wantName = normalizeName(doc.name);

        let matched = null;
        for (const opt of sel.options) {
          if (!opt.value) continue;
          const optEmpId = (opt.getAttribute("data-emp-id") || "").trim();
          const optEmail = (opt.getAttribute("data-email") || "")
            .trim()
            .toLowerCase();
          if (wantEmpId && optEmpId === wantEmpId) { matched = opt; break; }
          if (!matched && wantEmail && optEmail === wantEmail) matched = opt;
          if (!matched && wantName && normalizeName(opt.value) === wantName)
            matched = opt;
        }

        if (matched) {
          sel.value = matched.value;
          if (empIdEl) empIdEl.value = matched.getAttribute("data-emp-id") || "";
          // ใช้อีเมลที่บันทึกไว้ในเอกสารก่อน (แก้อีเมลต่อเอกสารได้) ถ้าไม่มีค่อยใช้อีเมลตามรายชื่อพนักงาน
          if (emailEl)
            emailEl.value =
              String(doc.email || "").trim() ||
              matched.getAttribute("data-email") ||
              "";
        } else {
          // จับคู่ไม่ได้ — เว้นว่างให้ผู้ใช้เลือกใหม่ แต่คงอีเมลเดิมไว้เป็นข้อมูลอ้างอิง
          sel.value = "";
          if (empIdEl) empIdEl.value = "";
          if (emailEl) emailEl.value = doc.email || "";
        }
      }

      function loadDocumentToForm(doc) {
        document.getElementById("docId").value = doc.documentId;
        document.getElementById("docDate").value = doc.date;
        document.getElementById("remark").value = doc.remark || "";
        document.getElementById("preparedBy").value = doc.preparedBy;
        document.getElementById("preparedByEmail").value =
          doc.preparedByEmail || "";
        selectRoleOption("scmControl", "scmControlEmpId", "scmControlEmail", {
          empId: doc.scmControlEmpId,
          email: doc.scmControlEmail,
          name: doc.scmControl,
        });

        // ⚠️ เอกสาร Fast-track เก็บ approvedBy เป็นข้อความ "ข้ามขั้นตอนผู้บริหาร (Fast-track)"
        //    ซึ่งไม่มีใน Dropdown — ต้องเว้นว่างไว้ให้ผู้ใช้เลือกใหม่ ไม่งั้น select จะกลายเป็นค่าว่างเงียบๆ
        const isFastTrackDoc = doc.skipApprover === true;
        if (isFastTrackDoc) {
          document.getElementById("approvedBy").value = "";
          document.getElementById("approvedByEmpId").value = "";
          document.getElementById("approvedByEmail").value =
            doc.approvedByEmail || "";
        } else {
          selectRoleOption("approvedBy", "approvedByEmpId", "approvedByEmail", {
            empId: doc.approvedByEmpId,
            email: doc.approvedByEmail,
            name: doc.approvedBy,
          });
        }

        // ==== เอกสารแนบ + Fast-track ====
        const hasAtt = doc.hasAttachment === true;
        const radioAtt = document.querySelector(
          `input[name="hasAttachmentRadio"][value="${hasAtt ? "1" : "0"}"]`,
        );
        if (radioAtt) radioAtt.checked = true;
        onAttachmentToggle(hasAtt);

        if (hasAtt && doc.attachmentFileName) {
          // ไฟล์เดิมที่เคยอัปโหลดไว้ — ยังไม่ต้องส่ง Base64 ซ้ำจนกว่าผู้ใช้จะเลือกไฟล์ใหม่
          keepExistingAttachment = true;
          attachmentData = { base64: "", fileName: "", fileType: "" };
          // เก็บไฟล์เดิมไว้ให้ปุ่ม "เปิดดู/ดาวน์โหลด" ใช้ (ไม่ใช้ attachmentData เพราะนั่นสำหรับไฟล์ที่เพิ่งเลือกใหม่)
          existingAttachment = {
            base64: doc.attachmentBase64 || "",
            fileName: doc.attachmentFileName || "",
            fileType: doc.attachmentFileType || "",
          };
          document.getElementById("attachmentCurrentName").textContent =
            `ไฟล์เดิม: ${doc.attachmentFileName}`;
          document
            .getElementById("attachmentCurrentInfo")
            .classList.remove("hidden");
          document
            .getElementById("attachmentExistingActions")
            .classList.toggle("hidden", !doc.attachmentBase64);
        } else {
          existingAttachment = { base64: "", fileName: "", fileType: "" };
          document
            .getElementById("attachmentExistingActions")
            .classList.add("hidden");
        }

        const skipChk = document.getElementById("skipApprover");
        if (skipChk) skipChk.checked = isFastTrackDoc;
        lucide.createIcons();

        // แสดงรูปลายเซ็นจริง (ถ้ามีข้อมูลมาด้วย) — ซ่อนไว้ถ้ายังไม่มีใครเซ็น
        const scmSigBox = document.getElementById("scmSignatureBox");
        const scmSigImg = document.getElementById("scmSignatureImage");
        if (doc.scmSignature) {
          scmSigImg.src = doc.scmSignature;
          scmSigBox.classList.remove("hidden");
        } else {
          scmSigImg.src = "";
          scmSigBox.classList.add("hidden");
        }

        const approvedSigBox = document.getElementById("approvedSignatureBox");
        const approvedSigImg = document.getElementById(
          "approvedSignatureImage",
        );
        if (doc.approvedSignature) {
          approvedSigImg.src = doc.approvedSignature;
          approvedSigBox.classList.remove("hidden");
        } else {
          approvedSigImg.src = "";
          approvedSigBox.classList.add("hidden");
        }

        const statusEl = document.getElementById("docStatus");
        if (statusEl) statusEl.value = doc.status || "รอการอนุมัติ";

        // เอกสารเก่าที่เป็น 921 หรือ 922 → เลือกตัวเลือก 921-922 แทน (ไม่มีตัวเลือกแยกแล้ว)
        const docPurpose = ["921", "922"].includes(String(doc.purpose)) ? "921-922" : String(doc.purpose);
        const radios = document.getElementsByName("purpose");
        radios.forEach((radio) => {
          if (radio.value === docPurpose) {
            radio.checked = true;
          }
        });

        const tbody = document.getElementById("productTableBody");
        tbody.innerHTML = "";

        if (doc.products && doc.products.length > 0) {
          doc.products.forEach((prod) => {
            addProductRow(prod);
          });
        } else {
          addSampleRows();
        }
      }

      // 🌿 ฟังก์ชันแสดง Docflow (เส้นทางเอกสาร)
      async function showDocFlow(docId) {
        // เปิด Modal ก่อนแสดง loading
        const docFlowContent = document.getElementById("docFlowContent");
        docFlowContent.innerHTML = `
        <div class="flex flex-col items-center justify-center py-8 gap-3 text-slate-400">
            <svg class="animate-spin h-6 w-6 text-brand-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span class="text-sm">กำลังดึงข้อมูล Docflow จาก SQL...</span>
        </div>`;
        openModal("docFlowModal", "docFlowModalContent");

        const webhookUrl =
          "https://n8n.ktw.co.th/webhook/get_docflow_swap_product";

        let doc = null;
        let logs = [];
        try {
          const response = await n8nFetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ documentId: docId }),
          });
          if (response.ok) {
            const raw = await response.json();
            const data = Array.isArray(raw) ? raw[0] : raw;
            // Map field จาก SQL → format ที่ใช้ใน Docflow
            doc = {
              documentId: data.documentId ?? data.doc_id ?? docId,
              date: data.date ?? data.crdate ?? "",
              status: data.status ?? data.status_doc ?? "รอการอนุมัติ",
              preparedBy: data.preparedBy ?? data.emp_name ?? "",
              preparedEmail: data.preparedEmail ?? data.emp_email ?? "",
              scmControl: data.scmControl ?? data.scm_approve ?? "",
              scmDate: data.scmDate ?? data.scm_date ?? "",
              approvedBy: data.approvedBy ?? data.emp_approve ?? "",
              approveDate: data.approveDate ?? data.approve_date ?? "",
              rejectReason: data.rejectReason ?? data.reject_reason ?? "",
            };
            // ประวัติเพิ่มเติมจากตาราง audit_log (module = 'SwapDocument')
            logs = Array.isArray(data.logs)
              ? data.logs.filter((l) => l && l.log_time)
              : [];
          }
        } catch (err) {
          console.error("Docflow webhook error:", err);
        }

        // Fallback: ดึงจาก localStorage ถ้า N8n ไม่ตอบ
        if (!doc) {
          const history = JSON.parse(
            localStorage.getItem("ktw_swap_history") || "[]",
          );
          const local = history.find((item) => item.documentId === docId);
          if (local) {
            doc = {
              documentId: local.documentId,
              date: local.date,
              status: local.status || "รอการอนุมัติ",
              preparedBy: local.preparedBy,
              preparedEmail: local.preparedByEmail || "",
              scmControl: local.scmControl || "",
              scmDate: "",
              approvedBy: local.approvedBy || "",
              approveDate: "",
            };
          }
        }

        if (!doc) {
          docFlowContent.innerHTML = `<p class="text-center text-sm text-slate-400 py-6">ไม่พบข้อมูลเอกสาร</p>`;
          return;
        }

        // กำหนดสีและไอคอนตาม status
        const statusMap = {
          รอการอนุมัติ: { color: "bg-amber-500", icon: "clock" },
          SCMอนุมัติแล้ว: { color: "bg-blue-500", icon: "check" },
          อนุมัติแล้ว: { color: "bg-emerald-500", icon: "check-circle" },
          เสร็จสิ้น: { color: "bg-emerald-600", icon: "check-circle-2" },
          ยกเลิก: { color: "bg-red-500", icon: "x-circle" },
        };
        const currentStatus = doc.status || "รอการอนุมัติ";

        const step1Done = true;
        // ต้องใช้กติกาเดียวกับ getHistoryDisplayStatus() เสมอ — Fast-track ถือว่าผ่านขั้นผู้บริหารแล้ว
        const step2Done =
          currentStatus === "รอ SCM อนุมัติ" ||
          doc.skipApprover === true ||
          Number(doc.skipApprover) === 1 ||
          (!!doc.approvedBy &&
            (currentStatus.includes("อนุมัติแล้ว") ||
              currentStatus.includes("เสร็จสิ้น")));
        const step3Done =
          !!doc.scmControl &&
          (currentStatus.includes("เสร็จสิ้น") ||
            (currentStatus.toLowerCase().includes("scm") &&
              currentStatus.includes("อนุมัติแล้ว")));

        const stepStyle = (done, pending) =>
          done
            ? "bg-emerald-500 text-white"
            : pending
              ? "bg-amber-400 text-white"
              : "bg-slate-200 text-slate-400";
        const stepIcon = (done) => (done ? "check" : "minus");

        // สร้างรายการ "ประวัติเพิ่มเติม" จาก audit_log (เรียงล่าสุดก่อน เพราะ query ORDER BY log_time DESC มาแล้ว)
        const logsHtml = logs
          .map(
            (log) => `
        <div class="flex items-start gap-2.5">
            <div class="w-1.5 h-1.5 rounded-full bg-brand-500 mt-1.5 shrink-0"></div>
            <div>
                <p class="text-sm font-medium text-slate-700">${log.description || log.action_type || ""}</p>
                <p class="text-xs text-slate-400">${log.actor_name || ""} • ${formatThaiDateTime(log.log_time)}</p>
            </div>
        </div>`,
          )
          .join("");

        docFlowContent.innerHTML = `
        <div class="space-y-4">
            <div class="flex items-center justify-between mb-2">
                <span class="text-sm font-bold text-slate-400 uppercase tracking-wider">เลขที่เอกสาร</span>
                <span class="font-mono text-sm font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded">${doc.documentId}</span>
            </div>
            <div class="flex items-center justify-between mb-4">
                <span class="text-sm font-bold text-slate-400 uppercase tracking-wider">สถานะปัจจุบัน</span>
                <span class="inline-flex items-center px-2.5 py-1 rounded-lg text-sm font-bold
                    ${
                      currentStatus.includes("เสร็จสิ้น") ||
                      currentStatus.includes("อนุมัติแล้ว")
                        ? "bg-emerald-50 text-emerald-700 border border-emerald-100"
                        : currentStatus === "ยกเลิก" ||
                            currentStatus === "ถูกปฏิเสธ"
                          ? "bg-red-50 text-red-700 border border-red-100"
                          : "bg-amber-50 text-amber-700 border border-amber-100"
                    }">
                    ${currentStatus}
                </span>
            </div>

            <div class="relative pl-7 border-l-2 border-slate-200 space-y-6">

                <!-- Step 1: ผู้จัดทำ -->
                <div class="relative">
                    <span class="absolute -left-[29px] top-0.5 flex h-5 w-5 items-center justify-center rounded-full ${stepStyle(step1Done, false)} ring-4 ring-white">
                        <i data-lucide="check" class="w-3 h-3"></i>
                    </span>
                    <div class="text-base font-bold text-slate-800">1. ผู้จัดทำเอกสาร</div>
                    <div class="text-sm text-slate-500 mt-0.5">${doc.preparedBy || "—"}</div>
                    <div class="text-xs text-slate-400">${doc.preparedEmail || ""}</div>
                    <div class="text-xs text-emerald-600 font-semibold mt-1">✓ จัดทำเมื่อ ${formatThaiDate(doc.date)}</div>
                </div>

                <!-- Step 2: ผู้บริหารอนุมัติ -->
                <div class="relative">
                    <span class="absolute -left-[29px] top-0.5 flex h-5 w-5 items-center justify-center rounded-full ${currentStatus === "ถูกปฏิเสธ" ? "bg-red-500 text-white" : stepStyle(step2Done, !step2Done && currentStatus === "รอการอนุมัติ")} ring-4 ring-white">
                        <i data-lucide="${currentStatus === "ถูกปฏิเสธ" ? "x" : stepIcon(step2Done)}" class="w-3 h-3"></i>
                    </span>
                    <div class="text-base font-bold text-slate-800">2. ผู้บริหารอนุมัติ</div>
                    <div class="text-sm text-slate-500 mt-0.5">${doc.approvedBy || (currentStatus === "ยกเลิก" ? "—" : "รอการอนุมัติ")}</div>
                    ${
                      currentStatus === "ยกเลิก"
                        ? `<div class="text-xs text-slate-400 font-semibold mt-1">— เอกสารถูกยกเลิก ไม่มีการดำเนินการต่อ</div>`
                        : currentStatus === "ถูกปฏิเสธ"
                        ? `<div class="text-xs text-red-600 font-semibold mt-1">✕ ปฏิเสธเอกสารนี้${doc.rejectReason ? ": " + doc.rejectReason : ""}</div>`
                        : doc.approveDate
                          ? `<div class="text-xs text-emerald-600 font-semibold mt-1">✓ อนุมัติเมื่อ ${formatThaiDateTimeLong(doc.approveDate)}</div>`
                          : `<div class="text-xs text-amber-500 font-semibold mt-1">⏳ รอดำเนินการ</div>`
                    }
                </div>

                <!-- Step 3: SCM อนุมัติขั้นสุดท้าย -->
                <div class="relative">
                    <span class="absolute -left-[29px] top-0.5 flex h-5 w-5 items-center justify-center rounded-full ${stepStyle(step3Done, false)} ring-4 ring-white">
                        <i data-lucide="${stepIcon(step3Done)}" class="w-3 h-3"></i>
                    </span>
                    <div class="text-base font-bold text-slate-800">3. SCM อนุมัติขั้นสุดท้าย (Inventory Control)</div>
                    <div class="text-sm text-slate-500 mt-0.5">${doc.scmControl || "รอการอนุมัติ"}</div>
                    ${doc.scmDate ? `<div class="text-xs text-emerald-600 font-semibold mt-1">✓ อนุมัติเมื่อ ${formatThaiDateTimeLong(doc.scmDate)}</div>` : `<div class="text-xs text-slate-400 font-semibold mt-1">— ยังไม่ดำเนินการ</div>`}
                </div>

            </div>

            ${
              logsHtml
                ? `
            <div class="pt-3 border-t border-slate-100 space-y-2.5">
                <h4 class="text-xs font-bold text-slate-400 uppercase tracking-wider">ประวัติเพิ่มเติม</h4>
                ${logsHtml}
            </div>`
                : ""
            }
        </div>
    `;
        lucide.createIcons();
      }

      function closeDocFlowModal() {
        closeModal("docFlowModal", "docFlowModalContent");
      }

      // 🗑️ เปิด Modal ยืนยันการลบเอกสาร
      function openDeleteDocModal(docId) {
        document.getElementById("deleteDocIdDisplay").textContent = docId;
        const confirmBtn = document.getElementById("confirmDeleteDocBtn");

        confirmBtn.onclick = function () {
          deleteDocument(docId);
        };

        openModal("deleteDocModal", "deleteDocModalContent");
      }

      function closeDeleteDocModal() {
        closeModal("deleteDocModal", "deleteDocModalContent");
      }

      // ทำการลบเอกสารและอัปเดตตาราง
      async function deleteDocument(docId) {
        const confirmBtn = document.getElementById("confirmDeleteDocBtn");
        confirmBtn.disabled = true;
        confirmBtn.textContent = "กำลังลบ...";

        const webhookUrl =
          "https://n8n.ktw.co.th/webhook/delete_doc_swap_product";

        // แนบข้อมูลผู้ทำรายการไปด้วยเสมอ (จำเป็นสำหรับบันทึก audit_log ฝั่ง n8n ว่า "ใครเป็นคนลบ")
        const payload = {
          documentId: docId,
          actorEmpId: sessionStorage.getItem("emp_id") || "",
          actorName: sessionStorage.getItem("name") || "",
          actorEmail: sessionStorage.getItem("email") || "",
        };

        try {
          const response = await n8nFetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });

          const result = await response.json().catch(() => ({}));
          if (!response.ok || result.success === false) {
            throw new Error(extractErrorMessage(result));
          }

          // ลบสำเร็จจริงในฐานข้อมูลแล้ว จึงค่อยลบออกจาก local cache/หน้าจอ
          const history = JSON.parse(
            localStorage.getItem("ktw_swap_history") || "[]",
          );
          const updatedHistory = history.filter(
            (item) => item.documentId !== docId,
          );
          localStorage.setItem(
            "ktw_swap_history",
            JSON.stringify(updatedHistory),
          );

          showNotification(
            "ลบสำเร็จ",
            `ลบเอกสารใบสลับสินค้าเลขที่ ${docId} ออกจากระบบเรียบร้อยแล้ว`,
            "warning",
          );
          closeDeleteDocModal();
          renderHistoryTable();
        } catch (error) {
          console.error("Delete webhook error:", error);
          // ไม่ลบข้อมูลออกจาก local cache/หน้าจอ เพราะยังไม่ยืนยันว่าลบสำเร็จจริงในฐานข้อมูล
          showNotification("ลบไม่สำเร็จ", error.message, "error");
        } finally {
          confirmBtn.disabled = false;
          confirmBtn.textContent = "ยืนยันการลบ";
        }
      }

      // ================= 🆕 30/09/2569 : ADMIN REVERT STAGE (SWAP) =================
      // ปุ่ม Admin ถอยสถานะเอกสาร — ใช้แก้เอกสารที่หน้างานระบุ Fast Track ผิด หรือกดอนุมัติผิดขั้น
      // แล้วติดค้างจนแก้ไข/ลบไม่ได้อีก (canEditDocument/canDeleteDocument ล็อกไว้หลัง stage แรกเสมอ)
      function openAdminRevertSwapModal(docId) {
        document.getElementById("adminRevertSwapDocIdDisplay").textContent = docId;
        document.getElementById("adminRevertSwapReason").value = "";
        document.getElementById("adminRevertSwapResetFastTrack").checked = false;
        const waitingRadio = document.querySelector(
          'input[name="adminRevertSwapTargetStage"][value="waiting"]',
        );
        if (waitingRadio) waitingRadio.checked = true;
        toggleAdminRevertSwapFastTrackOption();

        const confirmBtn = document.getElementById("confirmAdminRevertSwapBtn");
        confirmBtn.onclick = function () {
          adminRevertSwapStage(docId);
        };

        openModal("adminRevertSwapModal", "adminRevertSwapModalContent");
      }

      function closeAdminRevertSwapModal() {
        closeModal("adminRevertSwapModal", "adminRevertSwapModalContent");
      }

      // เช็คบ็อกซ์ "รีเซ็ต Fast Track" มีความหมายเฉพาะตอนถอยกลับไป "รอผู้บริหารอนุมัติ" เท่านั้น
      // (ถอยไปแค่ "รอ SCM อนุมัติ" แปลว่ายังคงผ่านขั้นผู้บริหารอยู่ ไม่เกี่ยวกับ Fast Track)
      function toggleAdminRevertSwapFastTrackOption() {
        const wrap = document.getElementById("adminRevertSwapFastTrackWrap");
        const selected = document.querySelector(
          'input[name="adminRevertSwapTargetStage"]:checked',
        );
        const isWaiting = selected && selected.value === "waiting";
        if (wrap) wrap.classList.toggle("hidden", !isWaiting);
        if (!isWaiting) {
          const chk = document.getElementById("adminRevertSwapResetFastTrack");
          if (chk) chk.checked = false;
        }
      }

      async function adminRevertSwapStage(docId) {
        const reasonEl = document.getElementById("adminRevertSwapReason");
        const reason = reasonEl.value.trim();
        if (!reason) {
          showNotification(
            "กรุณาระบุเหตุผล",
            "ต้องระบุเหตุผลในการถอยสถานะเอกสารทุกครั้ง",
            "warning",
          );
          reasonEl.focus();
          return;
        }

        const targetStageEl = document.querySelector(
          'input[name="adminRevertSwapTargetStage"]:checked',
        );
        const targetStage = targetStageEl ? targetStageEl.value : "waiting";
        const resetFastTrack =
          document.getElementById("adminRevertSwapResetFastTrack").checked;

        const confirmBtn = document.getElementById("confirmAdminRevertSwapBtn");
        confirmBtn.disabled = true;
        confirmBtn.textContent = "กำลังถอยสถานะ...";

        const webhookUrl =
          "https://n8n.ktw.co.th/webhook/admin_revert_stage_swap";

        const payload = {
          docId: docId,
          targetStage: targetStage,
          resetFastTrack: resetFastTrack,
          reason: reason,
          actionByEmpId: sessionStorage.getItem("emp_id") || "",
          actionByName: sessionStorage.getItem("name") || "",
        };

        try {
          const response = await n8nFetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });

          const result = await response.json().catch(() => ({}));
          if (!response.ok || result.success === false) {
            throw new Error(extractErrorMessage(result));
          }

          showNotification(
            "ถอยสถานะสำเร็จ",
            `ถอยสถานะเอกสารเลขที่ ${docId} เรียบร้อยแล้ว`,
            "success",
          );
          closeAdminRevertSwapModal();
          await syncHistoryStatuses();
        } catch (error) {
          console.error("Admin revert stage webhook error:", error);
          showNotification("ถอยสถานะไม่สำเร็จ", error.message, "error");
        } finally {
          confirmBtn.disabled = false;
          confirmBtn.textContent = "ยืนยันถอยสถานะ";
        }
      }

      // ================= 🆕 06/10/2569 : ยกเลิกเอกสาร (SWAP) =================
      // ผู้สร้างเอกสารหรือ Admin ยกเลิกได้เฉพาะสถานะ "รอ ผู้บริหาร อนุมัติ" — ยกเลิกแล้วถาวร ไม่ส่งอีเมลแจ้งใคร
      function openCancelDocModal(docId) {
        document.getElementById("cancelDocIdDisplay").textContent = docId;
        document.getElementById("cancelDocReason").value = "";

        const confirmBtn = document.getElementById("confirmCancelDocBtn");
        confirmBtn.onclick = function () {
          cancelDocument(docId);
        };

        openModal("cancelDocModal", "cancelDocModalContent");
      }

      function closeCancelDocModal() {
        closeModal("cancelDocModal", "cancelDocModalContent");
      }

      async function cancelDocument(docId) {
        const reasonEl = document.getElementById("cancelDocReason");
        const reason = reasonEl.value.trim();
        if (!reason) {
          showNotification(
            "กรุณาระบุเหตุผล",
            "ต้องระบุเหตุผลในการยกเลิกเอกสารทุกครั้ง",
            "warning",
          );
          reasonEl.focus();
          return;
        }

        // 🔒 เช็คสิทธิ์ซ้ำก่อนยิง webhook (กันเรียกฟังก์ชันตรงๆ ข้ามปุ่มที่ถูกซ่อนไว้)
        const historyForCheck = JSON.parse(
          localStorage.getItem("ktw_swap_history") || "[]",
        );
        const docForCheck = historyForCheck.find(
          (item) => item.documentId === docId,
        );
        if (docForCheck && !canCancelDocument(docForCheck)) {
          showNotification(
            "ไม่สามารถยกเลิกเอกสารได้",
            `เอกสารเลขที่ ${docId} ยกเลิกได้เฉพาะผู้สร้างเอกสารหรือ Admin และเฉพาะสถานะ "รอ ผู้บริหาร อนุมัติ"`,
            "error",
          );
          return;
        }

        const confirmBtn = document.getElementById("confirmCancelDocBtn");
        confirmBtn.disabled = true;
        confirmBtn.textContent = "กำลังยกเลิก...";

        const webhookUrl = "https://n8n.ktw.co.th/webhook/cancel_document_swap";

        const payload = {
          docId: docId,
          reason: reason,
          actionByEmpId: sessionStorage.getItem("emp_id") || "",
          actionByName: sessionStorage.getItem("name") || "",
        };

        try {
          const response = await n8nFetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });

          const result = await response.json().catch(() => ({}));
          if (!response.ok || result.success === false) {
            throw new Error(extractErrorMessage(result));
          }

          showNotification(
            "ยกเลิกเอกสารสำเร็จ",
            `ยกเลิกเอกสารเลขที่ ${docId} เรียบร้อยแล้ว`,
            "success",
          );
          closeCancelDocModal();
          await syncHistoryStatuses();
        } catch (error) {
          console.error("Cancel document webhook error:", error);
          showNotification("ยกเลิกเอกสารไม่สำเร็จ", error.message, "error");
        } finally {
          confirmBtn.disabled = false;
          confirmBtn.textContent = "ยืนยันยกเลิกเอกสาร";
        }
      }

      // ================= PRODUCT TABLE ROW CONTROLS =================

      // เพิ่มแถวรายการสินค้าแบบ Dynamic
      function addProductRow(data = {}) {
        const tbody = document.getElementById("productTableBody");
        if (!tbody) return;

        const rowCount = tbody.querySelectorAll(".product-row").length + 1;
        const tr = document.createElement("tr");
        tr.className = "product-row hover:bg-slate-50/30 transition-colors";

        tr.innerHTML = `
                <td class="p-4 text-center font-mono font-semibold bg-slate-50/50 text-slate-800 row-index">${rowCount}</td>
                <td class="p-2">
                    <input 
                        type="text" 
                        placeholder="เช่น M011-M9513B"
                        value="${data.prodCode || ""}"
                        class="prod-code flex h-10 w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-500 outline-none"
                    >
                </td>
                <td class="p-2">
                    <input 
                        type="text" 
                        placeholder="ระบุรายละเอียดของสินค้า"
                        value="${data.description || ""}"
                        class="prod-desc flex h-10 w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-500 outline-none text-center"
                    >
                </td>
                <td class="p-2">
                    <input 
                        type="number" 
                        min="0"
                        placeholder="0"
                        value="${data.qtyIn !== undefined ? data.qtyIn : ""}"
                        class="qty-in flex h-10 w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-right focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-500 outline-none"
                    >
                </td>
                <td class="p-2">
                    <input 
                        type="text" 
                        placeholder="หน่วยเข้า"
                        value="${data.unitIn || ""}"
                        class="unit-in flex h-10 w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-500 outline-none text-center"
                    >
                </td>
                <td class="p-2">
                    <input 
                        type="number" 
                        min="0"
                        placeholder="0"
                        value="${data.qtyOut !== undefined ? data.qtyOut : ""}"
                        class="qty-out flex h-10 w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-right focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-500 outline-none"
                    >
                </td>
                <td class="p-2">
                    <input 
                        type="text" 
                        placeholder="หน่วยออก"
                        value="${data.unitOut || ""}"
                        class="unit-out flex h-10 w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-500 outline-none text-center"
                    >
                </td>
                <td class="p-2">
                    <input 
                        type="number" 
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                        value="${data.price !== undefined ? data.price : ""}"
                        class="price flex h-10 w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-right focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-500 outline-none"
                    >
                </td>
                <td class="p-2 text-center manage-col-cell">
                    <button 
                        type="button" 
                        onclick="deleteProductRow(this)"
                        class="delete-row-btn h-8 w-8 rounded-lg border border-red-50 text-red-500 hover:bg-red-50 flex items-center justify-center transition-colors mx-auto shadow-xs active:scale-95"
                    >
                        <i data-lucide="trash-2" class="w-4 h-4"></i>
                    </button>
                </td>
            `;

        tbody.appendChild(tr);
        lucide.createIcons();
        reindexRows();
      }

      // ลบแถวรายการสินค้า
      function deleteProductRow(btn) {
        const row = btn.closest(".product-row");
        if (row) {
          row.remove();
          reindexRows();
        }
      }

      // จัดเรียงเลขแถวใหม่
      function reindexRows() {
        const rows = document.querySelectorAll(
          "#productTableBody .product-row",
        );
        rows.forEach((row, index) => {
          const indexCell = row.querySelector(".row-index");
          if (indexCell) {
            indexCell.textContent = index + 1;
          }
        });
      }

      // ================= AUTOCOMPLETE: ค้นหารหัสสินค้า (M011-...) จาก n8n Webhook =================

      let prodAutocompleteDebounceTimer = null;
      let prodAutocompleteAbortController = null;
      let activeAutocompleteInput = null;
      let currentAutocompleteItems = [];
      let currentAutocompleteHighlightIndex = -1;
      const PROD_AUTOCOMPLETE_MIN_CHARS = 1; // เริ่มค้นหาตั้งแต่พิมพ์ตัวอักษรแรก (ยืนยันกับโปรแกรมเมอร์แล้วว่า Webhook รองรับ + มี debounce 300ms กันยิงรัวอยู่แล้ว)
      const PROD_AUTOCOMPLETE_URL =
        "https://n8n.ktw.co.th/webhook/autocomplete";

      // ตั้งค่าสถานะสต๊อกให้แสดงเป็น badge สี
      const STOCK_STATUS_CONFIG = {
        inStock: {
          label: "มีสินค้า",
          class: "bg-emerald-50 text-emerald-600 border-emerald-100",
        },
        lowStock: {
          label: "ใกล้หมด",
          class: "bg-amber-50 text-amber-600 border-amber-100",
        },
        outOfStock: {
          label: "สินค้าหมด",
          class: "bg-red-50 text-red-500 border-red-100",
        },
      };

      // ดักฟัง event การพิมพ์/กดคีย์บอร์ดในตารางสินค้าแบบ Delegation (รองรับแถวที่เพิ่มเข้ามาใหม่ทีหลังด้วย)
      document.addEventListener("DOMContentLoaded", function () {
        const tbody = document.getElementById("productTableBody");
        if (tbody) {
          tbody.addEventListener("input", handleProdCodeInput);
          tbody.addEventListener("keydown", handleProdCodeKeydown);
          tbody.addEventListener("focusout", handleProdCodeFocusOut);
        }
      });

      // เมื่อพิมพ์ในช่องรหัสสินค้า: debounce แล้วค่อยยิง fetch ไปหา webhook
      function handleProdCodeInput(e) {
        if (!e.target.classList.contains("prod-code")) return;

        const input = e.target;
        activeAutocompleteInput = input;
        const query = input.value.trim();

        clearTimeout(prodAutocompleteDebounceTimer);

        if (query.length < PROD_AUTOCOMPLETE_MIN_CHARS) {
          closeProdAutocomplete();
          return;
        }

        prodAutocompleteDebounceTimer = setTimeout(() => {
          fetchProductAutocomplete(query, input);
        }, 300);
      }

      // ปิด dropdown เมื่อออกจากช่อง (หน่วงเวลาเล็กน้อยเพื่อให้ event คลิกเลือกรายการทำงานก่อน)
      function handleProdCodeFocusOut(e) {
        if (!e.target.classList.contains("prod-code")) return;
        setTimeout(() => {
          if (
            !document.activeElement ||
            !document.activeElement.closest("#prodAutocompleteDropdown")
          ) {
            closeProdAutocomplete();
          }
        }, 150);
      }

      // รองรับการเลือกด้วยคีย์บอร์ด (ลูกศรขึ้น/ลง, Enter, Esc)
      function handleProdCodeKeydown(e) {
        if (!e.target.classList.contains("prod-code")) return;
        const dropdown = document.getElementById("prodAutocompleteDropdown");
        if (!dropdown || dropdown.classList.contains("hidden")) return;

        const itemEls = dropdown.querySelectorAll(".autocomplete-item");
        if (itemEls.length === 0) return;

        if (e.key === "ArrowDown") {
          e.preventDefault();
          currentAutocompleteHighlightIndex = Math.min(
            currentAutocompleteHighlightIndex + 1,
            itemEls.length - 1,
          );
          updateAutocompleteHighlight(itemEls);
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          currentAutocompleteHighlightIndex = Math.max(
            currentAutocompleteHighlightIndex - 1,
            0,
          );
          updateAutocompleteHighlight(itemEls);
        } else if (e.key === "Enter") {
          if (currentAutocompleteHighlightIndex >= 0) {
            e.preventDefault();
            selectAutocompleteItemByIndex(currentAutocompleteHighlightIndex);
          }
        } else if (e.key === "Escape") {
          closeProdAutocomplete();
        }
      }

      function updateAutocompleteHighlight(itemEls) {
        itemEls.forEach((el, idx) => {
          if (idx === currentAutocompleteHighlightIndex) {
            el.classList.add("bg-orange-50");
            el.scrollIntoView({ block: "nearest" });
          } else {
            el.classList.remove("bg-orange-50");
          }
        });
      }

      // จัดตำแหน่ง dropdown ให้อยู่ใต้ช่อง input ที่กำลังพิมพ์อยู่พอดี (ใช้ position:fixed เหมือน filter dropdown อื่นในไฟล์นี้)
      function positionAutocompleteDropdown(input) {
        const dropdown = document.getElementById("prodAutocompleteDropdown");
        if (!dropdown) return;

        const rect = input.getBoundingClientRect();
        const dropdownWidth = Math.max(rect.width, 280);
        dropdown.style.width = dropdownWidth + "px";

        let left = rect.left;
        const maxLeft = window.innerWidth - dropdownWidth - 8;
        if (left > maxLeft) left = maxLeft;
        if (left < 8) left = 8;

        dropdown.style.left = left + "px";
        dropdown.style.top = rect.bottom + 4 + "px";
      }

      // ยิง fetch ไปหา n8n webhook เพื่อค้นหารหัสสินค้า
      async function fetchProductAutocomplete(query, input) {
        const dropdown = document.getElementById("prodAutocompleteDropdown");
        if (!dropdown) return;

        positionAutocompleteDropdown(input);
        dropdown.innerHTML = `<div class="p-3 text-center text-slate-400 flex items-center justify-center gap-2"><i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin"></i> กำลังค้นหา...</div>`;
        dropdown.classList.remove("hidden");
        lucide.createIcons();

        // ยกเลิกคำขอค้นหาก่อนหน้าที่ยังค้างอยู่ (กันกรณีพิมพ์เร็วแล้วผลลัพธ์เก่ามาทับผลลัพธ์ใหม่)
        if (prodAutocompleteAbortController) {
          prodAutocompleteAbortController.abort();
        }
        prodAutocompleteAbortController = new AbortController();

        try {
          const res = await n8nFetch(
            `${PROD_AUTOCOMPLETE_URL}?code=${encodeURIComponent(query)}`,
            {
              method: "GET",
              headers: {
                "content-type": "application/json; charset=utf-8",
              },
              signal: prodAutocompleteAbortController.signal,
            },
          );
          if (!res.ok) throw new Error("Server returned status: " + res.status);

          // อ่านเป็น text ก่อนแล้วค่อย parse เอง เพราะตอนไม่พบสินค้า Webhook จะตอบกลับเป็น "ค่าว่าง"
          // (อาจไม่ใช่ JSON array ที่ถูกต้องเสมอไป เช่น string ว่างเปล่า) ถ้าปล่อยให้ res.json() พังตรงนี้จะติด error ทันที
          const rawText = await res.text();
          let data = [];
          if (rawText && rawText.trim() !== "") {
            try {
              data = JSON.parse(rawText);
            } catch (parseErr) {
              data = []; // ตอบกลับมาไม่ใช่ JSON ที่ถูกต้อง ถือว่าไม่พบผลลัพธ์
            }
          }

          // กันกรณีผู้ใช้สลับไปโฟกัสช่องอื่นระหว่างที่รอผลลัพธ์อยู่
          if (activeAutocompleteInput !== input) return;

          renderAutocompleteResults(Array.isArray(data) ? data : [], input);
        } catch (err) {
          if (err.name === "AbortError") return;
          console.error("Autocomplete fetch error:", err);
          if (activeAutocompleteInput === input) {
            dropdown.innerHTML = `<div class="p-3 text-center text-red-500">ไม่สามารถเชื่อมต่อค้นหาสินค้าได้ กรุณาลองใหม่</div>`;
          }
        }
      }

      // เรนเดอร์รายการผลลัพธ์ autocomplete พร้อม badge สถานะสต๊อก
      function renderAutocompleteResults(items, input) {
        const dropdown = document.getElementById("prodAutocompleteDropdown");
        if (!dropdown) return;

        currentAutocompleteItems = items;
        currentAutocompleteHighlightIndex = -1;

        if (items.length === 0) {
          dropdown.innerHTML = `<div class="p-3 text-center text-slate-400">ไม่พบรหัสสินค้าที่ตรงกับคำค้นหา</div>`;
          return;
        }

        dropdown.innerHTML = items
          .map((item, idx) => {
            const status = STOCK_STATUS_CONFIG[item.stockstatus] || {
              label: item.stockstatus || "-",
              class: "bg-slate-50 text-slate-500 border-slate-100",
            };
            return `
                    <button 
                        type="button"
                        onmousedown="event.preventDefault()"
                        onclick="selectAutocompleteItemByIndex(${idx})"
                        class="autocomplete-item w-full text-left px-3 py-2 hover:bg-orange-50 border-b border-slate-100 last:border-0 flex items-center justify-between gap-2 transition-colors"
                    >
                        <div class="min-w-0">
                            <p class="font-mono font-semibold text-slate-800 truncate">${escapeHtml(item.code || "-")}</p>
                            <p class="text-slate-500 truncate">${escapeHtml(item.name || "-")}</p>
                            <p class="text-[10px] text-slate-400 truncate">${escapeHtml(item.manufacturers || "")}</p>
                        </div>
                        <span class="shrink-0 px-2 py-0.5 rounded-md border text-[10px] font-semibold ${status.class}">${status.label}</span>
                    </button>
                `;
          })
          .join("");
      }

      // ป้องกัน XSS เบื้องต้นตอนแสดงข้อความจาก API ลงใน innerHTML
      function escapeHtml(str) {
        const div = document.createElement("div");
        div.textContent = str;
        return div.innerHTML;
      }

      // เลือกรายการสินค้าจาก dropdown (คลิกหรือกด Enter) แล้วนำไปเติมในแถวของตาราง
      function selectAutocompleteItemByIndex(idx) {
        const item = currentAutocompleteItems[idx];
        if (!item || !activeAutocompleteInput) return;

        const input = activeAutocompleteInput;
        const row = input.closest(".product-row");

        input.value = item.code || "";

        if (row) {
          const descInput = row.querySelector(".prod-desc");
          if (descInput) {
            descInput.value = item.manufacturers
              ? `${item.name || ""} (${item.manufacturers})`
              : item.name || "";
          }
        }

        closeProdAutocomplete();

        // เลื่อนโฟกัสไปช่องจำนวนเข้าต่อทันที เพื่อความรวดเร็วในการกรอกข้อมูล
        if (row) {
          const qtyInInput = row.querySelector(".qty-in");
          if (qtyInInput) qtyInInput.focus();
        }
      }

      // ปิด dropdown autocomplete และเคลียร์สถานะ
      function closeProdAutocomplete() {
        const dropdown = document.getElementById("prodAutocompleteDropdown");
        if (dropdown) {
          dropdown.classList.add("hidden");
          dropdown.innerHTML = "";
        }
        currentAutocompleteItems = [];
        currentAutocompleteHighlightIndex = -1;
      }

      // ปิด dropdown เมื่อคลิกนอกกรอบ
      document.addEventListener("click", function (e) {
        if (
          !e.target.closest("#prodAutocompleteDropdown") &&
          !e.target.classList.contains("prod-code")
        ) {
          closeProdAutocomplete();
        }
      });

      // เพิ่มแถวรายการสินค้าเริ่มต้นจำนวน 2 รายการ (บังคับกรอกอย่างน้อย 2 แถว)
      function addSampleRows() {
        const tbody = document.getElementById("productTableBody");
        if (tbody && tbody.children.length === 0) {
          addProductRow();
          addProductRow();
        }
      }

      // ================= FORM SUBMISSION & LOGIC =================

      // ส่งแบบฟอร์มบันทึก / แก้ไขเอกสาร
      async function submitSwapForm(event) {
        event.preventDefault();

        const submitBtn = document.getElementById("submitBtn");
        const originalBtnContent = submitBtn.innerHTML;

        const productRows = document.querySelectorAll(
          "#productTableBody .product-row",
        );
        const productsList = [];

        if (productRows.length === 0) {
          showNotification(
            "ผิดพลาด",
            "กรุณาระบุรายการสินค้าอย่างน้อย 1 รายการ",
            "error",
          );
          return;
        }

        productRows.forEach((row, index) => {
          productsList.push({
            no: index + 1,
            prodCode: row.querySelector(".prod-code").value.trim(),
            description: row.querySelector(".prod-desc").value.trim(),
            qtyIn: parseFloat(row.querySelector(".qty-in").value) || 0,
            unitIn: row.querySelector(".unit-in").value.trim(),
            qtyOut: parseFloat(row.querySelector(".qty-out").value) || 0,
            unitOut: row.querySelector(".unit-out").value.trim(),
            price: parseFloat(row.querySelector(".price").value) || 0,
          });
        });

        // บังคับให้กรอกรายการสินค้าอย่างน้อย 2 แถว (เช็คจาก "รหัสสินค้า" เป็นตัวบ่งชี้ว่าแถวนั้นถูกกรอกจริง
        // ไม่บังคับว่าทุกช่องในแถวต้องกรอกครบ เช่น จำนวน/หน่วยนับ/ราคา ยังเว้นว่างได้ตามความเหมาะสม)
        const filledRowsCount = productsList.filter((p) => p.prodCode).length;
        if (filledRowsCount < 2) {
          showNotification(
            "ผิดพลาด",
            "กรุณาระบุรหัสสินค้าอย่างน้อย 2 รายการ",
            "error",
          );
          return;
        }

        let selectedPurpose = "309";
        const purposeRadios = document.getElementsByName("purpose");
        for (const radio of purposeRadios) {
          if (radio.checked) {
            selectedPurpose = radio.value;
            break;
          }
        }

        // หมายเหตุ: ตอนสร้างเอกสารใหม่ ไม่มีการอ่านเลขที่เอกสารจากช่อง input อีกต่อไป
        // เพราะเลขที่แท้จริงจะถูก SQL Server เป็นคน gen ให้หลังบันทึกสำเร็จเท่านั้น (กัน ID ซ้ำข้าม user/เครื่อง)
        // ตอนแก้ไข (editMode) ยังใช้เลขเดิมที่มีอยู่แล้ว (editingDocId) เหมือนเดิม
        const docId = editMode
          ? document.getElementById("docId").value.trim()
          : null;
        const date = document.getElementById("docDate").value;
        const remark = document.getElementById("remark").value.trim();
        const preparedBy = document.getElementById("preparedBy").value.trim();
        const preparedByEmail = document
          .getElementById("preparedByEmail")
          .value.trim();
        const scmControl = document.getElementById("scmControl").value.trim();
        const scmControlEmail = document
          .getElementById("scmControlEmail")
          .value.trim();
        const approvedBy = document.getElementById("approvedBy").value.trim();
        const approvedByEmail = document
          .getElementById("approvedByEmail")
          .value.trim();
        const docStatus = document.getElementById("docStatus").value;
        const hasAttachmentSelected =
          document.querySelector('input[name="hasAttachmentRadio"]:checked')
            ?.value === "1";

        const documentData = {
          documentId: docId,
          date: date,
          purpose: selectedPurpose,
          // ส่งชื่อไปเก็บคู่กับรหัสเสมอ เพราะรหัส 921 เปลี่ยนความหมายได้อีกในอนาคต
          movementTypeDes: MOVEMENT_LABEL_MAP[selectedPurpose] || "",
          remark: remark,
          preparedBy: preparedBy,
          preparedByEmail: preparedByEmail,
          // อีเมลของคนที่ login แล้วกด submit จริง (ไม่ใช่ preparedByEmail ที่กรอกได้อิสระ)
          // ใช้เป็นตัวตัดสินสิทธิ์แก้ไขเอกสาร (canEditDocument) เท่านั้น — ส่งเฉพาะตอนสร้างใหม่
          // ตอน edit ไม่ส่งค่านี้ เพื่อไม่ให้ไปทับผู้สร้างเดิมของเอกสาร
          createdByEmail: editMode ? undefined : currentUserEmail,
          createdByEmpId: editMode ? undefined : currentEmpId,
          // ผู้ทำรายการจริง ณ ขณะนี้ (คนที่ login แล้วกด submit) — ส่งเสมอทุกโหมด ทั้ง create และ edit
          // ต่างจาก createdByEmpId/createdByEmail ด้านบนที่ตั้งใจไม่ส่งตอน edit (กันทับผู้สร้างเดิม)
          // ใช้สำหรับบันทึก audit_log ว่า "ใครเป็นคนทำรายการนี้จริงๆ" โดยเฉพาะ ไม่ปะปนกับ field อื่น
          editorEmpId: currentEmpId,
          editorName: currentUserName,
          editorEmail: currentUserEmail,
          scmControl: scmControl,
          scmControlEmail: scmControlEmail,
          scmControlEmpId: document.getElementById("scmControlEmpId").value,
          approvedBy: approvedBy,
          approvedByEmail: approvedByEmail,
          approvedByEmpId: document.getElementById("approvedByEmpId").value,
          // ==== เอกสารแนบ + Fast-track ====
          hasAttachment: hasAttachmentSelected,
          skipApprover: document.getElementById("skipApprover").checked,
          attachmentFileName: attachmentData.fileName,
          attachmentFileType: attachmentData.fileType,
          attachmentBase64: attachmentData.base64,
          // ตอนแก้ไข: true = ยังใช้ไฟล์เดิม ไม่ได้อัปโหลดใหม่ (Backend จะไม่แตะตาราง SwapAttachment)
          keepExistingAttachment: keepExistingAttachment,
          status: docStatus,
          isEdit: editMode,
          originalDocId: editMode ? editingDocId : null,
          products: productsList,
        };

        submitBtn.disabled = true;
        submitBtn.innerHTML = `
                <svg class="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span>บันทึกข้อมูล...</span>
            `;

        // ลิงก์ API สำหรับการบันทึกสลับสินค้าใหม่ / อัปเดตสินค้า
        const webhookUrl = editMode
          ? "https://n8n.ktw.co.th/webhook/Edit_swap_product"
          : "https://n8n.ktw.co.th/webhook/create_swap_product";

        // แยก fetch ออกมาต่างหาก — ถ้า throw ตรงนี้แปลว่าเชื่อมต่อ Server ไม่ได้จริงๆ (เน็ตล่ม/DNS พัง)
        // ค่อย fallback ไปโหมด TEMP- (ออฟไลน์) ส่วน error จาก backend (validation/permission) จะไม่มาถึงจุดนี้
        let response;
        try {
          response = await n8nFetch(webhookUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(documentData),
          });
        } catch (networkErr) {
          console.error("Network error (fetch throw):", networkErr);
          // กรณีเชื่อมต่อ Server ไม่ได้ ให้ใช้เลขชั่วคราว (TEMP-) แทน
          // เพื่อไม่ให้ไปชนกับเลขจริงที่ SQL Server เป็นคน gen ให้ในภายหลัง
          // ผู้ใช้ต้องตรวจสอบ/บันทึกซ้ำอีกครั้งเมื่อเชื่อมต่อ Server ได้แล้ว
          const fallbackId = editMode
            ? documentData.originalDocId || docId
            : `TEMP-${Date.now()}`;
          documentData.documentId = fallbackId;
          saveDocumentLocal(documentData);
          showNotification(
            "บันทึกจำลองผลสำเร็จ",
            `ไม่สามารถเชื่อมต่อ Server ได้ ระบบบันทึกข้อมูลชั่วคราวไว้ในเครื่อง (เลขที่ชั่วคราว ${fallbackId}) กรุณาตรวจสอบการเชื่อมต่อแล้วบันทึกซ้ำอีกครั้ง`,
            "warning",
          );
          submitBtn.disabled = false;
          submitBtn.innerHTML = originalBtnContent;
          closeSwapModal();
          renderHistoryTable();
          return;
        }

        // อ่านเลขที่เอกสารจริงที่ SQL Server gen ให้ จาก response ของ n8n
        // (ตาม Respond to Webhook ที่ตั้งไว้: { success: true, documentId: "..." })
        const result = await response.json().catch(() => ({}));

        // ⚠️ Server ตอบกลับมาจริง แต่ปฏิเสธคำขอ (validation ไม่ผ่าน / ไม่มีสิทธิ์ ฯลฯ)
        // ต้องโชว์ error จริงให้เห็น ไม่ทำ TEMP- fallback และไม่ปิด modal เพื่อให้ผู้ใช้แก้ไขข้อมูลต่อ
        if (!response.ok || result.success === false) {
          showNotification(
            "บันทึกไม่สำเร็จ",
            extractErrorMessage(result),
            "error",
          );
          submitBtn.disabled = false;
          submitBtn.innerHTML = originalBtnContent;
          return;
        }

        try {
          const finalDocId = editMode
            ? documentData.originalDocId || docId
            : result.documentId;

          if (!finalDocId) {
            throw new Error("ไม่ได้รับเลขที่เอกสารกลับจาก Server");
          }

          documentData.documentId = finalDocId;
          saveDocumentLocal(documentData);
          showNotification(
            "บันทึกสำเร็จ",
            `เอกสารใบสลับสินค้าเลขที่ ${finalDocId} บันทึกสำเร็จแล้ว`,
            "success",
          );
        } catch (error) {
          console.error("Unexpected error after successful response:", error);
          showNotification(
            "เกิดข้อผิดพลาด",
            extractErrorMessage(null, error.message),
            "error",
          );
        } finally {
          submitBtn.disabled = false;
          submitBtn.innerHTML = originalBtnContent;
          closeSwapModal();
          renderHistoryTable();
        }
      }

      // จัดเก็บข้อมูลลง Local Storage
      function saveDocumentLocal(docData) {
        const history = JSON.parse(
          localStorage.getItem("ktw_swap_history") || "[]",
        );

        if (editMode && editingDocId) {
          const index = history.findIndex(
            (item) => item.documentId === editingDocId,
          );
          if (index !== -1) {
            // คงค่า createdByEmail/createdByEmpId เดิมไว้เสมอตอนแก้ไข (docData ตอน edit ไม่มีค่านี้ เพื่อไม่ให้ทับผู้สร้างเดิม)
            history[index] = {
              ...docData,
              createdByEmail:
                history[index].createdByEmail || docData.createdByEmail,
              createdByEmpId:
                history[index].createdByEmpId || docData.createdByEmpId,
            };
          }
        } else {
          history.unshift(docData);
        }

        localStorage.setItem("ktw_swap_history", JSON.stringify(history));
        editMode = false;
        editingDocId = null;
      }

      // อ่านข้อความ error ให้ครอบคลุมทุกรูปแบบที่ n8n อาจตอบกลับมา:
      // - { success:false, error:"..." }  จาก workflow ที่ใช้ IF + Respond to Webhook (แบบมาตรฐานที่ตั้งไว้)
      // - { message:"..." } หรือ { description:"..." } จาก n8n เองตอน Code node throw Error แล้วไม่มี Respond node จับ
      function extractErrorMessage(
        result,
        fallback = "เกิดข้อผิดพลาดไม่ทราบสาเหตุ กรุณาลองใหม่อีกครั้ง",
      ) {
        if (!result) return fallback;
        return result.error || result.message || result.description || fallback;
      }

      // ระบบแจ้งเตือน Toast พรีเมียม
      function showNotification(title, message, type = "success") {
        const container = document.getElementById("toast-container");
        if (!container) return;

        const toast = document.createElement("div");
        toast.className = `transform translate-y-2 opacity-0 transition-all duration-300 pointer-events-auto flex items-start gap-3 bg-white border border-slate-200 rounded-2xl p-4 shadow-xl max-w-sm border-l-4 ${
          type === "success"
            ? "border-l-emerald-500"
            : type === "warning"
              ? "border-l-amber-500"
              : "border-l-red-500"
        }`;

        let icon = "check-circle";
        let iconColor = "text-emerald-500";
        if (type === "warning") {
          icon = "alert-triangle";
          iconColor = "text-amber-500";
        } else if (type === "error") {
          icon = "alert-circle";
          iconColor = "text-red-500";
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
          toast.classList.remove("translate-y-2", "opacity-0");
        }, 10);

        setTimeout(() => {
          toast.classList.add("opacity-0", "translate-y-[-10px]");
          setTimeout(() => toast.remove(), 300);
        }, 6000);

        return toast;
      }

      // เปิดลิ้นชักเมนูข้างสำหรับมือถือ
      function toggleMobileMenu() {
        const mobileSidebar = document.getElementById("mobile-sidebar");
        const menuIcon = document.getElementById("mobileMenuBtn");
        const isHidden = mobileSidebar.classList.contains("hidden");

        if (isHidden) {
          mobileSidebar.classList.remove("hidden");
          menuIcon.setAttribute("data-lucide", "x");
        } else {
          mobileSidebar.classList.add("hidden");
          menuIcon.setAttribute("data-lucide", "menu");
        }
        lucide.createIcons();
      }
