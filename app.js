// --- STATE & CONFIG ---
const STORAGE_KEY = 'morning_routine_state';
const AppState = {
    settings: null,
    tasks: [],
    currentTaskIndex: 0,
    departureDate: null,
    targetStartDate: null,
    taskExpectedEndDate: null,
    isRoutineActive: false,
    undoPending: false,
    undoSecondsLeft: 0,
    undoTimeout: null,
    worker: null,
    audioCtx: null,
    speechEnabled: true,
    hasAnnouncedHalfway: false,
    hasAnnouncedOneMin: false,
    tenMinWarning: false
};

const FallbackData = {
    "settings": {
        "departureTime": "07:15",
        "defaultBufferMinutes": 2,
        "enableVoiceSpeech": true
    },
    "tasks": [
        { "id": 1, "title": "Wake up & drink water", "durationMinutes": 10 },
        { "id": 2, "title": "High-Stimulation Hygiene", "durationMinutes": 20 },
        { "id": 3, "title": "Eat Breakfast", "durationMinutes": 20 },
        { "id": 4, "title": "Final Launch Checklist", "durationMinutes": 10 }
    ]
};

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', init);

async function init() {
    let data;
    try {
        const res = await fetch('routine.json');
        if (!res.ok) throw new Error("JSON not found");
        data = await res.json();
    } catch(e) {
        console.warn("Using fallback routine data", e);
        data = FallbackData;
    }
    
    if (!data.settings || !data.tasks) data = FallbackData;
    
    AppState.settings = data.settings;
    AppState.tasks = data.tasks;
    AppState.speechEnabled = data.settings.enableVoiceSpeech;
    
    setupTimeEngine();
    
    // Prepare Web Worker
    AppState.worker = new Worker('timer-worker.js');
    AppState.worker.onmessage = handleWorkerTick;
    
    restoreState();
    setupRemoteControls();
    
    if (AppState.isRoutineActive) {
        showTaskView();
        if (AppState.worker) AppState.worker.postMessage({command: 'START'});
        const task = AppState.tasks[AppState.currentTaskIndex];
        if (task) {
            document.getElementById('current-task-title').innerText = task.title;
            updateTaskViewUI(Date.now());
        } else {
            finishRoutine();
        }
    } else {
        showPreStartView();
    }
    
    setInterval(updateMacroClock, 1000);
    updateMacroClock();
}

// --- TIME MATH ---
function setupTimeEngine() {
    const now = new Date();
    const [depH, depM] = AppState.settings.departureTime.split(':').map(Number);
    AppState.departureDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), depH, depM, 0);
    
    // If departure time was >12 hours ago, assume it's for tomorrow
    if (now.getTime() - AppState.departureDate.getTime() > 12 * 60 * 60 * 1000) {
        AppState.departureDate.setDate(AppState.departureDate.getDate() + 1);
    }
    
    let totalMinutes = 0;
    AppState.tasks.forEach((t, i) => {
        totalMinutes += t.durationMinutes;
        if (i < AppState.tasks.length - 1) {
            totalMinutes += AppState.settings.defaultBufferMinutes;
        }
    });
    
    AppState.targetStartDate = new Date(AppState.departureDate.getTime() - totalMinutes * 60000);
    window.speechSynthesis.getVoices(); // Init speech
}

// --- STATE PERSISTENCE ---
function saveState() {
    const data = {
        isRoutineActive: AppState.isRoutineActive,
        currentTaskIndex: AppState.currentTaskIndex,
        taskExpectedEndDate: AppState.taskExpectedEndDate ? AppState.taskExpectedEndDate.getTime() : null,
        departureDate: AppState.departureDate ? AppState.departureDate.getTime() : null
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function restoreState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const data = JSON.parse(raw);
        
        if (data.isRoutineActive && data.taskExpectedEndDate) {
            const expDate = new Date(data.taskExpectedEndDate);
            if (Date.now() - expDate.getTime() > 12 * 3600 * 1000) {
                localStorage.removeItem(STORAGE_KEY);
                return;
            }
            
            AppState.isRoutineActive = true;
            AppState.currentTaskIndex = data.currentTaskIndex || 0;
            AppState.taskExpectedEndDate = expDate;
            AppState.departureDate = new Date(data.departureDate);
        }
    } catch(e) {
        console.warn("Corrupt local storage", e);
    }
}

