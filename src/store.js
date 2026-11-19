import { DEFAULTS, CARS, TRACKS, TIMES, WHEEL_SIZES, SPOKES, AI_LEVELS } from './config.js';

const KEY = 'sodium-gp-v2';
const base = { settings: DEFAULTS, look: { car: 'cc', color: '#d4141c', rim: '#d9dde6', wheel: 0.36, spokes: 5 }, track: 'downtown', ai: 1, hideTip: '', skipGuide: false };
const oneOf = (v, list, d) => (list.includes(v) ? v : d);
const num = (v, lo, hi, d) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const hex = (v, d) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : d);

// 저장된 값이 손상되었거나 구버전이어도 게임이 깨지지 않도록 항목마다 검증한다
function sanitize(raw) {
    const r = raw && typeof raw === 'object' ? raw : {}, s = { ...DEFAULTS, ...(r.settings || {}) }, l = { ...base.look, ...(r.look || {}) };
    return {
        settings: {
            quality: Math.round(num(s.quality, 0, 3, DEFAULTS.quality)), master: num(s.master, 0, 1, DEFAULTS.master), engine: num(s.engine, 0, 1, DEFAULTS.engine),
            fov: num(s.fov, 55, 100, DEFAULTS.fov), cam: oneOf(s.cam, ['chase', 'cockpit'], 'chase'), shift: oneOf(s.shift, ['auto', 'manual'], 'auto'),
            assist: oneOf(s.assist, [0, 1, 2], 1), steer: num(s.steer, 0.5, 2, 1), mouse: !!s.mouse, touch: oneOf(s.touch, ['auto', 'on', 'off'], 'auto'),
            units: oneOf(s.units, ['kmh', 'mph'], 'kmh'), map: s.map !== false, time: oneOf(s.time, Object.keys(TIMES), 'dusk'),
        },
        look: { car: oneOf(l.car, CARS.map((c) => c.id), base.look.car), color: hex(l.color, base.look.color), rim: hex(l.rim, base.look.rim), wheel: oneOf(l.wheel, WHEEL_SIZES, 0.36), spokes: oneOf(l.spokes, SPOKES, 5) },
        track: oneOf(r.track, TRACKS.map((t) => t.id), 'downtown'), ai: oneOf(r.ai, AI_LEVELS.map((_, i) => i), 1),
        hideTip: typeof r.hideTip === 'string' ? r.hideTip : '', skipGuide: !!r.skipGuide,
    };
}

let saved = null;
try { saved = JSON.parse(localStorage.getItem(KEY)); } catch { }
export const store = sanitize(saved);
export const save = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { } };
