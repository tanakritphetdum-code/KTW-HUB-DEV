// ===================================================================
// modules/borrowService.js — Service Logic สำหรับ KTW HUB
// ===================================================================

      const N8N_BASE = "https://n8n.ktw.co.th/webhook/";
      const empId = sessionStorage.getItem("emp_id") || "";

      // ================= ตัวช่วย =================
      const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
      const escOrDash = (s) => (s === null || s === undefined || s === "" ? '<span class="text-slate-300">-</span>' : esc(s));
      const todayIso = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
      const TH_M = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
      function formatThaiDate(v) { if (!v) return "-"; const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/); if (!m) return esc(v); return `${+m[3]} ${TH_M[+m[2] - 1]} ${+m[1] + 543}`; }
      function formatThaiDateTime(v) { if (!v) return "-"; const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/); if (!m) return formatThaiDate(v); return `${formatThaiDate(v)} ${m[4]}:${m[5]}`; }
      const fmtQty = (n) => Number(n || 0).toLocaleString("th-TH", { maximumFractionDigits: 3 });
      const remainOf = (i) => Number(i.qtyBorrowed) - Number(i.qtyReturned) - Number(i.qtyDamaged) - Number(i.qtyLost);

      async function brw(path, body) {
        try {
          const res = await n8nFetch(N8N_BASE + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
          const text = await res.text(); let j = null;
          try { j = text && text.trim() ? JSON.parse(text) : null; } catch (e) { j = null; }
          if (Array.isArray(j)) j = j[0];
          return j || { success: false, error: "ไม่ได้รับข้อมูลจากเซิร์ฟเวอร์ (HTTP " + res.status + ")" };
        } catch (err) { console.error(path, err); return { success: false, error: "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้" }; }
      }

      function showNotification(title, message, type = "success") {
        const c = document.getElementById("toast-container"); if (!c) return;
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

      // ================= สิทธิ์ (ซ่อน/แสดงปุ่มเท่านั้น — server ตรวจซ้ำทุก endpoint) =================
      let myPerms = new Set();
      const can = (k) => myPerms.has(k);
      async function loadMyPerms() {
        const r = await brw("borrow_my_perms", { actorEmpId: empId });
        myPerms = new Set(r.success ? r.perms || [] : []);
        sessionStorage.setItem("borrow_role", myPerms.has("MANAGE_ROLE") ? "1" : myPerms.has("APPROVE") ? "2" : "0");
        return r.success;
      }

      // ================= สถานะ =================
      const STATUS_COLOR = {
        "รออนุมัติ": "bg-amber-50 text-amber-700 border border-amber-100",
        "กำลังยืม": "bg-blue-50 text-blue-700 border border-blue-100",
        "คืนบางส่วน": "bg-purple-50 text-purple-700 border border-purple-100",
        "คืนแล้ว": "bg-emerald-50 text-emerald-700 border border-emerald-100",
        "ปฏิเสธ": "bg-red-50 text-red-700 border border-red-100",
        "ยกเลิก": "bg-slate-100 text-slate-600 border border-slate-200",
      };
      const isOpenStatus = (s) => s === "กำลังยืม" || s === "คืนบางส่วน";
      const overdueDays = (d) => (isOpenStatus(d.status) && d.dueDate ? Math.floor((new Date(todayIso()) - new Date(String(d.dueDate).slice(0, 10))) / 86400000) : 0);
      // หมายเหตุอัตโนมัติตามกำหนดคืน (เฉพาะเอกสารที่ยังไม่คืนครบ): เกินกำหนด / ครบกำหนดวันนี้ / เหลือ N วัน (แจ้งล่วงหน้า ≤ 3 วัน)
      const DUE_WARN_DAYS = 3;
      function dueNote(d) {
        if (!isOpenStatus(d.status) || !d.dueDate) return null;
        const od = overdueDays(d);
        if (od > 0) return { text: `เกินกำหนดคืน ${od} วัน`, cls: "text-red-600 font-semibold" };
        if (od === 0) return { text: "ครบกำหนดคืนวันนี้", cls: "text-orange-600 font-semibold" };
        if (-od <= DUE_WARN_DAYS) return { text: `เหลือ ${-od} วันครบกำหนดคืนสินค้า`, cls: "text-amber-600 font-medium" };
        return null;
      }
      const noteText = (d) => [dueNote(d)?.text, d.remark].filter(Boolean).join(" ");
      function getStatusBadge(d, showOver = true) {
        const od = overdueDays(d);
        const over = showOver && od > 0 ? `<span class="ml-1 inline-flex items-center whitespace-nowrap rounded-lg px-2 py-1 font-bold bg-red-50 text-red-700 border border-red-100">เลยกำหนด ${od} วัน</span>` : "";
        return `<span class="inline-flex items-center whitespace-nowrap rounded-lg px-2.5 py-1 font-bold ${STATUS_COLOR[d.status] || "bg-slate-50 text-slate-600 border border-slate-100"}">${esc(d.status)}</span>${over}`;
      }

      // ================= รายการเอกสาร: โหลด / กรอง / เรียง =================
      let allDocuments = [];
      let sortCol = "docNo", sortDir = "desc";
      const filters = {};
      let filterCol = null;
      const COLS = [
        ["docNo", "เลขที่เอกสาร", "w-40"], ["borrowerName", "ผู้ขอยืม", ""], ["purpose", "วัตถุประสงค์", "w-36"],
        ["borrowDate", "วันที่ยืม", "w-36"], ["dueDate", "กำหนดคืน", "w-36"], ["note", "หมายเหตุ", "w-64"], ["status", "สถานะ", "w-48"],
      ];

      function buildHead() {
        document.getElementById("docHead").innerHTML = COLS.map(([k, label, w]) => `
          <th class="p-4 ${w}"><div class="flex items-center gap-1">
            <button onclick="sortDocBy('${k}')" class="flex items-center gap-1 hover:text-orange-600 transition-colors"><span>${label}</span><i data-lucide="chevrons-up-down" class="w-3.5 h-3.5 text-slate-400 sort-icon" data-col="${k}"></i></button>
            <button onclick="toggleFilterPop(event,'${k}')" class="filter-toggle-btn h-6 w-6 shrink-0 flex items-center justify-center rounded-md hover:bg-slate-200/60 text-slate-400 transition-colors" data-filter-col="${k}" title="กรองข้อมูล"><i data-lucide="list-filter" class="w-3.5 h-3.5"></i></button>
          </div></th>`).join("") + '<th class="p-4 text-right w-44">จัดการ</th>';
        lucide.createIcons();
      }
      function sortDocBy(c) { if (sortCol === c) sortDir = sortDir === "asc" ? "desc" : "asc"; else { sortCol = c; sortDir = "asc"; } renderDocTable(); }
      function toggleFilterPop(e, col) {
        e.stopPropagation();
        const pop = document.getElementById("filterPop");
        if (filterCol === col && !pop.classList.contains("hidden")) { pop.classList.add("hidden"); return; }
        filterCol = col;
        document.getElementById("filterPopLabel").textContent = "กรอง: " + COLS.find((c) => c[0] === col)[1];
        const inp = document.getElementById("filterPopInput"); inp.value = filters[col] || "";
        const sel = document.getElementById("filterPopSelect"), isStatus = col === "status";
        inp.classList.toggle("hidden", isStatus); sel.classList.toggle("hidden", !isStatus); if (isStatus) sel.value = filters[col] || "";
        const r = e.currentTarget.getBoundingClientRect();
        pop.style.top = r.bottom + 6 + "px"; pop.style.left = Math.min(r.left, window.innerWidth - 240) + "px";
        pop.classList.remove("hidden"); if (!isStatus) inp.focus();
      }
      function onFilterInput(v) { if (!filterCol) return; if (v.trim()) filters[filterCol] = v.trim(); else delete filters[filterCol]; renderDocTable(); }
      function resetDocFilters() { Object.keys(filters).forEach((k) => delete filters[k]); document.getElementById("filterPopInput").value = ""; document.getElementById("filterPopSelect").value = ""; renderDocTable(); }
      document.addEventListener("click", (e) => { if (!e.target.closest("#filterPop") && !e.target.closest(".filter-toggle-btn")) document.getElementById("filterPop").classList.add("hidden"); });

      async function fetchAllDocuments() {
        const icon = document.getElementById("syncIcon"); icon && icon.classList.add("animate-spin");
        const scope = can("READ_ALL") ? "all" : "own";
        document.getElementById("tableTitle").textContent = scope === "all" ? "ประวัติเอกสารยืม-คืนสินค้า แผนกหน้าร้าน (CTS)" : "ประวัติเอกสารยืม-คืนสินค้าของฉัน";
        const r = await brw("borrow_list", { actorEmpId: empId, scope, status: "", q: "" });
        icon && icon.classList.remove("animate-spin");
        if (!r.success) { document.getElementById("docTableBody").innerHTML = `<tr><td colspan="8" class="px-4 py-8 text-center text-sm text-red-500">${esc(r.error || "โหลดข้อมูลไม่สำเร็จ")}</td></tr>`; return; }
        allDocuments = (r.data || []).map((d) => Object.assign(d, { note: noteText(d) }));
        renderDocTable(); loadStatCards();
      }

      async function loadStatCards() {
        const r = await brw("borrow_dashboard", { actorEmpId: empId });
        const c = r.success ? r : {};
        const defs = [["รออนุมัติ", c.pending, "amber"], ["กำลังยืม", c.borrowing, "blue"], ["คืนบางส่วน", c.partial, "purple"], ["เลยกำหนดคืน", c.overdue, "red"], ["ครบกำหนดวันนี้", c.dueToday, "orange"]];
        document.getElementById("statCards").innerHTML = defs.map((d) => `<div class="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm"><div class="text-xs font-semibold text-slate-500">${d[0]}</div><div class="text-2xl font-bold text-${d[2]}-600 mt-1">${d[1] ?? "-"}</div></div>`).join("");
      }

      function applyFilters(docs) {
        const hide = document.getElementById("hideDoneToggle").checked;
        return docs.filter((d) => {
          if (hide && ["คืนแล้ว", "ปฏิเสธ", "ยกเลิก"].includes(d.status)) return false;
          return Object.entries(filters).every(([k, v]) => {
            const val = k === "borrowerName" ? `${d.borrowerName || ""} ${d.borrowerEmpId || ""}` : String(d[k] ?? "");
            return k === "status" ? val === v : val.toLowerCase().includes(v.toLowerCase());
          });
        });
      }
      // รายการสินค้าหลายรายการ: แสดงเรียงลงมาทีละบรรทัด (server คั่นด้วย \n)
      function itemsStack(v) {
        const lines = String(v || "").split("\n").map((x) => x.trim()).filter(Boolean);
        if (!lines.length) return "-";
        return lines.map((l, i) => `<div class="flex gap-1.5 text-xs leading-5"><span class="text-slate-300 shrink-0">${i + 1}.</span><span>${esc(l)}</span></div>`).join("");
      }
      function renderDocTable() {
        const tbody = document.getElementById("docTableBody");
        if (!allDocuments.length) { tbody.innerHTML = '<tr><td colspan="8" class="px-4 py-8 text-center text-sm text-slate-400">ยังไม่มีเอกสาร</td></tr>'; return; }
        let docs = applyFilters(allDocuments).sort((a, b) => { const x = String(a[sortCol] ?? ""), y = String(b[sortCol] ?? ""); const c = x.localeCompare(y, "th", { numeric: true }); return sortDir === "asc" ? c : -c; });
        document.getElementById("resetDocFiltersBtn").classList.toggle("hidden", Object.keys(filters).length === 0);
        document.querySelectorAll(".filter-toggle-btn").forEach((b) => b.classList.toggle("text-orange-600", !!filters[b.dataset.filterCol]));
        document.querySelectorAll(".sort-icon").forEach((i) => i.setAttribute("data-lucide", i.dataset.col === sortCol ? (sortDir === "asc" ? "chevron-up" : "chevron-down") : "chevrons-up-down"));
        if (!docs.length) { tbody.innerHTML = '<tr><td colspan="8" class="px-4 py-8 text-center text-sm text-slate-400">ไม่พบเอกสารที่ตรงกับเงื่อนไขการค้นหา/กรอง</td></tr>'; lucide.createIcons(); return; }
        const ib = (fn, title, icon, hover) => `<button onclick="${fn}" title="${title}" class="p-1.5 rounded-lg text-slate-400 ${hover}"><i data-lucide="${icon}" class="w-4 h-4"></i></button>`;
        tbody.innerHTML = docs.map((d) => {
          const mine = [d.createdByEmpId, d.borrowerEmpId].includes(empId);
          const open = isOpenStatus(d.status);
          const btns = [ib(`viewDocument('${d.docNo}')`, "ดูรายละเอียด", "eye", "hover:bg-slate-100 hover:text-slate-700")];
          if (d.status === "รออนุมัติ") {
            if ((mine && can("UPDATE_OWN")) || can("UPDATE_ANY")) btns.push(ib(`openEditDocModal('${d.docNo}')`, "แก้ไข", "pencil", "hover:bg-blue-50 hover:text-blue-600"));
          }
          if (open && can("RETURN_CONFIRM")) btns.push(ib(`doAction('return','${d.docNo}')`, "บันทึกรับคืน", "package-check", "hover:bg-emerald-50 hover:text-emerald-600"));
          if (open && can("EXTEND_DUE")) btns.push(ib(`doAction('extend','${d.docNo}')`, "ขยายกำหนดคืน", "calendar-plus", "hover:bg-purple-50 hover:text-purple-600"));
          if (["รออนุมัติ", "กำลังยืม"].includes(d.status) && ((mine && can("DELETE_OWN")) || can("DELETE_ANY"))) btns.push(ib(`doAction('cancel','${d.docNo}')`, "ยกเลิกเอกสาร", "trash-2", "hover:bg-red-50 hover:text-red-600"));
          return `<tr class="hover:bg-slate-50/50 transition-colors">
            <td class="p-4 font-mono font-semibold text-slate-900">${esc(d.docNo)}</td>
            <td class="p-4 text-slate-700">${escOrDash(d.borrowerName || d.borrowerEmpId)}<div class="text-[11px] text-slate-400 font-mono">${esc(d.borrowerEmpId || "")}</div></td>
            <td class="p-4 text-slate-900 whitespace-nowrap">${esc(d.purpose)}</td>
            <td class="p-4 text-slate-600 font-light whitespace-nowrap">${formatThaiDate(d.borrowDate)}</td>
            <td class="p-4 whitespace-nowrap ${overdueDays(d) > 0 ? "text-red-600 font-semibold" : "text-slate-600"}">${formatThaiDate(d.dueDate)}</td>
            <td class="p-4 text-xs leading-5">${(() => { const n = dueNote(d); return (n ? `<div class="${n.cls}">${esc(n.text)}</div>` : "") + (d.remark ? `<div class="text-slate-500 break-words">${esc(d.remark)}</div>` : "") || '<span class="text-slate-300">-</span>'; })()}</td>
            <td class="p-4">${getStatusBadge(d, false)}</td>
            <td class="p-4 text-right"><div class="flex items-center justify-end gap-1">${btns.join("")}</div></td></tr>`;
        }).join("");
        lucide.createIcons();
      }

      // ================= สร้าง/แก้ไขเอกสาร =================
      // หน่วยสินค้า: เลือกได้ 2 แบบ (PCS / SET) เหมือนระบบเคลม — ค่าเริ่มต้น PCS
      // เอกสารเก่าที่เคยพิมพ์หน่วยอื่นไว้จะแสดงเป็นตัวเลือกเพิ่มให้ เพื่อไม่ให้ค่าหาย
      const UNIT_CHOICES = ["PCS", "SET"];
      function unitOptionsHtml(current) {
        const cur = String(current || "").trim(), curUp = cur.toUpperCase();
        const legacy = cur && !UNIT_CHOICES.includes(curUp) ? cur : "";
        const selected = legacy ? legacy : UNIT_CHOICES.includes(curUp) ? curUp : "PCS";
        const list = legacy ? [legacy, ...UNIT_CHOICES] : UNIT_CHOICES;
        return list.map((u) => `<option value="${esc(u)}"${u === selected ? " selected" : ""}>${esc(u)}</option>`).join("");
      }
      let autocompleteTimer = null, activeInput = null;
      function addRow(d) {
        d = d || {};
        const tb = document.getElementById("itemBody"), tr = document.createElement("tr");
        const ic = "w-full h-9 px-2 rounded-md border border-slate-200 text-xs focus:ring-1 focus:ring-brand-500 outline-none";
        tr.innerHTML = `<td class="p-2 text-center text-slate-400 text-xs row-no"></td>
          <td class="p-2"><input type="text" class="item-prod-code ${ic} text-center" placeholder="ระบุรหัสสินค้า" autocomplete="off" value="${esc(d.productCode || "")}"></td>
          <td class="p-2"><input type="text" class="item-description ${ic}" placeholder="ชื่อ/รายละเอียดสินค้า" value="${esc(d.productName || "")}"></td>
          <td class="p-2"><input type="number" min="0" step="any" class="item-qty ${ic} text-right" value="${d.qtyBorrowed || d.qty || 1}"></td>
          <td class="p-2"><select class="item-unit ${ic} bg-white">${unitOptionsHtml(d.unit)}</select></td>
          <td class="p-2"><input type="text" class="item-serial ${ic}" value="${esc(d.serialNo || "")}"></td>
          <td class="p-2"><input type="text" class="item-remark ${ic}" value="${esc(d.remark || "")}"></td>
          <td class="p-2"><input type="file" accept="image/*" class="hidden photo-file">
            <button type="button" class="photo-add inline-flex items-center gap-1 h-9 px-2.5 rounded-md border border-dashed border-slate-300 text-xs text-slate-500 hover:border-orange-400 hover:text-orange-600"><i data-lucide="image-plus" class="w-3.5 h-3.5"></i> เพิ่มรูป</button>
            <span class="photo-ctl hidden items-center gap-1"><img class="photo-thumb w-9 h-9 object-cover rounded-md border border-slate-200" alt=""><button type="button" class="photo-view h-8 px-2 rounded-md border border-slate-200 text-xs text-slate-600 hover:bg-slate-50">ดูรูป</button><button type="button" class="photo-del h-8 px-2 rounded-md border border-red-200 text-xs text-red-600 hover:bg-red-50">ลบรูป</button></span></td>
          <td class="p-2 text-center"><button type="button" class="text-slate-300 hover:text-red-500 btn-del" title="ลบแถว"><i data-lucide="trash-2" class="w-4 h-4"></i></button></td>`;
        tr.querySelector(".item-prod-code").addEventListener("input", (e) => handleCodeAutocomplete(e.target));
        tr.querySelector(".btn-del").addEventListener("click", () => { if (tb.rows.length > 1) { tr.remove(); renumber(); } });
        const fi = tr.querySelector(".photo-file");
        tr.querySelector(".photo-add").addEventListener("click", () => fi.click());
        fi.addEventListener("change", async () => { const f = fi.files[0]; fi.value = ""; if (!f) return; try { setRowPhoto(tr, await resizeImage(f), 0); } catch (e) { showNotification("รูปไม่ถูกต้อง", e.message || "ไม่สามารถอ่านรูปนี้ได้", "warning"); } });
        tr.querySelector(".photo-view").addEventListener("click", () => showImage(tr.dataset.photo));
        tr.querySelector(".photo-del").addEventListener("click", () => setRowPhoto(tr, "", 0));
        if (d.photo) setRowPhoto(tr, d.photo, d.lineNum || 0);
        tb.appendChild(tr); renumber(); lucide.createIcons();
      }
      // รูปประจำรายการ: ย่อเป็น JPEG ฝั่งเว็บ (ด้านยาวสุด 1280px) แล้วส่งเป็น data URL; keep = เลขบรรทัดเดิมเมื่อแก้ไขโดยไม่เปลี่ยนรูป
      function setRowPhoto(tr, dataUrl, keepLine) {
        tr.dataset.photo = dataUrl || ""; tr.dataset.keep = keepLine || 0;
        tr.querySelector(".photo-add").classList.toggle("hidden", !!dataUrl);
        const ctl = tr.querySelector(".photo-ctl"); ctl.classList.toggle("hidden", !dataUrl); ctl.classList.toggle("inline-flex", !!dataUrl);
        tr.querySelector(".photo-thumb").src = dataUrl || "";
      }
      function showImage(src) { if (!src) return; document.getElementById("imgModalImg").src = src; document.getElementById("imgModal").classList.remove("hidden"); }
      function resizeImage(file) {
        return new Promise((resolve, reject) => {
          if (!/^image\//.test(file.type)) return reject(new Error("กรุณาเลือกไฟล์รูปภาพ"));
          const fr = new FileReader();
          fr.onerror = () => reject(new Error("อ่านไฟล์ไม่สำเร็จ"));
          fr.onload = () => {
            const im = new Image();
            im.onerror = () => reject(new Error("ไฟล์รูปไม่ถูกต้อง"));
            im.onload = () => {
              let w = im.width, h = im.height; const m = 1280; if (Math.max(w, h) > m) { const k = m / Math.max(w, h); w = Math.round(w * k); h = Math.round(h * k); }
              const c = document.createElement("canvas"); c.width = w; c.height = h; const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, w, h); x.drawImage(im, 0, 0, w, h);
              let q = 0.8, out = c.toDataURL("image/jpeg", q); while (out.length > 580000 && q > 0.3) { q -= 0.1; out = c.toDataURL("image/jpeg", q); }
              if (out.length > 580000) return reject(new Error("รูปใหญ่เกินไป"));
              resolve(out);
            };
            im.src = fr.result;
          };
          fr.readAsDataURL(file);
        });
      }

      // ผู้เกี่ยวข้องกับเอกสาร + วัตถุประสงค์อื่นๆ
      let ctsUsers = null;
      function onPurposeChange() {
        const o = document.querySelector('input[name="purpose"]:checked').value === "อื่นๆ";
        document.getElementById("fPurposeNote").classList.toggle("hidden", !o);
        if (o) document.getElementById("fPurposeNote").focus();
      }
      async function loadCtsUsers() {
        let err = "";
        if (!ctsUsers || !ctsUsers.length) { const r = await brw("borrow_cts_users", { actorEmpId: empId }); if (r.success) ctsUsers = r.data || []; else { ctsUsers = null; err = r.error || r.message || "โหลดรายชื่อ CTS ไม่สำเร็จ"; console.warn("borrow_cts_users", r); } }
        if (err) showNotification("โหลดรายชื่อ CTS ไม่สำเร็จ", err, "warning");
        if (!ctsUsers) ctsUsers = [];
        const sel = document.getElementById("fCts");
        sel.innerHTML = '<option value="">-- ทุกคนในทีม CTS --</option>' + ctsUsers.map((u) => `<option value="${esc(u.empId)}">${esc(u.name || u.empId)}</option>`).join("");
      }
      function onCtsChange() {
        const u = (ctsUsers || []).find((x) => x.empId === document.getElementById("fCts").value);
        document.getElementById("fCtsEmail").value = u ? (u.email || "") : "";
      }
      const renumber = () => [...document.querySelectorAll(".row-no")].forEach((e, i) => (e.textContent = i + 1));

      function getDropdown() {
        let d = document.getElementById("globalAutocompleteDropdown");
        if (!d) { d = document.createElement("div"); d.id = "globalAutocompleteDropdown"; d.className = "hidden fixed z-[9999] bg-white border border-slate-200 rounded-lg shadow-2xl max-h-64 overflow-y-auto"; document.body.appendChild(d); }
        return d;
      }
      function hideDropdown() { const d = document.getElementById("globalAutocompleteDropdown"); if (d) d.classList.add("hidden"); activeInput = null; }
      function handleCodeAutocomplete(inp) {
        clearTimeout(autocompleteTimer); activeInput = inp;
        const v = inp.value.trim(); if (v.length < 2) return hideDropdown();
        autocompleteTimer = setTimeout(async () => {
          try {
            const res = await n8nFetch(`${N8N_BASE}autocomplete?code=${encodeURIComponent(v)}`, { headers: { "content-type": "application/json; charset=utf-8" } });
            if (!res.ok) return;
            const t = await res.text(); const results = t && t.trim() ? JSON.parse(t) : [];
            if (activeInput === inp) renderDropdown(inp, Array.isArray(results) ? results : []);
          } catch (e) { console.error("autocomplete", e); }
        }, 300);
      }
      function renderDropdown(inp, results) {
        const dd = getDropdown(); if (!results.length) return dd.classList.add("hidden");
        dd.innerHTML = "";
        results.forEach((it) => {
          const code = it.code || it.Code || "", name = it.name || it.Name || "", mf = it.manufacturers || it.Manufacturers || "";
          const row = document.createElement("div"); row.className = "px-3 py-2 text-xs hover:bg-orange-50 cursor-pointer border-b border-slate-50 last:border-0";
          const a = document.createElement("div"); a.className = "font-mono font-semibold text-slate-800"; a.textContent = code;
          const b = document.createElement("div"); b.className = "text-slate-500 mt-0.5"; b.textContent = (mf ? mf + " — " : "") + name;
          row.append(a, b);
          row.addEventListener("click", () => {
            if (!activeInput) return;
            const tr = activeInput.closest("tr"); activeInput.value = code;
            const dsc = tr && tr.querySelector(".item-description"); if (dsc && name) dsc.value = name;
            hideDropdown();
          });
          dd.appendChild(row);
        });
        const r = inp.getBoundingClientRect(), w = Math.max(r.width, 300);
        dd.style.top = r.bottom + 4 + "px"; dd.style.width = w + "px"; dd.style.left = Math.min(r.left, window.innerWidth - w - 16) + "px";
        dd.classList.remove("hidden");
      }
      document.addEventListener("click", (e) => { if (!e.target.closest(".item-prod-code") && !e.target.closest("#globalAutocompleteDropdown")) hideDropdown(); });
      document.addEventListener("scroll", (e) => { const d = document.getElementById("globalAutocompleteDropdown"); if (d && (e.target === d || d.contains(e.target))) return; hideDropdown(); }, true);
      window.addEventListener("resize", hideDropdown);

      function openNewDocModal() {
        if (!can("CREATE")) return showNotification("ไม่มีสิทธิ์", "คุณไม่มีสิทธิ์สร้างเอกสารยืม", "error");
        document.getElementById("docModalTitle").textContent = "สร้างเอกสารยืมสินค้า";
        document.getElementById("editingDocNo").value = ""; document.getElementById("fDocNo").value = "";
        document.getElementById("fBorrowDate").value = todayIso(); document.getElementById("fDueDate").value = "";
        document.getElementById("fReqName").value = sessionStorage.getItem("name") || empId; document.getElementById("fReqEmail").value = sessionStorage.getItem("email") || "";
        document.querySelectorAll('input[name="purpose"]').forEach((x) => (x.checked = x.value === "ถ่ายคลิป")); document.getElementById("fPurposeNote").value = ""; onPurposeChange();
        document.getElementById("itemBody").innerHTML = ""; addRow();
        document.getElementById("docModal").classList.remove("hidden");
        loadCtsUsers().then(() => { document.getElementById("fCts").value = ""; onCtsChange(); });
      }
      async function openEditDocModal(docNo) {
        const r = await brw("borrow_detail", { actorEmpId: empId, docNo });
        if (!r.success) return showNotification("โหลดไม่สำเร็จ", r.error || "", "error");
        const d = r.doc;
        if (d.status !== "รออนุมัติ") return showNotification("แก้ไขไม่ได้", "แก้ไขได้เฉพาะเอกสารที่รออนุมัติ", "warning");
        closeViewModal();
        document.getElementById("docModalTitle").textContent = "แก้ไขเอกสาร " + docNo;
        document.getElementById("editingDocNo").value = docNo; document.getElementById("fDocNo").value = docNo;
        document.getElementById("fBorrowDate").value = String(d.borrowDate).slice(0, 10); document.getElementById("fDueDate").value = String(d.dueDate).slice(0, 10);
        document.getElementById("fReqName").value = d.borrowerName || d.borrowerEmpId || ""; document.getElementById("fReqEmail").value = d.borrowerEmail || "";
        document.querySelectorAll('input[name="purpose"]').forEach((x) => (x.checked = x.value === d.purpose)); document.getElementById("fPurposeNote").value = d.purposeNote || ""; onPurposeChange();
        document.getElementById("itemBody").innerHTML = ""; (r.items.length ? r.items : [{}]).forEach((i) => addRow(i));
        document.getElementById("docModal").classList.remove("hidden");
        loadCtsUsers().then(() => { document.getElementById("fCts").value = d.ctsEmpId || ""; onCtsChange(); if (d.ctsEmail) document.getElementById("fCtsEmail").value = d.ctsEmail; });
      }
      function closeDocModal() { document.getElementById("docModal").classList.add("hidden"); hideDropdown(); }

      async function saveDocument() {
        const editDoc = document.getElementById("editingDocNo").value;
        const borrowDate = document.getElementById("fBorrowDate").value, dueDate = document.getElementById("fDueDate").value;
        const items = [...document.querySelectorAll("#itemBody tr")].map((tr) => {
          const code = tr.querySelector(".item-prod-code").value.trim(), name = tr.querySelector(".item-description").value.trim();
          return { productCode: code, productName: name || code, qty: Number(tr.querySelector(".item-qty").value), unit: tr.querySelector(".item-unit").value.trim(), serialNo: tr.querySelector(".item-serial").value.trim(), remark: tr.querySelector(".item-remark").value.trim(),
            photo: Number(tr.dataset.keep) > 0 ? "" : (tr.dataset.photo || ""), keepPhotoLine: Number(tr.dataset.keep) || 0 };
        }).filter((x) => x.productName);
        if (!borrowDate || !dueDate) return showNotification("ข้อมูลไม่ครบ", "กรุณาระบุวันที่ยืมและกำหนดคืน", "warning");
        if (dueDate < borrowDate) return showNotification("ข้อมูลไม่ถูกต้อง", "กำหนดคืนต้องไม่ก่อนวันที่ยืม", "warning");
        const purpose = document.querySelector('input[name="purpose"]:checked').value, purposeNote = document.getElementById("fPurposeNote").value.trim();
        if (purpose === "อื่นๆ" && !purposeNote) return showNotification("ข้อมูลไม่ครบ", "กรุณาระบุวัตถุประสงค์อื่นๆ", "warning");
        if (!items.length) return showNotification("ข้อมูลไม่ครบ", "กรุณาเพิ่มรายการสินค้าอย่างน้อย 1 รายการ", "warning");
        if (items.some((x) => !(x.qty > 0))) return showNotification("ข้อมูลไม่ถูกต้อง", "จำนวนต้องมากกว่า 0", "warning");
        const payload = { borrowDate, dueDate, purpose, purposeNote, ctsEmpId: document.getElementById("fCts").value, ctsEmail: document.getElementById("fCtsEmail").value.trim(), items };
        const b = document.getElementById("btnSave"); b.disabled = true; b.classList.add("opacity-60");
        const r = editDoc ? await brw("borrow_edit", { ...payload, editorEmpId: empId, docNo: editDoc }) : await brw("borrow_create", { ...payload, createdByEmpId: empId });
        b.disabled = false; b.classList.remove("opacity-60");
        if (!r.success) return showNotification("บันทึกไม่สำเร็จ", r.error || "", "error");
        closeDocModal();
        showNotification("สำเร็จ", editDoc ? "แก้ไขเอกสารแล้ว" : `สร้างเอกสาร ${r.docNo} แล้ว — รอ CTS อนุมัติ`);
        await fetchAllDocuments();
      }

      // ================= ดูรายละเอียด =================
      let currentDoc = null;
      function closeViewModal() { document.getElementById("viewModal").classList.add("hidden"); currentDoc = null; }
      async function viewDocument(docNo) {
        document.getElementById("viewModal").classList.remove("hidden");
        document.getElementById("viewTitle").textContent = docNo;
        document.getElementById("viewBody").innerHTML = '<p class="text-center text-slate-400 py-10">กำลังโหลด...</p>';
        document.getElementById("viewActions").innerHTML = "";
        const r = await brw("borrow_detail", { actorEmpId: empId, docNo });
        if (!r.success) { document.getElementById("viewBody").innerHTML = `<p class="text-center text-red-500 py-10">${esc(r.error || "โหลดไม่สำเร็จ")}</p>`; return; }
        currentDoc = r; renderView();
      }
      // รูปตอนคืนระดับเอกสาร: แสดงใต้แถวแรกของการรับคืนแต่ละครั้ง (batchId เดียวกัน)
      function retPhotosHtml(r, returns) {
        if (!r.batchId || returns.findIndex((x) => x.batchId === r.batchId) !== returns.indexOf(r)) return "";
        const ph = ((currentDoc.returnPhotos || []).filter((x) => x.batchId === r.batchId));
        if (!ph.length) return "";
        return `<div class="mt-1.5 flex items-center gap-2 flex-wrap"><span class="text-[11px] text-slate-400">รูปตอนคืน:</span>${ph.map((x) => `<img src="${esc(x.photo)}" alt="" class="w-10 h-10 object-cover rounded-md border border-slate-200 cursor-zoom-in" onclick="showImage(this.src)">`).join("")}</div>`;
      }
      function renderView() {
        const { doc, items, returns = [], dueHistory = [] } = currentDoc;
        const od = overdueDays(doc), open = isOpenStatus(doc.status);
        document.getElementById("viewTitle").textContent = "ดูรายละเอียดเอกสารยืมสินค้า";
        // ===== หน้าดูรายละเอียด: โครงเดียวกับหน้าสร้าง/แก้ไขเอกสาร แต่อ่านอย่างเดียว =====
        const lbl = (t) => `<label class="block text-xs font-semibold text-slate-500 mb-1.5">${t}</label>`;
        const ro = (v, cls = "") => `<input disabled value="${esc(v ?? "")}" class="w-full h-10 px-3 rounded-lg border border-slate-200 bg-slate-50 text-sm text-slate-700 ${cls}" />`;
        const ro9 = (v) => `<input disabled value="${esc(v ?? "")}" class="w-full h-9 px-2.5 rounded-lg border border-slate-200 bg-slate-100 text-xs text-slate-600" />`;
        const purposes = ["ถ่ายคลิป", "ใช้งานภายใน", "อื่นๆ"];
        const radios = purposes.map((x) => `<label class="flex items-center gap-1.5 text-sm ${doc.purpose === x ? "text-slate-800 font-medium" : "text-slate-400"}"><input type="radio" disabled ${doc.purpose === x ? "checked" : ""} class="accent-brand-500" /> ${x}</label>`).join("")
          + (doc.purpose === "อื่นๆ" ? `<input disabled value="${esc(doc.purposeNote || "")}" class="flex-1 min-w-[180px] h-9 px-3 rounded-lg border border-slate-200 bg-slate-50 text-sm text-slate-700" />` : "");
        const showReturn = open || items.some((i) => Number(i.qtyReturned) || Number(i.qtyDamaged) || Number(i.qtyLost));
        const rowsHtml = items.map((i) => `<tr>
              <td class="p-2 text-center text-slate-400 text-xs">${i.lineNum}</td>
              <td class="p-2">${ro(i.productCode, "h-9 text-xs text-center")}</td>
              <td class="p-2">${ro(i.productName, "h-9 text-xs")}</td>
              <td class="p-2">${ro(fmtQty(i.qtyBorrowed), "h-9 text-xs text-right")}</td>
              <td class="p-2">${ro(i.unit, "h-9 text-xs")}</td>
              <td class="p-2">${ro(i.serialNo, "h-9 text-xs")}</td>
              <td class="p-2">${ro(i.remark, "h-9 text-xs")}</td>
              <td class="p-2">${i.photo ? `<span class="inline-flex items-center gap-1"><img src="${esc(i.photo)}" alt="" class="w-9 h-9 object-cover rounded-md border border-slate-200 cursor-zoom-in" onclick="showImage(currentDoc.items.find(x=>x.lineNum==${i.lineNum}).photo)"><button type="button" onclick="showImage(currentDoc.items.find(x=>x.lineNum==${i.lineNum}).photo)" class="h-8 px-2 rounded-md border border-slate-200 text-xs text-slate-600 hover:bg-slate-50">ดูรูป</button></span>` : '<span class="text-xs text-slate-300">ไม่มีรูป</span>'}</td></tr>`).join("");
        document.getElementById("viewBody").innerHTML = `
          <div class="grid grid-cols-1 lg:grid-cols-4 gap-4">
            <div class="lg:col-span-2">${lbl("วัตถุประสงค์")}<div class="flex flex-wrap items-center gap-x-4 gap-y-2 min-h-10">${radios}</div></div>
            <div>${lbl("เลขที่เอกสาร")}${ro(doc.docNo, "font-mono")}</div>
            <div>${lbl("วันที่ยืม")}${ro(formatThaiDate(doc.borrowDate).replace(/&[a-z#0-9]+;/g, ""))}</div>
          </div>
          <div class="grid grid-cols-1 lg:grid-cols-4 gap-4">
            <div>${lbl("กำหนดคืน")}<input disabled value="${esc(formatThaiDate(doc.dueDate))}" class="w-full h-10 px-3 rounded-lg border bg-slate-50 text-sm ${od > 0 ? "border-red-200 text-red-600 font-semibold" : "border-slate-200 text-slate-700"}" /></div>
            <div>${lbl("สถานะ")}<div class="min-h-10 flex items-center">${getStatusBadge(doc)}</div></div>
            <div>${lbl("ผู้สร้างเอกสาร")}${ro(doc.createdByName || doc.createdByEmpId)}</div>
            <div>${lbl("สร้างเมื่อ")}${ro(formatThaiDateTime(doc.createdAt))}</div>
          </div>
          <div>
            <h3 class="text-sm font-semibold text-slate-700 mb-2">รายการสินค้าที่ยืม</h3>
            <div class="border border-slate-200 rounded-xl overflow-x-auto">
              <table class="w-full table-fixed text-left border-collapse min-w-[1200px]">
                <thead><tr class="bg-slate-50/75 border-b border-slate-200 text-xs font-semibold text-slate-500">
                  <th class="p-3 w-10 text-center">#</th><th class="p-3">รหัสสินค้า</th><th class="p-3">รายละเอียดสินค้า</th><th class="p-3 w-24">จำนวน</th><th class="p-3 w-24">หน่วย</th><th class="p-3 w-48">Serial</th><th class="p-3">หมายเหตุ</th><th class="p-3 w-48">รูปสินค้า</th></tr></thead>
                <tbody class="divide-y divide-slate-100">${rowsHtml}</tbody>
              </table>
            </div>
          </div>
          ${showReturn ? `<div><h3 class="text-sm font-semibold text-slate-700 mb-2">สถานะการคืนสินค้า</h3>
            <div class="border border-slate-200 rounded-xl overflow-x-auto"><table class="w-full text-left border-collapse min-w-[640px]">
              <thead><tr class="bg-slate-50/75 border-b border-slate-200 text-xs font-semibold text-slate-500"><th class="p-3 w-10 text-center">#</th><th class="p-3">รายละเอียดสินค้า</th><th class="p-3 text-right">ยืม</th><th class="p-3 text-right">คืนแล้ว</th><th class="p-3 text-right">เสียหาย</th><th class="p-3 text-right">สูญหาย</th><th class="p-3 text-right">ค้างคืน</th></tr></thead>
              <tbody class="divide-y divide-slate-100 text-sm">${items.map((i) => { const rem = remainOf(i); return `<tr><td class="p-3 text-center text-slate-400">${i.lineNum}</td><td class="p-3">${esc(i.productName)}</td><td class="p-3 text-right">${fmtQty(i.qtyBorrowed)}</td><td class="p-3 text-right text-emerald-600">${fmtQty(i.qtyReturned)}</td><td class="p-3 text-right text-amber-600">${fmtQty(i.qtyDamaged)}</td><td class="p-3 text-right text-red-600">${fmtQty(i.qtyLost)}</td><td class="p-3 text-right font-semibold ${rem > 0 && open ? "text-blue-600" : ""}">${fmtQty(rem)}</td></tr>`; }).join("")}</tbody></table></div></div>` : ""}
          ${doc.remark ? `<div>${lbl("หมายเหตุเอกสาร")}${ro(doc.remark)}</div>` : ""}
          ${doc.rejectReason ? `<div class="text-sm bg-red-50 border border-red-100 text-red-700 rounded-xl p-3">เหตุผลที่ปฏิเสธ: ${esc(doc.rejectReason)}</div>` : ""}
          <div class="border border-slate-200 rounded-xl p-4 space-y-3 bg-slate-50/50">
            <h3 class="text-sm font-semibold text-slate-700 flex items-center gap-2"><i data-lucide="users" class="w-4 h-4 text-orange-500"></i> ผู้เกี่ยวข้องกับเอกสาร</h3>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div class="space-y-1"><div class="text-[11px] font-semibold text-slate-500">ผู้ขออนุมัติยืมสินค้าหน้าร้าน</div>
                <div class="text-[11px] text-slate-400">ชื่อ-นามสกุล</div>${ro9(doc.borrowerName || doc.borrowerEmpId)}
                <div class="text-[11px] text-slate-400">Email</div>${ro9(doc.borrowerEmail)}</div>
              <div class="space-y-1"><div class="text-[11px] font-semibold text-slate-500">เจ้าหน้าที่หน้าร้าน (CTS)</div>
                <div class="text-[11px] text-slate-400">ผู้รับเรื่อง</div>${ro9(doc.ctsEmpId ? (doc.ctsName || doc.ctsEmpId) : "ทุกคนในทีม CTS")}
                <div class="text-[11px] text-slate-400">Email</div>${ro9(doc.ctsEmail)}</div>
              <div class="space-y-1"><div class="text-[11px] font-semibold text-slate-500">ผู้อนุมัติ/ส่งมอบ</div>
                <div class="text-[11px] text-slate-400">ชื่อ-นามสกุล</div>${ro9(doc.approvedByName || doc.approvedByEmpId)}
                <div class="text-[11px] text-slate-400">${doc.status === "ปฏิเสธ" ? "ปฏิเสธเมื่อ" : "อนุมัติเมื่อ"}</div>${ro9(doc.approvedAt ? formatThaiDateTime(doc.approvedAt) : "")}</div>
            </div>
          </div>
          ${returns.length ? `<div><div class="text-sm font-semibold text-slate-700 mb-1.5">ประวัติการรับคืน</div><div class="space-y-1.5">${returns.map((r) => `<div class="text-xs bg-slate-50 rounded-xl px-3 py-2">${formatThaiDateTime(r.returnedAt)} · รายการ ${r.lineNum}: คืน ${fmtQty(r.qtyReturned)}${r.qtyDamaged ? ` · เสียหาย ${fmtQty(r.qtyDamaged)}` : ""}${r.qtyLost ? ` · สูญหาย ${fmtQty(r.qtyLost)}` : ""} · รับโดย ${esc(r.receivedByEmpId)}${r.receivedByName ? " " + esc(r.receivedByName) : ""}${r.compensationNote ? `<div class="text-amber-700 mt-0.5">การชดใช้: ${esc(r.compensationNote)}</div>` : ""}${retPhotosHtml(r, returns)}</div>`).join("")}</div></div>` : ""}
          ${dueHistory.length ? `<div><div class="text-sm font-semibold text-slate-700 mb-1.5">ประวัติการขยายกำหนดคืน</div><div class="space-y-1.5">${dueHistory.map((h) => `<div class="text-xs bg-slate-50 rounded-xl px-3 py-2">${formatThaiDateTime(h.changedAt)} · ${formatThaiDate(h.oldDue)} → ${formatThaiDate(h.newDue)} · โดย ${esc(h.changedByEmpId)}${h.changedByName ? " " + esc(h.changedByName) : ""}${h.reason ? ` · ${esc(h.reason)}` : ""}</div>`).join("")}</div></div>` : ""}`;
        const mine = [doc.createdByEmpId, doc.borrowerEmpId].includes(empId);
        const btn = (act, label, cls) => `<button onclick="doAction('${act}','${doc.docNo}')" class="h-10 px-5 rounded-lg text-sm font-medium ${cls}">${label}</button>`;
        const A = [];
        if (doc.status === "รออนุมัติ") {
          if ((can("APPROVE") && !mine) || can("REJECT_BACK")) A.push(`<a href="approve.html" class="h-10 px-5 inline-flex items-center rounded-lg text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700">ไปอนุมัติ/ปฏิเสธที่หน้าอนุมัติ</a>`);
          if ((mine && can("UPDATE_OWN")) || can("UPDATE_ANY")) A.push(`<button onclick="openEditDocModal('${doc.docNo}')" class="h-10 px-5 rounded-lg text-sm font-medium border border-slate-200 text-slate-600 hover:bg-slate-50">แก้ไข</button>`);
        }
        if (open) {
          if (can("RETURN_CONFIRM")) A.push(btn("return", "บันทึกรับคืน", "bg-brand-500 text-white hover:bg-brand-600"));
          if (can("EXTEND_DUE")) A.push(btn("extend", "ขยายกำหนดคืน", "border border-slate-200 text-slate-600 hover:bg-slate-50"));
        }
        if (["รออนุมัติ", "กำลังยืม"].includes(doc.status) && ((mine && can("DELETE_OWN")) || can("DELETE_ANY"))) A.push(btn("cancel", "ยกเลิกเอกสาร", "border border-slate-200 text-slate-600 hover:bg-slate-50"));
        document.getElementById("viewActions").innerHTML = A.join("") || '<span class="text-xs text-slate-400">ไม่มีการดำเนินการที่ทำได้</span>';
        lucide.createIcons();
      }

      // ================= การดำเนินการ (อนุมัติ/ปฏิเสธ/รับคืน/ขยาย/ยกเลิก) =================
      let actHandler = null;
      function openActModal(title, html, okLabel, handler) {
        document.getElementById("actTitle").innerHTML = title; document.getElementById("actBody").innerHTML = html;
        document.getElementById("actOk").textContent = okLabel || "ยืนยัน"; document.getElementById("actOk").className = "h-10 px-5 rounded-lg text-sm font-medium bg-brand-500 text-white hover:bg-brand-600 shadow-md shadow-brand-500/10"; actHandler = handler;
        document.getElementById("actModal").classList.remove("hidden");
      }
      function closeActModal() { document.getElementById("actModal").classList.add("hidden"); actHandler = null; }
      document.getElementById("actOk").addEventListener("click", async () => {
        if (!actHandler) return; const b = document.getElementById("actOk"); b.disabled = true; b.classList.add("opacity-60");
        try { await actHandler(); } finally { b.disabled = false; b.classList.remove("opacity-60"); }
      });
      async function afterAction(r, okMsg) {
        if (!r.success) { showNotification("ทำรายการไม่สำเร็จ", r.error || "", "error"); return false; }
        showNotification("สำเร็จ", okMsg); closeActModal(); closeViewModal(); await fetchAllDocuments(); return true;
      }
      let retPhotos = [];
      async function doAction(act, docNo) {
        const r0 = (currentDoc && currentDoc.doc.docNo === docNo) ? currentDoc : await brw("borrow_detail", { actorEmpId: empId, docNo });
        if (!r0.success) return showNotification("โหลดไม่สำเร็จ", r0.error || "", "error");
        const doc = r0.doc, items = r0.items, base = { actionByEmpId: empId, docNo };
        const inp = "w-full h-10 px-3 rounded-lg border border-slate-200 text-sm outline-none focus:ring-1 focus:ring-brand-500";
        if (act === "approve") {
          openActModal("อนุมัติและส่งมอบของ", `<p class="text-sm text-slate-700">ยืนยันอนุมัติเอกสาร <b>${esc(doc.docNo)}</b> และส่งมอบของให้ <b>${esc(doc.borrowerName || doc.borrowerEmpId)}</b> ใช่หรือไม่<br><span class="text-xs text-slate-500">กำหนดคืน ${formatThaiDate(doc.dueDate)}</span></p>`, "อนุมัติ",
            async () => afterAction(await brw("borrow_approve", base), "อนุมัติเรียบร้อย"));
        } else if (act === "reject") {
          openActModal("ปฏิเสธเอกสาร", `<label class="block text-xs font-semibold text-slate-500">เหตุผลที่ปฏิเสธ <span class="text-red-500">*</span></label><textarea id="fReason" rows="3" class="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm outline-none focus:ring-1 focus:ring-brand-500"></textarea>`, "ปฏิเสธ",
            async () => { const reason = document.getElementById("fReason").value.trim(); if (!reason) return showNotification("ข้อมูลไม่ครบ", "กรุณาระบุเหตุผล", "warning"); await afterAction(await brw("borrow_reject", { ...base, reason }), "ปฏิเสธเรียบร้อย"); });
        } else if (act === "cancel") {
          openActModal("ยกเลิกเอกสาร", `<label class="block text-xs font-semibold text-slate-500">เหตุผล (ไม่บังคับ)</label><textarea id="fReason" rows="2" class="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm outline-none focus:ring-1 focus:ring-brand-500"></textarea>`, "ยืนยันยกเลิก",
            async () => afterAction(await brw("borrow_cancel", { ...base, reason: document.getElementById("fReason").value.trim() }), "ยกเลิกเอกสารแล้ว"));
        } else if (act === "extend") {
          openActModal("ขยายกำหนดคืน", `<p class="text-sm text-slate-500">กำหนดเดิม: <b>${formatThaiDate(doc.dueDate)}</b></p>
            <label class="block text-xs font-semibold text-slate-500">กำหนดคืนใหม่ <span class="text-red-500">*</span></label><input id="fNewDue" type="date" min="${String(doc.dueDate).slice(0, 10)}" class="${inp}">
            <label class="block text-xs font-semibold text-slate-500">เหตุผล</label><input id="fReason" type="text" class="${inp}">`, "บันทึก",
            async () => { const nd = document.getElementById("fNewDue").value; if (!nd) return showNotification("ข้อมูลไม่ครบ", "กรุณาเลือกวันที่", "warning"); await afterAction(await brw("borrow_extend", { ...base, newDueDate: nd, reason: document.getElementById("fReason").value.trim() }), "ขยายกำหนดคืนแล้ว"); });
        } else if (act === "return") {
          const od = overdueDays(doc);
          const num = "w-full h-10 px-3 text-sm text-right border border-slate-200 rounded-lg outline-none focus:ring-1 focus:ring-brand-500";
          const cards = items.map((i) => { const rem = remainOf(i); if (rem <= 0) return ""; return `<div data-line="${i.lineNum}" data-rem="${rem}" data-photo="" class="ret-card border border-slate-200 rounded-xl p-4 space-y-3">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0"><div class="font-mono text-[11px] text-slate-400">${esc(i.productCode || "-")}</div><div class="text-sm font-semibold text-slate-800">${esc(i.productName)}</div>${i.serialNo ? `<div class="text-[11px] text-slate-400">S/N: ${esc(i.serialNo)}</div>` : ""}</div>
                <span class="shrink-0 text-[11px] font-semibold px-2 py-1 rounded-lg bg-blue-50 text-blue-700 border border-blue-100">ค้างคืน ${fmtQty(rem)}</span></div>
              <div class="grid grid-cols-3 gap-3">
                <div><label class="block text-[11px] font-semibold text-emerald-600 mb-1">จำนวนที่คืน</label><input type="number" min="0" step="any" value="${rem}" data-f="r" class="${num}"></div>
                <div><label class="block text-[11px] font-semibold text-amber-600 mb-1">เสียหาย</label><input type="number" min="0" step="any" value="0" data-f="d" class="${num}"></div>
                <div><label class="block text-[11px] font-semibold text-red-600 mb-1">สูญหาย</label><input type="number" min="0" step="any" value="0" data-f="l" class="${num}"></div></div>
              <div><label class="block text-[11px] font-semibold text-slate-500 mb-1">การชดใช้ / หมายเหตุ (ถ้ามี)</label><input type="text" maxlength="500" data-f="n" placeholder="เช่น ชดใช้เป็นเงิน / ซื้อทดแทน" class="w-full h-10 px-3 text-sm border border-slate-200 rounded-lg outline-none focus:ring-1 focus:ring-brand-500"></div>
            </div>`; }).join("");
          const sum = (k, v) => `<div class="flex items-start justify-between gap-4 text-xs"><span class="text-slate-400 shrink-0">${k}</span><span class="text-right text-slate-800 font-medium">${v}</span></div>`;
          openActModal(`<span class="w-9 h-9 rounded-xl bg-emerald-500 text-white inline-flex items-center justify-center"><i data-lucide="package-check" class="w-5 h-5"></i></span> บันทึกรับคืนสินค้า`,
            `<div class="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-1.5">
               ${sum("เลขที่เอกสาร", `<span class="font-mono font-bold">${esc(doc.docNo)}</span>`)}
               ${sum("ผู้ยืม", esc(doc.borrowerName || doc.borrowerEmpId))}
               ${sum("วัตถุประสงค์", esc(doc.purpose === "อื่นๆ" && doc.purposeNote ? "อื่นๆ: " + doc.purposeNote : doc.purpose))}
               ${sum("กำหนดคืน", `<span class="${od > 0 ? "text-red-600 font-semibold" : ""}">${formatThaiDate(doc.dueDate)}${od > 0 ? ` (เกินกำหนด ${od} วัน)` : ""}</span>`)}
             </div>
             <div><div class="text-xs font-semibold text-slate-600 mb-1">รายการที่รับคืนครั้งนี้</div>
               <p class="text-[11px] text-slate-400 mb-2">ใส่จำนวนที่รับคืนต่อรายการ (ค่าเริ่มต้นคือคืนครบตามที่ค้าง) หากเสียหายหรือสูญหายให้ระบุจำนวนและวิธีชดใช้ และแนบรูปหลักฐานได้</p>
               <div id="retBody" class="space-y-3">${cards}</div></div>
             <div class="border border-dashed border-slate-300 rounded-xl bg-slate-50/60 p-3 flex flex-wrap items-center gap-3">
               <i data-lucide="paperclip" class="w-4 h-4 text-orange-500"></i><span class="text-xs font-semibold text-slate-600">รูปตอนคืนสินค้า (ไม่บังคับ · ต่อเอกสาร · สูงสุด 3 รูป)</span>
               <input type="file" accept="image/*" multiple class="hidden" id="retFile">
               <span id="retThumbs" class="inline-flex items-center gap-2 flex-wrap"></span>
               <button type="button" id="retAdd" class="h-9 px-3 rounded-lg border border-slate-200 bg-white text-xs font-medium text-orange-600 hover:bg-orange-50 inline-flex items-center gap-1"><i data-lucide="image-plus" class="w-3.5 h-3.5"></i> เพิ่มรูป <span id="retCount" class="text-slate-400">(0/3)</span></button>
             </div>
             <div class="flex items-start gap-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2"><i data-lucide="triangle-alert" class="w-4 h-4 shrink-0 mt-px"></i><span>บันทึกรับคืนแล้วจะแก้ไขรายการนี้ไม่ได้ ระบบจะปรับสถานะเอกสารเป็น "คืนบางส่วน" หรือ "คืนแล้ว" ตามจำนวนที่ค้างอยู่</span></div>`,
            "ยืนยันรับคืน",
            async () => {
              const cardsEl = [...document.querySelectorAll("#retBody .ret-card")];
              for (const c of cardsEl) {
                const s = ["r", "d", "l"].reduce((a, f) => a + Number(c.querySelector(`[data-f="${f}"]`).value || 0), 0);
                if (s > Number(c.dataset.rem) + 1e-9) return showNotification("ข้อมูลไม่ถูกต้อง", "จำนวนเกินที่ค้างคืนอยู่", "warning");
              }
              const lines = cardsEl.map((c) => ({ lineNum: Number(c.dataset.line), qtyReturned: Number(c.querySelector('[data-f="r"]').value || 0), qtyDamaged: Number(c.querySelector('[data-f="d"]').value || 0), qtyLost: Number(c.querySelector('[data-f="l"]').value || 0), compensationNote: c.querySelector('[data-f="n"]').value.trim() }));
              await afterAction(await brw("borrow_return", { ...base, items: lines, photos: retPhotos }), "บันทึกรับคืนแล้ว");
            });
          document.getElementById("actOk").className = "h-10 px-5 rounded-lg text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 shadow-md shadow-emerald-600/10 inline-flex items-center gap-1.5";
          retPhotos = [];
          const drawRet = () => {
            document.getElementById("retThumbs").innerHTML = retPhotos.map((u, i) => `<span class="relative inline-block"><img src="${u}" alt="" class="w-12 h-12 object-cover rounded-md border border-slate-200 cursor-zoom-in" onclick="showImage(retPhotos[${i}])"><button type="button" onclick="retPhotos.splice(${i},1);window.__drawRet()" class="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white text-[11px] leading-5 text-center" title="ลบรูป">×</button></span>`).join("");
            document.getElementById("retCount").textContent = `(${retPhotos.length}/3)`;
            document.getElementById("retAdd").classList.toggle("hidden", retPhotos.length >= 3);
          };
          window.__drawRet = drawRet;
          document.getElementById("retAdd").addEventListener("click", () => document.getElementById("retFile").click());
          document.getElementById("retFile").addEventListener("change", async (ev) => {
            const files = [...ev.target.files]; ev.target.value = "";
            for (const f of files) {
              if (retPhotos.length >= 3) { showNotification("แนบรูปได้สูงสุด 3 รูป", "", "warning"); break; }
              try { retPhotos.push(await resizeImage(f)); } catch (e) { showNotification("รูปไม่ถูกต้อง", e.message || "ไม่สามารถอ่านรูปนี้ได้", "warning"); }
            }
            drawRet();
          });
        }
        lucide.createIcons();
      }

      // ================= เริ่มต้น =================
      function toggleMobileMenu() {
        const m = document.getElementById("mobile-sidebar"), ic = document.getElementById("mobileMenuBtn");
        const hidden = m.classList.contains("hidden"); m.classList.toggle("hidden", !hidden);
        ic.setAttribute("data-lucide", hidden ? "x" : "menu"); lucide.createIcons();
      }
      function syncSidebar() {
        if (typeof renderSidebar === "function") renderSidebar();
        const mob = document.getElementById("mobile-sidebar-content"), side = document.getElementById("sidebar-container");
        if (mob && side) mob.innerHTML = side.innerHTML; lucide.createIcons();
      }
      function openFromUrlIfNeeded() { const d = new URLSearchParams(location.search).get("doc"); if (d) viewDocument(d); }

      window.onload = async function () {
        syncSidebar(); buildHead();
        const ok = await loadMyPerms(); syncSidebar();
        if (!ok) showNotification("โหลดสิทธิ์ไม่สำเร็จ", "ปุ่มบางอย่างอาจไม่แสดง กรุณารีเฟรช", "warning");
        document.getElementById("btnNew").classList.toggle("hidden", !can("CREATE"));
        await fetchAllDocuments(); lucide.createIcons(); openFromUrlIfNeeded();
      };
