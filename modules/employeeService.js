// ===================================================================
// modules/employeeService.js — Service Logic สำหรับ KTW HUB
// ===================================================================

/* ==========================================================================================
   MODULES — role label + webhook ของแต่ละระบบ (ย้ายมาจาก EMPLOYEE_MODULES เดิม ค่าเหมือนเดิม)
   roles: [ค่า, ชื่อสั้น, คำอธิบาย]
   ========================================================================================== */
const N8N = 'https://n8n.ktw.co.th/webhook/';
const actor = () => ({ name: sessionStorage.getItem('name') || 'Admin', empId: sessionStorage.getItem('emp_id') || 'unknown' });

const MODULES = [
  { key:'swap', name:'SWAP', th:'สลับสินค้า', c:'var(--swap)', identity:true,
    listEndpoint:'CheckRoll-User-KTW-switching-system', updateEndpoint:'UpdateRoll-User-KTW-switching-system',
    roles:[['0','Staff','พนักงานทั่วไป'],['1','Admin','ผู้ดูแลระบบ'],['2','Approver','ผู้อนุมัติ'],['3','SCM','Inventory Control'],
           ['6','MCM','เจ้าหน้าที่คลังเครื่อง'],['7','SPM','เจ้าหน้าที่คลังอะไหล่']],
    readRole: raw => firstDefined(raw.roll, raw.enp_type, raw.emp_type),
    payload: (empId, r, emp) => ({ employeeId:empId, emp_id:empId, roll:r, enp_type:r, emp_type:r,
      name:emp.name||'', last_name:emp.name||'', email:emp.email||'', department:emp.department||'', dep:emp.department||'',
      assignedBy:actor().name, assignedByEmpId:actor().empId, assignedAt:new Date().toISOString() }) },
  { key:'disassembly', name:'Disassembly', th:'แกะอะไหล่', c:'var(--dis)',
    listEndpoint:'get_all_employee_roles_disassembly', updateEndpoint:'update_employee_role_disassembly',
    roles:[['0','Staff','พนักงานทั่วไป'],['1','Admin','ผู้ดูแลระบบ'],['2','Approver','ผู้อนุมัติ'],['3','MKT','เจ้าหน้าที่การตลาด'],
           ['4','MCM','เจ้าหน้าที่คลังเครื่อง'],['5','SPM','เจ้าหน้าที่คลังอะไหล่'],['6','SRV','แผนกเทคนิคและช่าง'],['7','SCM','เจ้าหน้าที่แผนก SCM']],
    readRole: raw => raw.DisassemblyRoleId,
    payload: (empId, r) => ({ empId, roleId:parseInt(r,10), updatedByEmpId:actor().empId }) },
  { key:'ncr', name:'NCR', th:'เอกสาร NCR', c:'var(--ncr)',
    listEndpoint:'get_all_employee_roles_ncr', updateEndpoint:'update_employee_role_ncr',
    roles:[['0','Staff','พนักงานทั่วไป'],['1','Admin','ผู้ดูแลระบบ'],['2','Approver','ผู้อนุมัติ (ผู้บริหาร)'],['3','MKT','เจ้าหน้าที่การตลาด'],
           ['4','MCM','เจ้าหน้าที่คลังเครื่อง / LOG โลจิสติกส์'],['5','SPM','เจ้าหน้าที่คลังอะไหล่'],['6','SRV','เจ้าหน้าที่เทคนิคและช่าง'],
           ['7','SCM','เจ้าหน้าที่ SCM'],['8','PQM','เจ้าหน้าที่บริหารจัดการคุณภาพสินค้า']],
    readRole: raw => raw.RoleId,
    // flag หัวหน้า SCM / SCM คนที่ 2 แยกอิสระจาก role หลัก — ถ้าไม่ได้ส่ง flags มา ใช้ค่าเดิมของพนักงาน
    payload: (empId, r, emp, flags) => { const f = flags || { isScmHead:emp.ncrIsScmHead, isScmSecond:emp.ncrIsScmSecond };
      return { empId, roleId:parseInt(r,10), isScmHead:!!f.isScmHead, isScmSecond:!!f.isScmSecond, updatedByEmpId:actor().empId }; } },
  { key:'claim', name:'Claim', th:'เคลมสินค้าลูกค้า', c:'var(--claim)',
    listEndpoint:'get_all_employee_roles_claim_cus', updateEndpoint:'update_employee_role_claim_cus',
    roles:[['0','Staff','พนักงานทั่วไป'],['1','Admin','ผู้ดูแลระบบ'],['2','Approver','ผู้อนุมัติ (ผู้บริหาร)'],['3','MKT','เจ้าหน้าที่การตลาด'],['4','MCM','เจ้าหน้าที่คลังเครื่อง / LOG โลจิสติกส์'],['5','SPM','เจ้าหน้าที่คลังอะไหล่'],['6','SRV','เจ้าหน้าที่เทคนิคและช่าง']],
    readRole: raw => raw.RoleId,
    payload: (empId, r) => ({ empId, roleId:parseInt(r,10), updatedByEmpId:actor().empId }) },
  // ยืม-คืนสินค้าหน้าร้าน (BRW) — สิทธิ์อยู่ใน perm schema; list/update ผ่าน POST + ตรวจสิทธิ์ MANAGE_ROLE ฝั่ง server
  { key:'borrow', name:'Borrow', th:'ยืม-คืนสินค้าหน้าร้าน', c:'var(--brw)',
    listEndpoint:'borrow_roles_list', listPost:true, updateEndpoint:'borrow_role_update',
    roles:[['0','Staff','พนักงานทั่วไป'],['1','Admin','ผู้ดูแลระบบ'],['2','CTS','เจ้าหน้าที่ CTS หน้าร้าน (ส่งมอบ/รับคืน)']],
    readRole: raw => raw.RoleId,
    payload: (empId, r) => ({ empId, roleId:parseInt(r,10), updatedByEmpId:actor().empId }) },
];
const MOD = Object.fromEntries(MODULES.map(m => [m.key, m]));

// รายชื่อแผนกจากฟอร์มเดิม (รวมกับแผนกที่พบในข้อมูลจริงตอนโหลด)
const DEPARTMENTS = ['SDT Business Analysis','DPA จัดการตรวจสอบเอกสารขาย','LOG โลจิสติกส์','MDT โมเดิร์นเทรด','SDL ขายคู่คิดร้านค้า','MGT บริหารงาน 1',
  'ACC บัญชีและการเงิน','SIT บริหารโครงสร้างพื้นฐานฯ','IND ขายอุตสาหกรรม','SDT Programmer','HRM บุคคล','SRV เทคนิคและช่าง','ACC-Tบัญชีและการเงิน',
  'CDE แผนกพัฒนาช่องทางและกิจกรรม','SCM บริหารกระบวนการสินค้า','MAR Marcom','MKT แผนกการตลาด','MGT บริหารงาน 2','CTS หน้าร้าน',
  'PQM บริหารการจัดการคุณภาพ','SSP บัดดี้','AMI ธุรการฝ่ายขาย','LOG Spare Parts','ART Graphic','กรรมการผู้จัดการ','MGT กรรมการผู้จัดการ'];
// ค่าที่ระบบเติมให้ตอน DB ไม่มีข้อมูล — ไม่ใช่ข้อมูลจริง ห้ามเขียนกลับลง DB
const PLACEHOLDERS = ['user@ktw.co.th','ไม่ระบุชื่อพนักงาน','แผนก'];
const real = v => PLACEHOLDERS.includes(v) ? '' : (v || '');

/* ==========================================================================================
   HELPERS
   ========================================================================================== */
function firstDefined(...v){ for (const x of v) if (x !== undefined && x !== null && String(x).trim() !== '') return String(x).trim(); return ''; }
const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pk = (id, sys) => `${id}|${sys}`;
const roleOf = (sys, v) => v === '' || v == null ? ['', 'ยังไม่กำหนด', 'ยังไม่ได้ตั้งสิทธิ์ในระบบนี้'] : (MOD[sys].roles.find(r => r[0] === String(v)) || [String(v), 'Role ' + v, '']);
const hue = id => ['#EA580C','#7C3AED','#2563EB','#0E9F6E','#DB2777','#0891B2','#CA8A04','#4F46E5'][(parseInt(id, 10) || 0) % 8];
const isElevated = v => v !== '' && v !== '0';
const wait = ms => new Promise(r => setTimeout(r, ms));

async function api(path, body){
  const opt = body === undefined
    ? { method:'GET', headers:{ 'Accept':'application/json' } }
    : { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(body) };
  const res = await n8nFetch(N8N + path, opt);
  if (!res.ok) throw new Error(`เซิร์ฟเวอร์ตอบกลับรหัส ${res.status}`);
  const text = await res.text();
  let json = null; try { json = text && text.trim() ? JSON.parse(text) : null; } catch { json = null; }
  if (json && json.success === false) throw new Error(json.error || json.message || 'บันทึกไม่สำเร็จ');
  return json;
}
// ยิงทีละไม่เกิน n คำขอ — ไม่ถล่ม n8n ตอนกำหนดสิทธิ์ทั้งแผนก
async function pool(items, n, fn, onEach){
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++;
      try { out[k] = { ok:true, v: await fn(items[k]) }; } catch (err) { out[k] = { ok:false, err }; }
      onEach && onEach(); }
  }));
  return out;
}
function saveCache(){ try { localStorage.setItem('ktw_registered_employees', JSON.stringify(st.emps.map(x => ({ ...x, password:'' })))); } catch {} }

/* ==========================================================================================
   STATE
   ========================================================================================== */
const st = {
  emps: [], byId: new Map(),
  pending: new Map(),   // `${empId}|${sys}` -> role ใหม่ (string)
  flags: new Map(),     // empId -> { isScmHead, isScmSecond } ของ NCR ที่เปลี่ยน
  failed: new Set(),    // key ที่บันทึกไม่สำเร็จรอบล่าสุด
  selected: new Set(),
  f: { q:'', dept:'', sys:'', role:null, special:false, noMail:false },
  sort: { key:'employeeId', dir:1 },
  page: 1, size: 50, drawerId: null, loaded:false,
};
const eff = (e, sys) => st.pending.has(pk(e.employeeId, sys)) ? st.pending.get(pk(e.employeeId, sys)) : (e.roles[sys] ?? '');
const effFlags = e => st.flags.get(e.employeeId) || { isScmHead: !!e.ncrIsScmHead, isScmSecond: !!e.ncrIsScmSecond };

function setPending(id, sys, role){
  const e = st.byId.get(id), k = pk(id, sys);
  st.failed.delete(k);
  if ((e.roles[sys] ?? '') === role) st.pending.delete(k); else st.pending.set(k, role);
}
function setFlags(id, f){
  const e = st.byId.get(id);
  st.failed.delete(pk(id, 'ncr'));
  if (!!e.ncrIsScmHead === !!f.isScmHead && !!e.ncrIsScmSecond === !!f.isScmSecond) st.flags.delete(id); else st.flags.set(id, f);
}

/* ==========================================================================================
   LOAD — ดึงทุกระบบขนานกัน แล้ว merge ด้วย employeeId (ระบบ SWAP เป็นแหล่งข้อมูลตัวตน)
   ========================================================================================== */
async function loadAll(){
  showSkeleton();
  $('#btnReload').disabled = true;
  const results = await Promise.allSettled(MODULES.map(m => m.listPost
    ? api(m.listEndpoint, { actorEmpId: currentEmpId }).then(j => (Array.isArray(j) ? j : (j && Array.isArray(j.data) ? j.data : null)))
    : api(m.listEndpoint)));
  const merged = new Map(); const failedMods = [];
  // ประมวลผลระบบตัวตน (SWAP) ก่อน เพื่อให้ชื่อ/อีเมล/แผนกมาจากแหล่งหลัก
  const order = MODULES.map((m, i) => ({ m, r: results[i] })).sort((a, b) => (b.m.identity ? 1 : 0) - (a.m.identity ? 1 : 0));
  for (const { m, r } of order) {
    if (r.status !== 'fulfilled' || !Array.isArray(r.value)) { failedMods.push(m); console.error(`โหลด ${m.name} ไม่สำเร็จ`, r.reason || r.value); continue; }
    r.value.forEach(raw => {
      const id = String(raw.employeeId || raw.emp_Id || raw.emp_id || raw.EmpId || '').trim();
      if (!id) return;
      if (!merged.has(id)) merged.set(id, { employeeId:id, password:'', name:'', email:'', nickname:'', department:'', roles:{}, ncrIsScmHead:false, ncrIsScmSecond:false });
      const e = merged.get(id);
      if (m.identity) {
        e.password = String(raw.password || raw.emp_pass || '').trim();
        e.name = real(raw.name || raw.last_name || raw.fullname);
        e.email = real(raw.email);
        e.nickname = raw.nickname || raw.emp_nickname || '';
        e.department = real(raw.department || raw.dep);
      } else {
        if (!e.name) e.name = real(raw.emp_name);
        if (!e.email) e.email = real(raw.emp_email);
        if (!e.department) e.department = real(raw.emp_dep);
      }
      e.roles[m.key] = firstDefined(m.readRole(raw));
      if (m.key === 'ncr') {
        e.ncrIsScmHead = raw.IsScmHead === true || raw.IsScmHead === 1 || raw.IsScmHead === '1';
        e.ncrIsScmSecond = raw.IsScmSecond === true || raw.IsScmSecond === 1 || raw.IsScmSecond === '1';
      }
    });
  }
  const identityOk = !failedMods.some(m => m.identity);
  if (merged.size && identityOk) {
    st.emps = [...merged.values()];
    MODULES.forEach(m => st.emps.forEach(e => { if (!(m.key in e.roles)) e.roles[m.key] = ''; }));
    saveCache();
    stampSync(failedMods);
    if (failedMods.length) toast('โหลดได้บางระบบ', `ระบบ ${failedMods.map(m => m.name).join(', ')} โหลดไม่สำเร็จ สิทธิ์ของระบบนั้นจะแสดงเป็น “ยังไม่กำหนด” ชั่วคราว ห้ามแก้สิทธิ์ระบบนั้นจนกว่าจะโหลดใหม่สำเร็จ`, 'warn');
  } else {
    let cache = []; try { cache = JSON.parse(localStorage.getItem('ktw_registered_employees') || '[]'); } catch {}
    st.emps = cache.map(e => ({ ...e, password:'', name:real(e.name), email:real(e.email), department:real(e.department), roles:{ ...(e.roles || {}) } }));
    stampSync(MODULES, true);
    toast('โหลดข้อมูลไม่สำเร็จ', st.emps.length ? 'กำลังแสดงข้อมูลที่บันทึกไว้ในเครื่องครั้งล่าสุด ซึ่งอาจไม่ตรงกับฐานข้อมูล กด “โหลดข้อมูลใหม่” อีกครั้ง' : 'ตรวจสอบการเชื่อมต่อแล้วกด “โหลดข้อมูลใหม่”', 'error');
  }
  st.failedMods = new Set(failedMods.map(m => m.key));
  st.byId = new Map(st.emps.map(e => [e.employeeId, e]));
  st.pending.clear(); st.flags.clear(); st.failed.clear(); st.selected.clear();
  st.loaded = true;
  fillDeptOptions();
  $('#btnReload').disabled = false;
  renderAll();
}
function stampSync(failedMods = [], offline = false){
  const d = new Date(), t = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  const el = $('#syncInfo');
  el.classList.toggle('err', offline || failedMods.length > 0);
  el.innerHTML = offline ? `<i></i>โหลดจากเซิร์ฟเวอร์ไม่สำเร็จ แสดงข้อมูลในเครื่อง`
    : `<i></i>โหลดล่าสุด ${t} น. ชื่อ แผนก และรหัสผ่านซิงค์จาก SIT ทุก 5 นาที`;
}
function allDepartments(){
  return [...new Set([...DEPARTMENTS, ...st.emps.map(e => e.department).filter(Boolean)])].sort((a, b) => a.localeCompare(b, 'th'));
}
function fillDeptOptions(){
  const used = [...new Set(st.emps.map(e => e.department).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'th'));
  const prev = st.f.dept;
  $('#fDept').innerHTML = `<option value="">ทุกแผนก</option>` + used.map(d => `<option value="${esc(d)}">${esc(d)}</option>`).join('');
  if (used.includes(prev)) $('#fDept').value = prev; else st.f.dept = '';
}
function showSkeleton(){
  $('#tbody').innerHTML = Array.from({ length: 6 }, () => `<tr>${Array.from({ length: 5 + MODULES.length }, (_, i) =>
    `<td><div class="skel" style="width:${[16, 160, 110, 150, 70, 70, 70, 70, 20][i] || 60}px"></div></td>`).join('')}</tr>`).join('');
}

