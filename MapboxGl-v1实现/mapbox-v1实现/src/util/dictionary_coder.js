// @flow strict

import assert from 'assert';
// wdp +1

class DictionaryCoder {
    _stringToNumber: {[_: string]: number };
    _numberToString: Array<string>;

    constructor(strings: Array<string>) {
        this._stringToNumber = {};
        this._numberToString = [];
        for (let i = 0; i < strings.length; i++) {
            const string = strings[i];
            this._stringToNumber[string] = i;
            this._numberToString[i] = string;
        }
    }

    encode(string: string) {
        assert(string in this._stringToNumber);
        return this._stringToNumber[string];
    }

    decode(n: number) {
        assert(n < this._numberToString.length);
        return this._numberToString[n];
    }
}

export default DictionaryCoder;
