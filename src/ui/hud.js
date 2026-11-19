import { LAPS } from '../config.js';
import { store } from '../store.js';

const $ = (id) => document.getElementById(id);
export const fmt = (t) => { const m = Math.floor(t / 60); return `${m}:${(t - m * 60).toFixed(2).padStart(5, '0')}`; };

export class Hud {
    constructor() {
        this.e = {}; this.v = {}; this.mf = 0;
        ['hud', 'pos', 'total', 'lap', 'time', 'best', 'spd', 'unit', 'gear', 'rpm', 'count', 'map', 'lights', 'flash', 'gap', 'wrong', 'draft'].forEach((k) => { this.e[k] = $(k); });
        this.ctx = this.e.map.getContext('2d');
    }

    // 값이 바뀔 때만 DOM을 갱신한다
    set(k, text) { if (this.v[k] !== text) { this.v[k] = text; this.e[k].textContent = text; } }
    show(v) { this.e.hud.classList.toggle('hidden', !v); }
    setLights(n) { [...this.e.lights.children].forEach((el, i) => el.classList.toggle('on', i < n)); }
    flash(text, good) {
        const f = this.e.flash; f.textContent = text; f.className = good ? 'good' : ''; clearTimeout(this.ft);
        this.ft = setTimeout(() => { f.textContent = ''; }, 4000);
    }
    clear() { clearTimeout(this.ft); this.e.flash.textContent = ''; this.e.count.textContent = ''; this.v = {}; this.setLights(0); }

    setMap(S) {
        const xs = S.map((s) => s.p.x), zs = S.map((s) => s.p.z), x0 = Math.min(...xs), z0 = Math.min(...zs), k = 140 / Math.max(Math.max(...xs) - x0, Math.max(...zs) - z0);
        const bg = document.createElement('canvas'); bg.width = bg.height = 160;
        const c = bg.getContext('2d'); c.lineWidth = 5; c.lineJoin = 'round'; c.strokeStyle = 'rgba(238,241,247,.55)'; c.beginPath();
        S.forEach((s, i) => (i ? c.lineTo(10 + (s.p.x - x0) * k, 10 + (s.p.z - z0) * k) : c.moveTo(10 + (s.p.x - x0) * k, 10 + (s.p.z - z0) * k)));
        c.closePath(); c.stroke();
        this.m = { x0, z0, k, bg };
    }

    update(d) {
        const mph = store.settings.units === 'mph';
        this.set('pos', String(d.pos)); this.set('total', String(d.total));
        this.set('lap', `LAP ${Math.min(Math.max(d.lap, 1), LAPS)}/${LAPS}`);
        this.set('time', fmt(d.time)); this.set('best', d.best ? `BEST ${fmt(d.best)}` : ''); this.set('gap', d.gap);
        this.e.wrong.classList.toggle('hidden', !d.wrong); this.e.draft.classList.toggle('hidden', !d.draft);
        this.set('spd', String(Math.round(d.kmh * (mph ? 0.621 : 1)))); this.set('unit', mph ? 'mph' : 'km/h');
        this.set('gear', String(d.reverse ? 'R' : d.gear) + (d.manual ? ' M' : ''));
        this.e.rpm.style.setProperty('--v', Math.min(1, (d.rpm - 1000) / 6500).toFixed(3));
        const show = store.settings.map; this.e.map.style.display = show ? '' : 'none';
        if (show && (this.mf++ & 1) === 0) this.drawMap(d.cars, d.player);
    }

    drawMap(cars, pl) {
        const c = this.ctx, { x0, z0, k, bg } = this.m;
        c.clearRect(0, 0, 160, 160); c.drawImage(bg, 0, 0);
        cars.forEach((a) => { c.fillStyle = a === pl ? '#ffb454' : a.look.color; c.beginPath(); c.arc(10 + (a.body.position.x - x0) * k, 10 + (a.body.position.z - z0) * k, a === pl ? 5.5 : 3.5, 0, 7); c.fill(); });
    }
}
