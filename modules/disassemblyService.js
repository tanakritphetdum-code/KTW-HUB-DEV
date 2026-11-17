// ===================================================================
// modules/disassemblyService.js — Service Logic สำหรับ KTW HUB
// ===================================================================

      const N8N_BASE = "https://n8n.ktw.co.th/webhook/";
      let itemRowCounter = 0;
      let allDocuments = [];

      const empId = sessionStorage.getItem("emp_id") || "";
      const empName = sessionStorage.getItem("name") || "";
      const empEmail = sessionStorage.getItem("email") || "";
      // สิทธิ์เฉพาะระบบ Disassembly (ตั้งไว้ตอน login ผ่าน webhook get_disassembly_role)
      const disassemblyRole = sessionStorage.getItem("disassembly_role") || "0";
      const isAdminUser = disassemblyRole === "1";

      // ===== สิทธิ์รายข้อจากระบบ Permission (fail-safe: ยังไม่พร้อม → ใช้กติกา Role เดิม) =====
      // ⚠️ ซ่อน/แสดงปุ่มเพื่อ UX เท่านั้น ตัวบังคับจริงอยู่ที่ n8n (Check Permission) ทุก endpoint
      const PSYS = "DIS";
      function pReady() { return !!(window.KTWPerm && window.KTWPerm.isReady()); }
      function pcan(act, legacy) { return pReady() ? window.KTWPerm.can(PSYS, act) : !!legacy; }
      function pAnyOwn(any, own, isOwner, legacy) {
        return pReady() ? (window.KTWPerm.can(PSYS, any) || (window.KTWPerm.can(PSYS, own) && !!isOwner)) : !!legacy;
      }
      window.addEventListener("ktwperm", function (e) {
        if (typeof __permApply === "function") __permApply(!!(e.detail && e.detail.changed));
      });
      // Role SCM (7) มองเห็นเอกสารทุกใบได้เหมือน Admin — 🆕 30/09/2569 : เพิ่มสิทธิ์ "ถอยสถานะ" ให้ SCM ทุกคนเหมือน Admin ด้วย (ข้ออื่นยังไม่เพิ่ม)
      const isScmUser = disassemblyRole === "7";
      // ⚠️ ทุก Role ที่มีหน้าที่อนุมัติ/ตรวจสอบ (1-7) ต้องเห็นเอกสารทุกใบ ไม่ใช่แค่ Admin กับ SCM
      //    เดิมกรองไว้แค่ 2 role ทำให้ Approver/Marketing/คลังเครื่อง/คลังอะไหล่/ช่าง มองไม่เห็นอะไรเลย
      //    (บั๊กชุดเดียวกับที่เจอในระบบ NCR — ฝั่ง SQL เขียนเงื่อนไขไว้ครบแล้ว แต่หน้าเว็บกรองทิ้งซ้ำ)
      const DISASSEMBLY_APPROVAL_ROLES = ["1", "2", "3", "4", "5", "6", "7"];
      let hasDisassemblyApprovalRole = pcan(
        "READ_ALL",
        DISASSEMBLY_APPROVAL_ROLES.includes(disassemblyRole),
      );

      // เทียบรหัสพนักงานแบบตัดช่องว่างหัวท้าย — คอลัมน์ EmpId ฝั่ง DB เป็น varchar
      function isSameEmp(a, b) {
        return String(a ?? "").trim() === String(b ?? "").trim();
      }

      // ผู้ที่ถูกระบุชื่อไว้บนเอกสารใบนั้น (ทั้งช่องผู้รับแจ้งและช่องผู้เซ็นจริง)
      // ต้องเห็นใบนั้นแม้ยังไม่มี role ในระบบ — ชุดเดียวกับเงื่อนไขใน SQL - Select All Documents
      function isNamedOnDoc(doc) {
        return [
          doc.CreatedByEmpId,
          doc.RequestedByEmpId,
          doc.MarketingNotifyEmpId,
          doc.ApproverNotifyEmpId,
          doc.MarketingByEmpId,
          doc.ApprovedByEmpId,
          doc.WarehouseNotifyEmpId,
          doc.WarehouseByEmpId,
          doc.TechnicianNotifyEmpId,
          doc.TechnicianByEmpId,
          doc.PartsWarehouseNotifyEmpId,
          doc.PartsWarehouseByEmpId,
          doc.ScmNotifyEmpId,
          doc.ScmByEmpId,
        ].some((id) => isSameEmp(id, empId));
      }

      let currentViewDocData = null;
      let currentViewFlowData = [];

      // ================= Dynamic Dropdown: เจ้าหน้าที่การตลาด / ผู้บริหาร =================
      // ดึงรายชื่อจาก DisassemblyEmployeeRole ผ่าน Backend แทนการ Hardcode (คนเข้า-ออกทีมไม่ต้องแก้ไฟล์นี้)
      // Pattern เดียวกับ ncr_form.html
      let disassemblyRoleMembers = { approver: [], marketing: [] };

      async function loadDisassemblyRoleMembers() {
        try {
          const res = await n8nFetch(`${N8N_BASE}get_disassembly_role_members`);
          if (!res.ok) throw new Error("โหลดรายชื่อผู้อนุมัติไม่สำเร็จ");
          disassemblyRoleMembers = await res.json();
        } catch (err) {
          console.error("loadDisassemblyRoleMembers error", err);
          showNotification(
            "โหลดรายชื่อผู้อนุมัติไม่สำเร็จ",
            "กรุณารีเฟรชหน้าใหม่ หรือติดต่อผู้ดูแลระบบ",
            "error",
          );
        }
        populateApproverDropdown("marketingName", disassemblyRoleMembers.marketing);
        populateApproverDropdown("approverName", disassemblyRoleMembers.approver);
      }

      function populateApproverDropdown(selectId, list) {
        const select = document.getElementById(selectId);
        const currentValue = select.value;
        select.innerHTML = '<option value="">-- เลือกชื่อ --</option>';
        (list || []).forEach((person) => {
          const opt = document.createElement("option");
          opt.value = person.name;
          opt.dataset.email = person.email;
          opt.dataset.empId = person.empId;
          opt.textContent = person.name;
          select.appendChild(opt);
        });
        // คงค่าที่เคยเลือกไว้ (กรณี Edit mode โหลดมาก่อน dropdown จะพร้อม)
        if (currentValue) select.value = currentValue;
      }

      async function fetchAllDocuments() {
        const icon = document.getElementById("syncHistoryIcon");
        icon.classList.add("animate-spin");
        try {
          const res = await n8nFetch(
            N8N_BASE + "get_all_disassembly_document_status",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              // Admin ขอเอกสารที่ถูกลบมาด้วย เพื่อให้กู้คืนได้จากหน้านี้
              // ฝั่ง SQL เช็คสิทธิ์ Admin ซ้ำ ถ้าไม่ใช่ Admin ต่อให้ส่ง true มาก็ไม่ได้เอกสารที่ถูกลบ
              body: JSON.stringify({ empId: empId, includeDeleted: false }),
            },
          );
          if (!res.ok) throw new Error("โหลดข้อมูลไม่สำเร็จ");
          // ⚠️ อ่านเป็น text ก่อนเสมอ แล้วค่อย parse เอง
          //    ถ้า SQL คืน 0 แถว n8n จะตอบ body ว่างเปล่า แล้ว res.json() จะ throw
          //    ทำให้หน้าขึ้น "โหลดข้อมูลไม่สำเร็จ" ทั้งที่ความจริงคือ "ยังไม่มีเอกสาร"
          const rawText = await res.text();
          const data = rawText && rawText.trim() ? JSON.parse(rawText) : [];
          allDocuments = Array.isArray(data) ? data : [];
          // 🧹 ทิ้งแถวเปล่าที่ไม่มี DocId
          //    SQL node ที่เปิด Always Output Data ไว้ พอคืน 0 แถว n8n จะส่ง [{}] กลับมา
          //    ถ้าไม่กรองทิ้ง ตารางจะขึ้น 1 แถวที่ทุกช่องเป็น undefined ทั้งที่ฐานข้อมูลว่าง
          allDocuments = allDocuments.filter(
            (doc) => doc && String(doc.DocId || "").trim() !== "",
          );
          // 🔒 จำกัดการมองเห็น: ผู้ที่มีสิทธิ์อนุมัติ/ตรวจสอบ (role 1-7) เห็นทุกใบ
          //    ส่วนคนที่ไม่มี role เห็นเฉพาะใบที่ตัวเองสร้าง หรือใบที่ถูกระบุชื่อไว้บนเอกสาร
          // ⚠️ นี่คือการกรองฝั่ง Frontend เพื่อ UX เท่านั้น ต้องตรงกับเงื่อนไขฝั่ง n8n/SQL เสมอ ไม่ควรเชื่อฝั่ง client อย่างเดียว
          if (!hasDisassemblyApprovalRole) {
            allDocuments = allDocuments.filter((doc) => isNamedOnDoc(doc));
          }
          renderDocTable();
        } catch (err) {
          console.error(err);
          document.getElementById("docTableBody").innerHTML =
            '<tr><td colspan="10" class="px-4 py-8 text-center text-sm text-red-500">โหลดข้อมูลไม่สำเร็จ ลองซิงค์อีกครั้ง</td></tr>';
        } finally {
          icon.classList.remove("animate-spin");
        }
      }

      // 🆕 รอบแกะอะไหล่เพิ่มเติม (RoundNo > 1) — ระหว่างที่ยังไม่เสร็จสิ้นให้ขึ้นนำหน้าว่า "แกะอะไหล่เพิ่มเติม"
      function isExtraRoundActive(doc) {
        return Number(doc.RoundNo) > 1 && Number(doc.StepNo) < 7 && doc.Status !== "ยกเลิก" && !isDocDeleted(doc);
      }

      function getExtraRoundBadge(doc) {
        const n = Number(doc.RoundNo) || 1;
        if (n <= 1) return '<span class="text-slate-300">-</span>';
        return `<span class="inline-flex items-center whitespace-nowrap rounded-lg px-2.5 py-1 font-bold bg-violet-50 text-violet-700 border border-violet-100" title="เอกสารนี้มีการแกะอะไหล่เพิ่มเติมรวม ${n - 1} ครั้ง">แกะเพิ่มเติม ครั้งที่ ${n - 1}</span>`;
      }

      function getStatusBadge(doc) {
        const html = getStatusBadgeBase(doc);
        return isExtraRoundActive(doc) ? html.replace(">รอ", ">แกะอะไหล่เพิ่มเติม รอ") : html;
      }

      function getStatusBadgeBase(doc) {
        if (isDocDeleted(doc)) {
          return '<span class="inline-flex items-center whitespace-nowrap rounded-lg px-2.5 py-1 font-bold bg-slate-200 text-slate-600 border border-slate-300">ถูกลบแล้ว</span>';
        }
        if (doc.Status === "ยกเลิก") {
          return '<span class="inline-flex items-center whitespace-nowrap rounded-lg px-2.5 py-1 font-bold bg-red-50 text-red-700 border border-red-100">ยกเลิก</span>';
        }
        if (doc.StepNo === 0) {
          return '<span class="inline-flex items-center whitespace-nowrap rounded-lg px-2.5 py-1 font-bold bg-amber-50 text-amber-700 border border-amber-100">รอเจ้าหน้าที่การตลาด</span>';
        }
        if (doc.StepNo === 1) {
          return '<span class="inline-flex items-center whitespace-nowrap rounded-lg px-2.5 py-1 font-bold bg-blue-50 text-blue-700 border border-blue-100">รอผู้อนุมัติ</span>';
        }
        if (doc.StepNo === 2) {
          return '<span class="inline-flex items-center whitespace-nowrap rounded-lg px-2.5 py-1 font-bold bg-amber-50 text-amber-700 border border-amber-100">รอเจ้าหน้าที่คลังสินค้า</span>';
        }
        if (doc.StepNo === 3) {
          return '<span class="inline-flex items-center whitespace-nowrap rounded-lg px-2.5 py-1 font-bold bg-cyan-50 text-cyan-700 border border-cyan-100">รอเจ้าหน้าที่แผนกเทคนิคและช่าง</span>';
        }
        if (doc.StepNo === 5) {
          return '<span class="inline-flex items-center whitespace-nowrap rounded-lg px-2.5 py-1 font-bold bg-fuchsia-50 text-fuchsia-700 border border-fuchsia-100">รอเจ้าหน้าที่แผนก SCM</span>';
        }
        if (doc.StepNo === 6) {
          return '<span class="inline-flex items-center whitespace-nowrap rounded-lg px-2.5 py-1 font-bold bg-lime-50 text-lime-700 border border-lime-100">รอเจ้าหน้าที่คลังอะไหล่</span>';
        }
        if (doc.StepNo >= 7) {
          return '<span class="inline-flex items-center whitespace-nowrap rounded-lg px-2.5 py-1 font-bold bg-emerald-50 text-emerald-700 border border-emerald-100">เสร็จสิ้น</span>';
        }
        return '<span class="inline-flex items-center whitespace-nowrap rounded-lg px-2.5 py-1 font-bold bg-teal-50 text-teal-700 border border-teal-100">อนุมัติแล้ว</span>';
      }

      // Badge สถานะ "มี PO" ของเอกสาร (ดึงจาก field HasPO ที่ backend ต้อง flatten มาจากรายการอะไหล่ให้แล้ว)
      // ⚠️ ถ้า field นี้ยังไม่มีใน response ของ get_all_disassembly_document_status จะ fallback เป็น "-" ไปก่อน
      function getPOBadge(doc) {
        if (doc.HasPO === undefined || doc.HasPO === null) {
          return '<span class="text-slate-300">-</span>';
        }
        return doc.HasPO
          ? '<span class="inline-flex items-center whitespace-nowrap rounded-lg px-2.5 py-1 font-bold bg-emerald-50 text-emerald-700 border border-emerald-100">มี PO</span>'
          : '<span class="inline-flex items-center whitespace-nowrap rounded-lg px-2.5 py-1 font-bold bg-slate-100 text-slate-600 border border-slate-200">ไม่มี PO</span>';
      }

      // 🆕 24/09/2569 : Badge เล็ก ๆ ใต้เลขที่เอกสารในตารางหลัก บอก "จำนวนตัวเครื่องที่แกะ"
      // (นับจาก KT Code ตัวเครื่อง/MachineCode ที่ไม่ซ้ำกัน — backend ส่ง MachineCount มาให้แล้ว
      //  จาก SQL - Select All Documents (Disassembly).sql) แยกจาก ItemCount ที่นับทุกแถวอะไหล่
      function getMachineCountBadgeHtml(doc) {
        const n = Number(doc.MachineCount) || 0;
        if (n === 0) return "";
        return `<span class="block mt-0.5 text-[10px] font-normal text-slate-400" title="จำนวนตัวเครื่องที่แกะในเอกสารนี้ (นับจาก KT Code ตัวเครื่องที่ไม่ซ้ำกัน)">🔧 ${n} เครื่อง</span>`;
      }

      // ข้อความสถานะล้วนๆ (ไม่มี HTML) ใช้สำหรับ filter/sort เทียบค่ากันตรงๆ
      function getDisplayStatusLabel(doc) {
        const base = getDisplayStatusLabelBase(doc);
        return isExtraRoundActive(doc) ? "แกะอะไหล่เพิ่มเติม " + base : base;
      }

      function getDisplayStatusLabelBase(doc) {
        if (doc.Status === "ยกเลิก") return "ยกเลิก";
        if (doc.StepNo === 0) return "รอเจ้าหน้าที่การตลาด";
        if (doc.StepNo === 1) return "รอผู้อนุมัติ";
        if (doc.StepNo === 2) return "รอเจ้าหน้าที่คลังสินค้า";
        if (doc.StepNo === 3) return "รอเจ้าหน้าที่แผนกเทคนิคและช่าง";
        if (doc.StepNo === 5) return "รอเจ้าหน้าที่แผนก SCM";
        if (doc.StepNo === 6) return "รอเจ้าหน้าที่คลังอะไหล่";
        if (doc.StepNo >= 7) return "เสร็จสิ้น";
        return "อนุมัติแล้ว";
      }

      function getPurposeLabel(purpose) {
        return purpose === "REPAIR" ? "เพื่อซ่อม" : "เพื่อขาย/เพื่อเคลม";
      }

      // แก้ไขได้เฉพาะตอนอยู่ stage แรกเท่านั้น (StepNo === 0, ยังไม่เคยผ่านการอนุมัติขั้นไหนเลย)
      // เจ้าของเอกสาร หรือ Admin เท่านั้นที่แก้ไขได้ — ตรงกับกติกาเดียวกับฝั่ง SWAP
      function canEditDocument(doc) {
        if (doc.Status === "ยกเลิก" || doc.StepNo !== 0) return false;
        const own = doc.CreatedByEmpId === empId;
        return pAnyOwn("UPDATE_ANY", "UPDATE_OWN", own, isAdminUser || own);
      }

      // ลบได้เฉพาะ Admin เท่านั้น และเฉพาะตอนเอกสารยังอยู่ stage แรก (StepNo === 0)
      // พออนุมัติ stage แรกไปแล้ว (StepNo >= 1) ไม่มีใครลบได้อีกเลยแม้แต่ Admin
      function canDeleteDocument(doc) {
        if (isDocDeleted(doc)) return false;
        if (doc.Status === "ยกเลิก" || doc.StepNo !== 0) return false;
        return pAnyOwn("DELETE_ANY", "DELETE_OWN", doc.CreatedByEmpId === empId, isAdminUser);
      }

      // SQL ส่ง IsDeleted มาเป็น INT (CAST ไว้แล้ว) แต่เผื่อ n8n แปลง BIT เป็น boolean จึงรับทั้งสองแบบ
      function isDocDeleted(doc) {
        return doc.IsDeleted === true || Number(doc.IsDeleted) === 1;
      }

      // กู้คืนได้เฉพาะ Admin — ถ้าคนลบกู้เองได้ การลบก็ไม่มีน้ำหนักอะไร
      // ฝั่ง n8n (SQL - Restore Document) เช็ค RoleId = 1 ซ้ำอีกชั้น ไม่ได้เชื่อหน้าเว็บอย่างเดียว
      function canRestoreDocument(doc) {
        // ย้ายการกู้คืนไปอยู่ที่หน้า History Log แล้ว (หน้านี้ไม่แสดงเอกสารที่ถูกลบ/ปุ่มกู้คืนอีก)
        return false;
      }

      // 🆕 30/09/2569 : ยกเลิกเอกสารได้เฉพาะผู้สร้างเอกสารเอง หรือ Admin และเฉพาะตอนอยู่ stage แรก (StepNo === 0)
      // ยกเลิกแล้วจบถาวร ไม่มีทางนำกลับมาใช้งานใหม่ได้ (ไม่ใช่ IsDeleted จึงกู้คืนไม่ได้ด้วยปุ่มกู้คืน)
      // ฝั่ง n8n (SQL - Check Cancel Permission) เช็คซ้ำอีกชั้น ไม่ได้เชื่อหน้าเว็บอย่างเดียว
      function canCancelDocument(doc) {
        if (isDocDeleted(doc)) return false;
        if (doc.Status === "ยกเลิก" || doc.StepNo !== 0) return false;
        const own = doc.CreatedByEmpId === empId;
        return pAnyOwn("CANCEL_ANY", "CANCEL_OWN", own, isAdminUser || own);
      }

      // ================= SORT & FILTER: ตารางประวัติเอกสาร (พอร์ตแบบเดียวกับ swap_product.html) =================
      let docSortState = { column: null, direction: "asc" };

      function toggleDocFilterDropdown(event, column) {
        event.stopPropagation();
        const btn = event.currentTarget;
        const dropdown = document.getElementById(`filter-dropdown-${column}`);
        if (!dropdown) return;
        const wasHidden = dropdown.classList.contains("hidden");

        closeAllDocFilterDropdowns();

        if (wasHidden) {
          const rect = btn.getBoundingClientRect();
          dropdown.classList.remove("hidden");

          const dropdownWidth = dropdown.offsetWidth;
          let left = rect.right - dropdownWidth;
          if (left < 8) left = 8;
          const maxLeft = window.innerWidth - dropdownWidth - 8;
          if (left > maxLeft) left = maxLeft;

          dropdown.style.top = rect.bottom + 6 + "px";
          dropdown.style.left = left + "px";
        }
      }

      function closeAllDocFilterDropdowns() {
        document
          .querySelectorAll(".doc-filter-dropdown")
          .forEach((dd) => dd.classList.add("hidden"));
      }

      document.addEventListener("click", function (e) {
        if (
          !e.target.closest(".doc-filter-dropdown") &&
          !e.target.closest(".filter-toggle-btn")
        ) {
          closeAllDocFilterDropdowns();
        }
      });
      window.addEventListener("scroll", closeAllDocFilterDropdowns, true);
      window.addEventListener("resize", closeAllDocFilterDropdowns);

      function updateDocFilterIndicators() {
        const filters = {
          DocId: document.getElementById("filter-DocId")?.value || "",
          DocDate: document.getElementById("filter-DocDate")?.value || "",
          Purpose: document.getElementById("filter-Purpose")?.value || "",
          HasPO: document.getElementById("filter-HasPO")?.value || "",
          RemarkOrPO: document.getElementById("filter-RemarkOrPO")?.value || "",
          CreatedByEmpId:
            document.getElementById("filter-CreatedByEmpId")?.value || "",
          RequestedByName:
            document.getElementById("filter-RequestedByName")?.value || "",
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

        const resetBtn = document.getElementById("resetDocFiltersBtn");
        if (resetBtn) resetBtn.classList.toggle("hidden", !anyActive);
      }

      // เติมตัวเลือก "รหัสพนักงาน" และ "ผู้ขออนุมัติ" แบบไม่ซ้ำ จากข้อมูลทั้งหมดเสมอ (ก่อนกรอง)
      function populateDocFilterOptions(docs) {
        const empIdSelect = document.getElementById("filter-CreatedByEmpId");
        const requesterSelect = document.getElementById(
          "filter-RequestedByName",
        );
        if (!requesterSelect) return;

        const currentEmpIdVal = empIdSelect ? empIdSelect.value : "";
        const currentVal = requesterSelect.value;

        const uniqueEmpIds = [
          ...new Set(docs.map((d) => d.CreatedByEmpId).filter(Boolean)),
        ].sort();
        const uniqueRequesters = [
          ...new Set(docs.map((d) => d.RequestedByName).filter(Boolean)),
        ].sort();

        if (empIdSelect) {
          empIdSelect.innerHTML =
            '<option value="">ทั้งหมด</option>' +
            uniqueEmpIds
              .map((id) => `<option value="${id}">${id}</option>`)
              .join("");
          if (uniqueEmpIds.includes(currentEmpIdVal))
            empIdSelect.value = currentEmpIdVal;
        }

        requesterSelect.innerHTML =
          '<option value="">ทั้งหมด</option>' +
          uniqueRequesters
            .map((name) => `<option value="${name}">${name}</option>`)
            .join("");

        if (uniqueRequesters.includes(currentVal))
          requesterSelect.value = currentVal;
      }

      function onDocFilterChange() {
        renderDocTable();
      }

      function resetDocFilters() {
        const docIdInput = document.getElementById("filter-DocId");
        const dateInput = document.getElementById("filter-DocDate");
        const purposeSelect = document.getElementById("filter-Purpose");
        const hasPOSelect = document.getElementById("filter-HasPO");
        const remarkOrPOInput = document.getElementById("filter-RemarkOrPO");
        const empIdSelect = document.getElementById("filter-CreatedByEmpId");
        const requesterSelect = document.getElementById(
          "filter-RequestedByName",
        );
        const statusSelect = document.getElementById("filter-displayStatus");

        if (docIdInput) docIdInput.value = "";
        if (dateInput) dateInput.value = "";
        if (purposeSelect) purposeSelect.value = "";
        if (hasPOSelect) hasPOSelect.value = "";
        if (remarkOrPOInput) remarkOrPOInput.value = "";
        if (empIdSelect) empIdSelect.value = "";
        if (requesterSelect) requesterSelect.value = "";
        if (statusSelect) statusSelect.value = "";

        closeAllDocFilterDropdowns();
        renderDocTable();
      }

      function applyDocFilters(docs) {
        const docIdVal = (document.getElementById("filter-DocId")?.value || "")
          .trim()
          .toLowerCase();
        const dateVal = document.getElementById("filter-DocDate")?.value || "";
        const purposeVal =
          document.getElementById("filter-Purpose")?.value || "";
        const hasPOVal = document.getElementById("filter-HasPO")?.value || "";
        const remarkOrPOVal = (
          document.getElementById("filter-RemarkOrPO")?.value || ""
        )
          .trim()
          .toLowerCase();
        const empIdVal =
          document.getElementById("filter-CreatedByEmpId")?.value || "";
        const requesterVal =
          document.getElementById("filter-RequestedByName")?.value || "";
        const statusVal =
          document.getElementById("filter-displayStatus")?.value || "";

        return docs.filter((doc) => {
          if (
            docIdVal &&
            !String(doc.DocId || "")
              .toLowerCase()
              .includes(docIdVal)
          )
            return false;
          if (dateVal && (doc.DocDate || "").slice(0, 10) !== dateVal)
            return false;
          if (purposeVal && doc.Purpose !== purposeVal) return false;
          if (hasPOVal !== "" && Number(!!doc.HasPO) !== Number(hasPOVal))
            return false;
          if (
            remarkOrPOVal &&
            !String(doc.RemarkOrPO || "")
              .toLowerCase()
              .includes(remarkOrPOVal)
          )
            return false;
          if (empIdVal && doc.CreatedByEmpId !== empIdVal) return false;
          if (requesterVal && doc.RequestedByName !== requesterVal)
            return false;
          if (statusVal && getDisplayStatusLabel(doc) !== statusVal)
            return false;
          return true;
        });
      }

      function sortDocData(docs) {
        const { column, direction } = docSortState;
        if (!column) return docs;

        const statusRank = {
          รอเจ้าหน้าที่การตลาด: 1,
          รอผู้อนุมัติ: 2,
          อนุมัติแล้ว: 3,
          รอเจ้าหน้าที่คลังสินค้า: 4,
          รอเจ้าหน้าที่แผนกเทคนิคและช่าง: 5,
          "รอเจ้าหน้าที่แผนก SCM": 6,
          รอเจ้าหน้าที่คลังอะไหล่: 7,
          เสร็จสิ้น: 8,
          ยกเลิก: 9,
        };

        return [...docs].sort((a, b) => {
          let valA, valB;
          if (column === "displayStatus") {
            valA = statusRank[getDisplayStatusLabel(a)] || 0;
            valB = statusRank[getDisplayStatusLabel(b)] || 0;
          } else if (column === "DocDate") {
            valA = new Date(a.DocDate ?? "").getTime();
            valB = new Date(b.DocDate ?? "").getTime();
          } else if (column === "HasPO") {
            valA = Number(!!a.HasPO);
            valB = Number(!!b.HasPO);
          } else {
            valA = String(a[column] ?? "").toLowerCase();
            valB = String(b[column] ?? "").toLowerCase();
          }
          if (valA < valB) return direction === "asc" ? -1 : 1;
          if (valA > valB) return direction === "asc" ? 1 : -1;
          return 0;
        });
      }

      function sortDocBy(column) {
        if (docSortState.column === column) {
          docSortState.direction =
            docSortState.direction === "asc" ? "desc" : "asc";
        } else {
          docSortState.column = column;
          docSortState.direction = "asc";
        }
        renderDocTable();
      }

      function updateDocSortIcons() {
        document.querySelectorAll(".sort-icon").forEach((icon) => {
          const col = icon.getAttribute("data-col");
          if (col === docSortState.column) {
            icon.setAttribute(
              "data-lucide",
              docSortState.direction === "asc" ? "chevron-up" : "chevron-down",
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

      function __permApply(changed) {
        const nb = document.getElementById("btnNewDoc");
        if (nb) nb.style.display = pcan("CREATE", true) ? "" : "none";
        hasDisassemblyApprovalRole = pcan("READ_ALL", DISASSEMBLY_APPROVAL_ROLES.includes(disassemblyRole));
        if (changed && typeof fetchAllDocuments === "function") fetchAllDocuments();
        else renderDocTable();
      }

      function renderDocTable() {
        const tbody = document.getElementById("docTableBody");

        populateDocFilterOptions(allDocuments);

        if (allDocuments.length === 0) {
          tbody.innerHTML =
            '<tr><td colspan="10" class="px-4 py-8 text-center text-sm text-slate-400">ยังไม่มีเอกสาร</td></tr>';
          updateDocFilterIndicators();
          return;
        }

        let docs = applyDocFilters(allDocuments);
        docs = sortDocData(docs);

        if (docs.length === 0) {
          tbody.innerHTML =
            '<tr><td colspan="10" class="px-4 py-8 text-center text-sm text-slate-400">ไม่พบเอกสารที่ตรงกับเงื่อนไขการค้นหา/กรอง</td></tr>';
          updateDocSortIcons();
          updateDocFilterIndicators();
          return;
        }

        tbody.innerHTML = docs
          .map((doc) => {
            const showEdit = canEditDocument(doc);
            const showDelete = canDeleteDocument(doc);
            const showRestore = canRestoreDocument(doc);
            const showCancel = canCancelDocument(doc);
            // 🆕 30/09/2569 : พิมพ์บัตรขอแกะอะไหล่ได้ตั้งแต่ StepNo>=3 (รอเจ้าหน้าที่แผนกเทคนิคและช่าง) เป็นต้นไปเท่านั้น
            const showPrintSticker = doc.StepNo >= 3 && !isDocDeleted(doc);
            const deletedRowClass = isDocDeleted(doc)
              ? " bg-slate-50 text-slate-400 line-through decoration-slate-300"
              : "";
            return `
                <tr class="hover:bg-slate-50/50 transition-colors${deletedRowClass}">
                    <td class="px-3 py-4 font-mono font-semibold text-slate-900">
                        ${doc.DocId}
                        ${getMachineCountBadgeHtml(doc)}
                    </td>
                    <td class="px-3 py-4 text-slate-600 font-light whitespace-nowrap">${formatThaiDate(doc.DocDate)}</td>
                    <td class="px-3 py-4">
                        <span class="text-slate-900 whitespace-nowrap">${getPurposeLabel(doc.Purpose)}</span>
                    </td>
                    <td class="px-3 py-4">${getPOBadge(doc)}</td>
                    <td class="px-3 py-4 text-slate-600 max-w-[170px] truncate" title="${String(doc.RemarkOrPO || "").replace(/"/g,'&quot;')}">${doc.RemarkOrPO || "-"}</td>
                    <td class="px-3 py-4 text-slate-500 font-mono">${doc.CreatedByEmpId || "-"}</td>
                    <td class="px-3 py-4 text-slate-700">${doc.RequestedByName || "-"}</td>
                    <td class="px-3 py-4">${getExtraRoundBadge(doc)}</td>
                    <td class="px-3 py-4">${getStatusBadge(doc)}</td>
                    <td class="px-3 py-4 text-right sticky right-0 z-10 bg-white shadow-[-6px_0_8px_-6px_rgba(0,0,0,0.12)]">
                        <div class="flex items-center justify-end gap-1">
                            <!-- 0. ปุ่ม Preview (ดูตัวอย่างหน้าตาเอกสารก่อนพิมพ์) -->
                            <button onclick="previewDocument('${doc.DocId}')" title="ดูตัวอย่างเอกสาร" class="p-1.5 rounded-lg text-slate-400 hover:bg-indigo-50 hover:text-indigo-600">
                                <i data-lucide="file-text" class="w-4 h-4"></i>
                            </button>
                            <!-- 0.5 ปุ่มพิมพ์บัตรขอแกะอะไหล่ (Sticker) — 🆕 23/09/2569 : ทุก Role ที่เข้าหน้านี้เห็นได้ (ไม่ gate เฉพาะ Admin เพราะช่างต้องใช้หน้างาน)
                                 🆕 30/09/2569 : แสดงเฉพาะตั้งแต่ StepNo>=3 (รอเจ้าหน้าที่แผนกเทคนิคและช่าง) เป็นต้นไป -->
                            ${
                              showPrintSticker
                                ? `
                            <button onclick="printPartsSticker('${doc.DocId}')" title="พิมพ์บัตรขอแกะอะไหล่" class="p-1.5 rounded-lg text-slate-400 hover:bg-cyan-50 hover:text-cyan-600">
                                <i data-lucide="tag" class="w-4 h-4"></i>
                            </button>`
                                : ""
                            }
                            <!-- 1. ปุ่ม Display — เฉพาะ Admin เท่านั้นที่เห็น (ตามข้อกำหนดสิทธิ์) -->
                            ${
                              isAdminUser
                                ? `
                            <button onclick="viewDocument('${doc.DocId}')" title="ดูรายละเอียด" class="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                                <i data-lucide="eye" class="w-4 h-4"></i>
                            </button>`
                                : ""
                            }
                            <!-- 2. ปุ่ม Edit -->
                            ${
                              showEdit
                                ? `
                            <button onclick="openEditDocModal('${doc.DocId}')" title="แก้ไข" class="p-1.5 rounded-lg text-slate-400 hover:bg-blue-50 hover:text-blue-600">
                                <i data-lucide="pencil" class="w-4 h-4"></i>
                            </button>`
                                : ""
                            }
                            <!-- 3. ปุ่ม Docflow -->
                            <button onclick="showDocFlow('${doc.DocId}')" title="ดูความเคลื่อนไหว" class="p-1.5 rounded-lg text-slate-400 hover:bg-purple-50 hover:text-purple-600">
                                <i data-lucide="git-branch" class="w-4 h-4"></i>
                            </button>
                            <!-- 4. ปุ่ม Delete -->
                            ${
                              showDelete
                                ? `
                            <button onclick="openDeleteDocModal('${doc.DocId}')" title="ลบ" class="p-1.5 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600">
                                <i data-lucide="trash-2" class="w-4 h-4"></i>
                            </button>`
                                : ""
                            }
                            <!-- 5. ปุ่มกู้คืน — ขึ้นเฉพาะเอกสารที่ถูกลบ และเฉพาะ Admin -->
                            ${
                              showRestore
                                ? `
                            <button onclick="openRestoreDocModal('${doc.DocId}')" title="กู้คืนเอกสาร" class="p-1.5 rounded-lg text-slate-400 hover:bg-emerald-50 hover:text-emerald-600">
                                <i data-lucide="rotate-ccw" class="w-4 h-4"></i>
                            </button>`
                                : ""
                            }
                            <!-- 6. ปุ่มถอยสถานะ — 🆕 30/09/2569 : Admin และ SCM ทุกคน (เฉพาะเอกสารที่ยังไม่ถูกลบ) -->
                            ${
                              pcan("RETURN_STATUS", isAdminUser || isScmUser) && !isDocDeleted(doc) && doc.Status !== "ยกเลิก"
                                ? `
                            <button onclick="openAdminRevertModal('${doc.DocId}')" title="ถอยสถานะ" class="p-1.5 rounded-lg text-slate-400 hover:bg-amber-50 hover:text-amber-600">
                                <i data-lucide="undo-2" class="w-4 h-4"></i>
                            </button>`
                                : ""
                            }
                            <!-- 7. ปุ่มยกเลิกเอกสาร — 🆕 30/09/2569 : เฉพาะผู้สร้างเอกสาร/Admin และเฉพาะตอนสถานะยังรอเจ้าหน้าที่การตลาด (StepNo=0) -->
                            ${
                              showCancel
                                ? `
                            <button onclick="openCancelDocModal('${doc.DocId}')" title="ยกเลิกเอกสาร" class="p-1.5 rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600">
                                <i data-lucide="ban" class="w-4 h-4"></i>
                            </button>`
                                : ""
                            }
                        </div>
                    </td>
                </tr>`;
          })
          .join("");
        lucide.createIcons();
        updateDocSortIcons();
        updateDocFilterIndicators();
      }

      function formatThaiDate(dateStr) {
        if (!dateStr) return "-";
        const d = new Date(dateStr);
        if (isNaN(d)) return dateStr;
        return d.toLocaleDateString("th-TH-u-ca-buddhist", {
          day: "2-digit",
          month: "short",
          year: "numeric",
          timeZone: "UTC",
        });
      }

      // ⏰ เวลาใน DB บันทึกด้วย GETDATE() = เวลาไทยอยู่แล้ว แต่ n8n ส่งมาเป็น "...Z" (ถูกมองว่าเป็น UTC)
      //    ต้องแสดงด้วย timeZone: "UTC" ไม่งั้น Browser จะบวกเพิ่ม 7 ชม.
      function formatThaiDateTime(dateStr) {
        if (!dateStr) return "-";
        const d = new Date(dateStr);
        if (isNaN(d)) return dateStr;
        return d.toLocaleString("th-TH", { timeZone: "UTC" });
      }

      // 📧 auto-fill อีเมลตอนเลือกชื่อจาก dropdown (ผู้รับผิดชอบขั้นตอนส่งต่อสินค้า)
      // ค่าอีเมลที่เติมให้ยังคงแก้ไขเองต่อได้ตามปกติ เพราะ target ยังเป็น input ธรรมดา
      function autoFillContactEmail(nameSelectId, emailInputId, empIdInputId) {
        const select = document.getElementById(nameSelectId);
        const selectedOption = select.options[select.selectedIndex];
        const email = selectedOption ? selectedOption.dataset.email || "" : "";
        document.getElementById(emailInputId).value = email;
        // empIdInputId เป็น optional — ใช้เฉพาะ dropdown ที่ต้องผูกสิทธิ์การกดปุ่ม (คลัง/ช่าง)
        if (empIdInputId) {
          const empId = selectedOption
            ? selectedOption.dataset.empId || ""
            : "";
          document.getElementById(empIdInputId).value = empId;
        }
      }

      // ================= 🆕 รอบแกะอะไหล่เพิ่มเติม (อ้างอิงเลขที่เอกสารเดิม) =================
      let refCheckState = null;      // ผลตรวจล่าสุด { docId, found, canUse, reason, ... } ของค่าที่กรอกอยู่
      let refCheckTimer = null;
      let refCheckSeq = 0;
      let editingExtraRound = false; // กำลังเปิดแก้ไข/ดูเอกสารที่อยู่ในรอบแกะเพิ่ม

      function isExtraRoundMode() {
        // พบเอกสารอ้างอิง (แม้ไม่มีสิทธิ์) ให้ตัดกล่องคลังสินค้าออกเสมอ — การบันทึกจะถูกบล็อกแยกต่างหาก
        return editingExtraRound || !!(refCheckState && refCheckState.found);
      }

      function applyExtraRoundUi() {
        const card = document.getElementById("warehouseCard");
        const extra = isExtraRoundMode();
        if (card) card.classList.toggle("hidden", extra);
        // เหลือ 3 กล่อง → จัดเป็น 3 คอลัมน์ให้ตรงกับแถว "ผู้ลงนามและผู้เกี่ยวข้อง"
        const grid = document.getElementById("responsibleGrid");
        if (grid) {
          grid.classList.toggle("md:grid-cols-3", extra);
          grid.classList.toggle("md:grid-cols-2", !extra);
          grid.classList.toggle("lg:grid-cols-4", !extra);
        }
      }

      function renderRefTag(html) {
        document.getElementById("refDocTag").innerHTML = html || "";
      }

      function resetRefDocUi() {
        clearTimeout(refCheckTimer);
        refCheckSeq++;
        refCheckState = null;
        editingExtraRound = false;
        const inp = document.getElementById("refDocId");
        inp.value = "";
        inp.disabled = false;
        document.getElementById("refDocRow").classList.remove("hidden");
        renderRefTag("");
        applyExtraRoundUi();
      }

      function onRefDocInput() {
        clearTimeout(refCheckTimer);
        const v = document.getElementById("refDocId").value.trim();
        refCheckState = null;
        applyExtraRoundUi();
        if (!v) { renderRefTag(""); return; }
        renderRefTag('<span class="text-slate-400">กำลังตรวจสอบเลขที่เอกสาร...</span>');
        refCheckTimer = setTimeout(() => checkRefDocument(v), 500);
      }

      async function checkRefDocument(v) {
        const seq = ++refCheckSeq;
        try {
          const res = await n8nFetch(N8N_BASE + "check_ref_document_disassembly", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ docId: v, empId }),
          });
          const raw = await res.json();
          const r = Array.isArray(raw) ? raw[0] || {} : raw;
          if (seq !== refCheckSeq) return;
          refCheckState = { ...r, queried: v };
          if (!r.found) {
            renderRefTag('<span class="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 font-bold bg-red-50 text-red-700 border border-red-100">✗ ไม่พบเอกสารนี้</span>');
          } else if (r.canUse) {
            const again = Number(r.roundNo) > 1 ? ` • เคยแกะเพิ่มแล้ว ${Number(r.roundNo) - 1} ครั้ง` : "";
            renderRefTag(`<span class="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 font-bold bg-emerald-50 text-emerald-700 border border-emerald-100">✓ พบเอกสารนี้ (เสร็จสิ้นแล้ว)</span><span class="ml-2 text-slate-500">ผู้ขอ ${escapeHtmlPrint(r.requestedByName || "-")} • ${escapeHtmlPrint(r.docDate || "")} • ${Number(r.itemCount) || 0} รายการ${again}</span>`);
          } else {
            renderRefTag(`<span class="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 font-bold bg-amber-50 text-amber-700 border border-amber-100">✓ พบเอกสารนี้</span><span class="ml-2 text-amber-700">${escapeHtmlPrint(r.reason || "อ้างอิงไม่ได้")}</span>`);
          }
          applyExtraRoundUi();
        } catch (e) {
          if (seq !== refCheckSeq) return;
          refCheckState = null;
          renderRefTag('<span class="text-red-500">ตรวจสอบเลขที่เอกสารไม่สำเร็จ ลองใหม่อีกครั้ง</span>');
        }
      }

      // รอให้ผลตรวจล่าสุดเสร็จก่อนบันทึก (กรณีกรอกแล้วกดบันทึกทันที)
      async function ensureRefChecked() {
        const v = document.getElementById("refDocId").value.trim();
        if (!v || editingExtraRound) return;
        clearTimeout(refCheckTimer);
        if (!refCheckState || refCheckState.queried !== v) await checkRefDocument(v);
      }

      // โหมดเปิดดู/แก้ไขเอกสารเดิม: เอกสารรอบแกะเพิ่ม = โชว์แถบแจ้ง, เอกสารปกติ = ซ่อนช่องอ้างอิง
      function applyRefModeForExistingDoc(doc) {
        clearTimeout(refCheckTimer);
        refCheckState = null;
        const round = Number(doc.RoundNo) || 1;
        editingExtraRound = round > 1;
        const inp = document.getElementById("refDocId");
        const row = document.getElementById("refDocRow");
        if (round > 1) {
          row.classList.remove("hidden");
          inp.value = doc.DocId;
          inp.disabled = true;
          renderRefTag(`<span class="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 font-bold bg-violet-50 text-violet-700 border border-violet-100">เอกสารแกะอะไหล่เพิ่มเติม ครั้งที่ ${round - 1}</span><span class="ml-2 text-slate-500">ใช้เลขที่เอกสารเดิม • ไม่ผ่านเจ้าหน้าที่คลังสินค้า</span>`);
        } else {
          row.classList.add("hidden");
          inp.value = "";
          renderRefTag("");
        }
        applyExtraRoundUi();
      }

      function openNewDocModal() {
        document.getElementById("editingDocId").value = "";
        document.getElementById("docModalTitle").textContent =
          "สร้างคำขออนุมัติเอกสารแกะอะไหล่";
        document.getElementById("docDate").value = new Date()
          .toISOString()
          .slice(0, 10);
        document.querySelector(
          'input[name="purpose"][value="SALE_CLAIM"]',
        ).checked = true;
        document.getElementById("itemRowsBody").innerHTML = "";
        itemRowCounter = 0;
        addItemRow();
        // ล้างข้อมูลไฟล์แนบของเอกสารก่อนหน้า — ตัวแปรเก็บนอก DOM จึงไม่ถูกล้างเองตอนเปิดฟอร์มใหม่
        resetAttachmentSection();

        document.getElementById("requesterName").value = empName;
        document.getElementById("requesterEmail").value = empEmail;
        document.getElementById("marketingName").value = "";
        document.getElementById("marketingEmail").value = "";
        document.getElementById("marketingEmpId").value = "";
        document.getElementById("approverName").value = "";
        document.getElementById("approverEmail").value = "";
        document.getElementById("approverEmpId").value = "";
        document.getElementById("warehouseName").value = "";
        document.getElementById("warehouseEmail").value = "";
        document.getElementById("warehouseEmpId").value = "";
        document.getElementById("technicianName").value = "";
        document.getElementById("technicianEmail").value = "";
        document.getElementById("technicianEmpId").value = "";
        document.getElementById("partsWarehouseName").value = "";
        document.getElementById("partsWarehouseEmail").value = "";
        document.getElementById("partsWarehouseEmpId").value = "";
        document.getElementById("scmName").value = "";
        document.getElementById("scmEmail").value = "";
        document.getElementById("scmEmpId").value = "";

        setDocModalReadOnly(false);
        resetRefDocUi();   // 🆕 ล้างช่องเลขที่อ้างอิง + แสดงช่องผู้รับผิดชอบคลังสินค้ากลับมา

        document.getElementById("docModal").classList.remove("hidden");
        lucide.createIcons();
      }

      function closeDocModal() {
        document.getElementById("docModal").classList.add("hidden");
        hideGlobalDropdown();
      }

      // ตั้งค่า <select> ให้แสดงชื่อที่บันทึกไว้จริง แม้ชื่อนั้นจะไม่อยู่ใน <option> ที่โหลดมา
      // (เช่น พนักงานพ้นสภาพ/เปลี่ยนบทบาทไปแล้ว) — ไม่งั้น select จะโชว์ว่างเปล่าทั้งที่มีข้อมูลจริงอยู่
      // บั๊กนี้ทำให้ตอนเปิด Display/Edit เอกสารเก่า ชื่อผู้รับผิดชอบคลัง/ช่าง/คลังอะไหล่/SCM ไม่ขึ้น (22/09/2026)
      function setSelectValueEnsureOption(selectId, value) {
        const sel = document.getElementById(selectId);
        if (!sel) return;
        if (!value) {
          sel.value = "";
          return;
        }
        const exists = Array.from(sel.options).some((o) => o.value === value);
        if (!exists) {
          const opt = document.createElement("option");
          opt.value = value;
          opt.textContent = value;
          sel.appendChild(opt);
        }
        sel.value = value;
      }

      // ===================================================================
      // โหมด "Display" — ใช้ฟอร์มเดียวกับตอนสร้าง/แก้ไข (docModal) แต่ล็อกทุกช่องห้ามแก้
      // (คำขอ 22/09/2026: ปุ่ม Display ต้องแสดงผลเหมือนตอนสร้าง แต่แก้ไขไม่ได้)
      // ===================================================================
      function setDocModalReadOnly(readOnly) {
        const scope = document.querySelector("#docModal .overflow-y-auto");
        if (!scope) return;

        // ล็อก/ปลดล็อก input, select, textarea ทั้งหมดในฟอร์ม
        // ยกเว้น docDate (readonly อยู่แล้วโดยดีฟอลต์) และ skipApprover (มี logic คุมสิทธิ์ของตัวเองอยู่แล้วใน onAttachmentToggle)
        scope.querySelectorAll("input, select, textarea").forEach((el) => {
          if (el.id === "docDate" || el.id === "skipApprover") return;
          el.disabled = readOnly;
        });

        // ปุ่ม "เพิ่มรายการ" + ปุ่มลบแต่ละแถวสินค้า — ซ่อนตอนดูอย่างเดียว
        document
          .getElementById("addItemRowBtn")
          ?.classList.toggle("hidden", readOnly);
        document
          .querySelectorAll("#itemRowsBody .item-row-remove-cell")
          .forEach((td) => td.classList.toggle("hidden", readOnly));

        // เอกสารแนบ — ตอนดูอย่างเดียว ยังกดเปิด/ดาวน์โหลดไฟล์เดิมได้ตามปกติ (ปุ่มเหล่านี้ไม่ใช่ input จึงไม่ถูก disable ด้านบน)
        const skipChk = document.getElementById("skipApprover");
        if (skipChk && readOnly) skipChk.disabled = true;

        // ปุ่มบันทึก — ซ่อนตอนดูอย่างเดียว, ปุ่ม "ยกเลิก" เปลี่ยนข้อความเป็น "ปิด"
        document
          .getElementById("submitDocBtn")
          ?.classList.toggle("hidden", readOnly);
        const cancelBtn = document.getElementById("docModalCancelBtn");
        if (cancelBtn) cancelBtn.textContent = readOnly ? "ปิด" : "ยกเลิก";
      }

      // ปุ่ม Display (ไอคอนตา) — เรียกใช้ฟอร์มเดียวกับตอนสร้าง/แก้ไข แต่เปิดเป็นโหมดดูอย่างเดียว
      function viewDocument(docId) {
        openEditDocModal(docId, true);
      }

      function addItemRow(data, readOnly) {
        itemRowCounter++;
        const rowId = "item-row-" + itemRowCounter;
        const tbody = document.getElementById("itemRowsBody");
        const hasPO = data ? !!data.HasPO : false;
        const dis = readOnly ? "disabled" : "";
        const tr = document.createElement("tr");
        tr.id = rowId;
        tr.className = "border-b border-slate-100 last:border-0";
        tr.innerHTML = `
                <td class="px-2 py-2 text-xs text-slate-400 text-center row-index">${tbody.children.length + 1}</td>
                <td class="px-2 py-1.5"><input type="text" ${dis} class="item-brand w-full h-9 px-2 rounded-md border border-slate-200 text-xs text-center focus:ring-1 focus:ring-brand-500 outline-none disabled:bg-slate-100 disabled:text-slate-500" placeholder="Brand จะถูกระบุอัตโนมัติหลังจากเลือกรหัสสินค้า" value="${data?.Brand || ""}"></td>
                <td class="px-2 py-1.5">
                    <input type="text" ${dis} class="item-machine-code w-full h-9 px-2 rounded-md border border-slate-200 text-xs text-center focus:ring-1 focus:ring-brand-500 outline-none disabled:bg-slate-100 disabled:text-slate-500" placeholder="ระบุรหัสสินค้า" value="${data?.MachineCode || ""}" oninput="handleCodeAutocomplete(this, 'machine')" autocomplete="off">
                </td>
                <td class="px-2 py-1.5">
                    <input type="text" ${dis} class="item-part-code w-full h-9 px-2 rounded-md border border-slate-200 text-xs text-center focus:ring-1 focus:ring-brand-500 outline-none disabled:bg-slate-100 disabled:text-slate-500" placeholder="ระบุรหัสสินค้าอะไหล่" value="${data?.PartCode || ""}" oninput="handleCodeAutocomplete(this, 'part')" autocomplete="off">
                </td>
                <td class="px-2 py-1.5"><input type="text" ${dis} class="item-description w-full h-9 px-2 rounded-md border border-slate-200 text-xs text-center focus:ring-1 focus:ring-brand-500 outline-none disabled:bg-slate-100 disabled:text-slate-500" placeholder="Description จะถูกระบุอัตโนมัติหลังจากเลือกอะไหล่" value="${data?.PartDescription || ""}"></td>
                <td class="px-2 py-1.5"><input type="number" min="0" step="1" ${dis} class="item-qty w-full h-9 px-2 rounded-md border border-slate-200 text-xs focus:ring-1 focus:ring-brand-500 outline-none disabled:bg-slate-100 disabled:text-slate-500" value="${data?.Qty ?? 1}"></td>
                <td class="px-2 py-1.5 text-center"><input type="checkbox" ${dis} class="item-has-po w-4 h-4 accent-brand-500" ${hasPO ? "checked" : ""} onchange="syncPOCheckbox(this, true)"></td>
                <td class="px-2 py-1.5 text-center"><input type="checkbox" ${dis} class="item-no-po w-4 h-4 accent-brand-500" ${!hasPO ? "checked" : ""} onchange="syncPOCheckbox(this, false)"></td>
                <td class="px-2 py-1.5"><input type="text" ${dis} class="item-remark-po w-full h-9 px-2 rounded-md border border-slate-200 text-xs text-center focus:ring-1 focus:ring-brand-500 outline-none disabled:bg-slate-100 disabled:text-slate-500" placeholder="ระบุ Remark / PO No." value="${data?.RemarkOrPO || ""}"></td>
                <td class="px-2 py-1.5 text-center item-row-remove-cell ${readOnly ? "hidden" : ""}">
                    <button type="button" onclick="removeItemRow('${rowId}')" class="p-1 rounded text-slate-300 hover:text-red-500 hover:bg-red-50">
                        <i data-lucide="x" class="w-3.5 h-3.5"></i>
                    </button>
                </td>
            `;
        tbody.appendChild(tr);
        lucide.createIcons();
      }

      function syncPOCheckbox(checkboxEl, isHasPOBox) {
        const row = checkboxEl.closest("tr");
        const hasPOBox = row.querySelector(".item-has-po");
        const noPOBox = row.querySelector(".item-no-po");
        if (isHasPOBox) {
          noPOBox.checked = !checkboxEl.checked;
          if (!checkboxEl.checked && !noPOBox.checked) noPOBox.checked = true;
        } else {
          hasPOBox.checked = !checkboxEl.checked;
          if (!checkboxEl.checked && !hasPOBox.checked) hasPOBox.checked = true;
        }
      }

      function removeItemRow(rowId) {
        const row = document.getElementById(rowId);
        if (row) row.remove();
        document.querySelectorAll("#itemRowsBody tr").forEach((tr, idx) => {
          const cell = tr.querySelector(".row-index");
          if (cell) cell.textContent = idx + 1;
        });
      }

      function collectItemsData() {
        const rows = document.querySelectorAll("#itemRowsBody tr");
        return Array.from(rows).map((tr) => ({
          brand: tr.querySelector(".item-brand").value.trim(),
          machineCode: tr.querySelector(".item-machine-code").value.trim(),
          partCode: tr.querySelector(".item-part-code").value.trim(),
          partDescription: tr.querySelector(".item-description").value.trim(),
          qty: parseFloat(tr.querySelector(".item-qty").value) || 0,
          hasPO: tr.querySelector(".item-has-po").checked,
          remarkOrPO: tr.querySelector(".item-remark-po").value.trim(),
        }));
      }

      // ⚠️ 28/09/2569 : ต้องบังคับครบทั้ง "ผู้ลงนามและผู้เกี่ยวข้อง" (การตลาด/ผู้บริหาร)
      //    และ "ผู้รับผิดชอบในส่วนงานต่างๆ" (คลังสินค้า/เทคนิคและช่าง/คลังอะไหล่/SCM) ทั้ง 4 ส่วนงาน
      //    เดิมเช็คแค่การตลาด+ผู้บริหาร ทำให้มีเอกสารถูกสร้างโดยไม่ระบุผู้รับผิดชอบส่วนงาน
      //    ผลคือไม่มี Email เจ้าหน้าที่คลังสินค้า ผู้บริหารอนุมัติต่อไม่ได้
      function validateSignerFields() {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const requesterEmail = document
          .getElementById("requesterEmail")
          .value.trim();

        // [id ของช่องชื่อ, id ของช่อง Email, ป้ายชื่อส่วนงานสำหรับข้อความแจ้งเตือน]
        const requiredSigners = [
          ["marketingName", "marketingEmail", "เจ้าหน้าที่การตลาด"],
          ["approverName", "approverEmail", "ผู้บริหาร"],
          ...(isExtraRoundMode() ? [] : [["warehouseName", "warehouseEmail", "เจ้าหน้าที่คลังสินค้า (คลังเครื่อง/คลังอะไหล่)"]]),
          ["technicianName", "technicianEmail", "เจ้าหน้าที่แผนกเทคนิคและช่าง"],
          ["partsWarehouseName", "partsWarehouseEmail", "เจ้าหน้าที่คลังอะไหล่"],
          ["scmName", "scmEmail", "เจ้าหน้าที่แผนก SCM"],
        ];

        const missing = requiredSigners.filter(([nameId, emailId]) => {
          const name = document.getElementById(nameId).value.trim();
          const email = document.getElementById(emailId).value.trim();
          return !name || !email;
        });

        if (missing.length > 0) {
          const labels = missing.map(([, , label]) => label).join(", ");
          return `กรุณาเลือกผู้รับผิดชอบให้ครบทุกส่วนงาน — ยังไม่ได้ระบุ: ${labels}`;
        }

        const allEmails = [
          requesterEmail,
          ...requiredSigners.map(
            ([, emailId]) => document.getElementById(emailId).value.trim(),
          ),
        ];
        if (allEmails.some((e) => !emailRegex.test(e))) {
          return "รูปแบบ Email ไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง";
        }
        return null;
      }

      async function submitDocForm() {
        // 🆕 ตรวจเลขที่เอกสารอ้างอิงก่อน (เฉพาะตอนสร้างใหม่)
        const isEditNow = !!document.getElementById("editingDocId").value;
        const refVal = isEditNow ? "" : document.getElementById("refDocId").value.trim();
        if (refVal) {
          await ensureRefChecked();
          if (!refCheckState || !refCheckState.found) {
            showNotification("ไม่สามารถบันทึกเอกสารได้", `ไม่พบเอกสารเลขที่ ${refVal} ในระบบ — กรุณาตรวจสอบเลขที่เอกสารอ้างอิง หรือลบออกหากเป็นการสร้างเอกสารใหม่`, "error");
            return;
          }
          if (!refCheckState.canUse) {
            showNotification("ไม่สามารถบันทึกเอกสารได้", `ไม่สามารถอ้างอิงเอกสารเลขที่ ${refVal} ได้ เนื่องจาก: ${refCheckState.reason || "เอกสารนี้ยังเปิดรอบแกะเพิ่มไม่ได้"} — กรุณาลบเลขที่เอกสารอ้างอิงออก หรือใช้เลขที่ที่คุณมีสิทธิ์`, "error");
            return;
          }
        }
        const items = collectItemsData();
        if (items.length === 0 || items.some((i) => !i.partCode)) {
          showNotification(
            "ข้อมูลไม่ครบ",
            "กรุณาระบุ KT Code อะไหล่ให้ครบทุกรายการ อย่างน้อย 1 รายการ",
            "error",
          );
          return;
        }

        const signerError = validateSignerFields();
        if (signerError) {
          showNotification("ข้อมูลไม่ครบ", signerError, "error");
          return;
        }

        const docId = document.getElementById("editingDocId").value;
        const isEdit = !!docId;
        const purpose = document.querySelector(
          'input[name="purpose"]:checked',
        ).value;

        const payload = {
          date: document.getElementById("docDate").value,
          purpose: purpose,
          items: items,
          marketingName: document.getElementById("marketingName").value.trim(),
          marketingEmail: document
            .getElementById("marketingEmail")
            .value.trim(),
          marketingEmpId: document
            .getElementById("marketingEmpId")
            .value.trim(),
          approverName: document.getElementById("approverName").value.trim(),
          approverEmail: document.getElementById("approverEmail").value.trim(),
          approverEmpId: document
            .getElementById("approverEmpId")
            .value.trim(),
          warehouseName: document
            .getElementById("warehouseName")
            .value.trim(),
          warehouseEmail: document
            .getElementById("warehouseEmail")
            .value.trim(),
          warehouseEmpId: document
            .getElementById("warehouseEmpId")
            .value.trim(),
          technicianName: document
            .getElementById("technicianName")
            .value.trim(),
          technicianEmail: document
            .getElementById("technicianEmail")
            .value.trim(),
          technicianEmpId: document
            .getElementById("technicianEmpId")
            .value.trim(),
          partsWarehouseName: document
            .getElementById("partsWarehouseName")
            .value.trim(),
          partsWarehouseEmail: document
            .getElementById("partsWarehouseEmail")
            .value.trim(),
          partsWarehouseEmpId: document
            .getElementById("partsWarehouseEmpId")
            .value.trim(),
          scmName: document.getElementById("scmName").value.trim(),
          scmEmail: document.getElementById("scmEmail").value.trim(),
          scmEmpId: document.getElementById("scmEmpId").value.trim(),
          // ==== เอกสารแนบ + Fast-track ====
          hasAttachment:
            document.querySelector('input[name="hasAttachmentRadio"]:checked')
              ?.value === "1",
          skipApprover: document.getElementById("skipApprover").checked,
          attachmentFileName: attachmentData.fileName,
          attachmentFileType: attachmentData.fileType,
          attachmentBase64: attachmentData.base64,
          // ตอนแก้ไข: true = ยังใช้ไฟล์เดิม ไม่ได้อัปโหลดใหม่ (Backend จะไม่แตะตาราง DisassemblyAttachment)
          keepExistingAttachment: keepExistingAttachment,
        };

        if (isEdit) {
          payload.docId = docId;
          payload.requesterEmpId = empId;
          payload.requesterName =
            document.getElementById("requesterName").value.trim() || empName;
        } else {
          payload.requestedByName =
            document.getElementById("requesterName").value.trim() || empName;
          payload.requestedByEmpId = empId;
          payload.requestedByEmail =
            document.getElementById("requesterEmail").value.trim() || empEmail;
          payload.createdByEmpId = empId;
          payload.createdByEmail = empEmail;
        }

        // 🆕 รอบแกะเพิ่ม: ส่งเลขที่อ้างอิง และไม่ส่งผู้รับผิดชอบคลังสินค้า
        if (!isEdit && refVal) {
          payload.refDocId = refVal;
          payload.warehouseName = "";
          payload.warehouseEmail = "";
          payload.warehouseEmpId = "";
        }
        if (isEdit && editingExtraRound) {
          payload.warehouseName = "";
          payload.warehouseEmail = "";
          payload.warehouseEmpId = "";
        }

        const endpoint = isEdit
          ? "edit_disassembly_document"
          : "create_disassembly_document";
        const btn = document.getElementById("submitDocBtn");
        btn.disabled = true;

        try {
          const res = await n8nFetch(N8N_BASE + endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          const result = await res.json().catch(() => ({}));
          if (!res.ok || result.success === false) {
            throw new Error(extractErrorMessage(result));
          }
          closeDocModal();
          await fetchAllDocuments();
          showNotification(
            "บันทึกสำเร็จ",
            isEdit
              ? `แก้ไขเอกสาร ${docId} สำเร็จแล้ว`
              : result.isExtraRound
                ? `เปิดรอบแกะอะไหล่เพิ่มเติม (ครั้งที่ ${Number(result.roundNo) - 1}) ในเอกสารเลขที่ ${result.documentId} แล้ว`
                : `สร้างเอกสารสำเร็จ เลขที่: ${result.documentId}`,
            "success",
          );
        } catch (err) {
          showNotification("บันทึกไม่สำเร็จ", err.message, "error");
        } finally {
          btn.disabled = false;
        }
      }

      async function openEditDocModal(docId, viewOnly) {
        // โหมด Display (viewOnly=true) ไม่ต้องเช็คสิทธิ์แก้ไข เพราะแค่ดูข้อมูล ไม่ได้แก้
        if (!viewOnly) {
          const docForCheck = allDocuments.find((d) => d.DocId === docId);
          if (docForCheck && !canEditDocument(docForCheck)) {
            showNotification(
              "ไม่มีสิทธิ์แก้ไข",
              "แก้ไขได้เฉพาะช่วงที่เอกสารยังไม่ผ่านการอนุมัติขั้นใดเลย และต้องเป็นผู้สร้างเอกสารหรือ Admin เท่านั้น",
              "error",
            );
            return;
          }
        }

        try {
          const res = await n8nFetch(
            N8N_BASE + "get_document_detail_disassembly",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ docId }),
            },
          );
          if (!res.ok) throw new Error("โหลดเอกสารไม่สำเร็จ");
          const raw = await res.json();
          // ⚠️ บาง webhook ตอบกลับเป็น array ห่อ object ไว้ [{...}] แทนที่จะเป็น object เดี่ยว {...}
          // แกะให้ปลอดภัยทั้ง 2 แบบ (pattern เดียวกับที่ใช้ใน ncr_form.html / swap_product.html)
          const doc = Array.isArray(raw) ? raw[0] || {} : raw;
          if (!doc || !doc.DocId) throw new Error("ไม่พบข้อมูลเอกสาร");

          document.getElementById("editingDocId").value = doc.DocId;
          document.getElementById("docModalTitle").textContent = viewOnly
            ? `รายละเอียดเอกสารขอแกะอะไหล่ ${doc.DocId}`
            : `แก้ไขเอกสารขออนุมัติแกะอะไหล่ ${doc.DocId}`;
          document.getElementById("docDate").value = (doc.DocDate || "").slice(
            0,
            10,
          );
          document.querySelector(
            `input[name="purpose"][value="${doc.Purpose === "REPAIR" ? "REPAIR" : "SALE_CLAIM"}"]`,
          ).checked = true;

          document.getElementById("requesterName").value =
            doc.RequestedByName || empName;
          document.getElementById("requesterEmail").value =
            doc.RequestedByEmail || empEmail;
          setSelectValueEnsureOption(
            "marketingName",
            doc.MarketingNotifyName || doc.MarketingByName || "",
          );
          document.getElementById("marketingEmail").value =
            doc.MarketingNotifyEmail || doc.MarketingByEmail || "";
          document.getElementById("marketingEmpId").value =
            doc.MarketingNotifyEmpId || "";
          setSelectValueEnsureOption(
            "approverName",
            doc.ApproverNotifyName || doc.ApprovedByName || "",
          );
          document.getElementById("approverEmail").value =
            doc.ApproverNotifyEmail || doc.ApprovedByEmail || "";
          document.getElementById("approverEmpId").value =
            doc.ApproverNotifyEmpId || "";
          // เติมข้อมูลเอกสารแนบ + สถานะ Fast-track ของเอกสารเดิม
          fillAttachmentFromDoc(doc);
          setSelectValueEnsureOption(
            "warehouseName",
            doc.WarehouseNotifyName || doc.WarehouseByName || "",
          );
          document.getElementById("warehouseEmail").value =
            doc.WarehouseNotifyEmail || "";
          document.getElementById("warehouseEmpId").value =
            doc.WarehouseNotifyEmpId || "";
          setSelectValueEnsureOption(
            "technicianName",
            doc.TechnicianNotifyName || doc.TechnicianByName || "",
          );
          document.getElementById("technicianEmail").value =
            doc.TechnicianNotifyEmail || "";
          document.getElementById("technicianEmpId").value =
            doc.TechnicianNotifyEmpId || "";
          setSelectValueEnsureOption(
            "partsWarehouseName",
            doc.PartsWarehouseNotifyName || doc.PartsWarehouseByName || "",
          );
          document.getElementById("partsWarehouseEmail").value =
            doc.PartsWarehouseNotifyEmail || "";
          document.getElementById("partsWarehouseEmpId").value =
            doc.PartsWarehouseNotifyEmpId || "";
          setSelectValueEnsureOption(
            "scmName",
            doc.ScmNotifyName || doc.ScmByName || "",
          );
          document.getElementById("scmEmail").value =
            doc.ScmNotifyEmail || "";
          document.getElementById("scmEmpId").value =
            doc.ScmNotifyEmpId || "";

          document.getElementById("itemRowsBody").innerHTML = "";
          itemRowCounter = 0;
          // 🆕 รอบแกะเพิ่ม: แสดง/แก้เฉพาะรายการของรอบปัจจุบัน (รายการรอบก่อนหน้าไม่ถูกแตะ)
          const curRound = Number(doc.RoundNo) || 1;
          const roundItems = (doc.items || []).filter((it) => (Number(it.RoundNo) || 1) === curRound);
          roundItems.forEach((item) => addItemRow(item, viewOnly));
          if (roundItems.length === 0) addItemRow(undefined, viewOnly);

          setDocModalReadOnly(!!viewOnly);
          applyRefModeForExistingDoc(doc);
          if (curRound > 1) {
            document.getElementById("docModalTitle").textContent = viewOnly
              ? `รายละเอียดเอกสารขอแกะอะไหล่เพิ่มเติม ${doc.DocId}`
              : `แก้ไขเอกสารขออนุมัติแกะอะไหล่เพิ่มเติม ${doc.DocId}`;
          }

          document.getElementById("docModal").classList.remove("hidden");
          lucide.createIcons();
        } catch (err) {
          showNotification("เกิดข้อผิดพลาด", err.message, "error");
        }
      }

      async function deleteDocument(docId) {
        const docForCheck = allDocuments.find((d) => d.DocId === docId);
        if (docForCheck && !canDeleteDocument(docForCheck)) {
          showNotification(
            "ไม่มีสิทธิ์ลบเอกสาร",
            "ลบได้เฉพาะ Admin และเฉพาะช่วงที่เอกสารยังไม่ผ่านการอนุมัติขั้นใดเลย",
            "error",
          );
          return;
        }
        const confirmBtn = document.getElementById("confirmDeleteDocBtn");
        confirmBtn.disabled = true;
        confirmBtn.textContent = "กำลังลบ...";
        try {
          const res = await n8nFetch(N8N_BASE + "delete_doc_disassembly", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              docId,
              requesterEmpId: empId,
              requesterName: empName || "ไม่ระบุชื่อ",
            }),
          });
          const result = await res.json().catch(() => ({}));
          if (!res.ok || result.success === false) {
            throw new Error(extractErrorMessage(result));
          }
          showNotification(
            "ลบสำเร็จ",
            `ลบเอกสารเลขที่ ${docId} ออกจากระบบเรียบร้อยแล้ว`,
            "warning",
          );
          closeDeleteDocModal();
          await fetchAllDocuments();
        } catch (err) {
          showNotification("ลบไม่สำเร็จ", err.message, "error");
        } finally {
          confirmBtn.disabled = false;
          confirmBtn.textContent = "ยืนยันการลบ";
        }
      }

      // 🆕 30/09/2569 : ยกเลิกเอกสาร (StepNo=0 เท่านั้น) — ผู้สร้างเอกสารเอง หรือ Admin เท่านั้นที่กดได้
      // เปลี่ยนแค่ Status เป็น 'ยกเลิก' (ไม่แตะ StepNo/IsDeleted) — จบถาวร ไม่มีปุ่มกู้คืน
      async function cancelDocument(docId) {
        const docForCheck = allDocuments.find((d) => d.DocId === docId);
        if (docForCheck && !canCancelDocument(docForCheck)) {
          showNotification(
            "ไม่มีสิทธิ์ยกเลิกเอกสาร",
            "ยกเลิกได้เฉพาะผู้สร้างเอกสารเองหรือ Admin และเฉพาะช่วงที่ยังรอเจ้าหน้าที่การตลาดเท่านั้น",
            "error",
          );
          return;
        }
        const confirmBtn = document.getElementById("confirmCancelDocBtn");
        confirmBtn.disabled = true;
        confirmBtn.textContent = "กำลังยกเลิก...";
        try {
          const res = await n8nFetch(N8N_BASE + "cancel_document_disassembly", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              docId,
              requesterEmpId: empId,
              requesterName: empName || "ไม่ระบุชื่อ",
            }),
          });
          const result = await res.json().catch(() => ({}));
          if (!res.ok || result.success === false) {
            throw new Error(extractErrorMessage(result));
          }
          const _r = Array.isArray(result) ? result[0] || {} : result;
          showNotification(
            "ยกเลิกสำเร็จ",
            _r.RevertedToRound
              ? `ยกเลิกรอบแกะเพิ่มเติมของเอกสาร ${docId} แล้ว เอกสารกลับไปเป็นรอบที่ ${_r.RevertedToRound} (เสร็จสิ้น)`
              : `ยกเลิกเอกสารเลขที่ ${docId} เรียบร้อยแล้ว`,
            "warning",
          );
          closeCancelDocModal();
          await fetchAllDocuments();
        } catch (err) {
          showNotification("ยกเลิกไม่สำเร็จ", err.message, "error");
        } finally {
          confirmBtn.disabled = false;
          confirmBtn.textContent = "ยืนยันการยกเลิก";
        }
      }

      function openCancelDocModal(docId) {
        document.getElementById("cancelDocIdDisplay").textContent = docId;
        // รอบแกะเพิ่ม (RoundNo > 1): ยกเลิกแล้วกลับเป็นเอกสารเดิม (เสร็จสิ้น) ไม่ใช่ยกเลิกทั้งใบ
        const _d = allDocuments.find((x) => x.DocId === docId);
        const _extra = !!_d && Number(_d.RoundNo) > 1;
        document.getElementById("cancelDocNormalNote").classList.toggle("hidden", _extra);
        document.getElementById("cancelDocExtraNote").classList.toggle("hidden", !_extra);
        const confirmBtn = document.getElementById("confirmCancelDocBtn");
        confirmBtn.onclick = function () {
          cancelDocument(docId);
        };
        openModal("cancelDocModal", "cancelDocModalContent");
      }

      function closeCancelDocModal() {
        closeModal("cancelDocModal", "cancelDocModalContent");
      }

      async function restoreDocument(docId) {
        const docForCheck = allDocuments.find((d) => d.DocId === docId);
        if (docForCheck && !canRestoreDocument(docForCheck)) {
          showNotification(
            "ไม่มีสิทธิ์กู้คืนเอกสาร",
            "กู้คืนได้เฉพาะ Admin และเฉพาะเอกสารที่ถูกลบไว้เท่านั้น",
            "error",
          );
          return;
        }
        const confirmBtn = document.getElementById("confirmRestoreDocBtn");
        confirmBtn.disabled = true;
        confirmBtn.textContent = "กำลังกู้คืน...";
        try {
          // payload ต้องตรงกับ Validate - Escape Input Restore Document ฝั่ง n8n
          // ซึ่งบังคับ docId และ restoredByEmpId
          const res = await n8nFetch(N8N_BASE + "restore_doc_disassembly", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              docId,
              restoredByEmpId: empId,
              restoredByName: empName || "Admin",
            }),
          });
          // อ่าน text ก่อนเสมอ กัน response ว่างแล้ว res.json() โยน error
          const rawText = await res.text();
          const result = rawText && rawText.trim() ? JSON.parse(rawText) : {};
          if (!res.ok || result.success === false) {
            throw new Error(extractErrorMessage(result));
          }
          showNotification(
            "กู้คืนสำเร็จ",
            `กู้คืนเอกสารเลขที่ ${docId} กลับเข้าระบบเรียบร้อยแล้ว`,
            "success",
          );
          closeRestoreDocModal();
          await fetchAllDocuments();
        } catch (err) {
          showNotification("กู้คืนไม่สำเร็จ", err.message, "error");
        } finally {
          confirmBtn.disabled = false;
          confirmBtn.textContent = "ยืนยันการกู้คืน";
        }
      }

      let autocompleteTimer = null;
      let activeAutocompleteInput = null;
      let activeAutocompleteMode = null;

      function getGlobalDropdown() {
        let dropdown = document.getElementById("globalAutocompleteDropdown");
        if (!dropdown) {
          dropdown = document.createElement("div");
          dropdown.id = "globalAutocompleteDropdown";
          dropdown.className =
            "hidden fixed z-[9999] bg-white border border-slate-200 rounded-lg shadow-2xl max-h-64 overflow-y-auto";
          document.body.appendChild(dropdown);
        }
        return dropdown;
      }

      function positionDropdownUnderInput(dropdown, inputEl) {
        const rect = inputEl.getBoundingClientRect();
        const minWidth = 280;
        dropdown.style.top = rect.bottom + 4 + "px";
        dropdown.style.left = rect.left + "px";
        dropdown.style.width = Math.max(rect.width, minWidth) + "px";

        const dropdownWidth = Math.max(rect.width, minWidth);
        if (rect.left + dropdownWidth > window.innerWidth - 16) {
          dropdown.style.left = window.innerWidth - dropdownWidth - 16 + "px";
        }
      }

      function hideGlobalDropdown() {
        const dropdown = document.getElementById("globalAutocompleteDropdown");
        if (dropdown) dropdown.classList.add("hidden");
        activeAutocompleteInput = null;
        activeAutocompleteMode = null;
      }

      function handleCodeAutocomplete(inputEl, mode) {
        clearTimeout(autocompleteTimer);
        const value = inputEl.value.trim();
        activeAutocompleteInput = inputEl;
        activeAutocompleteMode = mode;

        if (value.length < 2) {
          hideGlobalDropdown();
          return;
        }

        autocompleteTimer = setTimeout(async () => {
          try {
            const res = await n8nFetch(
              `${N8N_BASE}autocomplete?code=${encodeURIComponent(value)}`,
              {
                headers: { "content-type": "application/json; charset=utf-8" },
              },
            );
            if (!res.ok) return;
            const results = await res.json();
            if (activeAutocompleteInput === inputEl) {
              renderAutocompleteDropdown(
                inputEl,
                Array.isArray(results) ? results : [],
                mode,
              );
            }
          } catch (err) {
            console.error("autocomplete error", err);
          }
        }, 300);
      }

      function stockStatusBadge(status) {
        const map = {
          lowStock:
            '<span class="px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 text-[10px] font-medium">low stock</span>',
          inStock:
            '<span class="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600 text-[10px] font-medium">in stock</span>',
          outOfStock:
            '<span class="px-1.5 py-0.5 rounded bg-red-50 text-red-600 text-[10px] font-medium">out of stock</span>',
        };
        return map[status] || "";
      }

      function renderAutocompleteDropdown(inputEl, results, mode) {
        const dropdown = getGlobalDropdown();

        if (results.length === 0) {
          dropdown.classList.add("hidden");
          return;
        }

        dropdown.innerHTML = results
          .map((item) => {
            const code = item.code || item.Code || "";
            const manufacturers =
              item.manufacturers || item.Manufacturers || "";
            const name = item.name || item.Name || "";
            const stockstatus = item.stockstatus || item.stockStatus || "";
            return `<div class="px-3 py-2 text-xs hover:bg-orange-50 cursor-pointer border-b border-slate-50 last:border-0" onclick='selectAutocompleteItem(${JSON.stringify({ code, manufacturers, name })})'>
                    <div class="flex items-center justify-between gap-2">
                        <span class="font-mono font-semibold text-slate-800">${code}</span>
                        ${stockStatusBadge(stockstatus)}
                    </div>
                    <div class="text-slate-500 mt-0.5">${manufacturers ? manufacturers + " — " : ""}${name}</div>
                </div>`;
          })
          .join("");

        positionDropdownUnderInput(dropdown, inputEl);
        dropdown.classList.remove("hidden");
      }

      function selectAutocompleteItem(item) {
        if (!activeAutocompleteInput || !activeAutocompleteMode) return;
        const row = activeAutocompleteInput.closest("tr");
        if (activeAutocompleteMode === "machine") {
          row.querySelector(".item-machine-code").value = item.code;
          if (item.manufacturers)
            row.querySelector(".item-brand").value = item.manufacturers;
        } else {
          row.querySelector(".item-part-code").value = item.code;
          if (item.name)
            row.querySelector(".item-description").value = item.name;
        }
        hideGlobalDropdown();
      }

      document.addEventListener("click", (e) => {
        if (
          !e.target.closest(".item-machine-code") &&
          !e.target.closest(".item-part-code") &&
          !e.target.closest("#globalAutocompleteDropdown")
        ) {
          hideGlobalDropdown();
        }
      });
      document.addEventListener(
        "scroll",
        (e) => {
          const dropdown = document.getElementById(
            "globalAutocompleteDropdown",
          );
          if (
            dropdown &&
            (e.target === dropdown || dropdown.contains(e.target))
          ) {
            return;
          }
          hideGlobalDropdown();
        },
        true,
      );
      window.addEventListener("resize", hideGlobalDropdown);

      function closeViewModal() {
        document.getElementById("viewModal").classList.add("hidden");
      }

      // ===================================================================
      // สร้าง HTML หน้ากระดาษเอกสาร (ใช้ร่วมกันทั้ง Preview modal และตอนกดพิมพ์จริง)
      // ===================================================================
      function escapeHtmlPrint(v) {
        if (v === null || v === undefined) return "";
        return String(v)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#39;");
      }

      // 🆕 24/09/2569 : สรุป "จำนวนตัวเครื่องที่แกะ" สำหรับหัวเอกสารตอน Preview/พิมพ์
      // นับจาก KT Code ตัวเครื่อง (MachineCode) ที่ไม่ซ้ำกันในรายการอะไหล่ของเอกสารนี้ (คำนวณฝั่ง client จาก doc.items)
      function getMachineCountSummaryText(items) {
        const codes = new Set(
          (items || [])
            .map((it) => (it.MachineCode || "").trim())
            .filter((v) => v !== ""),
        );
        if (codes.size === 0) return "-";
        return `${codes.size} เครื่อง (${(items || []).length} รายการอะไหล่)`;
      }

      function buildDocPaperHtml(doc) {
        // 🆕 รอบแกะเพิ่มเติม: แสดงเฉพาะรายการของรอบนั้น + ป้ายบอกว่าเป็นเอกสารแกะเพิ่มเติม + ไม่มีช่องคลังสินค้า
        const round = Number(doc.RoundNo) || 1;
        const isExtra = round > 1;
        const items = (doc.items || []).filter((it) => (Number(it.RoundNo) || 1) === round);
        const rows =
          items
            .map(
              (item, i) => `
        <tr>
            <td class="border border-slate-300 px-4 py-3 text-xs text-left text-slate-500">${i + 1}</td>
            <td class="border border-slate-300 px-4 py-3 text-xs break-words">${item.Brand || "-"}</td>
            <td class="border border-slate-300 px-4 py-3 text-xs font-mono break-words">${item.MachineCode || "-"}</td>
            <td class="border border-slate-300 px-4 py-3 text-xs font-mono break-words">${item.PartCode || "-"}</td>
            <td class="border border-slate-300 px-4 py-3 text-xs break-words">${item.PartDescription || "-"}</td>
            <td class="border border-slate-300 px-4 py-3 text-xs text-right whitespace-nowrap">${item.Qty ?? 0}</td>
            <td class="border border-slate-300 px-4 py-3 text-xs text-center whitespace-nowrap">${item.HasPO ? "มี PO" : "ไม่มี PO"}</td>
            <td class="border border-slate-300 px-4 py-3 text-xs break-words">${item.RemarkOrPO || "-"}</td>
        </tr>
    `,
            )
            .join("") ||
          `<tr><td colspan="8" class="border border-slate-300 px-4 py-6 text-center text-slate-400">ไม่มีรายการอะไหล่</td></tr>`;

        // ⚠️ ปรับให้ขนาด/สไตล์เหมือนหน้ากระดาษของระบบ SWAP ทุกประการ (Tailwind class แทนการใช้ inline style เดิม)
        // ตามที่ขอไว้ว่าให้ยึด SWAP เป็นมาตรฐาน เพราะมองเห็นชัดเจนที่สุด
        // 🆕 24/09/2569 : เพิ่มพารามิเตอร์ extraInfo (ไม่บังคับ) — ใช้แสดงข้อมูลที่ SCM กรอกเพิ่ม (เลข ODO)
        // ใต้ชื่อผู้เซ็น ก่อนถึงเส้นคั่น/label ตำแหน่ง — ไม่กระทบ sigBlock อื่นที่ไม่ได้ส่งค่านี้มา
        const sigBlock = (label, name, sigImg, extraInfo) => `
        <div class="flex-1 text-center space-y-1.5">
            <div class="h-16 flex items-end justify-center">
                ${sigImg ? `<img src="${sigImg}" class="max-h-[64px] mx-auto">` : ""}
            </div>
            <p class="text-sm font-medium text-slate-800">${name || "....................................."}</p>
            ${extraInfo ? `<p class="text-xs text-slate-600 font-mono">${extraInfo}</p>` : ""}
            <div class="border-t border-slate-400 pt-1.5">
                <p class="text-xs text-slate-500">${label}</p>
            </div>
        </div>
    `;

        // 🆕 24/09/2569 : เลข ODO / Inbound / Reservation ที่ SCM กรอกมา
        // 🆕 24/09/2569 (ปรับตามหน้างาน SCM) : บนหน้าจอ Preview แยกเป็น 3 กล่องย่อยในกล่องความเห็น SCM
        //   ส่วนตอนพิมพ์เอกสารจริง (print-only) ยังคงต่อท้ายในบรรทัดเดียวเหมือนเดิม เพื่อประหยัดพื้นที่กระดาษ
        const scmCommentText = escapeHtmlPrint(doc.ScmComment) || "-";
        const scmOdoDisplay = escapeHtmlPrint(doc.OdoNumber) || "-";
        const scmInboundDisplay = escapeHtmlPrint(doc.ScmInboundNumber) || "-";
        const scmReservationDisplay = escapeHtmlPrint(doc.ScmReservationNumber) || "-";
        const scmExtraParts = [];
        if (doc.OdoNumber) scmExtraParts.push(`เลข ODO: ${escapeHtmlPrint(doc.OdoNumber)}`);
        if (doc.ScmInboundNumber) scmExtraParts.push(`เลข Inbound: ${escapeHtmlPrint(doc.ScmInboundNumber)}`);
        if (doc.ScmReservationNumber) scmExtraParts.push(`เลข Reservation: ${escapeHtmlPrint(doc.ScmReservationNumber)}`);
        const scmExtraText = scmExtraParts.length ? ` (${scmExtraParts.join(" / ")})` : "";
        const scmCommentDisplay = ((escapeHtmlPrint(doc.ScmComment) || "") + scmExtraText).trim() || "-";

        return `
        <div class="flex items-start justify-between border-b-2 border-slate-800 pb-6 mb-8">
            <div>
                <p class="text-sm font-bold text-orange-600 uppercase tracking-wider">KTW GROUP</p>
                <p class="text-sm text-slate-500 mt-0.5">บริษัท เกรียงไทยวัฒนากรุ๊ป</p>
                <h2 class="text-2xl font-bold mt-3">${isExtra ? "แบบฟอร์มขออนุมัติแกะอะไหล่เพิ่มเติม" : "แบบฟอร์มขออนุมัติแกะอะไหล่"}</h2>
                ${isExtra ? `<p class="mt-2 inline-block rounded-md border border-violet-300 bg-violet-50 px-3 py-1 text-sm font-bold text-violet-700">เอกสารแกะอะไหล่เพิ่มเติม ครั้งที่ ${round - 1} — อ้างอิงเอกสารเลขที่ ${doc.DocId}</p>` : ""}
            </div>
            <div class="text-right text-sm text-slate-500 shrink-0">
                <p>F-14-E02</p>
                <p class="mt-0.5">สถานะ: ${isExtra ? getDisplayStatusLabel(doc) : doc.Status || "-"}</p>
            </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-4 gap-6 text-sm mb-8">
            <div><p class="text-slate-400">เลขที่เอกสาร</p><p class="font-mono font-bold text-base mt-0.5">${doc.DocId}</p></div>
            <div><p class="text-slate-400">วันที่</p><p class="font-semibold text-base mt-0.5">${formatThaiDate(doc.DocDate)}</p></div>
            <div><p class="text-slate-400">วัตถุประสงค์</p><p class="font-semibold text-base mt-0.5">${getPurposeLabel(doc.Purpose)}</p></div>
            <div><p class="text-slate-400">จำนวนตัวเครื่องที่แกะ</p><p class="font-semibold text-base mt-0.5">${getMachineCountSummaryText(items)}</p></div>
        </div>

        <div class="overflow-x-auto mb-8 rounded-lg border border-slate-300">
            <table class="w-full border-collapse text-sm" style="table-layout: fixed;">
                <colgroup>
                    <col style="width: 5.99%;">
                    <col style="width: 12.43%;">
                    <col style="width: 14.63%;">
                    <col style="width: 14.63%;">
                    <col style="width: 18.64%;">
                    <col style="width: 5.99%;">
                    <col style="width: 9.04%;">
                    <col style="width: 18.64%;">
                </colgroup>
                <thead>
                    <tr class="bg-slate-100">
                        <th class="border border-slate-300 px-3 py-2 text-center text-[11px] font-semibold">No.</th>
                        <th class="border border-slate-300 px-3 py-2 text-center text-[11px] font-semibold">Brand</th>
                        <th class="border border-slate-300 px-3 py-2 text-center text-[11px] font-semibold">KT Code ตัวเครื่อง</th>
                        <th class="border border-slate-300 px-3 py-2 text-center text-[11px] font-semibold">KT Code อะไหล่</th>
                        <th class="border border-slate-300 px-3 py-2 text-center text-[11px] font-semibold">Description</th>
                        <th class="border border-slate-300 px-3 py-2 text-center text-[11px] font-semibold">Qty</th>
                        <th class="border border-slate-300 px-3 py-2 text-center text-[11px] font-semibold">PO</th>
                        <th class="border border-slate-300 px-3 py-2 text-center text-[11px] font-semibold">Remark / PO No.</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>

        <!-- กล่องความเห็นประกอบการอนุมัติ — แสดงทั้งตอน Preview และตอนพิมพ์เอกสารจริง (หน้างานขอเพิ่ม 21/09/2026) -->
        <!-- 🆕 24/09/2569 : เพิ่มอีก 4 กล่อง (คลังสินค้า/ช่าง/SCM/คลังอะไหล่) — เดิมกรอกได้แต่ไม่มีที่เก็บ/ไม่โชว์เลย
             ต้อง deploy คู่กับการเพิ่มคอลัมน์ WarehouseComment/TechnicianComment/ScmComment/PartsWarehouseComment
             ใน DB + แก้ webhook ของ 4 stage นี้ก่อน ไม่งั้น field จะเป็นค่าว่างเสมอ (ดู n8n - Patch 4 Confirm Nodes) -->
        <!-- 🆕 24/09/2569 : กล่อง "ความเห็นจาก SCM" ต่อท้ายด้วยเลข ODO และเลข Inbound (หน้างาน SCM ขอ) -->
        <!-- 🖥️ Preview บนหน้าจอ: กล่องความเห็น 6 กล่องแบบเดิม (ซ่อนตอนพิมพ์) -->
        <div class="no-print grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
            <div class="bg-slate-50 border border-slate-200 rounded-lg p-4">
                <p class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">ความเห็นจาก เจ้าหน้าที่การตลาด</p>
                <p class="text-sm text-slate-700 leading-relaxed whitespace-pre-line break-words">${escapeHtmlPrint(doc.MarketingComment) || "-"}</p>
            </div>
            <div class="bg-slate-50 border border-slate-200 rounded-lg p-4">
                <p class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">ความเห็นจาก ผู้อนุมัติ (ผู้บริหาร)</p>
                <p class="text-sm text-slate-700 leading-relaxed whitespace-pre-line break-words">${escapeHtmlPrint(doc.ApprovedComment) || "-"}</p>
            </div>
            ${isExtra ? "" : `
            <div class="bg-slate-50 border border-slate-200 rounded-lg p-4">
                <p class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">ความเห็นจาก เจ้าหน้าที่คลังสินค้า</p>
                <p class="text-sm text-slate-700 leading-relaxed whitespace-pre-line break-words">${escapeHtmlPrint(doc.WarehouseComment) || "-"}</p>
            </div>
`}
            <div class="bg-slate-50 border border-slate-200 rounded-lg p-4">
                <p class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">ความเห็นจาก เจ้าหน้าที่แผนกเทคนิคและช่าง</p>
                <p class="text-sm text-slate-700 leading-relaxed whitespace-pre-line break-words">${escapeHtmlPrint(doc.TechnicianComment) || "-"}</p>
            </div>
            <div class="bg-slate-50 border border-slate-200 rounded-lg p-4">
                <p class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">ความเห็นจาก เจ้าหน้าที่แผนก SCM</p>
                <p class="text-sm text-slate-700 leading-relaxed whitespace-pre-line break-words">${scmCommentText}</p>
                <!-- 🆕 24/09/2569 (ปรับตามหน้างาน SCM) : 3 กล่องย่อย ODO / Inbound / Reservation -->
                <div class="grid grid-cols-3 gap-2 mt-3">
                    <div class="bg-white border border-slate-200 rounded-md px-2.5 py-2">
                        <p class="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">เลข ODO</p>
                        <p class="text-xs font-mono text-slate-700 mt-0.5 break-all">${scmOdoDisplay}</p>
                    </div>
                    <div class="bg-white border border-slate-200 rounded-md px-2.5 py-2">
                        <p class="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">เลข Inbound</p>
                        <p class="text-xs font-mono text-slate-700 mt-0.5 break-all">${scmInboundDisplay}</p>
                    </div>
                    <div class="bg-white border border-slate-200 rounded-md px-2.5 py-2">
                        <p class="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">เลข Reservation</p>
                        <p class="text-xs font-mono text-slate-700 mt-0.5 break-all">${scmReservationDisplay}</p>
                    </div>
                </div>
            </div>
            <div class="bg-slate-50 border border-slate-200 rounded-lg p-4">
                <p class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">ความเห็นจาก เจ้าหน้าที่คลังอะไหล่</p>
                <p class="text-sm text-slate-700 leading-relaxed whitespace-pre-line break-words">${escapeHtmlPrint(doc.PartsWarehouseComment) || "-"}</p>
            </div>
        </div>

        <!-- 🖨️ หน้าพิมพ์: ข้อความบรรทัดเดียว "หัวข้อ : ความเห็น" ไม่มีกรอบ (แสดงเฉพาะตอนพิมพ์) -->
        <div class="print-only space-y-2 mb-10 text-sm text-slate-800">
            <p class="break-words"><span class="font-semibold">ความเห็นประกอบการอนุมัติ — เจ้าหน้าที่การตลาด :</span> ${escapeHtmlPrint(doc.MarketingComment) || "-"}</p>
            <p class="break-words"><span class="font-semibold">ความเห็นประกอบการอนุมัติ — ผู้บริหาร :</span> ${escapeHtmlPrint(doc.ApprovedComment) || "-"}</p>
            ${isExtra ? "" : `<p class="break-words"><span class="font-semibold">ความเห็น — เจ้าหน้าที่คลังสินค้า :</span> ${escapeHtmlPrint(doc.WarehouseComment) || "-"}</p>`}
            <p class="break-words"><span class="font-semibold">ความเห็น — เจ้าหน้าที่แผนกเทคนิคและช่าง :</span> ${escapeHtmlPrint(doc.TechnicianComment) || "-"}</p>
            <p class="break-words"><span class="font-semibold">ความเห็น — เจ้าหน้าที่แผนก SCM :</span> ${scmCommentDisplay}</p>
            <p class="break-words"><span class="font-semibold">ความเห็น — เจ้าหน้าที่คลังอะไหล่ :</span> ${escapeHtmlPrint(doc.PartsWarehouseComment) || "-"}</p>
        </div>

        <!-- แถวที่ 1: ขั้นตอนขออนุมัติ (ผู้ขอ → การตลาด → ผู้บริหาร) -->
        <div class="flex gap-8 pt-10">
            ${sigBlock("ผู้ขออนุมัติแกะอะไหล่", doc.RequestedByName, null)}
            ${sigBlock("เจ้าหน้าที่การตลาด", doc.MarketingByName, doc.MarketingSignature)}
            ${sigBlock("ผู้บริหาร", doc.ApprovedByName, doc.ApprovedSignature)}
        </div>

        <!-- แถวที่ 2: ขั้นตอนดำเนินการจริง (คลังสินค้า → ช่าง → SCM → คลังอะไหล่) -->
        <div class="flex gap-8 pt-12">
            ${isExtra ? "" : sigBlock("เจ้าหน้าที่คลังสินค้า<br>(คลังเครื่อง/คลังอะไหล่)", doc.WarehouseByName, null)}
            ${sigBlock("เจ้าหน้าที่แผนกเทคนิคและช่าง", doc.TechnicianByName, null)}
            ${sigBlock("เจ้าหน้าที่แผนก SCM", doc.ScmByName, null)}
            ${sigBlock("เจ้าหน้าที่คลังอะไหล่", doc.PartsWarehouseByName, null)}
        </div>
    `;
      }

      function printDocument() {
        const doc = currentViewDocData;
        if (!doc) {
          showNotification(
            "ไม่พบข้อมูลเอกสาร",
            "กรุณาเปิดดูรายละเอียดใหม่อีกครั้ง",
            "error",
          );
          return;
        }

        const printArea = document.getElementById("printArea");
        printArea.innerHTML = buildDocPaperHtml(doc);
        printArea.classList.remove("hidden");

        window.print();
        setTimeout(() => printArea.classList.add("hidden"), 500);
      }

      // ===================================================================
      // Preview เอกสาร (ดูตัวอย่างหน้าตาเอกสารก่อนพิมพ์ — ตรงกับปุ่ม Preview ของ swap_product.html)
      // ===================================================================
      let currentPreviewDocData = null;

      // 📎 แสดงไฟล์แนบในหน้า Preview — ทุก Role ที่เห็นปุ่ม Preview ดูได้
      //    วางไว้นอกกระดาษ (previewDocPaper) เพื่อไม่ให้ปนไปกับฟอร์มตอนสั่งพิมพ์
      let previewAttachment = { base64: "", fileName: "", fileType: "" };

      function renderPreviewAttachment(doc) {
        const bar = document.getElementById("previewAttachmentBar");
        if (!bar) return;

        const base64 = doc.attachmentBase64 || "";
        const fileName = doc.attachmentFileName || "";
        const fileType = doc.attachmentFileType || "";
        const hasAtt =
          doc.HasAttachment === true || Number(doc.HasAttachment) === 1;

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

      async function previewDocument(docId) {
        showNotification(
          "กำลังดึงข้อมูล",
          `กำลังดึงข้อมูลเอกสาร ${docId} เพื่อแสดงตัวอย่าง...`,
          "warning",
        );

        try {
          const res = await n8nFetch(
            N8N_BASE + "get_document_detail_disassembly",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ docId }),
            },
          );
          if (!res.ok) throw new Error("โหลดข้อมูลไม่สำเร็จ");
          const raw = await res.json();
          // ⚠️ กัน response ที่เป็น array ห่อ object ไว้
          const doc = Array.isArray(raw) ? raw[0] || {} : raw;
          if (!doc || !doc.DocId) throw new Error("ไม่พบข้อมูลเอกสาร");

          currentPreviewDocData = doc;
          document.getElementById("previewDocPaper").innerHTML =
            buildDocPaperHtml(doc);
          renderPreviewRoundBar(doc, "current");
          renderPreviewAttachment(doc);
          openModal("previewDocModal", "previewDocModalContent");
          lucide.createIcons();
          showNotification(
            "โหลดสำเร็จ",
            `ดึงรายละเอียดเอกสาร ${docId} เรียบร้อยแล้ว`,
            "success",
          );
        } catch (err) {
          showNotification("โหลดข้อมูลไม่สำเร็จ", err.message, "error");
        }
      }

      // 🆕 ปุ่มสลับดูรอบ: รอบปัจจุบัน / รอบก่อนหน้า (จากสำเนาที่เก็บไว้ตอนเปิดรอบใหม่)
      function renderPreviewRoundBar(doc, sel) {
        const bar = document.getElementById("previewRoundBar");
        const snaps = doc.rounds || [];
        if (!snaps.length) { bar.classList.add("hidden"); bar.innerHTML = ""; return; }
        const label = (n) => (n <= 1 ? "รอบที่ 1 (แกะครั้งแรก)" : `รอบที่ ${n} (แกะเพิ่มเติม ครั้งที่ ${n - 1})`);
        const btn = (key, text) =>
          `<button onclick="switchPreviewRound('${key}')" class="px-3 py-1.5 rounded-lg border font-semibold ${String(sel) === String(key) ? "bg-violet-600 text-white border-violet-600" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}">${text}</button>`;
        bar.innerHTML = `<span class="text-slate-400 font-semibold">ดูรอบ:</span>` +
          snaps.map((r) => btn(r.roundNo, label(Number(r.roundNo)))).join("") +
          btn("current", `${label(Number(doc.RoundNo) || 1)} — ปัจจุบัน`);
        bar.classList.remove("hidden");
      }

      function switchPreviewRound(sel) {
        const doc = currentPreviewDocData;
        if (!doc) return;
        let view = doc;
        if (sel !== "current") {
          const snap = (doc.rounds || []).find((r) => String(r.roundNo) === String(sel));
          if (snap) view = { ...snap.header, items: doc.items, rounds: doc.rounds, RoundNo: snap.roundNo };
        }
        document.getElementById("previewDocPaper").innerHTML = buildDocPaperHtml(view);
        renderPreviewRoundBar(doc, sel);
        lucide.createIcons();
      }

      function closePreviewDocModal() {
        closeModal("previewDocModal", "previewDocModalContent");
      }

      // คัดลอกเนื้อหาจาก Preview ไปวางใน #printArea แล้วค่อยสั่งพิมพ์ (เหมือน swap_product.html)
      function printPreviewDocument() {
        const paper = document.getElementById("previewDocPaper");
        const printArea = document.getElementById("printArea");
        if (paper && printArea) {
          printArea.innerHTML = paper.innerHTML;
          printArea.classList.remove("hidden");
        }
        window.print();
        setTimeout(() => {
          if (printArea) printArea.classList.add("hidden");
        }, 500);
      }

      // ===================================================================
      // 🏷️ พิมพ์บัตรขอแกะอะไหล่ (Sticker) — ขนาดจริง 8x4cm (Honeywell PC42e-t, 200dpi)
      // 🆕 23/09/2569
      // Grouping: 1 ใบต่อ 1 กลุ่ม MachineCode ที่ไม่ซ้ำกันในเอกสาร (รวมทุกอะไหล่ของเครื่องเดียวกันไว้ใบเดียว)
      // Pre-fill: เลขที่เอกสาร/วันที่/รุ่น(MachineCode)/หมายเหตุ(RemarkOrPO)/ผู้ขอแกะอะไหล่
      // เว้นว่างให้เขียนมือหน้างาน: เบอร์เครื่อง (Serial Number), อะไหล่ที่แกะ, ช่าง (ตามที่หน้างานยืนยัน 23/09/2569)
      // ===================================================================
      function groupItemsByMachineCode(items) {
        const order = [];
        const map = {};
        (items || []).forEach((item) => {
          const key = item.MachineCode || "-";
          if (!map[key]) {
            map[key] = { machineCode: item.MachineCode || "", remarks: [], parts: [] };
            order.push(key);
          }
          const r = (item.RemarkOrPO || "").trim();
          if (r && !map[key].remarks.includes(r)) map[key].remarks.push(r);
          // 🆕 อะไหล่ที่กรอกตอนสร้างเอกสาร — ดึงมาแสดงในช่อง "อะไหล่ที่แกะ" ของบัตร
          const pc = (item.PartCode || "").trim();
          if (pc) map[key].parts.push({ code: pc, desc: (item.PartDescription || "").trim(), qty: Number(item.Qty) || 0 });
        });
        return order.map((key) => map[key]);
      }

      // 🆕 ช่อง "อะไหล่ที่แกะ" บนบัตร: แสดงรหัส + ชื่ออะไหล่ (+ จำนวนถ้ามากกว่า 1) ที่กรอกตอนสร้างเอกสาร
      // พื้นที่บัตรจำกัด (8x4cm) แสดงได้ 3 บรรทัด — ถ้ามีมากกว่า 3 รายการ แสดง 2 รายการแรก + "และอีก N รายการ"
      function buildStickerPartsHtml(group) {
        const parts = group.parts || [];
        if (parts.length === 0) return "";
        const MAX_LINES = 3;
        const fmt = (p) =>
          `<span class="sticker-part-text">${escapeHtmlPrint(p.code)}${p.desc ? " " + escapeHtmlPrint(p.desc) : ""}</span>` +
          `<span class="sticker-part-qty">× ${p.qty > 0 ? p.qty : 1}</span>`;
        const shown = parts.length > MAX_LINES ? parts.slice(0, MAX_LINES - 1) : parts;
        let html = shown.map((p) => `<div class="sticker-part">${fmt(p)}</div>`).join("");
        if (parts.length > MAX_LINES) {
          html += `<div class="sticker-part">และอีก ${parts.length - shown.length} รายการ</div>`;
        }
        return html;
      }

      function buildStickerCardHtml(doc, group) {
        const remark = group.remarks.join(", ") || "-";
        return `
        <div class="sticker-card">
            <div class="sticker-header">
                <span>KTW GROUP — บัตรขอแกะอะไหล่</span>
                <span>F-14-E03</span>
            </div>
            <div class="sticker-line">
                <div class="sticker-field">
                    <span class="sticker-field-lbl">เลขที่เอกสาร</span>
                    <span class="sticker-field-val">${escapeHtmlPrint(doc.DocId)}</span>
                </div>
                <div class="sticker-field">
                    <span class="sticker-field-lbl">วันที่</span>
                    <span class="sticker-field-val">${escapeHtmlPrint(formatThaiDate(doc.DocDate))}</span>
                </div>
            </div>
            <div class="sticker-line">
                <div class="sticker-field">
                    <span class="sticker-field-lbl">รุ่น</span>
                    <span class="sticker-field-val">${escapeHtmlPrint(group.machineCode) || "-"}</span>
                </div>
                <div class="sticker-field">
                    <span class="sticker-field-lbl">เบอร์เครื่อง</span>
                    <span class="sticker-field-val"></span>
                </div>
            </div>
            <div class="sticker-block">
                <span class="sticker-field-lbl">อะไหล่ที่แกะ</span>
                <div class="sticker-blank-area">${buildStickerPartsHtml(group)}</div>
            </div>
            <div class="sticker-line sticker-line-tall">
                <div class="sticker-field">
                    <span class="sticker-field-lbl">หมายเหตุ</span>
                    <span class="sticker-field-val ${String(remark || "").length > 90 ? "rm-sm" : String(remark || "").length > 45 ? "rm-md" : ""}">${escapeHtmlPrint(remark)}</span>
                </div>
            </div>
            <div class="sticker-line sticker-footer-line">
                <div class="sticker-field">
                    <span class="sticker-field-lbl">ผู้ขอแกะอะไหล่</span>
                    <span class="sticker-field-val">${escapeHtmlPrint(doc.RequestedByName) || "-"}</span>
                </div>
                <div class="sticker-field">
                    <span class="sticker-field-lbl">ช่าง</span>
                    <span class="sticker-field-val"></span>
                </div>
            </div>
        </div>`;
      }

      let currentStickerDoc = null;
      let currentStickerGroups = [];

      async function printPartsSticker(docId) {
        showNotification(
          "กำลังดึงข้อมูล",
          `กำลังดึงข้อมูลเอกสาร ${docId} เพื่อเตรียมพิมพ์บัตรขอแกะอะไหล่...`,
          "warning",
        );
        try {
          const res = await n8nFetch(
            N8N_BASE + "get_document_detail_disassembly",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ docId }),
            },
          );
          if (!res.ok) throw new Error("โหลดข้อมูลไม่สำเร็จ");
          const raw = await res.json();
          const doc = Array.isArray(raw) ? raw[0] || {} : raw;
          if (!doc || !doc.DocId) throw new Error("ไม่พบข้อมูลเอกสาร");

          const stickerRound = Number(doc.RoundNo) || 1;
          const items = (doc.items || []).filter((it) => (Number(it.RoundNo) || 1) === stickerRound);
          if (items.length === 0) {
            showNotification(
              "ไม่มีรายการอะไหล่",
              "เอกสารนี้ยังไม่มีรายการอะไหล่ ไม่สามารถสร้างบัตรขอแกะอะไหล่ได้",
              "error",
            );
            return;
          }

          currentStickerDoc = doc;
          currentStickerGroups = groupItemsByMachineCode(items);

          document.getElementById("stickerPreviewDocId").textContent =
            doc.DocId;
          document.getElementById("stickerCountText").textContent =
            currentStickerGroups.length;
          document.getElementById("stickerPreviewList").innerHTML =
            currentStickerGroups
              .map(
                (g) => `
            <div class="bg-white rounded-lg shadow-sm border border-slate-300 p-2">
                ${buildStickerCardHtml(doc, g)}
            </div>`,
              )
              .join("");

          openModal("stickerPreviewModal", "stickerPreviewModalContent");
          lucide.createIcons();
        } catch (err) {
          showNotification("โหลดข้อมูลไม่สำเร็จ", err.message, "error");
        }
      }

      function closeStickerPreviewModal() {
        closeModal("stickerPreviewModal", "stickerPreviewModalContent");
      }

      // ตั้งค่า @page ให้เป็นขนาดสติ๊กเกอร์ (80mm x 40mm แนวนอน) เฉพาะตอนพิมพ์บัตร แล้วเอาออกหลังพิมพ์เสร็จ
      // ไม่แก้ @page เดิมตรงๆ เพราะต้องใช้ร่วมกับการพิมพ์เอกสาร A4 ปกติ (#printArea) ในหน้าเดียวกัน
      // 🔧 23/09/2569 (รอบ 3) : เดิม appendChild ใส่ไว้ใน <head> แต่กฎ @page เดิม (size: portrait) อยู่ใน
      // <style> ที่วางอยู่ใน <body> (หลัง #printArea) ซึ่งมาทีหลัง <head> ใน DOM เสมอ ลำดับ cascade ของ
      // @page จึงยึดตำแหน่งใน DOM ไม่ใช่เวลาที่แทรกด้วย JS ทำให้กฎเดิม (portrait, A4) ชนะตลอด ขนาดจึงไม่เปลี่ยน
      // แก้โดยย้ายไปแปะท้าย <body> แทน เพื่อให้มาทีหลังกฎเดิมเสมอและชนะ cascade จริง
      function setStickerPageStyle(enable) {
        let tag = document.getElementById("stickerPageSizeStyle");
        if (enable) {
          if (!tag) {
            tag = document.createElement("style");
            tag.id = "stickerPageSizeStyle";
          }
          document.body.appendChild(tag);
          tag.textContent =
            "@media print { @page { size: 80mm 40mm; margin: 0; } }";
        } else if (tag) {
          tag.remove();
        }
      }

      function printStickers() {
        if (!currentStickerDoc || currentStickerGroups.length === 0) return;
        const printArea = document.getElementById("stickerPrintArea");
        printArea.innerHTML = currentStickerGroups
          .map((g) => buildStickerCardHtml(currentStickerDoc, g))
          .join("");

        setStickerPageStyle(true);
        document.body.classList.add("printing-stickers");
        window.print();
        setTimeout(() => {
          document.body.classList.remove("printing-stickers");
          setStickerPageStyle(false);
          printArea.innerHTML = "";
        }, 500);
      }

      // ===================================================================
      // Docflow (เส้นทางการเดินเอกสาร) — แยกเป็นปุ่ม/modal ต่างหาก ตรงกับ swap_product.html
      // ===================================================================
      async function showDocFlow(docId) {
        const docFlowContent = document.getElementById("docFlowContent");
        docFlowContent.innerHTML = `
                <div class="flex flex-col items-center justify-center py-8 gap-3 text-slate-400">
                    <svg class="animate-spin h-6 w-6 text-brand-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span class="text-sm">กำลังดึงข้อมูล Docflow...</span>
                </div>`;
        openModal("docFlowModal", "docFlowModalContent");

        let doc = null;
        let logs = [];
        try {
          const [detailRes, flowRes] = await Promise.all([
            n8nFetch(N8N_BASE + "get_document_detail_disassembly", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ docId }),
            }),
            n8nFetch(N8N_BASE + "get_docflow_disassembly", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ docId }),
            }),
          ]);
          const rawDoc = await detailRes.json();
          // ⚠️ กัน response ที่เป็น array ห่อ object ไว้ — ถ้าไม่กัน ตัว `if (!doc)` ด้านล่างจะผ่านไปเฉยๆ
          // เพราะ array ที่มีของอยู่ข้างในถือว่า truthy แต่ field ต่างๆ จะเป็น undefined หมด
          doc = Array.isArray(rawDoc) ? rawDoc[0] || null : rawDoc;
          const rawLogs = await flowRes.json();
          logs = (Array.isArray(rawLogs) ? rawLogs : []).filter(
            (log) => log && log.ActionAt,
          );
        } catch (err) {
          console.error("Docflow fetch error:", err);
        }

        if (!doc) {
          docFlowContent.innerHTML = `<p class="text-center text-sm text-slate-400 py-6">ไม่พบข้อมูลเอกสาร</p>`;
          return;
        }

        const curRound = Number(doc.RoundNo) || 1;
        const isCancelled = doc.Status === "ยกเลิก";

        // 🆕 สร้างเส้นเวลา 7 ขั้นตอน (รอบแกะเพิ่ม = ไม่มีขั้นคลังสินค้า เหลือ 6 ขั้นและเรียงเลขใหม่)
        const buildFlowTimelineHtml = (h, isExtra, cancelled) => {
          const stepStyle = (done) =>
            done ? "bg-emerald-500 text-white" : cancelled ? "bg-red-100 text-red-400" : "bg-slate-200 text-slate-400";
          const stepIcon = (done) => (done ? "check" : cancelled ? "x" : "minus");
          const steps = [
            { done: true, title: "ผู้ขออนุมัติ", name: h.RequestedByName || "—",
              status: `<div class="text-xs text-emerald-600 font-semibold mt-1">✓ ยื่นคำขอเมื่อ ${formatThaiDate(h.DocDate)}</div>` },
            { done: h.StepNo >= 1, title: "เจ้าหน้าที่การตลาด", name: h.MarketingByName || "รอดำเนินการ",
              status: h.MarketingAt ? `<div class="text-xs text-emerald-600 font-semibold mt-1">✓ เซ็นเมื่อ ${formatThaiDate(h.MarketingAt)}</div>` : `<div class="text-xs text-amber-500 font-semibold mt-1">⏳ รอดำเนินการ</div>` },
            { done: h.StepNo >= 2, title: "ผู้อนุมัติ (ผู้บริหาร)", name: h.ApprovedByName || "รอดำเนินการ",
              status: h.ApprovedAt ? `<div class="text-xs text-emerald-600 font-semibold mt-1">✓ เซ็นเมื่อ ${formatThaiDate(h.ApprovedAt)}</div>` : `<div class="text-xs text-slate-400 font-semibold mt-1">— ยังไม่ดำเนินการ</div>` },
            ...(isExtra ? [] : [{ done: h.StepNo >= 3, title: "เจ้าหน้าที่คลังสินค้า", name: h.WarehouseByName || h.WarehouseNotifyName || "รอดำเนินการ",
              status: h.WarehouseAt ? `<div class="text-xs text-emerald-600 font-semibold mt-1">✓ ยืนยันย้าย Stock เมื่อ ${formatThaiDate(h.WarehouseAt)}</div>` : `<div class="text-xs text-slate-400 font-semibold mt-1">— ยังไม่ดำเนินการ</div>` }]),
            { done: h.StepNo >= 5, title: "เจ้าหน้าที่แผนกเทคนิคและช่าง", name: h.TechnicianByName || h.TechnicianNotifyName || "รอดำเนินการ",
              status: h.TechnicianAt ? `<div class="text-xs text-emerald-600 font-semibold mt-1">✓ แกะอะไหล่เสร็จเมื่อ ${formatThaiDate(h.TechnicianAt)}</div>` : `<div class="text-xs text-slate-400 font-semibold mt-1">— ยังไม่ดำเนินการ</div>` },
            { done: h.StepNo >= 6, title: "เจ้าหน้าที่แผนก SCM", name: h.ScmByName || h.ScmNotifyName || "รอดำเนินการ",
              status: h.ScmAt ? `<div class="text-xs text-emerald-600 font-semibold mt-1">✓ ตรวจสอบเมื่อ ${formatThaiDate(h.ScmAt)} (เลข ODO: ${h.OdoNumber || "-"})</div>` : `<div class="text-xs text-slate-400 font-semibold mt-1">— ยังไม่ดำเนินการ</div>` },
            { done: h.StepNo >= 7, title: "เจ้าหน้าที่คลังอะไหล่", name: h.PartsWarehouseByName || h.PartsWarehouseNotifyName || "รอดำเนินการ",
              status: h.PartsWarehouseAt ? `<div class="text-xs text-emerald-600 font-semibold mt-1">✓ รับอะไหล่เมื่อ ${formatThaiDate(h.PartsWarehouseAt)}</div>` : `<div class="text-xs text-slate-400 font-semibold mt-1">— ยังไม่ดำเนินการ</div>` },
          ];
          return `<div class="relative pl-7 border-l-2 border-slate-200 space-y-6">` + steps.map((st, i) => `
                        <div class="relative">
                            <span class="absolute -left-[29px] top-0.5 flex h-5 w-5 items-center justify-center rounded-full ${stepStyle(st.done)} ring-4 ring-white">
                                <i data-lucide="${i === 0 ? "check" : stepIcon(st.done)}" class="w-3 h-3"></i>
                            </span>
                            <div class="text-base font-bold text-slate-800">${i + 1}. ${st.title}</div>
                            <div class="text-sm text-slate-500 mt-0.5">${st.name}</div>
                            ${st.status}
                        </div>`).join("") + `</div>`;
        };

        // 🆕 จัดกลุ่ม log ตามรอบ (ถ้า DB ยังไม่ส่ง RoundNo ให้นับจาก EXTRA_ROUND_CREATE)
        let runningRound = 1;
        const sortedLogs = [...logs].sort((x, y) => new Date(x.ActionAt) - new Date(y.ActionAt));
        sortedLogs.forEach((log) => {
          if (log.Action === "EXTRA_ROUND_CREATE") runningRound++;
          log._round = Number(log.RoundNo) > 0 ? Number(log.RoundNo) : runningRound;
        });
        const logItemHtml = (log) => `
                <div class="flex items-start gap-2.5">
                    <div class="w-1.5 h-1.5 rounded-full ${log.Action === "EXTRA_ROUND_CREATE" ? "bg-violet-500" : "bg-brand-500"} mt-1.5 shrink-0"></div>
                    <div>
                        <p class="text-sm font-medium text-slate-700">${log.Detail || log.Action}</p>
                        <p class="text-xs text-slate-400">${log.ActionBy || ""} • ${formatThaiDateTime(log.ActionAt)}</p>
                    </div>
                </div>`;
        const logsOfRound = (n) => sortedLogs.filter((l) => l._round === n).map(logItemHtml).join("");
        const roundTitle = (n) => (n <= 1 ? "รอบที่ 1 — แกะอะไหล่ครั้งแรก" : `รอบที่ ${n} — แกะอะไหล่เพิ่มเติม ครั้งที่ ${n - 1}`);

        // รอบก่อนหน้า (พับเก็บไว้) — ใช้สำเนาที่เก็บตอนเปิดรอบใหม่
        const prevRoundsHtml = (doc.rounds || [])
          .slice()
          .sort((x, y) => Number(x.roundNo) - Number(y.roundNo))
          .map((r) => {
            const n = Number(r.roundNo);
            const h = r.header || {};
            const lg = logsOfRound(n);
            return `
                    <details class="rounded-xl border border-slate-200 bg-slate-50/50 p-3">
                        <summary class="cursor-pointer text-sm font-bold text-slate-600">${roundTitle(n)} <span class="ml-1 text-emerald-600">(เสร็จสิ้น)</span></summary>
                        <div class="mt-4 space-y-4">
                            ${buildFlowTimelineHtml(h, n > 1, false)}
                            ${lg ? `<div class="pt-3 border-t border-slate-100 space-y-2.5">${lg}</div>` : ""}
                        </div>
                    </details>`;
          })
          .join("");

        const curLogs = logsOfRound(curRound);

        docFlowContent.innerHTML = `
                <div class="space-y-4">
                    <div class="flex items-center justify-between mb-2">
                        <span class="text-sm font-bold text-slate-400 uppercase tracking-wider">เลขที่เอกสาร</span>
                        <span class="font-mono text-sm font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded">${doc.DocId}</span>
                    </div>
                    <div class="flex items-center justify-between mb-4">
                        <span class="text-sm font-bold text-slate-400 uppercase tracking-wider">สถานะปัจจุบัน</span>
                        <span class="text-sm">${getStatusBadge(doc)}</span>
                    </div>

                    ${prevRoundsHtml ? `<div class="space-y-2">${prevRoundsHtml}</div>` : ""}

                    ${curRound > 1 ? `<div class="text-sm font-bold text-violet-700 bg-violet-50 border border-violet-100 rounded-lg px-3 py-1.5">${roundTitle(curRound)} <span class="font-normal">(รอบปัจจุบัน)</span></div>` : ""}
                    ${buildFlowTimelineHtml(doc, curRound > 1, isCancelled)}

                    ${
                      curLogs
                        ? `
                    <div class="pt-3 border-t border-slate-100 space-y-2.5">
                        <h4 class="text-xs font-bold text-slate-400 uppercase tracking-wider">ประวัติเพิ่มเติม${curRound > 1 ? " (รอบปัจจุบัน)" : ""}</h4>
                        ${curLogs}
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

      // ===================================================================
      // Modal ยืนยันการลบ (แทนที่ confirm() ของเบราว์เซอร์ ให้ตรงกับ swap_product.html)
      // ===================================================================
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

      // ===================================================================
      // Modal ยืนยันการกู้คืนเอกสาร (เฉพาะ Admin)
      // ===================================================================
      function openRestoreDocModal(docId) {
        document.getElementById("restoreDocIdDisplay").textContent = docId;
        const confirmBtn = document.getElementById("confirmRestoreDocBtn");
        confirmBtn.onclick = function () {
          restoreDocument(docId);
        };
        openModal("restoreDocModal", "restoreDocModalContent");
      }

      function closeRestoreDocModal() {
        closeModal("restoreDocModal", "restoreDocModalContent");
      }

      // ===================================================================
      // Modal ถอยสถานะเอกสาร (เฉพาะ Admin) — 🆕 23/09/2569
      // ===================================================================
      const ADMIN_REVERT_WEBHOOK = "admin_revert_stage_disassembly"; // ต้องตรงกับ Webhook path จริงใน n8n

      const DISASSEMBLY_STAGE_LABELS = {
        0: "รอเจ้าหน้าที่การตลาด",
        1: "รอผู้บริหารอนุมัติ",
        2: "รอคลังสินค้า",
        3: "รอช่างเทคนิค",
        5: "รอ SCM",
        6: "รอคลังอะไหล่",
      };
      // StepNo 7 (เสร็จสิ้น) ไม่อยู่ใน DISASSEMBLY_STAGE_LABELS แต่ยังถอยได้ปกติ
      // เพราะเงื่อนไขกรองใช้ "step < currentStep" ซึ่ง 0-6 ทุกตัวน้อยกว่า 7 อยู่แล้ว

      let adminRevertCurrentDocId = null;

      function openAdminRevertModal(docId) {
        const doc = allDocuments.find((d) => d.DocId === docId);
        if (!doc) {
          showNotification(
            "ไม่พบเอกสาร",
            "ไม่พบข้อมูลเอกสารนี้ในรายการปัจจุบัน กรุณารีเฟรชหน้าแล้วลองใหม่",
            "error",
          );
          return;
        }

        adminRevertCurrentDocId = docId;
        const currentStep = doc.StepNo;

        document.getElementById("adminRevertDocIdDisplay").textContent = docId;
        document.getElementById("adminRevertReason").value = "";
        document.getElementById("adminRevertSendEmail").checked = true;

        const select = document.getElementById("adminRevertTargetStep");
        select.innerHTML = "";
        Object.keys(DISASSEMBLY_STAGE_LABELS)
          .map(Number)
          .filter((step) => step < currentStep)
          .filter((step) => !(step === 2 && Number(doc.RoundNo) > 1)) // 🆕 รอบแกะเพิ่มไม่มีขั้นคลังสินค้า
          .sort((a, b) => a - b)
          .forEach((step) => {
            const opt = document.createElement("option");
            opt.value = step;
            opt.textContent = DISASSEMBLY_STAGE_LABELS[step];
            select.appendChild(opt);
          });

        if (select.options.length === 0) {
          showNotification(
            "ถอยสถานะไม่ได้",
            "เอกสารนี้อยู่ที่ขั้นแรกอยู่แล้ว ไม่มีขั้นก่อนหน้าให้ถอยกลับ",
            "error",
          );
          return;
        }

        openModal("adminRevertModal", "adminRevertModalContent");
        lucide.createIcons();
      }

      function closeAdminRevertModal() {
        closeModal("adminRevertModal", "adminRevertModalContent");
      }

      async function submitAdminRevertStage() {
        const docId = adminRevertCurrentDocId;
        const targetStep = Number(
          document.getElementById("adminRevertTargetStep").value,
        );
        const reason = document.getElementById("adminRevertReason").value.trim();
        const sendEmail = document.getElementById("adminRevertSendEmail").checked;

        if (!reason) {
          showNotification("กรอกไม่ครบ", "กรุณาระบุเหตุผลในการถอยสถานะ", "error");
          return;
        }

        const btn = document.getElementById("confirmAdminRevertBtn");
        btn.disabled = true;
        const originalBtnText = btn.textContent;
        btn.textContent = "กำลังบันทึก...";

        try {
          const res = await n8nFetch(N8N_BASE + ADMIN_REVERT_WEBHOOK, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              docId,
              targetStep,
              reason,
              sendEmail,
              actionByEmpId: empId,
              actionByName: empName,
            }),
          });
          const data = await res.json();

          if (
            !res.ok ||
            data.valid === false ||
            (data.errorMessage && data.errorMessage.length > 0)
          ) {
            showNotification(
              "ถอยสถานะไม่สำเร็จ",
              extractErrorMessage({ error: data.errorMessage }),
              "error",
            );
            return;
          }

          showNotification("สำเร็จ", "ถอยสถานะเอกสารเรียบร้อยแล้ว", "success");
          closeAdminRevertModal();
          await fetchAllDocuments();
        } catch (err) {
          showNotification("เกิดข้อผิดพลาด", err.message, "error");
        } finally {
          btn.disabled = false;
          btn.textContent = originalBtnText;
        }
      }

      // อะนิเมชันการเปิด-ปิด Modal (เหมือนกับ swap_product.html)
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

      // อ่านข้อความ error ให้ครอบคลุมทุกรูปแบบที่ n8n อาจตอบกลับมา:
      // - { success:false, error:"..." }  จาก workflow ที่ใช้ IF + Respond to Webhook
      // - { message:"..." } หรือ { description:"..." } จาก n8n เองตอน Code node throw Error แล้วไม่มี Respond node จับ
      function extractErrorMessage(
        result,
        fallback = "เกิดข้อผิดพลาดไม่ทราบสาเหตุ กรุณาลองใหม่อีกครั้ง",
      ) {
        if (!result) return fallback;
        return result.error || result.message || result.description || fallback;
      }

      // ระบบแจ้งเตือน Toast (เหมือนกับ swap_product.html เป๊ะ)
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
      }

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

      // ⚠️ Auto-open: ถ้า URL มี ?doc=... (เช่น ลิงก์จากอีเมลแจ้งเตือน) ให้เปิดเอกสารนั้นให้อัตโนมัติ
      // ต้องรอ fetchAllDocuments() โหลดเสร็จก่อน เพราะ openEditDocModal() เช็คสิทธิ์แก้ไขจาก allDocuments
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
          // ค่าเริ่มต้น (เช่น จากอีเมล "แจ้งเตือน Marketing/Approver") → เปิดโหมดแก้ไขให้ผู้สร้างแก้ไขได้ทันที
          openEditDocModal(docId);
        }
      }

      // ================= เอกสารแนบ + Fast-track =================
      // เก็บ Base64 ของไฟล์ที่เพิ่งเลือกไว้ในตัวแปร (ส่งไปกับ payload ตอนกดบันทึก)
      let attachmentData = { base64: "", fileName: "", fileType: "" };
      // true = โหมดแก้ไขและยังใช้ไฟล์เดิมที่เคยอัปโหลดไว้ (ไม่ได้เลือกไฟล์ใหม่)
      let keepExistingAttachment = false;
      // ไฟล์แนบเดิมที่ดึงมาจาก SQL (ใช้สำหรับปุ่มเปิดดู/ดาวน์โหลด)
      let existingAttachment = { base64: "", fileName: "", fileType: "" };

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
          ? "เอกสารจะข้ามขั้นผู้บริหาร ส่งตรงไปคลังสินค้าทันทีหลังการตลาดอนุมัติ"
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
          document.getElementById("attachmentCurrentName").textContent =
            `แนบไฟล์: ${file.name}`;
          document
            .getElementById("attachmentCurrentInfo")
            .classList.remove("hidden");
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

      // ตั้งค่าส่วนเอกสารแนบ/Fast-track กลับเป็นค่าเริ่มต้น (ใช้ตอนเปิดฟอร์มสร้างใหม่)
      function resetAttachmentSection() {
        const radioNo = document.querySelector(
          'input[name="hasAttachmentRadio"][value="0"]',
        );
        if (radioNo) radioNo.checked = true;
        onAttachmentToggle(false);
      }

      // เติมข้อมูลเอกสารแนบ/Fast-track ตอนเปิดเอกสารเดิม (Edit/Display)
      function fillAttachmentFromDoc(doc) {
        const hasAtt =
          doc.HasAttachment === true || Number(doc.HasAttachment) === 1;
        const radio = document.querySelector(
          `input[name="hasAttachmentRadio"][value="${hasAtt ? "1" : "0"}"]`,
        );
        if (radio) radio.checked = true;
        onAttachmentToggle(hasAtt);

        if (hasAtt && doc.attachmentFileName) {
          // ไฟล์เดิมที่เคยอัปโหลดไว้ — ยังไม่ต้องส่ง Base64 ซ้ำจนกว่าผู้ใช้จะเลือกไฟล์ใหม่
          keepExistingAttachment = true;
          attachmentData = { base64: "", fileName: "", fileType: "" };
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
        }

        const skipChk = document.getElementById("skipApprover");
        if (skipChk) {
          skipChk.checked =
            doc.SkipApprover === true || Number(doc.SkipApprover) === 1;
        }
        lucide.createIcons();
      }

      window.onload = async function () {
        if (typeof renderSidebar === "function") renderSidebar();
        const mobileSidebarContainer = document.getElementById(
          "mobile-sidebar-content",
        );
        const sidebarContainer = document.getElementById("sidebar-container");
        if (mobileSidebarContainer && sidebarContainer) {
          mobileSidebarContainer.innerHTML = sidebarContainer.innerHTML;
        }
        await fetchAllDocuments();
        loadDisassemblyRoleMembers();
        lucide.createIcons();
        openFromUrlIfNeeded();
      };
