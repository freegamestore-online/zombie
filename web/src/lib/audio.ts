// ─── Procedural Audio Engine ─────────────────────────────────────────────────
// All sounds generated via Web Audio API — no external assets needed.

let ctx: AudioContext | null = null;
let muted = true;
let masterGain: GainNode | null = null;

export function initAudio() {
  if (ctx) return;
  ctx = new AudioContext();
  masterGain = ctx.createGain();
  masterGain.gain.value = 0; // start muted
  masterGain.connect(ctx.destination);
}

export function setMuted(m: boolean) {
  muted = m;
  if (masterGain) masterGain.gain.setTargetAtTime(m ? 0 : 0.6, ctx!.currentTime, 0.1);
}

export function isMuted() {
  return muted;
}

function resume() {
  if (ctx && ctx.state === "suspended") ctx.resume();
}

function noise(duration: number, freq: number, type: OscillatorType, vol: number, decay = 0.3) {
  if (!ctx || !masterGain) return;
  resume();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ctx.currentTime);
  gain.gain.setValueAtTime(vol, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  osc.connect(gain);
  gain.connect(masterGain);
  osc.start();
  osc.stop(ctx.currentTime + duration + decay);
}

function whiteNoise(duration: number, vol: number) {
  if (!ctx || !masterGain) return;
  resume();
  const bufSize = ctx.sampleRate * duration;
  const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(vol, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  src.connect(gain);
  gain.connect(masterGain);
  src.start();
  src.stop(ctx.currentTime + duration);
}

export const sfx = {
  shoot() {
    noise(0.08, 800, "sawtooth", 0.5);
    noise(0.05, 200, "square", 0.3);
  },
  shotgunBlast() {
    whiteNoise(0.12, 0.7);
    noise(0.15, 150, "sawtooth", 0.6);
  },
  rifleShot() {
    noise(0.06, 1200, "sawtooth", 0.4);
    noise(0.04, 300, "square", 0.25);
  },
  punch() {
    whiteNoise(0.07, 0.35);
    noise(0.1, 80, "sine", 0.5);
  },
  zombieGroan() {
    if (!ctx || !masterGain) return;
    resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(120 + Math.random() * 60, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(80 + Math.random() * 40, ctx.currentTime + 0.4);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    osc.connect(gain);
    gain.connect(masterGain);
    osc.start();
    osc.stop(ctx.currentTime + 0.6);
  },
  zombieDie() {
    whiteNoise(0.2, 0.4);
    noise(0.3, 60, "sawtooth", 0.4);
  },
  playerHurt() {
    noise(0.15, 400, "sine", 0.6);
    noise(0.1, 200, "square", 0.3);
  },
  pickup() {
    noise(0.1, 880, "sine", 0.3);
    noise(0.1, 1100, "sine", 0.25);
  },
  missionComplete() {
    [523, 659, 784, 1047].forEach((f, i) => {
      setTimeout(() => noise(0.2, f, "sine", 0.35), i * 80);
    });
  },
  waveStart() {
    [200, 250, 300].forEach((f, i) => {
      setTimeout(() => noise(0.3, f, "sawtooth", 0.4), i * 100);
    });
  },
  footstep() {
    whiteNoise(0.04, 0.08);
  },
  molotov() {
    whiteNoise(0.3, 0.5);
    noise(0.4, 300, "sawtooth", 0.5);
  },
  reload() {
    noise(0.05, 600, "square", 0.2);
    setTimeout(() => noise(0.05, 900, "square", 0.2), 100);
  },
  gameOver() {
    [400, 300, 200, 100].forEach((f, i) => {
      setTimeout(() => noise(0.4, f, "sawtooth", 0.5), i * 150);
    });
  },
};