/* ==========================================================================================
   RENDER — COVERAGE
   ========================================================================================== */
function renderCover(){
  $('#cover').innerHTML = MODULES.map(m => {
    const cnt = { '': 0 }; m.roles.forEach(r => cnt[r[0]] = 0);
    st.emps.forEach(e => { const r = eff(e, m.key); cnt[r] = (cnt[r] || 0) + 1; });
    const elevated = st.emps.filter(e => isElevated(eff(e, m.key))).length;
    const nonStaff = m.roles.filter(r => r[0] !== '0');
    const op = r => r === '0' ? .25 : r === '1' ? 1 : 1 - (nonStaff.findIndex(x => x[0] === r) / (nonStaff.length + 1)) * .7;
    const segs = nonStaff.filter(r => cnt[r[0]]).map(r => `<span style="flex:${cnt[r[0]]};opacity:${op(r[0])}" title="${esc(r[1])} ${cnt[r[0]]} คน"></span>`).join('');
    const entries = [...m.roles, ...(cnt[''] ? [['', 'ยังไม่กำหนด', '']] : [])];
    const lg = entries.map(r => {
      const on = st.f.sys === m.key && st.f.role === r[0];
      return `<button class="lg${on ? ' on' : ''}${cnt[r[0]] ? '' : ' zero'}${r[0] === '' ? ' unset' : ''}" type="button" data-sys="${m.key}" data-role="${r[0]}" style="--o:${op(r[0])}" aria-pressed="${on}">
        <em>${r[0] === '' ? '' : r[0] + ' '}${esc(r[1])}</em><span class="num">${cnt[r[0]]}</span></button>`;
    }).join('');
    const warn = st.failedMods?.has(m.key) ? ' <small style="color:var(--danger)">โหลดไม่สำเร็จ</small>' : '';
    return `<div class="sys" style="--c:${m.c}">
      <div class="sys-top"><span class="sys-name"><i></i>${m.name}<small>${m.th}</small>${warn}</span>
      <span class="sys-count"><b class="num">${elevated}</b>คนมีสิทธิ์พิเศษ</span></div>
      <div class="bar">${segs}</div><div class="legend">${lg}</div></div>`;
  }).join('');
}

/* ==========================================================================================
   RENDER — TABLE
   ========================================================================================== */
function filtered(){
  const { q, dept, sys, role, special, noMail } = st.f; const qq = q.trim().toLowerCase();
  const rows = st.emps.filter(e => {
    if (qq && !`${e.employeeId} ${e.name} ${e.nickname} ${e.email} ${e.department}`.toLowerCase().includes(qq)) return false;
    if (dept && e.department !== dept) return false;
    if (sys && role !== null && eff(e, sys) !== role) return false;
    if (special && !MODULES.some(m => isElevated(eff(e, m.key)))) return false;
    if (noMail && e.email) return false;
    return true;
  });
  const { key, dir } = st.sort;
  const rv = v => v === '' ? 99 : +v;
  rows.sort((a, b) => {
    if (MOD[key]) return (rv(eff(a, key)) - rv(eff(b, key))) * (rv(eff(a, key)) === 99 || rv(eff(b, key)) === 99 ? 1 : dir) || (+a.employeeId - +b.employeeId);
    if (key === 'employeeId') return (+a.employeeId - +b.employeeId) * dir;
    return String(a[key] || '').localeCompare(String(b[key] || ''), 'th') * dir;
  });
  return rows;
}
const pageSlice = rows => rows.slice((st.page - 1) * st.size, st.page * st.size);
function sortBtn(key, label){
  const on = st.sort.key === key;
  return `<button class="sort" type="button" data-sort="${key}" ${on ? 'data-on' : ''}>${label}<svg class="i" style="width:12px;height:12px${on && st.sort.dir < 0 ? ';transform:rotate(180deg)' : ''}"><use href="#${on ? 'i-up' : 'i-sort'}"/></svg></button>`;
}
function renderHead(rows){
  const ids = pageSlice(rows).map(e => e.employeeId);
  const all = ids.length && ids.every(id => st.selected.has(id));
  $('#thead').innerHTML = `<tr>
    <th style="width:40px"><input class="ck" type="checkbox" id="ckAll" aria-label="เลือกทั้งหน้า" ${all ? 'checked' : ''}></th>
    <th>${sortBtn('name', 'พนักงาน')}</th><th>${sortBtn('department', 'แผนก')}</th><th>อีเมล</th>
    ${MODULES.map(m => `<th class="sys-h" style="--c:${m.c}">${sortBtn(m.key, m.name)}</th>`).join('')}
    <th style="width:48px"><span class="sr-only">จัดการ</span></th></tr>`;
}
function roleChip(e, sys, asStatic){
  const r = eff(e, sys), def = roleOf(sys, r), k = pk(e.employeeId, sys);
  const pend = st.pending.has(k) || (sys === 'ncr' && st.flags.has(e.employeeId));
  const cls = r === '' ? 'unset' : r === '0' ? 'staff' : r === '1' ? 'admin' : 'lvl';
  let flag = '';
  if (sys === 'ncr') { const f = effFlags(e); flag = (f.isScmHead ? '<span class="flag">หัวหน้า SCM</span>' : '') + (f.isScmSecond ? '<span class="flag">SCM 2</span>' : ''); }
  const tag = asStatic ? 'span' : 'button';
  return `<${tag} class="role ${cls}${pend ? ' pending' : ''}${st.failed.has(k) ? ' failed' : ''}${asStatic ? ' static' : ''}" ${asStatic ? '' : `type="button" aria-haspopup="menu"`} style="--c:${MOD[sys].c}"
    data-emp="${esc(e.employeeId)}" data-sys="${sys}" aria-label="${MOD[sys].name}: ${esc(def[1])}${pend ? ' (ยังไม่บันทึก)' : ''}">
    <span class="n num">${r === '' ? '–' : r}</span>${esc(def[1])}${flag}${asStatic ? '' : '<svg class="i caret"><use href="#i-chev"/></svg>'}</${tag}>`;
}
function renderTable(){
  if (!st.loaded) return;
  const rows = filtered(), pages = Math.max(1, Math.ceil(rows.length / st.size));
  if (st.page > pages) st.page = pages;
  renderHead(rows);
  const slice = pageSlice(rows);
  $('#tbody').innerHTML = slice.length ? slice.map(e => {
    const sel = st.selected.has(e.employeeId), me = e.employeeId === currentEmpId;
    return `<tr class="${sel ? 'picked' : ''}">
      <td><input class="ck" type="checkbox" data-ck="${esc(e.employeeId)}" ${sel ? 'checked' : ''} aria-label="เลือก ${esc(e.name)}"></td>
      <td><div class="who"><span class="av" style="--h:${hue(e.employeeId)}">${esc((e.name || '?').charAt(0))}</span>
        <button class="who-n" type="button" data-open="${esc(e.employeeId)}"><strong>${esc(e.name || 'ไม่มีชื่อในระบบ')}${me ? '<span class="tag-me">คุณ</span>' : ''}</strong>
        <small class="num">${esc(e.employeeId)}${e.nickname ? ` · ${esc(e.nickname)}` : ''}</small></button></div></td>
      <td>${e.department ? `<span class="dep" title="${esc(e.department)}">${esc(e.department)}</span>` : '<span class="mail">–</span>'}</td>
      <td>${e.email ? `<span class="mail">${esc(e.email)}</span>` : `<span class="mail missing"><svg class="i" style="width:13px;height:13px"><use href="#i-mail"/></svg>ยังไม่มีอีเมล</span>`}</td>
      ${MODULES.map(m => `<td class="sys-c">${roleChip(e, m.key)}</td>`).join('')}
      <td><button class="icon-btn" type="button" data-open="${esc(e.employeeId)}" aria-label="รายละเอียด ${esc(e.name)}"><svg class="i"><use href="#i-more"/></svg></button></td>
    </tr>`; }).join('')
    : `<tr><td colspan="${5 + MODULES.length}"><div class="empty">${st.emps.length
        ? '<strong>ไม่พบพนักงานตามเงื่อนไขนี้</strong>ลองลบตัวกรองบางอย่าง หรือค้นหาด้วยรหัสพนักงาน'
        : '<strong>ยังไม่มีข้อมูลพนักงาน</strong>กด “โหลดข้อมูลใหม่” เพื่อดึงจากเซิร์ฟเวอร์อีกครั้ง'}</div></td></tr>`;
  const a = rows.length ? (st.page - 1) * st.size + 1 : 0, b = Math.min(st.page * st.size, rows.length);
  $('#count').textContent = `แสดง ${a}–${b} จาก ${rows.length} คน` + (rows.length !== st.emps.length ? ` (ทั้งหมด ${st.emps.length})` : '');
  renderPager(pages); renderChips();
}
function renderPager(pages){
  const p = st.page, list = [...new Set([1, pages, p - 1, p, p + 1].filter(n => n >= 1 && n <= pages))].sort((a, b) => a - b);
  let h = `<button type="button" data-pg="${p - 1}" ${p === 1 ? 'disabled' : ''} aria-label="ก่อนหน้า">‹</button>`;
  list.forEach((n, i) => { if (i && n - list[i - 1] > 1) h += `<span style="padding:0 4px;color:var(--ink-3)">…</span>`;
    h += `<button type="button" data-pg="${n}" class="num${n === p ? ' on' : ''}" ${n === p ? 'aria-current="page"' : ''}>${n}</button>`; });
  $('#pager').innerHTML = h + `<button type="button" data-pg="${p + 1}" ${p === pages ? 'disabled' : ''} aria-label="ถัดไป">›</button>`;
}
function renderChips(){
  const f = st.f, c = [];
  if (f.q) c.push(['q', `ค้นหา “${f.q}”`]);
  if (f.dept) c.push(['dept', f.dept]);
  if (f.sys) c.push(['role', `${MOD[f.sys].name}: ${roleOf(f.sys, f.role)[1]}`]);
  if (f.special) c.push(['special', 'มีสิทธิ์มากกว่า Staff']);
  if (f.noMail) c.push(['noMail', 'ยังไม่มีอีเมล']);
  $('#chips').innerHTML = c.map(([k, l]) => `<span class="fchip">${esc(l)}<button type="button" data-unf="${k}" aria-label="ลบตัวกรอง ${esc(l)}"><svg class="i" style="width:12px;height:12px"><use href="#i-x"/></svg></button></span>`).join('')
    + (c.length > 1 ? `<button class="fchip clear" type="button" data-unf="all">ล้างตัวกรองทั้งหมด</button>` : '');
}
function renderBars(){
  const list = changeList(), n = list.length;
  $('#changeBar').classList.toggle('open', n > 0);
  if (n) { $('#chN').textContent = n; $('#chSub').textContent = `${new Set(list.map(c => c.empId)).size} คน${st.failed.size ? ` · บันทึกไม่สำเร็จ ${st.failed.size} รายการ` : ''} — มีผลหลังกดบันทึก`; }
  $('#bulkBar').classList.toggle('open', st.selected.size > 0);
  $('#bulkN').textContent = st.selected.size;
}
function renderAll(){ renderCover(); renderTable(); renderBars(); }

/* ==========================================================================================
   POPOVER เลือกบทบาท
   ========================================================================================== */
