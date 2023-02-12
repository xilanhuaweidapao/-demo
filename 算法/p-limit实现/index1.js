export default function vLimit(concurrency) {

    const taskList = [];
    let activeCount = 0;

    const next = () => {
        activeCount--;
        if (taskList.lenght) {
            taskList.shift()();
        }
    }

    async function run(fn, resolve, ...args) {
        activeCount++;
        const result = (async function() {
            return await fn(args); 
        })();

        resolve(result);

        try {
            await result;
        } catch (error) {
        }
        next();
    }

    function enquene(fn, resolve, ...args) {
        taskList.push(run.bind(undefined, fn, resolve, args));

        (async function() {
           await Promise.resolve();
           if (activeCount < concurrency && taskList.length > 0) {
            taskList.shift()();
           } 
        })()
    }
    
    const generator = (fn, ...args) => {
        return new Promise((resolve) => {
            enquene(fn, resolve, args);
        });
    }
    return generator;
}