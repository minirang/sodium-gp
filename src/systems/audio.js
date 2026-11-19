const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class Sound {
    init() {
        if (this.c) { this.c.resume(); return; }
        const c = this.c = new (window.AudioContext || window.webkitAudioContext)();
        const comp = c.createDynamicsCompressor(); comp.connect(c.destination);
        this.m = c.createGain(); this.m.connect(comp);
        const nb = this.nb = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), d = nb.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

        // 상시 재생되는 필터 노이즈 레이어: 흡기, 바람, 노면, 타이어, 벽 긁힘
        const layer = (type, f, q) => {
            const s = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain();
            s.buffer = nb; s.loop = true; fl.type = type; fl.frequency.value = f; fl.Q.value = q; g.gain.value = 0;
            s.connect(fl); fl.connect(g); g.connect(this.m); s.start(); return { f: fl, g };
        };
        Object.assign(this, { intake: layer('bandpass', 900, 1.2), wind: layer('lowpass', 800, 0.7), road: layer('lowpass', 180, 0.7), skid: layer('bandpass', 1500, 6), skid2: layer('highpass', 3200, 0.7), scrape: layer('bandpass', 2400, 2.5) });

        // 엔진: 배음이 풍부한 파형 3개 → 왜곡 → 배기 공명 → 로우패스
        const harm = [0, 1, 0.55, 0.45, 0.3, 0.22, 0.15, 0.1, 0.07];
        const wave = c.createPeriodicWave(new Float32Array(harm.length), Float32Array.from(harm));
        const osc = (f, det = 0) => { const o = c.createOscillator(); o.setPeriodicWave(wave); o.frequency.value = f; o.detune.value = det; o.start(); return o; };
        this.o = [osc(60), osc(60, 9), osc(30)];
        const mix = c.createGain(), sh = c.createWaveShaper(), curve = new Float32Array(1024);
        for (let i = 0; i < 1024; i++) curve[i] = Math.tanh(2.5 * (i / 512 - 1));
        sh.curve = curve;
        const pk = (f, g) => { const p = c.createBiquadFilter(); p.type = 'peaking'; p.frequency.value = f; p.gain.value = g; p.Q.value = 1; return p; };
        this.lp = c.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 900;
        this.am = c.createGain(); this.am.gain.value = 0.85;
        this.lfo = c.createOscillator(); this.lfo.frequency.value = 14; this.lfoG = c.createGain(); this.lfoG.gain.value = 0; this.lfo.connect(this.lfoG); this.lfoG.connect(this.am.gain); this.lfo.start();
        this.eg = c.createGain(); this.eg.gain.value = 0;
        this.o.forEach((o) => o.connect(mix));
        mix.connect(sh); sh.connect(pk(220, 6)).connect(pk(650, 4)).connect(this.lp); this.lp.connect(this.am); this.am.connect(this.eg); this.eg.connect(this.m);

        this.turbo = c.createOscillator(); this.tg = c.createGain(); this.tg.gain.value = 0; this.turbo.frequency.value = 3000;
        this.turbo.connect(this.tg); this.tg.connect(this.m); this.turbo.start();
        this.prevThr = 0; this.fc = 0; this.timers = new Set(); this.volume(this.mv ?? 0.8, this.ev ?? 0.7);
    }

    volume(m, e) { this.mv = m; this.ev = e; if (this.c) this.m.gain.value = m; }

    drive(s) {
        if (!this.c || (this.fc++ & 1)) return;
        const t = this.c.currentTime, rn = clamp((s.rpm - 1000) / 6500, 0, 1), f = s.rpm / 15, set = (p, v, k = 0.05) => p.setTargetAtTime(v, t, k), ev = this.ev;
        this.o[0].frequency.setTargetAtTime(f, t, 0.04); this.o[1].frequency.setTargetAtTime(f, t, 0.04); this.o[2].frequency.setTargetAtTime(f / 2, t, 0.04);
        set(this.lp.frequency, 500 + rn * 3200 + s.thr * 1800, 0.06);
        set(this.lfoG.gain, (1 - s.thr) * 0.28); set(this.lfo.frequency, 9 + rn * 14);
        set(this.eg.gain, (0.09 + 0.13 * s.thr) * (0.6 + 0.4 * rn) * ev, 0.08);
        set(this.intake.f.frequency, 500 + rn * 900); set(this.intake.g.gain, s.thr * rn * 0.12 * ev);
        set(this.turbo.frequency, 2500 + rn * 6500); set(this.tg.gain, s.thr * rn * rn * 0.012 * ev);
        set(this.wind.g.gain, (s.kmh / 300) ** 2 * 0.4); set(this.wind.f.frequency, 400 + s.kmh * 6);
        set(this.road.g.gain, (s.kmh / 300) * 0.09);
        set(this.skid.g.gain, s.slide * 0.22); set(this.skid.f.frequency, 1100 + s.slide * 900); set(this.skid2.g.gain, s.slide * 0.05);
        set(this.scrape.g.gain, s.scrape * 0.3 * (0.7 + 0.3 * Math.random()), 0.03);
        if (this.prevThr > 0.6 && s.thr < 0.2 && rn > 0.5) { this.blow(); for (let i = 0; i < 3; i++) this.later(() => this.burst('bandpass', 220 + Math.random() * 100, 2, 0.35, 0.09), 60 + i * 90 + Math.random() * 60); }
        this.prevThr = s.thr;
    }

    later(fn, ms) { const id = setTimeout(() => { this.timers.delete(id); fn(); }, ms); this.timers.add(id); }

    burst(type, freq, q, gain, dur, hp = 0) {
        const c = this.c, t = c.currentTime, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
        s.buffer = this.nb; f.type = type; f.frequency.value = freq; f.Q.value = q;
        g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        s.connect(f); f.connect(g); g.connect(this.m); s.start(t, Math.random()); s.stop(t + dur + 0.05);
    }

    blow() { if (this.c) this.burst('highpass', 3500, 0.7, 0.14, 0.35); }
    shift(up, thr) { if (this.c && up && thr > 0.5) this.burst('bandpass', 240, 2, 0.4, 0.1); }

    tone(f, dur, type = 'sine', vol = 0.25, when = 0) {
        const c = this.c, t = c.currentTime + when, o = c.createOscillator(), g = c.createGain();
        o.type = type; o.frequency.value = f; g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        o.connect(g); g.connect(this.m); o.start(t); o.stop(t + dur);
    }

    hit(v) {
        if (!this.c) return;
        const c = this.c, t = c.currentTime, k = clamp(v / 15, 0.15, 1), o = c.createOscillator(), g = c.createGain();
        o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.3);
        g.gain.setValueAtTime(0.9 * k, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
        o.connect(g); g.connect(this.m); o.start(t); o.stop(t + 0.4);
        this.burst('lowpass', 900, 0.7, 0.8 * k, 0.4); this.burst('bandpass', 2600, 3, 0.3 * k, 0.25);
        this.tone(620, 0.3, 'triangle', 0.08 * k); this.tone(970, 0.25, 'triangle', 0.06 * k);
    }

    beep(f, dur = 0.18) { if (this.c) { this.tone(f, dur); this.tone(f * 2, dur, 'sine', 0.06); } }
    chime() { if (this.c) { this.tone(784, 0.3, 'sine', 0.2); this.tone(1175, 0.5, 'sine', 0.2, 0.12); } }
    stop() { if (!this.c) return; this.timers.forEach(clearTimeout); this.timers.clear(); const t = this.c.currentTime;[this.eg, this.tg, this.intake.g, this.wind.g, this.road.g, this.skid.g, this.skid2.g, this.scrape.g].forEach((n) => n.gain.setTargetAtTime(0, t, 0.05)); }
}
