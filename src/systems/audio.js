const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// 엔진음 프로필: cyl 기통수, pipe 배기관 공명 지연(ms), fb 공명 강도, bright 밝기, scale 게임 rpm → 실제 rpm 배율, turbo 터보, crackle 오버런 팝
export const ENGINES = {
    v8: { cyl: 8, pipe: 1.9, fb: 0.55, bright: 1.15, scale: 1.2, turbo: 0, crackle: 0.5, uneven: 0.08 },
    v10: { cyl: 10, pipe: 1.6, fb: 0.5, bright: 1.4, scale: 1.17, turbo: 0, crackle: 0.35, uneven: 0.12 },
    v12: { cyl: 12, pipe: 1.4, fb: 0.45, bright: 1.3, scale: 1.15, turbo: 0, crackle: 0.2, uneven: 0.04 },
    i6t: { cyl: 6, pipe: 2.6, fb: 0.6, bright: 0.95, scale: 0.95, turbo: 1, crackle: 1, uneven: 0.06 },
};

// AudioWorklet: 기통별 폭발 펄스 → 배기관 공명(콤 필터) → 머플러(로우패스). 연소 노이즈, 오버런 팝, 터보 휘슬 포함.
// 목소리(voice) 여러 개를 동시에 합성해 플레이어 차와 가까운 AI 차들을 함께 낸다.
export const WORKLET = `
class Engine extends AudioWorkletProcessor {
  constructor() {
    super(); this.vs = []; this.tg = [];
    this.port.onmessage = (e) => { this.tg = e.data; };
  }
  voice(i) {
    if (!this.vs[i]) { const d = new Float32Array(4096); this.vs[i] = { ph: 0, rpm: 900, load: 0, g: 0, pan: 0, lp1: 0, lp2: 0, hp: 0, dl: d, di: 0, fi: -1, amp: 1, pop: 0, boost: 0, tph: 0, n: 0, inside: 0 }; }
    return this.vs[i];
  }
  process(_, outs) {
    const out = outs[0], L = out[0], R = out[1] || out[0], n = L.length;
    for (let k = 0; k < n; k++) { L[k] = 0; if (R !== L) R[k] = 0; }
    const sr = sampleRate;
    for (let vi = 0; vi < Math.max(this.vs.length, this.tg.length); vi++) {
      const t = this.tg[vi] || { rpm: 900, load: 0, gain: 0, pan: 0 }, v = this.voice(vi), p = t.p || { cyl: 8, pipe: 1.9, fb: .5, bright: 1, scale: 1, turbo: 0, crackle: .3, uneven: .05 };
      if (t.gain < 1e-4 && v.g < 1e-4) continue;
      const dlen = Math.max(8, Math.min(4000, Math.round(p.pipe * .001 * sr)));
      const kr = 1 - Math.exp(-1 / (sr * .03)), kg = 1 - Math.exp(-1 / (sr * .05));
      for (let k = 0; k < n; k++) {
        v.rpm += (t.rpm * p.scale - v.rpm) * kr; v.load += (t.load - v.load) * kr; v.g += (t.gain - v.g) * kg; v.pan += (t.pan - v.pan) * kg; v.inside += ((t.inside || 0) - v.inside) * kg;
        const cyc = v.rpm / 120, fire = cyc * p.cyl;
        v.ph += cyc / sr; if (v.ph >= 1) v.ph -= 1;
        const fpos = v.ph * p.cyl, ci = Math.floor(fpos), fp = fpos - ci;
        if (ci !== v.fi) {
          v.fi = ci;
          // 폭발마다 세기를 조금씩 다르게 (기통 편차 + 무작위)
          v.amp = 1 + p.uneven * Math.sin(ci * 2.39 + 1) + (Math.random() - .5) * .12;
          const over = v.load < .06 && v.rpm > 3800;
          v.pop = over && Math.random() < p.crackle * .05 ? 2.5 + Math.random() * 3 : 0;
          if (t.limit && Math.random() < .5) v.amp = 0;
        }
        const tt = fp / fire, env = Math.exp(-tt / .0011) * (1 - Math.exp(-tt / .00012));
        v.n = (Math.random() * 2 - 1);
        const ld = .3 + .7 * v.load;
        let x = env * v.amp * ld * (1 + v.n * .2 * v.load) + v.pop * env * v.n;
        // 배기관 공명 (피드백 콤 필터)
        const di = (v.di + 4096 - dlen) & 4095, y = x + v.dl[di] * p.fb;
        v.dl[v.di] = y; v.di = (v.di + 1) & 4095;
        // 머플러: 2단 로우패스, 부하·회전수가 높을수록 밝게. 실내에서는 더 먹먹하게
        const fc = (380 + (v.rpm / 9000) * 1900 * p.bright + v.load * 1100 * p.bright) * (1 - .45 * v.inside), a = 1 - Math.exp(-2 * Math.PI * fc / sr);
        v.lp1 += (y - v.lp1) * a; v.lp2 += (v.lp1 - v.lp2) * a;
        v.hp += (v.lp2 - v.hp) * .002;
        let s = (v.lp2 - v.hp) * 2.2;
        // 터보: 부하에 따라 늦게 차오르는 부스트, 휘슬
        if (p.turbo) { v.boost += ((v.load * Math.min(1, v.rpm / 5000)) - v.boost) * .00004; v.tph += (1800 + v.boost * 7000) / sr; s += Math.sin(v.tph * 6.2832) * v.boost * v.boost * .05; }
        s = Math.tanh(s * 1.4) * v.g;
        const pl = Math.sqrt(.5 * (1 - v.pan)), pr = Math.sqrt(.5 * (1 + v.pan));
        L[k] += s * pl; if (R !== L) R[k] += s * pr;
      }
    }
    return true;
  }
}
registerProcessor('sgp-engine', Engine);`;