// --- VIEWS ---
function showPreStartView() {
    document.getElementById('pre-start-container').classList.remove('hidden');
    document.getElementById('task-container').classList.add('hidden');
    document.getElementById('task-container').classList.remove('flex');
    document.getElementById('completion-container').classList.add('hidden');
    
    const tH = AppState.targetStartDate.getHours().toString().padStart(2, '0');
    const tM = AppState.targetStartDate.getMinutes().toString().padStart(2, '0');
    document.getElementById('target-start-time').innerText = `Target Start: ${tH}:${tM}`;
    
    document.getElementById('start-btn').focus();
}

function showTaskView() {
    document.getElementById('pre-start-container').classList.add('hidden');
    document.getElementById('task-container').classList.remove('hidden');
    document.getElementById('task-container').classList.add('flex');
    document.getElementById('completion-container').classList.add('hidden');
    document.getElementById('action-btn').focus();
}

function startRoutine() {
    AppState.isRoutineActive = true;
    AppState.currentTaskIndex = 0;
    AppState.taskExpectedEndDate = null;
    
    if (!AppState.audioCtx) {
        AppState.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        AppState.audioCtx.resume();
    }
    
    const now = new Date();
    if (now > AppState.targetStartDate) {
        const lateMins = Math.floor((now - AppState.targetStartDate) / 60000);
        speak(`Warning. You are starting ${lateMins} minutes behind schedule. Focus!`);
    } else {
        speak(`Routine started on time. Let's go!`);
    }
    
    showTaskView();
    startCurrentTask();
}

function startCurrentTask() {
    const task = AppState.tasks[AppState.currentTaskIndex];
    if (!task) return finishRoutine();
    
    AppState.taskExpectedEndDate = new Date(Date.now() + task.durationMinutes * 60000);
    AppState.hasAnnouncedHalfway = false;
    AppState.hasAnnouncedOneMin = false;
    
    document.getElementById('current-task-title').innerText = task.title;
    
    saveState();
    speak(`Time to ${task.title}. You have ${task.durationMinutes} minutes.`);
    
    if (AppState.worker) AppState.worker.postMessage({command: 'START'});
    updateTaskViewUI(Date.now());
}

function finishRoutine() {
    AppState.isRoutineActive = false;
    localStorage.removeItem(STORAGE_KEY);
    
    if (AppState.worker) AppState.worker.postMessage({command: 'STOP'});
    
    document.getElementById('task-container').classList.remove('flex');
    document.getElementById('task-container').classList.add('hidden');
    
    const comp = document.getElementById('completion-container');
    comp.classList.remove('hidden');
    comp.classList.add('flex');
    
    triggerConfetti();
    speak("Routine complete! Time to leave.");
}

// --- WORKER TICK ---
function handleWorkerTick(e) {
    if (!AppState.isRoutineActive || AppState.undoPending) return;
    updateTaskViewUI(e.data.timestamp);
}

