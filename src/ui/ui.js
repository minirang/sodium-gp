import { store, save } from '../store.js';
import { CARS, TRACKS, AI_LEVELS, COLORS, RIM_COLORS, WHEEL_SIZES, SPOKES, SCHEMA, LAPS } from '../config.js';
import { fmt } from './hud.js';

const $ = (s) => document.querySelector(s);
export const show = (s, v = true) => $(s).classList.toggle('hidden', !v);
const btn = (cls, html, fn) => { const b = document.createElement('button'); b.className = cls; b.innerHTML = html; b.onclick = fn; return b; };

export function showResult(rows, level = '') {
    const win = rows.find((r) => r.time != null)?.time, me = rows.findIndex((r) => r.me), mine = rows[me];
    const medal = ['🏆 우승!', '🥈 2위 완주', '🥉 3위 완주'][me] || `${me + 1}위 완주`;
    $('#resultTitle').textContent = me >= 0 ? medal : '레이스 결과';
    $('#resultSub').textContent = [level && `AI 난이도 ${level}`, mine?.best && `내 베스트 랩 ${fmt(mine.best)}`].filter(Boolean).join(' · ');
    $('#resultBody').replaceChildren(...rows.map((r) => {
        const li = document.createElement('li');
        li.className = r.me ? 'me' : '';
        li.textContent = `${r.name}${r.tag ? ` (${r.tag})` : ''} — ${r.time != null ? fmt(r.time) + (r.time !== win ? ` (+${(r.time - win).toFixed(2)})` : '') : `주행 중 · ${r.lap}/${LAPS}랩`}${r.best ? ` · 베스트 ${fmt(r.best)}` : ''}`;
        return li;
    }));
    show('#result');
}

export function initUI(game) {
    const L = store.look;
    let guideStart = true;

    const draw = () => {
        const pick = (box, items, isSel, onPick, html, cls = 'card') => $(box).replaceChildren(...items.map((it) => btn(cls + (isSel(it) ? ' sel' : ''), html(it), () => { onPick(it); save(); draw(); })));
        const dot = (c) => `<span style="background:${c}"></span>`;
        pick('#cars', CARS, (c) => c.id === L.car, (c) => { L.car = c.id; game.showPreview(); }, (c) => `<b>${c.name}</b><small>${c.desc}</small><i>최고 ${Math.round(c.top * 3.6)}km/h · ${c.mass}kg</i>`);
        pick('#colors', COLORS, (c) => c === L.color, (c) => { L.color = c; game.showPreview(); }, dot, 'sw');
        pick('#rims', RIM_COLORS, (c) => c === L.rim, (c) => { L.rim = c; game.showPreview(); }, dot, 'sw');
        pick('#wsize', WHEEL_SIZES, (v) => v === L.wheel, (v) => { L.wheel = v; game.showPreview(); }, (v) => `${17 + WHEEL_SIZES.indexOf(v)}인치`, '');
        $('#spokes').style.display = CARS.find((c) => c.id === L.car).model ? 'none' : '';
        pick('#spokes', SPOKES, (v) => v === L.spokes, (v) => { L.spokes = v; game.showPreview(); }, (v) => `${v}스포크`, '');
        pick('#tracks', TRACKS, (t) => t.id === store.track, (t) => game.setTrack(t.id), (t) => `<b>${t.name}</b><small>${t.desc}</small>`);
        pick('#ai', AI_LEVELS, (a) => AI_LEVELS.indexOf(a) === store.ai, (a) => { store.ai = AI_LEVELS.indexOf(a); }, (a) => a.name, '');
    };
    draw();

    const openGuide = (start) => { guideStart = start; $('#skipGuide').checked = store.skipGuide; show('#guide'); };
    $('#start').onclick = () => (store.skipGuide ? game.begin() : openGuide(true));
    $('#openGuide').onclick = () => openGuide(false);
    $('#guideGo').onclick = () => { store.skipGuide = $('#skipGuide').checked; save(); show('#guide', false); if (guideStart) game.begin(); };

    const renderSettings = () => {
        $('#settingsBody').replaceChildren(...SCHEMA.map((s) => {
            const row = document.createElement('label'), v = store.settings[s.k];
            row.className = 'set'; row.append(Object.assign(document.createElement('span'), { textContent: s.l }));
            let input;
            if (s.t === 'sel') {
                input = document.createElement('select');
                s.o.forEach(([val, name], i) => input.add(new Option(name, i, false, val === v)));
                input.onchange = () => { store.settings[s.k] = s.o[input.value][0]; };
            } else if (s.t === 'range') {
                input = Object.assign(document.createElement('input'), { type: 'range', min: s.min, max: s.max, step: s.step, value: v });
                input.oninput = () => { store.settings[s.k] = +input.value; game.applySettings(); };
            } else {
                input = Object.assign(document.createElement('input'), { type: 'checkbox', checked: !!v });
                input.onchange = () => { store.settings[s.k] = input.checked; };
            }
            input.addEventListener('change', () => { save(); game.applySettings(); });
            row.append(input); return row;
        }));
    };
    $('#openSettings').onclick = $('#pauseSettings').onclick = () => { renderSettings(); show('#settings'); };
    $('#settingsClose').onclick = () => show('#settings', false);

    $('#fullscreen').onclick = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.());
    $('#resume').onclick = () => game.pause(false);
    $('#restart').onclick = () => { show('#pause', false); game.restart(); };
    $('#quit').onclick = $('#toMenu').onclick = () => { show('#pause', false); show('#result', false); game.toMenu(); };
    $('#again').onclick = () => { show('#result', false); game.restart(); };

    // 그래픽 가속 안내 (오늘 하루 보지 않기)
    const today = new Date().toDateString();
    if (store.hideTip !== today) {
        show('#gfxTip');
        const gl = game.r.getContext(), info = gl.getExtension('WEBGL_debug_renderer_info');
        if (info && /swiftshader|llvmpipe|software/i.test(gl.getParameter(info.UNMASKED_RENDERER_WEBGL))) {
            $('#tipText').innerHTML = '지금은 <b>소프트웨어 렌더링</b>으로 보입니다. 브라우저 설정 → 시스템에서 <b>그래픽 가속(하드웨어 가속)</b>을 켜면 훨씬 부드러워집니다.';
        }
    }
    $('#tipOk').onclick = () => show('#gfxTip', false);
    $('#tipToday').onclick = () => { store.hideTip = today; save(); show('#gfxTip', false); };
}
