import { LAPS } from '../config.js';
import { store } from '../store.js';

const $ = (id) => document.getElementById(id);
export const fmt = (t) => { const m = Math.floor(t / 60); return `${m}:${(t - m * 60).toFixed(2).padStart(5, '0')}`; };

export class Hud {
  constructor() {
    this.e = {};
    ['hud', 'pos', 'total', 'lap', 'time', 'best', 'spd', 'unit', 'gear', 'rpm', 'count', 'map', 'lights', 'flash', 'gap', 'wrong', 'draft'].forEach((k) => { this.e[k] = $(k); });
    this.ctx = this.e.map.getContext('2d');
  }

  show(v) { this.e.hud.classList.toggle('hidden', !v); }
  setLights(n) { [...this.e.lights.children].forEach((el, i) => el.classList.toggle('on', i < n)); }
  flash(text, good) {
    const f = this.e.flash; f.textContent = text; f.className = good ? 'good' : ''; clearTimeout(this.ft);
    this.ft = setTimeout(() => { f.textContent = ''; }, 4000);
  }

  setMap(S) {
    const xs = S.map((s) => s.p.x), zs = S.map((s) => s.p.z), x0 = Math.min(...xs), z0 = Math.min(...zs);
    this.m = { x0, z0, k: 140 / Math.max(Math.max(...xs) - x0, Math.max(...zs) - z0), S };
  }

  update(d) {
    const e = this.e, mph = store.settings.units === 'mph';
    e.pos.textContent = d.pos; e.total.textContent = d.total;
    e.lap.textContent = `LAP ${Math.min(Math.max(d.lap, 1), LAPS)}/${LAPS}`;
    e.time.textContent = fmt(d.time); e.best.textContent = d.best ? `BEST ${fmt(d.best)}` : '';
    e.gap.textContent = d.gap;
    e.wrong.classList.toggle('hidden', !d.wrong); e.draft.classList.toggle('hidden', !d.draft);
    e.spd.textContent = Math.round(d.kmh * (mph ? 0.621 : 1)); e.unit.textContent = mph ? 'mph' : 'km/h';
    e.gear.textContent = (d.reverse ? 'R' : d.gear) + (d.manual ? ' M' : '');
    e.rpm.style.setProperty('--v', Math.min(1, (d.rpm - 1000) / 6500));
    e.map.style.display = store.settings.map ? '' : 'none';
    if (store.settings.map) this.drawMap(d.cars, d.player);
  }

  drawMap(cars, pl) {
    const c = this.ctx, { x0, z0, k, S } = this.m, X = (v) => 10 + (v - x0) * k, Y = (v) => 10 + (v - z0) * k;
    c.clearRect(0, 0, 160, 160);
    c.lineWidth = 5; c.lineJoin = 'round'; c.strokeStyle = 'rgba(238,241,247,.55)'; c.beginPath();
    S.forEach((s, i) => (i ? c.lineTo(X(s.p.x), Y(s.p.z)) : c.moveTo(X(s.p.x), Y(s.p.z))));
    c.closePath(); c.stroke();
    cars.forEach((a) => { c.fillStyle = a === pl ? '#ffb454' : a.look.color; c.beginPath(); c.arc(X(a.body.position.x), Y(a.body.position.z), a === pl ? 5.5 : 3.5, 0, 7); c.fill(); });
  }
}
