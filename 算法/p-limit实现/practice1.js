// 2023/2/13
export default function vLimit(concurrency) {
    // 闭包有什么用 ?
    const taskList = [];
    let activeCount = 0;

    function next() {
        activeCount--;
        if (taskList.length) {
            taskList.shift()();
        }
    }

    async function run(fn, resolve, ...args) {
        const result = (async function() {
            await fn(args);
        })();
        resolve(result);
        try {
            await result;
        } catch (error) {
            
        }
        next();
    }

    function dequene(fn, resolve, ...args) {
        taskList.push(run.bind(undefined, fn, resolve, ...args));
        (async function() {
            await Promise.resolve();

            if (activeCount < concurrency && taskList.length > 0) {
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