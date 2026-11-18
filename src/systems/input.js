const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const PULSE = { KeyC: 'cam', KeyE: 'up', KeyQ: 'down', KeyR: 'reset', Escape: 'pause', KeyP: 'pause' };

export class Input {
    constructor(wheelEl) {
        Object.assign(this, { keys: new Set(), hold: { thr: 0, brk: 0, hand: 0 }, pulse: {}, steer: 0, thr: 0, mx: 0, wheelVal: null, mouseSteer: false });
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

        // 화면 버튼: 포인터 단위로 처리해 멀티터치 동시 입력 지원
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
        this.wheelEl = wheelEl;
    }

    take(n) { const v = this.pulse[n]; this.pulse[n] = 0; return v; }

    read(dt, sens) {
        const k = this.keys, kb = (k.has('ArrowRight') || k.has('KeyD') ? 1 : 0) - (k.has('ArrowLeft') || k.has('KeyA') ? 1 : 0);
        if (this.wheelVal !== null) this.steer = this.wheelVal;
        else {
            const target = kb || (this.mouseSteer ? clamp(this.mx * 1.6, -1, 1) : 0), rate = kb ? 3.4 * sens : this.mouseSteer ? 8 : 6;
            this.steer += clamp(target - this.steer, -rate * dt, rate * dt);
        }
        const gas = (k.has('ArrowUp') || k.has('KeyW') ? 1 : 0) || this.hold.thr;
        this.thr += clamp(gas - this.thr, -dt * 8, dt * 5);
        this.wheelEl.firstElementChild.style.transform = `rotate(${this.steer * 126}deg)`;
        return { steer: this.steer, thr: this.thr, brk: (k.has('ArrowDown') || k.has('KeyS') ? 1 : 0) || this.hold.brk, hand: k.has('Space') ? 1 : this.hold.hand };
    }
}