let popFor = null;
function openPop(btn){
  const id = btn.dataset.emp, sys = btn.dataset.sys, e = st.byId.get(id), cur = eff(e, sys), orig = e.roles[sys] ?? '';
  if (st.failedMods?.has(sys)) { toast('ยังแก้ไม่ได้', `ระบบ ${MOD[sys].name} โหลดไม่สำเร็จ กด “โหลดข้อมูลใหม่” ก่อน`, 'warn'); return; }
  const pop = $('#pop'); pop.style.setProperty('--c', MOD[sys].c);
  pop.innerHTML = `<h4><i></i>${MOD[sys].name} · ${esc(e.name)}</h4>` + MOD[sys].roles.map(r =>
    `<button class="opt" role="menuitemradio" aria-checked="${r[0] === cur}" data-role="${r[0]}" type="button"><span class="n num">${r[0]}</span>
     <span><b>${esc(r[1])}${r[0] === orig && cur !== orig ? ' <span class="was">(เดิม)</span>' : ''}</b><small>${esc(r[2])}</small></span><svg class="i tick"><use href="#i-check"/></svg></button>`).join('')
    + (sys === 'ncr' ? `<p class="note" style="margin:6px 8px 4px"><svg class="i"><use href="#i-info"/></svg>หัวหน้า SCM / SCM คนที่ 2 ตั้งได้ที่ &quot;สิทธิ์รายข้อ&quot; ในหน้ารายละเอียดพนักงาน</p>` : '');
  pop.classList.add('open');
  const b = btn.getBoundingClientRect(), h = pop.offsetHeight, w = pop.offsetWidth;
  let top = b.bottom + 6; if (top + h > innerHeight - 12) top = Math.max(12, b.top - h - 6);
  pop.style.top = top + 'px'; pop.style.left = Math.min(Math.max(12, b.left), innerWidth - w - 12) + 'px';
  popFor = { id, sys, btn };
  (pop.querySelector('[aria-checked="true"]') || pop.querySelector('.opt')).focus();
}
function closePop(refocus = true){ $('#pop').classList.remove('open'); if (refocus && popFor?.btn?.isConnected) popFor.btn.focus(); popFor = null; }
$('#pop').addEventListener('click', ev => {
  const o = ev.target.closest('.opt'); if (!o || !popFor) return;
  const { id, sys } = popFor; setPending(id, sys, o.dataset.role); closePop(false);
  renderAll(); if (st.drawerId === id) renderDrawer();
  document.querySelector(`.panel .role[data-emp="${CSS.escape(id)}"][data-sys="${sys}"]`)?.focus();
});
$('#pop').addEventListener('keydown', ev => {
  const opts = [...$('#pop').querySelectorAll('.opt')], i = opts.indexOf(document.activeElement);
  if (ev.key === 'ArrowDown') { ev.preventDefault(); opts[(i + 1) % opts.length].focus(); }
  if (ev.key === 'ArrowUp') { ev.preventDefault(); opts[(i - 1 + opts.length) % opts.length].focus(); }
});

/* ==========================================================================================
   DRAWER รายละเอียดพนักงาน
   ========================================================================================== */
function openDrawer(id){
  st.drawerId = id; renderDrawer();
  $('#drawer').classList.add('open'); $('#scrim').classList.add('open'); $('#drawer').setAttribute('aria-hidden', 'false');
  document.body.classList.add('dr-open'); $('#drawer [data-close-drawer]')?.focus();
}
function drawerDirty(id){ return !!id && (changeList().some(c => c.empId === id) || pmCount(id) > 0); }
function discardDrawerChanges(id){
  MODULES.forEach(m => { st.pending.delete(pk(id, m.key)); st.failed.delete(pk(id, m.key)); }); st.flags.delete(id); delete PM.pend[id]; renderAll();
}
async function tryCloseDrawer(){
  const id = st.drawerId;
  if (drawerDirty(id)) {
    const ok = await ask('ปิดโดยไม่บันทึก?', 'มี Role หรือสิทธิ์รายข้อที่ยังไม่ได้บันทึกของพนักงานคนนี้ ถ้าปิดตอนนี้การเปลี่ยนแปลงเหล่านั้นจะถูกทิ้ง', 'ปิดและทิ้งการเปลี่ยนแปลง', true);
    if (!ok) return; discardDrawerChanges(id);
  }
  closeDrawer();
}
function closeDrawer(){
  const id = st.drawerId; st.drawerId = null; document.body.classList.remove('dr-open');
  $('#drawer').classList.remove('open'); $('#scrim').classList.remove('open'); $('#drawer').setAttribute('aria-hidden', 'true');
  if (id) document.querySelector(`[data-open="${CSS.escape(id)}"]`)?.focus();
}
function renderDrawer(){
  const e = st.byId.get(st.drawerId); if (!e) return;
  const keepOpen = new Set([...document.querySelectorAll('.sysrole[open]')].map(d => d.dataset.sys));
  const keepEmail = $('#dEmail')?.dataset.emp === e.employeeId ? $('#dEmail').value : e.email;
  const keepNick = $('#dNick')?.dataset.emp === e.employeeId ? $('#dNick').value : e.nickname;
  const me = e.employeeId === currentEmpId, f = effFlags(e), ncrSet = eff(e, 'ncr') !== '';
  $('#drawer').innerHTML = `
  <div class="dr-head">
    <span class="av" style="--h:${hue(e.employeeId)}">${esc((e.name || '?').charAt(0))}</span>
    <div style="min-width:0"><h2>${esc(e.name || 'ไม่มีชื่อในระบบ')}${me ? '<span class="tag-me">คุณ</span>' : ''}</h2><small class="num">${esc(e.employeeId)} · ${esc(e.department || 'ไม่มีแผนก')}</small></div>
    <button class="icon-btn" type="button" data-close-drawer aria-label="ปิด"><svg class="i"><use href="#i-x"/></svg></button>
  </div>
  <div class="dr-body">
    <div class="sec">
      <h3>ข้อมูลพนักงาน</h3>
      <div class="grid2">
        <div class="field"><label><svg class="i" style="width:12px;height:12px"><use href="#i-lock"/></svg>ชื่อ-นามสกุล</label><input value="${esc(e.name)}" readonly></div>
        <div class="field"><label><svg class="i" style="width:12px;height:12px"><use href="#i-lock"/></svg>แผนก</label><input value="${esc(e.department)}" readonly></div>
        <div class="field"><label><svg class="i" style="width:12px;height:12px"><use href="#i-lock"/></svg>รหัสผ่าน</label>
          <div class="pw"><input id="dPass" type="password" value="" placeholder="••••••••" readonly><button type="button" id="dPassEye" aria-label="แสดงรหัสผ่าน"><svg class="i"><use href="#i-eye"/></svg></button></div></div>
        <div class="field"><label>รหัสพนักงาน</label><input value="${esc(e.employeeId)}" readonly></div>
        <div class="field" id="fdEmail"><label for="dEmail">อีเมล</label><input id="dEmail" data-emp="${esc(e.employeeId)}" type="email" value="${esc(keepEmail)}" placeholder="name@ktw.co.th"><p class="err"></p></div>
        <div class="field"><label for="dNick">ชื่อเล่น</label><input id="dNick" data-emp="${esc(e.employeeId)}" maxlength="50" value="${esc(keepNick)}"></div>
      </div>
      <p class="note"><svg class="i"><use href="#i-info"/></svg>ชื่อ แผนก และรหัสผ่านมาจากระบบ SIT และซิงค์ทุก 5 นาที แก้ที่หน้านี้ไม่ได้ ส่วนอีเมลกับชื่อเล่นแก้ได้และจะไม่ถูกเขียนทับ ห้ามแก้รหัสพนักงานเพราะผูกกับเอกสารทุกใบ</p>
    </div>
    <div class="sec">
      <h3>Role แต่ละระบบ<small>เปลี่ยนแล้วกดบันทึกที่แถบด้านล่าง</small></h3>
      ${MODULES.map(m => { const cur = eff(e, m.key), locked = st.failedMods?.has(m.key); return `
      <details class="sysrole" data-sys="${m.key}" style="--c:${m.c}" ${keepOpen.has(m.key) ? 'open' : ''}>
        <summary><span class="nm"><i></i>${m.name}<small>${m.th}</small></span>${roleChip(e, m.key, true)}<svg class="i chev"><use href="#i-chev"/></svg></summary>
        ${locked ? `<p class="note" style="margin:0;padding:10px 14px;border-top:1px solid var(--line);color:var(--danger)"><svg class="i"><use href="#i-alert"/></svg>ระบบนี้โหลดไม่สำเร็จ โหลดข้อมูลใหม่ก่อนแก้ไข</p>` : `
        <div class="opts" role="radiogroup" aria-label="${m.name}">
          ${m.roles.map(r => `<button class="opt" type="button" role="radio" aria-checked="${r[0] === cur}" data-d-sys="${m.key}" data-d-role="${r[0]}">
            <span class="n num">${r[0]}</span><span><b>${esc(r[1])}</b><small>${esc(r[2])}</small></span><svg class="i tick"><use href="#i-check"/></svg></button>`).join('')}
        </div>
        ${m.key === 'ncr' ? `<p class="note" style="margin:0;padding:10px 14px;border-top:1px solid var(--line)"><svg class="i"><use href="#i-info"/></svg>หัวหน้า SCM และ SCM คนที่ 2 ตั้งได้ที่ส่วน "สิทธิ์รายข้อ (Permission)" ด้านล่าง (หมวด NCR)</p>` : ''}`}
      </details>`; }).join('')}
    </div>
    <div class="sec" id="permSec"></div>
  </div>
  <div class="dr-foot">
    ${me ? '<span class="note" style="margin:0;align-self:center">ลบบัญชีตัวเองไม่ได้</span>' : `<button class="btn danger sm" type="button" id="dDelete"><svg class="i"><use href="#i-trash"/></svg>ลบพนักงาน</button>`}
    <button class="btn primary sm" type="button" id="dSave">บันทึกอีเมลและชื่อเล่น</button>
  </div>`;

  $('#drawer').querySelectorAll('[data-d-sys]').forEach(b => b.addEventListener('click', () => {
    setPending(e.employeeId, b.dataset.dSys, b.dataset.dRole); renderAll(); renderDrawer();
  }));
  const onFlag = () => { setFlags(e.employeeId, { isScmHead: $('#dScmHead').checked, isScmSecond: $('#dScmSecond').checked }); renderAll(); renderDrawer(); };
  $('#dScmHead')?.addEventListener('change', onFlag); $('#dScmSecond')?.addEventListener('change', onFlag);
  $('#dPassEye').addEventListener('click', async () => {
    const i = $('#dPass'), show = i.type === 'password';
    // รหัสผ่านไม่ถูกส่งมากับรายชื่อแล้ว — ดึงรายคนจาก webhook ที่เช็ค Admin (ไม่เก็บใน cache / ไม่บันทึก log)
    if (show && !i.value) {
      try {
        const r = await api('GetPassword-User-KTW-switching-system', { emp_id:e.employeeId, requestedByEmpId:actor().empId });
        i.value = String((r && r.password) || '');
        if (!i.value) { toast('ไม่พบรหัสผ่าน', 'พนักงานคนนี้ยังไม่มีรหัสผ่านในระบบ', 'error'); return; }
      } catch (err) { toast('ดูรหัสผ่านไม่สำเร็จ', err.message || 'ไม่มีสิทธิ์', 'error'); return; }
    }
    i.type = show ? 'text' : 'password'; if (!show) i.value = '';
    $('#dPassEye').innerHTML = `<svg class="i"><use href="#${show ? 'i-eye-off' : 'i-eye'}"/></svg>`;
    $('#dPassEye').setAttribute('aria-label', show ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน');
  });
  $('#dSave').addEventListener('click', () => saveProfile(e));
  $('#dDelete')?.addEventListener('click', () => deleteEmployee(e));
  permMount(e);
}

async function saveProfile(e){
  const email = $('#dEmail').value.trim(), nickname = $('#dNick').value.trim(), fe = $('#fdEmail');
  fe.classList.remove('bad');
  if (email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || PLACEHOLDERS.includes(email))) {
    fe.classList.add('bad'); fe.querySelector('.err').textContent = 'รูปแบบอีเมลไม่ถูกต้อง เช่น name@ktw.co.th'; $('#dEmail').focus(); return;
  }
  const btn = $('#dSave'); btn.disabled = true; btn.textContent = 'กำลังบันทึก…';
  try {
    await api('UpdateUser-KTW-switching-system', { emp_id:e.employeeId, name:e.name, email, nickname, dep:e.department,
      updatedBy:actor().name, updatedByEmpId:actor().empId });
    e.email = email; e.nickname = nickname; saveCache();
    toast('บันทึกข้อมูลพนักงานแล้ว', `${e.name} (${e.employeeId})`);
    renderTable(); renderDrawer();
  } catch (err) {
    toast('บันทึกข้อมูลพนักงานไม่สำเร็จ', err.message || 'ลองใหม่อีกครั้ง', 'error');
    btn.disabled = false; btn.textContent = 'บันทึกอีเมลและชื่อเล่น';
  }
}
async function deleteEmployee(e){
  if (e.employeeId === currentEmpId) return;
  const ok = await ask('ลบพนักงานออกจากทุกระบบ?', `<b>${esc(e.name)}</b> (${esc(e.employeeId)}) จะถูกลบออกจากระบบ ย้อนกลับไม่ได้ เอกสารเก่าที่คนนี้สร้างไว้ยังอยู่`, 'ลบพนักงาน', true);
  if (!ok) return;
  try {
    await api('DeleteUser-KTW-switching-system', { employeeId:e.employeeId, emp_id:e.employeeId, deletedBy:actor().name, deletedByEmpId:actor().empId, deletedAt:new Date().toISOString() });
    st.emps = st.emps.filter(x => x.employeeId !== e.employeeId); st.byId.delete(e.employeeId); st.selected.delete(e.employeeId);
    MODULES.forEach(m => { st.pending.delete(pk(e.employeeId, m.key)); st.failed.delete(pk(e.employeeId, m.key)); }); st.flags.delete(e.employeeId);
    saveCache(); closeDrawer(); fillDeptOptions(); renderAll();
    toast('ลบพนักงานแล้ว', `${e.name} (${e.employeeId})`);
  } catch (err) { toast('ลบพนักงานไม่สำเร็จ', err.message || 'อาจไม่พบข้อมูลนี้ในระบบ หรือเชื่อมต่อเซิร์ฟเวอร์ไม่ได้', 'error'); }
}

/* ==========================================================================================
   บันทึกสิทธิ์ (รวมทุกช่องทาง: ตาราง / drawer / เลือกหลายคน / ทั้งแผนก)
   ========================================================================================== */