// --- UI UPDATES ---
function updateTaskViewUI(nowTs) {
    if (AppState.currentTaskIndex >= AppState.tasks.length) return;
    const task = AppState.tasks[AppState.currentTaskIndex];
    
    const remainingMs = AppState.taskExpectedEndDate.getTime() - nowTs;
    const totalMs = task.durationMinutes * 60000;
    
    let displayMs = Math.max(0, remainingMs);
    let secondsLeft = Math.ceil(displayMs / 1000);
    
    const m = Math.floor(secondsLeft / 60).toString().padStart(2, '0');
    const s = (secondsLeft % 60).toString().padStart(2, '0');
    
    document.getElementById('task-countdown').innerText = `${m}:${s}`;
    document.getElementById('task-duration-label').innerText = `/ ${task.durationMinutes}:00`;
    
    const circle = document.getElementById('task-progress-ring');
    const circumference = 339.292;
    const percent = Math.min(1, Math.max(0, displayMs / totalMs));
    const offset = circumference - (percent * circumference);
    circle.style.strokeDashoffset = offset;
    
    circle.classList.remove('text-calmGreen', 'text-transitionOrange', 'text-alertRed');
    circle.classList.remove('drop-shadow-[0_0_15px_rgba(34,197,94,0.5)]', 'drop-shadow-[0_0_20px_rgba(249,115,22,0.6)]', 'drop-shadow-[0_0_30px_rgba(239,68,68,0.8)]');
    
    if (percent > 0.5) {
        circle.classList.add('text-calmGreen', 'drop-shadow-[0_0_15px_rgba(34,197,94,0.5)]');
    } else if (percent > 0.15) {
        circle.classList.add('text-transitionOrange', 'drop-shadow-[0_0_20px_rgba(249,115,22,0.6)]');
    } else {
        circle.classList.add('text-alertRed', 'drop-shadow-[0_0_30px_rgba(239,68,68,0.8)]');
    }
    
    // Auditory milestones
    if (percent <= 0.5 && !AppState.hasAnnouncedHalfway && secondsLeft > 0) {
        speak("Halfway there.");
        AppState.hasAnnouncedHalfway = true;
    }
    
    if (secondsLeft === 60 && !AppState.hasAnnouncedOneMin) {
        speak("One minute remaining.");
        AppState.hasAnnouncedOneMin = true;
    }
}

function updateMacroClock() {
    const now = new Date();
    
    const hh = now.getHours().toString().padStart(2, '0');
    const mm = now.getMinutes().toString().padStart(2, '0');
    document.getElementById('current-time-display').innerText = `${hh}:${mm}`;
    
    if (!AppState.departureDate) return;
    
    const timeToLeaveMs = AppState.departureDate.getTime() - now.getTime();
    
    if (timeToLeaveMs > 0) {
        const leaveTotalSec = Math.floor(timeToLeaveMs / 1000);
        const lH = Math.floor(leaveTotalSec / 3600);
        const lM = Math.floor((leaveTotalSec % 3600) / 60);
        
        if (lH > 0) {
            document.getElementById('macro-countdown-display').innerText = `${lH}h ${lM}m`;
        } else {
            document.getElementById('macro-countdown-display').innerText = `${lM} Mins`;
        }
        
        if (lH === 0 && lM === 10 && !AppState.tenMinWarning) {
            speak("Ten minutes until total departure.");
            AppState.tenMinWarning = true;
        }
    } else {
         document.getElementById('macro-countdown-display').innerText = "LEAVE NOW!";
         document.getElementById('macro-countdown-display').classList.replace('text-blue-400', 'text-red-500');
    }
    
    if (AppState.isRoutineActive && AppState.currentTaskIndex < AppState.tasks.length && AppState.taskExpectedEndDate) {
        const currentTaskRemainingMs = Math.max(0, AppState.taskExpectedEndDate.getTime() - now.getTime());
        
        let futureMs = 0;
        for (let i = AppState.currentTaskIndex + 1; i < AppState.tasks.length; i++) {
            futureMs += AppState.tasks[i].durationMinutes * 60000;
            if (i < AppState.tasks.length - 1) {
                futureMs += AppState.settings.defaultBufferMinutes * 60000;
            }
        }
        
        const expectedCompletionTime = now.getTime() + currentTaskRemainingMs + futureMs;
        const deficitMs = expectedCompletionTime - AppState.departureDate.getTime();
        
        const deficitIndicator = document.getElementById('deficit-indicator');
        const deficitText = document.getElementById('deficit-text');
        
        if (deficitMs > 60000) {
            const deficitMins = Math.ceil(deficitMs / 60000);
            deficitText.innerText = `-${deficitMins} Mins Behind Schedule`;
            deficitIndicator.classList.remove('hidden');
        } else {
            deficitIndicator.classList.add('hidden');
        }
    }
}

// --- REMOTE CONTROLS & UNDO LOGIC ---
function setupRemoteControls() {
    window.addEventListener('keydown', (e) => {
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
            e.preventDefault();
            focusActiveButton();
        }
    });
    
    document.getElementById('start-btn').addEventListener('click', () => {
        startRoutine();
    });
    
    document.getElementById('action-btn').addEventListener('click', () => {
        onActionBtnClick();
    });
}

