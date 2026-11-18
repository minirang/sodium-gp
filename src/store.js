import { DEFAULTS } from './config.js';

const KEY = 'sodium-gp-v2';
const base = { settings: DEFAULTS, look: { car: 'f458', color: '#d1142a', rim: '#d9dde6', wheel: 0.36, spokes: 5 }, track: 'downtown', ai: 1, hideTip: '', skipGuide: false };
let saved = null;
try { saved = JSON.parse(localStorage.getItem(KEY)); } catch {}

export const store = { ...base, ...saved, settings: { ...base.settings, ...saved?.settings }, look: { ...base.look, ...saved?.look } };
export const save = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch {} };