function changeList(){
  const out = [];
  for (const [k, v] of st.pending) { const [empId, sys] = k.split('|'); const e = st.byId.get(empId); if (!e) continue;
    out.push({ empId, sys, oldRole: e.roles[sys] ?? '', newRole: v, flags: sys === 'ncr' && st.flags.has(empId) ? st.flags.get(empId) : null }); }
  for (const [empId, f] of st.flags) { if (st.pending.has(pk(empId, 'ncr'))) continue; const e = st.byId.get(empId); if (!e) continue;
    out.push({ empId, sys:'ncr', oldRole: e.roles.ncr ?? '', newRole: e.roles.ncr ?? '', flags: f, flagsOnly: true }); }
  return out.filter(c => c.newRole !== '');
}
function describe(c){
  const e = st.byId.get(c.empId), parts = [];
  if (!c.flagsOnly) parts.push(`<s>${esc(roleOf(c.sys, c.oldRole)[1])}</s> → <b>${esc(roleOf(c.sys, c.newRole)[1])}</b>`);
  if (c.flags) {
    if (!!c.flags.isScmHead !== !!e.ncrIsScmHead) parts.push(c.flags.isScmHead ? '<b>ตั้งเป็นหัวหน้า SCM</b>' : 'ถอดหัวหน้า SCM');
    if (!!c.flags.isScmSecond !== !!e.ncrIsScmSecond) parts.push(c.flags.isScmSecond ? '<b>ตั้งเป็น SCM คนที่ 2</b>' : 'ถอด SCM คนที่ 2');
  }
  return parts.join(', ');
}
function openReview(){
  const list = changeList(); const by = new Map();
  list.forEach(c => { if (!by.has(c.empId)) by.set(c.empId, []); by.get(c.empId).push(c); });
  $('#rvSub').textContent = `${list.length} การเปลี่ยนแปลง ใน ${by.size} คน`;
  $('#rvBody').innerHTML = [...by].map(([id, cs]) => { const e = st.byId.get(id); return `<div class="diff">
    <div class="who"><span class="av" style="--h:${hue(id)}">${esc((e.name || '?').charAt(0))}</span><div class="who-n" style="cursor:default"><strong>${esc(e.name)}</strong><small class="num">${esc(id)} · ${esc(e.department)}</small></div></div>
    <div class="ch">${cs.map(c => `<div><span class="sysl">${MOD[c.sys].name}</span>${describe(c)}${st.failed.has(pk(id, c.sys)) ? '<span class="bad">ครั้งก่อนไม่สำเร็จ</span>' : ''}
      <button class="undo" type="button" data-undo="${esc(pk(id, c.sys))}" aria-label="ยกเลิกรายการนี้"><svg class="i" style="width:14px;height:14px"><use href="#i-undo"/></svg></button></div>`).join('')}</div></div>`; }).join('');
  openModal('#mReview'); $('#rvSave').focus();
}
async function saveAll(onlyEmp){
  const list = changeList().filter(c => !onlyEmp || c.empId === onlyEmp); if (!list.length) return;
  // กัน Admin ลดสิทธิ์ตัวเองโดยไม่ตั้งใจ
  const selfDown = list.filter(c => c.empId === currentEmpId && c.oldRole === '1' && c.newRole !== '1');
  if (selfDown.length && !(await ask('ลดสิทธิ์ Admin ของตัวเอง?',
      `คุณกำลังเปลี่ยนสิทธิ์ระบบ <b>${selfDown.map(c => MOD[c.sys].name).join(', ')}</b> ของบัญชีตัวเอง (${esc(currentEmpId)}) ออกจาก Admin หลังบันทึกคุณอาจกลับมาแก้สิทธิ์ระบบนั้นเองไม่ได้อีก`, 'ยืนยันลดสิทธิ์', true))) return;

  const btns = [$('#chSave'), $('#rvSave')]; let done = 0;
  const progress = () => btns.forEach(b => { b.disabled = true; b.textContent = `กำลังบันทึก ${done}/${list.length}`; });
  progress();
  const res = await pool(list, 6, c => {
    const e = st.byId.get(c.empId);
    return api(MOD[c.sys].updateEndpoint, MOD[c.sys].payload(c.empId, c.newRole, e, c.flags)).then(async r => {
      if (!c.flagsOnly) await permSyncRole(c).catch(err => { c.permSyncFail = true; console.error('sync perm ไม่สำเร็จ', c, err); });
      return r; });
  }, () => { done++; progress(); });

  let ok = 0; st.failed.clear();
  res.forEach((r, i) => { const c = list[i], k = pk(c.empId, c.sys), e = st.byId.get(c.empId);
    if (r.ok) { ok++;
      e.roles[c.sys] = c.newRole; st.pending.delete(k);
      if (c.flags) {
        if (c.flags.isScmHead) st.emps.forEach(x => { if (x !== e) x.ncrIsScmHead = false; }); // ตั้งได้คนเดียว (ฝั่ง n8n ถอดคนเดิมให้แล้ว)
        e.ncrIsScmHead = !!c.flags.isScmHead; e.ncrIsScmSecond = !!c.flags.isScmSecond; st.flags.delete(c.empId);
      }
    } else { st.failed.add(k); console.error('บันทึกสิทธิ์ไม่สำเร็จ', c, r.err); }
  });
  saveCache(); permInvalidate();
  if (list.some(c => c.permSyncFail)) toast('Role บันทึกแล้ว แต่ปรับสิทธิ์รายข้อให้ตรงไม่สำเร็จ', 'เปิดสิทธิ์รายข้อของพนักงานคนนั้นเพื่อตรวจสอบ/บันทึกซ้ำ', 'warn');
  btns.forEach(b => { b.disabled = false; b.textContent = 'บันทึกสิทธิ์'; });
  const fail = list.length - ok;
  if (!fail) { closeModal('#mReview'); toast('บันทึกสิทธิ์แล้ว', `${ok} รายการ ใน ${new Set(list.map(c => c.empId)).size} คน`); }
  else if (ok) { toast('บันทึกสำเร็จบางส่วน', `สำเร็จ ${ok} / ไม่สำเร็จ ${fail} รายการ รายการที่ไม่สำเร็จมีกรอบแดงและยังค้างอยู่ กดบันทึกอีกครั้งเพื่อลองใหม่`, 'warn'); openReview(); }
  else toast('บันทึกสิทธิ์ไม่สำเร็จ', 'ไม่มีรายการใดบันทึกได้ ตรวจสอบการเชื่อมต่อแล้วลองใหม่ การเปลี่ยนแปลงยังค้างอยู่', 'error');
  renderAll(); if (st.drawerId) renderDrawer();
}

/* ==========================================================================================
   กำหนดสิทธิ์ทั้งแผนก
   ========================================================================================== */
function openDeptBulk(){
  const deps = [...new Set(st.emps.map(e => e.department).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'th'));
  if (!deps.length) { toast('ยังไม่มีข้อมูล', 'โหลดรายชื่อพนักงานก่อน', 'warn'); return; }
  $('#dpDept').innerHTML = deps.map(d => `<option value="${esc(d)}">${esc(d)} (${st.emps.filter(e => e.department === d).length})</option>`).join('');
  $('#dpDept').value = st.f.dept && deps.includes(st.f.dept) ? st.f.dept : deps[0];
  $('#dpSafe').checked = true;
  $('#dpRows').innerHTML = MODULES.map(m => `<div class="drow" style="--c:${m.c}">
    <span class="nm"><i></i>${m.name}</span><span class="now" data-now="${m.key}"></span>
    <select class="sel" data-dp="${m.key}" aria-label="สิทธิ์ ${m.name}" ${st.failedMods?.has(m.key) ? 'disabled' : ''}>
      <option value="">ไม่เปลี่ยน</option>${m.roles.map(r => `<option value="${r[0]}">${r[0]} ${esc(r[1])}</option>`).join('')}</select></div>`).join('');
  renderDeptBulk(); dppReset(); openModal('#mDept'); $('#dpDept').focus();
}
function deptPlan(){
  const dept = $('#dpDept').value, safe = $('#dpSafe').checked, members = st.emps.filter(e => e.department === dept);
  const plan = [], skipped = new Set();
  document.querySelectorAll('[data-dp]').forEach(s => { const sys = s.dataset.dp, role = s.value; if (role === '') return;
    members.forEach(e => { const cur = eff(e, sys);
      if (cur === role) return;
      if (safe && isElevated(cur)) { skipped.add(e.employeeId); return; }
      plan.push({ id:e.employeeId, sys, role }); }); });
  return { dept, members, plan, skipped };
}
function renderDeptBulk(){
  const { members, plan, skipped } = deptPlan();
  $('#dpN').textContent = members.length;
  MODULES.forEach(m => {
    const cnt = {}; members.forEach(e => { const r = eff(e, m.key); cnt[r] = (cnt[r] || 0) + 1; });
    $(`[data-now="${m.key}"]`).innerHTML = Object.entries(cnt).sort((a, b) => (a[0] === '' ? 99 : +a[0]) - (b[0] === '' ? 99 : +b[0])).map(([r, n]) =>
      `<span class="mini ${r === '' ? 'unset' : isElevated(r) ? 'lvl' : ''}">${esc(roleOf(m.key, r)[1])} ${n}</span>`).join('') || '<span class="mini">ไม่มีพนักงาน</span>';
    const s = $(`[data-dp="${m.key}"]`); s.classList.toggle('set', s.value !== '');
  });
  const people = new Set(plan.map(p => p.id)).size, anySel = [...document.querySelectorAll('[data-dp]')].some(s => s.value !== '');
  const pv = $('#dpPreview');
  pv.classList.toggle('zero', !plan.length);
  pv.innerHTML = `<svg class="i"><use href="#i-info"/></svg><span>${!anySel ? 'เลือกสิทธิ์อย่างน้อย 1 ระบบ'
    : plan.length ? `จะเปลี่ยน <b>${plan.length} รายการ</b> ใน ${people} คน` + (skipped.size ? ` ข้าม ${skipped.size} คนที่มีสิทธิ์พิเศษอยู่แล้ว` : '')
    : 'ทุกคนในแผนกมีสิทธิ์ตามที่เลือกอยู่แล้ว' + (skipped.size ? ` (ข้าม ${skipped.size} คนที่มีสิทธิ์พิเศษ)` : '')}</span>`;
  $('#dpApply').disabled = !plan.length;
  $('#dpLeft').textContent = st.pending.size ? 'จะรวมกับรายการที่ยังไม่บันทึกเดิม' : '';
}
function applyDeptBulk(){
  const { dept, plan } = deptPlan(); if (!plan.length) return;
  plan.forEach(p => setPending(p.id, p.sys, p.role));
  closeModal('#mDept');
  st.f.dept = dept; $('#fDept').value = dept; st.page = 1;
  renderAll();
  toast('เพิ่มเข้ารายการรอบันทึกแล้ว', `${plan.length} รายการในแผนก ${dept} ตรวจดูในตาราง แล้วกด “บันทึกสิทธิ์”`);
}

