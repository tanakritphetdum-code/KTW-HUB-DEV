// ===================================================================
// modules/pettycashService.js — Service Logic สำหรับ KTW HUB
// ===================================================================

      const N8N_BASE = "https://n8n.ktw.co.th/webhook/";
      const empId = sessionStorage.getItem("emp_id") || "";
      const $ = (id) => document.getElementById(id);

      // ================= ตัวช่วย =================
      const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
      const todayIso = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
      const TH_M = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
      function thDate(v) { const m = String(v || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${+m[3]} ${TH_M[+m[2] - 1]} ${+m[1] + 543}` : "-"; }
      function thShort(v) { const m = String(v || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${+m[3]}/${+m[2]}/${String(+m[1] + 543).slice(-2)}` : "-"; }
      const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
      const money = (n) => r2(n).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const moneyOrBlank = (n) => (Number(n) ? money(n) : "");

      async function pcs(path, body) {
        try {
          const res = await n8nFetch(N8N_BASE + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.assign({ actorEmpId: empId }, body || {})) });
          const text = await res.text(); let j = null;
          try { j = text && text.trim() ? JSON.parse(text) : null; } catch (e) { j = null; }
          if (Array.isArray(j)) j = j[0];
          return j || { success: false, error: "ไม่ได้รับข้อมูลจากเซิร์ฟเวอร์ (HTTP " + res.status + ")" };
        } catch (err) { console.error(path, err); return { success: false, error: "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้" }; }
      }

      function showNotification(title, message, type = "success") {
        const c = $("toast-container"); if (!c) return;
        const t = document.createElement("div");
        t.className = `transform translate-y-2 opacity-0 transition-all duration-300 pointer-events-auto flex items-start gap-3 bg-white border border-slate-200 rounded-2xl p-4 shadow-xl max-w-sm border-l-4 ${type === "success" ? "border-l-emerald-500" : type === "warning" ? "border-l-amber-500" : "border-l-red-500"}`;
        const icon = type === "warning" ? "alert-triangle" : type === "error" ? "alert-circle" : "check-circle";
        const color = type === "warning" ? "text-amber-500" : type === "error" ? "text-red-500" : "text-emerald-500";
        t.innerHTML = `<div class="mt-0.5 ${color}"><i data-lucide="${icon}" class="w-5 h-5"></i></div><div class="flex-1"><p class="text-sm font-bold text-slate-900">${esc(title)}</p><p class="text-xs text-slate-500 mt-0.5">${esc(message)}</p></div>`;
        c.appendChild(t); lucide.createIcons();
        requestAnimationFrame(() => t.classList.remove("translate-y-2", "opacity-0"));
        setTimeout(() => { t.classList.add("opacity-0"); setTimeout(() => t.remove(), 300); }, 4000);
      }
      const toast = (msg, ok = true) => showNotification(ok ? "สำเร็จ" : "ไม่สำเร็จ", msg, ok ? "success" : "error");

      // ================= Modal ทั่วไป (ใช้แทน confirm/prompt ของเบราว์เซอร์) =================
      let modalOk = null;
      function openModal(title, html, okLabel, onOk, danger) {
        $("mTitle").textContent = title; $("mBody").innerHTML = html;
        const b = $("mOk"); b.textContent = okLabel || "ยืนยัน";
        b.className = `h-10 px-5 rounded-lg text-sm font-medium text-white shadow-md ${danger ? "bg-red-600 hover:bg-red-700" : "bg-brand-500 hover:bg-brand-600"}`;
        modalOk = onOk; $("modal").classList.remove("hidden"); lucide.createIcons();
        const f = $("mBody").querySelector("input,select,textarea"); if (f) f.focus();
      }
      function closeModal() { $("modal").classList.add("hidden"); modalOk = null; }
      $("mOk").addEventListener("click", async () => {
        if (!modalOk) return closeModal();
        const b = $("mOk"); b.disabled = true; b.classList.add("opacity-60");
        try { const keep = await modalOk(); if (keep !== true) closeModal(); } finally { b.disabled = false; b.classList.remove("opacity-60"); }
      });
      const fld = (label, inner, hint) => `<div><label class="block text-xs font-semibold text-slate-500 mb-1.5">${label}</label>${inner}${hint ? `<p class="text-[11px] text-slate-400 mt-1">${hint}</p>` : ""}</div>`;
      const inCls = "w-full h-10 px-3 rounded-lg border border-slate-200 text-sm outline-none focus:ring-1 focus:ring-brand-500 bg-white";

      // ================= สิทธิ์ (ซ่อน/แสดงปุ่มเท่านั้น — server ตรวจซ้ำทุก endpoint) =================
      let myPerms = new Set();
      const can = (k) => myPerms.has(k);
      async function loadMyPerms() {
        const r = await pcs("pcs_my_perms");
        myPerms = new Set(r.success ? r.perms || [] : []);
        sessionStorage.setItem("pettycash_role", myPerms.has("MANAGE_ROLE") ? "1" : myPerms.has("VIEW_MENU") ? "2" : "0");
        return r.success;
      }

      // ================= ประเภทค่าใช้จ่าย =================
      let cats = [];
      const catName = (id) => (cats.find((c) => c.catId === id) || {}).catName || "ประเภท #" + id;
      async function loadCats() {
        const r = await pcs("pcs_categories");
        cats = r.success ? (r.data || []).map((c) => ({ catId: +c.catId, catName: c.catName, sortOrder: +c.sortOrder || 0, isActive: Number(c.isActive) === 1 })) : [];
        $("eCat").innerHTML = cats.filter((c) => c.isActive).map((c) => `<option value="${c.catId}">${esc(c.catName)}</option>`).join("");
      }

      // ================= รายการงวด =================
      let periods = [];
      const STATUS_CLS = { "เปิด": "bg-blue-50 text-blue-700 border border-blue-100", "ปิดงวด": "bg-slate-100 text-slate-600 border border-slate-200" };
      const statusBadge = (s) => `<span class="inline-flex items-center whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-bold ${STATUS_CLS[s] || ""}">${s === "เปิด" ? "เปิดอยู่" : esc(s)}</span>`;
      const rangeText = (p) => `${thShort(p.startDate)} – ${p.endDate ? thShort(p.endDate) : "ปัจจุบัน"}`;

      async function loadPeriods() {
        const icon = $("syncIcon"); icon && icon.classList.add("animate-spin");
        const scope = can("READ_ALL") ? $("scopeSel").value : "own";
        $("listTitle").textContent = scope === "all" ? "งวดเงินสดย่อย (ทุกคน)" : "งวดเงินสดย่อยของฉัน";
        const r = await pcs("pcs_period_list", { scope });
        icon && icon.classList.remove("animate-spin");
        if (!r.success) { $("periodBody").innerHTML = `<tr><td colspan="8" class="px-4 py-8 text-center text-sm text-red-500">${esc(r.error || "โหลดข้อมูลไม่สำเร็จ")}</td></tr>`; return; }
        periods = r.data || [];
        renderPeriods();
      }
      function renderPeriods() {
        const open = periods.filter((p) => p.status === "เปิด");
        const sumOpen = open.reduce((s, p) => s + Number(p.balance || 0), 0);
        const sumAdv = periods.reduce((s, p) => s + Number(p.totalAdvance || 0), 0);
        const sumExp = periods.reduce((s, p) => s + Number(p.totalExpense || 0), 0);
        const card = (label, val, color, sub) => `<div class="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm"><div class="text-xs font-semibold text-slate-500">${label}</div><div class="text-2xl font-bold text-${color}-600 mt-1 num text-left">${val}</div>${sub ? `<div class="text-[11px] text-slate-400 mt-0.5">${sub}</div>` : ""}</div>`;
        $("listStats").innerHTML = card("คงเหลือในงวดที่เปิดอยู่", money(sumOpen), "blue", `${open.length} งวดที่เปิดอยู่`) + card("เบิกรวม (ทุกงวดที่แสดง)", money(sumAdv), "emerald") + card("จ่ายรวม (ทุกงวดที่แสดง)", money(sumExp), "red");
        if (!periods.length) {
          $("periodBody").innerHTML = `<tr><td colspan="8" class="px-4 py-10 text-center text-sm text-slate-400">ยังไม่มีงวดเงินสดย่อย${can("RECORD") ? ' — กด <b>เปิดงวดใหม่</b> เพื่อเริ่มบันทึก' : ""}</td></tr>`; return;
        }
        $("periodBody").innerHTML = periods.map((p) => `
          <tr class="hover:bg-orange-50/40 cursor-pointer" onclick="openPeriod('${esc(p.periodNo)}')">
            <td class="p-4 font-mono font-semibold text-orange-600">${esc(p.periodNo)}</td>
            <td class="p-4">${rangeText(p)}<div class="text-[11px] text-slate-400">${Number(p.expenseCount || 0)} รายการจ่าย</div></td>
            <td class="p-4">${esc(p.custodianName || p.custodianEmpId)}<div class="text-[11px] text-slate-400 font-mono">${esc(p.custodianEmpId)}</div></td>
            <td class="p-4 num">${money(p.openingBalance)}</td>
            <td class="p-4 num text-emerald-600">${money(p.totalAdvance)}</td>
            <td class="p-4 num text-red-600">${money(p.totalExpense)}</td>
            <td class="p-4 num font-bold">${money(p.balance)}</td>
            <td class="p-4">${statusBadge(p.status)}</td>
          </tr>`).join("");
      }

      // ================= เปิด / แก้ไขงวด =================
      function suggestedOpening() {
        // ตรงกับที่ server จะตัดยอดให้: งวดล่าสุดของตัวเองที่ยังไม่ถูกยกยอด (ถ้ายังเปิดอยู่ ระบบจะปิดงวดนั้นให้อัตโนมัติ)
        const mine = periods.filter((p) => p.custodianEmpId === empId && !p.carriedToPeriodNo).sort((a, b) => String(b.startDate).localeCompare(String(a.startDate)));
        return mine.length ? { value: Number(mine[0].status === "ปิดงวด" ? (mine[0].closingBalance ?? mine[0].balance ?? 0) : (mine[0].balance ?? 0)), from: mine[0] } : null;
      }
      function openPeriodModal(edit) {
        const p = edit ? cur.period : null;
        const sug = p ? null : suggestedOpening();
        const html = `
          ${fld('วันเริ่มงวด <span class="text-red-500">*</span>', `<input id="pStart" type="date" class="${inCls}" value="${p ? p.startDate : todayIso()}" />`)}
          ${p ? fld("ยอดยกมา (บาท)", `<input id="pOpen" type="number" step="0.01" class="${inCls} text-right" value="${r2(p.openingBalance)}" />`)
              : fld("ยอดยกมา (บาท)", `
                <div class="space-y-2">
                  <label class="flex items-center gap-2 text-sm"><input type="radio" name="pOpenMode" value="auto" checked class="accent-brand-500" onchange="$('pOpen').disabled=true" /> ยกยอดคงเหลือจากงวดก่อนอัตโนมัติ ${sug ? `<b class="text-blue-600">${money(sug.value)}</b> <span class="text-[11px] text-slate-400">(${esc(sug.from.periodNo)})</span>` : '<span class="text-[11px] text-slate-400">(ยังไม่มีงวดที่ปิดแล้ว = 0.00)</span>'}</label>
                  <label class="flex items-center gap-2 text-sm"><input type="radio" name="pOpenMode" value="manual" class="accent-brand-500" onchange="$('pOpen').disabled=false;$('pOpen').focus()" /> ระบุเอง</label>
                  <input id="pOpen" type="number" step="0.01" disabled class="${inCls} text-right" value="${sug ? r2(sug.value) : 0}" />
                </div>`, "ยอดเงินสดที่มีอยู่ในมือตอนเริ่มงวด ไม่รวมเงินที่จะเบิกเพิ่ม (บันทึกการเบิกแยกในหน้าถัดไป)")}
          ${fld("หมายเหตุ", `<input id="pRemark" maxlength="500" class="${inCls}" value="${esc(p ? p.remark || "" : "")}" />`)}`;
        openModal(p ? "แก้ไขงวด " + p.periodNo : "เปิดงวดเงินสดย่อยใหม่", html, p ? "บันทึก" : "เปิดงวด", async () => {
          const auto = !p && (document.querySelector('input[name="pOpenMode"]:checked') || {}).value === "auto";
          const body = { op: p ? "edit" : "create", periodNo: p ? p.periodNo : "", startDate: $("pStart").value, openingAuto: auto, openingBalance: Number($("pOpen").value || 0), remark: $("pRemark").value };
          if (!body.startDate) { toast("กรุณาระบุวันเริ่มงวด", false); return true; }
          const r = await pcs("pcs_period_save", body);
          if (!r.success) { toast(r.error || "บันทึกไม่สำเร็จ", false); return true; }
          toast(p ? "แก้ไขงวดเรียบร้อย" : "เปิดงวด " + r.periodNo + " เรียบร้อย");
          await openPeriod(r.periodNo || (p && p.periodNo));
        });
      }

      // ================= รายละเอียดงวด =================
      let cur = null;           // { period, advances, expenses }
      let draft = [];           // บรรทัดที่กรอกแล้วแต่ยังไม่บันทึก
      let draftBatch = null;    // รหัสอ้างอิงการบันทึก (กันบันทึกซ้ำเมื่อกดซ้ำ/เน็ตหลุด) — เปลี่ยนใหม่เมื่อรายการในตารางเปลี่ยน
      const draftKey = () => "ktw_pcs_draft_" + (cur ? cur.period.periodNo : "");
      function persistDraft() { try { if (draft.length) localStorage.setItem(draftKey(), JSON.stringify(draft)); else localStorage.removeItem(draftKey()); } catch (e) {} }
      function restoreDraft() { draftBatch = null; try { const d = JSON.parse(localStorage.getItem(draftKey()) || "[]"); draft = Array.isArray(d) ? d : []; } catch (e) { draft = []; } }

      async function openPeriod(periodNo, keepScroll) {
        const r = await pcs("pcs_period_detail", { periodNo });
        if (!r.success) { toast(r.error || "โหลดงวดไม่สำเร็จ", false); return; }
        const switching = !cur || cur.period.periodNo !== periodNo;
        cur = { period: r.period, advances: r.advances || [], expenses: (r.expenses || []).map((e) => Object.assign(e, { catId: +e.catId, amount: Number(e.amount) })) };
        if (switching) restoreDraft();
        if (!cur.period.canEdit) draft = [];
        $("listView").classList.add("hidden"); $("periodView").classList.remove("hidden");
        const url = new URL(location.href); url.searchParams.set("period", periodNo); history.replaceState(null, "", url);
        renderPeriod();
        if (switching && !keepScroll) window.scrollTo(0, 0);
      }
      function backToList() {
        if (draft.length) { openModal("ยังมีรายการที่ไม่ได้บันทึก", `<p class="text-sm text-slate-600">มี ${draft.length} บรรทัดที่กรอกไว้แต่ยังไม่บันทึก ระบบจะจำไว้ให้ในเครื่องนี้ กลับมาที่งวดนี้แล้วกดบันทึกได้</p>`, "กลับไปรายการงวด", () => { doBack(); }); return; }
        doBack();
      }
      function doBack() {
        cur = null; draft = [];
        const url = new URL(location.href); url.searchParams.delete("period"); history.replaceState(null, "", url);
        $("periodView").classList.add("hidden"); $("listView").classList.remove("hidden"); loadPeriods();
      }

      const sumAdv = () => cur.advances.reduce((s, a) => s + Number(a.amount || 0), 0);
      const sumExp = () => cur.expenses.reduce((s, e) => s + Number(e.amount || 0), 0);
      const sumDraft = () => draft.reduce((s, e) => s + Number(e.amount || 0), 0);

      function renderPeriod() {
        const p = cur.period;
        $("pvNo").textContent = p.periodNo;
        $("pvStatus").innerHTML = statusBadge(p.status);
        $("pvSub").innerHTML = `ช่วงวันที่ <b>${rangeText(p)}</b> · ผู้ถือเงิน <b>${esc(p.custodianName || p.custodianEmpId)}</b>${p.remark ? " · " + esc(p.remark) : ""}${p.status === "ปิดงวด" && p.closedAt ? ` · ปิดงวดโดย ${esc(p.closedByName || p.closedByEmpId || "")}` : ""}`;
        const btn = (label, icon, fn, cls) => `<button onclick="${fn}" class="h-9 px-3 rounded-lg text-sm font-medium inline-flex items-center gap-1.5 ${cls || "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}"><i data-lucide="${icon}" class="w-4 h-4"></i> ${label}</button>`;
        $("pvActions").innerHTML = [
          p.canEdit ? btn("แก้ไขงวด", "pencil", "openPeriodModal(true)") : "",
          btn("สร้างเอกสารขอเบิก", "file-plus-2", "openRequestDoc()", "bg-brand-500 text-white hover:bg-brand-600 shadow-md shadow-brand-500/10"),
          btn("พิมพ์", "printer", "printPeriod()"),
          btn("Export CSV", "file-down", "exportCsv()"),
          p.canEdit && !cur.expenses.length && !cur.advances.length ? btn("ลบงวด", "trash-2", "deletePeriod()", "border border-red-200 bg-white text-red-600 hover:bg-red-50") : "",
          p.canClose ? btn("ปิดงวด / สรุปยอด", "lock", "closePeriod()", "bg-slate-800 text-white hover:bg-slate-900") : "",
          p.canReopen ? btn("เปิดงวดอีกครั้ง", "unlock", "reopenPeriod()", "border border-amber-300 bg-white text-amber-700 hover:bg-amber-50") : "",
        ].join("");

        $("advForm").classList.toggle("hidden", !p.canAdvance);
        $("entryBar").classList.toggle("hidden", !p.canEdit);
        const dflt = clampDate(todayIso());
        if (!$("aDate").value || !p.canAdvance) $("aDate").value = dflt;
        if (!$("eDate").value) $("eDate").value = dflt;
        $("aDate").min = $("eDate").min = p.startDate; $("aDate").max = $("eDate").max = p.endDate || "";

        renderSummary(); renderAdvances(); renderLedger(); fillDatalists();
        $("printFoot").textContent = `พิมพ์เมื่อ ${thDate(todayIso())} · ${p.periodNo} · KTW Inventory System`;
        lucide.createIcons();
      }
      function clampDate(d) { const p = cur.period; if (d < p.startDate) return p.startDate; if (p.endDate && d > p.endDate) return p.endDate; return d; }

      function renderSummary() {
        const p = cur.period, adv = sumAdv(), exp = sumExp(), bal = Number(p.openingBalance || 0) + adv - exp;
        const box = (label, val, color, sub, big) => `<div class="bg-white border ${big ? "border-2 border-" + color + "-300" : "border-slate-200"} rounded-2xl p-4 shadow-sm"><div class="text-xs font-semibold text-slate-500">${label}</div><div class="text-2xl font-bold text-${color}-600 mt-1 tabular-nums">${val}</div>${sub ? `<div class="text-[11px] text-slate-400 mt-0.5">${sub}</div>` : ""}</div>`;
        const dr = draft.length ? `ยังไม่รวม ${draft.length} บรรทัดที่ยังไม่บันทึก (${money(sumDraft())})` : "";
        $("pvSummary").innerHTML =
          box("ยอดยกมา", money(p.openingBalance), "slate", "จากงวดก่อน") +
          box("เบิก", money(adv), "emerald", `${cur.advances.length} ครั้ง`) +
          box("จ่าย", money(exp), "red", dr || `${cur.expenses.length} รายการ`) +
          box(p.status === "ปิดงวด" ? "คงเหลือ (ยกไปงวดถัดไป)" : "คงเหลือ", money(bal), bal < 0 ? "red" : "blue", bal < 0 ? "ยอดจ่ายเกินเงินที่มี — ตรวจสอบหรือบันทึกการเบิกเพิ่ม" : "ยกมา + เบิก − จ่าย", true);
        // สรุปตามประเภท (เหมือนแถว "รวม" ในสมุด)
        const byCat = {}; cur.expenses.forEach((e) => (byCat[e.catId] = (byCat[e.catId] || 0) + e.amount));
        const cols = ledgerCats();
        $("pvCatSummary").innerHTML = `<div class="text-xs font-semibold text-slate-500 mb-2">สรุปรายจ่ายตามประเภท</div>
          <div class="flex flex-wrap gap-2">${cols.map((c) => `<div class="rounded-xl border border-slate-200 px-3 py-2 min-w-[120px]"><div class="text-[11px] text-slate-500">${esc(c.catName)}</div><div class="text-base font-bold tabular-nums ${byCat[c.catId] ? "text-slate-800" : "text-slate-300"}">${money(byCat[c.catId] || 0)}</div></div>`).join("")}
          <div class="rounded-xl border-2 border-red-200 bg-red-50 px-3 py-2 min-w-[120px]"><div class="text-[11px] text-red-600 font-semibold">รวมจ่ายทั้งหมด</div><div class="text-base font-bold tabular-nums text-red-700">${money(exp)}</div></div></div>`;
      }

      function renderAdvances() {
        const p = cur.period;
        $("advTotal").textContent = "รวมเบิก " + money(sumAdv());
        $("advBody").innerHTML = cur.advances.length ? cur.advances.map((a) => `
          <tr><td class="px-4 py-2">${thShort(a.advanceDate)}</td><td class="px-4 py-2 num font-semibold text-emerald-700">${money(a.amount)}</td>
            <td class="px-4 py-2">${esc(a.refNo || "")}</td><td class="px-4 py-2 text-slate-600">${esc(a.note || "")}</td>
            <td class="px-4 py-2 text-xs text-slate-500">${esc(a.createdByName || a.createdByEmpId)}</td>
            <td class="px-4 py-2 col-act no-print text-right whitespace-nowrap">${p.canAdvance ? `<button onclick="editAdvance(${a.advanceId})" class="p-1.5 rounded-md text-slate-400 hover:text-orange-600 hover:bg-orange-50" title="แก้ไข"><i data-lucide="pencil" class="w-3.5 h-3.5"></i></button><button onclick="deleteAdvance(${a.advanceId})" class="p-1.5 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50" title="ลบ"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>` : ""}</td></tr>`).join("")
          : `<tr><td colspan="6" class="px-4 py-4 text-center text-xs text-slate-400">ยังไม่มีการเบิกเงินในงวดนี้</td></tr>`;
      }

      // คอลัมน์ประเภทในสมุด: ประเภทที่ใช้งานอยู่ + ประเภทที่ปิดไปแล้วแต่ยังมีรายการในงวดนี้
      function ledgerCats() {
        const used = new Set([...cur.expenses, ...draft].map((e) => +e.catId));
        return cats.filter((c) => c.isActive || used.has(c.catId)).concat([...used].filter((id) => !cats.some((c) => c.catId === id)).map((id) => ({ catId: id, catName: catName(id) })));
      }

      function renderLedger() {
        const p = cur.period, cols = ledgerCats(), q = $("ledgerQ").value.trim().toLowerCase();
        const match = (e) => !q || [e.description, e.refNo, e.payeeName, e.remark, catName(e.catId)].some((v) => String(v || "").toLowerCase().includes(q));
        const rows = cur.expenses.filter(match).map((e) => Object.assign({ _saved: true }, e))
          .concat(draft.map((e, i) => Object.assign({ _draft: i }, e)).filter(match))
          .sort((a, b) => a.expDate.localeCompare(b.expDate) || (a._draft !== undefined) - (b._draft !== undefined) || (a.expenseId || 0) - (b.expenseId || 0));
        const nc = 3 + cols.length + 3;
        let html = `<thead><tr class="bg-slate-50/75 border-b border-slate-200 text-xs font-semibold text-slate-500">
          <th class="w-24">วันที่</th><th class="min-w-[240px]">รายการ</th><th class="w-32">เลขที่อ้างอิง</th>
          ${cols.map((c) => `<th class="num w-24 whitespace-normal leading-tight">${esc(c.catName)}</th>`).join("")}
          <th class="w-36">ผู้รับเงิน</th><th class="w-40">หมายเหตุ</th><th class="w-20 col-act no-print"></th></tr></thead><tbody class="divide-y divide-slate-100">`;
        if (!rows.length) html += `<tr><td colspan="${nc}" class="py-8 text-center text-xs text-slate-400">${q ? "ไม่พบรายการที่ค้นหา" : "ยังไม่มีรายการจ่ายในงวดนี้"}</td></tr>`;
        const totals = {}, totalRow = (label, t, cls) => {
          const s = cols.reduce((x, c) => x + (t[c.catId] || 0), 0);
          return `<tr class="${cls}"><td colspan="3" class="text-right whitespace-nowrap">${label} <span class="ml-3 tabular-nums">= ${money(s)}</span></td>${cols.map((c) => `<td class="num">${moneyOrBlank(t[c.catId])}</td>`).join("")}<td colspan="3"></td></tr>`;
        };
        let i = 0;
        while (i < rows.length) {
          const d = rows[i].expDate, day = {};
          let first = true;
          for (; i < rows.length && rows[i].expDate === d; i++) {
            const e = rows[i], isDraft = e._draft !== undefined;
            day[e.catId] = (day[e.catId] || 0) + Number(e.amount); totals[e.catId] = (totals[e.catId] || 0) + Number(e.amount);
            const act = isDraft
              ? `<button onclick="removeDraft(${e._draft})" class="p-1.5 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50" title="เอาออก"><i data-lucide="x" class="w-3.5 h-3.5"></i></button>`
              : p.canEdit ? `<button onclick="editExpense(${e.expenseId})" class="p-1.5 rounded-md text-slate-400 hover:text-orange-600 hover:bg-orange-50" title="แก้ไข"><i data-lucide="pencil" class="w-3.5 h-3.5"></i></button><button onclick="deleteExpense(${e.expenseId})" class="p-1.5 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50" title="ลบ"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>` : "";
            html += `<tr class="${isDraft ? "draft" : "hover:bg-slate-50/60"}">
              <td class="whitespace-nowrap ${first ? "font-semibold" : "text-slate-300"}">${thShort(d)}</td>
              <td>${esc(e.description)}${isDraft ? ' <span class="ml-1 whitespace-nowrap text-[10px] font-semibold text-amber-700 bg-amber-100 rounded px-1.5 py-0.5">ยังไม่บันทึก</span>' : ""}</td>
              <td class="font-mono text-xs text-slate-600">${esc(e.refNo || "")}</td>
              ${cols.map((c) => `<td class="num">${c.catId === +e.catId ? money(e.amount) : ""}</td>`).join("")}
              <td>${esc(e.payeeName || "")}</td><td class="text-xs text-slate-500">${esc(e.remark || "")}</td>
              <td class="col-act no-print text-right whitespace-nowrap">${act}</td></tr>`;
            first = false;
          }
          html += totalRow(`รวมวันที่ ${thShort(d)}`, day, "day-total");
        }
        if (rows.length) html += totalRow(q ? "รวม (เฉพาะที่ค้นหา)" : `รวมทั้งงวด ${rangeText(p)}`, totals, "grand-total");
        html += "</tbody>";
        $("ledger").innerHTML = html;
        $("draftBar").classList.toggle("hidden", !draft.length);
        $("draftInfo").textContent = `ยังไม่บันทึก ${draft.length} บรรทัด รวม ${money(sumDraft())} บาท`;
        lucide.createIcons();
      }

      function fillDatalists() {
        const uniq = (arr) => [...new Set(arr.filter(Boolean))].slice(0, 200);
        $("dlDesc").innerHTML = uniq(cur.expenses.map((e) => e.description).reverse()).map((v) => `<option value="${esc(v)}"></option>`).join("");
        $("dlPayee").innerHTML = uniq(cur.expenses.map((e) => e.payeeName).reverse()).map((v) => `<option value="${esc(v)}"></option>`).join("");
      }

      // ================= กรอกรายจ่าย (draft) =================
      function readEntry() {
        return { expDate: $("eDate").value, description: $("eDesc").value.trim(), refNo: $("eRef").value.trim(), catId: +$("eCat").value, amount: r2($("eAmt").value), payeeName: $("ePayee").value.trim(), remark: "" };
      }
      function checkLine(e) {
        const p = cur.period;
        if (!e.expDate) return "กรุณาระบุวันที่";
        if (e.expDate < p.startDate || (p.endDate && e.expDate > p.endDate)) return `วันที่ต้องอยู่ในช่วงงวด (${rangeText(p)})`;
        if (!e.description) return "กรุณาระบุรายการ";
        if (!(e.catId > 0)) return "กรุณาเลือกประเภท";
        if (!(e.amount > 0)) return "จำนวนเงินต้องมากกว่า 0";
        return "";
      }
      function addDraft() {
        const e = readEntry(), err = checkLine(e);
        if (err) { showNotification("ข้อมูลยังไม่ครบ", err, "warning"); (e.description ? (e.amount > 0 ? $("eDate") : $("eAmt")) : $("eDesc")).focus(); return; }
        draft.push(e); draftBatch = null; persistDraft();
        $("eDesc").value = ""; $("eRef").value = ""; $("eAmt").value = ""; $("eDesc").focus();
        renderLedger(); renderSummary();
      }
      function removeDraft(i) { draft.splice(i, 1); draftBatch = null; persistDraft(); renderLedger(); renderSummary(); }
      function clearDraft() { openModal("ล้างรายการที่ยังไม่บันทึก", `<p class="text-sm text-slate-600">ต้องการล้าง ${draft.length} บรรทัดที่ยังไม่บันทึกใช่หรือไม่</p>`, "ล้าง", () => { draft = []; persistDraft(); renderLedger(); renderSummary(); }, true); }
      ["eDate", "eDesc", "eRef", "eCat", "eAmt", "ePayee"].forEach((id) => $(id).addEventListener("keydown", (ev) => { if (ev.key === "Enter" && !ev.isComposing) { ev.preventDefault(); addDraft(); } }));
      async function saveDraft() {
        if (!draft.length) return;
        const b = $("btnSaveDraft"); b.disabled = true; b.classList.add("opacity-60");
        const n = draft.length;
        if (!draftBatch) draftBatch = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3 | 8)).toString(16); });
        const r = await pcs("pcs_expense_save", { op: "add", periodNo: cur.period.periodNo, items: draft, batchId: draftBatch });
        b.disabled = false; b.classList.remove("opacity-60");
        if (!r.success) { toast(r.error || "บันทึกไม่สำเร็จ", false); return; }
        draft = []; draftBatch = null; persistDraft(); toast(`บันทึกรายจ่าย ${n} รายการเรียบร้อย`);
        await openPeriod(cur.period.periodNo, true);
      }
      window.addEventListener("beforeunload", (e) => { if (draft.length) { persistDraft(); } });

      // ================= แก้ไข / ลบรายจ่าย =================
      const catOptions = (sel) => cats.filter((c) => c.isActive || c.catId === sel).map((c) => `<option value="${c.catId}" ${c.catId === sel ? "selected" : ""}>${esc(c.catName)}</option>`).join("");
      function editExpense(id) {
        const e = cur.expenses.find((x) => x.expenseId === id); if (!e) return;
        openModal("แก้ไขรายการจ่าย", `
          <div class="grid grid-cols-2 gap-3">
            ${fld("วันที่", `<input id="xDate" type="date" class="${inCls}" value="${e.expDate}" min="${cur.period.startDate}" max="${cur.period.endDate || ""}" />`)}
            ${fld("ประเภท", `<select id="xCat" class="${inCls}">${catOptions(e.catId)}</select>`)}
          </div>
          ${fld("รายการ", `<input id="xDesc" maxlength="300" class="${inCls}" value="${esc(e.description)}" />`)}
          <div class="grid grid-cols-2 gap-3">
            ${fld("เลขที่ / ทะเบียน", `<input id="xRef" maxlength="50" class="${inCls}" value="${esc(e.refNo || "")}" />`)}
            ${fld("จำนวนเงิน", `<input id="xAmt" type="number" min="0" step="0.01" class="${inCls} text-right" value="${r2(e.amount)}" />`)}
          </div>
          ${fld("ผู้รับเงิน", `<input id="xPayee" maxlength="100" class="${inCls}" value="${esc(e.payeeName || "")}" />`)}
          ${fld("หมายเหตุ", `<input id="xRemark" maxlength="300" class="${inCls}" value="${esc(e.remark || "")}" />`)}`, "บันทึก", async () => {
          const item = { expDate: $("xDate").value, description: $("xDesc").value.trim(), refNo: $("xRef").value.trim(), catId: +$("xCat").value, amount: r2($("xAmt").value), payeeName: $("xPayee").value.trim(), remark: $("xRemark").value.trim() };
          const err = checkLine(item); if (err) { showNotification("ข้อมูลไม่ถูกต้อง", err, "warning"); return true; }
          const r = await pcs("pcs_expense_save", { op: "edit", expenseId: id, item });
          if (!r.success) { toast(r.error || "บันทึกไม่สำเร็จ", false); return true; }
          toast("แก้ไขรายการเรียบร้อย"); await openPeriod(cur.period.periodNo, true);
        });
      }
      function deleteExpense(id) {
        const e = cur.expenses.find((x) => x.expenseId === id); if (!e) return;
        openModal("ลบรายการจ่าย", `<p class="text-sm text-slate-600">ลบรายการ <b>${esc(e.description)}</b> วันที่ ${thShort(e.expDate)} จำนวน <b>${money(e.amount)}</b> บาท ใช่หรือไม่</p>`, "ลบรายการ", async () => {
          const r = await pcs("pcs_expense_save", { op: "delete", expenseId: id });
          if (!r.success) { toast(r.error || "ลบไม่สำเร็จ", false); return true; }
          toast("ลบรายการเรียบร้อย"); await openPeriod(cur.period.periodNo, true);
        }, true);
      }

      // ================= เบิกเงิน =================
      async function addAdvance() {
        const body = { op: "add", periodNo: cur.period.periodNo, advanceDate: $("aDate").value, amount: r2($("aAmt").value), refNo: $("aRef").value.trim(), note: $("aNote").value.trim() };
        if (!body.advanceDate) return showNotification("ข้อมูลยังไม่ครบ", "กรุณาระบุวันที่เบิก", "warning");
        if (!(body.amount > 0)) { $("aAmt").focus(); return showNotification("ข้อมูลยังไม่ครบ", "จำนวนเงินเบิกต้องมากกว่า 0", "warning"); }
        const b = $("aBtn"); b.disabled = true;
        const r = await pcs("pcs_advance_save", body); b.disabled = false;
        if (!r.success) return toast(r.error || "บันทึกไม่สำเร็จ", false);
        $("aAmt").value = ""; $("aRef").value = ""; $("aNote").value = "";
        toast(`บันทึกการเบิก ${money(body.amount)} บาท เรียบร้อย`); await openPeriod(cur.period.periodNo, true);
      }
      function editAdvance(id) {
        const a = cur.advances.find((x) => x.advanceId === id); if (!a) return;
        openModal("แก้ไขการเบิกเงิน", `
          <div class="grid grid-cols-2 gap-3">
            ${fld("วันที่เบิก", `<input id="yDate" type="date" class="${inCls}" value="${a.advanceDate}" min="${cur.period.startDate}" max="${cur.period.endDate || ""}" />`)}
            ${fld("จำนวนเงิน", `<input id="yAmt" type="number" min="0" step="0.01" class="${inCls} text-right" value="${r2(a.amount)}" />`)}
          </div>
          ${fld("เลขที่ใบเบิก / เช็ค", `<input id="yRef" maxlength="50" class="${inCls}" value="${esc(a.refNo || "")}" />`)}
          ${fld("หมายเหตุ", `<input id="yNote" maxlength="300" class="${inCls}" value="${esc(a.note || "")}" />`)}`, "บันทึก", async () => {
          const r = await pcs("pcs_advance_save", { op: "edit", advanceId: id, advanceDate: $("yDate").value, amount: r2($("yAmt").value), refNo: $("yRef").value.trim(), note: $("yNote").value.trim() });
          if (!r.success) { toast(r.error || "บันทึกไม่สำเร็จ", false); return true; }
          toast("แก้ไขการเบิกเรียบร้อย"); await openPeriod(cur.period.periodNo, true);
        });
      }
      function deleteAdvance(id) {
        const a = cur.advances.find((x) => x.advanceId === id); if (!a) return;
        openModal("ลบการเบิกเงิน", `<p class="text-sm text-slate-600">ลบการเบิก <b>${money(a.amount)}</b> บาท วันที่ ${thShort(a.advanceDate)} ใช่หรือไม่</p>`, "ลบ", async () => {
          const r = await pcs("pcs_advance_save", { op: "delete", advanceId: id });
          if (!r.success) { toast(r.error || "ลบไม่สำเร็จ", false); return true; }
          toast("ลบการเบิกเรียบร้อย"); await openPeriod(cur.period.periodNo, true);
        }, true);
      }

      // ================= ปิดงวด / เปิดอีกครั้ง / ลบ =================
      function closePeriod() {
        if (draft.length) return showNotification("ยังมีรายการที่ไม่ได้บันทึก", "กรุณาบันทึกหรือล้างบรรทัดที่ยังไม่บันทึกก่อนปิดงวด", "warning");
        const p = cur.period, adv = sumAdv(), exp = sumExp(), bal = Number(p.openingBalance || 0) + adv - exp;
        const last = [...cur.expenses.map((e) => e.expDate), ...cur.advances.map((a) => a.advanceDate)].sort().pop();
        const end = last && last > todayIso() ? last : (todayIso() < p.startDate ? p.startDate : todayIso());
        openModal("ปิดงวด " + p.periodNo, `
          ${fld("วันสิ้นสุดงวด", `<input id="cEnd" type="date" class="${inCls}" value="${end}" min="${last || p.startDate}" />`, last ? "ต้องไม่ก่อนวันที่ของรายการล่าสุด (" + thShort(last) + ")" : "")}
          <div class="rounded-xl border border-slate-200 p-4 text-sm space-y-1.5">
            <div class="flex justify-between"><span>ยอดยกมา</span><span class="tabular-nums">${money(p.openingBalance)}</span></div>
            <div class="flex justify-between text-emerald-700"><span>เบิก</span><span class="tabular-nums">${money(adv)}</span></div>
            <div class="flex justify-between text-red-700"><span>จ่าย</span><span class="tabular-nums">${money(exp)}</span></div>
            <div class="flex justify-between font-bold text-base border-t border-slate-200 pt-1.5"><span>คงเหลือยกไปงวดถัดไป</span><span class="tabular-nums ${bal < 0 ? "text-red-600" : "text-blue-700"}">${money(bal)}</span></div>
          </div>
          <p class="text-[11px] text-slate-400">หลังปิดงวดจะแก้ไขรายการไม่ได้ ยอดคงเหลือจะถูกยกไปเป็นยอดยกมาของงวดถัดไปอัตโนมัติ</p>`, "ปิดงวด", async () => {
          const r = await pcs("pcs_period_close", { op: "close", periodNo: p.periodNo, endDate: $("cEnd").value });
          if (!r.success) { toast(r.error || "ปิดงวดไม่สำเร็จ", false); return true; }
          toast("ปิดงวดเรียบร้อย คงเหลือ " + money(bal)); await openPeriod(p.periodNo, true);
        });
      }
      function reopenPeriod() {
        const p = cur.period;
        openModal("เปิดงวดอีกครั้ง", `<p class="text-sm text-slate-600">เปิดงวด <b>${esc(p.periodNo)}</b> ให้แก้ไขได้อีกครั้ง? ยอดคงเหลือที่สรุปไว้จะถูกล้าง และต้องปิดงวดใหม่หลังแก้ไข</p>`, "เปิดงวดอีกครั้ง", async () => {
          const r = await pcs("pcs_period_close", { op: "reopen", periodNo: p.periodNo });
          if (!r.success) { toast(r.error || "ไม่สำเร็จ", false); return true; }
          toast("เปิดงวดอีกครั้งเรียบร้อย"); await openPeriod(p.periodNo, true);
        });
      }
      function deletePeriod() {
        const p = cur.period;
        openModal("ลบงวด", `<p class="text-sm text-slate-600">ลบงวด <b>${esc(p.periodNo)}</b> (ยังไม่มีรายการ) ใช่หรือไม่</p>`, "ลบงวด", async () => {
          const r = await pcs("pcs_period_save", { op: "delete", periodNo: p.periodNo });
          if (!r.success) { toast(r.error || "ลบไม่สำเร็จ", false); return true; }
          toast("ลบงวดเรียบร้อย"); draft = []; persistDraft(); doBack();
        }, true);
      }

      // ================= เอกสารขอเบิกเงินสดย่อย (ใบขอเบิก — พิมพ์เพื่อเสนออนุมัติ) =================
      // ค่าเริ่มต้น = เบิกชดเชยตามยอดที่จ่ายไปในงวด (เหมือนสมุด: จ่าย 16,999 → ขอเบิกคืน 16,999)
      function bahtText(num) {
        const D = ["", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า"], P = ["", "สิบ", "ร้อย", "พัน", "หมื่น", "แสน"];
        const part = (s) => {
          let out = "";
          if (s.length > 6) { out += part(s.slice(0, -6)) + "ล้าน"; s = s.slice(-6); }
          const n = s.length;
          for (let i = 0; i < n; i++) {
            const d = +s[i], pos = n - i - 1; if (!d) continue;
            if (pos === 0 && d === 1 && n > 1) out += "เอ็ด";
            else if (pos === 1 && d === 2) out += "ยี่";
            else if (pos === 1 && d === 1) out += "";
            else out += D[d];
            out += P[pos];
          }
          return out;
        };
        const [b, s] = r2(Math.abs(num)).toFixed(2).split(".");
        const baht = b.replace(/^0+/, ""), sat = s.replace(/^0+/, "");
        return (num < 0 ? "ลบ" : "") + (baht ? part(baht) + "บาท" : sat ? "" : "ศูนย์บาท") + (sat ? part(sat) + "สตางค์" : "ถ้วน");
      }
      function openRequestDoc() {
        const p = cur ? cur.period : null, exp = cur ? sumExp() : 0, nExp = cur ? cur.expenses.length : 0;
        const html = `
          <div class="grid grid-cols-2 gap-3">
            ${fld("วันที่เอกสาร", `<input id="rqDate" type="date" class="${inCls}" value="${todayIso()}" />`)}
            ${fld("จำนวนเงินขอเบิก (บาท) <span class=\"text-red-500\">*</span>", `<input id="rqAmt" type="number" min="0" step="0.01" class="${inCls} text-right" value="${r2(exp) || ""}" oninput="$('rqWords').textContent = Number(this.value) > 0 ? '(' + bahtText(Number(this.value)) + ')' : ''" />`)}
          </div>
          <p id="rqWords" class="text-xs text-slate-500 -mt-2 text-right">${exp > 0 ? "(" + bahtText(exp) + ")" : ""}</p>
          ${fld("วัตถุประสงค์", `<input id="rqPurpose" maxlength="200" class="${inCls}" value="${exp > 0 && p ? `เบิกชดเชยเงินสดย่อย ตามรายการจ่ายช่วง ${rangeText(p)}` : "เบิกเงินสดย่อยเพื่อใช้จ่ายหน้างาน"}" />`)}
          ${fld("ผู้ขอเบิก", `<input id="rqName" maxlength="100" class="${inCls}" value="${esc((p && p.custodianName) || sessionStorage.getItem("name") || "")}" />`)}
          ${p ? `<label class="flex items-center gap-2 text-sm"><input id="rqItems" type="checkbox" class="accent-brand-500" ${nExp ? "checked" : "disabled"} /> แนบรายการจ่ายในงวด ${esc(p.periodNo)} (${nExp} รายการ)</label>` : `<input id="rqItems" type="hidden" /><p class="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">ยังไม่มีงวดที่เปิดอยู่ — เอกสารนี้จะไม่มีรายการจ่ายแนบ (เปิดงวดและบันทึกรายจ่ายก่อน ถ้าต้องการแนบรายการ)</p>`}
          <p class="text-[11px] text-slate-400">ระบบจะเปิดเอกสารในหน้าต่างใหม่เพื่อพิมพ์/บันทึกเป็น PDF และเตรียมยอดไว้ในช่อง "บันทึกการเบิก" ให้ — เมื่อได้รับเงินแล้วกดบันทึกการเบิกได้ทันที</p>`;
        openModal("สร้างเอกสารขอเบิกเงินสดย่อย", html, "สร้างเอกสาร", () => {
          const amt = r2($("rqAmt").value);
          if (!(amt > 0)) { showNotification("ข้อมูลยังไม่ครบ", "จำนวนเงินขอเบิกต้องมากกว่า 0", "warning"); return true; }
          const w = window.open("", "_blank");
          if (!w) { showNotification("เปิดหน้าต่างไม่ได้", "กรุณาอนุญาต Pop-up สำหรับเว็บไซต์นี้", "warning"); return true; }
          w.document.open();
          w.document.write(buildRequestDoc({ date: $("rqDate").value || todayIso(), amount: amt, purpose: $("rqPurpose").value.trim(), name: $("rqName").value.trim(), withItems: !!(p && $("rqItems").checked) }));
          w.document.close();
          if (p && p.canAdvance) { $("aAmt").value = amt; $("aRef").value = ""; $("aNote").value = "ตามเอกสารขอเบิกวันที่ " + thShort($("rqDate").value || todayIso()); }
        });
      }
      // ปุ่มบนหน้ารายการงวด: ถ้ามีงวดของฉันที่เปิดอยู่ ใช้ยอดของงวดนั้น — ไม่มีก็ออกใบขอเบิกเดี่ยว (กรอกยอดเอง)
      async function openRequestFromList() {
        const mine = periods.find((p) => p.status === "เปิด" && p.custodianEmpId === empId);
        if (mine) await openPeriod(mine.periodNo);
        openRequestDoc();
      }
      function onNewPeriodClick() {
        if (!can("RECORD")) return showNotification("ยังไม่มีสิทธิ์เปิดงวด", "ต้องมีสิทธิ์ PCS \"เปิดงวด + บันทึกรายจ่าย\" — ติดต่อผู้ดูแลระบบ (หรือยังไม่ได้ติดตั้ง SQL/n8n ของระบบนี้)", "warning");
        openPeriodModal();
      }
      function buildRequestDoc(o) {
        const p = cur ? cur.period : null, cols = cur ? ledgerCats() : [], byCat = {};
        if (cur) cur.expenses.forEach((e) => (byCat[e.catId] = (byCat[e.catId] || 0) + e.amount));
        const exp = cur ? sumExp() : 0, adv = cur ? sumAdv() : 0, bal = p ? Number(p.openingBalance || 0) + adv - exp : 0;
        const pNo = p ? p.periodNo : "-";
        const items = o.withItems ? cur.expenses.map((e, i) => `<tr><td class="c">${i + 1}</td><td class="c">${thShort(e.expDate)}</td><td>${esc(e.description)}</td><td class="c">${esc(e.refNo || "")}</td><td>${esc(catName(e.catId))}</td><td class="r">${money(e.amount)}</td><td>${esc(e.payeeName || "")}</td></tr>`).join("") : "";
        const sig = (t) => `<div class="sig"><div class="line"></div><div>(.........................................)</div><div class="t">${t}</div><div>วันที่ ........../........../..........</div></div>`;
        return `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>ใบขอเบิกเงินสดย่อย ${esc(pNo)}</title>
<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  @page { size: A4; margin: 14mm; }
  body { font-family: "Sarabun", "Prompt", sans-serif; color: #111; font-size: 14px; margin: 0; padding: 24px; }
  .bar { display: flex; justify-content: flex-end; gap: 8px; margin-bottom: 12px; }
  .bar button { font: inherit; padding: 6px 14px; border-radius: 8px; border: 1px solid #ccc; background: #fff; cursor: pointer; }
  .bar button.p { background: #f97316; color: #fff; border-color: #f97316; }
  h1 { text-align: center; font-size: 22px; margin: 0 0 2px; } .sub { text-align: center; color: #555; margin-bottom: 18px; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; margin-bottom: 14px; }
  .meta b { display: inline-block; min-width: 110px; }
  .amt { border: 2px solid #111; padding: 10px 14px; margin: 10px 0 16px; display: flex; justify-content: space-between; align-items: center; }
  .amt .n { font-size: 22px; font-weight: 700; } .amt .w { color: #333; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 14px; } th, td { border: 1px solid #999; padding: 4px 6px; vertical-align: top; }
  th { background: #f2f2f2; } .r { text-align: right; white-space: nowrap; } .c { text-align: center; white-space: nowrap; }
  tfoot td { font-weight: 700; background: #fafafa; }
  h3 { font-size: 15px; margin: 14px 0 6px; }
  .sigs { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-top: 40px; text-align: center; font-size: 13px; }
  .sig .line { height: 36px; } .sig .t { font-weight: 600; margin: 2px 0; }
  .foot { margin-top: 18px; font-size: 11px; color: #777; }
  @media print { .bar { display: none; } body { padding: 0; } }
</style></head><body>
<div class="bar"><button onclick="window.close()">ปิด</button><button class="p" onclick="window.print()">พิมพ์ / บันทึก PDF</button></div>
<h1>ใบขอเบิกเงินสดย่อย</h1><div class="sub">KTW Group · Petty Cash Request</div>
<div class="meta">
  <div><b>วันที่</b> ${thDate(o.date)}</div><div><b>อ้างอิงงวด</b> ${esc(pNo)}</div>
  <div><b>ผู้ขอเบิก</b> ${esc(o.name || "-")}</div><div><b>ช่วงวันที่ของงวด</b> ${p ? rangeText(p) : "-"}</div>
  <div style="grid-column: span 2"><b>วัตถุประสงค์</b> ${esc(o.purpose || "-")}</div>
</div>
<div class="amt"><div><div>จำนวนเงินขอเบิก</div><div class="w">(${bahtText(o.amount)})</div></div><div class="n">${money(o.amount)} บาท</div></div>
${p ? `<h3>สรุปเงินสดย่อยของงวด</h3>
<table><tbody>
  <tr><td>ยอดยกมา</td><td class="r">${money(p.openingBalance)}</td><td>เบิกแล้วในงวด</td><td class="r">${money(adv)}</td></tr>
  <tr><td>จ่ายไปแล้ว</td><td class="r">${money(exp)}</td><td><b>คงเหลือ ณ วันที่ขอเบิก</b></td><td class="r"><b>${money(bal)}</b></td></tr>
</tbody></table>
<h3>สรุปรายจ่ายตามประเภท</h3>
<table><thead><tr>${cols.map((c) => `<th>${esc(c.catName)}</th>`).join("")}<th>รวม</th></tr></thead>
<tbody><tr>${cols.map((c) => `<td class="r">${money(byCat[c.catId] || 0)}</td>`).join("")}<td class="r"><b>${money(exp)}</b></td></tr></tbody></table>` : ""}
${o.withItems ? `<h3>รายการจ่าย (${cur.expenses.length} รายการ)</h3>
<table><thead><tr><th>#</th><th>วันที่</th><th>รายการ</th><th>เลขที่อ้างอิง</th><th>ประเภท</th><th>จำนวนเงิน</th><th>ผู้รับเงิน</th></tr></thead>
<tbody>${items}</tbody><tfoot><tr><td colspan="5" class="r">รวม</td><td class="r">${money(exp)}</td><td></td></tr></tfoot></table>` : ""}
<div class="sigs">${sig("ผู้ขอเบิก")}${sig("ผู้ตรวจสอบ")}${sig("ผู้อนุมัติ")}${sig("ผู้จ่ายเงิน / ผู้รับเงิน")}</div>
<div class="foot">พิมพ์จาก KTW Inventory System · ${esc(pNo)} · ${thDate(todayIso())}</div>
</body></html>`;
      }

      // ================= พิมพ์ / Export =================
      function printPeriod() { window.print(); }
      function exportCsv() {
        const p = cur.period, q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`, adv = sumAdv(), exp = sumExp();
        const lines = [["งวด", p.periodNo], ["ช่วงวันที่", rangeText(p)], ["ผู้ถือเงิน", p.custodianName || p.custodianEmpId], [],
          ["ยอดยกมา", r2(p.openingBalance)], ["เบิก", r2(adv)], ["จ่าย", r2(exp)], ["คงเหลือ", r2(Number(p.openingBalance || 0) + adv - exp)], [],
          ["การเบิกเงิน"], ["วันที่", "จำนวนเงิน", "เลขที่อ้างอิง", "หมายเหตุ"],
          ...cur.advances.map((a) => [thShort(a.advanceDate), r2(a.amount), a.refNo, a.note]), [],
          ["รายการจ่าย"], ["วันที่", "รายการ", "เลขที่อ้างอิง", "ประเภท", "จำนวนเงิน", "ผู้รับเงิน", "หมายเหตุ"],
          ...cur.expenses.map((e) => [thShort(e.expDate), e.description, e.refNo, catName(e.catId), r2(e.amount), e.payeeName, e.remark]), [],
          ["สรุปตามประเภท"], ...ledgerCats().map((c) => [c.catName, r2(cur.expenses.filter((e) => e.catId === c.catId).reduce((s, e) => s + e.amount, 0))]), ["รวมจ่าย", r2(exp)]];
        const csv = "﻿" + lines.map((l) => l.map(q).join(",")).join("\r\n");
        const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
        a.download = `${p.periodNo}.csv`; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
      }

      // ================= เริ่มต้น =================
      function toggleMobileMenu() {
        const m = $("mobile-sidebar"), ic = $("mobileMenuBtn");
        const hidden = m.classList.contains("hidden"); m.classList.toggle("hidden", !hidden);
        ic.setAttribute("data-lucide", hidden ? "x" : "menu"); lucide.createIcons();
      }
      function syncSidebar() {
        if (typeof renderSidebar === "function") renderSidebar();
        const mob = $("mobile-sidebar-content"), side = $("sidebar-container");
        if (mob && side) mob.innerHTML = side.innerHTML; lucide.createIcons();
      }

      window.onload = async function () {
        syncSidebar();
        const [ok] = await Promise.all([loadMyPerms(), loadCats()]); syncSidebar();
        if (!ok || !can("VIEW_MENU")) {
          const msg = ok ? "คุณยังไม่มีสิทธิ์ใช้งานระบบบันทึกเงินสดย่อย กรุณาติดต่อผู้ดูแลระบบ" : "เชื่อมต่อระบบเงินสดย่อยไม่ได้ (ยังไม่ได้ติดตั้ง n8n/SQL ของระบบนี้ หรือไม่มีสิทธิ์)";
          $("periodBody").innerHTML = `<tr><td colspan="8" class="px-4 py-10 text-center text-sm text-slate-500">${msg}<div class="text-xs text-slate-400 mt-1">ยังกด "สร้างเอกสารขอเบิกเงินสดย่อย" เพื่อพิมพ์ใบขอเบิกได้</div></td></tr>`;
          $("listStats").innerHTML = ""; $("btnNewPeriod").classList.add("opacity-50"); lucide.createIcons(); return;
        }
        $("btnNewPeriod").classList.toggle("opacity-50", !can("RECORD"));
        $("scopeSel").classList.toggle("hidden", !can("READ_ALL"));
        if (can("READ_ALL") && !can("RECORD")) $("scopeSel").value = "all";
        await loadPeriods(); lucide.createIcons();
        const pq = new URLSearchParams(location.search).get("period");
        if (pq) openPeriod(pq);
      };