function focusActiveButton() {
    if (!AppState.isRoutineActive) {
        document.getElementById('start-btn').focus();
    } else if (AppState.currentTaskIndex < AppState.tasks.length) {
        document.getElementById('action-btn').focus();
    }
}

function onActionBtnClick() {
    if (AppState.undoPending) {
        cancelUndo();
    } else {
        startUndoWindow();
    }
}

function startUndoWindow() {
    AppState.undoPending = true;
    AppState.undoSecondsLeft = 4;
    
    const btn = document.getElementById('action-btn');
    btn.classList.add('undo-state');
    btn.innerHTML = `UNDO NEXT TASK? (${AppState.undoSecondsLeft})`;
    
    AppState.undoTimeout = setInterval(() => {
        AppState.undoSecondsLeft--;
        if (AppState.undoSecondsLeft > 0) {
            btn.innerHTML = `UNDO NEXT TASK? (${AppState.undoSecondsLeft})`;
        } else {
            commitTaskCompletion();
        }
    }, 1000);
}

function cancelUndo() {
    AppState.undoPending = false;
    clearInterval(AppState.undoTimeout);
    
    const btn = document.getElementById('action-btn');
    btn.classList.remove('undo-state');
    btn.innerHTML = 'COMPLETE TASK';
    
    // Immediately update UI to correct time
    updateTaskViewUI(Date.now());
}

function commitTaskCompletion() {
    AppState.undoPending = false;
    clearInterval(AppState.undoTimeout);
    
    const btn = document.getElementById('action-btn');
    btn.classList.remove('undo-state');
    btn.innerHTML = 'COMPLETE TASK';
    
    if (!AppState.audioCtx) {
        AppState.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        AppState.audioCtx.resume();
    }
    playChime();
    triggerConfetti();
    
    AppState.currentTaskIndex++;
    startCurrentTask();
}

// --- MEDIA & EFFECTS ---
function speak(text) {
    if (!AppState.speechEnabled) return;
    const utterance = new SpeechSynthesisUtterance(text);
    window.speechSynthesis.speak(utterance);
}

function playChime() {
    const ctx = AppState.audioCtx;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();
    
    osc.type = 'sine';
    osc.connect(gainNode);
    gainNode.connect(ctx.destination);
    
    osc.frequency.setValueAtTime(523.25, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1046.50, ctx.currentTime + 0.1);
    
    gainNode.gain.setValueAtTime(0, ctx.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 0.05);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.5);
    
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 1.5);
}

function triggerConfetti() {
    const canvas = document.getElementById('confetti-canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    
    const particles = [];
    const colors = ['#22c55e', '#3b82f6', '#f59e0b', '#ec4899', '#a855f7'];
    
    for (let i = 0; i < 150; i++) {
        particles.push({
            x: canvas.width / 2,
            y: canvas.height / 2,
            r: Math.random() * 10 + 5,
            dx: Math.random() * 20 - 10,
            dy: Math.random() * -20 - 5,
            color: colors[Math.floor(Math.random() * colors.length)],
            tilt: Math.random() * 10,
            tiltAngle: 0,
            tiltAngleInc: (Math.random() * 0.07) + 0.05
        });
    }
    
    function render() {
        let active = false;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        particles.forEach(p => {
            p.tiltAngle += p.tiltAngleInc;
            p.y += (Math.cos(p.tiltAngle) + p.dy + p.r / 2) / 2;
            p.x += Math.sin(p.tiltAngle) * 2;
            p.dy += 0.2;
            
            if (p.y <= canvas.height) active = true;
            
            ctx.beginPath();
            ctx.lineWidth = p.r;
            ctx.strokeStyle = p.color;
            ctx.moveTo(p.x + p.tilt + p.r, p.y);
            ctx.lineTo(p.x + p.tilt, p.y + p.tilt + p.r);
            ctx.stroke();
        });
        
        if (active) {
            requestAnimationFrame(render);
        } else {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
    }
    render();
}
