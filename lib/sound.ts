// 배경음과 효과음. 파일은 public/sound에 있다.
// 원본 음량 차이가 커서(숲 바람 최대 4%, out 96%) 소리별로 보정한다.
const LEVEL = { wind: 6, spool: 3, water: 1.5, step: 1, in: 3, out: 0.6 };
const FILES = {
  wind: "forest_wind", spool: "forese_spool", water: "water", step: "step", in: "in", out: "out",
} as const;
type Name = keyof typeof FILES;

const SPOOL_GAP_MIN = 25, SPOOL_GAP_MAX = 70; // 숲 소리 사이 간격(초)
const WATER_NEAR = 3, WATER_FAR = 24; // 이 거리 안이면 최대, 밖이면 들리지 않음(미터)
// step.wav에 든 발소리 세 개: 시작(초), 길이(초), 음량 보정(원본 최대 12%, 8.5%, 19%를 같은 크기로)
const STEP_SLICES = [
  { at: 0.08, dur: 0.5, gain: 2 },
  { at: 0.79, dur: 0.42, gain: 2.8 },
  { at: 1.54, dur: 0.4, gain: 1.3 },
];

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let loading: Promise<void> | null = null;
const buffers: Partial<Record<Name, AudioBuffer>> = {};

let running = false;
let loops: AudioBufferSourceNode[] = [];
let waterGain: GainNode | null = null;
let stepNode: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
let stepIndex = 0;
let stepCount = 0, dropCount = 0;
let spoolTimer: ReturnType<typeof setTimeout> | null = null;

function load() {
  return (loading ??= Promise.all(
    (Object.keys(FILES) as Name[]).map(async (name) => {
      const res = await fetch(`/sound/${FILES[name]}.wav`);
      buffers[name] = await ctx!.decodeAudioData(await res.arrayBuffer());
    }),
  ).then(() => undefined).catch((e) => { console.warn("sound", e); loading = null; }));
}

function onVisibility() {
  if (!ctx) return;
  if (document.hidden) void ctx.suspend();
  else void ctx.resume();
}

// 브라우저는 사용자 입력 없이 소리를 내지 못한다. 입장 버튼의 클릭 안에서 호출한다
export function unlockSound() {
  if (ctx) { void ctx.resume(); return; }
  ctx = new AudioContext();
  master = ctx.createGain();
  // 소리가 겹쳐도 찢어지지 않게 마지막에 압축기를 둔다
  const limiter = ctx.createDynamicsCompressor();
  master.connect(limiter).connect(ctx.destination);
  document.addEventListener("visibilitychange", onVisibility);
  void ctx.resume();
  void load();
}

function loop(name: Name, gain: number) {
  const g = ctx!.createGain();
  g.gain.value = gain;
  g.connect(master!);
  const s = ctx!.createBufferSource();
  s.buffer = buffers[name]!;
  s.loop = true;
  s.connect(g);
  s.start();
  loops.push(s);
  return g;
}

function scheduleSpool() {
  const wait = SPOOL_GAP_MIN + Math.random() * (SPOOL_GAP_MAX - SPOOL_GAP_MIN);
  spoolTimer = setTimeout(() => {
    if (!running || !ctx) return;
    one("spool");
    scheduleSpool();
  }, wait * 1000);
}

function one(name: Name) {
  const buf = buffers[name];
  if (!ctx || !master || !buf) return;
  const g = ctx.createGain();
  g.gain.value = LEVEL[name];
  g.connect(master);
  const s = ctx.createBufferSource();
  s.buffer = buf;
  s.connect(g);
  s.onended = () => g.disconnect();
  s.start();
}

export function startSound() {
  running = true;
  if (!ctx) return;
  void load()?.then(() => {
    if (!running || loops.length || !buffers.wind || !ctx) return;
    loop("wind", LEVEL.wind);
    waterGain = loop("water", 0);
    scheduleSpool();
  });
}

export function stopSound() {
  running = false;
  stopStep();
  if (spoolTimer) clearTimeout(spoolTimer);
  spoolTimer = null;
  for (const s of loops) { s.stop(); s.disconnect(); }
  loops = [];
  waterGain = null;
}

export const playPick = () => one("in");
export const playDrop = () => { dropCount++; one("out"); };

// 물까지의 거리(미터)에 따라 물소리를 서서히 키우고 줄인다
export function setWaterDistance(distance: number) {
  if (!ctx || !waterGain) return;
  const t = Math.min(1, Math.max(0, (WATER_FAR - distance) / (WATER_FAR - WATER_NEAR)));
  waterGain.gain.setTargetAtTime(t * t * LEVEL.water, ctx.currentTime, 0.8);
}

// 발이 땅에 닿는 순간 호출한다. 발소리 세 개를 번갈아 낸다
export function playStep() {
  const buf = buffers.step;
  if (!ctx || !master || !buf || !running) return;
  const slice = STEP_SLICES[stepIndex++ % STEP_SLICES.length];
  const now = ctx.currentTime;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(slice.gain * LEVEL.step, now);
  gain.gain.setTargetAtTime(0, now + slice.dur - 0.06, 0.02); // 끝이 끊기지 않게 살짝 줄인다
  gain.connect(master);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(gain);
  src.onended = () => gain.disconnect();
  src.start(now, slice.at, slice.dur);
  stepNode = { src, gain };
  stepCount++;
}

// 멈추면 남은 발소리를 바로 줄인다
export function stopStep() {
  if (!ctx || !stepNode) return;
  stepNode.gain.gain.cancelScheduledValues(ctx.currentTime);
  stepNode.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
  stepNode = null;
}

export const soundDebug = () => ({
  state: ctx?.state ?? null, loaded: Object.keys(buffers).length, loops: loops.length, running,
  water: waterGain?.gain.value ?? null, steps: stepCount, drops: dropCount, stepping: !!stepNode,
});
