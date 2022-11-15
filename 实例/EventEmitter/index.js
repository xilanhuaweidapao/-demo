// on off emit once

class EventEmitter {
    constructor() {
        this.events = {};
    }

    on(type, callback, once) {
        if (!this.events[type]) {
            this.events[type] = [];
        }

        this.events[type].push(callback);
        return this;
    }

    once(type, callback) {
        this.on(type, callback, true);
    }

    off(type, callback) {
        // 当没传type时，off 所有事件
        if (!type) {
            this.events = {};
            return;
        }

        if (!callback) {
            this.events[type] = [];
            return;
        }
        let len = this.events[type].length;
        for(let i = 0; i < len; i++) {
            if (this.events[type][i].callback === callback) {
                this.events[type].splice(i, 1);
                i--;
                len--;
            }
        }
    }

    emit(type, ...args) {
        let len = this.events[type].length;
        for(let i = 0; i < len;i++) {
            const { callback, once } = this.events[type][i];

            if (once) {
                this.events[type].splice(i, 1);
                i--;
                len--;
            }
            callback.call(this, args);
        }
    }
}