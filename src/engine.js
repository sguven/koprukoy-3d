// v1.8: engine / exhaust sound of the Toros (Renault 12, 1.4 four-cylinder petrol, four-stroke).
// The v1.7 sound was two plain oscillators behind a 400-1400 Hz low-pass, which came out dull and muffled.
// This one is built like a real exhaust note:
//   firing pulses  — a 4-cylinder 4-stroke fires twice per crank turn (rpm / 60 * 2 Hz); a pulse-shaped wave with
//                    slowly falling harmonics gives the buzzy, open exhaust tone instead of a hum
//   half order     — a weaker component at half the firing rate: the slight lumpiness of real cylinders
//   exhaust rasp   — noise chopped at the firing rate (amplitude-modulated), band-passed: the "brrr" of the pipe
//   grit          — soft saturation that grows with throttle; pipe resonances (low body + mid bark)
//   tone          — a low-pass that opens with throttle and rpm (1.8 kHz at idle, up to ~5.5 kHz flat out)
// Off throttle the note gets quieter and softer, like a real engine on overrun.
export function createEngine(ac, dest) {
  const t0 = ac.currentTime;

  // firing pulses: harmonic k has amplitude 1/k^0.7, odd and even mixed so it reads as pulses, not a square wave
  const N = 40, re = new Float32Array(N + 1), im = new Float32Array(N + 1);
  for (let k = 1; k <= N; k++) { re[k] = (k % 2 ? 1 : 0.75) / Math.pow(k, 0.7); im[k] = 0; }
  const pulse = ac.createOscillator(); pulse.setPeriodicWave(ac.createPeriodicWave(re, im, { disableNormalization: false }));
  const half = ac.createOscillator(); half.type = 'triangle';
  const pulseG = ac.createGain(); pulseG.gain.value = 0.55;
  const halfG = ac.createGain(); halfG.gain.value = 0.22;
  pulse.connect(pulseG); half.connect(halfG);

  // exhaust rasp: looping white noise -> band-pass -> gain whose level is swung by a sine at the firing rate
  const nb = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate), nd = nb.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  const noise = ac.createBufferSource(); noise.buffer = nb; noise.loop = true;
  const nbp = ac.createBiquadFilter(); nbp.type = 'bandpass'; nbp.frequency.value = 900; nbp.Q.value = 0.7;
  const chop = ac.createGain(); chop.gain.value = 0.5;            // 0.5 ± 0.5 at the firing rate
  const mod = ac.createOscillator(); mod.type = 'sine';
  const modG = ac.createGain(); modG.gain.value = 0.5;
  mod.connect(modG); modG.connect(chop.gain);
  const raspG = ac.createGain(); raspG.gain.value = 0.35;
  noise.connect(nbp); nbp.connect(chop); chop.connect(raspG);

  // mix -> drive -> saturation -> pipe resonances -> tone -> level
  const mix = ac.createGain(); pulseG.connect(mix); halfG.connect(mix); raspG.connect(mix);
  const drive = ac.createGain(); drive.gain.value = 1.2;
  const sat = ac.createWaveShaper(); const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) { const x = i / (curve.length - 1) * 2 - 1; curve[i] = Math.tanh(2.2 * x) / Math.tanh(2.2); }
  sat.curve = curve; sat.oversample = '2x';
  const body = ac.createBiquadFilter(); body.type = 'peaking'; body.frequency.value = 140; body.Q.value = 0.9; body.gain.value = 5;
  const bark = ac.createBiquadFilter(); bark.type = 'peaking'; bark.frequency.value = 650; bark.Q.value = 1.2; bark.gain.value = 4;
  const tone = ac.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 1800; tone.Q.value = 0.5;
  const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 30;   // no sub-bass boom on laptops
  const out = ac.createGain(); out.gain.value = 0;
  mix.connect(drive); drive.connect(sat); sat.connect(body); body.connect(bark); bark.connect(tone); tone.connect(hp); hp.connect(out); out.connect(dest);

  for (const o of [pulse, half, mod]) { o.frequency.value = 28; o.start(t0); }
  noise.start(t0);

  let thrS = 0, jit = 0;
  return {
    // rpm: crank rpm; thr: 0..1 throttle; on: audible or not
    set(rpm, thr, on) {
      const t = ac.currentTime;
      thrS += (thr - thrS) * 0.15;                                  // throttle eased so the note does not click
      jit += ((Math.random() - 0.5) * 0.02 - jit) * 0.3;           // ±1 % idle wobble
      const fire = rpm / 60 * 2 * (1 + jit * (rpm < 1200 ? 1 : 0.3));
      pulse.frequency.setTargetAtTime(fire, t, 0.03);
      mod.frequency.setTargetAtTime(fire, t, 0.03);
      half.frequency.setTargetAtTime(fire / 2, t, 0.03);
      const r = Math.min(1, Math.max(0, (rpm - 800) / 5000));      // 0 at idle, 1 near the red line
      nbp.frequency.setTargetAtTime(700 + r * 1600 + thrS * 600, t, 0.05);
      raspG.gain.setTargetAtTime(0.2 + thrS * 0.17 + r * 0.1, t, 0.05);
      drive.gain.setTargetAtTime(1.4 + thrS * 0.8 + r * 0.3, t, 0.05);
      tone.frequency.setTargetAtTime(1800 + thrS * 2000 + r * 1800, t, 0.05);
      bark.frequency.setTargetAtTime(550 + r * 500, t, 0.1);
      const overrun = 1 - (1 - thrS) * r * 0.9;                     // lifting off at high rpm: much quieter
      out.gain.setTargetAtTime(on ? (0.26 - thrS * 0.09 - r * 0.05) * overrun : 0, t, 0.08);
    },
  };
}
