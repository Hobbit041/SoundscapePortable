export class Pan {
  constructor(pan, context) {
    this.pan = pan;
    this.node = new StereoPannerNode(context, { pan });
  }

  set(pan = 0) {
    this.node.pan.value = pan;
    this.pan = pan;
  }

  get() {
    return this.pan;
  }
}
