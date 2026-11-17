// ===================================================================
// shared/perm.js — ระบบตรวจสอบสิทธิ์พนักงาน (KTW HUB Permission System)
// ===================================================================
// - ตรวจสอบสิทธิ์จริงระดับ Action ผ่าน Webhook 'perm_my'
// - แคชสิทธิ์ไว้ใน sessionStorage เพื่อประสิทธิภาพ และโหลดใหม่เมื่อเปลี่ยนหน้า
// - เรียกใช้: KTWPerm.can('SWAP', 'VIEW_MENU') -> true/false
// ===================================================================

(function () {
    if (window.KTWPerm) return;

    const KEY = 'ktw_perm_v1';
    let state = { emp: '', map: null };

    function empId() {
        try { return sessionStorage.getItem('emp_id') || ''; } catch (e) { return ''; }
    }

    function readCache() {
        try {
            const c = JSON.parse(sessionStorage.getItem(KEY) || 'null');
            if (c && c.emp === empId() && c.map && Object.keys(c.map).length) return c.map;
        } catch (e) {}
        return null;
    }

    function writeCache(map) {
        try { 
            sessionStorage.setItem(KEY, JSON.stringify({ emp: empId(), at: Date.now(), map: map })); 
        } catch (e) {}
    }

    state.emp = empId();
    state.map = readCache();

    const api = {
        isReady: function () { 
            return !!state.map && state.emp === empId(); 
        },
        can: function (sys, act) { 
            return !!(state.map && state.map[sys + '.' + act]); 
        },
        known: function (sys, act) { 
            return !!(state.map && Object.prototype.hasOwnProperty.call(state.map, sys + '.' + act)); 
        },
        load: function () {
            const me = empId();
            if (!me || typeof window.n8nFetch !== 'function') return Promise.resolve(false);
            
            return window.n8nFetch('perm_my', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ actorEmpId: me })
            })
            .then(r => r.ok ? r.json() : null)
            .then(j => {
                if (!j || j.success !== true || !Array.isArray(j.actions) || !j.actions.length) return false;
                const map = {};
                j.actions.forEach(a => { 
                    map[a.SystemKey + '.' + a.ActionKey] = (a.Allow === true || a.Allow === 1) ? 1 : 0; 
                });
                map.__loaded = 1;
                const changed = JSON.stringify(map) !== JSON.stringify(state.map || {});
                state.map = map;
                state.emp = me;
                writeCache(map);
                return changed;
            })
            .catch(() => false);
        },
        clear: function () { 
            state.map = null; 
            try { sessionStorage.removeItem(KEY); } catch (e) {} 
        }
    };

    window.KTWPerm = api;
})();
