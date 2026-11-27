// v1.21: the sound of the place. Everything is synthesised with Web Audio (no recordings to download):
//   wind     filtered noise that gusts; stronger high up and out in the open, softer between the houses
//   birds    sparrow chirps and short songs around the houses and trees, now and then a jackdaw / crow call,
//            each from a random direction
//   water    small waves lapping on the shore when you are near the reservoir
//   insects  a faint grasshopper buzz in the dry grass outside the village
// set() is called a few times a second with where the listener is; levels glide, so nothing clicks.
export function createAmbience(ac, dest) {
  const out = ac.createGain(); out.gain.value = 0; out.connect(dest);
  const sr = ac.sampleRate;
  const noiseBuf = (sec, kind) => {
    const b = ac.createBuffer(2, sr * sec, sr);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c); let b0 = 0, b1 = 0, b2 = 0, last = 0;
      for (let i = 0; i < d.length; i++) {
        const w = Math.random() * 2 - 1;
        if (kind === 'pink') { b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.16; }
        else { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.2; }   // brown
      }
      // fade the loop seam
      const f = Math.floor(sr * 0.05); for (let i = 0; i < f; i++) { const k = i / f; d[i] *= k; d[d.length - 1 - i] *= k; }
    }
    return b;
  };
  const loop = (buf) => { const s = ac.createBufferSource(); s.buffer = buf; s.loop = true; s.loopStart = 0.05; s.loopEnd = buf.duration - 0.05; s.start(ac.currentTime + Math.random()); return s; };

  // ---- wind: brown + pink noise, low-pass whose cut-off and level wander (gusts)
  const windG = ac.createGain(); windG.gain.value = 0; windG.connect(out);
  const windLP = ac.createBiquadFilter(); windLP.type = 'lowpass'; windLP.frequency.value = 500; windLP.Q.value = 0.6;
  const windHi = ac.createBiquadFilter(); windHi.type = 'bandpass'; windHi.frequency.value = 1400; windHi.Q.value = 0.8;
  const windHiG = ac.createGain(); windHiG.gain.value = 0.05;
  const gust = ac.createGain(); gust.gain.value = 0.6;
  loop(noiseBuf(6, 'brown')).connect(windLP); windLP.connect(gust);
  loop(noiseBuf(5, 'pink')).connect(windHi); windHi.connect(windHiG); windHiG.connect(gust);
  gust.connect(windG);

  // ---- water lapping: band-passed noise swelling in slow irregular waves
  const waterG = ac.createGain(); waterG.gain.value = 0; waterG.connect(out);
  const wbp = ac.createBiquadFilter(); wbp.type = 'bandpass'; wbp.frequency.value = 650; wbp.Q.value = 0.9;
  const wlp = ac.createBiquadFilter(); wlp.type = 'lowpass'; wlp.frequency.value = 1800;
  const swell = ac.createGain(); swell.gain.value = 0.2;
  loop(noiseBuf(4, 'pink')).connect(wbp); wbp.connect(wlp); wlp.connect(swell); swell.connect(waterG);

  // ---- insects: a 4.6 kHz tone chopped into short pulses, fading in and out in phrases
  const bugG = ac.createGain(); bugG.gain.value = 0; bugG.connect(out);
  const bugOsc = ac.createOscillator(); bugOsc.type = 'triangle'; bugOsc.frequency.value = 4600;
  const bugAM = ac.createGain(); bugAM.gain.value = 0;
  const bugLfo = ac.createOscillator(); bugLfo.type = 'square'; bugLfo.frequency.value = 28;
  const bugLfoG = ac.createGain(); bugLfoG.gain.value = 0.5; bugLfo.connect(bugLfoG); bugLfoG.connect(bugAM.gain);
  const bugPhrase = ac.createGain(); bugPhrase.gain.value = 0;
  bugOsc.connect(bugAM); bugAM.connect(bugPhrase); bugPhrase.connect(bugG);
  bugOsc.start(); bugLfo.start();

  // ---- birds: one-shot voices
  const birdBus = ac.createGain(); birdBus.gain.value = 0; birdBus.connect(out);
  const pan = (p) => { if (ac.createStereoPanner) { const s = ac.createStereoPanner(); s.pan.value = p; s.connect(birdBus); return s; } return birdBus; };
  function chirp(t, f0, f1, dur, vol, p) {
    const o = ac.createOscillator(), g = ac.createGain(); o.type = 'sine';
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + dur * 0.15); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g); g.connect(pan(p)); o.start(t); o.stop(t + dur + 0.02);
  }
  function sparrow(t) {       // a house sparrow's "chilp chilp"
    const p = Math.random() * 1.6 - 0.8, n = 2 + (Math.random() * 4 | 0), base = 3200 + Math.random() * 900, v = 0.05 + Math.random() * 0.06;
    for (let i = 0; i < n; i++) { const tt = t + i * (0.13 + Math.random() * 0.09); chirp(tt, base * 1.25, base * 0.82, 0.07, v, p); chirp(tt + 0.012, base * 0.9, base * 1.15, 0.045, v * 0.6, p); }
  }
  function song(t) {          // a short warbling phrase (finch / lark like), further away
    const p = Math.random() * 1.8 - 0.9, n = 5 + (Math.random() * 7 | 0), v = 0.025 + Math.random() * 0.03;
    let f = 2600 + Math.random() * 1600;
    for (let i = 0; i < n; i++) { const d = 0.05 + Math.random() * 0.07, nf = Math.max(1800, Math.min(6500, f * (0.75 + Math.random() * 0.55))); chirp(t, f, nf, d, v, p); t += d + 0.015 + Math.random() * 0.04; f = nf; }
  }
  function crow(t) {          // a jackdaw / hooded crow calling once or twice in the distance
    const p = Math.random() * 1.8 - 0.9, n = 1 + (Math.random() * 3 | 0), v = 0.035 + Math.random() * 0.02, f = 520 + Math.random() * 180;
    for (let i = 0; i < n; i++) {
      const tt = t + i * (0.42 + Math.random() * 0.15), o = ac.createOscillator(), bp = ac.createBiquadFilter(), g = ac.createGain();
      o.type = 'sawtooth'; o.frequency.setValueAtTime(f * 1.1, tt); o.frequency.linearRampToValueAtTime(f * 0.88, tt + 0.26);
      bp.type = 'bandpass'; bp.frequency.value = 1300; bp.Q.value = 2.5;
      g.gain.setValueAtTime(0, tt); g.gain.linearRampToValueAtTime(v, tt + 0.03); g.gain.setValueAtTime(v, tt + 0.16); g.gain.exponentialRampToValueAtTime(0.0008, tt + 0.28);
      o.connect(bp); bp.connect(g); g.connect(pan(p)); o.start(tt); o.stop(tt + 0.3);
    }
  }

  let nextBird = 0, nextCrow = ac.currentTime + 6, nextGust = 0, nextSwell = 0, nextBug = 0, life = 0, on = false;
  const glide = (param, v, tc = 0.6) => param.setTargetAtTime(v, ac.currentTime, tc);
  return {
    /**
     * @param {object} s
     *   on      sound wanted (checkbox, tab visible)
     *   level   overall level 0..1 (lower inside the car, lower in the map view)
     *   height  listener height above the ground (m)
     *   village 0..1 among the houses
     *   trees   0..1 trees / gardens near
     *   water   0..1 close to the shore
     */
    set(s) {
      const t = ac.currentTime;
      on = s.on;
      glide(out.gain, s.on ? s.level * 1.6 : 0, 0.8);
      if (!s.on) return;
      const open = 1 - s.village * 0.6, high = Math.min(1, Math.max(0, s.height / 120));
      glide(windG.gain, (0.08 + 0.12 * open + 0.35 * high) * 0.9, 1.2);
      glide(windLP.frequency, 380 + 500 * high + 200 * open, 1.5);
      glide(waterG.gain, 0.32 * s.water * (1 - high), 1.0);
      glide(bugG.gain, 0.006 * (1 - s.village) * (1 - high) * (1 - s.water * 0.5), 1.5);
      life = Math.max(s.village, s.trees * 0.8) * (1 - high * 0.8);
      glide(birdBus.gain, 0.5 + 0.5 * life, 1.0);
      if (t > nextGust) {          // gusts: a new target level / brightness every 1.5–5 s
        const g = 0.35 + Math.random() * 0.75; gust.gain.setTargetAtTime(g, t, 0.8 + Math.random() * 1.2);
        windHiG.gain.setTargetAtTime(0.02 + g * 0.06, t, 1); nextGust = t + 1.5 + Math.random() * 3.5;
      }
      if (t > nextSwell) {          // a wave: rise, then fall back
        const d = 1.2 + Math.random() * 2.2; swell.gain.setTargetAtTime(0.35 + Math.random() * 0.65, t, d * 0.25); swell.gain.setTargetAtTime(0.1, t + d * 0.55, d * 0.3);
        wbp.frequency.setTargetAtTime(500 + Math.random() * 400, t, 0.5); nextSwell = t + d;
      }
      if (t > nextBug) { const d = 1 + Math.random() * 3; bugPhrase.gain.setTargetAtTime(Math.random() < 0.6 ? 1 : 0, t, 0.25); bugOsc.frequency.setTargetAtTime(4300 + Math.random() * 700, t, 0.3); nextBug = t + d; }
      if (t > nextBird) {
        if (life > 0.05) { if (Math.random() < 0.7) sparrow(t + 0.05); else song(t + 0.05); }
        else if (Math.random() < 0.3) song(t + 0.05);        // a lark now and then out in the open
        nextBird = t + (life > 0.05 ? 1.2 + Math.random() * 5 / (0.3 + life) : 6 + Math.random() * 10);
      }
      if (t > nextCrow) { if (high < 0.8) crow(t + 0.05); nextCrow = t + 14 + Math.random() * 30; }
    },
    get on() { return on; },
  };
}
