import { describe, expect, it, vi } from "vitest";
import { createRainAmbience } from "./rainAmbience";

class FakeAudioParam {
  value = 0;
  cancelScheduledValues = vi.fn();
  linearRampToValueAtTime = vi.fn((value: number) => {
    this.value = value;
  });
  setValueAtTime = vi.fn((value: number) => {
    this.value = value;
  });
}

class FakeAudioNode {
  connect = vi.fn();
}

class FakeSource extends FakeAudioNode {
  buffer: AudioBuffer | null = null;
  loop = false;
  start = vi.fn();
  stop = vi.fn();
}

class FakeFilter extends FakeAudioNode {
  type: BiquadFilterType = "lowpass";
  frequency = new FakeAudioParam();
  Q = new FakeAudioParam();
}

class FakeGain extends FakeAudioNode {
  gain = new FakeAudioParam();
}

class FakeOscillator extends FakeAudioNode {
  type: OscillatorType = "sine";
  frequency = new FakeAudioParam();
  start = vi.fn();
  stop = vi.fn();
}

class FakeAudioContext {
  state: AudioContextState = "suspended";
  currentTime = 2;
  sampleRate = 1_000;
  destination = new FakeAudioNode();
  sources: FakeSource[] = [];
  oscillators: FakeOscillator[] = [];
  close = vi.fn(async () => {
    this.state = "closed";
  });
  resume = vi.fn(async () => {
    this.state = "running";
  });
  createBiquadFilter = vi.fn(() => new FakeFilter());
  createBuffer = vi.fn((channels: number, length: number) => {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return {
      numberOfChannels: channels,
      getChannelData: (channel: number) => data[channel],
    } as AudioBuffer;
  });
  createBufferSource = vi.fn(() => {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  });
  createGain = vi.fn(() => new FakeGain());
  createOscillator = vi.fn(() => {
    const oscillator = new FakeOscillator();
    this.oscillators.push(oscillator);
    return oscillator;
  });
}

describe("procedural rain ambience", () => {
  it("prepares during a user gesture, loops while active, and fades out", async () => {
    const context = new FakeAudioContext();
    const ambience = createRainAmbience(() => context as unknown as AudioContext);

    expect(await ambience.prepare()).toBe(true);
    expect(context.resume).toHaveBeenCalledOnce();
    expect(await ambience.start()).toBe(true);
    expect(ambience.playing).toBe(true);
    expect(context.sources[0].loop).toBe(true);
    expect(context.sources[0].start).toHaveBeenCalledWith(2);

    ambience.stop();
    expect(ambience.playing).toBe(false);
    expect(context.sources[0].stop).toHaveBeenCalledWith(2.32);
    expect(context.oscillators[0].stop).toHaveBeenCalledWith(2.32);

    ambience.dispose();
    expect(context.close).toHaveBeenCalledOnce();
  });
});
