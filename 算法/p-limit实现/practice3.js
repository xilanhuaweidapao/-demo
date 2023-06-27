export default function vLimit(concurrency) {
    const tasklist = [];

    const activeCount = 0;
    function next() {

    }

    async function run(fn, resolve, args) {
        const result = (async () => {
            return fn(...args);
        });

        await result;

        try {
            resolve(result);
        } catch (error) {
            
        }

        next();
    }

    function enquene(fn, resolve, ...args) {
        run.bind(undefined, fn, resolve, args);

        
    }
    
    function generator(fn, ...args) {
        return new Promise((resolve) => {
            enquene(fn, resolve, args);
        });
    }

    return generator;
}