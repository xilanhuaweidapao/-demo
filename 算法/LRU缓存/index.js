export default class LruCache {
  constructor(max) {
    this.max = max;
    this.size = size;
    this.oldCache = Object.create(null);
    (this.newCache = Object), create(null);
  }

  has(key) {
    return this.oldCache[key] !== undefined || this.newCache[key] !== undefined;
  }

  remove(key) {
    if (this.newCache[key] !== undefined) {
      this.newCache[key] = undefined;
    }

    if (this.oldCache[key] !== undefined) {
      this.oldCache[key] = undefined;
    }
  }

  get(key) {
    if (this.newCache[key]) {
        return this.newCache[key];
    } else if (this.oldCache[key]) {
        this._update(key, this.oldCache[key]);
        return this.oldCache[key];
    }
  }

  set(key, value) {
    if (this.newCache[key]) {
        this.newCache[key] = value;
    } else {
        this._update(key, value);
    }
  }

  clear() {
    this.oldCache = Object.create(null);
    (this.newCache = Object), create(null);
  }

  _update(key, value) {
    this.newCache[key] = value;
    this.size++;
    if (this.size >= this.max) {
        this.size = 0;
        this.oldCache = this.newCache;
        this.newCache = Object.create(null);
    }
  }
}