/* ---- สิทธิ์รายข้อทั้งแผนก (Permission) — เรียก perm_save ทีละคน/ระบบ ด้วยรูปแบบเดียวกับ drawer รายคน ---- */
const DPP_SYS = [['SWAP','SWAP','swap'],['DIS','Disassembly','disassembly'],['NCR','NCR','ncr'],['CLM','Claim','claim'],['BRW','Borrow','borrow'],['PCS','Petty Cash','pettycash'],['PORTAL','หน้าหลัก / เมนูกลาง / Log','']];
const dppMod = sys => (DPP_SYS.find(x => x[0] === sys) || [])[2] || '';
// ตัวเลือกใน Dropdown (เรียงตามที่ Admin กำหนด) — ค่า = เลขหมวดของ Checklist รายคน
const DPP_SECS = [[1,'เมนู'],[10,'หน้าหลัก'],[2,'Swap'],[3,'Disassembly'],[4,'NCR'],[5,'Claim'],[9,'Borrow CTS'],[11,'เงินสดย่อย'],[6,'อนุมัติเอกสาร'],[7,'จัดการผู้ใช้'],[8,'ประวัติ']];
// ลำดับ (และชื่อ) ของรายการในหมวดที่ต้องเรียงเอง: [ระบบ.Action, ชื่อที่แสดง (ถ้าไม่ใส่ใช้ชื่อตาม Catalog)]
const DPP_ORDER = {
  1:[['SWAP.VIEW_MENU'],['DIS.VIEW_MENU'],['NCR.VIEW_MENU'],['CLM.VIEW_MENU'],['BRW.VIEW_MENU'],['PCS.VIEW_MENU'],['PORTAL.MENU_HOME'],['PORTAL.MENU_APPROVE'],['PORTAL.MENU_USER'],['PORTAL.MENU_HISTORY']],
  6:[['SWAP.APPROVE_EXEC','SWAP อนุมัติ เอกสารขอสลับสินค้า ที่ รอผู้บริหาร'],['SWAP.APPROVE_SCM','SWAP อนุมัติ เอกสารขอสลับสินค้า ที่ รอ SCM (ขั้นสุดท้าย)'],
     ['SWAP.DROPDOWN_MCM','SWAP แสดงใน Dropdown รายชื่อ Inbound Document (MCM - คลังเครื่อง)'],['SWAP.DROPDOWN_SPM','SWAP แสดงใน Dropdown รายชื่อ Inbound Document (SPM - คลังอะไหล่)'],
     ['SWAP.REJECT_SCM','SWAP ปฏิเสธ (Reject) เอกสารขอสลับสินค้า'],
     ['DIS.SIGN_MKT','DIS อนุมัติ เอกสารขอแกะอะไหล่ ที่ รอเจ้าหน้าที่การตลาด'],['DIS.APPROVE_FINAL','DIS อนุมัติ เอกสารขอแกะอะไหล่ ที่ รอผู้อนุมัติ (ขั้นสุดท้าย)'],
     ['DIS.CONFIRM_WH','DIS อนุมัติ เอกสารขอแกะอะไหล่ ที่ รอเจ้าหน้าที่คลังจัดสินค้า'],['DIS.CONFIRM_TECH','DIS อนุมัติ เอกสารขอแกะอะไหล่ ที่ รอเจ้าหน้าที่แผนกเทคนิคและช่าง'],
     ['DIS.CONFIRM_SCM','DIS อนุมัติ เอกสารขอแกะอะไหล่ ที่ รอเจ้าหน้าที่แผนก SCM ตรวจสอบ'],['DIS.CONFIRM_PARTS','DIS อนุมัติ เอกสารขอแกะอะไหล่ ที่ รอเจ้าหน้าที่คลังอะไหล่รับของ'],
     ['DIS.REJECT_FINAL','DIS ปฏิเสธ (Reject) เอกสารขอแกะอะไหล่'],
     ['NCR.APPROVE_MID','NCR อนุมัติ เอกสาร NCR ที่ รอผู้บริหาร'],['NCR.APPROVE_MKT','NCR อนุมัติ เอกสาร NCR ที่ รอเจ้าหน้าที่การตลาด'],
     ['NCR.APPROVE_SCM1','NCR อนุมัติ เอกสาร NCR ที่ ขั้น SCM คนที่ 1 (กรอกราคา)'],['NCR.APPROVE_SCM2','NCR อนุมัติ เอกสาร NCR ที่ ขั้น SCM คนที่ 2 (กรอกเลข PO)'],
     ['NCR.APPROVE_SCM_HEAD','NCR อนุมัติ เอกสาร NCR ที่ ขั้น หัวหน้า SCM'],
     ['NCR.APPROVE_LOG','NCR อนุมัติเอกสาร NCR ที่ รอเจ้าหน้าที่แผนกโลจิสติกส์ยืนยัน'],['NCR.APPROVE_SPM','NCR อนุมัติเอกสาร NCR ที่ รอเจ้าหน้าที่แผนกรับเข้าคลังอะไหล่'],
     ['NCR.DROPDOWN_SCM2','NCR แสดงใน Dropdown รายชื่อ มอบหมายให้ SCM คนที่ 2 กรอกเลข PO'],['NCR.REJECT_MID','NCR ปฏิเสธ (Reject) เอกสาร NCR'],
     ['CLM.APPROVE','CLM อนุมัติเอกสารเคลมสินค้าลูกค้า ที่รอผู้พิจารณา (การตลาด/ผู้บริหาร ตามยี่ห้อ)'],['CLM.REJECT_BACK','CLM ปฏิเสธ (Reject) ขอเอกสารเพิ่มเติม ของเอกสารเคลมสินค้าลูกค้า'],
     ['BRW.APPROVE','BRW อนุมัติ/ส่งมอบของ (CTS)'],['BRW.REJECT_BACK','BRW ปฏิเสธเอกสาร (CTS)']],
  7:[['SWAP.USER_ADD'],['SWAP.USER_EDIT'],['SWAP.USER_DELETE'],['SWAP.ASSIGN_ROLE'],['SWAP.MANAGE_PERMISSION'],['CLM.MANAGE_BRAND','CLAIM เพิ่ม/ลบ/แก้ไข ผู้อนุมัติเคลมตามยี่ห้อ']],
  8:[['SWAP.CLEAR_LOG'],['SWAP.VIEW_LOG'],['DIS.CLEAR_LOG'],['DIS.VIEW_LOG'],['NCR.CLEAR_LOG'],['NCR.VIEW_LOG'],['CLM.CLEAR_LOG'],['CLM.VIEW_LOG'],['BRW.VIEW_LOG'],['BRW.CLEAR_LOG']],
};
function dppActs(sec){
  const all = (PM.acts || []).filter(a => pmItemSec(a) === sec), ord = DPP_ORDER[sec];
  if (!ord) return all.map(a => ({ a, label:a.Description }));
  const out = [], used = new Set();
  ord.forEach(([k, lb]) => { const a = all.find(x => x.SystemKey + '.' + x.ActionKey === k); if (a) { used.add(k); out.push({ a, label:lb || a.Description }); } });
  all.forEach(a => { if (!used.has(a.SystemKey + '.' + a.ActionKey)) out.push({ a, label:a.Description }); });
  return out;
}
let dppDur = 'perm';
function dppSetDur(d){ dppDur = d; document.querySelectorAll('[data-dpd]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.dpd === d))); $('#dpPDates').style.display = d === 'range' ? 'flex' : 'none'; renderDeptPerm(); }
function dppReset(){
  $('#dpPSys').innerHTML = DPP_SECS.map(x => `<option value="${x[0]}">${esc(x[1])}</option>`).join('');
  $('#dpPWhy').value = ''; $('#dpPD1').value = ''; $('#dpPD2').value = ''; $('#dpPD1').min = $('#dpPD2').min = pmToday();
  dppSetDur('perm');
  $('#dpPRows').innerHTML = '<p class="preview"><span>กำลังโหลดรายการสิทธิ์…</span></p>';
  permLoad().then(ok => { if (!$('#mDept').classList.contains('open')) return; if (!ok) { $('#dpPRows').innerHTML = `<p class="preview zero"><span>โหลดรายการสิทธิ์ไม่สำเร็จ: ${esc(PM.err || '')}</span></p>`; return; } dppRows(); });
}
function dppRows(){
  const sec = parseInt($('#dpPSys').value, 10), acts = dppActs(sec);
  $('#dpPRows').innerHTML = acts.length ? acts.map(({ a, label }) => `<div class="dpp-row"><div>${esc(label)}<small>${esc(a.SystemKey)}.${esc(a.ActionKey)}</small></div>
    <select class="sel" data-dpp="${esc(a.SystemKey + '|' + a.ActionKey)}" aria-label="${esc(label)}"><option value="">ไม่เปลี่ยน</option><option value="1">เปิด (อนุญาต)</option><option value="0">ปิด (ไม่อนุญาต)</option><option value="clear">ล้างค่ารายคน (กลับไปตาม Role)</option></select></div>`).join('')
    : '<p class="preview zero"><span>ไม่พบรายการสิทธิ์ของหมวดนี้ (ต้องมีเลขหัวข้อ ItemNo) — อาจยังไม่ได้รัน SQL เพิ่มรายการสิทธิ์</span></p>';
  renderDeptPerm();
}
function dppPlan(){
  const dept = $('#dpDept').value, safe = $('#dpSafe').checked, sec = parseInt($('#dpPSys').value, 10);
  const changes = [...document.querySelectorAll('[data-dpp]')].filter(s => s.value !== '').map(s => { const [sys, actionKey] = s.dataset.dpp.split('|');
    return s.value === 'clear' ? { sys, actionKey, mode:'clear' } : { sys, actionKey, mode:'set', allow:s.value === '1' }; });
  const members = st.emps.filter(e => e.department === dept);
  // จัดกลุ่มตามระบบ (perm_save รับทีละระบบ) และข้ามคนที่มีสิทธิ์พิเศษในระบบนั้นเมื่อเปิด "ไม่แตะคนที่มีสิทธิ์พิเศษ"
  const groups = [...new Set(changes.map(c => c.sys))].map(sys => {
    const modKey = dppMod(sys), targets = [], skipped = [];
    members.forEach(e => { if (safe && modKey && isElevated(eff(e, modKey))) skipped.push(e.employeeId); else targets.push(e.employeeId); });
    return { sys, changes:changes.filter(c => c.sys === sys), targets, skipped };
  });
  const targets = [...new Set(groups.flatMap(g => g.targets))], skipped = [...new Set(groups.flatMap(g => g.skipped))].filter(id => !targets.includes(id));
  return { dept, sec, changes, groups, members, targets, skipped };
}
function renderDeptPerm(){
  if (!$('#dpPRows')) return;
  document.querySelectorAll('[data-dpp]').forEach(s => s.classList.toggle('set', s.value !== ''));
  const { changes, targets, skipped } = dppPlan(), pv = $('#dpPPreview');
  pv.classList.toggle('zero', !changes.length || !targets.length);
  pv.innerHTML = `<svg class="i"><use href="#i-info"/></svg><span>${!changes.length ? 'เลือกสิทธิ์อย่างน้อย 1 ข้อ (เปิด / ปิด / ล้างค่า)' : !targets.length ? 'ไม่มีคนในแผนกที่จะเปลี่ยนได้' : `จะตั้ง <b>${changes.length} สิทธิ์</b> ให้ <b>${targets.length} คน</b>` + (skipped.length ? ` ข้าม ${skipped.length} คนที่มีสิทธิ์พิเศษอยู่แล้ว` : '') + ' (บันทึกทันที)'}</span>`;
  $('#dpPApply').disabled = !changes.length || !targets.length;
}
async function applyDeptPerm(){
  const { dept, sec, changes, groups, targets } = dppPlan(); if (!changes.length || !targets.length) return;
  const range = dppDur === 'range', s = range ? $('#dpPD1').value : '', ex = range ? $('#dpPD2').value : '';
  if (range && !ex) { toast('เลือกวันสุดท้ายของสิทธิ์', '', 'warn'); return; }
  if (range && s && ex < s) { toast('วันสุดท้ายต้องไม่ก่อนวันเริ่ม', '', 'warn'); return; }
  const reason = ($('#dpPWhy').value || '').trim() || `ปรับสิทธิ์ทั้งแผนก ${dept} โดย Admin`;
  const secName = (DPP_SECS.find(x => x[0] === sec) || [])[1] || String(sec);
  if (!(await ask('บันทึกสิทธิ์รายข้อทั้งแผนก?', `ตั้ง <b>${changes.length} สิทธิ์</b> ของหมวด <b>${esc(secName)}</b> ให้ <b>${targets.length} คน</b> ในแผนก <b>${esc(dept)}</b><br>บันทึกทันทีและมีผลกับระบบจริง (ย้อนกลับได้โดยตั้ง “ล้างค่ารายคน”)`, 'บันทึกเลย'))) return;
  const btn = $('#dpPApply'); let done = 0; btn.disabled = true;
  const total = groups.reduce((n, g) => n + g.targets.length, 0);
  const prog = () => { btn.textContent = `กำลังบันทึก ${done}/${total}`; }; prog();
  const res = [];
  for (const g of groups) {
    const body = { systemKey:g.sys, reason, changes: g.changes.map(c => c.mode === 'clear' ? { actionKey:c.actionKey, mode:'clear' } : { actionKey:c.actionKey, mode:'set', allow:c.allow, startsAt:s || undefined, expiresAt:ex || undefined }) };
    res.push(...await pool(g.targets, 5, id => permPost('perm_save', { ...body, targetEmpId:id }), () => { done++; prog(); }));
  }
  const ok = res.filter(r => r.ok).length, fail = res.length - ok;
  btn.textContent = 'บันทึกสิทธิ์รายข้อทั้งแผนก';
  permInvalidate(); permLoad();
  if (!fail) { toast('บันทึกสิทธิ์รายข้อทั้งแผนกแล้ว', `${changes.length} สิทธิ์ × ${targets.length} คน (${dept})`); closeModal('#mDept'); }
  else {
    const why = [...new Set(res.filter(r => !r.ok).map(r => (r.err && r.err.message) || 'ไม่สำเร็จ'))].slice(0, 2).join(' / ');
    toast(ok ? 'บันทึกสำเร็จบางส่วน' : 'บันทึกไม่สำเร็จ', `สำเร็จ ${ok} / ไม่สำเร็จ ${fail} ครั้ง — ${why}`, ok ? 'warn' : 'error');
    renderDeptPerm();
  }
  if (st.drawerId) renderDrawer();
}

/* ==========================================================================================
   เพิ่มพนักงาน
   ========================================================================================== */
function openAdd(){
  $('#addForm').reset(); $('#addForm').querySelectorAll('.field.bad').forEach(f => f.classList.remove('bad'));
  $('#nDep').innerHTML = `<option value="">เลือกแผนก</option>` + allDepartments().map(d => `<option value="${esc(d)}">${esc(d)}</option>`).join('');
  $('#nRoles').innerHTML = MODULES.map(m => `<div class="field"><label for="nRole-${m.key}">สิทธิ์ ${m.name}</label>
    <select class="sel" id="nRole-${m.key}" style="max-width:none"><option value="">ตั้งภายหลัง</option>${m.roles.map(r => `<option value="${r[0]}">${r[0]} ${esc(r[1])} (${esc(r[2])})</option>`).join('')}</select></div>`).join('');
  openModal('#mAdd'); $('#nId').focus();
}
$('#nId').addEventListener('input', e => { e.target.value = e.target.value.replace(/[^0-9]/g, ''); });
$('#addForm').addEventListener('submit', async ev => {
  ev.preventDefault();
  const v = { id:$('#nId').value.trim(), pass:$('#nPass').value.trim(), name:$('#nName').value.trim(), nick:$('#nNick').value.trim(), email:$('#nEmail').value.trim(), dep:$('#nDep').value };
  const bad = (fid, msg) => { const f = $(fid); f.classList.add('bad'); f.querySelector('.err').textContent = msg; return false; };
  $('#addForm').querySelectorAll('.field.bad').forEach(f => f.classList.remove('bad'));
  let ok = true;
  if (!v.id) ok = bad('#fAddId', 'กรอกรหัสพนักงาน'); else if (st.byId.has(v.id)) ok = bad('#fAddId', `รหัส ${v.id} มีในระบบแล้ว`);
  if (v.pass.length < 4) ok = bad('#fAddPass', 'อย่างน้อย 4 ตัวอักษร');
  if (!v.name || PLACEHOLDERS.includes(v.name)) ok = bad('#fAddName', 'กรอกชื่อ-นามสกุลจริง');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email) || PLACEHOLDERS.includes(v.email)) ok = bad('#fAddEmail', 'รูปแบบอีเมลไม่ถูกต้อง เช่น name@ktw.co.th');
  if (!v.dep) ok = bad('#fAddDep', 'เลือกแผนก');
  if (!ok) { $('#addForm .field.bad input, #addForm .field.bad select')?.focus(); return; }
  const roles = Object.fromEntries(MODULES.map(m => [m.key, $(`#nRole-${m.key}`).value]));
  const btn = $('#addSave'); btn.disabled = true; btn.textContent = 'กำลังบันทึก…';
  try {
    await api('AddUser-KTW-switching-system', { employeeId:v.id, emp_id:v.id, password:v.pass, emp_pass:v.pass, name:v.name, last_name:v.name,
      email:v.email, nickname:v.nick, department:v.dep, dep:v.dep, createdBy:actor().name, createdByEmpId:currentEmpId || '', createdAt:new Date().toISOString() });
    const emp = { employeeId:v.id, password:v.pass, name:v.name, email:v.email, nickname:v.nick, department:v.dep, roles:{}, ncrIsScmHead:false, ncrIsScmSecond:false };
    MODULES.forEach(m => emp.roles[m.key] = '');
    const failedRoles = [];
    await Promise.all(MODULES.filter(m => roles[m.key] !== '').map(async m => {
      try { await api(m.updateEndpoint, m.payload(v.id, roles[m.key], emp)); emp.roles[m.key] = roles[m.key]; }
      catch (err) { failedRoles.push(m.name); console.error(`ตั้งสิทธิ์เริ่มต้น ${m.name} ไม่สำเร็จ`, err); }
    }));
    st.emps.unshift(emp); st.byId.set(v.id, emp); saveCache(); fillDeptOptions();
    closeModal('#mAdd'); renderAll();
    if (failedRoles.length) toast('เพิ่มพนักงานแล้ว แต่ตั้งสิทธิ์บางระบบไม่สำเร็จ', `ระบบ ${failedRoles.join(', ')} ยังไม่ได้ตั้งสิทธิ์ ตั้งใหม่ได้ในตาราง`, 'warn');
    else toast('เพิ่มพนักงานแล้ว', `${v.name} (${v.id})`);
  } catch (err) {
    toast('เพิ่มพนักงานไม่สำเร็จ', 'ข้อมูลยังไม่ถูกบันทึกลงฐานข้อมูล ' + (err.message || ''), 'error');
  } finally { btn.disabled = false; btn.textContent = 'เพิ่มพนักงาน'; }
});

