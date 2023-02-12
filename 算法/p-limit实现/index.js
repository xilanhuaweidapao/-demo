export default function vLimit(concurrency) {
    const taskList = [];
    let activeCount = 0;

    const next = () => {
        taskList.shift();
    }

    const  run = async (fn, resolve, ...args) => {
        const result = async () => {
            return fn(args);
        }
        resolve(result)
        try {
            await result;
        } catch (error) {
            
        }
        next();
    }

    const enquene = (fn, resolve, args) => {
        run.bind(undefined, fn, resolve, args);

        if (activeCount < concurrency && taskList.length > 0) {
            taskList
        }
    }

    const generator = (fn, ...args) => {
        return new Promise((resolve) => {
            enquene(fn, resolve, args);
        });
    }
    return generator;
}