export class Sound {
  init() {
    if (this.c) { this.c.resume(); return; }
    const c = this.c = new (window.AudioContext || window.webkitAudioContext)();
    const osc = (type, f) => { const o = c.createOscillator(); o.type = type; o.frequency.value = f; o.start(); return o; };
    this.m = c.createGain(); this.m.connect(c.destination);
    this.eg = c.createGain(); this.eg.gain.value = 0;
    this.lp = c.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 900;
    this.o1 = osc('sawtooth', 50); this.o2 = osc('square', 25);
    this.o1.connect(this.lp); this.o2.connect(this.lp); this.lp.connect(this.eg); this.eg.connect(this.m);

    const nb = this.nb = c.createBuffer(1, c.sampleRate, c.sampleRate), d = nb.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const s = c.createBufferSource(), bp = c.createBiquadFilter();
    s.buffer = nb; s.loop = true; bp.type = 'bandpass'; bp.frequency.value = 1700;
    this.sg = c.createGain(); this.sg.gain.value = 0;
    s.connect(bp); bp.connect(this.sg); this.sg.connect(this.m); s.start();
    this.volume(this.mv ?? 0.8, this.ev ?? 0.7);
  }

  volume(m, e) { this.mv = m; this.ev = e; if (this.c) this.m.gain.value = m; }

  engine(rpm, thr, on = true) {
    if (!this.c) return;
    const t = this.c.currentTime;
    this.o1.frequency.setTargetAtTime(rpm / 30, t, 0.04);
    this.o2.frequency.setTargetAtTime(rpm / 60, t, 0.04);
    this.lp.frequency.setTargetAtTime(600 + thr * 1800 + rpm * 0.15, t, 0.05);
    this.eg.gain.setTargetAtTime(on ? (0.07 + 0.1 * thr) * this.ev : 0, t, 0.08);
  }

  skid(v) { if (this.c) this.sg.gain.setTargetAtTime(v * 0.3, this.c.currentTime, 0.05); }

  hit(v) {
    if (!this.c) return;
    const c = this.c, t = c.currentTime, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.nb; f.type = 'lowpass'; f.frequency.value = 600;
    g.gain.setValueAtTime(Math.min(1, v / 15) * 0.8, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    s.connect(f); f.connect(g); g.connect(this.m); s.start(t); s.stop(t + 0.4);
  }

  beep(freq, dur = 0.18) {
    if (!this.c) return;
    const c = this.c, t = c.currentTime, o = c.createOscillator(), g = c.createGain();
    o.frequency.value = freq; g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.m); o.start(t); o.stop(t + dur);
  }

  stop() { this.engine(900, 0, false); this.skid(0); }
}
