export interface RainAmbienceController {
  readonly playing: boolean;
  prepare(): Promise<boolean>;
  start(): Promise<boolean>;
  stop(): void;
  dispose(): void;
}

type AudioContextFactory = () => AudioContext | undefined;

interface ActiveRainGraph {
  source: AudioBufferSourceNode;
  modulation: OscillatorNode;
  master: GainNode;
}

function browserAudioContext() {
  const scope = globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext };
  const Constructor = typeof AudioContext === "undefined" ? scope.webkitAudioContext : AudioContext;
  if (!Constructor) return undefined;
  return new Constructor();
}

export function rainAmbienceSupported() {
  const scope = globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext };
  return typeof AudioContext !== "undefined" || typeof scope.webkitAudioContext !== "undefined";
}

function createRainBuffer(context: AudioContext) {
  const durationSeconds = 4;
  const buffer = context.createBuffer(2, context.sampleRate * durationSeconds, context.sampleRate);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const samples = buffer.getChannelData(channel);
    let rollingNoise = 0;
    for (let index = 0; index < samples.length; index += 1) {
      const whiteNoise = Math.random() * 2 - 1;
      rollingNoise = rollingNoise * 0.965 + whiteNoise * 0.035;
      samples[index] = whiteNoise * 0.58 + rollingNoise * 1.7;
    }
  }
  return buffer;
}

class BrowserRainAmbience implements RainAmbienceController {
  private context?: AudioContext;
  private noiseBuffer?: AudioBuffer;
  private graph?: ActiveRainGraph;

  constructor(private readonly contextFactory: AudioContextFactory) {}

  get playing() {
    return this.graph !== undefined;
  }

  async prepare() {
    try {
      if (!this.context || this.context.state === "closed") {
        this.context = this.contextFactory();
        this.noiseBuffer = undefined;
      }
      if (!this.context) return false;
      if (this.context.state === "suspended") await this.context.resume();
      return this.context.state !== "closed";
    } catch {
      return false;
    }
  }

  async start() {
    if (this.graph) return true;
    if (!(await this.prepare()) || !this.context) return false;

    const context = this.context;
    this.noiseBuffer ??= createRainBuffer(context);
    const source = context.createBufferSource();
    const highPass = context.createBiquadFilter();
    const highGain = context.createGain();
    const lowPass = context.createBiquadFilter();
    const lowGain = context.createGain();
    const master = context.createGain();
    const modulation = context.createOscillator();
    const modulationDepth = context.createGain();

    source.buffer = this.noiseBuffer;
    source.loop = true;
    highPass.type = "highpass";
    highPass.frequency.value = 720;
    highPass.Q.value = 0.45;
    highGain.gain.value = 0.22;
    lowPass.type = "lowpass";
    lowPass.frequency.value = 520;
    lowGain.gain.value = 0.12;
    modulation.type = "sine";
    modulation.frequency.value = 0.08;
    modulationDepth.gain.value = 0.022;

    source.connect(highPass);
    highPass.connect(highGain);
    highGain.connect(master);
    source.connect(lowPass);
    lowPass.connect(lowGain);
    lowGain.connect(master);
    modulation.connect(modulationDepth);
    modulationDepth.connect(master.gain);
    master.connect(context.destination);

    const now = context.currentTime;
    master.gain.setValueAtTime(0, now);
    master.gain.linearRampToValueAtTime(0.24, now + 1.1);
    source.start(now);
    modulation.start(now);
    this.graph = { source, modulation, master };
    return true;
  }

  stop() {
    if (!this.context || !this.graph) return;
    const { master, modulation, source } = this.graph;
    this.graph = undefined;
    const now = this.context.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(0, now + 0.3);
    try {
      source.stop(now + 0.32);
      modulation.stop(now + 0.32);
    } catch {
      // A browser may have already stopped the graph while the page was suspended.
    }
  }

  dispose() {
    this.stop();
    const context = this.context;
    this.context = undefined;
    this.noiseBuffer = undefined;
    if (context && context.state !== "closed") void context.close();
  }
}

export function createRainAmbience(contextFactory: AudioContextFactory = browserAudioContext): RainAmbienceController {
  return new BrowserRainAmbience(contextFactory);
}
