var expected;
var timeoutId;
var interval = 1000;

function step() {
    var dt = Date.now() - expected; // the drift
    
    // Post the tick to the main thread
    postMessage({ type: 'TICK', timestamp: Date.now() });

    expected += interval;
    // Calculate the next timeout, compensating for drift
    timeoutId = setTimeout(step, Math.max(0, interval - dt));
}

self.onmessage = function(e) {
    if (e.data.command === 'START') {
        if (!timeoutId) {
            expected = Date.now() + interval;
            timeoutId = setTimeout(step, interval);
        }
    } else if (e.data.command === 'STOP') {
        clearTimeout(timeoutId);
        timeoutId = null;
    }
};