export class Sound {
    async init() {
        if (this.c) { this.c.resume(); return; }
        const c = this.c = new (window.AudioContext || window.webkitAudioContext)();
        const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4; comp.connect(c.destination);
        this.m = c.createGain(); this.m.connect(comp);
        const nb = this.nb = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), d = nb.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        // 상시 재생되는 필터 노이즈 레이어: 흡기, 바람, 노면, 타이어, 벽 긁힘
        const layer = (type, f, q) => {
            const s = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain();
            s.buffer = nb; s.loop = true; fl.type = type; fl.frequency.value = f; fl.Q.value = q; g.gain.value = 0;
            s.connect(fl); fl.connect(g); g.connect(this.m); s.start(); return { f: fl, g };
        };
        Object.assign(this, { intake: layer('bandpass', 900, 1.2), wind: layer('lowpass', 800, 0.7), road: layer('lowpass', 160, 0.8), skid: layer('bandpass', 1300, 5), skid2: layer('highpass', 3200, 0.7), scrape: layer('bandpass', 2400, 2.5) });
        // 타이어 비명: 주파수가 떨리는 사인 두 개 (노이즈만 쓸 때보다 실제 스키드음에 가깝다)
        this.sq = [760, 1130].map((f) => { const o = c.createOscillator(), g = c.createGain(); o.type = 'triangle'; o.frequency.value = f; g.gain.value = 0; o.connect(g); g.connect(this.m); o.start(); return { o, g, f }; });
        this.eg = c.createGain(); this.eg.gain.value = 1; this.eg.connect(this.m);
        try {
            const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
            await c.audioWorklet.addModule(url);
            this.node = new AudioWorkletNode(c, 'sgp-engine', { numberOfInputs: 0, outputChannelCount: [2] });
            this.node.connect(this.eg);
        } catch (e) {
            // AudioWorklet을 못 쓰는 환경: 배음 오실레이터로 대신한다
            console.warn('AudioWorklet 사용 불가, 간이 엔진음으로 대체', e);
            const harm = [0, 1, 0.55, 0.45, 0.3, 0.22, 0.15, 0.1, 0.07], wave = c.createPeriodicWave(new Float32Array(harm.length), Float32Array.from(harm));
            this.o = [0, 9].map((det) => { const o = c.createOscillator(); o.setPeriodicWave(wave); o.detune.value = det; o.start(); return o; });
            this.lp = c.createBiquadFilter(); this.lp.type = 'lowpass'; this.fg = c.createGain(); this.fg.gain.value = 0;
            this.o.forEach((o) => o.connect(this.lp)); this.lp.connect(this.fg); this.fg.connect(this.eg);
        }
        this.prevThr = 0; this.fc = 0; this.timers = new Set(); this.profile ??= ENGINES.v8; this.volume(this.mv ?? 0.8, this.ev ?? 0.7);
    }

    volume(m, e) { this.mv = m; this.ev = e; if (this.c) this.m.gain.value = m; }
    setProfile(id) { this.profile = ENGINES[id] || ENGINES.v8; }

    // s: 플레이어 상태, others: [{rpm, thr, dist, pan, snd, vrel}] 가까운 AI 차량
    drive(s, others = []) {
        if (!this.c || (this.fc++ & 1)) return;
        const t = this.c.currentTime, rn = clamp((s.rpm - 1000) / 6500, 0, 1), set = (p, v, k = 0.05) => p.setTargetAtTime(v, t, k), ev = this.ev, P = this.profile;
        if (this.node) {
            const vs = [{ rpm: s.rpm, load: s.thr, gain: (0.16 + 0.1 * s.thr) * ev, pan: 0, p: P, inside: s.inside ? 1 : 0, limit: s.rpm > 7450 && s.thr > 0.5 }];
            for (const o of others.slice(0, 3)) {
                const g = (0.5 / (1 + o.dist / 6)) ** 1.4 * (0.5 + 0.5 * o.thr) * ev, dop = clamp(1 + o.vrel / 343, 0.8, 1.25);
                vs.push({ rpm: o.rpm * dop, load: o.thr, gain: g, pan: clamp(o.pan, -0.9, 0.9), p: ENGINES[o.snd] || P, inside: s.inside ? 1 : 0 });
            }
            this.node.port.postMessage(vs);
        } else if (this.o) {
            const f = (s.rpm * P.scale / 120) * P.cyl / 2;
            this.o.forEach((o) => o.frequency.setTargetAtTime(f, t, 0.04));
            set(this.lp.frequency, 500 + rn * 3200 + s.thr * 1800, 0.06); set(this.fg.gain, (0.08 + 0.12 * s.thr) * ev);
        }
        set(this.intake.f.frequency, 500 + rn * 900); set(this.intake.g.gain, s.thr * rn * (s.inside ? 0.09 : 0.05) * ev);
        set(this.wind.g.gain, (s.kmh / 300) ** 2 * (s.inside ? 0.22 : 0.4)); set(this.wind.f.frequency, 400 + s.kmh * 6);
        set(this.road.g.gain, Math.min(1, s.kmh / 200) * (s.inside ? 0.14 : 0.08) * (s.ground ? 1 : 0));
        const sl = s.slide;
        set(this.skid.g.gain, sl * 0.12); set(this.skid.f.frequency, 1000 + sl * 700); set(this.skid2.g.gain, sl * 0.03);
        this.sq.forEach((q, i) => { set(q.g.gain, Math.max(0, sl - 0.25) * (i ? 0.025 : 0.04)); set(q.o.frequency, q.f * (0.92 + 0.16 * Math.random()) * (0.9 + s.kmh / 900), 0.03); });
        set(this.scrape.g.gain, s.scrape * 0.3 * (0.7 + 0.3 * Math.random()), 0.03);
        // 가속 페달을 고회전에서 떼면 '팝' (터보 차는 블로오프 밸브 소리)
        if (this.prevThr > 0.6 && s.thr < 0.2 && rn > 0.5) {
            if (P.turbo) this.blow();
            for (let i = 0; i < 2 + Math.round(P.crackle * 3); i++) this.later(() => this.burst('bandpass', 200 + Math.random() * 140, 2, 0.35 * P.crackle + 0.1, 0.07), 60 + i * 80 + Math.random() * 60);
        }
        this.prevThr = s.thr;
    }

    later(fn, ms) { const id = setTimeout(() => { this.timers.delete(id); fn(); }, ms); this.timers.add(id); }

    burst(type, freq, q, gain, dur) {
        const c = this.c, t = c.currentTime, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
        s.buffer = this.nb; f.type = type; f.frequency.value = freq; f.Q.value = q;
        g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        s.connect(f); f.connect(g); g.connect(this.m); s.start(t, Math.random()); s.stop(t + dur + 0.05);
    }

    blow() { if (this.c) { this.burst('highpass', 2600, 0.7, 0.16, 0.4); this.burst('bandpass', 5200, 3, 0.05, 0.3); } }
    // 변속: 기어가 물리는 짧은 기계음, 고부하 업시프트면 배기 '퍽'
    shift(up, thr) { if (!this.c) return; this.burst('bandpass', 900, 4, 0.06, 0.05); if (up && thr > 0.5) this.burst('bandpass', 220, 2, 0.4, 0.1); }

    tone(f, dur, type = 'sine', vol = 0.25, when = 0) {
        const c = this.c, t = c.currentTime + when, o = c.createOscillator(), g = c.createGain();
        o.type = type; o.frequency.value = f; g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        o.connect(g); g.connect(this.m); o.start(t); o.stop(t + dur);
    }

    // 충돌: 둔탁한 저음 + 금속성 울림 + 파편
    hit(v) {
        if (!this.c) return;
        const c = this.c, t = c.currentTime, k = clamp(v / 15, 0.15, 1), o = c.createOscillator(), g = c.createGain();
        o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.3);
        g.gain.setValueAtTime(0.9 * k, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
        o.connect(g); g.connect(this.m); o.start(t); o.stop(t + 0.4);
        this.burst('lowpass', 700, 0.7, 0.8 * k, 0.35); this.burst('bandpass', 2600, 3, 0.25 * k, 0.25);
        this.tone(520 + Math.random() * 200, 0.35, 'triangle', 0.05 * k); this.tone(1310, 0.2, 'triangle', 0.03 * k);
        if (k > 0.5) this.later(() => this.burst('highpass', 4000, 1, 0.12 * k, 0.3), 40);
    }

    beep(f, dur = 0.18) { if (this.c) { this.tone(f, dur); this.tone(f * 2, dur, 'sine', 0.06); } }
    chime() { if (this.c) { this.tone(784, 0.3, 'sine', 0.2); this.tone(1175, 0.5, 'sine', 0.2, 0.12); } }
    stop() {
        if (!this.c) return; this.timers.forEach(clearTimeout); this.timers.clear(); const t = this.c.currentTime;
        this.node?.port.postMessage([]);
        [this.fg, this.intake.g, this.wind.g, this.road.g, this.skid.g, this.skid2.g, this.scrape.g, ...this.sq.map((q) => q.g)].forEach((n) => n?.gain.setTargetAtTime(0, t, 0.05));
    }
}
