/**
 * Murmuration Hero Canvas Animation
 * ฝูงนกสตาร์ลิงรวมตัวเป็นคำว่า "KTW" บนท้องฟ้ายามพลบค่ำ
 * รองรับการย่อ/ขยายหน้าจอ, การตรวจจับ prefers-reduced-motion, และ Mouse interaction (Hawk effect)
 */
(function () {
    try {
        var root = document.getElementById('mmw-root');
        var canvas = document.getElementById('mmw-canvas');
        if (!root || !canvas) return;
        var ctx = canvas.getContext('2d');
        if (!ctx) return;

        // ---------- ตั้งค่า ----------
        var WORD = 'KTW';
        var BIRDS = 4200;     // จำนวนนก (ลดอัตโนมัติบนจอเล็ก)
        var FLY_FOR = 7;      // วินาทีที่บินอิสระ
        var HOLD_FOR = 3.2;   // วินาทีที่ค้างเป็นตัวอักษร
        var REEDS = true;     // แนวต้นอ้อด้านล่าง
        var COLORS = { skyTop: '#1d2b44', skyLow: '#e89a6a', sun: '#ffd2a0', ink: '#14100f' };
        var FONT = '"Prompt", "Inter Tight", "Helvetica Neue", Arial, sans-serif';

        // ---------- ตัวช่วยคณิตศาสตร์ ----------
        function rng(seed) {
            var a = (seed >>> 0) || 1;
            return function () {
                a = (a + 0x6d2b79f5) >>> 0;
                var t = a;
                t = Math.imul(t ^ (t >>> 15), t | 1);
                t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
                return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
            };
        }

        // กระแสลมแบบ curl (ไม่ทำให้นกกองรวมกันเป็นจุด แค่พับฝูงไปมา)
        function curl(x, y, t) {
            var a = 1.7 * x + t, b = 1.3 * y - 0.6 * t, c = 2.9 * y + 1.1 * x - 0.8 * t, d = 4.3 * x - 3.7 * y + 1.3 * t;
            var dpdx = 1.7 * Math.cos(a) * Math.cos(b) + 0.6 * 1.1 * Math.cos(c) - 0.35 * 4.3 * Math.sin(d);
            var dpdy = -1.3 * Math.sin(a) * Math.sin(b) + 0.6 * 2.9 * Math.cos(c) + 0.35 * 3.7 * Math.sin(d);
            return [dpdy, -dpdx];
        }

        function centre(t) {
            return [0.42 * Math.sin(t * 0.21) + 0.12 * Math.sin(t * 0.53 + 1), 0.16 * Math.sin(t * 0.33 + 2) - 0.08];
        }

        function ease(k) { var x = k < 0 ? 0 : k > 1 ? 1 : k; return x * x * (3 - 2 * x); }

        function assign(birds, points, seed) {
            var out = new Int32Array(birds);
            if (points <= 0) { out.fill(-1); return out; }
            var order = new Int32Array(points), i, j, tmp, r = rng(seed);
            for (i = 0; i < points; i++) order[i] = i;
            for (i = points - 1; i > 0; i--) { j = Math.floor(r() * (i + 1)); tmp = order[i]; order[i] = order[j]; order[j] = tmp; }
            for (i = 0; i < birds; i++) out[i] = order[i % points];
            return out;
        }

        function alpha(hex, a) {
            var m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((hex || '').trim());
            if (!m) return hex;
            var h = m[1].length === 3 ? m[1].split('').map(function (c) { return c + c; }).join('') : m[1];
            return 'rgba(' + parseInt(h.slice(0, 2), 16) + ',' + parseInt(h.slice(2, 4), 16) + ',' + parseInt(h.slice(4, 6), 16) + ',' + a + ')';
        }

        var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        var w = 1, h = 1, dpr = 1, n = 0, raf = 0, sky = null;
        var px = new Float32Array(0), py = new Float32Array(0), vx = new Float32Array(0), vy = new Float32Array(0);
        var depth = new Float32Array(0), phase = new Float32Array(0), target = new Int32Array(0);
        var tx = new Float32Array(0), ty = new Float32Array(0);
        var hx = -1e5, hy = -1e5, last = performance.now(), clock = 0;
        var focusX = 0, focusY = 0, spread = 1;
        var rand = rng(11);

        function layout() {
            var rect = root.getBoundingClientRect();
            w = Math.max(1, Math.round(rect.width));
            h = Math.max(1, Math.round(rect.height));
            dpr = Math.min(window.devicePixelRatio || 1, 2);
            canvas.width = Math.round(w * dpr);
            canvas.height = Math.round(h * dpr);

            // จอกว้าง: คำอยู่ซ้าย การ์ด Login อยู่ขวา · จอแคบ: คำอยู่ด้านบน การ์ดอยู่ด้านล่าง
            var wide = w >= 1024;
            var areaW = wide ? w * 0.56 : w;
            var cx = wide ? w * 0.32 : w / 2;
            var cy = wide ? h * 0.46 : h * 0.19;
            var maxH = wide ? h * 0.42 : h * 0.17;
            focusX = cx; focusY = wide ? h * 0.46 : h * 0.26; spread = wide ? 0.55 : 0.9;

            // ท้องฟ้า: ไล่สี + แสงอาทิตย์ + เกรน + ต้นอ้อ (วาดครั้งเดียวเก็บเป็นภาพ)
            sky = document.createElement('canvas');
            sky.width = canvas.width; sky.height = canvas.height;
            var s = sky.getContext('2d');
            if (s) {
                s.setTransform(dpr, 0, 0, dpr, 0, 0);
                var g = s.createLinearGradient(0, 0, 0, h);
                g.addColorStop(0, COLORS.skyTop);
                g.addColorStop(wide ? 0.78 : 0.5, COLORS.skyLow);
                g.addColorStop(1, COLORS.skyLow);
                s.fillStyle = g;
                s.fillRect(0, 0, w, h);

                var sx = wide ? w * 0.34 : w * 0.6;
                var sun = s.createRadialGradient(sx, h * 0.86, 0, sx, h * 0.86, Math.max(w, h) * 0.55);
                sun.addColorStop(0, COLORS.sun);
                sun.addColorStop(0.25, alpha(COLORS.sun, 0.5));
                sun.addColorStop(1, alpha(COLORS.sun, 0));
                s.globalAlpha = 0.55;
                s.fillStyle = sun;
                s.fillRect(0, 0, w, h);
                s.globalAlpha = 1;

                var gr = rng(5), i;
                for (i = 0; i < (w * h) / 10; i++) {
                    s.fillStyle = gr() < 0.5 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.035)';
                    s.fillRect(gr() * w, gr() * h, 1, 1);
                }

                if (REEDS) {
                    s.strokeStyle = COLORS.ink;
                    s.fillStyle = COLORS.ink;
                    var base = h - Math.max(6, h * 0.012);
                    s.fillRect(0, base, w, h - base);
                    for (var x = -10; x < w + 10; x += 2 + gr() * 9) {
                        if (gr() < 0.18) x += gr() * 30;
                        var tall = Math.pow(gr(), 1.6) * Math.max(34, h * 0.13) + 6;
                        var lean = (gr() - 0.3) * 10;
                        s.lineWidth = 0.6 + gr() * 1.2;
                        s.beginPath();
                        s.moveTo(x, base + 2);
                        s.quadraticCurveTo(x + lean * 0.3, base - tall * 0.6, x + lean, base - tall);
                        s.stroke();
                        if (gr() < 0.07) {
                            s.beginPath();
                            s.ellipse(x + lean, base - tall - 4, 1.8, 6, lean * 0.04, 0, Math.PI * 2);
                            s.fill();
                        }
                    }
                }
            }

            // สุ่มจุดจากรูปร่างตัวอักษรเป็นเป้าหมายของนกแต่ละตัว
            var m = document.createElement('canvas');
            m.width = w; m.height = h;
            var mc = m.getContext('2d', { willReadFrequently: true });
            var pts = [];
            if (mc) {
                mc.font = '900 100px ' + FONT;
                var wordW = mc.measureText(WORD).width || 1;
                var size = Math.min(((areaW * 0.86) / wordW) * 100, maxH / 0.72);
                mc.font = '900 ' + size + 'px ' + FONT;
                mc.textAlign = 'center';
                mc.textBaseline = 'middle';
                mc.fillText(WORD, cx, cy);
                var img = mc.getImageData(0, 0, w, h).data;
                var step = Math.max(2, Math.round(Math.sqrt((w * h) / 90000)));
                for (var yy = 0; yy < h; yy += step) {
                    for (var xx = 0; xx < w; xx += step) {
                        if (img[(yy * w + xx) * 4 + 3] > 128) pts.push(xx + (rand() - 0.5) * step, yy + (rand() - 0.5) * step);
                    }
                }
            }
            var k, nx = pts.length / 2;
            tx = new Float32Array(nx); ty = new Float32Array(nx);
            for (k = 0; k < nx; k++) { tx[k] = pts[2 * k]; ty[k] = pts[2 * k + 1]; }

            // จำนวนนกปรับตามขนาดจอ แล้วโปรยเป็นกลุ่มเมฆรอบจุดโฟกัส
            var want = Math.round(Math.max(600, Math.min(9000, BIRDS)) * Math.min(1, (w * h) / (1440 * 860)));
            if (want !== n) {
                n = Math.max(500, want);
                px = new Float32Array(n); py = new Float32Array(n); vx = new Float32Array(n); vy = new Float32Array(n);
                depth = new Float32Array(n); phase = new Float32Array(n);
                for (var b = 0; b < n; b++) {
                    var a = rand() * Math.PI * 2, r = Math.sqrt(rand());
                    px[b] = focusX + Math.cos(a) * r * w * 0.22;
                    py[b] = focusY + Math.sin(a) * r * h * 0.16;
                    depth[b] = 0.55 + rand() * 0.45;
                    phase[b] = rand() * Math.PI * 2;
                }
            }
            target = assign(n, tx.length, 23);
        }

        function frame(now) {
            raf = requestAnimationFrame(frame);
            if (document.hidden) { last = now; return; }
            var dt = reduced ? 0 : Math.min(0.05, (now - last) / 1000);
            last = now;
            clock += dt;
            var cycle = Math.max(1, FLY_FOR) + 2.4 + Math.max(0.5, HOLD_FOR) + 0.6;
            var tc = clock % cycle, fly = Math.max(1, FLY_FOR), pull = 0;
            if (tc > fly && tc <= fly + 2.4) pull = ease((tc - fly) / 2.4);
            else if (tc > fly + 2.4 && tc <= fly + 2.4 + HOLD_FOR) pull = 1;
            else if (tc > fly + 2.4 + HOLD_FOR) pull = 1 - ease((tc - fly - 2.4 - HOLD_FOR) / 0.6);
            if (reduced) pull = 1;

            var u = Math.min(w, h), cen = centre(clock);
            var cxp = focusX + cen[0] * w * 0.5 * spread, cyp = focusY + cen[1] * h;
            var t = clock * 0.35, hawk = hx > -1e4, hawkR = u * 0.16;

            for (var i = 0; i < n; i++) {
                var x = px[i], y = py[i], ax = 0, ay = 0;
                var fx = (x - w / 2) / u, fy = (y - h / 2) / u;
                var cv = curl(fx * 2.2 + depth[i] * 0.25, fy * 2.2, t), free = 1 - pull;
                ax += cv[0] * 420 * free; ay += cv[1] * 420 * free;
                var dxC = cxp - x, dyC = (cyp - y) * 1.6, dC = Math.hypot(dxC, dyC) / u;
                var hold = dC < 0.14 ? 0.15 : 0.15 + (dC - 0.14) * 6;
                ax += dxC * hold * 2.2 * free; ay += dyC * hold * 1.6 * free;
                var ti = target[i];
                if (pull > 0 && ti >= 0) {
                    ax += (tx[ti] - x) * 9 * pull - vx[i] * 3.2 * pull;
                    ay += (ty[ti] - y) * 9 * pull - vy[i] * 3.2 * pull;
                }
                if (hawk) {
                    var dx = x - hx, dy = y - hy, d2 = dx * dx + dy * dy;
                    if (d2 < hawkR * hawkR) {
                        var d = Math.sqrt(d2) + 0.01, f = (1 - d / hawkR) * 5200;
                        ax += (dx / d) * f; ay += (dy / d) * f;
                    }
                }
                var nvx = (vx[i] + ax * dt) * (1 - 1.1 * dt), nvy = (vy[i] + ay * dt) * (1 - 1.1 * dt);
                var sp = Math.hypot(nvx, nvy), cap = 520 + 380 * pull;
                if (sp > cap) { nvx = (nvx / sp) * cap; nvy = (nvy / sp) * cap; }
                vx[i] = nvx; vy[i] = nvy;
                px[i] = x + nvx * dt; py[i] = y + nvy * dt;
                phase[i] += dt * (9 + sp * 0.02);
            }

            ctx.setTransform(1, 0, 0, 1, 0, 0);
            if (sky) ctx.drawImage(sky, 0, 0);
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            
            // วาด 2 ชั้น: นกไกล (จาง) และนกใกล้ (เข้มกว่า)
            for (var pass = 0; pass < 2; pass++) {
                ctx.beginPath();
                for (var j = 0; j < n; j++) {
                    var near = depth[j] > 0.78;
                    if ((pass === 1) !== near) continue;
                    var s2 = (1.6 + depth[j] * 2.2) * (1 - 0.35 * pull);
                    var sp2 = Math.hypot(vx[j], vy[j]) + 0.001, ddx = vx[j] / sp2, ddy = vy[j] / sp2;
                    var flap = 0.55 + 0.45 * Math.sin(phase[j]);
                    var bx = px[j], by = py[j], wx = -ddx * s2, wy = -ddy * s2, nxv = -ddy * s2 * flap, nyv = ddx * s2 * flap;
                    ctx.moveTo(bx + wx + nxv, by + wy + nyv);
                    ctx.lineTo(bx, by);
                    ctx.lineTo(bx + wx - nxv, by + wy - nyv);
                }
                ctx.strokeStyle = COLORS.ink;
                ctx.globalAlpha = pass === 0 ? 0.55 : 0.92;
                ctx.lineWidth = pass === 0 ? 0.9 : 1.25;
                ctx.stroke();
            }
            ctx.globalAlpha = 1;
        }

        // เมาส์ = เหยี่ยว (ฟังที่ window เพื่อให้ทำงานเมื่อชี้ผ่านการ์ด Login ด้วย)
        window.addEventListener('pointermove', function (e) {
            var b = canvas.getBoundingClientRect();
            hx = e.clientX - b.left;
            hy = e.clientY - b.top;
        }, { passive: true });

        document.documentElement.addEventListener('pointerleave', function () {
            hx = -1e5;
            hy = -1e5;
        });

        var started = false;
        function start() {
            if (started) return;
            started = true;
            layout();
            raf = requestAnimationFrame(frame);
        }

        // รอฟอนต์ Prompt โหลดก่อน สุ่มจุดคำว่า KTW
        if (document.fonts && document.fonts.load) {
            document.fonts.load('900 100px Prompt', WORD).then(start, start);
            setTimeout(start, 1500);
        } else {
            start();
        }

        if (window.ResizeObserver) {
            var ro = new ResizeObserver(function () { if (started) layout(); });
            ro.observe(root);
        } else {
            window.addEventListener('resize', function () { if (started) layout(); });
        }
    } catch (err) {
        console.warn('Murmuration background disabled:', err);
    }
})();