/* ==========================================================================================
   ผู้อนุมัติเคลมตามยี่ห้อ (เฉพาะ Admin ของ Claim — n8n ตรวจสิทธิ์ซ้ำอีกชั้น)
   ========================================================================================== */
let brandRules = [];
const BRAND_ROLE_NAME = { 2:'Approver (ผู้อนุมัติ / ผู้บริหาร)', 3:'เจ้าหน้าที่การตลาด (MKT)', 4:'MCM', 5:'SPM', 6:'เทคนิคและช่าง (SRV)' };
const CARE_CAN_APPROVE = [2, 3];          // Role ที่อนุมัติเคลมได้จริงตอนนี้
let careRoles = [{ roleId:2, enabled:true }, { roleId:3, enabled:true }, { roleId:4, enabled:false }, { roleId:5, enabled:false }, { roleId:6, enabled:false }];
function fillBrRole(keep){
  const cur = keep ?? $('#brRole').value;
  const ids = careRoles.filter(c => c.enabled).map(c => c.roleId);
  if (keep && !ids.includes(Number(keep))) ids.push(Number(keep));
  ids.sort((a, b) => a - b);
  $('#brRole').innerHTML = ids.map(id => `<option value="${id}">${BRAND_ROLE_NAME[id] || 'Role ' + id}</option>`).join('');
  $('#brRole').value = ids.includes(Number(cur)) ? String(cur) : String(ids[0] ?? '');
}
const ruleActive = r => r.isActive === true || r.isActive === 1 || r.isActive === '1';
let brEditing = null;
function showBrandForm(show){ $('#brForm').classList.toggle('hide', !show); $('#brAdd').disabled = show && !brEditing; if (!show) { brEditing = null; markEditing(); } }
function markEditing(){ document.querySelectorAll('#brBody tr').forEach(tr => tr.classList.toggle('editing', !!brEditing && tr.dataset.key === brEditing)); }
async function openBrand(){
  resetBrandForm(); showBrandForm(false);
  $('#brEmpList').innerHTML = st.emps.map(e => `<option value="${esc(e.employeeId)}">${esc(e.employeeId)} - ${esc(e.name)}</option>`).join('');
  openModal('#mBrand'); await loadBrand();
}
async function loadBrand(){
  $('#brBody').innerHTML = '<tr><td colspan="5" style="color:var(--ink-3)">กำลังโหลด…</td></tr>';
  try { const raw = await api('get_role_members_claim_cus'); const data = (Array.isArray(raw) ? raw[0] : raw) || {}; brandRules = Array.isArray(data.rules) ? data.rules : []; if (Array.isArray(data.careRoles) && data.careRoles.length) careRoles = data.careRoles.map(c => ({ roleId:Number(c.roleId), enabled:!!c.enabled })); }
  catch (err) { console.error('loadBrand', err); $('#brBody').innerHTML = '<tr><td colspan="5" style="color:var(--danger)">โหลดกติกาไม่สำเร็จ ลองใหม่อีกครั้ง</td></tr>'; return; }
  $('#brBody').innerHTML = brandRules.length ? brandRules.map(r => `<tr data-key="${esc(r.brandKey)}" class="${ruleActive(r) ? '' : 'off'}">
    <td><b>${esc(r.brandKey)}</b></td>
    <td>${BRAND_ROLE_NAME[Number(r.approverRoleId)] || 'Role ' + esc(r.approverRoleId)}<small>${r.approverEmpId ? `${esc(r.approverName || r.approverEmpId)} (${esc(r.approverEmpId)})` : 'ทุกคนที่มีสิทธิ์ฝ่ายนี้'}</small></td>
    <td>${esc(r.note) || '<span style="color:var(--ink-3)">–</span>'}</td>
    <td>${ruleActive(r) ? '<span style="color:var(--ok);font-weight:600">เปิด</span>' : '<span style="color:var(--ink-3)">ปิด</span>'}</td>
    <td style="text-align:right;white-space:nowrap"><button class="btn sm" type="button" data-edit-rule="${esc(r.brandKey)}">แก้ไข</button> <button class="btn danger sm" type="button" data-del-rule="${esc(r.brandKey)}"><svg class="i"><use href="#i-trash"/></svg>ลบ</button></td></tr>`).join('')
    : '<tr><td colspan="5" style="color:var(--ink-3)">ยังไม่มีกติกา ทุกยี่ห้อใช้เจ้าหน้าที่การตลาดเป็นผู้อนุมัติ กด “เพิ่มยี่ห้อ” เพื่อเริ่ม</td></tr>';
  $('#brCount').textContent = brandRules.length ? `${brandRules.length} ยี่ห้อ เปิดใช้ ${brandRules.filter(ruleActive).length}` : '';
  fillBrRole();
  markEditing();
}
function resetBrandForm(){
  $('#brFormTitle').textContent = 'เพิ่มกติกายี่ห้อใหม่';
  $('#brKey').value = ''; $('#brKey').readOnly = false; fillBrRole(careRoles.some(c => c.enabled && c.roleId === 2) ? '2' : undefined); $('#brEmp').value = ''; $('#brNote').value = ''; $('#brActive').checked = true;
}
function editBrand(key){
  const r = brandRules.find(x => String(x.brandKey) === key); if (!r) return;
  $('#brFormTitle').textContent = 'แก้ไขกติกายี่ห้อ ' + r.brandKey;
  $('#brKey').value = r.brandKey; $('#brKey').readOnly = true;
  fillBrRole(String(r.approverRoleId));
  $('#brEmp').value = r.approverEmpId || ''; $('#brNote').value = r.note || ''; $('#brActive').checked = ruleActive(r);
  brEditing = r.brandKey; showBrandForm(true); markEditing();
  $('#brForm').scrollIntoView({ block:'nearest', behavior:'smooth' }); $('#brRole').focus();
}
async function deleteBrand(key){
  const r = brandRules.find(x => String(x.brandKey) === key); if (!r) return;
  const ok = await ask('ลบกติกายี่ห้อ ' + r.brandKey + '?', `ยี่ห้อ <b>${esc(r.brandKey)}</b> จะกลับไปใช้เจ้าหน้าที่การตลาดเป็นผู้อนุมัติ เอกสารเก่าที่สร้างไปแล้วไม่ได้รับผลกระทบ หากต้องการหยุดชั่วคราวให้กด “แก้ไข” แล้วปิดใช้งานแทน`, 'ลบกติกา', true);
  if (!ok) return;
  try {
    const res = await api('delete_brand_rule_claim_cus', { actorEmpId:actor().empId, brandKey:r.brandKey });
    toast('ลบกติกาแล้ว', (res && res.message) || `ยี่ห้อ ${r.brandKey}`);
    if (brEditing === r.brandKey) { resetBrandForm(); showBrandForm(false); }
    await loadBrand();
  } catch (err) { toast('ลบกติกาไม่สำเร็จ', err.message, 'error'); }
}
async function saveBrand(){
  const brandKey = $('#brKey').value.trim().toUpperCase();
  if (!brandKey) { toast('ข้อมูลไม่ครบ', 'กรุณาระบุยี่ห้อ', 'error'); $('#brKey').focus(); return; }
  if (!brEditing && brandRules.some(r => String(r.brandKey).toUpperCase() === brandKey)) {
    toast('มียี่ห้อนี้แล้ว', `${brandKey} มีกติกาอยู่แล้ว กด “แก้ไข” ที่แถวนั้นแทน`, 'warn'); $('#brKey').focus(); return; }
  const empId = $('#brEmp').value.trim().split(/\s+-\s+/)[0].trim();
  const btn = $('#brSave'); btn.disabled = true;
  try {
    const res = await api('save_brand_rule_claim_cus', { actorEmpId:actor().empId, brandKey, approverRoleId:parseInt($('#brRole').value, 10),
      approverEmpId:empId, note:$('#brNote').value.trim(), isActive:$('#brActive').checked });
    toast('บันทึกกติกาแล้ว', (res && res.message) || `ยี่ห้อ ${brandKey}`);
    resetBrandForm(); showBrandForm(false); await loadBrand();
  } catch (err) { toast('บันทึกกติกาไม่สำเร็จ', err.message, 'error'); }
  finally { btn.disabled = false; }
}
$('#brKey').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase(); });
$('#brCancel').addEventListener('click', () => { resetBrandForm(); showBrandForm(false); $('#brAdd').focus(); });
$('#brAdd').addEventListener('click', () => { brEditing = null; resetBrandForm(); showBrandForm(true); markEditing(); $('#brKey').focus(); });
$('#brSave').addEventListener('click', saveBrand);

/* ผู้ดูแลยี่ห้อสินค้า: เปิด/ปิด Role ที่จะขึ้นใน dropdown "ผู้อนุมัติฝ่าย" */
function renderCare(){
  $('#careList').innerHTML = careRoles.map(c => {
    const can = CARE_CAN_APPROVE.includes(c.roleId);
    return `<label class="care-row"><span class="nm">${esc(BRAND_ROLE_NAME[c.roleId] || 'Role ' + c.roleId)}<small class="${can ? '' : 'warn'}">${can ? 'อนุมัติเคลมได้' : 'Role นี้ยังไม่มีสิทธิ์อนุมัติเคลม — ถ้าเปิดและผูกกับยี่ห้อ เอกสารจะรอจนกว่า Admin อนุมัติแทน'}</small></span>
      <span class="sw"><input type="checkbox" data-care="${c.roleId}" ${c.enabled ? 'checked' : ''} aria-label="${esc(BRAND_ROLE_NAME[c.roleId] || '')}"><span></span></span></label>`;
  }).join('');
}
$('#brCare').addEventListener('click', () => { renderCare(); openModal('#mCare'); });
$('#careSave').addEventListener('click', async () => {
  const roles = [...document.querySelectorAll('#careList [data-care]')].map(i => ({ roleId:Number(i.dataset.care), enabled:i.checked }));
  const btn = $('#careSave'); btn.disabled = true;
  try {
    const res = await api('save_brand_care_roles_claim_cus', { actorEmpId:actor().empId, roles });
    careRoles = roles; fillBrRole(); closeModal('#mCare');
    toast('บันทึกแล้ว', (res && res.message) || 'อัปเดตฝ่ายผู้ดูแลยี่ห้อสินค้า');
  } catch (err) { toast('บันทึกไม่สำเร็จ', err.message, 'error'); }
  finally { btn.disabled = false; }
});
if (claimRoleSession === '1') $('#btnBrandRules').classList.remove('hide');

/* ==========================================================================================
   MODAL / ASK / TOAST
   ========================================================================================== */
let lastFocus = null;
function openModal(sel){ lastFocus = document.activeElement; $(sel).classList.add('open'); }
function closeModal(sel){ $(sel).classList.remove('open'); if (lastFocus?.isConnected) lastFocus.focus(); }
function ask(title, html, yes = 'ยืนยัน', danger = false){
  return new Promise(resolve => {
    $('#askTitle').textContent = title; $('#askBody').innerHTML = html;
    const y = $('#askYes'), n = $('#askNo');
    y.textContent = yes; y.className = 'btn ' + (danger ? 'danger-solid' : 'primary');
    const prev = document.activeElement; $('#mAsk').classList.add('open'); n.focus();
    const done = v => { $('#mAsk').classList.remove('open'); y.onclick = n.onclick = null; $('#mAsk').onkeydown = null; prev?.focus?.(); resolve(v); };
    y.onclick = () => done(true); n.onclick = () => done(false);
    $('#mAsk').onkeydown = ev => { if (ev.key === 'Escape') { ev.stopPropagation(); done(false); } };
  });
}
function toast(title, msg = '', type = 'ok'){
  const t = document.createElement('div'); t.className = 'toast ' + (type === 'ok' ? '' : type);
  t.innerHTML = `<svg class="i"><use href="#${type === 'ok' ? 'i-check' : 'i-alert'}"/></svg><div style="flex:1"><b>${esc(title)}</b>${msg ? `<span>${esc(msg)}</span>` : ''}</div>
    <button class="icon-btn" type="button" style="width:24px;height:24px" aria-label="ปิด"><svg class="i" style="width:14px;height:14px"><use href="#i-x"/></svg></button>`;
  t.querySelector('button').onclick = () => t.remove();
  $('#toasts').appendChild(t); setTimeout(() => t.remove(), type === 'ok' ? 4000 : 8000);
}
function toggleMobileMenu(){
  const m = document.getElementById('mobile-sidebar'), i = document.getElementById('mobileMenuBtn');
  const show = m.classList.contains('hidden'); m.classList.toggle('hidden', !show);
  i.setAttribute('data-lucide', show ? 'x' : 'menu'); if (window.lucide) lucide.createIcons();
}

/* ==========================================================================================
   EVENTS
   ========================================================================================== */
