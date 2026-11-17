// ===================================================================
// modules/claimService.js — Service Logic สำหรับ KTW HUB
// ===================================================================

      const N8N_BASE = "https://n8n.ktw.co.th/webhook/";

      // ================= ตัวตนผู้ใช้ + สิทธิ์ =================
      const empId = sessionStorage.getItem("emp_id") || "";
      const empName = sessionStorage.getItem("name") || "";
      const empEmail = sessionStorage.getItem("email") || "";
      // สิทธิ์เฉพาะระบบเคลมสินค้าลูกค้า (ตั้งไว้ตอน login ผ่าน webhook get_role_claim_cus)
      const claimRole = sessionStorage.getItem("claim_role") || "0";
      const isAdminUser = claimRole === "1";

      // ===== สิทธิ์รายข้อจากระบบ Permission (fail-safe: ยังไม่พร้อม → ใช้กติกา Role เดิม) =====
      // ⚠️ ซ่อน/แสดงปุ่มเพื่อ UX เท่านั้น ตัวบังคับจริงอยู่ที่ n8n (Check Permission) ทุก endpoint
      const PSYS = "CLM";
      function pReady() { return !!(window.KTWPerm && window.KTWPerm.isReady()); }
      function pcan(act, legacy) { return pReady() ? window.KTWPerm.can(PSYS, act) : !!legacy; }
      function pAnyOwn(any, own, isOwner, legacy) {
        return pReady() ? (window.KTWPerm.can(PSYS, any) || (window.KTWPerm.can(PSYS, own) && !!isOwner)) : !!legacy;
      }
      window.addEventListener("ktwperm", function (e) {
        if (typeof __permApply === "function") __permApply(!!(e.detail && e.detail.changed));
      });
      const isMktUser = claimRole === "3";
      // ผู้บริหารอนุมัติ — เป็นผู้พิจารณาแทนการตลาดสำหรับยี่ห้อที่ Admin ตั้งกติกาไว้ (เช่น Makita / Jasic)
      const isExecUser = claimRole === "2";
      // SRV เทคนิคและช่าง — ปิดจบงานแทนกันได้ทุกใบ แต่ไม่มีสิทธิ์พิจารณา
      const isSrvUser = claimRole === "6";

      // ⚠️ เงื่อนไขชุดนี้ต้องตรงกับ SQL - Get All Claim Document Status ฝั่ง n8n เสมอ
      //    ระบบเคลม "ทุก Role เห็นเอกสารทุกใบ" ตามที่หน้างานตกลง เพราะ
      //    Staff (0) กับ SRV (3) ช่วยกันรับของและปิดจบงานแทนกันได้ ไม่ได้แบ่งใบกันตายตัว
      //    การตลาด (2) ต้องเห็นเพื่อพิจารณา · Admin (1) เห็นทุกอย่างอยู่แล้ว
      //
      //    ⚠️ ผลข้างเคียงที่ต้องรู้: คนที่ยังไม่เคยถูกตั้ง Role ในระบบเคลมจะนับเป็น 0 (Staff)
      //    จึงเห็นเอกสารทุกใบด้วย — เท่ากับข้อมูลชื่อร้านและเบอร์ลูกค้าเปิดให้ทุกคนที่ล็อกอินได้
      //    ถ้าวันหลังไม่ต้องการแบบนี้ ให้ตัด "0" ออกทั้งที่นี่และใน SQL พร้อมกัน
      const CLAIM_SEE_ALL_ROLES = ["0", "1", "2", "3", "4", "5", "6"];
      let canSeeAllDocuments = pcan("READ_ALL", CLAIM_SEE_ALL_ROLES.includes(claimRole));

      // เทียบรหัสพนักงานแบบตัดช่องว่างหัวท้าย — คอลัมน์ EmpId ฝั่ง DB เป็น varchar
      // ค่าที่มีช่องว่างติดมาจะทำให้ === ไม่ตรงทั้งที่เป็นคนเดียวกัน
      function isSameEmp(a, b) {
        return String(a ?? "").trim() === String(b ?? "").trim();
      }

      // ผู้ที่ถูกระบุชื่อไว้บนเอกสารใบนั้นโดยตรง ต้องเห็นใบนั้น แม้ยังไม่มี role ในระบบ
      function isNamedOnDoc(doc) {
        return [doc.CreatedByEmpId, doc.MktNotifyEmpId].some((id) =>
          isSameEmp(id, empId),
        );
      }

      let allDocuments = [];
      let itemRowCounter = 0;
      let currentViewDocData = null;
      let currentPreviewDocData = null;

      // ================= Dropdown ผู้พิจารณา (ตามกติกายี่ห้อ) =================
      // ดึงรายชื่อ + กติกายี่ห้อจาก backend แทน hardcode (คนเข้า-ออกทีม/เปลี่ยนผู้ดูแลยี่ห้อ ไม่ต้องแก้ไฟล์นี้)
      //   members = { "2":[...การตลาด], "4":[...ผู้บริหาร] }
      //   rules   = [{ brandKey, approverRoleId, approverEmpId, approverName, approverEmail, isActive }]
      let claimRoleMembers = { mkt: [], srv: [], exec: [], members: {}, rules: [] };

      const APPROVER_ROLE_LABEL = {
        3: "เจ้าหน้าที่การตลาด",
        6: "เทคนิคและช่าง (SRV)",
        2: "ผู้บริหาร",
      };
      const DEFAULT_APPROVER_ROLE = 3;

      function approverRoleLabel(roleId) {
        return APPROVER_ROLE_LABEL[Number(roleId)] || "ผู้พิจารณา";
      }

      // ยี่ห้อจาก autocomplete เป็น "MAKITA/มากีต้า" → คีย์ = ข้อความก่อน "/" ตัวพิมพ์ใหญ่
      // ⚠️ ต้องตรงกับ brandKeyOf ใน Code - Validate Create Claim Input ฝั่ง n8n
      function brandKeyOf(brand) {
        return String(brand || "").split("/")[0].trim().toUpperCase();
      }

      async function loadClaimRoleMembers() {
        try {
          const res = await n8nFetch(N8N_BASE + "get_role_members_claim_cus");
          if (!res.ok) throw new Error("โหลดรายชื่อผู้พิจารณาไม่สำเร็จ");

          // ⚠️ อ่านเป็น text ก่อนเสมอ แล้วค่อย parse เอง — ห้ามใช้ res.json() ตรง ๆ
          //    ถ้ายังไม่มีใครถูกตั้ง Role 2/3/6 เลย SQL อาจคืน 0 แถวแล้ว body ว่างเปล่า
          const rawText = await res.text();
          const raw = rawText && rawText.trim() ? JSON.parse(rawText) : null;
          const data = (Array.isArray(raw) ? raw[0] : raw) || {};
          claimRoleMembers = {
            mkt: Array.isArray(data.mkt) ? data.mkt : [],
            srv: Array.isArray(data.srv) ? data.srv : [],
            technicians: Array.isArray(data.technicians) ? data.technicians : [],
            exec: Array.isArray(data.exec) ? data.exec : [],
            members: data.members && typeof data.members === "object" ? data.members : {},
            rules: Array.isArray(data.rules) ? data.rules : [],
          };
        } catch (err) {
          console.error("loadClaimRoleMembers error", err);
          claimRoleMembers = { mkt: [], srv: [], exec: [], technicians: [], members: {}, rules: [] };
          showNotification(
            "โหลดรายชื่อผู้พิจารณาไม่สำเร็จ",
            "กรุณารีเฟรชหน้าใหม่ หรือติดต่อผู้ดูแลระบบ",
            "error",
          );
        }
        refreshApproverSection();
        fillTechnicianOptions();
      }

      // Service Technician = พนักงาน Role SRV (6) ทั้งหมด — แสดง "รหัส ชื่อ-นามสกุล" และเก็บค่าเป็นข้อความเดียวกัน
      function technicianText(t) {
        return `${t.empId} ${t.name}`.trim();
      }

      function fillTechnicianOptions() {
        const sel = document.getElementById("serviceTechnician");
        if (!sel) return;
        const keep = sel.value;
        const list = (
          claimRoleMembers.technicians && claimRoleMembers.technicians.length
            ? claimRoleMembers.technicians
            : claimRoleMembers.srv || []
        )
          .slice()
          .sort((a, b) =>
            String(a.empId).localeCompare(String(b.empId), undefined, { numeric: true }),
          );
        sel.innerHTML =
          '<option value="">-- เลือกช่างผู้ให้บริการ --</option>' +
          list
            .map((t) => `<option value="${esc(technicianText(t))}">${esc(technicianText(t))}</option>`)
            .join("");
        setTechnicianValue(keep);
      }

      // ค่าเดิมในเอกสาร (เช่น คนที่ไม่ใช่ SRV แล้ว หรือข้อความที่เคยพิมพ์เอง) ต้องไม่หายตอนแก้ไข — เพิ่มเป็นตัวเลือกให้
      function setTechnicianValue(val) {
        const sel = document.getElementById("serviceTechnician");
        const v = String(val || "").trim();
        if (v && !Array.from(sel.options).some((o) => o.value === v)) {
          const opt = document.createElement("option");
          opt.value = v;
          opt.textContent = v;
          sel.appendChild(opt);
        }
        sel.value = v;
      }

      function membersOfRole(roleId) {
        const fromMap = claimRoleMembers.members?.[String(roleId)];
        if (Array.isArray(fromMap)) return fromMap;
        if (Number(roleId) === 3) return claimRoleMembers.mkt;
        if (Number(roleId) === 6) return claimRoleMembers.srv;
        if (Number(roleId) === 2) return claimRoleMembers.exec;
        return [];
      }

      // หากติกาของยี่ห้อหนึ่ง → { roleId, empId } ; ไม่มีกติกา/ปิดใช้งาน = การตลาด (ค่าเริ่มต้น)
      function resolveRuleForBrand(brand) {
        const key = brandKeyOf(brand);
        const rule = key
          ? (claimRoleMembers.rules || []).find(
              (r) =>
                String(r.brandKey || "").toUpperCase() === key &&
                (r.isActive === true || r.isActive === 1 || r.isActive === "1"),
            )
          : null;
        if (!rule) return { roleId: DEFAULT_APPROVER_ROLE, empId: "", brandKey: key };
        return {
          roleId: Number(rule.approverRoleId) || DEFAULT_APPROVER_ROLE,
          empId: String(rule.approverEmpId || "").trim(),
          brandKey: key,
        };
      }

      // สรุปผู้พิจารณาของทั้งเอกสารจากยี่ห้อของทุกแถว (1 เอกสาร = 1 ยี่ห้อ / 1 ผู้พิจารณา)
      // ผู้พิจารณาของเอกสารที่มีหลายยี่ห้อ — ใช้กติกาที่ "เข้มที่สุด" เป็นตัวกำหนด (ต้องตรงกับ SQL ใน n8n):
      //   1) ยี่ห้อที่กำหนดตัวบุคคลไว้ → ต้องเป็นคนนั้น (ถ้ามี 2 คนไม่ตรงกัน = แยกเอกสาร)
      //   2) ไม่มีใครถูกกำหนด แต่มี Role ที่ไม่ใช่การตลาด → ใช้ Role นั้น (ถ้ามีหลาย Role ต่างกัน = แยกเอกสาร)
      //   3) นอกนั้น = การตลาด (Role 3)
      function computeApproverPlan() {
        const rows = Array.from(document.querySelectorAll("#itemRowsBody tr"))
          .filter((tr) => tr.querySelector(".item-prod-code")?.value.trim());
        const rules = rows.map((tr) => resolveRuleForBrand(tr.dataset.brand || ""));
        const brands = Array.from(
          new Set(rows.map((tr) => brandKeyOf(tr.dataset.brand || "")).filter(Boolean)),
        );
        if (rules.length === 0) {
          return { roleId: DEFAULT_APPROVER_ROLE, empId: "", mixed: false, brands: [], drivers: [], multi: false };
        }
        const persons = Array.from(new Set(rules.map((r) => r.empId).filter(Boolean)));
        if (persons.length > 1) {
          return { roleId: DEFAULT_APPROVER_ROLE, empId: "", mixed: true, conflict: "person", brands, drivers: [], multi: brands.length > 1 };
        }
        if (persons.length === 1) {
          const hit = rules.find((r) => r.empId === persons[0]);
          return { roleId: hit.roleId, empId: hit.empId, mixed: false, brands, drivers: rules.filter((r) => r.empId).map((r) => r.brandKey).filter((v, i, a) => v && a.indexOf(v) === i), multi: brands.length > 1 };
        }
        const roles = Array.from(new Set(rules.map((r) => r.roleId).filter((x) => x !== DEFAULT_APPROVER_ROLE)));
        if (roles.length > 1) {
          return { roleId: DEFAULT_APPROVER_ROLE, empId: "", mixed: true, conflict: "role", brands, drivers: [], multi: brands.length > 1 };
        }
        const roleId = roles.length === 1 ? roles[0] : DEFAULT_APPROVER_ROLE;
        return { roleId, empId: "", mixed: false, brands, drivers: rules.filter((r) => r.roleId === roleId && roleId !== DEFAULT_APPROVER_ROLE).map((r) => r.brandKey).filter((v, i, a) => v && a.indexOf(v) === i), multi: brands.length > 1 };
      }

      function approverConflictText() {
        return "ในเอกสารมีสินค้าหลายยี่ห้อที่กำหนดผู้พิจารณาต่างกัน (คนละบุคคล/คนละฝ่าย) ไม่สามารถรวมในใบเดียวได้ กรุณาแยกเป็นคนละเอกสาร";
      }

      function setApproverHint(text, tone) {
        const el = document.getElementById("approverSectionHint");
        if (!text) {
          el.classList.add("hidden");
          el.textContent = "";
          return;
        }
        el.textContent = text;
        el.className =
          "text-[11px] leading-relaxed rounded-lg px-2.5 py-1.5 " +
          (tone === "error"
            ? "bg-red-50 text-red-700 border border-red-100"
            : "bg-amber-50 text-amber-700 border border-amber-100");
      }

      // วาด dropdown ผู้พิจารณาใหม่ตามยี่ห้อที่อยู่ในตารางสินค้า
      // preselectEmpId = รหัสผู้พิจารณาที่เลือกไว้แล้ว (ตอนเปิดแก้ไข) — เลือกให้ถ้ายังอยู่ในรายชื่อ
      let approverPlanKey = "";
      function refreshApproverSection(preselectEmpId) {
        const plan = computeApproverPlan();
        const select = document.getElementById("mktNotifyName");
        const keepEmpId =
          preselectEmpId !== undefined
            ? String(preselectEmpId || "").trim()
            : document.getElementById("mktNotifyEmpId").value.trim();
        const label = approverRoleLabel(plan.roleId);
        document.getElementById("approverSectionTitle").textContent =
          `${label} (ผู้พิจารณา)`;

        if (plan.mixed) {
          select.innerHTML = '<option value="">-- มียี่ห้อที่ผู้พิจารณาต่างกัน แยกเอกสารก่อน --</option>';
          select.disabled = true;
          document.getElementById("mktNotifyEmail").value = "";
          document.getElementById("mktNotifyEmpId").value = "";
          setApproverHint(approverConflictText(), "error");
          return;
        }
        select.disabled = false;

        let list = membersOfRole(plan.roleId);
        // กติการะบุตัวบุคคลไว้ → เหลือคนเดียว (ถ้าเขายังอยู่ในรายชื่อสิทธิ์)
        if (plan.empId) {
          const named = list.filter((p) => String(p.empId).trim() === plan.empId);
          if (named.length) list = named;
        }

        if (!list.length) {
          select.innerHTML = `<option value="">-- ยังไม่มี${label}ในระบบ --</option>`;
          document.getElementById("mktNotifyEmail").value = "";
          document.getElementById("mktNotifyEmpId").value = "";
        } else {
          select.innerHTML = '<option value="">-- เลือกชื่อ --</option>';
          list.forEach((person) => {
            const opt = document.createElement("option");
            opt.value = person.name;
            opt.dataset.email = person.email || "";
            opt.dataset.empId = person.empId;
            opt.textContent = person.name;
            select.appendChild(opt);
          });
          const match = list.find((p) => String(p.empId).trim() === keepEmpId);
          if (match) {
            select.value = match.name;
          } else if (list.length === 1) {
            select.value = list[0].name; // มีคนเดียว เลือกให้เลย
          } else {
            select.value = "";
          }
          onMktSelectChange();
        }

        if (plan.drivers.length && (plan.roleId !== DEFAULT_APPROVER_ROLE || plan.empId)) {
          setApproverHint(
            `ยี่ห้อ ${plan.drivers.join(", ")} — ต้องให้${plan.empId ? "ผู้พิจารณาที่กำหนดไว้" : label}เป็นผู้พิจารณา` +
              (plan.multi ? ` (เอกสารนี้มี ${plan.brands.length} ยี่ห้อ ใช้กติกาที่เข้มที่สุด ผู้พิจารณาจะตัดสินทั้งใบ)` : ""),
            "info",
          );
        } else if (plan.multi) {
          setApproverHint(`เอกสารนี้มี ${plan.brands.length} ยี่ห้อ ผู้พิจารณาจะตัดสินทั้งใบ`, "info");
        } else {
          setApproverHint("", "");
        }
      }

      // อีเมลที่ผู้ใช้พิมพ์แก้เองของผู้พิจารณาคนนั้น — ต้องไม่ถูกเขียนทับตอนฟอร์มรีเฟรชรายชื่อ (เช่นตอนกดบันทึก)
      let mktEmailOverride = null; // { empId, email }
      function onMktEmailEdited() {
        const empId = document.getElementById("mktNotifyEmpId").value.trim();
        const email = document.getElementById("mktNotifyEmail").value.trim();
        mktEmailOverride = empId ? { empId, email } : null;
      }
      // fromUser = true เมื่อผู้ใช้เปลี่ยนชื่อใน dropdown เอง → ทิ้งอีเมลที่เคยแก้ไว้ แล้วใช้อีเมลของคนที่เลือกใหม่
      function onMktSelectChange(fromUser) {
        if (fromUser === true) mktEmailOverride = null;
        const select = document.getElementById("mktNotifyName");
        const opt = select.options[select.selectedIndex];
        const empId = opt ? opt.dataset.empId || "" : "";
        document.getElementById("mktNotifyEmail").value = opt
          ? opt.dataset.email || ""
          : "";
        document.getElementById("mktNotifyEmpId").value = empId;
        if (mktEmailOverride && empId && mktEmailOverride.empId === String(empId).trim()) {
          document.getElementById("mktNotifyEmail").value = mktEmailOverride.email;
        }
      }

      // ================= ตัวช่วยแปลงค่า =================
      const TH_MONTHS = [
        "ม.ค.",
        "ก.พ.",
        "มี.ค.",
        "เม.ย.",
        "พ.ค.",
        "มิ.ย.",
        "ก.ค.",
        "ส.ค.",
        "ก.ย.",
        "ต.ค.",
        "พ.ย.",
        "ธ.ค.",
      ];

      // ⚠️ ฝั่ง n8n แปลงวันที่เป็นข้อความมาแล้วด้วย CONVERT(...,23) และ CONVERT(...,120)
      //    จึงต้องแยกตัวเลขด้วย regex เท่านั้น ห้ามให้ new Date() แตะ
      //    ไม่งั้นเบราว์เซอร์จะตีความบางรูปแบบเป็น UTC แล้วบวก +7 ซ้ำ วันที่เลื่อนไป 1 วัน
      function formatThaiDate(dateStr) {
        const m = String(dateStr || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (!m) return dateStr ? String(dateStr) : "-";
        return `${Number(m[3])} ${TH_MONTHS[Number(m[2]) - 1]} ${Number(m[1]) + 543}`;
      }

      function formatThaiDateTime(dateStr) {
        const m = String(dateStr || "").match(
          /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/,
        );
        if (!m) return formatThaiDate(dateStr);
        return `${Number(m[3])} ${TH_MONTHS[Number(m[2]) - 1]} ${Number(m[1]) + 543} ${m[4]}:${m[5]} น.`;
      }

      // หน่วยสินค้า: เลือกได้ 2 แบบ (PCS / SET) — ค่าเริ่มต้น PCS
      // เอกสารเก่าที่เคยพิมพ์หน่วยอื่นไว้ (เช่น "ชิ้น") จะแสดงเป็นตัวเลือกเพิ่มให้ เพื่อไม่ให้ค่าเดิมหายตอนเปิดแก้ไข
      const UNIT_CHOICES = ["PCS", "SET"];
      function unitOptionsHtml(current) {
        const cur = String(current || "").trim();
        const curUp = cur.toUpperCase();
        const legacy = cur && !UNIT_CHOICES.includes(curUp) ? cur : "";
        const selected = legacy ? legacy : UNIT_CHOICES.includes(curUp) ? curUp : "PCS";
        const list = legacy ? [legacy, ...UNIT_CHOICES] : UNIT_CHOICES;
        return list
          .map((u) => `<option value="${esc(u)}"${u === selected ? " selected" : ""}>${esc(u)}</option>`)
          .join("");
      }

      function purposeLabel(p) {
        return { CLAIM: "เคลมสินค้า", REPAIR: "ซ่อมเคลมสินค้า" }[p] || p || "-";
      }

      // กัน HTML หลุดจากข้อมูลที่ผู้ใช้กรอกเอง (ชื่อร้านมี < > & ได้จริง)
      function esc(s) {
        if (s === null || s === undefined || s === "") return "";
        return String(s)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");
      }
      function escOrDash(s) {
        const v = esc(s);
        return v === "" ? "-" : v;
      }

      // ================= ป้ายสถานะ =================
      // ⚠️ ป้าย "ถูกตีกลับ" ผูกกับ LastRejectReason ตัวเดียวเท่านั้น
      //    ห้ามใช้ RejectCount > 0 เพราะเป็นตัวนับสะสมที่ไม่เคยถูกล้าง
      //    ใบที่เคยถูกตีกลับแล้วแก้จนอนุมัติไปแล้วก็ยังมีค่า > 0 อยู่
      //    เงื่อนไขนี้ต้องตรงกับ SQL - Get Claim Dashboard Count ฝั่ง n8n
      // 🔄 ปุ่ม "ตีกลับให้แก้ไข" ถูกแทนที่ด้วย "ขอเอกสารเพิ่มเติม" → สถานะ AWAITING_DOCS
      function isAwaitingDocs(doc) {
        return doc.Status === "AWAITING_DOCS";
      }
      const isRejectedBack = isAwaitingDocs; // ชื่อเดิม (ยังมีจุดอื่นเรียกอยู่)

      function getDisplayStatusLabel(doc) {
        if (doc.IsDeleted) return "ยกเลิก";
        if (isAwaitingDocs(doc)) return "รอเอกสารเพิ่มเติม";
        return doc.StatusLabel || "รอดำเนินการ";
      }

      // ชื่อตำแหน่งของผู้พิจารณาของเอกสารใบนั้น (การตลาด / ผู้บริหาร)
      function approverTitleOf(doc) {
        return approverRoleLabel(doc.ApproverRoleId || DEFAULT_APPROVER_ROLE);
      }

      function getStatusBadge(doc) {
        const label = getDisplayStatusLabel(doc);
        const colorMap = {
          รอเจ้าหน้าที่การตลาด:
            "bg-amber-50 text-amber-700 border border-amber-100",
          รอผู้บริหารอนุมัติ:
            "bg-purple-50 text-purple-700 border border-purple-100",
          รอผู้อนุมัติ: "bg-amber-50 text-amber-700 border border-amber-100",
          รอเอกสารเพิ่มเติม: "bg-red-50 text-red-700 border border-red-100",
          ยกเลิก: "bg-red-50 text-red-600 border border-red-100",
          "อนุมัติแล้ว (รอปิดงาน)":
            "bg-blue-50 text-blue-700 border border-blue-100",
          "ไม่อนุมัติ (รอปิดงาน)":
            "bg-slate-100 text-slate-600 border border-slate-200",
          "เสร็จสิ้น (อนุมัติ)":
            "bg-emerald-50 text-emerald-700 border border-emerald-100",
          "เสร็จสิ้น (ไม่อนุมัติ)":
            "bg-slate-100 text-slate-600 border border-slate-200",
        };
        return `<span class="inline-flex items-center whitespace-nowrap rounded-lg px-2.5 py-1 font-bold ${
          colorMap[label] || "bg-slate-50 text-slate-600 border border-slate-100"
        }">${esc(label)}</span>`;
      }

      // ================= สิทธิ์รายเอกสาร =================
      // ⚠️ ทั้งหมดนี้เป็นการกรองฝั่ง Frontend เพื่อ UX เท่านั้น
      //    ฝั่ง n8n ตรวจซ้ำทุกครั้งใน SQL - Check ... Permission อยู่แล้ว ไม่ได้เชื่อ client
      function canEditDocument(doc) {
        if (doc.IsDeleted) return false;
        if (!["PENDING_MKT", "AWAITING_DOCS"].includes(doc.Status)) return false;
        const own = isSameEmp(doc.CreatedByEmpId, empId);
        return pAnyOwn("UPDATE_ANY", "UPDATE_OWN", own, isAdminUser || own);
      }

      // ยกเลิกเอกสารได้เฉพาะ รอเจ้าหน้าที่การตลาด / รอผู้บริหารอนุมัติ (PENDING_MKT)
      // และ รอเอกสารเพิ่มเติม (AWAITING_DOCS) — ผู้สร้างหรือ Admin
      // ต้องตรงกับ SQL - Check Delete Claim Permission ฝั่ง n8n
      function canDeleteDocument(doc) {
        if (doc.IsDeleted) return false;
        if (!["PENDING_MKT", "AWAITING_DOCS"].includes(doc.Status)) return false;
        const own = isSameEmp(doc.CreatedByEmpId, empId);
        return pAnyOwn("DELETE_ANY", "DELETE_OWN", own, isAdminUser || own);
      }

      // ถอยสถานะ: เฉพาะเอกสารอนุมัติแล้ว (รอปิดงาน) · ผู้สร้างหรือ Admin
      function canRevertDocument(doc) {
        if (doc.IsDeleted) return false;
        // ถอยได้เฉพาะ "อนุมัติแล้ว (รอปิดงาน)" — ผู้สร้างหรือ Admin
        if (doc.Status !== "APPROVED") return false;
        const own = isSameEmp(doc.CreatedByEmpId, empId);
        return pAnyOwn("RETURN_ANY", "RETURN_OWN", own, isAdminUser || own);
      }

      // ปิดงานได้: ผู้สร้างใบนั้น · SRV ทุกคน (role 3) · Admin
      // SRV ปิดใบของคนอื่นได้เพราะช่างที่รับเรื่องกับช่างที่ส่งของคืนลูกค้า
      // อาจเป็นคนละคนหรืออยู่คนละกะ — ต้องตรงกับ SQL - Check Close Claim Permission
      function canCloseDocument(doc) {
        if (doc.IsDeleted) return false;
        if (!["APPROVED", "NOT_APPROVED"].includes(doc.Status)) return false;
        const own = isSameEmp(doc.CreatedByEmpId, empId);
        return pAnyOwn("CLOSE_ANY", "CLOSE_OWN", own, isAdminUser || isSrvUser || own);
      }

      function __permApply(changed) {
        const nb = document.getElementById("btnNewDoc");
        if (nb) nb.style.display = pcan("CREATE", true) ? "" : "none";
        canSeeAllDocuments = pcan("READ_ALL", CLAIM_SEE_ALL_ROLES.includes(claimRole));
        if (changed && typeof fetchAllDocuments === "function") fetchAllDocuments();
        else renderDocTable();
      }

      // ================= ตารางประวัติเอกสาร =================
      async function fetchAllDocuments() {
        const icon = document.getElementById("syncHistoryIcon");
        icon.classList.add("animate-spin");
        try {
          const res = await n8nFetch(
            N8N_BASE + "get_all_document_status_claim_cus",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ empId: empId }),
            },
          );
          if (!res.ok) throw new Error("โหลดข้อมูลไม่สำเร็จ");

          // ⚠️ อ่านเป็น text ก่อนเสมอ แล้วค่อย parse เอง
          //    ถ้า SQL คืน 0 แถว n8n อาจตอบ body ว่างเปล่า แล้ว res.json() จะ throw
          //    ทำให้หน้าขึ้น "โหลดข้อมูลไม่สำเร็จ" ทั้งที่ความจริงคือ "ยังไม่มีเอกสาร"
          const rawText = await res.text();
          const data = rawText && rawText.trim() ? JSON.parse(rawText) : [];
          allDocuments = (Array.isArray(data) ? data : []).filter(
            (d) => d && d.DocId,
          );

          if (!canSeeAllDocuments) {
            allDocuments = allDocuments.filter((doc) => isNamedOnDoc(doc));
          }
          renderDocTable();
        } catch (err) {
          console.error(err);
          document.getElementById("docTableBody").innerHTML =
            '<tr><td colspan="9" class="px-4 py-8 text-center text-sm text-red-500">โหลดข้อมูลไม่สำเร็จ ลองซิงค์อีกครั้ง</td></tr>';
        } finally {
          icon.classList.remove("animate-spin");
        }
      }

      // ================= SORT & FILTER =================
      let docSortState = { column: null, direction: "asc" };

      const FILTER_COLUMNS = [
        "DocId",
        "DocDate",
        "Purpose",
        "CustomerName",
        "RepairOrderNo",
        "CreatedByEmpId",
        "CreatedByName",
        "StatusLabel",
      ];

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

      function getFilterValue(col) {
        return document.getElementById(`filter-${col}`)?.value || "";
      }

      function updateDocFilterIndicators() {
        let anyActive = false;
        document.querySelectorAll(".filter-toggle-btn").forEach((btn) => {
          const col = btn.getAttribute("data-filter-col");
          if (getFilterValue(col)) {
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
        const fill = (selectId, values) => {
          const select = document.getElementById(selectId);
          if (!select) return;
          const current = select.value;
          const uniq = [...new Set(values.filter(Boolean))].sort();
          select.innerHTML =
            '<option value="">ทั้งหมด</option>' +
            uniq
              .map((v) => `<option value="${esc(v)}">${esc(v)}</option>`)
              .join("");
          if (uniq.includes(current)) select.value = current;
        };
        fill(
          "filter-CreatedByEmpId",
          docs.map((d) => d.CreatedByEmpId),
        );
        fill(
          "filter-CreatedByName",
          docs.map((d) => d.CreatedByName),
        );
      }

      function onDocFilterChange() {
        renderDocTable();
      }

      function resetDocFilters() {
        FILTER_COLUMNS.forEach((col) => {
          const el = document.getElementById(`filter-${col}`);
          if (el) el.value = "";
        });
        closeAllDocFilterDropdowns();
        renderDocTable();
      }

      function applyDocFilters(docs) {
        const docIdVal = getFilterValue("DocId").trim().toLowerCase();
        const dateVal = getFilterValue("DocDate");
        const purposeVal = getFilterValue("Purpose");
        const customerVal = getFilterValue("CustomerName").trim().toLowerCase();
        const roVal = getFilterValue("RepairOrderNo").trim().toLowerCase();
        const empIdVal = getFilterValue("CreatedByEmpId");
        const creatorVal = getFilterValue("CreatedByName");
        const statusVal = getFilterValue("StatusLabel");

        return docs.filter((doc) => {
          if (
            docIdVal &&
            !String(doc.DocId || "")
              .toLowerCase()
              .includes(docIdVal)
          )
            return false;
          if (dateVal && String(doc.DocDate || "").slice(0, 10) !== dateVal)
            return false;
          if (purposeVal && doc.Purpose !== purposeVal) return false;
          if (
            customerVal &&
            !String(doc.CustomerName || "")
              .toLowerCase()
              .includes(customerVal)
          )
            return false;
          if (
            roVal &&
            !String(doc.RepairOrderNo || "")
              .toLowerCase()
              .includes(roVal)
          )
            return false;
          if (empIdVal && doc.CreatedByEmpId !== empIdVal) return false;
          if (creatorVal && doc.CreatedByName !== creatorVal) return false;
          if (statusVal && getDisplayStatusLabel(doc) !== statusVal)
            return false;
          return true;
        });
      }

      function sortDocData(docs) {
        const { column, direction } = docSortState;
        if (!column) return docs;

        const statusRank = {
          รอเอกสารเพิ่มเติม: 1,
          ยกเลิก: 7,
          รอเจ้าหน้าที่การตลาด: 2,
          รอผู้บริหารอนุมัติ: 2,
          "อนุมัติแล้ว (รอปิดงาน)": 3,
          "ไม่อนุมัติ (รอปิดงาน)": 4,
          "เสร็จสิ้น (อนุมัติ)": 5,
          "เสร็จสิ้น (ไม่อนุมัติ)": 6,
        };

        return [...docs].sort((a, b) => {
          let valA, valB;
          if (column === "StatusLabel") {
            valA = statusRank[getDisplayStatusLabel(a)] || 0;
            valB = statusRank[getDisplayStatusLabel(b)] || 0;
          } else if (column === "DocId") {
            // เลขที่เอกสารเก็บเป็น nvarchar — ต้องแปลงเป็นตัวเลขก่อนเทียบ
            // ไม่งั้นจะเรียงแบบข้อความ (1, 10, 11, ... 2, 3) เหมือนบั๊กที่เคยเจอใน SWAP
            valA = Number(a.DocId) || 0;
            valB = Number(b.DocId) || 0;
          } else if (column === "DocDate") {
            valA = String(a.DocDate ?? "").slice(0, 10);
            valB = String(b.DocDate ?? "").slice(0, 10);
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

      function renderDocTable() {
        const tbody = document.getElementById("docTableBody");

        populateDocFilterOptions(allDocuments);

        if (allDocuments.length === 0) {
          tbody.innerHTML =
            '<tr><td colspan="9" class="px-4 py-8 text-center text-sm text-slate-400">ยังไม่มีเอกสาร</td></tr>';
          updateDocFilterIndicators();
          return;
        }

        let docs = applyDocFilters(allDocuments);
        docs = sortDocData(docs);

        if (docs.length === 0) {
          tbody.innerHTML =
            '<tr><td colspan="9" class="px-4 py-8 text-center text-sm text-slate-400">ไม่พบเอกสารที่ตรงกับเงื่อนไขการค้นหา/กรอง</td></tr>';
          updateDocSortIcons();
          updateDocFilterIndicators();
          return;
        }

        tbody.innerHTML = docs
          .map((doc) => {
            const showEdit = canEditDocument(doc);
            const showDelete = canDeleteDocument(doc);
            const showRevert = canRevertDocument(doc);
            const showClose = canCloseDocument(doc);
            const attachIcon = doc.HasAttachment
              ? '<i data-lucide="paperclip" class="w-3 h-3 inline text-slate-400 ml-1"></i>'
              : "";
            return `
                <tr class="hover:bg-slate-50/50 transition-colors ">
                    <td class="p-4 font-mono font-semibold text-slate-900">${esc(doc.DocId)}${attachIcon}</td>
                    <td class="p-4 text-slate-600 font-light whitespace-nowrap">${formatThaiDate(doc.DocDate)}</td>
                    <td class="p-4"><span class="text-slate-900 whitespace-nowrap">${purposeLabel(doc.Purpose)}</span></td>
                    <td class="p-4 text-slate-700">${escOrDash(doc.CustomerName)}<div class="text-[11px] text-slate-400">${doc.ItemCount || 0} รายการ</div></td>
                    <td class="p-4 text-slate-700 font-mono whitespace-nowrap">${escOrDash(doc.RepairOrderNo)}</td>
                    <td class="p-4 text-slate-500 font-mono">${escOrDash(doc.CreatedByEmpId)}</td>
                    <td class="p-4 text-slate-700">${escOrDash(doc.CreatedByName)}</td>
                    <td class="p-4">${getStatusBadge(doc)}</td>
                    <td class="p-4 text-right">
                        <div class="flex items-center justify-end gap-1">
                            <button onclick="previewDocument('${doc.DocId}')" title="ดูตัวอย่างเอกสาร" class="p-1.5 rounded-lg text-slate-400 hover:bg-indigo-50 hover:text-indigo-600">
                                <i data-lucide="file-text" class="w-4 h-4"></i>
                            </button>
                            ${
                              isAdminUser
                                ? `
                            <button onclick="viewDocument('${doc.DocId}')" title="ดูรายละเอียด" class="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700">
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
                            ${
                              showClose
                                ? `
                            <button onclick="openCloseDocModal('${doc.DocId}')" title="ปิดงาน" class="p-1.5 rounded-lg text-slate-400 hover:bg-emerald-50 hover:text-emerald-600">
                                <i data-lucide="package-check" class="w-4 h-4"></i>
                            </button>`
                                : ""
                            }
                            <button onclick="showDocFlow('${doc.DocId}')" title="ดูความเคลื่อนไหว" class="p-1.5 rounded-lg text-slate-400 hover:bg-purple-50 hover:text-purple-600">
                                <i data-lucide="git-branch" class="w-4 h-4"></i>
                            </button>
                            ${
                              showRevert
                                ? `
                            <button onclick="openRevertDocModal('${doc.DocId}')" title="ถอยสถานะ" class="p-1.5 rounded-lg text-slate-400 hover:bg-amber-50 hover:text-amber-600">
                                <i data-lucide="undo-2" class="w-4 h-4"></i>
                            </button>`
                                : ""
                            }
                            ${
                              showDelete
                                ? `
                            <button onclick="openDeleteDocModal('${doc.DocId}')" title="ยกเลิกเอกสาร" class="p-1.5 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600">
                                <i data-lucide="file-x" class="w-4 h-4"></i>
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

      // ================= ไฟล์แนบ (ใช้ร่วมกันระหว่างฟอร์มสร้าง/แก้ไข และฟอร์มปิดงาน) =================
      const ATTACHMENT_MAX_SIZE = 5 * 1024 * 1024; // 5 MB ต่อไฟล์
      const ATTACHMENT_MAX_FILES = 5;
      const ATTACHMENT_ALLOWED_TYPES = [
        "application/pdf",
        "image/jpeg",
        "image/jpg",
        "image/png",
      ];

      // ไฟล์ที่เพิ่งเลือกรอบนี้ (base64) — ยังไม่เคยขึ้น DB
      let newAttachments = [];
      // ไฟล์เดิมที่อยู่ใน DB แล้ว (เฉพาะโหมดแก้ไข) — เก็บ AttachmentId ไว้ส่งกลับเป็น keptAttachmentIds
      let existingAttachments = [];

      function readFileAsBase64(file) {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            // reader.result รูปแบบ "data:application/pdf;base64,XXXX" — ตัดหัวออก เก็บแค่ Base64 ล้วน
            resolve(reader.result.split(",")[1] || "");
          };
          reader.onerror = () => reject(new Error("อ่านไฟล์ไม่สำเร็จ"));
          reader.readAsDataURL(file);
        });
      }

      async function handleAttachmentFileSelect(inputEl) {
        const errorEl = document.getElementById("attachmentFileError");
        errorEl.classList.add("hidden");
        errorEl.textContent = "";

        const files = Array.from(inputEl.files || []);
        inputEl.value = ""; // เคลียร์ทันที ผู้ใช้จะได้เลือกไฟล์เดิมซ้ำได้ถ้าเผลอลบไป

        for (const file of files) {
          const total =
            existingAttachments.length + newAttachments.length;
          if (total >= ATTACHMENT_MAX_FILES) {
            errorEl.textContent = `แนบไฟล์ได้ไม่เกิน ${ATTACHMENT_MAX_FILES} ไฟล์`;
            errorEl.classList.remove("hidden");
            break;
          }
          if (!ATTACHMENT_ALLOWED_TYPES.includes(file.type)) {
            errorEl.textContent = `"${file.name}" ไม่รองรับ — ใช้ได้เฉพาะ PDF / JPG / PNG`;
            errorEl.classList.remove("hidden");
            continue;
          }
          if (file.size > ATTACHMENT_MAX_SIZE) {
            errorEl.textContent = `"${file.name}" ใหญ่เกิน 5 MB`;
            errorEl.classList.remove("hidden");
            continue;
          }
          try {
            const base64 = await readFileAsBase64(file);
            newAttachments.push({
              fileName: file.name,
              fileType: file.type,
              base64: base64,
              size: file.size,
            });
          } catch (e) {
            errorEl.textContent = `อ่านไฟล์ "${file.name}" ไม่สำเร็จ`;
            errorEl.classList.remove("hidden");
          }
        }
        renderAttachmentList();
      }

      function removeNewAttachment(index) {
        newAttachments.splice(index, 1);
        renderAttachmentList();
      }

      function removeExistingAttachment(index) {
        existingAttachments.splice(index, 1);
        renderAttachmentList();
      }

      function renderAttachmentList() {
        const wrap = document.getElementById("attachmentList");
        const label = document.getElementById("attachmentCountLabel");
        const total = existingAttachments.length + newAttachments.length;
        label.textContent = `${total} / ${ATTACHMENT_MAX_FILES} ไฟล์`;

        const rowHtml = (name, meta, onRemove, isNew) => `
          <div class="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
            <i data-lucide="${/\.pdf$/i.test(name) ? "file-text" : "image"}" class="w-3.5 h-3.5 text-slate-400 shrink-0"></i>
            <span class="text-[11px] font-medium text-slate-700 truncate flex-1">${esc(name)}</span>
            <span class="text-[10px] text-slate-400 shrink-0">${meta}</span>
            ${isNew ? '<span class="text-[10px] text-brand-600 font-semibold shrink-0">ใหม่</span>' : ""}
            <button type="button" onclick="${onRemove}" class="shrink-0 p-1 rounded text-slate-300 hover:text-red-500 hover:bg-red-50">
              <i data-lucide="x" class="w-3.5 h-3.5"></i>
            </button>
          </div>`;

        wrap.innerHTML =
          existingAttachments
            .map((a, i) =>
              rowHtml(
                a.FileName,
                "ไฟล์เดิม",
                `removeExistingAttachment(${i})`,
                false,
              ),
            )
            .join("") +
          newAttachments
            .map((a, i) =>
              rowHtml(
                a.fileName,
                `${(a.size / 1024).toFixed(0)} KB`,
                `removeNewAttachment(${i})`,
                true,
              ),
            )
            .join("");
        lucide.createIcons();
      }

      // ===== ไฟล์แนบของฟอร์มปิดงาน (ชุดแยกต่างหาก ไม่ปนกับฟอร์มสร้าง/แก้ไข) =====
      let closeAttachments = [];

      async function handleCloseAttachmentFileSelect(inputEl) {
        const errorEl = document.getElementById("closeAttachmentFileError");
        errorEl.classList.add("hidden");
        errorEl.textContent = "";

        const files = Array.from(inputEl.files || []);
        inputEl.value = "";

        for (const file of files) {
          if (closeAttachments.length >= ATTACHMENT_MAX_FILES) {
            errorEl.textContent = `แนบไฟล์ได้ไม่เกิน ${ATTACHMENT_MAX_FILES} ไฟล์`;
            errorEl.classList.remove("hidden");
            break;
          }
          if (!ATTACHMENT_ALLOWED_TYPES.includes(file.type)) {
            errorEl.textContent = `"${file.name}" ไม่รองรับ — ใช้ได้เฉพาะ PDF / JPG / PNG`;
            errorEl.classList.remove("hidden");
            continue;
          }
          if (file.size > ATTACHMENT_MAX_SIZE) {
            errorEl.textContent = `"${file.name}" ใหญ่เกิน 5 MB`;
            errorEl.classList.remove("hidden");
            continue;
          }
          try {
            const base64 = await readFileAsBase64(file);
            closeAttachments.push({
              fileName: file.name,
              fileType: file.type,
              base64: base64,
              size: file.size,
            });
          } catch (e) {
            errorEl.textContent = `อ่านไฟล์ "${file.name}" ไม่สำเร็จ`;
            errorEl.classList.remove("hidden");
          }
        }
        renderCloseAttachmentList();
      }

      function removeCloseAttachment(index) {
        closeAttachments.splice(index, 1);
        renderCloseAttachmentList();
      }

      function renderCloseAttachmentList() {
        const wrap = document.getElementById("closeAttachmentList");
        document.getElementById("closeAttachmentCountLabel").textContent =
          `${closeAttachments.length} / ${ATTACHMENT_MAX_FILES} ไฟล์`;
        wrap.innerHTML = closeAttachments
          .map(
            (a, i) => `
          <div class="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
            <i data-lucide="${/\.pdf$/i.test(a.fileName) ? "file-text" : "image"}" class="w-3.5 h-3.5 text-slate-400 shrink-0"></i>
            <span class="text-[11px] font-medium text-slate-700 truncate flex-1">${esc(a.fileName)}</span>
            <span class="text-[10px] text-slate-400 shrink-0">${(a.size / 1024).toFixed(0)} KB</span>
            <button type="button" onclick="removeCloseAttachment(${i})" class="shrink-0 p-1 rounded text-slate-300 hover:text-red-500 hover:bg-red-50">
              <i data-lucide="x" class="w-3.5 h-3.5"></i>
            </button>
          </div>`,
          )
          .join("");
        lucide.createIcons();
      }

      // เปิดไฟล์แนบในแท็บใหม่ — ใช้ Blob แทน data URL ตรงๆ
      // เพราะ Chrome บล็อกการเปิด data URL ขนาดใหญ่ในแท็บใหม่
      function openBase64InNewTab(base64, fileType) {
        if (!base64) return;
        try {
          const bin = atob(base64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          const url = URL.createObjectURL(
            new Blob([bytes], {
              type: fileType || "application/octet-stream",
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

      // ================= Modal สร้าง/แก้ไขเอกสาร =================
      function openNewDocModal() {
        document.getElementById("editingDocId").value = "";
        document.getElementById("docModalTitle").textContent =
          "สร้างเอกสารเคลมสินค้าลูกค้า";
        document.getElementById("docId").value = "";
        document.getElementById("docId").placeholder =
          "ระบบจะสร้างให้อัตโนมัติหลังบันทึก";
        document.getElementById("docDate").value = todayLocalIso();
        document.querySelector(
          'input[name="purpose"][value="REPAIR"]',
        ).checked = true;
        document.getElementById("customerName").value = "";
        document.getElementById("customerPhone").value = "";
        document.getElementById("repairOrderNo").value = "";
        document.getElementById("serviceMaterial").value = "";
        document.getElementById("serialNumber").value = "";
        document.getElementById("serviceTechnician").value = "";
        document.getElementById("requesterName").value = empName;
        document.getElementById("requesterEmail").value = empEmail;
        document.getElementById("mktNotifyEmail").value = "";
        document.getElementById("mktNotifyEmpId").value = "";
        mktEmailOverride = null;

        document.getElementById("rejectReasonBanner").classList.add("hidden");

        newAttachments = [];
        existingAttachments = [];
        document.getElementById("attachmentFile").value = "";
        document.getElementById("attachmentFileError").classList.add("hidden");
        renderAttachmentList();

        document.getElementById("itemRowsBody").innerHTML = "";
        itemRowCounter = 0;
        addItemRow();
        refreshApproverSection("");

        document.getElementById("docModal").classList.remove("hidden");
        lucide.createIcons();
      }

      // วันที่วันนี้ในเขตเวลาเครื่องผู้ใช้ — ห้ามใช้ toISOString()
      // เพราะมันแปลงเป็น UTC ก่อน ทำให้ช่วงเช้ามืด (00:00–07:00 เวลาไทย) ได้วันที่ของเมื่อวาน
      function todayLocalIso() {
        const d = new Date();
        const pad = (n) => String(n).padStart(2, "0");
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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
                    <input type="text" class="item-prod-code w-full h-9 px-2 rounded-md border border-slate-200 text-xs focus:ring-1 focus:ring-brand-500 outline-none text-center" placeholder="ระบุรหัสสินค้า" value="${esc(data?.ProdCode || "")}" oninput="handleCodeAutocomplete(this)" autocomplete="off">
                </td>
                <td class="px-2 py-1.5"><input type="text" class="item-description w-full h-9 px-2 rounded-md border border-slate-200 text-xs focus:ring-1 focus:ring-brand-500 outline-none text-center" placeholder="เลือกรหัสสินค้าแล้วระบบจะเติมให้อัตโนมัติ" value="${esc(data?.Description || "")}"></td>
                <td class="px-2 py-1.5"><input type="number" min="1" step="1" class="item-qty w-full h-9 px-2 rounded-md border border-slate-200 text-xs focus:ring-1 focus:ring-brand-500 outline-none text-center" value="${data?.Qty ?? 1}"></td>
                <td class="px-2 py-1.5"><select class="item-unit w-full h-9 px-2 rounded-md border border-slate-200 text-xs focus:ring-1 focus:ring-brand-500 outline-none text-center bg-white">${unitOptionsHtml(data?.Unit)}</select></td>
                <td class="px-2 py-1.5"><input type="date" class="item-purchase-date w-full h-9 px-2 rounded-md border border-slate-200 text-xs focus:ring-1 focus:ring-brand-500 outline-none" value="${String(data?.PurchaseDate || "").slice(0, 10)}"></td>
                <td class="px-2 py-1.5"><input type="text" class="item-bill-no w-full h-9 px-2 rounded-md border border-slate-200 text-xs focus:ring-1 focus:ring-brand-500 outline-none text-center" placeholder="เลขที่บิล" value="${esc(data?.BillNo || "")}"></td>
                <td class="px-2 py-1.5"><input type="text" class="item-remark w-full h-9 px-2 rounded-md border border-slate-200 text-xs focus:ring-1 focus:ring-brand-500 outline-none text-center" placeholder="อาการเสีย / หมายเหตุ" value="${esc(data?.Remark || "")}"></td>
                <td class="px-2 py-1.5 text-center">
                    <button type="button" onclick="removeItemRow('${rowId}')" class="p-1 rounded text-slate-300 hover:text-red-500 hover:bg-red-50">
                        <i data-lucide="x" class="w-3.5 h-3.5"></i>
                    </button>
                </td>
            `;
        tbody.appendChild(tr);
        setRowBrand(tr, data?.Brand || data?.brand || "");
        lucide.createIcons();
      }

      // เก็บยี่ห้อ (เช่น "MAKITA/มากีต้า") ไว้ที่แถว — ใช้ตัดสินผู้พิจารณาของเอกสาร
      function setRowBrand(tr, brand) {
        tr.dataset.brand = brand || "";
        // แสดงยี่ห้อเป็น tooltip บนช่องรหัสสินค้า — ไม่เพิ่ม element ในเซลล์ เพื่อไม่ให้ความกว้างคอลัมน์เพี้ยนจากเดิม
        const codeInput = tr.querySelector(".item-prod-code");
        if (codeInput) codeInput.title = brand ? `ยี่ห้อ: ${brand}` : "";
      }

      function removeItemRow(rowId) {
        const row = document.getElementById(rowId);
        if (row) row.remove();
        refreshApproverSection();
        document.querySelectorAll("#itemRowsBody tr").forEach((tr, idx) => {
          const cell = tr.querySelector(".row-index");
          if (cell) cell.textContent = idx + 1;
        });
      }

      // includeEmptyRows = true  -> คืนทุกแถวตามที่เห็นในตาราง (ใช้ตอน validate)
      // includeEmptyRows = false -> ตัดแถวที่ไม่ได้กรอกรหัสสินค้าทิ้ง (ใช้ตอนส่งไปบันทึก)
      // ⚠️ ฟอร์มมีแถวว่างค้างไว้ 1 แถวเสมอ ถ้าไม่กรองจะได้แถวขยะลง DB ทุกใบ
      function collectItemsData(includeEmptyRows = false) {
        const rows = document.querySelectorAll("#itemRowsBody tr");
        const all = Array.from(rows).map((tr) => ({
          prodCode: tr.querySelector(".item-prod-code").value.trim(),
          description: tr.querySelector(".item-description").value.trim(),
          qty: parseInt(tr.querySelector(".item-qty").value, 10) || 0,
          unit: tr.querySelector(".item-unit").value.trim(),
          purchaseDate: tr.querySelector(".item-purchase-date").value,
          billNo: tr.querySelector(".item-bill-no").value.trim(),
          remark: tr.querySelector(".item-remark").value.trim(),
          brand: tr.dataset.brand || "",
        }));
        return includeEmptyRows ? all : all.filter((r) => r.prodCode !== "");
      }

      // ค้นยี่ห้อของแถวที่ยังไม่มียี่ห้อ จาก API autocomplete (ใช้รหัสสินค้าตรงตัวเท่านั้น)
      async function resolveMissingBrands() {
        const rows = Array.from(document.querySelectorAll("#itemRowsBody tr")).filter(
          (tr) => tr.querySelector(".item-prod-code").value.trim() && !tr.dataset.brand,
        );
        await Promise.all(
          rows.map(async (tr) => {
            const code = tr.querySelector(".item-prod-code").value.trim();
            try {
              const res = await n8nFetch(
                `${N8N_BASE}autocomplete?code=${encodeURIComponent(code)}`,
                { headers: { "content-type": "application/json; charset=utf-8" } },
              );
              if (!res.ok) return;
              const list = await res.json();
              const hit = (Array.isArray(list) ? list : []).find(
                (x) => String(x.code || x.Code || "").trim().toUpperCase() === code.toUpperCase(),
              );
              const brand = hit ? hit.manufacturers || hit.Manufacturers || "" : "";
              if (brand) setRowBrand(tr, brand);
            } catch (e) {
              console.error("resolveMissingBrands", e);
            }
          }),
        );
      }

      async function submitDocForm() {
        const editingDocId = document.getElementById("editingDocId").value;
        const isEdit = !!editingDocId;

        // แถวที่ไม่ได้เลือกจากรายการ (พิมพ์รหัสเอง / เอกสารเก่าที่ไม่มียี่ห้อ) → ให้ระบบค้นยี่ห้อให้ก่อน
        // กันเอกสาร Makita/Jasic หลุดไปหาการตลาดเพียงเพราะผู้ใช้พิมพ์รหัสเอง
        await resolveMissingBrands();
        refreshApproverSection();

        const items = collectItemsData();
        if (items.length === 0) {
          showNotification(
            "ข้อมูลไม่ครบ",
            "ต้องมีรายการสินค้าอย่างน้อย 1 รายการ (ที่กรอกรหัสสินค้า)",
            "error",
          );
          return;
        }
        const badQty = items.findIndex((i) => !Number.isInteger(i.qty) || i.qty < 1);
        if (badQty >= 0) {
          showNotification(
            "ข้อมูลไม่ถูกต้อง",
            `แถวที่ ${badQty + 1}: จำนวนต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป`,
            "error",
          );
          return;
        }

        const customerName = document.getElementById("customerName").value.trim();
        if (!customerName) {
          showNotification(
            "ข้อมูลไม่ครบ",
            "กรุณาระบุชื่อร้าน / ชื่อลูกค้า",
            "error",
          );
          return;
        }

        if (computeApproverPlan().mixed) {
          showNotification("ข้อมูลไม่ถูกต้อง", approverConflictText(), "error");
          return;
        }

        const mktNotifyEmpId = document
          .getElementById("mktNotifyEmpId")
          .value.trim();
        const mktNotifyEmail = document
          .getElementById("mktNotifyEmail")
          .value.trim();
        if (!mktNotifyEmpId || !mktNotifyEmail) {
          showNotification(
            "ข้อมูลไม่ครบ",
            `กรุณาเลือก${approverRoleLabel(computeApproverPlan().roleId)}ผู้พิจารณา`,
            "error",
          );
          return;
        }

        const payload = {
          docDate: document.getElementById("docDate").value,
          purpose: document.querySelector('input[name="purpose"]:checked').value,
          customerName: customerName,
          customerPhone: document.getElementById("customerPhone").value.trim(),
          repairOrderNo: document.getElementById("repairOrderNo").value.trim(),
          serviceMaterial: document.getElementById("serviceMaterial").value.trim(),
          serialNumber: document.getElementById("serialNumber").value.trim(),
          serviceTechnician: document.getElementById("serviceTechnician").value.trim(),
          mktNotifyName: document.getElementById("mktNotifyName").value.trim(),
          mktNotifyEmpId: mktNotifyEmpId,
          mktNotifyEmail: mktNotifyEmail,
          items: items,
        };

        if (isEdit) {
          payload.docId = editingDocId;
          payload.actorEmpId = empId;
          payload.actorName =
            document.getElementById("requesterName").value.trim() || empName;
          // ไฟล์เดิมส่งกลับแค่ "id ที่ยังเก็บไว้" ไม่ส่ง base64 ขึ้นไปใหม่
          // 5 ไฟล์ × 5 MB = 25 MB ต่อการกดบันทึกหนึ่งครั้ง หน้างานที่ใช้ 4G รอไม่ไหว
          payload.keptAttachmentIds = existingAttachments.map(
            (a) => a.AttachmentId,
          );
          payload.newAttachments = newAttachments.map((a) => ({
            fileName: a.fileName,
            fileType: a.fileType,
            base64: a.base64,
          }));
        } else {
          payload.createdByName =
            document.getElementById("requesterName").value.trim() || empName;
          payload.createdByEmpId = empId;
          payload.createdByEmail =
            document.getElementById("requesterEmail").value.trim() || empEmail;
          payload.attachments = newAttachments.map((a) => ({
            fileName: a.fileName,
            fileType: a.fileType,
            base64: a.base64,
          }));
        }

        const endpoint = isEdit
          ? "edit_document_claim_cus"
          : "create_document_claim_cus";
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
              ? `แก้ไขเอกสาร ${finalDocId} สำเร็จแล้ว — ระบบส่งอีเมลแจ้งผู้พิจารณาให้พิจารณาอีกครั้งแล้ว`
              : `สร้างเอกสารเคลมสำเร็จแล้ว เลขที่เอกสาร: ${finalDocId}`,
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
            "แก้ไขได้เฉพาะช่วงที่เอกสารยังรอผู้พิจารณา หรือผู้พิจารณาขอเอกสารเพิ่มเติม และต้องเป็นผู้สร้างเอกสารหรือ Admin เท่านั้น",
            "error",
          );
          return;
        }

        try {
          const doc = await fetchDocDetail(docId);

          document.getElementById("editingDocId").value = doc.DocId;
          document.getElementById("docModalTitle").textContent =
            `แก้ไขเอกสารเคลม ${doc.DocId}`;
          document.getElementById("docId").value = doc.DocId;
          document.getElementById("docDate").value = String(
            doc.DocDate || "",
          ).slice(0, 10);
          const purposeInput = document.querySelector(
            `input[name="purpose"][value="${doc.Purpose}"]`,
          );
          if (purposeInput) purposeInput.checked = true;
          document.getElementById("customerName").value =
            doc.CustomerName || "";
          document.getElementById("customerPhone").value =
            doc.CustomerPhone || "";
          document.getElementById("repairOrderNo").value =
            doc.RepairOrderNo || "";
          document.getElementById("serviceMaterial").value =
            doc.ServiceMaterial || "";
          document.getElementById("serialNumber").value = doc.SerialNumber || "";
          setTechnicianValue(doc.ServiceTechnician || "");
          document.getElementById("requesterName").value =
            doc.CreatedByName || empName;
          document.getElementById("requesterEmail").value =
            doc.CreatedByEmail || empEmail;
          document.getElementById("mktNotifyEmail").value =
            doc.MktNotifyEmail || "";
          document.getElementById("mktNotifyEmpId").value =
            doc.MktNotifyEmpId || "";
          // อีเมลที่บันทึกไว้กับเอกสาร (อาจเคยแก้เอง) ต้องคงไว้ ไม่ถูกแทนด้วยอีเมลในทะเบียน
          mktEmailOverride =
            doc.MktNotifyEmpId && doc.MktNotifyEmail
              ? { empId: String(doc.MktNotifyEmpId).trim(), email: String(doc.MktNotifyEmail).trim() }
              : null;

          // แถบเหตุผลที่ถูกตีกลับ — ให้ผู้สร้างเห็นทันทีว่าต้องแก้อะไร ไม่ต้องไปเปิดอีเมลย้อน
          const banner = document.getElementById("rejectReasonBanner");
          if (isAwaitingDocs(doc) || String(doc.LastRejectReason || "").trim()) {
            document.getElementById("rejectReasonText").textContent =
              doc.LastRejectReason;
            document.getElementById("rejectReasonCount").textContent =
              Number(doc.RejectCount) > 1
                ? `(ครั้งที่ ${doc.RejectCount})`
                : "";
            banner.classList.remove("hidden");
          } else {
            banner.classList.add("hidden");
          }

          // ===== คืนสถานะไฟล์แนบเดิม =====
          // ⚠️ ต้องล้าง newAttachments ทุกครั้งที่เปิด modal แก้ไข ไม่ใช่แค่ตอนสร้างเอกสารใหม่
          //    ตัวแปรนี้เป็น state ระดับหน้า ถ้าเคยเลือกไฟล์ไว้ในการแก้ไขรอบก่อน ค่าจะค้างอยู่
          //    แล้วรอบถัดไปที่ผู้ใช้ไม่แตะช่องเลือกไฟล์เลย ระบบจะส่งไฟล์ของรอบก่อนขึ้นไปซ้ำ
          newAttachments = [];
          // เก็บเฉพาะไฟล์ Stage='CREATE' — ไฟล์ตอนปิดงานไม่ได้อยู่ในความรับผิดชอบของฟอร์มนี้
          existingAttachments = (doc.attachmentsCreate || []).map((a) => ({
            AttachmentId: a.AttachmentId,
            FileName: a.FileName,
            FileType: a.FileType,
          }));
          document.getElementById("attachmentFile").value = "";
          document.getElementById("attachmentFileError").classList.add("hidden");
          renderAttachmentList();

          document.getElementById("itemRowsBody").innerHTML = "";
          itemRowCounter = 0;
          (doc.items || []).forEach((item) => addItemRow(item));
          if ((doc.items || []).length === 0) addItemRow();
          // ยี่ห้อของแถวเดิม (ถ้า DB ไม่มี) จะถูกค้นให้ตอนกดบันทึก — ตอนนี้วาด dropdown ตามที่มี
          refreshApproverSection(doc.MktNotifyEmpId || "");

          document.getElementById("docModal").classList.remove("hidden");
          lucide.createIcons();
        } catch (err) {
          showNotification("เกิดข้อผิดพลาด", err.message, "error");
        }
      }

      // ================= โหลดรายละเอียดเอกสาร (ใช้ร่วมกันหลายจุด) =================
      async function fetchDocDetail(docId) {
        const res = await n8nFetch(
          N8N_BASE + "get_document_detail_claim_cus",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ docId }),
          },
        );
        if (!res.ok) throw new Error(`โหลดข้อมูลไม่สำเร็จ (HTTP ${res.status})`);
        let raw;
        try {
          raw = await res.json();
        } catch (parseErr) {
          throw new Error(
            "เซิร์ฟเวอร์ตอบกลับไม่สมบูรณ์ กรุณาลองใหม่อีกครั้ง",
          );
        }
        const doc = Array.isArray(raw) ? raw[0] : raw;
        if (!doc || !doc.DocId) throw new Error("ไม่พบข้อมูลเอกสาร");
        return doc;
      }

      // ================= ยกเลิก / เรียกคืนเอกสาร =================
      function openDeleteDocModal(docId) {
        document.getElementById("deleteDocIdDisplay").textContent = docId;
        document.getElementById("deleteDocTitle").textContent =
          "ยืนยันการยกเลิกเอกสารเคลม";
        document.getElementById("deleteDocMessage").innerHTML = `
          คุณแน่ใจหรือไม่ที่จะยกเลิกเอกสารเลขที่
          <strong id="deleteDocIdDisplay" class="font-mono text-slate-800 bg-slate-100 px-2 py-0.5 rounded">${esc(docId)}</strong>
          ? เอกสารจะถูกซ่อนจากรายการ แต่ข้อมูลยังอยู่ครบ และ Admin กู้คืนได้ที่หน้าประวัติการใช้งาน (History Log)`;
        document.getElementById("cancelReasonWrap").classList.remove("hidden");
        document.getElementById("cancelReasonInput").value = "";
        const icon = document.getElementById("deleteDocIcon");
        icon.className =
          "mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-red-50 text-red-600 border border-red-100";
        icon.innerHTML = '<i data-lucide="file-x" class="w-6 h-6"></i>';

        const confirmBtn = document.getElementById("confirmDeleteDocBtn");
        confirmBtn.textContent = "ยืนยันการยกเลิกเอกสาร";
        confirmBtn.className =
          "h-10 px-5 rounded-xl text-xs font-semibold bg-red-600 hover:bg-red-700 text-white transition-colors";
        confirmBtn.onclick = function () {
          deleteRestoreDocument(docId, "DELETE");
        };
        openModal("deleteDocModal", "deleteDocModalContent");
        lucide.createIcons();
      }

      function closeDeleteDocModal() {
        closeModal("deleteDocModal", "deleteDocModalContent");
      }

      async function deleteRestoreDocument(docId, action) {
        const confirmBtn = document.getElementById("confirmDeleteDocBtn");
        const reason =
          action === "DELETE"
            ? (document.getElementById("cancelReasonInput").value || "").trim()
            : "";
        if (action === "DELETE" && !reason) {
          showNotification("กรุณาระบุเหตุผล", "ต้องระบุเหตุผลในการยกเลิกเอกสาร", "warning");
          document.getElementById("cancelReasonInput").focus();
          return;
        }
        const originalText = confirmBtn.textContent;
        confirmBtn.disabled = true;
        confirmBtn.textContent =
          action === "DELETE" ? "กำลังยกเลิก..." : "กำลังเรียกคืน...";
        try {
          const res = await n8nFetch(N8N_BASE + "delete_restore_claim_cus", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              docId,
              action,
              reason,
              actorEmpId: empId,
              actorName: empName || "ไม่ระบุชื่อ",
            }),
          });
          const result = await res.json().catch(() => ({}));
          if (!res.ok || result.success === false) {
            throw new Error(extractErrorMessage(result));
          }
          showNotification(
            action === "DELETE" ? "ยกเลิกเอกสารสำเร็จ" : "เรียกคืนสำเร็จ",
            action === "DELETE"
              ? `ยกเลิกเอกสารเลขที่ ${docId} เรียบร้อยแล้ว`
              : `เรียกคืนเอกสารเลขที่ ${docId} กลับเข้าระบบเรียบร้อยแล้ว`,
            action === "DELETE" ? "warning" : "success",
          );
          closeDeleteDocModal();
          await fetchAllDocuments();
        } catch (err) {
          showNotification(
            action === "DELETE" ? "ยกเลิกเอกสารไม่สำเร็จ" : "เรียกคืนไม่สำเร็จ",
            err.message,
            "error",
          );
        } finally {
          confirmBtn.disabled = false;
          confirmBtn.textContent = originalText;
        }
      }

      // ================= ถอยสถานะ (ผู้สร้าง / Admin) =================
      function openRevertDocModal(docId) {
        const d = allDocuments.find((x) => x.DocId === docId);
        if (d && !canRevertDocument(d)) {
          showNotification("ถอยสถานะไม่ได้", "เอกสารนี้ถอยสถานะไม่ได้ในสถานะปัจจุบัน", "warning");
          return;
        }
        document.getElementById("revertDocIdDisplay").textContent = docId;
        document.getElementById("revertReasonInput").value = "";
        document.getElementById("revertSendEmail").checked = true;
        document.getElementById("confirmRevertDocBtn").onclick = function () {
          submitRevertDocument(docId);
        };
        openModal("revertDocModal", "revertDocModalContent");
        lucide.createIcons();
      }

      function closeRevertDocModal() {
        closeModal("revertDocModal", "revertDocModalContent");
      }

      async function submitRevertDocument(docId) {
        const reason = (document.getElementById("revertReasonInput").value || "").trim();
        if (!reason) {
          showNotification("กรุณาระบุเหตุผล", "ต้องระบุเหตุผลในการถอยสถานะ", "warning");
          document.getElementById("revertReasonInput").focus();
          return;
        }
        const btn = document.getElementById("confirmRevertDocBtn");
        const originalText = btn.textContent;
        btn.disabled = true;
        btn.textContent = "กำลังถอยสถานะ...";
        try {
          const res = await n8nFetch(N8N_BASE + "admin_revert_stage_claim_cus", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              docId,
              targetStatus: "PENDING_MKT",
              reason,
              sendEmail: !!document.getElementById("revertSendEmail").checked,
              actionByEmpId: empId,
              actionByName: empName || "ไม่ระบุชื่อ",
            }),
          });
          const result = await res.json().catch(() => ({}));
          if (!res.ok || result.success === false) {
            throw new Error(extractErrorMessage(result));
          }
          showNotification("ถอยสถานะสำเร็จ", `เอกสารเลขที่ ${docId} กลับไปที่ "รอผู้อนุมัติพิจารณา" แล้ว`, "success");
          closeRevertDocModal();
          await fetchAllDocuments();
        } catch (err) {
          showNotification("ถอยสถานะไม่สำเร็จ", err.message, "error");
        } finally {
          btn.disabled = false;
          btn.textContent = originalText;
        }
      }

      // ================= ปิดงาน =================
      async function openCloseDocModal(docId) {
        const docForCheck = allDocuments.find((d) => d.DocId === docId);
        if (docForCheck && !canCloseDocument(docForCheck)) {
          showNotification(
            "ไม่มีสิทธิ์ปิดงาน",
            "ปิดงานได้เฉพาะเอกสารที่การตลาดพิจารณาเสร็จแล้ว และต้องเป็นผู้สร้างเอกสารหรือ Admin เท่านั้น",
            "error",
          );
          return;
        }

        closeAttachments = [];
        document.getElementById("closeAttachmentFile").value = "";
        document.getElementById("closeComment").value = "";
        document
          .getElementById("closeAttachmentFileError")
          .classList.add("hidden");
        renderCloseAttachmentList();

        document.getElementById("closingDocId").value = docId;
        document.getElementById("closeDocSummary").innerHTML =
          '<p class="text-slate-400">กำลังโหลดข้อมูลเอกสาร...</p>';
        document.getElementById("closeDocModal").classList.remove("hidden");
        lucide.createIcons();

        try {
          const doc = await fetchDocDetail(docId);
          const resultLabel =
            doc.ClaimResult === "APPROVED"
              ? '<span class="font-bold text-emerald-600">อนุมัติ</span>'
              : '<span class="font-bold text-red-600">ไม่อนุมัติ</span>';
          document.getElementById("closeDocSummary").innerHTML = `
            <div class="flex items-center justify-between gap-3">
              <span class="text-slate-400">เลขที่เอกสาร</span>
              <span class="font-mono font-bold text-slate-800">${esc(doc.DocId)}</span>
            </div>
            <div class="flex items-center justify-between gap-3">
              <span class="text-slate-400">ร้าน / ลูกค้า</span>
              <span class="text-slate-800 truncate">${escOrDash(doc.CustomerName)}</span>
            </div>
            <div class="flex items-center justify-between gap-3">
              <span class="text-slate-400">ผลการพิจารณา</span>
              <span>${resultLabel} โดย ${escOrDash(doc.MktByName)}</span>
            </div>
            ${
              String(doc.MktComment || "").trim()
                ? `<div class="pt-1.5 border-t border-slate-200 mt-1.5">
                     <span class="text-slate-400">ความเห็นผู้พิจารณา:</span>
                     <span class="text-slate-700">${esc(doc.MktComment)}</span>
                   </div>`
                : ""
            }`;
        } catch (err) {
          document.getElementById("closeDocSummary").innerHTML =
            `<p class="text-red-500">โหลดข้อมูลเอกสารไม่สำเร็จ: ${esc(err.message)}</p>`;
        }
      }

      function closeCloseDocModal() {
        document.getElementById("closeDocModal").classList.add("hidden");
      }

      async function submitCloseDoc() {
        const docId = document.getElementById("closingDocId").value;
        if (!docId) return;

        const comment = document.getElementById("closeComment").value.trim();
        if (comment.length > 500) {
          showNotification(
            "ข้อมูลไม่ถูกต้อง",
            "ความเห็นปิดงานยาวเกิน 500 ตัวอักษร",
            "error",
          );
          return;
        }

        const btn = document.getElementById("submitCloseBtn");
        btn.disabled = true;
        try {
          const res = await n8nFetch(N8N_BASE + "close_claim_cus", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              docId: docId,
              actorEmpId: empId,
              actorName: empName || "ไม่ระบุชื่อ",
              comment: comment,
              attachments: closeAttachments.map((a) => ({
                fileName: a.fileName,
                fileType: a.fileType,
                base64: a.base64,
              })),
            }),
          });
          const result = await res.json().catch(() => ({}));
          if (!res.ok || result.success === false) {
            throw new Error(extractErrorMessage(result));
          }
          closeCloseDocModal();
          await fetchAllDocuments();
          showNotification(
            "ปิดงานสำเร็จ",
            `ปิดงานเอกสารเลขที่ ${docId} เรียบร้อยแล้ว`,
            "success",
          );
        } catch (err) {
          showNotification("ปิดงานไม่สำเร็จ", err.message, "error");
        } finally {
          btn.disabled = false;
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
        // พิมพ์แก้รหัสเอง = ยี่ห้อเดิมใช้ไม่ได้แล้ว ต้องเลือกจากรายการใหม่ (หรือให้ระบบค้นให้ตอนบันทึก)
        const rowForBrand = inputEl.closest("tr");
        if (rowForBrand && rowForBrand.dataset.brand) {
          setRowBrand(rowForBrand, "");
          refreshApproverSection();
        }

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

      // ป้ายสถานะสต็อก — ใช้ชุดเดียวกับ ncr_form.html / disassembly_form.html
      // ⚠️ สินค้าเคลมเป็นของที่ลูกค้าซื้อไปแล้ว สถานะสต็อกจึงเป็นข้อมูลประกอบเฉยๆ
      //    ไม่ได้แปลว่าเคลมไม่ได้ถ้าขึ้น out of stock
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
        dropdown.innerHTML = results
          .map((item) => {
            const code = item.code || item.Code || "";
            const name = item.name || item.Name || "";
            const manufacturers =
              item.manufacturers || item.Manufacturers || "";
            // API ส่งชื่อ field มาไม่แน่นอนระหว่าง stockstatus / stockStatus จึงรับทั้งสองแบบ
            const stockstatus = item.stockstatus || item.stockStatus || "";
            return `<div class="px-3 py-2 text-xs hover:bg-orange-50 cursor-pointer border-b border-slate-50 last:border-0" onclick='selectAutocompleteItem(${JSON.stringify(
              { code, name, brand: manufacturers },
            )})'>
                    <div class="flex items-center justify-between gap-2">
                        <span class="font-mono font-semibold text-slate-800">${esc(code)}</span>
                        ${stockStatusBadge(stockstatus)}
                    </div>
                    <div class="text-slate-500 mt-0.5">${manufacturers ? esc(manufacturers) + " — " : ""}${esc(name)}</div>
                </div>`;
          })
          .join("");
        positionDropdownUnderInput(dropdown, inputEl);
        dropdown.classList.remove("hidden");
      }

      function selectAutocompleteItem(item) {
        if (!activeAutocompleteInput) return;
        // ช่อง Service Material: ใส่เฉพาะรหัสสินค้า ไม่ยุ่งกับตารางรายการสินค้า/ยี่ห้อ/ผู้อนุมัติ
        if (activeAutocompleteInput.id === "serviceMaterial") {
          activeAutocompleteInput.value = item.code;
          hideGlobalDropdown();
          return;
        }
        const row = activeAutocompleteInput.closest("tr");
        activeAutocompleteInput.value = item.code;
        if (row && item.name) {
          const descInput = row.querySelector(".item-description");
          if (descInput) descInput.value = item.name;
        }
        if (row) setRowBrand(row, item.brand || "");
        hideGlobalDropdown();
        refreshApproverSection();
      }

      document.addEventListener("click", (e) => {
        if (
          !e.target.closest(".item-prod-code") &&
          e.target.id !== "serviceMaterial" &&
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
      // ⚙️ กันกดปุ่ม 👁 ซ้ำระหว่างที่ยังโหลดไม่เสร็จ — กดรัวๆ จะยิง request ซ้อนกัน
      //    แล้วบาง request ได้ response ว่างกลับมา (n8n รับ concurrent เข้า webhook เดียวกันแล้วบางตัวพัง)
      let viewDocumentLoadingId = null;

      async function viewDocument(docId) {
        if (viewDocumentLoadingId === docId) return;
        viewDocumentLoadingId = docId;

        const modal = document.getElementById("viewModal");
        const body = document.getElementById("viewModalBody");
        document.getElementById("viewModalTitle").textContent =
          `รายละเอียดเอกสาร ${docId}`;
        body.innerHTML =
          '<p class="text-center text-slate-400 py-8">กำลังโหลด...</p>';
        modal.classList.remove("hidden");

        try {
          const doc = await fetchDocDetail(docId);
          currentViewDocData = doc;

          const itemsHtml =
            (doc.items || [])
              .map(
                (item) => `
                    <tr class="border-b border-slate-100 last:border-0">
                        <td class="px-2 py-1.5 text-sm text-center text-slate-400">${item.LineNum}</td>
                        <td class="px-2 py-1.5 text-sm font-mono">${escOrDash(item.ProdCode)}</td>
                        <td class="px-2 py-1.5 text-sm">${escOrDash(item.Description)}</td>
                        <td class="px-2 py-1.5 text-sm text-center">${item.Qty} ${escOrDash(item.Unit)}</td>
                        <td class="px-2 py-1.5 text-sm text-center whitespace-nowrap">${formatThaiDate(item.PurchaseDate)}</td>
                        <td class="px-2 py-1.5 text-sm font-mono">${escOrDash(item.BillNo)}</td>
                        <td class="px-2 py-1.5 text-sm">${escOrDash(item.Remark)}</td>
                    </tr>`,
              )
              .join("") ||
            '<tr><td colspan="7" class="px-2 py-6 text-center text-slate-400 text-sm">ไม่มีรายการสินค้า</td></tr>';

          const contactCard = (label, name, email) => {
            if (!name && !email) return "";
            return `
                        <div class="bg-slate-50 border border-slate-150 rounded-lg p-3">
                            <p class="text-sm text-slate-400 uppercase font-semibold mb-1.5">${label}</p>
                            <p class="text-sm font-medium text-slate-800">${escOrDash(name)}</p>
                            <p class="text-sm text-slate-500">${escOrDash(email)}</p>
                        </div>`;
          };
          const contactCardsHtml = [
            contactCard(
              "ผู้รับเรื่องจากลูกค้า",
              doc.CreatedByName,
              doc.CreatedByEmail,
            ),
            contactCard(
              `${approverTitleOf(doc)} (ผู้พิจารณา)`,
              doc.MktNotifyName,
              doc.MktNotifyEmail,
            ),
          ]
            .filter(Boolean)
            .join("");

          const actionRow = (label, name, at, comment) => {
            if (!name) return "";
            return `
                        <tr class="border-b border-slate-100 last:border-0">
                            <td class="px-2 py-1.5 text-sm font-medium text-slate-700 whitespace-nowrap">${label}</td>
                            <td class="px-2 py-1.5 text-sm">${escOrDash(name)}</td>
                            <td class="px-2 py-1.5 text-sm text-slate-500 whitespace-nowrap">${at ? formatThaiDateTime(at) : "-"}</td>
                            <td class="px-2 py-1.5 text-sm text-slate-500">${escOrDash(comment)}</td>
                        </tr>`;
          };
          const actionRowsHtml = [
            actionRow(
              `${approverTitleOf(doc)}พิจารณา`,
              doc.MktByName,
              doc.MktAt,
              doc.MktComment,
            ),
            actionRow("ปิดงาน", doc.ClosedByName, doc.ClosedAt, doc.ClosedComment),
          ]
            .filter(Boolean)
            .join("");

          const attachSection = (title, list) => {
            if (!list || list.length === 0) return "";
            return `
              <div>
                <p class="text-sm text-slate-400 uppercase font-semibold mb-2">${title}</p>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  ${list
                    .map(
                      (a) => `
                    <div class="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                      <i data-lucide="paperclip" class="w-3.5 h-3.5 text-slate-400 shrink-0"></i>
                      <span class="text-xs text-slate-700 truncate flex-1">${esc(a.FileName)}</span>
                      <button type="button" onclick="openAttachmentFromDoc('${a.AttachmentId}')"
                        class="shrink-0 px-2.5 py-1 rounded-md bg-white border border-slate-200 text-[11px] font-semibold text-brand-600 hover:bg-brand-50">
                        เปิดดู
                      </button>
                    </div>`,
                    )
                    .join("")}
                </div>
              </div>`;
          };

          body.innerHTML = `
                    <div class="grid grid-cols-2 gap-3 text-sm">
                        <div><span class="text-slate-400">วันที่รับเรื่อง:</span> ${formatThaiDate(doc.DocDate)}</div>
                        <div><span class="text-slate-400">วัตถุประสงค์:</span> ${purposeLabel(doc.Purpose)}</div>
                        <div><span class="text-slate-400">ร้าน / ลูกค้า:</span> ${escOrDash(doc.CustomerName)}</div>
                        <div><span class="text-slate-400">เบอร์ติดต่อ:</span> ${escOrDash(doc.CustomerPhone)}</div>
                        <div class="col-span-2"><span class="text-slate-400">เลขที่ใบสั่งซ่อม:</span> <span class="font-mono">${escOrDash(doc.RepairOrderNo)}</span></div>
                        <div><span class="text-slate-400">Service Material:</span> ${escOrDash(doc.ServiceMaterial)}</div>
                        <div><span class="text-slate-400">Serial Number:</span> ${escOrDash(doc.SerialNumber)}</div>
                        <div class="col-span-2"><span class="text-slate-400">Service Technician:</span> ${escOrDash(doc.ServiceTechnician)}</div>
                        <div class="col-span-2"><span class="text-slate-400">สถานะ:</span> ${getStatusBadge(doc)}</div>
                        ${Number(doc.RejectCount) > 0 ? `<div class="col-span-2 text-amber-600">↻ เอกสารฉบับนี้เคยถูกตีกลับมาแล้ว ${doc.RejectCount} ครั้ง</div>` : ""}
                    </div>
                    ${
                      String(doc.LastRejectReason || "").trim()
                        ? `<div class="text-sm bg-red-50 border border-red-100 rounded-lg p-2 text-red-700"><span class="font-semibold">เหตุผลที่ขอเอกสารเพิ่มเติมล่าสุด:</span> ${esc(doc.LastRejectReason)}</div>`
                        : ""
                    }

                    <div>
                        <p class="text-sm text-slate-400 uppercase font-semibold mb-2">รายการสินค้า</p>
                        <div class="border border-slate-200 rounded-lg overflow-hidden">
                            <div class="overflow-x-auto">
                            <table class="w-full text-left text-sm">
                                <thead><tr class="bg-slate-50 border-b border-slate-200">
                                    <th class="px-2 py-1.5 text-sm font-semibold text-slate-500 uppercase">#</th>
                                    <th class="px-2 py-1.5 text-sm font-semibold text-slate-500 uppercase">Prod.Code</th>
                                    <th class="px-2 py-1.5 text-sm font-semibold text-slate-500 uppercase">Description</th>
                                    <th class="px-2 py-1.5 text-sm font-semibold text-slate-500 uppercase">Qty</th>
                                    <th class="px-2 py-1.5 text-sm font-semibold text-slate-500 uppercase">วันที่ซื้อ</th>
                                    <th class="px-2 py-1.5 text-sm font-semibold text-slate-500 uppercase">เลขที่บิล</th>
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

                    ${attachSection("ไฟล์แนบตอนรับเรื่อง", doc.attachmentsCreate)}
                    ${attachSection("ไฟล์แนบตอนปิดงาน", doc.attachmentsClose)}

                    ${
                      actionRowsHtml
                        ? `
                    <div>
                        <p class="text-sm text-slate-400 uppercase font-semibold mb-2">การดำเนินการ</p>
                        <div class="border border-slate-200 rounded-lg overflow-hidden">
                            <div class="overflow-x-auto">
                            <table class="w-full text-left text-sm">
                                <thead><tr class="bg-slate-50 border-b border-slate-200">
                                    <th class="px-2 py-1.5 text-sm font-semibold text-slate-500 uppercase">ขั้นตอน</th>
                                    <th class="px-2 py-1.5 text-sm font-semibold text-slate-500 uppercase">ผู้ดำเนินการ</th>
                                    <th class="px-2 py-1.5 text-sm font-semibold text-slate-500 uppercase">วันที่</th>
                                    <th class="px-2 py-1.5 text-sm font-semibold text-slate-500 uppercase">ความเห็น</th>
                                </tr></thead>
                                <tbody>${actionRowsHtml}</tbody>
                            </table>
                            </div>
                        </div>
                    </div>`
                        : ""
                    }
                `;
          lucide.createIcons();
        } catch (err) {
          body.innerHTML = `<p class="text-center text-red-500 py-8 text-sm">โหลดข้อมูลไม่สำเร็จ: ${esc(err.message)}</p>`;
        } finally {
          viewDocumentLoadingId = null;
        }
      }

      // เปิดไฟล์แนบจากเอกสารที่โหลดไว้แล้ว (ทั้ง viewModal และ preview ใช้ร่วมกัน)
      function openAttachmentFromDoc(attachmentId) {
        const doc = currentViewDocData || currentPreviewDocData;
        if (!doc) return;
        const all = [
          ...(doc.attachmentsCreate || []),
          ...(doc.attachmentsClose || []),
        ];
        const found = all.find(
          (a) => String(a.AttachmentId) === String(attachmentId),
        );
        if (!found || !found.FileBase64) {
          showNotification(
            "เปิดไฟล์ไม่สำเร็จ",
            "ไม่พบข้อมูลไฟล์แนบ กรุณาลองเปิดเอกสารใหม่อีกครั้ง",
            "error",
          );
          return;
        }
        openBase64InNewTab(found.FileBase64, found.FileType);
      }

      function closeViewModal() {
        document.getElementById("viewModal").classList.add("hidden");
      }

      // ================= หน้ากระดาษเอกสาร (ใช้ร่วมกัน Preview และพิมพ์จริง) =================
      function buildDocPaperHtml(doc) {
        const items = doc.items || [];
        const rows =
          items
            .map(
              (item, i) => `
                <tr>
                    <td class="border border-slate-300 px-4 py-3 text-xs text-left text-slate-500">${i + 1}</td>
                    <td class="border border-slate-300 px-4 py-3 text-xs font-mono break-words">${escOrDash(item.ProdCode)}</td>
                    <td class="border border-slate-300 px-4 py-3 text-xs break-words">${escOrDash(item.Description)}</td>
                    <td class="border border-slate-300 px-4 py-3 text-xs text-right whitespace-nowrap">${item.Qty ?? 0} ${esc(item.Unit || "")}</td>
                    <td class="border border-slate-300 px-4 py-3 text-xs whitespace-nowrap">${formatThaiDate(item.PurchaseDate)}</td>
                    <td class="border border-slate-300 px-4 py-3 text-xs font-mono break-words">${escOrDash(item.BillNo)}</td>
                    <td class="border border-slate-300 px-4 py-3 text-xs break-words">${escOrDash(item.Remark)}</td>
                </tr>
            `,
            )
            .join("") ||
          `<tr><td colspan="7" class="border border-slate-300 px-4 py-6 text-center text-slate-400">ไม่มีรายการสินค้า</td></tr>`;

        // ⚠️ ขนาด/สไตล์ยึดตามหน้ากระดาษของระบบ SWAP ทุกประการ ตามมาตรฐานที่ตกลงไว้
        const sigBlock = (label, name) => `
                <div class="flex-1 text-center space-y-1.5">
                    <div class="h-16 flex items-end justify-center"></div>
                    <p class="text-sm font-medium text-slate-800">${name ? esc(name) : "....................................."}</p>
                    <div class="border-t border-slate-400 pt-1.5">
                        <p class="text-xs text-slate-500">${label}</p>
                    </div>
                </div>
            `;

        const resultText =
          doc.ClaimResult === "APPROVED"
            ? "อนุมัติ"
            : doc.ClaimResult === "NOT_APPROVED"
              ? "ไม่อนุมัติ"
              : "รอพิจารณา";

        return `
                <div class="flex items-start justify-between border-b-2 border-slate-800 pb-6 mb-8">
                    <div>
                        <p class="text-sm font-bold text-orange-600 uppercase tracking-wider">KTW GROUP</p>
                        <p class="text-sm text-slate-500 mt-0.5">บริษัท เกรียงไทยวัฒนากรุ๊ป</p>
                        <h2 class="text-lg font-bold mt-3">ใบรับเรื่องเคลม / ซ่อมสินค้าจากลูกค้า</h2>
                    </div>
                    <div class="text-right text-sm text-slate-500 shrink-0">
                        <p>F-16-E01</p>
                        <p class="mt-0.5">วัตถุประสงค์: ${purposeLabel(doc.Purpose)}</p>
                    </div>
                </div>

                <div class="grid grid-cols-2 sm:grid-cols-4 gap-6 text-sm mb-8">
                    <div><p class="text-slate-400">เลขที่เอกสาร</p><p class="font-mono font-bold text-base mt-0.5">${esc(doc.DocId)}</p></div>
                    <div><p class="text-slate-400">วันที่รับเรื่อง</p><p class="font-semibold text-base mt-0.5">${formatThaiDate(doc.DocDate)}</p></div>
                    <div><p class="text-slate-400">ร้าน / ลูกค้า</p><p class="font-semibold text-base mt-0.5 break-words">${escOrDash(doc.CustomerName)}</p></div>
                    <div><p class="text-slate-400">เบอร์ติดต่อ</p><p class="font-semibold text-base mt-0.5">${escOrDash(doc.CustomerPhone)}</p></div>
                    <div><p class="text-slate-400">เลขที่ใบสั่งซ่อม</p><p class="font-mono font-semibold text-base mt-0.5 break-words">${escOrDash(doc.RepairOrderNo)}</p></div>
                    <div><p class="text-slate-400">Service Material</p><p class="font-semibold text-base mt-0.5 break-words">${escOrDash(doc.ServiceMaterial)}</p></div>
                    <div><p class="text-slate-400">Serial Number</p><p class="font-semibold text-base mt-0.5 break-words">${escOrDash(doc.SerialNumber)}</p></div>
                    <div><p class="text-slate-400">Service Technician</p><p class="font-semibold text-base mt-0.5 break-words">${escOrDash(doc.ServiceTechnician)}</p></div>
                </div>

                <div class="overflow-x-auto mb-8 rounded-lg border border-slate-300">
                    <table class="w-full border-collapse text-sm" style="table-layout: fixed;">
                        <colgroup>
                            <col style="width: 5%;">
                            <col style="width: 16%;">
                            <col style="width: 27%;">
                            <col style="width: 10%;">
                            <col style="width: 14%;">
                            <col style="width: 14%;">
                            <col style="width: 14%;">
                        </colgroup>
                        <thead>
                            <tr class="bg-slate-100">
                                <th class="border border-slate-300 px-3 py-2 text-center text-[11px] font-semibold">No.</th>
                                <th class="border border-slate-300 px-3 py-2 text-center text-[11px] font-semibold">Prod.Code</th>
                                <th class="border border-slate-300 px-3 py-2 text-center text-[11px] font-semibold">Description</th>
                                <th class="border border-slate-300 px-3 py-2 text-center text-[11px] font-semibold">Qty</th>
                                <th class="border border-slate-300 px-3 py-2 text-center text-[11px] font-semibold">วันที่ซื้อ</th>
                                <th class="border border-slate-300 px-3 py-2 text-center text-[11px] font-semibold">เลขที่บิล</th>
                                <th class="border border-slate-300 px-3 py-2 text-center text-[11px] font-semibold">Remark</th>
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-3 gap-6 text-sm mb-8">
                    <div><p class="text-slate-400">ผลการพิจารณา</p><p class="font-semibold text-base mt-0.5">${resultText}</p></div>
                    <div><p class="text-slate-400">ผู้พิจารณา</p><p class="font-semibold text-base mt-0.5">${escOrDash(doc.MktByName || doc.MktNotifyName)}</p></div>
                    <div><p class="text-slate-400">วันที่พิจารณา</p><p class="font-semibold text-base mt-0.5">${doc.MktAt ? formatThaiDate(doc.MktAt) : "-"}</p></div>
                </div>

                <!-- กล่องความเห็น — โชว์เฉพาะตอนดู Preview บนหน้าจอ ไม่ต้องออกมาตอนพิมพ์เอกสารจริง -->
                <div class="no-print grid grid-cols-1 sm:grid-cols-2 gap-4 mb-10">
                    <div class="bg-slate-50 border border-slate-200 rounded-lg p-4">
                        <p class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">ความเห็นจาก${approverTitleOf(doc)}</p>
                        <p class="text-sm text-slate-700 leading-relaxed">${escOrDash(doc.MktComment)}</p>
                    </div>
                    <div class="bg-slate-50 border border-slate-200 rounded-lg p-4">
                        <p class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">ความเห็นตอนปิดงาน</p>
                        <p class="text-sm text-slate-700 leading-relaxed">${escOrDash(doc.ClosedComment)}</p>
                    </div>
                </div>

                <div class="flex gap-8 pt-10">
                    ${sigBlock("ผู้รับเรื่องจากลูกค้า", doc.CreatedByName)}
                    ${sigBlock(approverTitleOf(doc), ["APPROVED", "NOT_APPROVED", "CLOSED"].includes(doc.Status) ? doc.MktByName || doc.MktNotifyName : "")}
                    <!-- ช่องผู้ปิดงานโชว์เฉพาะบนหน้าจอ ไม่ต้องออกมาตอนพิมพ์เอกสารจริง
                         เพราะกระดาษใบนี้ใช้ตอนรับของจากลูกค้า ซึ่งยังไม่มีใครปิดงาน -->
                    <div class="flex-1 no-print">
                        ${sigBlock("ผู้ปิดงาน", doc.ClosedByName)}
                    </div>
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
      function renderPreviewAttachment(doc) {
        const bar = document.getElementById("previewAttachmentBar");
        if (!bar) return;

        const groups = [
          { title: "ไฟล์แนบตอนรับเรื่อง", list: doc.attachmentsCreate || [] },
          { title: "ไฟล์แนบตอนปิดงาน", list: doc.attachmentsClose || [] },
        ].filter((g) => g.list.length > 0);

        if (groups.length === 0) {
          bar.classList.add("hidden");
          bar.innerHTML = "";
          return;
        }

        bar.innerHTML = groups
          .map(
            (g) => `
          <div>
            <div class="flex items-center gap-2 mb-2">
              <i data-lucide="paperclip" class="w-4 h-4 text-brand-500 shrink-0"></i>
              <span class="text-xs font-semibold text-slate-700">${g.title} (${g.list.length})</span>
            </div>
            <!-- items-start กัน grid ยืดการ์ดทุกใบให้สูงเท่าใบที่สูงสุด
                 ไม่งั้นการ์ด PDF (ที่ไม่มีรูป) จะกลายเป็นช่องขาวเปล่าสูงเท่ารูปข้าง ๆ -->
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 items-start">
              ${g.list
                .map((a) => {
                  const isImage = /^image\//i.test(a.FileType || "");
                  const isPdf = /pdf/i.test(a.FileType || "") || /\.pdf$/i.test(a.FileName || "");
                  const dataUrl = `data:${a.FileType || "application/octet-stream"};base64,${a.FileBase64 || ""}`;
                  return `
                  <div class="rounded-lg border border-slate-200 p-2.5 space-y-2">
                    <div class="flex items-center gap-2">
                      <span class="text-xs text-slate-700 truncate flex-1">${esc(a.FileName)}</span>
                      <button type="button" onclick="openAttachmentFromDoc('${a.AttachmentId}')"
                        class="shrink-0 px-2.5 py-1 rounded-md bg-brand-50 text-brand-700 text-[11px] font-semibold hover:bg-brand-100 flex items-center gap-1">
                        <i data-lucide="external-link" class="w-3 h-3"></i>เปิดดู
                      </button>
                      <a href="${dataUrl}" download="${esc(a.FileName)}"
                        class="shrink-0 px-2.5 py-1 rounded-md bg-slate-100 text-slate-700 text-[11px] font-semibold hover:bg-slate-200 flex items-center gap-1">
                        <i data-lucide="download" class="w-3 h-3"></i>ดาวน์โหลด
                      </a>
                    </div>
                    ${
                      isImage
                        ? `<img src="${dataUrl}" alt="${esc(a.FileName)}" class="max-h-56 mx-auto rounded-lg border border-slate-200">`
                        : `<div class="flex items-center gap-2 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2.5">
                             <i data-lucide="${isPdf ? "file-text" : "file"}" class="w-4 h-4 text-slate-400 shrink-0"></i>
                             <span class="text-[11px] text-slate-500">${isPdf ? "ไฟล์ PDF — กดเปิดดูหรือดาวน์โหลดเพื่อเปิดในโปรแกรมอ่าน PDF" : "ไฟล์แนบ — กดเปิดดูหรือดาวน์โหลด"}</span>
                           </div>`
                    }
                  </div>`;
                })
                .join("")}
            </div>
          </div>`,
          )
          .join("");
        bar.classList.remove("hidden");
        lucide.createIcons();
      }

      async function previewDocument(docId) {
        showNotification(
          "กำลังดึงข้อมูล",
          `กำลังดึงข้อมูลเอกสาร ${docId} เพื่อแสดงตัวอย่าง...`,
          "warning",
        );
        try {
          const doc = await fetchDocDetail(docId);
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

      // ================= Docflow =================
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
            n8nFetch(N8N_BASE + "get_document_detail_claim_cus", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ docId }),
            }),
            n8nFetch(N8N_BASE + "get_docflow_claim_cus", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ docId }),
            }),
          ]);
          const rawDoc = await detailRes.json();
          doc = Array.isArray(rawDoc) ? rawDoc[0] : rawDoc;

          // ⚠️ SQL - Get Claim Doc Log เปิด Always Output Data ไว้
          //    ถ้า docId ไม่มีในระบบจะได้ item เปล่า {} กลับมา 1 ตัว ไม่ใช่ array ว่าง
          //    ต้องกรองด้วย LogId ก่อนวาด ไม่งั้นได้กล่องเปล่า 1 กล่อง
          const rawLogs = await flowRes.json();
          logs = (Array.isArray(rawLogs) ? rawLogs : [rawLogs]).filter(
            (l) => l && l.LogId,
          );
        } catch (err) {
          console.error("Docflow fetch error:", err);
        }

        if (!doc || !doc.DocId) {
          docFlowContent.innerHTML = `<p class="text-center text-sm text-slate-400 py-6">ไม่พบข้อมูลเอกสาร</p>`;
          return;
        }

        const steps = [
          {
            label: "ผู้รับเรื่องจากลูกค้า",
            name: doc.CreatedByName || "—",
            done: true,
            doneText: `✓ รับเรื่องเมื่อ ${formatThaiDate(doc.DocDate)}`,
          },
          {
            label: `${approverTitleOf(doc)}พิจารณา`,
            name: doc.MktByName || doc.MktNotifyName || "รอดำเนินการ",
            done: !!doc.MktAt,
            doneText: doc.MktAt
              ? `✓ ${doc.ClaimResult === "APPROVED" ? "อนุมัติ" : "ไม่อนุมัติ"}เมื่อ ${formatThaiDateTime(doc.MktAt)}`
              : null,
          },
          {
            label: "ปิดงาน",
            name: doc.ClosedByName || "รอดำเนินการ",
            done: !!doc.ClosedAt,
            doneText: doc.ClosedAt
              ? `✓ ปิดงานเมื่อ ${formatThaiDateTime(doc.ClosedAt)}`
              : null,
          },
        ];

        const stepStyle = (done) =>
          done ? "bg-emerald-500 text-white" : "bg-slate-200 text-slate-400";
        const stepIcon = (done) => (done ? "check" : "minus");

        const ACTION_LABEL = {
          CREATE: "สร้างเอกสาร",
          EDIT: "แก้ไขเอกสาร",
          APPROVE: "อนุมัติ",
          REJECT_BACK: "ตีกลับให้แก้ไข",
          REQUEST_DOCS: "ขอเอกสารเพิ่มเติม",
          NOT_APPROVE: "ไม่อนุมัติ",
          CLOSE: "ปิดงาน",
          DELETE: "ยกเลิกเอกสาร",
          RESTORE: "เรียกคืนเอกสารที่ยกเลิก",
          ADMIN_REVERT: "ถอยสถานะ",
        };

        const logsHtml = logs
          .map(
            (log) => `
                <div class="flex items-start gap-2.5">
                    <div class="w-1.5 h-1.5 rounded-full bg-brand-500 mt-1.5 shrink-0"></div>
                    <div class="min-w-0">
                        <p class="text-sm font-medium text-slate-700">${esc(ACTION_LABEL[log.Action] || log.Action)}${log.Detail ? " · " + esc(log.Detail) : ""}</p>
                        <p class="text-xs text-slate-400">${esc(log.ActionByName || "")} • ${formatThaiDateTime(log.ActionAt)}</p>
                    </div>
                </div>`,
          )
          .join("");

        docFlowContent.innerHTML = `
                <div class="space-y-4">
                    <div class="flex items-center justify-between mb-2">
                        <span class="text-sm font-bold text-slate-400 uppercase tracking-wider">เลขที่เอกสาร</span>
                        <span class="font-mono text-sm font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded">${esc(doc.DocId)}</span>
                    </div>
                    <div class="flex items-center justify-between mb-4">
                        <span class="text-sm font-bold text-slate-400 uppercase tracking-wider">สถานะปัจจุบัน</span>
                        <span class="text-sm">${getStatusBadge(doc)}</span>
                    </div>

                    <div class="relative pl-7 border-l-2 border-slate-200 space-y-6">
                        ${steps
                          .map(
                            (s, idx) => `
                        <div class="relative">
                            <span class="absolute -left-[29px] top-0.5 flex h-5 w-5 items-center justify-center rounded-full ${stepStyle(s.done)} ring-4 ring-white">
                                <i data-lucide="${stepIcon(s.done)}" class="w-3 h-3"></i>
                            </span>
                            <div class="text-base font-bold text-slate-800">${idx + 1}. ${s.label}</div>
                            <div class="text-sm text-slate-500 mt-0.5">${esc(s.name)}</div>
                            ${
                              s.doneText
                                ? `<div class="text-xs text-emerald-600 font-semibold mt-1">${s.doneText}</div>`
                                : `<div class="text-xs text-amber-500 font-semibold mt-1">⏳ รอดำเนินการ</div>`
                            }
                        </div>`,
                          )
                          .join("")}
                    </div>

                    ${
                      logsHtml
                        ? `
                    <div class="pt-3 border-t border-slate-100 space-y-2.5">
                        <h4 class="text-xs font-bold text-slate-400 uppercase tracking-wider">ประวัติทั้งหมด</h4>
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

      // ================= รายงานประจำเดือน (Admin / SRV) =================
      const MR_MONTHS_TH = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน","กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];
      let mrSelected = new Set();
      let mrExtras = [];
      let mrSending = false;
      let mrPreviewTimer = null;
      let mrPreviewSeq = 0;

      const mrPad = (n) => String(n).padStart(2, "0");
      const mrIso = (d) => d.getFullYear() + "-" + mrPad(d.getMonth() + 1) + "-" + mrPad(d.getDate());
      const mrThDate = (iso) => { const [y, m, d] = iso.split("-").map(Number); return d + " " + MR_MONTHS_TH[m - 1].slice(0, 3) + " " + (y + 543); };
      const mrEmailRe = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

      function mrRecipientList() {
        // ทุกคนใน Role SRV (รวมคนไม่มีอีเมล) — อีเมลหยิบจากรายชื่อ srv ที่มีอีเมลถูกต้อง
        const emailById = {};
        (claimRoleMembers.srv || []).forEach((p) => { emailById[String(p.empId).trim()] = p.email; });
        const base = (claimRoleMembers.technicians && claimRoleMembers.technicians.length)
          ? claimRoleMembers.technicians
          : (claimRoleMembers.srv || []);
        return base
          .map((p) => ({ empId: String(p.empId).trim(), name: p.name, email: emailById[String(p.empId).trim()] || p.email || "" }))
          .sort((a, b) => a.empId.localeCompare(b.empId, undefined, { numeric: true }));
      }

      function mrFillMonths() {
        const sel = document.getElementById("mrMonth");
        const now = new Date();
        let html = '<option value="">กำหนดเอง</option>';
        for (let i = 0; i < 18; i++) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          html += `<option value="${d.getFullYear()}-${mrPad(d.getMonth() + 1)}">${MR_MONTHS_TH[d.getMonth()]} ${d.getFullYear() + 543}</option>`;
        }
        sel.innerHTML = html;
      }

      function mrApplyMonth() {
        const v = document.getElementById("mrMonth").value;
        if (!v) return;
        const [y, m] = v.split("-").map(Number);
        const first = new Date(y, m - 1, 1);
        let last = new Date(y, m, 0);
        const today = new Date(); today.setHours(0, 0, 0, 0);
        if (last > today) last = today;   // เดือนปัจจุบัน: ถึงวันนี้
        document.getElementById("mrFrom").value = mrIso(first);
        document.getElementById("mrTo").value = mrIso(last);
        mrSchedulePreview();
      }

      function mrValidateRange() {
        const from = document.getElementById("mrFrom").value;
        const to = document.getElementById("mrTo").value;
        const hint = document.getElementById("mrRangeHint");
        const todayIso = mrIso(new Date());
        let err = "";
        if (!from || !to) err = "กรุณาเลือกวันที่ให้ครบ";
        else if (from > to) err = "วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด";
        else if (to > todayIso) err = "เลือกวันที่เกินวันนี้ไม่ได้";
        else if ((new Date(to) - new Date(from)) / 86400000 > 365) err = "เลือกช่วงวันที่ได้ไม่เกิน 366 วัน";
        hint.textContent = err || `ช่วงที่เลือก: ${mrThDate(from)} – ${mrThDate(to)}`;
        hint.className = "text-[11px] " + (err ? "text-red-500" : "text-slate-400");
        return err ? null : { from, to };
      }

      function mrSchedulePreview() {
        clearTimeout(mrPreviewTimer);
        mrPreviewTimer = setTimeout(mrLoadPreview, 350);
      }

      async function mrLoadPreview() {
        const box = document.getElementById("mrPreview");
        const r = mrValidateRange();
        if (!r) { box.textContent = "เลือกช่วงวันที่ให้ถูกต้องเพื่อดูตัวอย่างสรุป"; return; }
        const seq = ++mrPreviewSeq;
        box.textContent = "กำลังโหลดตัวอย่างสรุป...";
        try {
          const res = await n8nFetch(N8N_BASE + "get_monthly_report_summary_claim_cus", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dateFrom: r.from, dateTo: r.to, actorEmpId: empId }),
          });
          const txt = await res.text();
          let data = txt && txt.trim() ? JSON.parse(txt) : {};
          if (Array.isArray(data)) data = data[0] || {};
          if (seq !== mrPreviewSeq) return;
          if (!data.success) { box.textContent = extractErrorMessage(data, "ไม่มีข้อมูลในช่วงที่เลือก"); return; }
          const kpi = (label, v, cls) => `<div class="flex-1 min-w-[78px] rounded-lg bg-white border border-slate-100 px-2 py-1.5 text-center"><div class="text-base font-bold ${cls}">${Number(v) || 0}</div><div class="text-[10px] text-slate-500">${label}</div></div>`;
          box.innerHTML = `<div class="flex flex-wrap gap-2">${kpi("ทั้งหมด", data.total, "text-slate-800")}${kpi("อนุมัติ", data.approved, "text-green-600")}${kpi("ไม่อนุมัติ", data.notApproved, "text-red-600")}${kpi("ค้างดำเนินการ", data.pending, "text-amber-600")}${kpi("เสร็จสิ้น", data.closed, "text-blue-600")}${kpi("ยกเลิก", data.cancelled, "text-slate-400")}</div>`;
        } catch (e) {
          if (seq === mrPreviewSeq) box.textContent = "โหลดตัวอย่างสรุปไม่สำเร็จ (ยังส่งรายงานได้ตามปกติ)";
        }
      }

      function mrUpdateCount() {
        const n = mrSelected.size + mrExtras.length;
        document.getElementById("mrSelCount").textContent = n ? `เลือกแล้ว ${n} อีเมล` : "";
        document.getElementById("mrSendBtn").textContent = n ? `ส่งรายงาน (${n} ผู้รับ)` : "ส่งรายงาน";
      }

      function mrRenderRecipients() {
        const q = (document.getElementById("mrSearch").value || "").trim().toLowerCase();
        const box = document.getElementById("mrRecipients");
        const list = mrRecipientList().filter((p) => !q || (p.empId + " " + p.name + " " + p.email).toLowerCase().includes(q));
        if (!list.length) { box.innerHTML = '<div class="p-3 text-xs text-slate-400 text-center">ไม่พบรายชื่อ</div>'; mrUpdateCount(); return; }
        box.innerHTML = list.map((p) => {
          const has = mrEmailRe.test(p.email || "");
          const key = has ? p.email.toLowerCase() : "";
          return `<label class="flex items-center gap-2 px-3 py-2 text-xs ${has ? "cursor-pointer hover:bg-slate-50" : "opacity-50 cursor-not-allowed"}">
            <input type="checkbox" class="accent-brand-500" data-mr-email="${esc(key)}" ${has ? "" : "disabled"} ${has && mrSelected.has(key) ? "checked" : ""} />
            <span class="font-mono text-slate-500 w-12">${esc(p.empId)}</span>
            <span class="text-slate-800 flex-1 truncate">${esc(p.name)}</span>
            <span class="text-slate-400 truncate max-w-[180px]">${has ? esc(p.email) : "ไม่มีอีเมล"}</span>
          </label>`;
        }).join("");
        box.querySelectorAll("input[data-mr-email]").forEach((cb) => {
          cb.addEventListener("change", () => {
            const k = cb.dataset.mrEmail;
            if (cb.checked) mrSelected.add(k); else mrSelected.delete(k);
            mrUpdateCount();
          });
        });
        mrUpdateCount();
      }

      function mrToggleAll(on) {
        mrRecipientList().forEach((p) => {
          if (!mrEmailRe.test(p.email || "")) return;
          const k = p.email.toLowerCase();
          if (on) mrSelected.add(k); else mrSelected.delete(k);
        });
        mrRenderRecipients();
      }

      function mrRenderChips() {
        document.getElementById("mrChips").innerHTML = mrExtras.map((e, i) =>
          `<span class="inline-flex items-center gap-1 bg-brand-50 text-brand-700 border border-brand-100 rounded-full px-2 py-0.5 text-[11px]">${esc(e)}<button type="button" data-mr-del="${i}" class="text-brand-400 hover:text-red-500">&times;</button></span>`
        ).join("");
        document.querySelectorAll("#mrChips [data-mr-del]").forEach((b) => b.addEventListener("click", () => {
          mrExtras.splice(Number(b.dataset.mrDel), 1); mrRenderChips();
        }));
        mrUpdateCount();
      }

      function mrAddExtra() {
        const inp = document.getElementById("mrExtra");
        const parts = inp.value.split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
        if (!parts.length) return;
        for (const e of parts) {
          if (!mrEmailRe.test(e)) { showNotification("อีเมลไม่ถูกต้อง", e, "error"); return; }
          if (mrExtras.includes(e) || mrSelected.has(e)) continue;
          if (mrExtras.length >= 10) { showNotification("เพิ่มอีเมลเกินกำหนด", "อีเมลเพิ่มเติมได้สูงสุด 10 รายการ", "error"); break; }
          mrExtras.push(e);
        }
        inp.value = "";
        mrRenderChips();
      }

      function openMonthlyReportModal() {
        if (!(isAdminUser || isSrvUser)) return;
        mrSelected = new Set(); mrExtras = []; mrSending = false;   // เริ่มต้นไม่ติ๊กใครเลย
        mrFillMonths();
        const sel = document.getElementById("mrMonth");
        if (sel.options.length > 1) sel.selectedIndex = 1;          // เดือนปัจจุบัน
        document.getElementById("mrFrom").max = document.getElementById("mrTo").max = mrIso(new Date());
        document.getElementById("mrSearch").value = "";
        document.getElementById("mrExtra").value = "";
        document.querySelector('input[name="mrFormat"][value="excel"]').checked = true;
        document.getElementById("mrSendBtn").disabled = false;
        mrApplyMonth(); mrRenderRecipients(); mrRenderChips();
        openModal("monthlyReportModal", "monthlyReportModalContent");
      }

      function closeMonthlyReportModal() {
        if (mrSending) return;
        closeModal("monthlyReportModal", "monthlyReportModalContent");
      }

      async function submitMonthlyReport() {
        if (mrSending) return;
        const r = mrValidateRange();
        if (!r) { showNotification("ช่วงวันที่ไม่ถูกต้อง", document.getElementById("mrRangeHint").textContent, "error"); return; }
        const recipients = [...new Set([...mrSelected, ...mrExtras])];
        if (!recipients.length) { showNotification("ยังไม่ได้เลือกผู้รับ", "กรุณาเลือกอย่างน้อย 1 อีเมล", "error"); return; }
        const format = document.querySelector('input[name="mrFormat"]:checked').value;
        mrSending = true;
        const btn = document.getElementById("mrSendBtn");
        btn.disabled = true; btn.textContent = "กำลังสร้างและส่งรายงาน...";
        try {
          const res = await n8nFetch(N8N_BASE + "send_monthly_report_claim_cus", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dateFrom: r.from, dateTo: r.to, recipients, format, actorEmpId: empId, actorName: empName }),
          });
          const txt = await res.text();
          let data = txt && txt.trim() ? JSON.parse(txt) : {};
          if (Array.isArray(data)) data = data[0] || {};
          if (!res.ok || !data.success) throw new Error(extractErrorMessage(data, "ส่งรายงานไม่สำเร็จ"));
          mrSending = false;
          closeMonthlyReportModal();
          showNotification("ส่งรายงานเรียบร้อย", `ส่งถึง ${recipients.length} ผู้รับ • ${data.docCount || 0} เอกสาร` + (format === "excel" ? ` • ฝังรูป ${data.embedded || 0} รูป` : ""), "success");
        } catch (e) {
          mrSending = false;
          btn.disabled = false;
          mrUpdateCount();
          showNotification("ส่งรายงานไม่สำเร็จ", e.message || "กรุณาลองใหม่อีกครั้ง", "error");
        }
      }

      document.addEventListener("DOMContentLoaded", () => {
        const b = document.getElementById("monthlyReportBtn");
        if (b && (isAdminUser || isSrvUser)) b.classList.remove("hidden");
        document.getElementById("mrMonth").addEventListener("change", mrApplyMonth);
        ["mrFrom", "mrTo"].forEach((id) => document.getElementById(id).addEventListener("change", () => {
          document.getElementById("mrMonth").value = "";   // แก้วันที่เอง = กำหนดเอง
          mrSchedulePreview();
        }));
        document.getElementById("mrExtra").addEventListener("keydown", (ev) => {
          if (ev.key === "Enter" || ev.key === ",") { ev.preventDefault(); mrAddExtra(); }
        });
        document.getElementById("mrExtra").addEventListener("blur", mrAddExtra);
      });

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
                    <h4 class="text-sm font-semibold text-slate-900">${esc(title)}</h4>
                    <p class="text-xs text-slate-500 mt-1 leading-relaxed">${esc(message)}</p>
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

      // ⚠️ Auto-open: ถ้า URL มี ?doc=... (ลิงก์จากอีเมลแจ้งเตือน) ให้เปิดเอกสารนั้นอัตโนมัติ
      //    ต้องรอ fetchAllDocuments() เสร็จก่อน เพราะ openEditDocModal() เช็คสิทธิ์จาก allDocuments
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
        if (mode === "edit") {
          // จากอีเมล "ขอเอกสารเพิ่มเติม" → เปิดโหมดแก้ไขให้ผู้สร้างแก้ได้ทันที
          openEditDocModal(docId);
        } else {
          previewDocument(docId);
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
        await loadClaimRoleMembers();
        lucide.createIcons();
        openFromUrlIfNeeded();
      };
