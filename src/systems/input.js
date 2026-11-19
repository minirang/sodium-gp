const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const PULSE = { KeyC: 'cam', KeyE: 'up', KeyQ: 'down', KeyR: 'reset', Escape: 'pause', KeyP: 'pause' };
const PAD = [[3, 'cam'], [5, 'up'], [4, 'down'], [9, 'pause'], [2, 'reset']];

export class Input {
    constructor(wheelEl) {
        Object.assign(this, { keys: new Set(), hold: { thr: 0, brk: 0, hand: 0, back: 0 }, pulse: {}, pad: {}, steer: 0, thr: 0, mx: 0, wheelVal: null, mouseSteer: false, wheelEl });
        addEventListener('keydown', (e) => {
            if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
            if (e.repeat) return;
            this.keys.add(e.code);
            if (PULSE[e.code]) this.pulse[PULSE[e.code]] = 1;
        });
        addEventListener('keyup', (e) => this.keys.delete(e.code));
        addEventListener('blur', () => this.keys.clear());
        addEventListener('mousemove', (e) => { this.mx = (e.clientX / innerWidth - 0.5) * 2; });
        addEventListener('contextmenu', (e) => e.preventDefault());

        // 화면 버튼: 포인터 단위로 처리해 멀티터치 동시 입력을 지원한다
        document.querySelectorAll('[data-k]').forEach((el) => {
            const k = el.dataset.k, held = k in this.hold;
            el.addEventListener('pointerdown', (e) => {
                e.preventDefault(); el.setPointerCapture(e.pointerId); el.classList.add('on');
                if (held) this.hold[k] = 1; else this.pulse[k] = 1;
            });
            const up = () => { el.classList.remove('on'); if (held) this.hold[k] = 0; };
            el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
        });

        // 화면 핸들: 드래그한 각도만큼 조향
        let id = null, a0 = 0, v0 = 0;
        const ang = (e) => { const r = wheelEl.getBoundingClientRect(); return Math.atan2(e.clientY - r.top - r.height / 2, e.clientX - r.left - r.width / 2); };
        wheelEl.addEventListener('pointerdown', (e) => { e.preventDefault(); id = e.pointerId; wheelEl.setPointerCapture(id); a0 = ang(e); v0 = this.steer; });
        wheelEl.addEventListener('pointermove', (e) => {
            if (e.pointerId !== id) return;
            const d = ang(e) - a0;
            this.wheelVal = clamp(v0 + Math.atan2(Math.sin(d), Math.cos(d)) / 2.2, -1, 1);
        });
        const end = (e) => { if (e.pointerId === id) { id = null; this.wheelVal = null; } };
        wheelEl.addEventListener('pointerup', end); wheelEl.addEventListener('pointercancel', end);
    }

    take(n) { const v = this.pulse[n]; this.pulse[n] = 0; return v; }
    get back() { return this.keys.has('KeyB') || this.hold.back; }

    read(dt, sens, kmh = 0) {
        const k = this.keys, kb = (k.has('ArrowRight') || k.has('KeyD') ? 1 : 0) - (k.has('ArrowLeft') || k.has('KeyA') ? 1 : 0);
        const gp = (navigator.getGamepads?.() || []).find((g) => g && g.connected);
        let gs = null, gt = 0, gb = 0, gh = 0;
        if (gp) {
            gs = Math.abs(gp.axes[0]) > 0.08 ? gp.axes[0] : 0; gt = gp.buttons[7]?.value || 0; gb = gp.buttons[6]?.value || 0; gh = gp.buttons[0]?.pressed ? 1 : 0;
            PAD.forEach(([i, n]) => { const p = !!gp.buttons[i]?.pressed; if (p && !this.pad[i]) this.pulse[n] = 1; this.pad[i] = p; });
        }
        if (this.wheelVal !== null) this.steer = this.wheelVal;
        else if (gs !== null && !kb) this.steer += clamp(gs - this.steer, -dt * 10, dt * 10);
        else {
            // 키보드: 속도가 높을수록 천천히 꺾고, 놓으면 빠르게 중앙으로 복귀
            const target = kb || (this.mouseSteer ? clamp(this.mx * 1.6, -1, 1) : 0);
            const rate = kb ? 4.2 * sens * (1 - clamp(kmh / 220, 0, 1) * 0.6) : this.mouseSteer ? 8 : 5 + clamp(kmh / 60, 0, 2);
            this.steer += clamp(target - this.steer, -rate * dt, rate * dt);
        }
        const gas = (k.has('ArrowUp') || k.has('KeyW') ? 1 : 0) || this.hold.thr || gt;
        this.thr += clamp(gas - this.thr, -dt * 8, dt * 5);
        this.wheelEl.firstElementChild.style.transform = `rotate(${this.steer * 126}deg)`;
        return {
            steer: this.steer * (0.5 + 0.5 * Math.abs(this.steer)), rawSteer: this.steer, thr: this.thr,
            brk: (k.has('ArrowDown') || k.has('KeyS') ? 1 : 0) || this.hold.brk || gb, hand: k.has('Space') ? 1 : this.hold.hand || gh,
        };
    }
}
