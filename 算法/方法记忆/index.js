/**
 * Wrap a function in another function that remembers the last return.  If the
 * returned function is called twice in a row with the same arguments and the same
 * this object, it will return the value from the first call in the second call.
 *
 * @param {function(...any): ReturnType} fn The function to memoize.
 * @return {function(...any): ReturnType} The memoized function.
 * @template ReturnType
 */
// wdp
export function memoizeOne(fn) {
  let called = false;

  /** @type {ReturnType} */
  let lastResult;

  /** @type {Array<any>} */
  let lastArgs;

  let lastThis;

  return function () {
    const nextArgs = Array.prototype.slice.call(arguments);
    if (!called || this !== lastThis || !arrayEquals(nextArgs, lastArgs)) {
      called = true;
      lastThis = this;
      lastArgs = nextArgs;
      lastResult = fn.apply(this, arguments);
    }
    return lastResult;
  };
}