document.addEventListener('click', ev => {
  const t = ev.target;
  const role = t.closest('.panel button.role'); if (role) { ev.stopPropagation(); popFor?.btn === role ? closePop() : openPop(role); return; }
  if (popFor && !t.closest('#pop')) closePop(false);
  const lg = t.closest('.lg'); if (lg) { const s = lg.dataset.sys, r = lg.dataset.role;
    if (st.f.sys === s && st.f.role === r) { st.f.sys = ''; st.f.role = null; } else { st.f.sys = s; st.f.role = r; }
    st.page = 1; renderCover(); renderTable(); return; }
  const op = t.closest('[data-open]'); if (op) { openDrawer(op.dataset.open); return; }
  if (t.closest('[data-close-drawer]') || t.id === 'scrim') { tryCloseDrawer(); return; }
  const srt = t.closest('[data-sort]'); if (srt) { const k = srt.dataset.sort; st.sort = st.sort.key === k ? { key:k, dir:-st.sort.dir } : { key:k, dir: MOD[k] ? -1 : 1 }; renderTable(); return; }
  const pg = t.closest('[data-pg]'); if (pg && !pg.disabled) { st.page = +pg.dataset.pg; renderTable(); $('.panel').scrollIntoView({ block:'start', behavior:'smooth' }); return; }
  const un = t.closest('[data-unf]'); if (un) { const k = un.dataset.unf, all = k === 'all';
    if (all || k === 'q') { st.f.q = ''; $('#q').value = ''; }
    if (all || k === 'dept') { st.f.dept = ''; $('#fDept').value = ''; }
    if (all || k === 'role') { st.f.sys = ''; st.f.role = null; }
    if (all || k === 'special') { st.f.special = false; $('#fSpecial').setAttribute('aria-pressed', 'false'); }
    if (all || k === 'noMail') { st.f.noMail = false; $('#fNoMail').setAttribute('aria-pressed', 'false'); }
    st.page = 1; renderCover(); renderTable(); return; }
  const ud = t.closest('[data-undo]'); if (ud) { const [id, sys] = ud.dataset.undo.split('|');
    st.pending.delete(ud.dataset.undo); st.failed.delete(ud.dataset.undo); if (sys === 'ncr') st.flags.delete(id);
    renderAll(); if (st.drawerId) renderDrawer(); changeList().length ? openReview() : closeModal('#mReview'); return; }
  const er = t.closest('[data-edit-rule]'); if (er) { editBrand(er.dataset.editRule); return; }
  const dr = t.closest('[data-del-rule]'); if (dr) { deleteBrand(dr.dataset.delRule); return; }
  const cm = t.closest('.modal [data-close]'); if (cm) { closeModal('#' + cm.closest('.modal').id); return; }
});
document.addEventListener('change', ev => {
  const t = ev.target;
  if (t.id === 'ckAll') { pageSlice(filtered()).forEach(e => t.checked ? st.selected.add(e.employeeId) : st.selected.delete(e.employeeId)); renderTable(); renderBars(); }
  if (t.dataset.ck) { t.checked ? st.selected.add(t.dataset.ck) : st.selected.delete(t.dataset.ck); t.closest('tr').classList.toggle('picked', t.checked); renderHead(filtered()); renderBars(); }
  if (t.dataset.dp !== undefined || t.id === 'dpDept' || t.id === 'dpSafe') renderDeptBulk();
  if (t.id === 'dpPSys') dppRows();
  else if (t.dataset.dpp !== undefined || t.id === 'dpDept' || t.id === 'dpSafe') renderDeptPerm();
});
document.addEventListener('keydown', ev => {
  if (ev.key === 'Escape') {
    if ($('#mAsk').classList.contains('open')) return;
    if (popFor) return closePop();
    const open = [...document.querySelectorAll('.modal.open')].pop(); if (open) return closeModal('#' + open.id);
    if (st.drawerId) return tryCloseDrawer();
  }
  if (ev.key === '/' && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) && !document.querySelector('.modal.open')) { ev.preventDefault(); $('#q').focus(); }
});
window.addEventListener('scroll', () => popFor && closePop(false), { passive:true });
window.addEventListener('beforeunload', ev => { if (changeList().length) { ev.preventDefault(); ev.returnValue = ''; } });

let qT; $('#q').addEventListener('input', e => { clearTimeout(qT); qT = setTimeout(() => { st.f.q = e.target.value; st.page = 1; renderTable(); }, 150); });
$('#fDept').addEventListener('change', e => { st.f.dept = e.target.value; st.page = 1; renderTable(); });
$('#fSpecial').addEventListener('click', e => { st.f.special = !st.f.special; e.currentTarget.setAttribute('aria-pressed', st.f.special); st.page = 1; renderTable(); });
$('#fNoMail').addEventListener('click', e => { st.f.noMail = !st.f.noMail; e.currentTarget.setAttribute('aria-pressed', st.f.noMail); st.page = 1; renderTable(); });
$('#pageSize').addEventListener('change', e => { st.size = +e.target.value; st.page = 1; renderTable(); });
$('#btnDeptBulk').addEventListener('click', openDeptBulk);
$('#dpApply').addEventListener('click', applyDeptBulk);
$('#dpPApply').addEventListener('click', applyDeptPerm);
document.querySelectorAll('[data-dpd]').forEach(b => b.addEventListener('click', () => dppSetDur(b.dataset.dpd)));
$('#chDiscard').addEventListener('click', async () => {
  const n = changeList().length;
  if (await ask('ยกเลิกการเปลี่ยนแปลงทั้งหมด?', `${n} รายการที่ยังไม่บันทึกจะหายไป`, 'ยกเลิกทั้งหมด', true)) {
    st.pending.clear(); st.flags.clear(); st.failed.clear(); renderAll(); if (st.drawerId) renderDrawer(); }
});
$('#chReview').addEventListener('click', openReview);
// ⚠️ ห้ามส่ง saveAll ตรงๆ: addEventListener จะส่ง Event เข้าไปเป็น onlyEmp ทำให้กรองรายการจนว่างแล้วไม่บันทึกอะไรเลย
$('#chSave').addEventListener('click', () => saveAll());
$('#rvSave').addEventListener('click', () => saveAll());
$('#btnAdd').addEventListener('click', openAdd);
$('#btnBrandRules').addEventListener('click', openBrand);
$('#btnReload').addEventListener('click', async () => {
  if (changeList().length && !(await ask('โหลดข้อมูลใหม่?', 'การเปลี่ยนแปลงที่ยังไม่บันทึกจะหายไป', 'โหลดใหม่', true))) return;
  loadAll();
});

function fillBulkRoles(){ const m = MOD[$('#bulkSys').value]; $('#bulkRole').innerHTML = m.roles.map(r => `<option value="${r[0]}">${r[0]} ${esc(r[1])}</option>`).join(''); }
$('#bulkSys').innerHTML = MODULES.map(m => `<option value="${m.key}">${m.name}</option>`).join(''); fillBulkRoles();
$('#bulkSys').addEventListener('change', fillBulkRoles);
$('#bulkApply').addEventListener('click', () => {
  const sys = $('#bulkSys').value, r = $('#bulkRole').value, n = st.selected.size;
  if (st.failedMods?.has(sys)) { toast('ยังแก้ไม่ได้', `ระบบ ${MOD[sys].name} โหลดไม่สำเร็จ`, 'warn'); return; }
  st.selected.forEach(id => setPending(id, sys, r)); st.selected.clear(); renderAll();
  toast('เพิ่มเข้ารายการรอบันทึกแล้ว', `${MOD[sys].name} เป็น ${roleOf(sys, r)[1]} ให้ ${n} คน กด “บันทึกสิทธิ์” เพื่อยืนยัน`);
});
$('#bulkClear').addEventListener('click', () => { st.selected.clear(); renderTable(); renderBars(); });

/* ==========================================================================================
   INIT
   ========================================================================================== */
window.addEventListener('load', () => {
  if (typeof renderSidebar === 'function') renderSidebar();
  const mob = document.getElementById('mobile-sidebar-content'), side = document.getElementById('sidebar-container');
  if (mob && side) mob.innerHTML = side.innerHTML;
  if (typeof n8nFetch !== 'function') { toast('โหลด api.js ไม่สำเร็จ', 'ตรวจว่าไฟล์ api.js อยู่โฟลเดอร์เดียวกับหน้านี้', 'error'); return; }
  loadAll();
});
// --- sub-module block ---

// --- sub-module block ---
/* ==========================================================================================
   PERMISSION รายข้อ — ใช้ API perm_* (Phase 4a/4b) ฝังใน drawer เดิม
   Role (ที่เลือกด้านบน) = เทมเพลตตั้งต้น, สวิตช์ในส่วนนี้ = ปรับรายคน (override) ที่ทับเทมเพลต
   ========================================================================================== */
const PM_SYS = { swap:'SWAP', disassembly:'DIS', ncr:'NCR', claim:'CLM', borrow:'BRW', pettycash:'PCS' };
// legacy RoleId -> [level, dept] (ตรงกับ perm.LegacyRoleMap)
const PM_MAP = {
  common:{ 0:['STAFF','NONE'],1:['ADMIN','ALL'],2:['DIRECTOR','ALL'],3:['STAFF','MKT'],4:['STAFF','MCM'],5:['STAFF','SPM'],6:['STAFF','SRV'],7:['STAFF','SCM'],8:['STAFF','PQM'] },
  SWAP:{ 0:['STAFF','NONE'],1:['ADMIN','ALL'],2:['DIRECTOR','ALL'],3:['STAFF','SCM'],6:['STAFF','MCM'],7:['STAFF','SPM'] },
};
const pmLD = (sys, role) => (sys === 'SWAP' ? PM_MAP.SWAP : PM_MAP.common)[parseInt(role, 10)] || null;
const PM_SEC = {1:'เมนู',2:'SWAP',3:'Disassembly',4:'NCR',5:'Claim',6:'อนุมัติ / ปฏิเสธ',7:'ผู้ใช้ / ตั้งค่า',8:'Log',9:'Borrow (CTS)',10:'หน้าหลัก (Main)',11:'เงินสดย่อย (Petty Cash)'};
const PM = { cat:null, usr:null, loading:null, err:'', sec:2, pend:{}, tpl:{}, ulv:{}, udp:{}, ovr:{}, acts:[], warn:new Map() };
const pmK = (...a) => a.join('|');
const pmD10 = v => v ? String(v).slice(0, 10) : '';
const pmToday = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); };
// สิทธิ์ที่ไม่แสดงใน Checklist (ยังอยู่ในระบบ ใช้ค่าตาม Role/เทมเพลตตามเดิม): NCR ปฏิเสธรายขั้น MKT/SCM/LOG/SPM
const PM_HIDE = new Set(['NCR.REJECT_MKT','NCR.REJECT_SCM','NCR.REJECT_LOG','NCR.REJECT_SPM']);
// ย้ายหมวดเฉพาะการแสดงผล: เห็นเมนู ขออนุมัติยืมสินค้าหน้าร้าน (BRW.VIEW_MENU) ไปอยู่หมวด 1 เมนู
const PM_MOVE = { 'BRW.VIEW_MENU':'1.9' };
const pmItemSec = a => parseInt(String(a.ItemNo).split('.')[0], 10);
const pmItemOrd = a => String(a.ItemNo).split('.').map(x => x.padStart(3, '0')).join('.');
function pmOvState(o){ if (!o) return null; const t = pmToday(), s = pmD10(o.StartsAt), e = pmD10(o.ExpiresAt);
  if (e && e <= t) return 'expired'; if (s && s > t) return 'future'; return 'active'; }
