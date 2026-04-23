export class Gain {
  constructor(gain, context) {
    this.context = context;
    this.gain = gain;
    this.node = context.createGain();
    this.node.gain.setValueAtTime(gain, context.currentTime);
  }

  set(gain) {
    if (gain > 1.25) gain = 1.25;
    else if (gain < 0) gain = 0;
    this.node.gain.cancelScheduledValues(this.context.currentTime);
    this.node.gain.setValueAtTime(gain, this.context.currentTime);
    this.gain = gain;
  }

  /** Smooth linear ramp to target over durationSec seconds. */
  ramp(target, durationSec) {
    if (target > 1.25) target = 1.25;
    if (target < 0)    target = 0;
    const now = this.context.currentTime;
    this.node.gain.cancelScheduledValues(now);
    this.node.gain.setValueAtTime(this.node.gain.value, now);
    this.node.gain.linearRampToValueAtTime(target, now + Math.max(durationSec, 0.001));
    this.gain = target;
  }

  get() {
    return this.gain;
  }
}
