// 배경음과 효과음. 파일은 public/sound에 있다.
// 원본 음량 차이가 커서(숲 바람 최대 4%, out 96%) 소리별로 보정한다.
const LEVEL = { wind: 6, spool: 3, water: 1.5, step: 0.7, in: 3, out: 0.6, squish: 3 };
const FILES = {
  wind: "forest_wind", spool: "forese_spool", water: "water", step: "step", in: "in", out: "out", squish: "squish",
} as const;
type Name = keyof typeof FILES;

const SPOOL_GAP_MIN = 25, SPOOL_GAP_MAX = 70; // 숲 소리 사이 간격(초)
const WATER_NEAR = 3, WATER_FAR = 24; // 이 거리 안이면 최대, 밖이면 들리지 않음(미터)
// step.wav의 발소리 중 묵직한 두 개만 쓴다: 시작(초), 음량 보정(원본 최대 12%, 19%를 같은 크기로).
// 0.81초의 소리는 저음이 적고 날카로워 "쿵쿵짜"로 들리므로 뺐다.
// 걸음 간격(약 0.35초)보다 짧게 잘라 소리가 겹치지 않게 한다
const STEP_DUR = 0.28;
const STEP_SLICES = [
  { at: 0.09, gain: 2 },
  { at: 1.55, gain: 1.3 },
];
const SQUISH_IDLE_MS = 80; // 이 시간 동안 움직임이 없으면 멈춘 것으로 본다
const SQUISH_END_MS = 300; // 소리가 줄어든 뒤 재생을 끝낼 때까지. 그 안에 다시 움직이면 이어서 낸다

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let loading: Promise<void> | null = null;
const buffers: Partial<Record<Name, AudioBuffer>> = {};

let running = false;
let loops: AudioBufferSourceNode[] = [];
let waterGain: GainNode | null = null;
let stepNode: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
let stepCount = 0, dropCount = 0;
let spoolTimer: ReturnType<typeof setTimeout> | null = null;
let squishNode: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
let squishIdle: ReturnType<typeof setTimeout> | undefined;
let squishEnd: ReturnType<typeof setTimeout> | undefined;

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

// 끊긴 오디오를 다시 깨운다. iOS는 다른 앱에 다녀오면 멈춘 채 남아 사용자 입력이 있어야 풀린다
function wake() {
  if (ctx && ctx.state !== "running" && !document.hidden) void ctx.resume();
}

// 브라우저는 사용자 입력 없이 소리를 내지 못한다. 입장 버튼의 클릭 안에서 호출한다
export function unlockSound() {
  if (ctx) { void ctx.resume(); return; }
  // iOS의 무음 스위치를 켜 둬도 들리게 한다 (Safari 16.4 이상)
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
  if (session) session.type = "playback";
  ctx = new AudioContext();
  // iOS는 클릭 순간에 무언가 재생해야 오디오가 확실히 풀린다
  const silent = ctx.createBufferSource();
  silent.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
  silent.connect(ctx.destination);
  silent.start();
  for (const type of ["pointerdown", "touchend", "keydown"]) addEventListener(type, wake, { passive: true });
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
  // 박자가 생기지 않게 소리를 무작위로 고르고, 음높이와 크기도 조금씩 바꾼다
  const slice = STEP_SLICES[Math.floor(Math.random() * STEP_SLICES.length)];
  const rate = 0.94 + Math.random() * 0.12, level = 0.85 + Math.random() * 0.3;
  const now = ctx.currentTime, length = STEP_DUR / rate;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(slice.gain * LEVEL.step * level, now);
  gain.gain.setTargetAtTime(0, now + length - 0.07, 0.02); // 끝이 끊기지 않게 살짝 줄인다
  gain.connect(master);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  src.connect(gain);
  src.onended = () => gain.disconnect();
  src.start(now, slice.at, STEP_DUR);
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

// 말랑이를 주무르는 동안 계속 호출한다. speed(0~1)가 빠를수록 크고 조금 높은 소리가 난다.
// 호출이 끊기면 저절로 줄어든다
export function playSquish(speed: number) {
  const buf = buffers.squish;
  if (!ctx || !master || !buf) return;
  clearTimeout(squishEnd);
  if (!squishNode) {
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(master);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(gain);
    // 매번 다른 지점에서 시작해 같은 소리의 반복으로 들리지 않게 한다
    src.start(0, Math.random() * buf.duration);
    squishNode = { src, gain };
  }
  const now = ctx.currentTime;
  squishNode.gain.gain.setTargetAtTime(LEVEL.squish * (0.4 + 0.6 * speed), now, 0.03);
  squishNode.src.playbackRate.setTargetAtTime(0.9 + 0.3 * speed, now, 0.05);
  clearTimeout(squishIdle);
  squishIdle = setTimeout(stopSquish, SQUISH_IDLE_MS);
}

export function stopSquish() {
  clearTimeout(squishIdle);
  clearTimeout(squishEnd);
  if (!ctx || !squishNode) return;
  const { src, gain } = squishNode;
  gain.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
  squishEnd = setTimeout(() => {
    src.stop();
    gain.disconnect();
    squishNode = null;
  }, SQUISH_END_MS);
}

export const soundDebug = () => ({
  state: ctx?.state ?? null, loaded: Object.keys(buffers).length, loops: loops.length, running,
  water: waterGain?.gain.value ?? null, steps: stepCount, drops: dropCount, stepping: !!stepNode,
});
