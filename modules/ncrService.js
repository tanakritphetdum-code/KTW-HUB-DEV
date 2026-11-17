// ===================================================================
// modules/ncrService.js — Service Logic สำหรับ KTW HUB
// ===================================================================

      const N8N_BASE = "https://n8n.ktw.co.th/webhook/";

      // ================= Dynamic Dropdown: ผู้บริหาร / SCM / การตลาด =================
      // ดึงรายชื่อจาก NcrEmployeeRole ผ่าน Backend แทนการ Hardcode ในโค้ด (คนเข้า-ออกทีมไม่ต้องแก้ไฟล์นี้)
      let ncrRoleMembers = { approver: [], scm: [], marketing: [], mcm: [], spm: [] };

      async function loadNcrRoleMembers() {
        try {
          // ⚠️ ต้องใช้ n8nFetch() ไม่ใช่ fetch() เปล่า ๆ
          //    webhook get_ncr_role_members เปลี่ยนเป็น Header Auth แล้ว (เดิมเปิดโล่งไม่มี auth
          //    ซึ่งคืนชื่อกับอีเมลพนักงานทุกคนที่มี NCR role ให้ใครก็ได้ที่รู้ URL)
          //    fetch() เปล่าจะได้ 403 แล้วขึ้น "โหลดรายชื่อผู้อนุมัติไม่สำเร็จ"
          const res = await n8nFetch(`${N8N_BASE}get_ncr_role_members`);
          if (!res.ok) throw new Error("โหลดรายชื่อผู้อนุมัติไม่สำเร็จ");
          // อ่าน text ก่อนเสมอ กัน response ว่างแล้ว res.json() โยน error
          const rawText = await res.text();
          const parsed = rawText && rawText.trim() ? JSON.parse(rawText) : {};
          ncrRoleMembers = Array.isArray(parsed)
            ? parsed[0] || {}
            : parsed || {};
        } catch (err) {
          console.error("loadNcrRoleMembers error", err);
          showNotification(
            "โหลดรายชื่อผู้อนุมัติไม่สำเร็จ",
            "กรุณารีเฟรชหน้าใหม่ หรือติดต่อผู้ดูแลระบบ",
            "error",
          );
        }
        populateApproverDropdown("midApproverName", ncrRoleMembers.approver);
        populateApproverDropdown("scmApproverName", ncrRoleMembers.scm);
        populateApproverDropdown(
          "marketingApproverName",
          ncrRoleMembers.marketing,
        );
        populateApproverDropdown("pqmApproverName", ncrRoleMembers.pqm);
        populateApproverDropdown("logApproverName", ncrRoleMembers.mcm);
        populateApproverDropdown("spmApproverName", ncrRoleMembers.spm);
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

      // เรียกตอนเลือกชื่อจาก Dropdown — auto-fill email + เก็บ EmpId ไว้ใน hidden input
      function onApproverSelectChange(type) {
        const map = {
          mid: {
            select: "midApproverName",
            email: "midApproverEmail",
            empId: "midApproverEmpId",
          },
          scm: {
            select: "scmApproverName",
            email: "scmApproverEmail",
            empId: "scmApproverEmpId",
          },
          marketing: {
            select: "marketingApproverName",
            email: "marketingApproverEmail",
            empId: "marketingApproverEmpId",
          },
          pqm: {
            select: "pqmApproverName",
            email: "pqmApproverEmail",
            empId: "pqmApproverEmpId",
          },
          log: {
            select: "logApproverName",
            email: "logApproverEmail",
            empId: "logApproverEmpId",
          },
          spm: {
            select: "spmApproverName",
            email: "spmApproverEmail",
            empId: "spmApproverEmpId",
          },
        };
        const cfg = map[type];
        if (!cfg) return;
        const select = document.getElementById(cfg.select);
        const selectedOption = select.options[select.selectedIndex];
        document.getElementById(cfg.email).value = selectedOption
          ? selectedOption.dataset.email || ""
          : "";
        document.getElementById(cfg.empId).value = selectedOption
          ? selectedOption.dataset.empId || ""
          : "";
      }

      let itemRowCounter = 0;
      let allDocuments = [];

      const empId = sessionStorage.getItem("emp_id") || "";
      const empName = sessionStorage.getItem("name") || "";
      const empEmail = sessionStorage.getItem("email") || "";
      // สิทธิ์เฉพาะระบบ NCR (ตั้งไว้ตอน login ผ่าน webhook get_ncr_role)
      const ncrRole = sessionStorage.getItem("ncr_role") || "0";
      const isAdminUser = ncrRole === "1";

      // ===== สิทธิ์รายข้อจากระบบ Permission (fail-safe: ยังไม่พร้อม → ใช้กติกา Role เดิม) =====
      // ⚠️ ซ่อน/แสดงปุ่มเพื่อ UX เท่านั้น ตัวบังคับจริงอยู่ที่ n8n (Check Permission) ทุก endpoint
      const PSYS = "NCR";
      function pReady() { return !!(window.KTWPerm && window.KTWPerm.isReady()); }
      function pcan(act, legacy) { return pReady() ? window.KTWPerm.can(PSYS, act) : !!legacy; }
      function pAnyOwn(any, own, isOwner, legacy) {
        return pReady() ? (window.KTWPerm.can(PSYS, any) || (window.KTWPerm.can(PSYS, own) && !!isOwner)) : !!legacy;
      }
      window.addEventListener("ktwperm", function (e) {
        if (typeof __permApply === "function") __permApply(!!(e.detail && e.detail.changed));
      });
      // 🆕 05/10/2569 : ปุ่มถอยสถานะ — Admin (1) และ SCM (7) ถอยได้ (ต้องตรงกับ SQL - Admin Revert Stage (NCR) ฝั่ง n8n)
      let canRevertStage = pcan("RETURN_STATUS", ncrRole === "1" || ncrRole === "7");
      // Role SCM (7) มองเห็นเอกสารทุกใบได้เหมือน Admin — แต่ไม่มีสิทธิ์แก้ไข/ลบเพิ่มเติมจากเดิม
      const isScmUser = ncrRole === "7";
      // ⚠️ ทุก Role ที่มีหน้าที่อนุมัติ/ตรวจสอบ (1-7) ต้องเห็นเอกสารทุกใบ ไม่ใช่แค่ Admin กับ SCM
      //    เดิมกรองไว้แค่ 2 role ทำให้ PQM/Approver/Marketing/MCM-LOG/SPM มองไม่เห็นอะไรเลย
      //    เงื่อนไขชุดนี้ต้องตรงกับ SQL - Get All NCR Document Status ฝั่ง n8n เสมอ
      const NCR_APPROVAL_ROLES = ["1", "2", "3", "4", "5", "7", "8"];
      let hasNcrApprovalRole = pcan("READ_ALL", NCR_APPROVAL_ROLES.includes(ncrRole));

      // เทียบรหัสพนักงานแบบตัดช่องว่างหัวท้าย — คอลัมน์ EmpId ฝั่ง DB เป็น varchar
      // ค่าที่มีช่องว่างติดมาจะทำให้ === ไม่ตรงทั้งที่เป็นคนเดียวกัน
      function isSameEmp(a, b) {
        return String(a ?? "").trim() === String(b ?? "").trim();
      }

      // ผู้ที่ถูกระบุชื่อไว้บนเอกสารใบนั้นโดยตรง ต้องเห็นใบนั้น แม้ยังไม่มี role ในระบบ
      function isNamedOnDoc(doc) {
        return [
          doc.CreatedByEmpId,
          doc.MidApproverNotifyEmpId,
          doc.MarketingNotifyEmpId,
          doc.ScmNotifyEmpId,
          doc.PqmNotifyEmpId,
          doc.LogNotifyEmpId,
          doc.InboundAssigneeEmpId,
        ].some((id) => isSameEmp(id, empId));
      }

      // ⚠️ Movement Type ถูกกำหนดเป็นค่าคงที่ตามที่ระบุไว้ — แก้ค่านี้จุดเดียวถ้าต้องเปลี่ยน
      // ยืนยันแล้ว (26 ส.ค. 69): Movement Type ที่ถูกต้องคือ "551" ตามเอกสารกระดาษจริง
      const NCR_FIXED_MOVEMENT_TYPE = "551";

      let currentViewDocData = null;
      let currentPreviewDocData = null;

      // ================= ตารางประวัติเอกสาร =================
      async function fetchAllDocuments() {
        const icon = document.getElementById("syncHistoryIcon");
        icon.classList.add("animate-spin");
        try {
          const res = await n8nFetch(N8N_BASE + "get_all_ncr_document_status", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ empId: empId }),
          });

          if (!res.ok) throw new Error("โหลดข้อมูลไม่สำเร็จ");
          // ⚠️ อ่านเป็น text ก่อนเสมอ แล้วค่อย parse เอง
          //    ถ้า SQL คืน 0 แถว n8n จะตอบ body ว่างเปล่า แล้ว res.json() จะ throw
          //    ทำให้หน้าขึ้น "โหลดข้อมูลไม่สำเร็จ" ทั้งที่ความจริงคือ "ยังไม่มีเอกสาร"
          const rawText = await res.text();
          const data = rawText && rawText.trim() ? JSON.parse(rawText) : [];
          allDocuments = Array.isArray(data) ? data : [];
          // 🔒 จำกัดการมองเห็น: ผู้ที่มีสิทธิ์อนุมัติ/ตรวจสอบ (role 1-7) เห็นทุกใบ
          //    ส่วนคนที่ไม่มี role เห็นเฉพาะใบที่ตัวเองสร้าง หรือใบที่ถูกระบุชื่อไว้บนเอกสาร
          // ⚠️ นี่คือการกรองฝั่ง Frontend เพื่อ UX เท่านั้น ต้องตรงกับเงื่อนไขฝั่ง n8n/SQL เสมอ ไม่ควรเชื่อฝั่ง client อย่างเดียว
          if (!hasNcrApprovalRole) {
            allDocuments = allDocuments.filter((doc) => isNamedOnDoc(doc));
          }
          renderDocTable();
        } catch (err) {
          console.error(err);
          document.getElementById("docTableBody").innerHTML =
            '<tr><td colspan="8" class="px-4 py-8 text-center text-sm text-red-500">โหลดข้อมูลไม่สำเร็จ ลองซิงค์อีกครั้ง</td></tr>';
        } finally {
          icon.classList.remove("animate-spin");
        }
      }

      function getNcrTypeLabel(doc) {
        const map = {
          SCRAP: "SCRAP",
          SCRAP_PARTS: "SCRAP แยกเป็นอะไหล่",
          SCRAP_CLAIM_VENDOR: "SCRAP เคลม VENDOR",
          OTHER: doc.OtherTypeNote ? `อื่นๆ: ${doc.OtherTypeNote}` : "อื่นๆ",
        };
        return map[doc.NcrType] || doc.NcrType || "-";
      }

      // ⚠️ เอกสารที่ยังไม่ถึงขั้นการตลาด ค่า ClaimStatus จะเป็น NULL/ว่าง
      //    ของเดิมใช้ ternary ตรง ๆ ทำให้ค่าว่างถูกแสดงเป็น "เคลมไม่ได้" ทั้งที่ยังไม่มีใครตัดสิน
      //    ต้องคืนค่าว่างจนกว่าการตลาดจะเลือกจริง
      function getClaimStatusLabel(doc) {
        const v = String(doc.ClaimStatus || "").trim();
        if (v === "CLAIMABLE") return "เคลมได้";
        if (v === "NOT_CLAIMABLE") return "เคลมไม่ได้";
        return "";
      }

      // Badge สีของคอลัมน์ "สถานะการเคลม" ในตารางประวัติเอกสาร
      function getClaimStatusBadge(doc) {
        const label = getClaimStatusLabel(doc);
        // ยังไม่มีการตัดสิน → ไม่ต้องขึ้น badge อะไรเลย ปล่อยช่องว่าง
        if (!label) return '<span class="text-slate-300">-</span>';
        const colorClass =
          label === "เคลมได้"
            ? "bg-emerald-50 text-emerald-700 border border-emerald-100"
            : "bg-slate-100 text-slate-600 border border-slate-200";
        return `<span class="inline-flex items-center whitespace-nowrap rounded-lg px-2.5 py-1 font-bold ${colorClass}">${label}</span>`;
      }

      // สถานะแสดงผล ขึ้นอยู่กับ StepNo (จุดที่ NCR ต่างจาก SWAP/Disassembly)
      // StepNo Design ใหม่ (0-6) — ตัวเลขเดียวกัน = ความหมายเดียวกันเสมอ ไม่ว่า NcrType ไหน
      // 0=รอผู้บริหาร(รอบแรก) 1=รอMKT(เฉพาะVENDOR) 2=รอผู้บริหาร(รอบสอง เฉพาะFast-track+เคลมไม่ได้)
      // 3=รอSCM 4=รอน้องก้อง(MCM-LOG ยืนยันจบ) 5=รอSPM/MCM Inbound(เฉพาะSCRAP_PARTS) 6=จบ
      // 🆕 29/09/2569 : 98=เสร็จสิ้น (ไม่อนุมัติ) — เฉพาะ SCRAP_CLAIM_VENDOR ที่หัวหน้า SCM ไม่อนุมัติ (ปิดจบ ไม่ย้อนกลับ)
      //    ต้องเช็คก่อนเงื่อนไข StepNo >= 6 ไม่งั้นจะถูกเหมาเป็น "เสร็จสิ้น" ธรรมดา
      function getDisplayStatusLabel(doc) {
        // 🆕 03/10/2569 : เอกสารที่ถูกยกเลิก — เช็คก่อนทุกเงื่อนไข ไม่ว่า StepNo จะเป็นอะไร
        if (doc.Status === "ยกเลิก") return "ยกเลิก";
        if (doc.StepNo === 98) return "เสร็จสิ้น (ไม่อนุมัติ)";
        if (doc.Status === "เสร็จสิ้น" || doc.StepNo >= 6) return "เสร็จสิ้น";
        if (doc.StepNo === 0 || doc.StepNo === 2) return "รอผู้บริหารอนุมัติ";
        if (doc.StepNo === 1) return "รอเจ้าหน้าที่การตลาด";
        if (doc.StepNo === 3) return "รอเจ้าหน้าที่ SCM";
        if (doc.StepNo === 4) return "รอเจ้าหน้าที่แผนกโลจิสติกส์ยืนยัน";
        if (doc.StepNo === 5) return "รอเจ้าหน้าที่แผนกรับเข้าคลังอะไหล่";
        return "รอดำเนินการ";
      }

      function getStatusBadge(doc) {
        const label = getDisplayStatusLabel(doc);
        const colorMap = {
          รอผู้บริหารอนุมัติ: "bg-amber-50 text-amber-700 border border-amber-100",
          รอเจ้าหน้าที่การตลาด: "bg-pink-50 text-pink-700 border border-pink-100",
          "รอเจ้าหน้าที่ SCM": "bg-blue-50 text-blue-700 border border-blue-100",
          รอเจ้าหน้าที่แผนกโลจิสติกส์ยืนยัน: "bg-orange-50 text-orange-700 border border-orange-100",
          รอเจ้าหน้าที่แผนกรับเข้าคลังอะไหล่: "bg-lime-50 text-lime-700 border border-lime-100",
          เสร็จสิ้น: "bg-emerald-50 text-emerald-700 border border-emerald-100",
          "เสร็จสิ้น (ไม่อนุมัติ)": "bg-rose-50 text-rose-700 border border-rose-100",
          ยกเลิก: "bg-red-50 text-red-700 border border-red-100",
        };
        return `<span class="inline-flex items-center whitespace-nowrap rounded-lg px-2.5 py-1 font-bold ${colorMap[label] || "bg-slate-50 text-slate-600 border border-slate-100"}">${label}</span>`;
      }

      // แก้ไข/ลบได้เฉพาะตอนยังไม่มีใครกดอนุมัติเลยสักขั้น (ไม่ใช้ StepNo===0 เพราะ Fast-track เริ่มที่ StepNo อื่นได้)
      function isBeforeAnyApproval(doc) {
        return (
          !doc.MarketingAt && !doc.MidApproverAt && !doc.ScmAt && !doc.LogAt
        );
      }

      function canEditDocument(doc) {
        if (doc.Status === "ยกเลิก") return false; // เอกสารที่ยกเลิกแล้วต้องสร้างใหม่เท่านั้น
        if (!isBeforeAnyApproval(doc)) return false;
        const own = doc.CreatedByEmpId === empId;
        return pAnyOwn("UPDATE_ANY", "UPDATE_OWN", own, isAdminUser || own);
      }

      // ลบได้เฉพาะ Admin เท่านั้น และเฉพาะตอนยังไม่มีใครกดอนุมัติเลย
      function canDeleteDocument(doc) {
        if (!isBeforeAnyApproval(doc)) return false;
        return pAnyOwn("DELETE_ANY", "DELETE_OWN", doc.CreatedByEmpId === empId, isAdminUser);
      }

      // 🆕 03/10/2569 : ยกเลิกเอกสารได้ก่อนมีการอนุมัติขั้นใดเลย (สถานะเริ่มต้นหลังสร้างเอกสาร)
      //    เงื่อนไขสิทธิ์เหมือน canEditDocument เป๊ะ (ผู้สร้างเอกสาร หรือ Admin) ให้เหมือนกับระบบ Disassembly
      //    เพิ่มกันซ้ำ — ถ้าเอกสารถูกยกเลิกไปแล้วไม่ต้องแสดงปุ่มซ้ำอีก
      function canCancelDocument(doc) {
        if (doc.Status === "ยกเลิก") return false;
        if (!isBeforeAnyApproval(doc)) return false;
        const own = doc.CreatedByEmpId === empId;
        return pAnyOwn("CANCEL_ANY", "CANCEL_OWN", own, isAdminUser || own);
      }

      // ================= SORT & FILTER: ตารางประวัติเอกสาร =================
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
          ClaimStatus:
            document.getElementById("filter-ClaimStatus")?.value || "",
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
          ...new Set(docs.map((d) => d.CreatedByName).filter(Boolean)),
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
        [
          "DocId",
          "DocDate",
          "Purpose",
          "ClaimStatus",
          "CreatedByEmpId",
          "RequestedByName",
          "displayStatus",
        ].forEach((col) => {
          const el = document.getElementById(`filter-${col}`);
          if (el) el.value = "";
        });
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
        const claimStatusVal =
          document.getElementById("filter-ClaimStatus")?.value || "";
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
          if (purposeVal && doc.NcrType !== purposeVal) return false;
          if (claimStatusVal && doc.ClaimStatus !== claimStatusVal)
            return false;
          if (empIdVal && doc.CreatedByEmpId !== empIdVal) return false;
          if (requesterVal && doc.CreatedByName !== requesterVal) return false;
          if (statusVal && getDisplayStatusLabel(doc) !== statusVal)
            return false;
          return true;
        });
      }

      function sortDocData(docs) {
        const { column, direction } = docSortState;
        if (!column) return docs;

        const statusRank = {
          รอผู้บริหารอนุมัติ: 1,
          รอเจ้าหน้าที่การตลาด: 2,
          "รอเจ้าหน้าที่ SCM": 3,
          รอเจ้าหน้าที่แผนกโลจิสติกส์ยืนยัน: 4,
          รอเจ้าหน้าที่แผนกรับเข้าคลังอะไหล่: 5,
          เสร็จสิ้น: 6,
        };

        return [...docs].sort((a, b) => {
          let valA, valB;
          if (column === "displayStatus") {
            valA = statusRank[getDisplayStatusLabel(a)] || 0;
            valB = statusRank[getDisplayStatusLabel(b)] || 0;
          } else if (column === "DocDate") {
            valA = new Date(a.DocDate ?? "").getTime();
            valB = new Date(b.DocDate ?? "").getTime();
          } else if (column === "Purpose") {
            valA = String(a.NcrType ?? "").toLowerCase();
            valB = String(b.NcrType ?? "").toLowerCase();
          } else if (column === "ClaimStatus") {
            valA = String(a.ClaimStatus ?? "").toLowerCase();
            valB = String(b.ClaimStatus ?? "").toLowerCase();
          } else if (column === "RequestedByName") {
            valA = String(a.CreatedByName ?? "").toLowerCase();
            valB = String(b.CreatedByName ?? "").toLowerCase();
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
        canRevertStage = pcan("RETURN_STATUS", ncrRole === "1" || ncrRole === "7");
        hasNcrApprovalRole = pcan("READ_ALL", NCR_APPROVAL_ROLES.includes(ncrRole));
        if (changed && typeof fetchAllDocuments === "function") fetchAllDocuments();
        else renderDocTable();
      }

      function renderDocTable() {
        const tbody = document.getElementById("docTableBody");

        populateDocFilterOptions(allDocuments);

        if (allDocuments.length === 0) {
          tbody.innerHTML =
            '<tr><td colspan="8" class="px-4 py-8 text-center text-sm text-slate-400">ยังไม่มีเอกสาร</td></tr>';
          updateDocFilterIndicators();
          return;
        }

        let docs = applyDocFilters(allDocuments);
        docs = sortDocData(docs);

        if (docs.length === 0) {
          tbody.innerHTML =
            '<tr><td colspan="8" class="px-4 py-8 text-center text-sm text-slate-400">ไม่พบเอกสารที่ตรงกับเงื่อนไขการค้นหา/กรอง</td></tr>';
          updateDocSortIcons();
          updateDocFilterIndicators();
          return;
        }

        tbody.innerHTML = docs
          .map((doc) => {
            const showEdit = canEditDocument(doc);
            const showDelete = canDeleteDocument(doc);
            const showCancel = canCancelDocument(doc);
            return `
                <tr class="hover:bg-slate-50/50 transition-colors">
                    <td class="p-4 font-mono font-semibold text-slate-900">${doc.DocId}</td>
                    <td class="p-4 text-slate-600 font-light">${formatThaiDate(doc.DocDate)}</td>
                    <td class="p-4"><span class="text-slate-900 whitespace-nowrap">${getNcrTypeLabel(doc)}</span></td>
                    <td class="p-4">${getClaimStatusBadge(doc)}</td>
                    <td class="p-4 text-slate-500 font-mono">${doc.CreatedByEmpId || "-"}</td>
                    <td class="p-4 text-slate-700">${doc.CreatedByName || "-"}</td>
                    <td class="p-4">${getStatusBadge(doc)}</td>
                    <td class="p-4 text-right">
                        <div class="flex items-center justify-end gap-1">
                            <!-- 🔧 03/10/2569 : ข้อ 1 (ปรับตามที่ขอเพิ่มเติม) — ให้ตรงกับ SWAP/Disassembly:
                                 ไอคอนเอกสาร (file-text) = ปุ่ม Preview (กระดาษ, ทุก Role เห็น) → previewDocument()
                                 ไอคอนตา (eye, เฉพาะ Admin) = ปุ่ม Display (Modal เดียวกับ Create/Edit แต่ดูอย่างเดียว) → openDisplayDocModal() -->
                            <button onclick="previewDocument('${doc.DocId}')" title="ดูตัวอย่างเอกสาร (Preview)" class="p-1.5 rounded-lg text-slate-400 hover:bg-indigo-50 hover:text-indigo-600">
                                <i data-lucide="file-text" class="w-4 h-4"></i>
                            </button>
                            ${
                              isAdminUser
                                ? `
                            <button onclick="openDisplayDocModal('${doc.DocId}')" title="Display — ดูเอกสาร (อ่านอย่างเดียว)" class="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                                <i data-lucide="eye" class="w-4 h-4"></i>
                            </button>`
                                : ""
                            }
                            ${
                              showEdit
                                ? `
                            <button onclick="openEditDocModal('${doc.DocId}')" title="แก้ไข" class="p-1.5 rounded-lg text-slate-400 hover:bg-blue-50 hover:text-blue-600">
                                <i data-lucide="pencil" class="w-4 h-4"></i>
                            </button>`
                                : ""
                            }
                            <button onclick="showDocFlow('${doc.DocId}')" title="ดูความเคลื่อนไหว" class="p-1.5 rounded-lg text-slate-400 hover:bg-purple-50 hover:text-purple-600">
                                <i data-lucide="git-branch" class="w-4 h-4"></i>
                            </button>
                            <!-- 🆕 03/10/2569 : ปุ่มยกเลิกเอกสาร — แสดงเฉพาะสถานะเริ่มต้นหลังสร้าง (ยังไม่มีใครอนุมัติ)
                                 และเฉพาะผู้สร้างเอกสารเองหรือ Admin เท่านั้น ให้เหมือนกับระบบ Disassembly -->
                            ${
                              showCancel
                                ? `
                            <button onclick="openCancelDocModal('${doc.DocId}')" title="ยกเลิกเอกสาร" class="p-1.5 rounded-lg text-slate-400 hover:bg-orange-50 hover:text-orange-600">
                                <i data-lucide="ban" class="w-4 h-4"></i>
                            </button>`
                                : ""
                            }
                            ${
                              showDelete
                                ? `
                            <button onclick="openDeleteDocModal('${doc.DocId}')" title="ลบ" class="p-1.5 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600">
                                <i data-lucide="trash-2" class="w-4 h-4"></i>
                            </button>`
                                : ""
                            }
                            <!-- ปุ่มถอยสถานะ — Admin และ SCM -->
                            ${
                              canRevertStage && doc.Status !== "ยกเลิก"
                                ? `
                            <button onclick="openAdminRevertModal('${doc.DocId}')" title="ถอยสถานะ (Admin / SCM)" class="p-1.5 rounded-lg text-slate-400 hover:bg-amber-50 hover:text-amber-600">
                                <i data-lucide="undo-2" class="w-4 h-4"></i>
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

      // ⏰ เวลาใน DB NCR บันทึกด้วย GETDATE() = เวลาไทยอยู่แล้ว แต่ n8n ส่งมาเป็น "...Z" (ถูกมองว่าเป็น UTC)
      //    ถ้าให้ Browser แปลงตาม Timezone เครื่อง จะบวกเพิ่ม 7 ชม. → ต้องแสดงด้วย timeZone: "UTC" เพื่อให้ได้ค่าตรงกับที่เก็บใน DB
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

      function formatThaiDateTime(dateStr) {
        if (!dateStr) return "-";
        const d = new Date(dateStr);
        if (isNaN(d)) return dateStr;
        return d.toLocaleString("th-TH", { timeZone: "UTC" });
      }

      // ================= Modal สร้าง/แก้ไขเอกสาร =================
      function onNcrTypeChange() {
        const selected = document.querySelector(
          'input[name="ncrType"]:checked',
        )?.value;
        document
          .getElementById("otherTypeNoteWrap")
          .classList.toggle("hidden", selected !== "OTHER");

        const isVendor = selected === "SCRAP_CLAIM_VENDOR";
        const isParts = selected === "SCRAP_PARTS";

        // 🆕 25/09/2569 : "รายการอะไหล่ที่แยกได้" ย้ายไปให้เจ้าหน้าที่แผนกรับเข้าคลังอะไหล่กรอกที่ approve.html
        //    ตอนอนุมัติขั้น SPM แทนแล้ว — หน้าสร้าง/แก้ไขเอกสารนี้ไม่มีช่องนี้อีกต่อไป (isParts ยังใช้กับที่อื่นด้านล่าง)

        // กล่องเจ้าหน้าที่การตลาด — แสดงเฉพาะ SCRAP เคลม VENDOR เท่านั้น
        document
          .getElementById("marketingApproverBox")
          .classList.toggle("hidden", !isVendor);

        // กล่อง SPM/MCM Inbound — แสดงเฉพาะ SCRAP แยกเป็นอะไหล่ (SCRAP_PARTS) เท่านั้น (StepNo=5 มีแค่ Type นี้ที่ผ่าน)
        document
          .getElementById("spmApproverBox")
          .classList.toggle("hidden", !isParts);
        // Grid คงที่ 3 คอลัมน์เสมอ (wrap เป็นแถวใหม่อัตโนมัติเมื่อมีกล่องมากขึ้น เช่น PQM/MCM-LOG)

        // 🆕 26/09/2569 : "สถานะการเคลม" ไม่มีให้ผู้สร้างเลือกในหน้านี้อีกต่อไปแล้ว
        // (กำหนดทีหลังในขั้นถัดไปของ flow) — ถ้าเป็น VENDOR ให้เคลียร์ค่าเดิมทิ้งเสมอ
        // เพราะสถานะนี้ถูกกำหนดทีหลังโดยเจ้าหน้าที่การตลาดตอนอนุมัติ ไม่ใช่ตอนสร้างเอกสาร
        if (isVendor) {
          const claimStatusHidden = document.getElementById("claimStatusHidden");
          if (claimStatusHidden) claimStatusHidden.value = "";
        }
      }

      // เดิมเคยสลับ label ระหว่าง PQM (เคลมได้) กับ ผู้บริหาร (เคลมไม่ได้)
      // ตอนนี้ล็อคเป็น "ผู้บริหาร" ตายตัวสำหรับ NCR Type SCRAP/SCRAP_PARTS แล้ว ไม่ขึ้นกับ claimStatus อีกต่อไป
      // ฟังก์ชันนี้เก็บไว้เผื่อ logic อื่นในอนาคต แต่ไม่ทำอะไรกับ label แล้ว
      function onClaimStatusChange() {}

      // ================= เอกสารแนบจากคุณกมล (Fast-track) — สูงสุด 3 ไฟล์ =================
      // 📎 22/09/2569 : เปลี่ยนจากไฟล์เดี่ยวเป็นอาร์เรย์ รองรับได้สูงสุด 3 ไฟล์/เอกสาร
      let attachmentFiles = []; // [{ base64, fileName, fileType, size }, ...] ไฟล์ใหม่ที่เลือกรอบนี้
      // ⚠️ true เมื่อเปิดหน้าแก้ไขเอกสารที่ "มีไฟล์แนบอยู่แล้วใน DB"
      //    ใช้บอกความต่างระหว่าง "ยังไม่ได้เลือกไฟล์ใหม่ แต่ของเดิมยังอยู่" กับ "ยังไม่เคยแนบไฟล์เลย"
      //    ถ้าไม่มีตัวแปรนี้ การกดบันทึกโดยไม่เลือกไฟล์ใหม่จะติด validation ว่า "กรุณาแนบไฟล์"
      let existingAttachmentOnEdit = false;
      // เก็บไฟล์แนบเดิมที่โหลดมาจาก DB ตอนเปิดหน้าแก้ไข ไว้ให้ปุ่ม "ดูไฟล์" เปิดดูได้ (สูงสุด 3 ไฟล์)
      let existingAttachments = [];
      const ATTACHMENT_MAX_SIZE = 3 * 1024 * 1024; // 3 MB ต่อไฟล์
      const ATTACHMENT_MAX_COUNT = 3;
      const ATTACHMENT_ALLOWED_TYPES = [
        "application/pdf",
        "image/jpeg",
        "image/jpg",
        "image/png",
      ];

      function onHasAttachmentChange() {
        const selected = document.querySelector(
          'input[name="hasAttachment"]:checked',
        )?.value;
        const isYes = selected === "YES";
        document
          .getElementById("attachmentSection")
          .classList.toggle("hidden", !isYes);
        if (!isYes) {
          // ยกเลิกการแนบไฟล์ + เคลียร์ "ไม่ผ่านผู้บริหาร" ถ้าสลับกลับมาเป็น "ไม่มีเอกสารแนบ"
          document.getElementById("attachmentFile").value = "";
          document.getElementById("skipApprover").checked = false;
          attachmentFiles = [];
          renderAttachmentFileList();
          hideExistingAttachmentBox();
        }
      }

      // ===== รายการไฟล์ใหม่ที่เลือกไว้รอบนี้ =====
      function renderAttachmentFileList() {
        const listEl = document.getElementById("attachmentFileList");
        if (!listEl) return;
        listEl.innerHTML = attachmentFiles
          .map(
            (f, idx) => `
          <div class="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5">
            <span class="text-[11px] text-slate-700 truncate flex-1">แนบไฟล์แล้ว: ${f.fileName} (${(f.size / 1024).toFixed(0)} KB)</span>
            <button type="button" onclick="removeAttachmentFile(${idx})"
              class="shrink-0 px-2 py-0.5 rounded-md bg-white border border-slate-200 text-[11px] font-semibold text-red-500 hover:bg-red-50">ลบ</button>
          </div>`,
          )
          .join("");
      }

      function removeAttachmentFile(idx) {
        attachmentFiles.splice(idx, 1);
        renderAttachmentFileList();
      }

      // ===== ไฟล์แนบเดิมของเอกสาร (โหมดแก้ไข) — แสดงได้สูงสุด 3 ไฟล์ =====
      // 🔧 03/10/2569 : ข้อ 1 — เพิ่ม param readOnly (ใช้ตอนเปิดจากปุ่ม Display) ปรับแค่ข้อความหัวกล่อง
      //    ไม่ให้ชวนกดเลือกไฟล์ใหม่ (ปุ่ม "ลบไฟล์" ถูกซ่อนแยกอีกชั้นโดย setDocModalReadOnlyMode() อยู่แล้ว)
      function showExistingAttachmentBox(doc, readOnly) {
        const list = Array.isArray(doc.attachments) ? doc.attachments : [];
        existingAttachments = list
          .filter((a) => a && a.fileBase64)
          .map((a) => ({
            base64: a.fileBase64,
            fileName: a.fileName || "เอกสารแนบ",
            fileType: a.fileType || "application/octet-stream",
            sortOrder: a.sortOrder,
          }));
        const box = document.getElementById("existingAttachmentBox");
        if (existingAttachments.length === 0) {
          box.classList.add("hidden");
          box.innerHTML = "";
          return;
        }
        const headerText = readOnly
          ? `ไฟล์แนบ (${existingAttachments.length} ไฟล์)`
          : `ไฟล์แนบปัจจุบัน (${existingAttachments.length} ไฟล์) — เลือกไฟล์ใหม่ด้านบนเพื่อแทนที่ทั้งชุด`;
        box.innerHTML =
          `<div class="text-[11px] text-slate-400">${headerText}</div>` +
          existingAttachments
            .map(
              (a, idx) => `
          <div class="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <span class="text-[11px] font-medium text-slate-700 truncate flex-1">${a.fileName}</span>
            <button type="button" onclick="openExistingAttachment(${idx})"
              class="shrink-0 px-2.5 py-1 rounded-md bg-white border border-slate-200 text-[11px] font-semibold text-brand-600 hover:bg-brand-50">ดูไฟล์</button>
            <button type="button" onclick="deleteExistingAttachment(${idx})"
              class="shrink-0 px-2.5 py-1 rounded-md bg-white border border-slate-200 text-[11px] font-semibold text-red-500 hover:bg-red-50">ลบไฟล์</button>
          </div>`,
            )
            .join("");
        box.classList.remove("hidden");
      }

      function hideExistingAttachmentBox() {
        existingAttachments = [];
        const box = document.getElementById("existingAttachmentBox");
        box.innerHTML = "";
        box.classList.add("hidden");
      }

      // เปิดไฟล์แนบในแท็บใหม่ — ใช้ Blob แทน data URL ตรงๆ เพราะ Chrome บล็อกการเปิด data URL ขนาดใหญ่ในแท็บใหม่
      // (ตรรกะชุดเดียวกับ openSignAttachment() ในหน้า approve.html)
      function openExistingAttachment(idx) {
        const a = existingAttachments[idx];
        if (!a || !a.base64) return;
        try {
          const bin = atob(a.base64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          const url = URL.createObjectURL(
            new Blob([bytes], { type: a.fileType }),
          );
          window.open(url, "_blank");
          setTimeout(() => URL.revokeObjectURL(url), 60000);
        } catch (e) {
          showNotification(
            "เปิดไฟล์ไม่สำเร็จ",
            "ไฟล์แนบอาจเสียหาย กรุณาลองแนบไฟล์ใหม่แทน",
            "error",
          );
        }
      }

      // 🆕 02/10/2569 : ลบไฟล์แนบทีละไฟล์ทันที (ลบจริงจาก DB ทันทีที่กด ไม่รอกด "บันทึก" ฟอร์ม)
      //    สิทธิ์: ผู้สร้างเอกสาร หรือ Admin เท่านั้น (เช็คซ้ำฝั่ง backend อีกชั้น)
      //    หลังลบสำเร็จ โหลดรายละเอียดเอกสารใหม่ทั้งหมด (get_document_detail_ncr) แทนที่จะพึ่ง
      //    response ของ webhook ลบไฟล์เอง — เพราะ showExistingAttachmentBox() ต้องใช้ fileBase64
      //    ของไฟล์ที่เหลือมาแสดงปุ่ม "ดูไฟล์" ต่อได้ และ endpoint นี้คืนค่ามาครบอยู่แล้ว
      async function deleteExistingAttachment(idx) {
        const a = existingAttachments[idx];
        if (!a) return;
        const docId = document.getElementById("editingDocId").value;
        if (!docId) return;
        if (
          !confirm(
            `ยืนยันลบไฟล์แนบ "${a.fileName}" ออกจากเอกสารนี้?\nการลบนี้ไม่สามารถกู้คืนได้`,
          )
        )
          return;
        try {
          const res = await n8nFetch(
            N8N_BASE + "edit-delete-ncr-attachment",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                docId,
                sortOrder: a.sortOrder,
                requesterEmpId: empId,
                requesterName: empName || "ไม่ระบุชื่อ",
              }),
            },
          );
          const result = await res.json().catch(() => ({}));
          if (!res.ok || result.success === false) {
            throw new Error(extractErrorMessage(result));
          }
          const refreshRes = await n8nFetch(
            N8N_BASE + "get_document_detail_ncr",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ docId }),
            },
          );
          const refreshRaw = await refreshRes.json().catch(() => null);
          const refreshedDoc = Array.isArray(refreshRaw)
            ? refreshRaw[0]
            : refreshRaw;
          if (refreshedDoc) {
            const stillHasAttachment =
              Array.isArray(refreshedDoc.attachments) &&
              refreshedDoc.attachments.length > 0;
            if (stillHasAttachment) {
              showExistingAttachmentBox(refreshedDoc);
            } else {
              hideExistingAttachmentBox();
              // ไม่มีไฟล์แนบเหลือแล้ว — เคลียร์ "ไม่ผ่านผู้บริหาร" ไปด้วย (ต้องมีไฟล์แนบจึง fast-track ได้)
              document.querySelector(
                'input[name="hasAttachment"][value="NO"]',
              ).checked = true;
              document.getElementById("skipApprover").checked = false;
              onHasAttachmentChange();
            }
          }
          showNotification(
            "ลบไฟล์แนบสำเร็จ",
            `ลบไฟล์ "${a.fileName}" ออกจากเอกสารเรียบร้อยแล้ว`,
            "warning",
          );
        } catch (err) {
          showNotification("ลบไฟล์ไม่สำเร็จ", err.message, "error");
        }
      }

      function handleAttachmentFileSelect(inputEl) {
        const errorEl = document.getElementById("attachmentFileError");
        errorEl.classList.add("hidden");

        const files = Array.from(inputEl.files || []);
        if (files.length === 0) return;

        if (attachmentFiles.length + files.length > ATTACHMENT_MAX_COUNT) {
          errorEl.textContent = `แนบไฟล์ได้สูงสุด ${ATTACHMENT_MAX_COUNT} ไฟล์`;
          errorEl.classList.remove("hidden");
          inputEl.value = "";
          return;
        }

        for (const file of files) {
          if (!ATTACHMENT_ALLOWED_TYPES.includes(file.type)) {
            errorEl.textContent = `${file.name}: รองรับเฉพาะไฟล์ PDF หรือรูปภาพ (JPG/PNG) เท่านั้น`;
            errorEl.classList.remove("hidden");
            inputEl.value = "";
            return;
          }
          if (file.size > ATTACHMENT_MAX_SIZE) {
            errorEl.textContent = `${file.name}: ไฟล์ใหญ่เกินไป กรุณาแนบไฟล์ไม่เกิน 3 MB`;
            errorEl.classList.remove("hidden");
            inputEl.value = "";
            return;
          }
        }

        files.forEach((file) => {
          const reader = new FileReader();
          reader.onload = () => {
            // reader.result รูปแบบ "data:application/pdf;base64,XXXX" — ตัดส่วนหัวออก เก็บแค่ตัว Base64 ล้วน
            const base64 = reader.result.split(",")[1] || "";
            attachmentFiles.push({
              base64: base64,
              fileName: file.name,
              fileType: file.type,
              size: file.size,
            });
            renderAttachmentFileList();
          };
          reader.onerror = () => {
            errorEl.textContent = `${file.name}: อ่านไฟล์ไม่สำเร็จ กรุณาลองใหม่`;
            errorEl.classList.remove("hidden");
          };
          reader.readAsDataURL(file);
        });
        inputEl.value = "";
      }

      function openNewDocModal() {
        document.getElementById("editingDocId").value = "";
        document.getElementById("docModalTitle").textContent =
          "สร้างคำขออนุมัติเอกสาร NCR";
        document.getElementById("docId").value = "";
        document.getElementById("docId").placeholder =
          "ระบบจะสร้างให้อัตโนมัติหลังบันทึก";
        document.getElementById("docDate").value = new Date()
          .toISOString()
          .slice(0, 10);
        document.getElementById("movementType").value = NCR_FIXED_MOVEMENT_TYPE;
        document.querySelector('input[name="ncrType"][value="SCRAP"]').checked =
          true;
        document.getElementById("otherTypeNote").value = "";
        document.getElementById("otherTypeNoteWrap").classList.add("hidden");
        document.getElementById("marketingApproverName").value = "";
        document.getElementById("marketingApproverEmail").value = "";
        document.getElementById("marketingApproverEmpId").value = "";
        document.getElementById("pqmApproverName").value = "";
        document.getElementById("pqmApproverEmail").value = "";
        document.getElementById("pqmApproverEmpId").value = "";
        document.getElementById("logApproverName").value = "";
        document.getElementById("logApproverEmail").value = "";
        document.getElementById("logApproverEmpId").value = "";
        document.getElementById("spmApproverName").value = "";
        document.getElementById("spmApproverEmail").value = "";
        document.getElementById("spmApproverEmpId").value = "";
        document.getElementById("claimStatusHidden").value = "";
        document.querySelector('input[name="hasAttachment"][value="NO"]').checked = true;
        document.getElementById("attachmentFile").value = "";
        document.getElementById("attachmentFileError").classList.add("hidden");
        document.getElementById("skipApprover").checked = false;
        attachmentFiles = [];
        renderAttachmentFileList();
        existingAttachmentOnEdit = false;
        hideExistingAttachmentBox();
        onHasAttachmentChange();
        onClaimStatusChange();
        onNcrTypeChange();
        document.getElementById("itemRowsBody").innerHTML = "";
        itemRowCounter = 0;
        addItemRow();

        document.getElementById("requesterName").value = empName;
        document.getElementById("requesterEmail").value = empEmail;
        document.getElementById("midApproverName").value = "";
        document.getElementById("midApproverEmail").value = "";
        document.getElementById("midApproverEmpId").value = "";
        document.getElementById("scmApproverName").value = "";
        document.getElementById("scmApproverEmail").value = "";
        document.getElementById("scmApproverEmpId").value = "";

        document.getElementById("docModal").classList.remove("hidden");
        // 🆕 03/10/2569 : ข้อ 1 — กันกรณีเปิด "Display" (readOnly) ค้างไว้ก่อนหน้า แล้วมาเปิดสร้างใหม่ต่อ
        setDocModalReadOnlyMode(false);
        lucide.createIcons();
      }

      function closeDocModal() {
        document.getElementById("docModal").classList.add("hidden");
        hideGlobalDropdown();
      }

      function addItemRow(data) {
        itemRowCounter++;
        const rowId = "item-row-" + itemRowCounter;
        const tbody = document.getElementById("itemRowsBody");
        const tr = document.createElement("tr");
        tr.id = rowId;
        tr.className = "border-b border-slate-100 last:border-0";
        tr.innerHTML = `
                <td class="px-2 py-2 text-xs text-slate-400 text-center row-index">${tbody.children.length + 1}</td>
                <td class="px-2 py-1.5">
                    <input type="text" class="item-prod-code w-full h-9 px-2 rounded-md border border-slate-200 text-xs focus:ring-1 focus:ring-brand-500 outline-none" placeholder="ระบุรหัสสินค้า" value="${data?.ProdCode || ""}" oninput="handleCodeAutocomplete(this)" autocomplete="off" style="text-align: center;">
                </td>
                <td class="px-2 py-1.5"><input type="text" class="item-description w-full h-9 px-2 rounded-md border border-slate-200 text-xs focus:ring-1 focus:ring-brand-500 outline-none" placeholder="ระบุรหัสสินค้า รายละเอียดสินค้าจะถูกระบุอัตโนมัติหลังจากเลือกรหัสสินค้า" value="${data?.Description || ""}" style="text-align: center;"></td>
                <td class="px-2 py-1.5"><input type="number" min="0" step="0.01" class="item-qty w-full h-9 px-2 rounded-md border border-slate-200 text-xs focus:ring-1 focus:ring-brand-500 outline-none" value="${data?.Qty ?? 1}" style="text-align: center;"></td>
                <td class="px-2 py-1.5"><input type="text" class="item-unit w-full h-9 px-2 rounded-md border border-slate-200 text-xs focus:ring-1 focus:ring-brand-500 outline-none" placeholder="ระบุหน่วย" value="${data?.Unit || ""}" style="text-align: center;"></td>
                <td class="px-2 py-1.5"><input type="text" class="item-shop-name w-full h-9 px-2 rounded-md border border-slate-200 text-xs focus:ring-1 focus:ring-brand-500 outline-none" maxlength="500" value="${data?.ShopName || ""}" style="text-align: center;">
                <td class="px-2 py-1.5"><input type="text" class="item-remark w-full h-9 px-2 rounded-md border border-slate-200 text-xs focus:ring-1 focus:ring-brand-500 outline-none" maxlength="1000" placeholder="ระบุหมายเหตุ" value="${data?.Remark || ""}" style="text-align: center;"></td>
                <td class="px-2 py-1.5 text-center">
                    <button type="button" onclick="removeItemRow('${rowId}')" class="p-1 rounded text-slate-300 hover:text-red-500 hover:bg-red-50">
                        <i data-lucide="x" class="w-3.5 h-3.5"></i>
                    </button>
                </td>
            `;
        tbody.appendChild(tr);
        lucide.createIcons();
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
          prodCode: tr.querySelector(".item-prod-code").value.trim(),
          description: tr.querySelector(".item-description").value.trim(),
          qty: parseFloat(tr.querySelector(".item-qty").value) || 0,
          unit: tr.querySelector(".item-unit").value.trim(),
          shopName: tr.querySelector(".item-shop-name").value.trim(),
          remark: tr.querySelector(".item-remark").value.trim(),
        }));
      }

      // 🆕 25/09/2569 : "รายการอะไหล่ที่แยกได้" ย้ายไปกรอกที่ approve.html (stage SPM) แล้ว
      //    ฟังก์ชัน addPartsItemRow/removePartsItemRow/collectPartsItemsData เดิมถูกลบออกจากหน้านี้

      async function submitDocForm() {
        const editingDocId = document.getElementById("editingDocId").value;
        const isEdit = !!editingDocId;

        const items = collectItemsData();
        if (items.length === 0 || items.some((i) => !i.prodCode)) {
          showNotification(
            "ข้อมูลไม่ครบ",
            "กรุณาระบุ Prod.Code ให้ครบทุกรายการ อย่างน้อย 1 รายการ",
            "error",
          );
          return;
        }

        const ncrType = document.querySelector(
          'input[name="ncrType"]:checked',
        ).value;

        const hasAttachment =
          document.querySelector('input[name="hasAttachment"]:checked')
            ?.value || "NO";
        // ตอนแก้ไขเอกสารที่มีไฟล์แนบอยู่แล้ว ไม่บังคับให้เลือกไฟล์ใหม่ซ้ำ (existingAttachmentOnEdit)
        if (
          hasAttachment === "YES" &&
          attachmentFiles.length === 0 &&
          !existingAttachmentOnEdit
        ) {
          showNotification(
            "ข้อมูลไม่ครบ",
            "กรุณาแนบไฟล์เอกสารจากคุณกมล อย่างน้อย 1 ไฟล์ ก่อนกดยืนยัน",
            "error",
          );
          return;
        }
        const skipApprover =
          hasAttachment === "YES" &&
          document.getElementById("skipApprover").checked;

        // 🆕 25/09/2569 : "รายการอะไหล่ที่แยกได้" ไม่ต้องกรอกตอนสร้าง/แก้ไขเอกสารแล้ว
        //    ย้ายไปให้เจ้าหน้าที่แผนกรับเข้าคลังอะไหล่กรอกตอนอนุมัติขั้น SPM ที่ approve.html แทน

        const claimStatus =
          document.getElementById("claimStatusHidden")?.value || "";
        const midApproverEmail = document
          .getElementById("midApproverEmail")
          .value.trim();
        const scmApproverEmail = document
          .getElementById("scmApproverEmail")
          .value.trim();
        const marketingApproverEmail = document
          .getElementById("marketingApproverEmail")
          .value.trim();
        const pqmApproverEmail = document
          .getElementById("pqmApproverEmail")
          .value.trim();
        const logApproverEmail = document
          .getElementById("logApproverEmail")
          .value.trim();
        const spmApproverEmail = document
          .getElementById("spmApproverEmail")
          .value.trim();

        // 🆕 02/10/2569 : ข้อ 3, 6 — ตรวจเช็ค "ผู้เกี่ยวข้องกับเอกสาร" ต้องเลือกชื่อ (จาก dropdown)
        //    และมี Email ครบ "ทั้งคู่" ของทุกฝ่ายที่แสดงอยู่ในฟอร์มตามประเภทเอกสาร (NcrType) นั้นๆ
        //    ถ้าเลือกชื่อแล้วแต่ไม่มี Email หรือมี Email แต่ไม่ได้เลือกชื่อ (เช่น พิมพ์อีเมลเองโดยไม่กดเลือกจากรายการ)
        //    ก็ต้องห้ามบันทึกเหมือนกัน ใช้ตรวจทั้งตอนสร้างและตอนแก้ไข (ฟังก์ชันนี้ใช้ร่วมกันทั้งสองโหมด)
        const partiesToCheck = [
          {
            empIdId: "midApproverEmpId",
            emailId: "midApproverEmail",
            label: "ผู้บริหาร",
            required: true,
          },
          {
            empIdId: "scmApproverEmpId",
            emailId: "scmApproverEmail",
            label: "เจ้าหน้าที่แผนก SCM",
            required: true,
          },
          {
            empIdId: "pqmApproverEmpId",
            emailId: "pqmApproverEmail",
            label: "เจ้าหน้าที่แผนก PQM",
            required: true,
          },
          {
            empIdId: "logApproverEmpId",
            emailId: "logApproverEmail",
            label: "เจ้าหน้าที่แผนก โลจิสติกส์",
            required: true,
          },
          {
            empIdId: "marketingApproverEmpId",
            emailId: "marketingApproverEmail",
            label: "เจ้าหน้าที่การตลาด",
            required: ncrType === "SCRAP_CLAIM_VENDOR",
          },
          {
            empIdId: "spmApproverEmpId",
            emailId: "spmApproverEmail",
            label: "เจ้าหน้าที่แผนกรับเข้าคลังอะไหล่",
            required: ncrType === "SCRAP_PARTS",
          },
        ];

        for (const p of partiesToCheck) {
          if (!p.required) continue;
          const empIdVal = document.getElementById(p.empIdId).value.trim();
          const emailVal = document.getElementById(p.emailId).value.trim();
          if (!empIdVal || !emailVal) {
            showNotification(
              "ข้อมูลไม่ครบ",
              `กรุณาเลือกชื่อ "${p.label}" จากรายการ และระบุ Email ให้ครบทั้งสองอย่าง (เลือกชื่ออย่างเดียวหรือกรอก Email อย่างเดียวไม่สามารถบันทึกได้)`,
              "error",
            );
            return;
          }
        }

        const payload = {
          docDate: document.getElementById("docDate").value,
          ncrType: ncrType,
          otherTypeNote:
            ncrType === "OTHER"
              ? document.getElementById("otherTypeNote").value.trim()
              : "",
          movementType: document.getElementById("movementType").value.trim(),
          claimStatus: claimStatus,
          hasAttachment: hasAttachment === "YES",
          skipApprover: skipApprover,
          attachments:
            hasAttachment === "YES"
              ? attachmentFiles.map((f) => ({
                  fileName: f.fileName,
                  fileType: f.fileType,
                  base64: f.base64,
                }))
              : [],
          items: items,
          marketingNotifyName: document
            .getElementById("marketingApproverName")
            .value.trim(),
          marketingNotifyEmail: marketingApproverEmail,
          marketingNotifyEmpId: document
            .getElementById("marketingApproverEmpId")
            .value.trim(),
          midApproverNotifyName: document
            .getElementById("midApproverName")
            .value.trim(),
          midApproverNotifyEmail: midApproverEmail,
          midApproverNotifyEmpId: document
            .getElementById("midApproverEmpId")
            .value.trim(),
          scmNotifyName: document
            .getElementById("scmApproverName")
            .value.trim(),
          scmNotifyEmail: scmApproverEmail,
          scmNotifyEmpId: document
            .getElementById("scmApproverEmpId")
            .value.trim(),
          pqmNotifyName: document
            .getElementById("pqmApproverName")
            .value.trim(),
          pqmNotifyEmail: pqmApproverEmail,
          pqmNotifyEmpId: document
            .getElementById("pqmApproverEmpId")
            .value.trim(),
          logNotifyName: document
            .getElementById("logApproverName")
            .value.trim(),
          logNotifyEmail: logApproverEmail,
          logNotifyEmpId: document
            .getElementById("logApproverEmpId")
            .value.trim(),
          inboundAssigneeName: document
            .getElementById("spmApproverName")
            .value.trim(),
          inboundAssigneeEmail: spmApproverEmail,
          inboundAssigneeEmpId: document
            .getElementById("spmApproverEmpId")
            .value.trim(),
        };

        if (isEdit) {
          payload.docId = editingDocId;
          payload.requesterEmpId = empId;
          payload.requesterName =
            document.getElementById("requesterName").value.trim() || empName;
        } else {
          payload.createdByName =
            document.getElementById("requesterName").value.trim() || empName;
          payload.createdByEmpId = empId;
          payload.createdByEmail =
            document.getElementById("requesterEmail").value.trim() || empEmail;
        }

        const endpoint = isEdit ? "edit_ncr_document" : "create_ncr_document";
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
          const finalDocId = isEdit ? editingDocId : result.documentId;
          closeDocModal();
          await fetchAllDocuments();
          showNotification(
            "บันทึกสำเร็จ",
            isEdit
              ? `แก้ไขเอกสาร ${finalDocId} สำเร็จแล้ว`
              : `สร้างเอกสาร NCR สำเร็จแล้ว เลขที่เอกสาร: ${finalDocId}`,
            "success",
          );
        } catch (err) {
          showNotification("บันทึกไม่สำเร็จ", err.message, "error");
        } finally {
          btn.disabled = false;
        }
      }

      async function openEditDocModal(docId) {
        const docForCheck = allDocuments.find((d) => d.DocId === docId);
        if (docForCheck && !canEditDocument(docForCheck)) {
          showNotification(
            "ไม่มีสิทธิ์แก้ไข",
            "แก้ไขได้เฉพาะช่วงที่เอกสารยังไม่ผ่านการอนุมัติขั้นใดเลย และต้องเป็นผู้สร้างเอกสารหรือ Admin เท่านั้น",
            "error",
          );
          return;
        }

        try {
          const res = await n8nFetch(N8N_BASE + "get_document_detail_ncr", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ docId }),
          });
          if (!res.ok) throw new Error("โหลดเอกสารไม่สำเร็จ");
          const raw = await res.json();
          const doc = Array.isArray(raw) ? raw[0] : raw;
          if (!doc) throw new Error("ไม่พบข้อมูลเอกสาร");

          document.getElementById("editingDocId").value = doc.DocId;
          document.getElementById("docModalTitle").textContent =
            `แก้ไขเอกสาร NCR ${doc.DocId}`;
          document.getElementById("docId").value = doc.DocId;
          document.getElementById("docDate").value = (doc.DocDate || "").slice(
            0,
            10,
          );
          document.getElementById("movementType").value =
            doc.MovementType || NCR_FIXED_MOVEMENT_TYPE;
          document.querySelector(
            `input[name="ncrType"][value="${doc.NcrType}"]`,
          ).checked = true;
          document.getElementById("otherTypeNote").value =
            doc.OtherTypeNote || "";
          document
            .getElementById("otherTypeNoteWrap")
            .classList.toggle("hidden", doc.NcrType !== "OTHER");
          // 🆕 26/09/2569 : ไม่มี UI ให้แก้สถานะการเคลมในหน้านี้แล้ว — คงค่าเดิมของเอกสารไว้เฉยๆ
          // (กันไม่ให้การแก้ไขเอกสารเดิมที่เคยมีสถานะการเคลมอยู่แล้ว ถูกบันทึกทับเป็นค่าว่างโดยไม่ตั้งใจ)
          document.getElementById("claimStatusHidden").value =
            doc.ClaimStatus || "";
          onClaimStatusChange();
          onNcrTypeChange();

          // ===== คืนสถานะไฟล์แนบเดิม =====
          // ⚠️ เดิมหน้าแก้ไขไม่เคยคืนสถานะนี้เลย เอกสารที่มีไฟล์แนบอยู่แล้วจะเปิดมาเห็นเป็น "ไม่มีเอกสารแนบ" เสมอ
          //    ทำให้กดบันทึกทีไรก็เท่ากับสั่งลบไฟล์เดิมทิ้งโดยไม่ตั้งใจ และ Fast-track ก็ถูกปลดไปด้วย
          //    attachmentFiles ยังคงว่างไว้ตั้งใจ = "ยังไม่ได้เลือกไฟล์ใหม่" ฝั่ง n8n จะเก็บไฟล์เดิมไว้ให้
          //
          // ⚠️ ต้องล้าง attachmentFiles ทุกครั้งที่เปิด modal แก้ไข ไม่ใช่แค่ตอนสร้างเอกสารใหม่
          //    ตัวแปรนี้เป็น state ระดับหน้า ถ้าเคยเลือกไฟล์ไว้ในการแก้ไขรอบก่อน ค่าจะค้างอยู่
          //    แล้วรอบถัดไปที่ผู้ใช้ "ไม่แตะช่องเลือกไฟล์" เลย ระบบจะส่ง base64 ของรอบก่อนไปเขียนทับ
          //    ทำให้ n8n เข้าใจว่ามีไฟล์ใหม่ (hasNewFileVal = 1) และ Log ขึ้นว่า "เปลี่ยนไฟล์แนบเป็น ..." ทั้งที่ไม่ได้เปลี่ยน
          attachmentFiles = [];
          renderAttachmentFileList();
          document.getElementById("attachmentFile").value = "";
          document.getElementById("attachmentFileError").classList.add("hidden");

          const hasExistingAttachment =
            doc.HasAttachment === true ||
            doc.HasAttachment === 1 ||
            (Array.isArray(doc.attachments) && doc.attachments.length > 0);
          existingAttachmentOnEdit = hasExistingAttachment;
          document.querySelector(
            `input[name="hasAttachment"][value="${hasExistingAttachment ? "YES" : "NO"}"]`,
          ).checked = true;
          onHasAttachmentChange();
          if (hasExistingAttachment) {
            showExistingAttachmentBox(doc);
          } else {
            hideExistingAttachmentBox();
          }
          document.getElementById("skipApprover").checked =
            doc.SkipApprover === true || doc.SkipApprover === 1;

          document.getElementById("requesterName").value =
            doc.CreatedByName || empName;
          document.getElementById("requesterEmail").value =
            doc.CreatedByEmail || empEmail;
          // ✅ แก้ Known Issue: Schema มี MarketingNotifyEmpId/MidApproverNotifyEmpId/ScmNotifyEmpId อยู่แล้วจริงๆ
          // (TODO เดิมเข้าใจผิดว่ายังไม่มี Column พวกนี้ — ก่อนหน้านี้ EmpId hidden field เลยถูกปล่อยว่าง
          // ทำให้กด "บันทึก" ตอน Edit แล้ว EmpId ของผู้อนุมัติหายไปจาก Payload ทั้งที่มีค่าอยู่ใน DB)
          document.getElementById("marketingApproverName").value =
            doc.MarketingNotifyName || "";
          document.getElementById("marketingApproverEmail").value =
            doc.MarketingNotifyEmail || "";
          document.getElementById("marketingApproverEmpId").value =
            doc.MarketingNotifyEmpId || "";
          document.getElementById("midApproverName").value =
            doc.MidApproverNotifyName || "";
          document.getElementById("midApproverEmail").value =
            doc.MidApproverNotifyEmail || "";
          document.getElementById("midApproverEmpId").value =
            doc.MidApproverNotifyEmpId || "";
          document.getElementById("scmApproverName").value =
            doc.ScmNotifyName || "";
          document.getElementById("scmApproverEmail").value =
            doc.ScmNotifyEmail || "";
          document.getElementById("scmApproverEmpId").value =
            doc.ScmNotifyEmpId || "";
          document.getElementById("pqmApproverName").value =
            doc.PqmNotifyName || "";
          document.getElementById("pqmApproverEmail").value =
            doc.PqmNotifyEmail || "";
          document.getElementById("pqmApproverEmpId").value =
            doc.PqmNotifyEmpId || "";
          document.getElementById("logApproverName").value =
            doc.LogNotifyName || "";
          document.getElementById("logApproverEmail").value =
            doc.LogNotifyEmail || "";
          document.getElementById("logApproverEmpId").value =
            doc.LogNotifyEmpId || "";
          document.getElementById("spmApproverName").value =
            doc.InboundAssigneeName || "";
          document.getElementById("spmApproverEmail").value =
            doc.InboundAssigneeEmail || "";
          document.getElementById("spmApproverEmpId").value =
            doc.InboundAssigneeEmpId || "";

          document.getElementById("itemRowsBody").innerHTML = "";
          itemRowCounter = 0;
          (doc.items || []).forEach((item) => addItemRow(item));
          if ((doc.items || []).length === 0) addItemRow();

          document.getElementById("docModal").classList.remove("hidden");
          // 🆕 03/10/2569 : ข้อ 1 — กันกรณีเปิด "Display" (readOnly) ค้างไว้ก่อนหน้า แล้วมาเปิดแก้ไขต่อ
          setDocModalReadOnlyMode(false);
          lucide.createIcons();
        } catch (err) {
          showNotification("เกิดข้อผิดพลาด", err.message, "error");
        }
      }

      // ===================================================================
      // 🆕 03/10/2569 : ข้อ 1 — ปุ่ม Display (ไอคอนตา เฉพาะ Admin เห็น — ให้ตรงกับ SWAP/Disassembly)
      //    ใช้ Modal เดียวกับ Create/Edit (#docModal) แต่เปิดในโหมด "ดูอย่างเดียว" (readOnly)
      //    ส่วนไอคอนเอกสาร (file-text, ทุก Role เห็น) ยังคงเป็นปุ่ม Preview (previewDocument() กระดาษแยกต่างหาก) เหมือนเดิม
      //    openDisplayDocModal() นี้ไม่เช็คสิทธิ์แก้ไขแบบ openEditDocModal() เพราะเป็นแค่การดู ไม่ใช่การแก้
      // ===================================================================
      async function openDisplayDocModal(docId) {
        try {
          const res = await n8nFetch(N8N_BASE + "get_document_detail_ncr", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ docId }),
          });
          if (!res.ok) throw new Error("โหลดเอกสารไม่สำเร็จ");
          const raw = await res.json();
          const doc = Array.isArray(raw) ? raw[0] : raw;
          if (!doc) throw new Error("ไม่พบข้อมูลเอกสาร");

          // ⚠️ ตั้งใจเว้น editingDocId ไว้ว่าง กัน submitDocForm() หลุดไปบันทึกทับเอกสารนี้
          //    (ปุ่ม "บันทึกเอกสาร" จะถูกซ่อนไปแล้วโดย setDocModalReadOnlyMode(true) ด้านล่าง แต่กันเหตุไม่คาดคิดอีกชั้น)
          document.getElementById("editingDocId").value = "";
          document.getElementById("docModalTitle").textContent =
            `ดูรายละเอียดเอกสาร NCR ${doc.DocId}`;
          document.getElementById("docId").value = doc.DocId;
          document.getElementById("docDate").value = (doc.DocDate || "").slice(
            0,
            10,
          );
          document.getElementById("movementType").value =
            doc.MovementType || NCR_FIXED_MOVEMENT_TYPE;
          document.querySelector(
            `input[name="ncrType"][value="${doc.NcrType}"]`,
          ).checked = true;
          document.getElementById("otherTypeNote").value =
            doc.OtherTypeNote || "";
          document
            .getElementById("otherTypeNoteWrap")
            .classList.toggle("hidden", doc.NcrType !== "OTHER");
          document.getElementById("claimStatusHidden").value =
            doc.ClaimStatus || "";
          onClaimStatusChange();
          onNcrTypeChange();

          attachmentFiles = [];
          renderAttachmentFileList();
          document.getElementById("attachmentFile").value = "";
          document.getElementById("attachmentFileError").classList.add("hidden");

          const hasExistingAttachment =
            doc.HasAttachment === true ||
            doc.HasAttachment === 1 ||
            (Array.isArray(doc.attachments) && doc.attachments.length > 0);
          existingAttachmentOnEdit = hasExistingAttachment;
          document.querySelector(
            `input[name="hasAttachment"][value="${hasExistingAttachment ? "YES" : "NO"}"]`,
          ).checked = true;
          onHasAttachmentChange();
          if (hasExistingAttachment) {
            // ✅ ข้อ 1 : showExistingAttachmentBox() เดิมมีปุ่ม "ดูไฟล์" อยู่แล้ว — setDocModalReadOnlyMode(true)
            //    ด้านล่างจะซ่อนเฉพาะปุ่ม "ลบไฟล์" ของกล่องนี้ ปุ่ม "ดูไฟล์" ยังกดเปิดดูไฟล์แนบได้ตามที่ร้องขอ
            showExistingAttachmentBox(doc, true);
          } else {
            hideExistingAttachmentBox();
          }
          document.getElementById("skipApprover").checked =
            doc.SkipApprover === true || doc.SkipApprover === 1;

          // ⚠️ ไม่ fallback เป็น empName/empEmail ของผู้เปิดดู (ต่างจาก openEditDocModal) เพราะโหมดนี้
          //    ผู้เปิดดูอาจไม่ใช่ผู้สร้างเอกสาร ต้องโชว์ข้อมูลผู้สร้างจริงจาก DB เท่านั้น ถ้าไม่มีก็ปล่อยว่าง
          document.getElementById("requesterName").value =
            doc.CreatedByName || "";
          document.getElementById("requesterEmail").value =
            doc.CreatedByEmail || "";
          document.getElementById("marketingApproverName").value =
            doc.MarketingNotifyName || "";
          document.getElementById("marketingApproverEmail").value =
            doc.MarketingNotifyEmail || "";
          document.getElementById("marketingApproverEmpId").value =
            doc.MarketingNotifyEmpId || "";
          document.getElementById("midApproverName").value =
            doc.MidApproverNotifyName || "";
          document.getElementById("midApproverEmail").value =
            doc.MidApproverNotifyEmail || "";
          document.getElementById("midApproverEmpId").value =
            doc.MidApproverNotifyEmpId || "";
          document.getElementById("scmApproverName").value =
            doc.ScmNotifyName || "";
          document.getElementById("scmApproverEmail").value =
            doc.ScmNotifyEmail || "";
          document.getElementById("scmApproverEmpId").value =
            doc.ScmNotifyEmpId || "";
          document.getElementById("pqmApproverName").value =
            doc.PqmNotifyName || "";
          document.getElementById("pqmApproverEmail").value =
            doc.PqmNotifyEmail || "";
          document.getElementById("pqmApproverEmpId").value =
            doc.PqmNotifyEmpId || "";
          document.getElementById("logApproverName").value =
            doc.LogNotifyName || "";
          document.getElementById("logApproverEmail").value =
            doc.LogNotifyEmail || "";
          document.getElementById("logApproverEmpId").value =
            doc.LogNotifyEmpId || "";
          document.getElementById("spmApproverName").value =
            doc.InboundAssigneeName || "";
          document.getElementById("spmApproverEmail").value =
            doc.InboundAssigneeEmail || "";
          document.getElementById("spmApproverEmpId").value =
            doc.InboundAssigneeEmpId || "";

          document.getElementById("itemRowsBody").innerHTML = "";
          itemRowCounter = 0;
          (doc.items || []).forEach((item) => addItemRow(item));

          document.getElementById("docModal").classList.remove("hidden");
          setDocModalReadOnlyMode(true);
          lucide.createIcons();
        } catch (err) {
          showNotification("เกิดข้อผิดพลาด", err.message, "error");
        }
      }

      // 🆕 03/10/2569 : สลับ #docModal ระหว่างโหมดแก้ไขได้ปกติ (false) กับโหมดดูอย่างเดียว (true)
      //    - disable input/select/textarea ทั้งหมดในฟอร์ม
      //    - ซ่อนปุ่มที่ทำให้ข้อมูลเปลี่ยน (เพิ่ม/ลบรายการสินค้า, แนบไฟล์ใหม่, ลบไฟล์แนบเดิม, บันทึกเอกสาร)
      //    - ปุ่ม "ดูไฟล์"/"เปิดดู"/"ดาวน์โหลด" ของไฟล์แนบเดิม ไม่แตะ (เป็น <button> ธรรมดา ไม่ได้ disable
      //      จากการวนลูป input/select/textarea ด้านบนอยู่แล้ว) ให้กดเปิดดูไฟล์แนบได้เสมอตามที่ร้องขอในข้อ 1
      function setDocModalReadOnlyMode(readOnly) {
        const modal = document.getElementById("docModal");
        if (!modal) return;

        modal.querySelectorAll("input, select, textarea").forEach((el) => {
          el.disabled = readOnly;
        });

        const addItemBtn = modal.querySelector('button[onclick="addItemRow()"]');
        if (addItemBtn) addItemBtn.classList.toggle("hidden", readOnly);

        modal
          .querySelectorAll('#itemRowsBody button[onclick^="removeItemRow"]')
          .forEach((btn) => btn.classList.toggle("hidden", readOnly));

        const uploadGroup = document.getElementById("newAttachmentUploadGroup");
        if (uploadGroup) uploadGroup.classList.toggle("hidden", readOnly);

        modal
          .querySelectorAll('[onclick^="deleteExistingAttachment"]')
          .forEach((btn) => btn.classList.toggle("hidden", readOnly));

        modal
          .querySelectorAll('[onclick^="removeAttachmentFile"]')
          .forEach((btn) => btn.classList.toggle("hidden", readOnly));

        const submitBtn = document.getElementById("submitDocBtn");
        if (submitBtn) submitBtn.classList.toggle("hidden", readOnly);

        const cancelBtn = document.getElementById("cancelDocBtn");
        if (cancelBtn) cancelBtn.textContent = readOnly ? "ปิด" : "ยกเลิก";

        // 🆕 03/10/2569 : ข้อ "ปุ่มที่เลือก ปรับให้ชัดเจนมากขึ้น" — radio/checkbox ที่ disabled ปกติจะจางมองยากมาก
        //    ว่าตัวไหนถูกเลือกไว้ จึงไฮไลท์ label ของตัวเลือกที่ถูกเลือก (พื้นสี/กรอบ/ตัวหนา) เฉพาะตอนโหมดดูอย่างเดียว
        highlightReadOnlySelection(modal, readOnly);
      }

      // ไฮไลท์ label ของ radio/checkbox ที่ถูกเลือกไว้ ให้เห็นชัดตอนโหมดดูอย่างเดียว (Display)
      function highlightReadOnlySelection(modal, readOnly) {
        const SELECTED_CLASSES = [
          "bg-brand-50",
          "border",
          "border-brand-400",
          "rounded-lg",
          "px-2",
          "py-1",
          "text-brand-700",
          "font-semibold",
        ];
        const DIMMED_CLASSES = ["text-slate-300"];

        [
          modal.querySelectorAll('input[name="ncrType"]'),
          modal.querySelectorAll('input[name="hasAttachment"]'),
        ].forEach((inputs) => {
          inputs.forEach((input) => {
            const label = input.closest("label");
            if (!label) return;
            label.classList.remove(...SELECTED_CLASSES, ...DIMMED_CLASSES);
            if (readOnly) {
              if (input.checked) {
                label.classList.add(...SELECTED_CLASSES);
              } else {
                label.classList.add(...DIMMED_CLASSES);
              }
            }
          });
        });

        const skipChk = document.getElementById("skipApprover");
        const skipLabel = skipChk?.closest("label");
        if (skipLabel) {
          const AMBER_CLASSES = [
            "bg-amber-50",
            "border",
            "border-amber-400",
            "rounded-lg",
            "px-2",
            "py-1",
            "text-amber-700",
            "font-semibold",
          ];
          skipLabel.classList.remove(...AMBER_CLASSES);
          if (readOnly && skipChk.checked) {
            skipLabel.classList.add(...AMBER_CLASSES);
          }
        }
      }

      // ================= ลบเอกสาร =================
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

      // ================= ยกเลิกเอกสาร (🆕 03/10/2569) =================
      function openCancelDocModal(docId) {
        document.getElementById("cancelDocIdDisplay").textContent = docId;
        const confirmBtn = document.getElementById("confirmCancelDocBtn");
        confirmBtn.onclick = function () {
          cancelDocument(docId);
        };
        openModal("cancelDocModal", "cancelDocModalContent");
      }

      function closeCancelDocModal() {
        closeModal("cancelDocModal", "cancelDocModalContent");
      }

      // ===================================================================
      // Modal ถอยสถานะเอกสาร (Admin / SCM) — 🆕 23/09/2569 (เพิ่ม SCM 05/10/2569)
      // ===================================================================
      const ADMIN_REVERT_WEBHOOK = "admin_revert_stage_ncr"; // ต้องตรงกับ Webhook path จริงใน n8n

      // label ของแต่ละ StepNo (ตรงกับที่ใช้ใน approve.html โมดูล NCR)
      const NCR_STAGE_LABELS = {
        0: "รอผู้บริหารอนุมัติ (รอบแรก)",
        1: "รอเจ้าหน้าที่การตลาดพิจารณา",
        2: "รอผู้บริหารอนุมัติ (รอบสอง - Fast-track)",
        3: "รอเจ้าหน้าที่ SCM",
        4: "รอเจ้าหน้าที่แผนก โลจิสติกส์ ยืนยันปิดงาน",
        5: "รอเจ้าหน้าที่แผนกรับเข้าคลังอะไหล่ ยืนยันรับเข้า",
      };

      // เส้นทางที่เป็นไปได้จริงต่อประเภทเอกสาร (ตรงกับ Logic ฝั่ง n8n: calculateInitialStepNo / Code - Determine Log Route)
      // StepNo 6 (เสร็จสิ้น) ไม่รวมในนี้เพราะไม่ใช่ปลายทางที่ถอยไปได้
      const NCR_TYPE_VALID_STEPS = {
        SCRAP: [0, 3, 4],
        SCRAP_PARTS: [0, 3, 4, 5],
        SCRAP_CLAIM_VENDOR: [0, 1, 2, 3, 4],
        OTHER: [0, 3, 4],
      };

      let adminRevertCurrentDocId = null;

      async function openAdminRevertModal(docId) {
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
        const validSteps = NCR_TYPE_VALID_STEPS[doc.NcrType] || [0, 3, 4];

        document.getElementById("adminRevertDocIdDisplay").textContent = docId;
        document.getElementById("adminRevertReason").value = "";
        document.getElementById("adminRevertSendEmail").checked = true;

        // 🔧 03/10/2569 : ตัวเลือกรีเซ็ต Fast-track — แสดงเฉพาะเอกสารที่ปัจจุบันติ๊ก Fast-track ไว้เท่านั้น
        //    ⚠️ แก้บั๊ก: เดิมเช็คจาก allDocuments (รายการจาก get_all_ncr_document_status) ซึ่งอาจไม่มีคอลัมน์
        //    SkipApprover ติดมาด้วย ทำให้ checkbox ไม่ขึ้นแม้เอกสารจะติ๊ก Fast-track ไว้จริง
        //    แก้เป็นดึงรายละเอียดเอกสารสดจาก get_document_detail_ncr (ที่มี SkipApprover แน่นอน — endpoint
        //    เดียวกับที่ปุ่ม Display ใช้) มาเช็คแทน
        const resetFastTrackWrap = document.getElementById(
          "adminRevertResetFastTrackWrap",
        );
        document.getElementById("adminRevertResetFastTrack").checked = false;
        resetFastTrackWrap.classList.add("hidden");
        resetFastTrackWrap.classList.remove("flex");
        try {
          const detailRes = await n8nFetch(
            N8N_BASE + "get_document_detail_ncr",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ docId }),
            },
          );
          if (detailRes.ok) {
            const rawDetail = await detailRes.json();
            const fullDoc = Array.isArray(rawDetail) ? rawDetail[0] : rawDetail;
            const isFastTrackDoc =
              fullDoc &&
              (fullDoc.SkipApprover === true || fullDoc.SkipApprover === 1);
            resetFastTrackWrap.classList.toggle("hidden", !isFastTrackDoc);
            resetFastTrackWrap.classList.toggle("flex", isFastTrackDoc);
          }
        } catch (e) {
          // เงียบไว้ — ถ้าดึงไม่สำเร็จ ถือว่าไม่ใช่ Fast-track (ซ่อน checkbox ไว้ก่อน) ไม่บล็อกการถอยสถานะหลัก
          console.error("ตรวจสอบสถานะ Fast-track ไม่สำเร็จ", e);
        }

        const select = document.getElementById("adminRevertTargetStep");
        select.innerHTML = "";
        validSteps
          .filter((step) => step < currentStep)
          .sort((a, b) => a - b)
          .forEach((step) => {
            const opt = document.createElement("option");
            opt.value = step;
            opt.textContent = NCR_STAGE_LABELS[step];
            select.appendChild(opt);
          });

        if (select.options.length === 0) {
          showNotification(
            "ถอยสถานะไม่ได้",
            "เอกสารนี้อยู่ที่ขั้นแรกของเส้นทาง (ตามประเภทเอกสาร) อยู่แล้ว ไม่มีขั้นก่อนหน้าให้ถอยกลับ",
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
        const resetFastTrack = document.getElementById(
          "adminRevertResetFastTrack",
        ).checked;

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
              resetFastTrack,
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
          const res = await n8nFetch(N8N_BASE + "delete_doc_ncr", {
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

      // 🆕 03/10/2569 : ยกเลิกเอกสาร — เปลี่ยนสถานะเป็น "ยกเลิก" (ไม่ใช่ลบออกจากระบบแบบ delete_doc_ncr)
      //    ใช้ได้เฉพาะผู้สร้างเอกสารเองหรือ Admin และเฉพาะก่อนมีการอนุมัติขั้นใดเลย (เช็คซ้ำฝั่ง Backend อีกชั้น)
      async function cancelDocument(docId) {
        const docForCheck = allDocuments.find((d) => d.DocId === docId);
        if (docForCheck && !canCancelDocument(docForCheck)) {
          showNotification(
            "ไม่มีสิทธิ์ยกเลิกเอกสาร",
            "ยกเลิกได้เฉพาะผู้สร้างเอกสารเองหรือ Admin และเฉพาะช่วงที่เอกสารยังไม่ผ่านการอนุมัติขั้นใดเลย",
            "error",
          );
          return;
        }
        const confirmBtn = document.getElementById("confirmCancelDocBtn");
        confirmBtn.disabled = true;
        confirmBtn.textContent = "กำลังยกเลิก...";
        try {
          const res = await n8nFetch(N8N_BASE + "cancel_document_ncr", {
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
            "ยกเลิกสำเร็จ",
            `ยกเลิกเอกสารเลขที่ ${docId} เรียบร้อยแล้ว`,
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

      // ================= Autocomplete Prod.Code (ใช้ webhook ร่วมกับระบบอื่น) =================
      let autocompleteTimer = null;
      let activeAutocompleteInput = null;

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
              );
            }
          } catch (err) {
            console.error("autocomplete error", err);
          }
        }, 300);
      }

      // ป้ายสถานะสต็อกในรายการค้นหา — ใช้ชุดเดียวกับ disassembly_form.html เพื่อให้ทั้งสองระบบหน้าตาเหมือนกัน
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

      function renderAutocompleteDropdown(inputEl, results) {
        const dropdown = getGlobalDropdown();
        if (results.length === 0) {
          dropdown.classList.add("hidden");
          return;
        }
        dropdown.innerHTML = "";
        results.forEach((item) => {
          const code = item.code || item.Code || "";
          const name = item.name || item.Name || "";
          const manufacturers =
            item.manufacturers || item.Manufacturers || "";
          // API ส่งชื่อ field มาไม่แน่นอนระหว่าง stockstatus / stockStatus จึงรับทั้งสองแบบเหมือนฝั่ง Disassembly
          const stockstatus = item.stockstatus || item.stockStatus || "";

          const row = document.createElement("div");
          row.className =
            "px-3 py-2 text-xs hover:bg-orange-50 cursor-pointer border-b border-slate-50 last:border-0";

          const topLine = document.createElement("div");
          topLine.className = "flex items-center justify-between gap-2";
          const codeSpan = document.createElement("span");
          codeSpan.className = "font-mono font-semibold text-slate-800";
          codeSpan.textContent = code;
          topLine.appendChild(codeSpan);
          const badgeHtml = stockStatusBadge(stockstatus);
          if (badgeHtml) {
            const badgeWrap = document.createElement("span");
            badgeWrap.innerHTML = badgeHtml; // ป้ายสถานะเป็น HTML คงที่ที่เรา generate เอง ไม่ใช่ข้อมูลดิบจาก item จึงปลอดภัย
            topLine.appendChild(badgeWrap.firstElementChild || badgeWrap);
          }
          row.appendChild(topLine);

          const bottomLine = document.createElement("div");
          bottomLine.className = "text-slate-500 mt-0.5";
          bottomLine.textContent =
            (manufacturers ? manufacturers + " — " : "") + name;
          row.appendChild(bottomLine);

          // 🆕 03/10/2569 : ใช้ addEventListener + closure แทน onclick='...${JSON.stringify(...)}'
          //    เดิมฝัง JSON ลงใน inline onclick ที่ครอบด้วย single quote ('...') — ถ้าชื่ออะไหล่จาก DB
          //    มีเครื่องหมาย ' (apostrophe) หลุดมา จะตัด attribute ขาดกลางคัน ทำให้กดรายการไม่ติด
          //    (ค้างเป็นแถบไฮไลต์ กดไม่เข้า) แก้โดยสร้าง element จริงแล้วผูก event ตรงๆ ไม่ง้อการ escape เลย
          row.addEventListener("click", () =>
            selectAutocompleteItem({ code, name }),
          );

          dropdown.appendChild(row);
        });
        positionDropdownUnderInput(dropdown, inputEl);
        dropdown.classList.remove("hidden");
      }

      function selectAutocompleteItem(item) {
        if (!activeAutocompleteInput) return;
        const row = activeAutocompleteInput.closest("tr");
        activeAutocompleteInput.value = item.code;
        if (row && item.name) {
          const descInput = row.querySelector(".item-description");
          if (descInput) descInput.value = item.name;
        }
        hideGlobalDropdown();
      }

      document.addEventListener("click", (e) => {
        if (
          !e.target.closest(".item-prod-code") &&
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
          )
            return;
          hideGlobalDropdown();
        },
        true,
      );
      window.addEventListener("resize", hideGlobalDropdown);

      // ================= Modal ดูรายละเอียด =================
      // ⚙️ กันกดปุ่ม 👁 ซ้ำระหว่างที่ยังโหลดไม่เสร็จ — ก่อนหน้านี้กดรัวๆ ได้ ยิง Request ซ้อนกันหลายรอบ
      // ทำให้บาง Request ได้ Response ว่างเปล่ากลับมา (n8n รับ Concurrent Request เข้า Webhook เดียวกันพร้อมกันแล้วบางตัวพัง)
      let viewDocumentLoadingId = null;

      async function viewDocument(docId) {
        if (viewDocumentLoadingId === docId) return; // กำลังโหลดเอกสารใบนี้อยู่แล้ว ไม่ต้องยิงซ้ำ
        viewDocumentLoadingId = docId;

        const modal = document.getElementById("viewModal");
        const body = document.getElementById("viewModalBody");
        document.getElementById("viewModalTitle").textContent =
          `รายละเอียดเอกสาร ${docId}`;
        body.innerHTML =
          '<p class="text-center text-slate-400 py-8">กำลังโหลด...</p>';
        modal.classList.remove("hidden");

        try {
          const res = await n8nFetch(N8N_BASE + "get_document_detail_ncr", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ docId }),
          });
          if (!res.ok) throw new Error(`โหลดข้อมูลไม่สำเร็จ (HTTP ${res.status})`);

          let raw;
          try {
            raw = await res.json();
          } catch (parseErr) {
            throw new Error(
              "เซิร์ฟเวอร์ตอบกลับไม่สมบูรณ์ กรุณาลองกดดูรายละเอียดใหม่อีกครั้ง",
            );
          }
          const doc = Array.isArray(raw) ? raw[0] : raw;
          if (!doc) throw new Error("ไม่พบข้อมูลเอกสาร");

          const itemsHtml = (doc.items || [])
            .map(
              (item) => `
                    <tr class="border-b border-slate-100 last:border-0">
                        <td class="px-2 py-1.5 text-sm font-mono">${item.ProdCode}</td>
                        <td class="px-2 py-1.5 text-sm">${item.Description || "-"}</td>
                        <td class="px-2 py-1.5 text-sm text-center">${item.Qty}</td>
                        <td class="px-2 py-1.5 text-sm text-center">${item.Unit || "-"}</td>
                        <td class="px-2 py-1.5 text-sm">${item.ShopName || "-"}</td>
                        <td class="px-2 py-1.5 text-sm">${item.Remark || "-"}</td>
                    </tr>`,
            )
            .join("");

          const partsItemsHtml = (doc.partsItems || [])
            .map(
              (item) => `
                    <tr class="border-b border-slate-100 last:border-0">
                        <td class="px-2 py-1.5 text-sm font-mono">${item.ProdCode}</td>
                        <td class="px-2 py-1.5 text-sm">${item.Description || "-"}</td>
                        <td class="px-2 py-1.5 text-sm text-center">${item.Qty}</td>
                        <td class="px-2 py-1.5 text-sm text-center">${item.Unit || "-"}</td>
                        <td class="px-2 py-1.5 text-sm">${item.ShopName || "-"}</td>
                        <td class="px-2 py-1.5 text-sm">${item.Remark || "-"}</td>
                    </tr>`,
            )
            .join("");

          currentViewDocData = doc;

          // การ์ดผู้เกี่ยวข้อง — Read-only มิเรอร์ตามฟอร์มสร้าง/แก้ไขทุกช่อง (Notify: ใครถูกเลือกไว้)
          const contactCard = (label, name, email) => {
            if (!name && !email) return "";
            return `
                        <div class="bg-slate-50 border border-slate-150 rounded-lg p-3">
                            <p class="text-sm text-slate-400 uppercase font-semibold mb-1.5">${label}</p>
                            <p class="text-sm font-medium text-slate-800">${name || "-"}</p>
                            <p class="text-sm text-slate-500">${email || "-"}</p>
                        </div>`;
          };
          const contactCardsHtml = [
            contactCard(
              "ผู้ขออนุมัติเอกสาร NCR",
              doc.CreatedByName,
              doc.CreatedByEmail,
            ),
            contactCard(
              "ผู้บริหาร",
              doc.MidApproverNotifyName,
              doc.MidApproverNotifyEmail,
            ),
            doc.NcrType === "SCRAP_CLAIM_VENDOR"
              ? contactCard(
                  "เจ้าหน้าที่การตลาด",
                  doc.MarketingNotifyName,
                  doc.MarketingNotifyEmail,
                )
              : "",
            contactCard(
              "เจ้าหน้าที่แผนก SCM",
              doc.ScmNotifyName,
              doc.ScmNotifyEmail,
            ),
            contactCard(
              "เจ้าหน้าที่แผนก PQM",
              doc.PqmNotifyName,
              doc.PqmNotifyEmail,
            ),
            contactCard(
              "เจ้าหน้าที่แผนก โลจิสติกส์",
              doc.LogNotifyName,
              doc.LogNotifyEmail,
            ),
            doc.NcrType === "SCRAP_PARTS"
              ? contactCard(
                  "เจ้าหน้าที่แผนกรับเข้าคลังอะไหล่",
                  doc.InboundAssigneeName,
                  doc.InboundAssigneeEmail,
                )
              : "",
          ]
            .filter(Boolean)
            .join("");

          // สถานะการอนุมัติแต่ละขั้น — เฉพาะขั้นที่มีคนเซ็นแล้วเท่านั้นถึงจะโชว์ (ใครยังไม่ถึงคิวไม่ต้องมีบรรทัดว่างๆ)
          const approvalRow = (label, name, at, comment) => {
            if (!name) return "";
            return `
                        <tr class="border-b border-slate-100 last:border-0">
                            <td class="px-2 py-1.5 text-sm font-medium text-slate-700 whitespace-nowrap">${label}</td>
                            <td class="px-2 py-1.5 text-sm">${name}</td>
                            <td class="px-2 py-1.5 text-sm text-slate-500 whitespace-nowrap">${at ? formatThaiDate(at) : "-"}</td>
                            <td class="px-2 py-1.5 text-sm text-slate-500">${comment || "-"}</td>
                        </tr>`;
          };
          const approvalRowsHtml = [
            approvalRow(
              "ผู้บริหาร",
              doc.MidApproverName,
              doc.MidApproverAt,
              doc.MidComment,
            ),
            approvalRow(
              "เจ้าหน้าที่การตลาด",
              doc.MarketingName,
              doc.MarketingAt,
              doc.MarketingComment,
            ),
            approvalRow("SCM", doc.ScmName, doc.ScmAt, doc.ScmComment),
            approvalRow(
              "เจ้าหน้าที่แผนก โลจิสติกส์",
              doc.LogByName,
              doc.LogAt,
              doc.LogComment,
            ),
            approvalRow(
              "เจ้าหน้าที่แผนกรับเข้าคลังอะไหล่",
              doc.InboundConfirmByName,
              doc.InboundConfirmAt,
              doc.InboundConfirmComment,
            ),
          ]
            .filter(Boolean)
            .join("");

          // เลขที่เอกสารอ้างอิงจาก SCM — โชว์เฉพาะที่มีค่า
          const refNumbersHtml = [
            // SCRAP ใช้ "เลขที่ WO" (เก็บในคอลัมน์ DoNumber เดียวกัน) พร้อมเลขที่ Wave ถ้ามี
            doc.DoNumber
              ? `<div><span class="text-slate-400">${doc.NcrType === "SCRAP" ? "เลขที่ WO" : "เลขที่ DO"}:</span> <span class="font-mono">${doc.DoNumber}</span></div>`
              : "",
            doc.WaveNumber
              ? `<div><span class="text-slate-400">เลขที่ Wave:</span> <span class="font-mono">${doc.WaveNumber}</span></div>`
              : "",
            doc.InboundNumber
              ? `<div><span class="text-slate-400">เลขที่ Inbound:</span> <span class="font-mono">${doc.InboundNumber}</span></div>`
              : "",
            doc.PoNumber
              ? `<div><span class="text-slate-400">เลขที่ PO:</span> <span class="font-mono">${doc.PoNumber}</span></div>`
              : "",
          ]
            .filter(Boolean)
            .join("");

          body.innerHTML = `
                    <div class="grid grid-cols-2 gap-3 text-sm">
                        <div><span class="text-slate-400">วันที่:</span> ${formatThaiDate(doc.DocDate)}</div>
                        <div><span class="text-slate-400">ประเภท NCR:</span> ${getNcrTypeLabel(doc)}</div>
                        <div><span class="text-slate-400">สถานะการเคลม:</span> ${getClaimStatusLabel(doc)}</div>
                        <div><span class="text-slate-400">Movement Type:</span> ${doc.MovementType || "-"}</div>
                        <div><span class="text-slate-400">สถานะ:</span> ${getStatusBadge(doc)}</div>
                        ${doc.OtherTypeNote ? `<div class="col-span-2"><span class="text-slate-400">หมายเหตุประเภทอื่นๆ:</span> ${doc.OtherTypeNote}</div>` : ""}
                        ${refNumbersHtml ? `<div class="col-span-2 flex flex-wrap gap-x-4">${refNumbersHtml}</div>` : ""}
                        ${doc.HasAttachment ? `<div class="col-span-2 text-emerald-600">📎 มีเอกสารแนบจากคุณภาพ${Array.isArray(doc.attachments) && doc.attachments.length > 0 ? ` (${doc.attachments.length} ไฟล์): ${doc.attachments.map((a) => a.fileName).filter(Boolean).join(", ")}` : doc.AttachmentFileName ? `: ${doc.AttachmentFileName}` : ""}</div>` : ""}
                    </div>
                    ${doc.RejectReason ? `<div class="text-sm bg-red-50 border border-red-100 rounded-lg p-2 text-red-700"><span class="font-semibold">เหตุผลที่ตีกลับล่าสุด (${doc.RejectedAt ? formatThaiDate(doc.RejectedAt) : ""}):</span> ${doc.RejectReason}</div>` : ""}

                    <div>
                        <p class="text-sm text-slate-400 uppercase font-semibold mb-2">รายการสินค้า</p>
                        <div class="border border-slate-200 rounded-lg overflow-hidden">
                            <div class="overflow-x-auto">
                            <table class="w-full text-left text-sm">
                                <thead><tr class="bg-slate-50 border-b border-slate-200">
                                    <th class="px-2 py-1.5 text-sm font-semibold text-slate-500 uppercase">Prod.Code</th>
                                    <th class="px-2 py-1.5 text-sm font-semibold text-slate-500 uppercase">Description</th>
                                    <th class="px-2 py-1.5 text-sm font-semibold text-slate-500 uppercase">Qty</th>
                                    <th class="px-2 py-1.5 text-sm font-semibold text-slate-500 uppercase">หน่วย</th>
                                    <th class="px-2 py-1.5 text-sm font-semibold text-slate-500 uppercase">ชื่อร้าน</th>
                                    <th class="px-2 py-1.5 text-sm font-semibold text-slate-500 uppercase">Remark</th>
                                </tr></thead>
                                <tbody>${itemsHtml}</tbody>
                            </table>
                            </div>
                        </div>
                    </div>

                    <div>
                        <p class="text-sm text-slate-400 uppercase font-semibold mb-2">ผู้เกี่ยวข้องกับเอกสาร</p>
                        <div class="grid grid-cols-2 gap-2">${contactCardsHtml}</div>
                    </div>

                    ${
                      doc.NcrType === "SCRAP_PARTS" &&
                      (doc.partsItems || []).length > 0
                        ? `
                    <div>
                        <p class="text-sm text-slate-400 uppercase font-semibold mb-2">รายการอะไหล่ที่แยกได้</p>
                        <div class="border border-slate-200 rounded-lg overflow-hidden">
                            <div class="overflow-x-auto">
                            <table class="w-full text-left text-sm">
                                <thead><tr class="bg-slate-50 border-b border-slate-200">
                                    <th class="px-2 py-1.5 text-sm font-semibold text-slate-500 uppercase">Prod.Code</th>
                                    <th class="px-2 py-1.5 text-sm font-semibold text-slate-500 uppercase">Description</th>
                                    <th class="px-2 py-1.5 text-sm font-semibold text-slate-500 uppercase">Qty</th>
                                    <th class="px-2 py-1.5 text-sm font-semibold text-slate-500 uppercase">หน่วย</th>
                                    <th class="px-2 py-1.5 text-sm font-semibold text-slate-500 uppercase">ชื่อร้าน</th>
                                    <th class="px-2 py-1.5 text-sm font-semibold text-slate-500 uppercase">Remark</th>
                                </tr></thead>
                                <tbody>${partsItemsHtml}</tbody>
                            </table>
                            </div>
                        </div>
                    </div>`
                        : ""
                    }

                    ${
                      approvalRowsHtml
                        ? `
                    <div>
                        <p class="text-sm text-slate-400 uppercase font-semibold mb-2">สถานะการอนุมัติแต่ละขั้น</p>
                        <div class="border border-slate-200 rounded-lg overflow-hidden">
                            <div class="overflow-x-auto">
                            <table class="w-full text-left text-sm">
                                <thead><tr class="bg-slate-50 border-b border-slate-200">
                                    <th class="px-2 py-1.5 text-sm font-semibold text-slate-500 uppercase">ขั้นตอน</th>
                                    <th class="px-2 py-1.5 text-sm font-semibold text-slate-500 uppercase">ผู้ดำเนินการ</th>
                                    <th class="px-2 py-1.5 text-sm font-semibold text-slate-500 uppercase">วันที่</th>
                                    <th class="px-2 py-1.5 text-sm font-semibold text-slate-500 uppercase">ความเห็น</th>
                                </tr></thead>
                                <tbody>${approvalRowsHtml}</tbody>
                            </table>
                            </div>
                        </div>
                    </div>`
                        : ""
                    }
                `;
          lucide.createIcons();
        } catch (err) {
          body.innerHTML = `<p class="text-center text-red-500 py-8 text-sm">โหลดข้อมูลไม่สำเร็จ: ${err.message}</p>`;
        } finally {
          viewDocumentLoadingId = null;
        }
      }

      function closeViewModal() {
        document.getElementById("viewModal").classList.add("hidden");
      }

      // ================= สร้าง HTML หน้ากระดาษเอกสาร (ใช้ร่วมกัน Preview และพิมพ์จริง) =================
      function buildDocPaperHtml(doc) {
        const items = doc.items || [];
        const rows =
          items
            .map(
              (item, i) => `
                <tr>
                    <td class="border border-slate-300 px-4 py-3 text-xs text-left text-slate-500">${i + 1}</td>
                    <td class="border border-slate-300 px-4 py-3 text-xs font-mono break-words">${item.ProdCode || "-"}</td>
                    <td class="border border-slate-300 px-4 py-3 text-xs break-words">${item.Description || "-"}</td>
                    <td class="border border-slate-300 px-4 py-3 text-xs text-right whitespace-nowrap">${item.Qty ?? 0} ${item.Unit || ""}</td>
                    <td class="border border-slate-300 px-4 py-3 text-xs break-words">${item.ShopName || "-"}</td>
                    <td class="border border-slate-300 px-4 py-3 text-xs break-words">${item.Remark || "-"}</td>
                </tr>
            `,
            )
            .join("") ||
          `<tr><td colspan="6" class="border border-slate-300 px-4 py-6 text-center text-slate-400">ไม่มีรายการสินค้า</td></tr>`;

        // 🆕 25/09/2569 : รายการอะไหล่ที่แยกได้ — กรอกโดยเจ้าหน้าที่แผนกรับเข้าคลังอะไหล่ตอนอนุมัติขั้น SPM
        //    มีความหมายเฉพาะ NcrType = SCRAP_PARTS เท่านั้น แสดงทั้งบน Preview และตอนพิมพ์จริง
        const partsItems = doc.NcrType === "SCRAP_PARTS" ? (doc.partsItems || []) : [];
        // 🆕 26/09/2569 : ตัดคอลัมน์ "ชื่อร้าน" และ "Remark" ออก (ผู้สร้างเอกสารกรอกไว้แล้วในตารางรายการหลักด้านบน)
        //    แล้วขยาย Prod.Code / Description / Qty ให้เต็มความกว้างแทน
        const partsItemsRows = partsItems
          .map(
            (item, i) => `
                <tr>
                    <td class="border border-slate-300 px-4 py-3 text-xs text-left text-slate-500">${i + 1}</td>
                    <td class="border border-slate-300 px-4 py-3 text-xs font-mono break-words">${item.ProdCode || "-"}</td>
                    <td class="border border-slate-300 px-4 py-3 text-xs break-words">${item.Description || "-"}</td>
                    <td class="border border-slate-300 px-4 py-3 text-xs text-right whitespace-nowrap">${item.Qty ?? 0} ${item.Unit || ""}</td>
                </tr>
            `,
          )
          .join("");
        const partsItemsTableHtml = partsItems.length
          ? `<div class="overflow-x-auto mb-8 rounded-lg border border-slate-300">
                    <p class="text-sm font-semibold text-slate-700 bg-slate-100 px-4 py-2 border-b border-slate-300">รายการอะไหล่ที่แยกได้</p>
                    <table class="w-full border-collapse text-sm" style="table-layout: fixed;">
                        <colgroup>
                            <col style="width: 6%;"><col style="width: 22%;"><col style="width: 56%;">
                            <col style="width: 16%;">
                        </colgroup>
                        <thead>
                            <tr class="bg-slate-50">
                                <th class="border border-slate-300 px-3 py-2 text-center text-[11px] font-semibold">No.</th>
                                <th class="border border-slate-300 px-3 py-2 text-center text-[11px] font-semibold">Prod.Code</th>
                                <th class="border border-slate-300 px-3 py-2 text-center text-[11px] font-semibold">Description</th>
                                <th class="border border-slate-300 px-3 py-2 text-center text-[11px] font-semibold">Qty</th>
                            </tr>
                        </thead>
                        <tbody>${partsItemsRows}</tbody>
                    </table>
                </div>`
          : "";

        const sigMidLabel = "ผู้บริหาร";

        // 🆕 25/09/2569 : ประเภท NCR ของเอกสารนี้ — ใช้กำหนดว่าจะโชว์ช่อง/ลายเซ็นไหนบ้าง
        //    ⚠️ ต้องตรงกับ n8n "Code - Determine Log Route" และ approve.html:
        //    Marketing (StepNo 1) : เฉพาะ SCRAP_CLAIM_VENDOR
        //    SPM/MCM Inbound (StepNo 5) : เฉพาะ SCRAP_PARTS
        const ncrType = doc.NcrType;
        const showMarketingStage = ncrType === "SCRAP_CLAIM_VENDOR";
        const showSpmStage = ncrType === "SCRAP_PARTS";
        const claimStatusLabel = getClaimStatusLabel(doc);
        // 🆕 25/09/2569 (ปรับรอบ 2) : จัดคอลัมน์หัวเอกสารแบบไดนามิกตามจำนวนช่องที่โชว์จริง
        //    (เดิมล็อก 4 คอลัมน์ตายตัว พอไม่มี "สถานะการเคลม" จะเหลือช่องว่างด้านขวา ทำให้ "วันที่"/"ประเภท NCR" ไม่อยู่กึ่งกลาง/ขวาสุดจริง)
        const headerInfoItems = [
          { label: "เลขที่เอกสาร", value: doc.DocId, mono: true, bold: true },
          { label: "วันที่", value: formatThaiDate(doc.DocDate) },
          { label: "ประเภท NCR", value: getNcrTypeLabel(doc) },
          claimStatusLabel ? { label: "สถานะการเคลม", value: claimStatusLabel } : null,
        ].filter(Boolean);

        // 🆕 25/09/2569 : เลขที่อ้างอิงจาก SCM (DO, Wave, Inbound, PO) — โชว์ตามประเภท NCR
        //    ⚠️ ต้องตรงกับ n8n "Code - Validate SCM Document Numbers":
        //    SCRAP → DO, Wave | SCRAP_PARTS → DO, Inbound | SCRAP_CLAIM_VENDOR → DO, PO | OTHER → DO, Wave, Inbound, PO
        // 🔧 29/09/2569 : ยกเลิกป้าย "เลขที่ WO" — ใช้ "เลขที่ DO" ทุกประเภท (ต้องตรงกับ approve.html ncrDoLabel())
        const doLabel = "เลขที่ DO";
        const showDo = ["SCRAP", "SCRAP_PARTS", "SCRAP_CLAIM_VENDOR", "OTHER"].includes(ncrType);
        const showWave = ["SCRAP", "OTHER"].includes(ncrType);
        const showInbound = ["SCRAP_PARTS", "OTHER"].includes(ncrType);
        const showPo = ["SCRAP_CLAIM_VENDOR", "OTHER"].includes(ncrType);
        const refNumberItems = [
          showDo ? { label: doLabel, field: "DoNumber", value: doc.DoNumber || "-" } : null,
          showWave ? { label: "เลขที่ Wave", field: "WaveNumber", value: doc.WaveNumber || "-" } : null,
          showInbound ? { label: "เลขที่ Inbound", field: "InboundNumber", value: doc.InboundNumber || "-" } : null,
          showPo ? { label: "เลขที่ PO", field: "PoNumber", value: doc.PoNumber || "-" } : null,
        ].filter(Boolean);
        // 🆕 25/09/2569 (ปรับรอบ 2) : ไม่ต้องมีแถวเลขที่อ้างอิงแยกต่างหากอีกแล้ว — ย้ายไปโชว์ในช่องย่อยของกล่องความเห็น SCM แทน (ด้านล่าง)

        // 🆕 25/09/2569 : ช่องย่อยในกล่องความเห็น SCM (Inventory Control) — เหมือนระบบ Disassembly
        // 🔧 03/10/2569 : ปรับเป็น 2 คอลัมน์เสมอ (เดิม 4 คอลัมน์ตอนประเภท OTHER ทำให้กล่องแคบเกินไป
        //    เลขที่อ้างอิงยาวๆ เลยตัดขึ้นบรรทัดใหม่) — 2 คอลัมน์ให้แต่ละกล่องกว้างขึ้น พอดีกับข้อมูล 1 บรรทัด
        const scmSubBoxesHtml = refNumberItems.length
          ? `<div class="grid grid-cols-2 gap-2 mt-3">${refNumberItems
              .map(
                (r) => `
                    <div class="bg-white border border-slate-200 rounded-md px-2.5 py-2">
                        <p class="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">${r.label}</p>
                        <p class="text-xs font-mono text-slate-700 mt-0.5 whitespace-nowrap overflow-x-auto">${r.value}</p>
                    </div>`,
              )
              .join("")}</div>`
          : "";

        // 🆕 25/09/2569 : บรรทัดหน้าพิมพ์ — ต่อท้ายเลขที่อ้างอิงในวงเล็บหลังความเห็น SCM (เหมือนระบบ Disassembly)
        const scmExtraParts = refNumberItems
          .filter((r) => doc[r.field])
          .map((r) => `${r.label}: ${r.value}`);
        const scmExtraText = scmExtraParts.length ? ` (${scmExtraParts.join(" / ")})` : "";
        const scmCommentPrintDisplay = ((doc.ScmComment || "") + scmExtraText).trim() || "-";

        // ⚠️ ปรับให้ขนาด/สไตล์เหมือนหน้ากระดาษของระบบ SWAP ทุกประการ (Tailwind class แทนการใช้ inline style เดิม)
        // ตามที่ขอไว้ว่าให้ยึด SWAP เป็นมาตรฐาน เพราะมองเห็นชัดเจนที่สุด
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

        return `
                <div class="flex items-start justify-between border-b-2 border-slate-800 pb-6 mb-8">
                    <div>
                        <p class="text-sm font-bold text-orange-600 uppercase tracking-wider">KTW GROUP</p>
                        <p class="text-sm text-slate-500 mt-0.5">บริษัท เกรียงไทยวัฒนากรุ๊ป</p>
                        <h2 class="text-lg font-bold mt-3">แบบฟอร์ม NCR (Non-Conformance Control Report)</h2>
                    </div>
                    <div class="text-right text-sm text-slate-500 shrink-0">
                        <p>F-15-E01</p>
                        <p class="mt-0.5">Movement Type: ${doc.MovementType || "-"}</p>
                    </div>
                </div>

                <div class="grid grid-cols-${headerInfoItems.length} gap-6 text-sm mb-8">
                    ${headerInfoItems
                      .map(
                        (h) =>
                          `<div><p class="text-slate-400">${h.label}</p><p class="${h.mono ? "font-mono " : ""}font-${h.bold ? "bold" : "semibold"} text-base mt-0.5">${h.value}</p></div>`,
                      )
                      .join("")}
                </div>

                <div class="overflow-x-auto mb-8 rounded-lg border border-slate-300">
                    <table class="w-full border-collapse text-sm" style="table-layout: fixed;">
                        <colgroup>
                            <col style="width: 5.99%;">
                            <col style="width: 18.08%;">
                            <col style="width: 32.2%;">
                            <col style="width: 9.27%;">
                            <col style="width: 17.51%;">
                            <col style="width: 16.95%;">
                        </colgroup>
                        <thead>
                            <tr class="bg-slate-100">
                                <th class="border border-slate-300 px-3 py-2 text-center text-[11px] font-semibold">No.</th>
                                <th class="border border-slate-300 px-3 py-2 text-center text-[11px] font-semibold">Prod.Code</th>
                                <th class="border border-slate-300 px-3 py-2 text-center text-[11px] font-semibold">Description</th>
                                <th class="border border-slate-300 px-3 py-2 text-center text-[11px] font-semibold">Qty</th>
                                <th class="border border-slate-300 px-3 py-2 text-center text-[11px] font-semibold">ชื่อร้าน</th>
                                <th class="border border-slate-300 px-3 py-2 text-center text-[11px] font-semibold">Remark</th>
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>

                ${partsItemsTableHtml}

                <!-- กล่องความเห็นประกอบการอนุมัติ — โชว์เฉพาะตอนดู Preview บนหน้าจอ ไม่ต้องออกมาตอนพิมพ์เอกสารจริง -->
                <!-- 🆕 25/09/2569 : โชว์เฉพาะกล่องที่เกี่ยวข้องกับประเภท NCR นี้ + กล่อง SCM มีช่องย่อยเลขที่อ้างอิงเหมือนระบบ Disassembly -->
                <div class="no-print grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
                    ${[
                      `<div class="bg-slate-50 border border-slate-200 rounded-lg p-4">
                        <p class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">ความเห็นประกอบการอนุมัติ ผู้บริหาร</p>
                        <p class="text-sm text-slate-700 leading-relaxed">${doc.MidComment || "-"}</p>
                    </div>`,
                      showMarketingStage
                        ? `<div class="bg-slate-50 border border-slate-200 rounded-lg p-4">
                        <p class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">ความเห็นจาก เจ้าหน้าที่การตลาด</p>
                        <p class="text-sm text-slate-700 leading-relaxed">${doc.MarketingComment || "-"}</p>
                    </div>`
                        : "",
                      `<div class="bg-slate-50 border border-slate-200 rounded-lg p-4">
                        <p class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">ความเห็นประกอบการอนุมัติ เจ้าหน้าที่แผนก SCM</p>
                        <p class="text-sm text-slate-700 leading-relaxed">${doc.ScmComment || "-"}</p>
                        ${scmSubBoxesHtml}
                    </div>`,
                      `<div class="bg-slate-50 border border-slate-200 rounded-lg p-4">
                        <p class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">ความเห็นประกอบการอนุมัติ เจ้าหน้าที่แผนก โลจิสติกส์</p>
                        <p class="text-sm text-slate-700 leading-relaxed">${doc.LogComment || "-"}</p>
                    </div>`,
                      showSpmStage
                        ? `<div class="bg-slate-50 border border-slate-200 rounded-lg p-4">
                        <p class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">ความเห็นประกอบการอนุมัติ เจ้าหน้าที่รับเข้าคลังอะไหล่</p>
                        <p class="text-sm text-slate-700 leading-relaxed">${doc.InboundConfirmComment || "-"}</p>
                    </div>`
                        : "",
                    ]
                      .filter(Boolean)
                      .join("")}
                </div>

                <!-- 🖨️ หน้าพิมพ์: ความเห็นประกอบการอนุมัติ แบบข้อความบรรทัดเดียว ไม่มีกรอบ (แสดงเฉพาะตอนพิมพ์ เหมือนระบบ Disassembly) -->
                <div class="print-only space-y-2 mb-10 text-sm text-slate-800">
                    <p class="break-words"><span class="font-semibold">ความเห็นประกอบการอนุมัติ — ผู้บริหาร :</span> ${doc.MidComment || "-"}</p>
                    ${showMarketingStage ? `<p class="break-words"><span class="font-semibold">ความเห็นประกอบการอนุมัติ — เจ้าหน้าที่การตลาด :</span> ${doc.MarketingComment || "-"}</p>` : ""}
                    <p class="break-words"><span class="font-semibold">ความเห็นประกอบการอนุมัติ — เจ้าหน้าที่แผนก SCM :</span> ${scmCommentPrintDisplay}</p>
                    <p class="break-words"><span class="font-semibold">ความเห็นประกอบการอนุมัติ — เจ้าหน้าที่แผนก โลจิสติกส์ :</span> ${doc.LogComment || "-"}</p>
                    ${showSpmStage ? `<p class="break-words"><span class="font-semibold">ความเห็นประกอบการอนุมัติ — เจ้าหน้าที่รับเข้าคลังอะไหล่ :</span> ${doc.InboundConfirmComment || "-"}</p>` : ""}
                </div>

                <!-- แถวที่ 1: ขั้นตอนขออนุมัติ (ผู้ขอ → ผู้บริหาร → การตลาด) -->
                <div class="flex gap-8 pt-10">
                    ${[
                      sigBlock("ผู้ขออนุมัติเอกสาร NCR", doc.CreatedByName, null),
                      sigBlock(sigMidLabel, doc.MidApproverName, doc.MidApproverSignature),
                      showMarketingStage ? sigBlock("เจ้าหน้าที่การตลาด", doc.MarketingName, null) : "",
                    ]
                      .filter(Boolean)
                      .join("")}
                </div>

                <!-- 🆕 25/09/2569 : แถวที่ 2 — ขั้นตอนดำเนินการจริง (SCM → โลจิสติกส์ → SPM/MCM Inbound เฉพาะที่เกี่ยวข้อง) -->
                <div class="flex gap-8 pt-12">
                    ${[
                      sigBlock("เจ้าหน้าที่แผนก SCM", doc.ScmName, doc.ScmSignature),
                      sigBlock("เจ้าหน้าที่แผนก โลจิสติกส์", doc.LogByName, null),
                      showSpmStage ? sigBlock("เจ้าหน้าที่แผนกรับเข้าคลังอะไหล่", doc.InboundConfirmByName, null) : "",
                    ]
                      .filter(Boolean)
                      .join("")}
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

      // ================= Preview เอกสาร =================
      // 📎 แสดงไฟล์แนบในหน้า Preview — ทุก Role ที่เห็นปุ่ม Preview ดูได้
      //    วางไว้นอกกระดาษ (previewDocPaper) เพื่อไม่ให้ปนไปกับฟอร์มตอนสั่งพิมพ์
      //    (ยกชุดเดียวกับ disassembly_form.html มาเพื่อให้ทั้งสองระบบหน้าตาเหมือนกัน)
      let previewAttachments = [];

      function renderPreviewAttachment(doc) {
        const bar = document.getElementById("previewAttachmentBar");
        if (!bar) return;

        const hasAtt =
          doc.HasAttachment === true || Number(doc.HasAttachment) === 1;

        // 📎 22/09/2569 : รองรับหลายไฟล์ — ใช้ doc.attachments ถ้ามี, ไม่งั้น fallback เป็นฟิลด์เดี่ยวแบบเดิม
        //    (NCR ส่งชื่อ field เดี่ยวเป็นตัวใหญ่ AttachmentBase64 ส่วน Disassembly ใช้ตัวเล็ก รับทั้งสองแบบ)
        let list = Array.isArray(doc.attachments)
          ? doc.attachments.filter((a) => a && a.fileBase64)
          : [];
        if (list.length === 0) {
          const base64 = doc.AttachmentBase64 || doc.attachmentBase64 || "";
          const fileName = doc.AttachmentFileName || doc.attachmentFileName || "";
          const fileType = doc.AttachmentFileType || doc.attachmentFileType || "";
          if (base64) list = [{ fileName, fileType, fileBase64: base64 }];
        }

        if (!hasAtt || list.length === 0) {
          bar.classList.add("hidden");
          bar.innerHTML = "";
          previewAttachments = [];
          return;
        }

        previewAttachments = list;

        bar.innerHTML = list
          .map((a, idx) => {
            const isImage = /^image\//i.test(a.fileType || "");
            const dataUrl = `data:${a.fileType || "application/octet-stream"};base64,${a.fileBase64}`;
            return `
          <div class="flex items-center justify-between gap-3 flex-wrap ${idx > 0 ? "mt-3 pt-3 border-t border-slate-100" : ""}">
            <div class="flex items-center gap-2 min-w-0">
              <i data-lucide="paperclip" class="w-4 h-4 text-brand-500 shrink-0"></i>
              <span class="text-xs font-semibold text-slate-700">เอกสารแนบประกอบ${list.length > 1 ? ` (${idx + 1}/${list.length})` : ""}:</span>
              <span class="text-xs text-slate-600 truncate">${a.fileName || "-"}</span>
            </div>
            <div class="flex items-center gap-2">
              <button type="button" onclick="openPreviewAttachment(${idx})"
                class="px-3 py-1.5 text-xs font-medium rounded-lg bg-brand-50 text-brand-700 hover:bg-brand-100 transition-colors flex items-center gap-1">
                <i data-lucide="external-link" class="w-3 h-3"></i>เปิดดู
              </button>
              <a href="${dataUrl}" download="${a.fileName || "attachment"}"
                class="px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors flex items-center gap-1">
                <i data-lucide="download" class="w-3 h-3"></i>ดาวน์โหลด
              </a>
            </div>
          </div>
          ${isImage ? `<img src="${dataUrl}" alt="${a.fileName || ""}" class="mt-3 max-h-80 mx-auto rounded-lg border border-slate-200">` : ""}
        `;
          })
          .join("");
        bar.classList.remove("hidden");
        lucide.createIcons();
      }

      // เปิดไฟล์แนบในแท็บใหม่ — ใช้ Blob เพราะ Chrome บล็อกการเปิด data URL ขนาดใหญ่
      function openPreviewAttachment(idx) {
        const a = previewAttachments[idx];
        if (!a || !a.fileBase64) return;
        try {
          const bin = atob(a.fileBase64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          const url = URL.createObjectURL(
            new Blob([bytes], {
              type: a.fileType || "application/octet-stream",
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
          const res = await n8nFetch(N8N_BASE + "get_document_detail_ncr", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ docId }),
          });
          if (!res.ok) throw new Error("โหลดข้อมูลไม่สำเร็จ");
          const raw = await res.json();
          const doc = Array.isArray(raw) ? raw[0] : raw;
          if (!doc) throw new Error("ไม่พบข้อมูลเอกสาร");

          currentPreviewDocData = doc;
          document.getElementById("previewDocPaper").innerHTML =
            buildDocPaperHtml(doc);
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

      function closePreviewDocModal() {
        closeModal("previewDocModal", "previewDocModalContent");
      }

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

      // ================= Docflow (เส้นทางการเดินเอกสาร) =================
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
            n8nFetch(N8N_BASE + "get_document_detail_ncr", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ docId }),
            }),
            n8nFetch(N8N_BASE + "get_docflow_ncr", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ docId }),
            }),
          ]);
          const rawDoc = await detailRes.json();
          doc = Array.isArray(rawDoc) ? rawDoc[0] : rawDoc;
          const rawLogsResponse = await flowRes.json();
          const flowData = Array.isArray(rawLogsResponse)
            ? rawLogsResponse[0]
            : rawLogsResponse;
          logs =
            flowData && Array.isArray(flowData.logs)
              ? flowData.logs.filter((l) => l && l.ActionAt)
              : [];
        } catch (err) {
          console.error("Docflow fetch error:", err);
        }

        if (!doc) {
          docFlowContent.innerHTML = `<p class="text-center text-sm text-slate-400 py-6">ไม่พบข้อมูลเอกสาร</p>`;
          return;
        }

        // สร้างรายการ Step แบบ Dynamic ตาม NcrType — ไม่ Hardcode 3 Step ตายตัวอีกต่อไป
        function buildDocFlowSteps(d) {
          const steps = [];
          const isVendor = d.NcrType === "SCRAP_CLAIM_VENDOR";
          const isParts = d.NcrType === "SCRAP_PARTS";
          const skip = !!d.SkipApprover;

          steps.push({
            label: "ผู้ขออนุมัติ",
            name: d.CreatedByName || "—",
            done: true,
            doneText: `✓ ยื่นคำขอเมื่อ ${formatThaiDate(d.DocDate)}`,
          });

          if (isVendor) {
            if (!skip) {
              steps.push({
                label: "ผู้บริหาร",
                name: d.MidApproverName || "รอดำเนินการ",
                done: !!d.MidApproverAt,
                doneText: d.MidApproverAt
                  ? `✓ เซ็นเมื่อ ${formatThaiDate(d.MidApproverAt)}`
                  : null,
              });
            }
            steps.push({
              label: "เจ้าหน้าที่การตลาด",
              name: d.MarketingName || "รอดำเนินการ",
              done: !!d.MarketingAt,
              doneText: d.MarketingAt
                ? `✓ เซ็นเมื่อ ${formatThaiDate(d.MarketingAt)}`
                : null,
            });
            // ผู้บริหารรอบสอง — แสดงเฉพาะเมื่อรู้ผลแน่ชัดแล้วว่าต้องมี (เดินทางผ่านมาแล้ว หรือ MKT ตัดสินว่าเคลมไม่ได้)
            const showSecondApprover =
              skip &&
              (d.StepNo >= 2 ||
                (d.ClaimStatus === "NOT_CLAIMABLE" && d.MarketingAt));
            if (showSecondApprover) {
              steps.push({
                label: "ผู้บริหาร (ยืนยันอีกครั้ง)",
                name: d.MidApproverName || "รอดำเนินการ",
                done: !!d.MidApproverAt,
                doneText: d.MidApproverAt
                  ? `✓ เซ็นเมื่อ ${formatThaiDate(d.MidApproverAt)}`
                  : null,
              });
            }
          } else {
            steps.push({
              label: "ผู้บริหาร",
              name: d.MidApproverName || "รอดำเนินการ",
              done: !!d.MidApproverAt,
              doneText: d.MidApproverAt
                ? `✓ เซ็นเมื่อ ${formatThaiDate(d.MidApproverAt)}`
                : null,
            });
          }

          steps.push({
            label: "เจ้าหน้าที่ SCM",
            name: d.ScmName || "รอดำเนินการ",
            done: !!d.ScmAt,
            doneText: d.ScmAt
              ? `✓ เซ็นเมื่อ ${formatThaiDate(d.ScmAt)}`
              : null,
          });

          steps.push({
            label: "เจ้าหน้าที่แผนก โลจิสติกส์",
            name: d.LogByName || "รอดำเนินการ",
            done: !!d.LogAt,
            doneText: d.LogAt
              ? `✓ ยืนยันเมื่อ ${formatThaiDate(d.LogAt)}`
              : null,
          });

          if (isParts) {
            steps.push({
              label: "เจ้าหน้าที่แผนกรับเข้าคลังอะไหล่",
              name: d.InboundConfirmByName || "รอดำเนินการ",
              done: !!d.InboundConfirmAt,
              doneText: d.InboundConfirmAt
                ? `✓ รับของเมื่อ ${formatThaiDate(d.InboundConfirmAt)}`
                : null,
            });
          }

          return steps;
        }

        const flowSteps = buildDocFlowSteps(doc);

        const stepStyle = (done) =>
          done ? "bg-emerald-500 text-white" : "bg-slate-200 text-slate-400";
        const stepIcon = (done) => (done ? "check" : "minus");

        const logsHtml = logs
          .map(
            (log) => `
                <div class="flex items-start gap-2.5">
                    <div class="w-1.5 h-1.5 rounded-full bg-brand-500 mt-1.5 shrink-0"></div>
                    <div>
                        <p class="text-sm font-medium text-slate-700">${log.Detail || log.Action}</p>
                        <p class="text-xs text-slate-400">${log.ActionBy || ""} • ${formatThaiDateTime(log.ActionAt)}</p>
                    </div>
                </div>`,
          )
          .join("");

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

                    <div class="relative pl-7 border-l-2 border-slate-200 space-y-6">
                        ${flowSteps
                          .map(
                            (s, idx) => `
                        <div class="relative">
                            <span class="absolute -left-[29px] top-0.5 flex h-5 w-5 items-center justify-center rounded-full ${stepStyle(s.done)} ring-4 ring-white">
                                <i data-lucide="${stepIcon(s.done)}" class="w-3 h-3"></i>
                            </span>
                            <div class="text-base font-bold text-slate-800">${idx + 1}. ${s.label}</div>
                            <div class="text-sm text-slate-500 mt-0.5">${s.name}</div>
                            ${
                              s.doneText
                                ? `<div class="text-xs text-emerald-600 font-semibold mt-1">${s.doneText}</div>`
                                : `<div class="text-xs ${idx === 0 ? "text-amber-500" : "text-slate-400"} font-semibold mt-1">${idx === 0 ? "⏳ รอดำเนินการ" : "— ยังไม่ดำเนินการ"}</div>`
                            }
                        </div>`,
                          )
                          .join("")}
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

      // ================= Modal ทั่วไป + Toast + Error helper =================
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

      function extractErrorMessage(
        result,
        fallback = "เกิดข้อผิดพลาดไม่ทราบสาเหตุ กรุณาลองใหม่อีกครั้ง",
      ) {
        if (!result) return fallback;
        return result.error || result.message || result.description || fallback;
      }

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

      // ⚠️ Auto-open: ถ้า URL มี ?doc=... (เช่น ลิงก์จากอีเมลแจ้งเตือนตีกลับ) ให้เปิด modal แก้ไขเอกสารนั้นให้อัตโนมัติ
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
          // เอกสารเสร็จสิ้นแล้ว (เช่น จากอีเมล "อนุมัติสมบูรณ์") → เปิดดูอย่างเดียว ไม่เปิดโหมดแก้ไข
          // 🔧 03/10/2569 : ปรับให้ตรงกับ SWAP/Disassembly — ลิงก์อีเมลเปิด previewDocument() (ทุก Role เปิดได้)
          //    เพราะ openDisplayDocModal() ถูกผูกกับปุ่ม Display ที่เฉพาะ Admin เท่านั้น ผู้ใช้ทั่วไปกดลิงก์แล้วต้องดูได้ด้วย
          previewDocument(docId);
        } else {
          // ค่าเริ่มต้น (เช่น จากอีเมล "ถูกตีกลับ") → เปิดโหมดแก้ไขให้ผู้สร้างแก้ไขได้ทันที
          openEditDocModal(docId);
        }
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
        await loadNcrRoleMembers();
        lucide.createIcons();
        openFromUrlIfNeeded();
      };
