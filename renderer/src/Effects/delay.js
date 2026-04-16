/**
 * Delay effect — ported from Foundry Soundscape module.
 * All game.socket / game.user.isGM calls removed (standalone app).
 */
export class Delay {
  constructor(channel, context) {
    this.context = context;
    this.channel = channel;
    this.enable = false;
    this.delay = 0;
    this.delayVolume = 100;

    this.node = context.createDelay(0.5);
    this.gainNode = context.createGain();
  }

  initialize(settings) {
    if (!settings) return;
    this.setDelay(settings.delayTime ?? 0.25);
    this.setVolume((settings.volume ?? 50) / 100);
    this.setEnable(settings.enable ?? false);
  }

  setEnable(enable) {
    if (enable) {
      this.channel.effects.eq.gain
        .connect(this.node)
        .connect(this.gainNode)
        .connect(this.channel.effects.pan.node);
    } else if (this.enable) {
      try {
        this.channel.effects.eq.gain.disconnect(this.node);
      } catch (_) {}
    }
    this.enable = enable;
  }

  setDelay(delay) {
    this.node.delayTime.setValueAtTime(delay, this.context.currentTime);
    this.delay = delay;
  }

  setVolume(volume) {
    this.gainNode.gain.setValueAtTime(volume, this.context.currentTime);
    this.delayVolume = volume;
  }
}
