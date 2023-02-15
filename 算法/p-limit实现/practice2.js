export default function vLimit(concurrency) {
    const taskList = [];
    let activeCount = 0;

    function next() {

    }

    async function run(fn, resolve, args) {
        const result = (async function() {
            return await fn(...args);
        });
        resolve(result);
        try {
            await result;
        } catch (error) {
            
        }
        next();
    }

    function dequene(fn, resolve, args) {
        taskList.push(run.bind(undefined, fn, resolve, args));

        (async function() {
            await Promise.resolve();
            if (activeCount < concurrency && taskList.length) {
                taskList.shift()();
            }
        })();
    }

    function generator(fn, ...args) {
        return new Promise((resolve) => {
            dequene(fn, resolve, args);
        })
    }

    return generator;
} 