function permInvalidate(){ PM.cat = null; PM.usr = null; PM.loading = null; }
async function permPost(path, body){ return api(path, { actorEmpId:currentEmpId, ...(body || {}) }); }
function permIndex(){
  PM.tpl = {}; PM.cat.templates.forEach(t => PM.tpl[[t.SystemKey,t.LevelKey,t.DeptKey,t.ActionKey].join('|')] = !!t.Allow);
  PM.ulv = {}; PM.usr.levels.forEach(x => PM.ulv[pmK(x.EmpId,x.SystemKey)] = x.LevelKey);
  PM.udp = {}; PM.usr.depts.forEach(x => (PM.udp[pmK(x.EmpId,x.SystemKey)] = PM.udp[pmK(x.EmpId,x.SystemKey)] || []).push(x.DeptKey));
  PM.ovr = {}; PM.usr.overrides.forEach(o => PM.ovr[[o.EmpId,o.SystemKey,o.ActionKey].join('|')] = o);
  PM.warn = new Map((PM.usr.roleWarn || []).map(w => [w.EmpId, w.RoleAt]));
  // เรียงตามหมวด → ระบบ (SWAP, DIS, NCR, CLM, BRW) → ลำดับหัวข้อ เพื่อให้แท็บที่รวมหลายระบบ (เช่น 6. อนุมัติ/ปฏิเสธ, 8. Log) แยกเป็นกลุ่มตามระบบ
  const sysIx = a => { const i = Object.values(PM_SYS).indexOf(a.SystemKey); return i < 0 ? 99 : i; };
  PM.acts = PM.cat.actions.filter(a => a.ItemNo && !PM_HIDE.has(a.SystemKey + '.' + a.ActionKey)).map(a => PM_MOVE[a.SystemKey + '.' + a.ActionKey] ? { ...a, ItemNo:PM_MOVE[a.SystemKey + '.' + a.ActionKey] } : a).sort((a, b) => (pmItemSec(a) - pmItemSec(b)) || (sysIx(a) - sysIx(b)) || pmItemOrd(a).localeCompare(pmItemOrd(b)));
}
function permLoad(){
  if (PM.cat && PM.usr) return Promise.resolve(true);
  if (PM.loading) return PM.loading;
  PM.loading = Promise.all([permPost('perm_catalog'), permPost('perm_users')]).then(([c, u]) => {
    if (!c || !c.success || !u || !u.success) throw new Error((c && c.error) || (u && u.error) || 'โหลดไม่สำเร็จ');
    PM.cat = c; PM.usr = u; PM.err = ''; permIndex(); return true;
  }).catch(err => { PM.err = err.message || 'โหลดไม่สำเร็จ'; return false; }).finally(() => { PM.loading = null; });
  return PM.loading;
}
// Level/Dept ที่ใช้เป็นเทมเพลต: ถ้ากำลังเปลี่ยน Role ค้างอยู่ ให้ดูตามผลของ Role ใหม่
function pmLevelDept(emp, sys){
  const modKey = Object.keys(PM_SYS).find(k => PM_SYS[k] === sys);
  if (modKey && st.pending.has(pk(emp, modKey))) { const m = pmLD(sys, st.pending.get(pk(emp, modKey))); if (m) return { level:m[0], depts:[m[1]] }; }
  return { level:PM.ulv[pmK(emp, sys)] || '', depts:PM.udp[pmK(emp, sys)] || [] };
}
function pmTpl(emp, sys, act){ const { level, depts } = pmLevelDept(emp, sys); return depts.some(d => PM.tpl[[sys,level,d,act].join('|')]); }
function pmEff(emp, a){
  const p = PM.pend[emp] && PM.pend[emp][a.SystemKey];
  if (p && a.ActionKey in p) return { on:p[a.ActionKey], pend:true };
  const o = PM.ovr[[emp, a.SystemKey, a.ActionKey].join('|')], s = pmOvState(o);
  if (o && (s === 'active')) return { on:!!o.Allow, ov:o, s };
  return { on:pmTpl(emp, a.SystemKey, a.ActionKey), ov:o, s };
}
const pmCount = emp => Object.values(PM.pend[emp] || {}).reduce((n, x) => n + Object.keys(x).length, 0);
function pmToggle(emp, a){
  const sysP = (PM.pend[emp] = PM.pend[emp] || {}), p = (sysP[a.SystemKey] = sysP[a.SystemKey] || {});
  const cur = pmEff(emp, a).on, want = !cur;
  const o = PM.ovr[[emp, a.SystemKey, a.ActionKey].join('|')];
  const base = (o && pmOvState(o) === 'active') ? !!o.Allow : pmTpl(emp, a.SystemKey, a.ActionKey);
  if (want === base) delete p[a.ActionKey]; else p[a.ActionKey] = want;
  if (!Object.keys(p).length) delete sysP[a.SystemKey]; if (!Object.keys(sysP).length) delete PM.pend[emp];
}
// หัวหน้า SCM (NCR) มีได้คนเดียว: แสดงคนปัจจุบัน และเตือนว่าตั้งคนใหม่จะถอดคนเดิมออก
function pmHint(emp, a){
  if (a.SystemKey !== 'NCR' || a.ActionKey !== 'APPROVE_SCM_HEAD') return '';
  const holders = (PM.usr.overrides || []).filter(o => o.SystemKey === 'NCR' && o.ActionKey === 'APPROVE_SCM_HEAD' && o.Allow && pmOvState(o) === 'active' && o.EmpId !== emp)
    .map(o => { const x = st.emps.find(y => y.employeeId === o.EmpId); return x ? x.name : o.EmpId; });
  const on = pmEff(emp, a).on, pend = PM.pend[emp] && PM.pend[emp].NCR && a.ActionKey in PM.pend[emp].NCR;
  if (pend && on && holders.length) return `<small style="color:var(--danger)">มีได้คนเดียว: เมื่อบันทึก ระบบจะถอด ${esc(holders.join(', '))} ออกจากหัวหน้า SCM</small>`;
  return holders.length ? `<small>มีได้คนเดียว (ปัจจุบัน: ${esc(holders.join(', '))}) ตั้งคนใหม่ระบบจะถอดคนเดิมให้</small>` : '<small>มีได้คนเดียว ตั้งคนใหม่ระบบจะถอดคนเดิมให้</small>';
}
function pmRow(emp, a, showSys){
  const e = pmEff(emp, a); let cls = '', b = '<span class="pm-b">ตาม Role</span>';
  if (e.pend) { cls = 'pend'; b = '<span class="pm-b pend">รอบันทึก</span>'; }
  else if (e.ov && e.s === 'active') b = e.ov.Allow ? '<span class="pm-b add">+ เพิ่มรายคน</span>' : '<span class="pm-b rem">− ถอดรายคน</span>';
  else if (e.ov && e.s === 'future') b = '<span class="pm-b">จะเริ่มใช้ ' + esc(pmD10(e.ov.StartsAt)) + '</span>';
  return `<div class="pm-row ${cls}"><button type="button" class="pm-sw" role="switch" aria-checked="${e.on}" aria-label="${esc(a.Description)}" data-pm="${esc(a.SystemKey + '|' + a.ActionKey)}"></button>
    <div><b>${showSys ? `<span class="pm-sys">${esc(a.SystemKey)}</span>` : ''}${esc(a.Description)}</b>${a.NeedVerify ? '<small>ต้องยืนยันตัวตนเพิ่ม</small>' : ''}${pmHint(emp, a)}</div>${b}</div>`;
}
function permMount(e){
  const box = $('#permSec'); if (!box) return;
  const emp = e.employeeId;
  if (!PM.cat) {
    if (PM.err) {
      box.innerHTML = `<h3>สิทธิ์รายข้อ (Permission)</h3><p class="note" style="margin:0;color:var(--danger)"><svg class="i"><use href="#i-alert"/></svg>โหลดสิทธิ์รายข้อไม่สำเร็จ (${esc(PM.err)}) ส่วนนี้ใช้ได้เฉพาะผู้ที่มีสิทธิ์จัดการสิทธิ์ <button class="btn sm" type="button" id="pmRetry" style="margin-left:8px">ลองใหม่</button></p>`;
      $('#pmRetry').addEventListener('click', () => { PM.err = ''; permMount(e); }); return;
    }
    box.innerHTML = `<h3>สิทธิ์รายข้อ (Permission)<small>ปรับรายคนที่ต่างจาก Role</small></h3><p class="note" style="margin:0">กำลังโหลด…</p>`;
    permLoad().then(() => { if (st.drawerId === emp) permMount(e); }); return;
  }
  const known = PM.usr.users.some(u => u.EmpId === emp);
  const nav = Object.entries(PM_SEC).map(([n, t]) => {
    const c = Object.entries(PM.pend[emp] || {}).reduce((x, [sy, p]) => x + Object.keys(p).filter(k => { const a = PM.acts.find(z => z.SystemKey === sy && z.ActionKey === k); return a && pmItemSec(a) === +n; }).length, 0);
    return `<button type="button" data-pmsec="${n}" aria-pressed="${+n === PM.sec}">${n}. ${esc(t)}${c ? `<i>${c}</i>` : ''}</button>`; }).join('');
  const rows = PM.acts.filter(a => pmItemSec(a) === PM.sec);
  const nr = changeList().filter(c => c.empId === emp).length, n = pmCount(emp) + nr;
  box.innerHTML = `<h3>สิทธิ์รายข้อ (Permission)<small>Role ด้านบนเป็นค่าตั้งต้น สวิตช์ด้านล่างปรับเฉพาะคนนี้</small></h3>
    ${PM.warn.has(emp) ? `<div class="pm-warn"><svg class="i"><use href="#i-alert"/></svg><span>มีการเปลี่ยน Role โปรดตรวจเช็คสิทธิ์ให้ถูกต้อง (สิทธิ์เฉพาะคนที่เคยตั้งไว้ยังคงอยู่) แจ้งเตือนนี้จะหายเมื่อบันทึกสิทธิ์รายข้อ</span></div>` : ''}
    ${PM.acts.length ? '' : '<div class="pm-warn"><svg class="i"><use href="#i-alert"/></svg><span>ไม่พบรายการสิทธิ์ที่มีเลขหัวข้อ (ItemNo) — Permission API น่าจะยังเป็นเวอร์ชันเก่า หรือยังไม่ได้รัน 04b_01_catalog_v2.sql ใน DEV กรุณา import เวอร์ชัน 4b แล้วโหลดหน้าใหม่</span></div>'}
    ${known ? '' : '<p class="note"><svg class="i"><use href="#i-info"/></svg>พนักงานคนนี้ยังไม่มีข้อมูลในระบบสิทธิ์ใหม่ (ยังไม่ได้แปลง) จึงยังตั้งสิทธิ์รายข้อไม่ได้</p>'}
    <div class="pm-nav" role="group" aria-label="หมวดสิทธิ์">${nav}</div>
    <div class="pm-list">${rows.map(a => pmRow(emp, a, [6,7,8].includes(PM.sec))).join('') || '<p class="note" style="margin:10px">ไม่มีรายการในหมวดนี้</p>'}</div>
    <div class="pm-bar">${n ? `<span>${n} รายการรอบันทึก</span><button class="btn sm" type="button" id="pmDiscard">ยกเลิก</button>` : ''}<button class="btn primary sm" type="button" id="pmOpen" ${n && (known || (nr && !pmCount(emp))) ? '' : 'disabled'}>บันทึก Role และสิทธิ์</button></div>`;
  box.querySelectorAll('[data-pmsec]').forEach(b => b.addEventListener('click', () => { PM.sec = +b.dataset.pmsec; permMount(e); }));
  box.querySelectorAll('[data-pm]').forEach(b => b.addEventListener('click', () => {
    if (!known) return; const [sys, key] = b.dataset.pm.split('|'); const a = PM.acts.find(x => x.SystemKey === sys && x.ActionKey === key);
    pmToggle(emp, a); permMount(e); }));
  $('#pmDiscard')?.addEventListener('click', () => { discardDrawerChanges(emp); renderDrawer(); });
  $('#pmOpen').addEventListener('click', () => pmOpenSave(e));
}
let pmDur = 'perm';
function pmSetDur(d){ pmDur = d; document.querySelectorAll('[data-pmd]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.pmd === d))); $('#pmDates').style.display = d === 'range' ? 'flex' : 'none'; }
function pmPlan(emp){
  const out = [];
  Object.entries(PM.pend[emp] || {}).forEach(([sys, p]) => {
    const changes = Object.entries(p).map(([k, want]) => ({ actionKey:k, want, mode: want === pmTpl(emp, sys, k) ? 'clear' : 'set' }));
    out.push({ sys, changes });
  });
  return out;
}
function pmOpenSave(e){
  const emp = e.employeeId; const rl = changeList().filter(c => c.empId === emp); if (!pmCount(emp) && !rl.length) return;
  const desc = (sys, k) => (PM.acts.find(a => a.SystemKey === sys && a.ActionKey === k) || {}).Description || k;
  let anySet = false;
  $('#pmSub').textContent = `${e.name} (${emp})`;
  $('#pmList').innerHTML = '<div class="diff"><div class="ch">' + rl.map(c => `<div><span class="sysl">${esc(MOD[c.sys].name)}</span>Role: ${describe(c)}</div>`).join('') + pmPlan(emp).map(pl => pl.changes.map(c => { if (c.mode === 'set') anySet = true;
    return `<div><span class="sysl">${esc(pl.sys)}</span>${esc(desc(pl.sys, c.actionKey))} → <b>${c.mode === 'clear' ? 'กลับไปใช้ค่าตาม Role' : (c.want ? 'เปิด (เฉพาะคน)' : 'ปิด (เฉพาะคน)')}</b></div>`; }).join('')).join('') + '</div></div>';
  $('#pmDurBox').style.display = anySet ? '' : 'none';
  $('#pmWhy').value = ''; $('#pmD1').value = ''; $('#pmD2').value = ''; $('#pmD1').min = $('#pmD2').min = pmToday(); pmSetDur('perm');
  openModal('#mPerm'); $('#pmSave').focus();
}
let pmSaving = false;
async function pmDoSave(){
  if (pmSaving) return; const emp = st.drawerId; if (!emp || (!pmCount(emp) && !changeList().some(c => c.empId === emp))) return;
  const range = pmDur === 'range' && $('#pmDurBox').style.display !== 'none';
  const s = range ? $('#pmD1').value : '', ex = range ? $('#pmD2').value : '';
  if (range && !ex) { toast('เลือกวันสุดท้ายของสิทธิ์', '', 'warn'); return; }
  if (range && s && ex < s) { toast('วันสุดท้ายต้องไม่ก่อนวันเริ่ม', '', 'warn'); return; }
  const reason = ($('#pmWhy').value || '').trim() || 'ปรับโดย Admin (ไม่ระบุหมายเหตุ)';
  pmSaving = true; $('#pmSave').disabled = true; $('#pmSave').textContent = 'กำลังบันทึก…';
  let fail = null; const removedHead = [];
  // 1) Role ก่อน (ตารางเดิม + ปรับ Level/Dept ในระบบสิทธิ์ใหม่) 2) แล้วค่อยสิทธิ์รายข้อ เพื่อให้แจ้งเตือนเปลี่ยน Role หายตามที่ตกลงไว้
  if (changeList().some(c => c.empId === emp)) {
    await saveAll(emp);
    if (changeList().some(c => c.empId === emp)) { pmSaving = false; $('#pmSave').disabled = false; $('#pmSave').textContent = 'บันทึกสิทธิ์รายข้อ'; closeModal('#mPerm'); return; }
    await permLoad();
  }
  for (const pl of pmPlan(emp)) {
    try {
      const rs = await permPost('perm_save', { targetEmpId:emp, systemKey:pl.sys, reason,
        changes: pl.changes.map(c => c.mode === 'clear' ? { actionKey:c.actionKey, mode:'clear' } : { actionKey:c.actionKey, mode:'set', allow:c.want, startsAt:s || undefined, expiresAt:ex || undefined }) });
      (rs && rs.removedHead || []).forEach(x => removedHead.push(x));
      delete PM.pend[emp][pl.sys]; if (!Object.keys(PM.pend[emp]).length) delete PM.pend[emp];
    } catch (err) { fail = err.message || 'บันทึกไม่สำเร็จ'; break; }
  }
  pmSaving = false; $('#pmSave').disabled = false; $('#pmSave').textContent = 'บันทึกสิทธิ์รายข้อ';
  if (fail) { toast('บันทึกสิทธิ์รายข้อไม่สำเร็จ', fail, 'error'); return; }
  closeModal('#mPerm'); if (!fail) toast('บันทึก Role และสิทธิ์แล้ว', 'มีผลกับระบบทันที');
  const keep = PM.pend; permInvalidate(); await permLoad(); PM.pend = keep;
  if (removedHead.length) toast('ถอดหัวหน้า SCM คนเดิมแล้ว', removedHead.map(id => { const x = st.emps.find(y => y.employeeId === id); return x ? x.name : id; }).join(', '), 'warn');
  pmSyncNcrFlags();
  if (st.drawerId) renderDrawer();
}
// ป้ายหัวหน้า SCM / SCM 2 ในตารางอ่านจากสิทธิ์รายข้อ — อัปเดตหลังบันทึกโดยไม่ต้องโหลดรายชื่อใหม่
function pmSyncNcrFlags(){
  if (!PM.usr) return;
  const on = (emp, act) => (PM.usr.overrides || []).some(o => o.EmpId === emp && o.SystemKey === 'NCR' && o.ActionKey === act && o.Allow && pmOvState(o) === 'active');
  st.emps.forEach(x => { x.ncrIsScmHead = on(x.employeeId, 'APPROVE_SCM_HEAD'); x.ncrIsScmSecond = on(x.employeeId, 'DROPDOWN_SCM2'); });
  renderAll();
}
// dual-write: เปลี่ยน Role (ตารางเดิม) แล้วปรับ Level/Dept ในระบบสิทธิ์ใหม่ให้ตรงกัน (ข้ามคนที่ยังไม่ได้แปลงเข้า perm)
async function permSyncRole(c){
  const sys = PM_SYS[c.sys], m = pmLD(sys, c.newRole); if (!sys || !m) return;
  await permLoad(); if (!PM.usr || !PM.usr.users.some(u => u.EmpId === c.empId)) return;
  const curL = PM.ulv[pmK(c.empId, sys)], curD = (PM.udp[pmK(c.empId, sys)] || [])[0];
  const body = { targetEmpId:c.empId, systemKey:sys, reason:'เปลี่ยน Role จากหน้าจัดการพนักงาน', changes:[] };
  if (curL !== m[0]) body.level = m[0]; if (curD !== m[1]) body.dept = m[1];
  if (!body.level && !body.dept) return;
  await permPost('perm_save', body);
}
document.getElementById('pmSave').addEventListener('click', pmDoSave);
document.querySelectorAll('[data-pmd]').forEach(b => b.addEventListener('click', () => pmSetDur(b.dataset.pmd)));
