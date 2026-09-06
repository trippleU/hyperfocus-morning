// --- STATE & CONFIG ---
var STORAGE_KEY = 'morning_routine_state';
var AppState = {
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
    hasAnnouncedTimeUp: false,
    tenMinWarning: false,
    macroClockInterval: null
};

var FallbackData = {
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

// --- DOM CACHING ---
var DOM = {};

function cacheDOM() {
    DOM.preStartContainer = document.getElementById('pre-start-container');
    DOM.taskContainer = document.getElementById('task-container');
    DOM.completionContainer = document.getElementById('completion-container');
    
    DOM.targetStartTime = document.getElementById('target-start-time');
    DOM.startBtn = document.getElementById('start-btn');
    DOM.actionBtn = document.getElementById('action-btn');
    
    DOM.currentTaskTitle = document.getElementById('current-task-title');
    DOM.taskCountdown = document.getElementById('task-countdown');
    DOM.taskDurationLabel = document.getElementById('task-duration-label');
    DOM.taskProgressRing = document.getElementById('task-progress-ring');
    DOM.progressRingSvg = document.querySelector('.progress-ring');
    DOM.ringContainer = document.querySelector('.ring-container');
    DOM.ringBg = document.querySelector('.ring-bg');
    
    DOM.currentTimeDisplay = document.getElementById('current-time-display');
    DOM.macroCountdownDisplay = document.getElementById('macro-countdown-display');
    DOM.deficitIndicator = document.getElementById('deficit-indicator');
    DOM.deficitText = document.getElementById('deficit-text');
    
    DOM.confettiCanvas = document.getElementById('confetti-canvas');
    
    DOM.progressBarContainer = document.getElementById('progress-bar-container');
    DOM.currentTaskIcon = document.getElementById('current-task-icon');
}

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', init);

function init() {
    cacheDOM();
    
    fetch('routine.json')
        .then(function(res) {
            if (!res.ok) throw new Error("JSON not found");
            return res.json();
        })
        .then(function(data) {
            setupApp(data);
        })
        .catch(function(e) {
            console.warn("Using fallback routine data", e);
            setupApp(FallbackData);
        });
}

function setupApp(data) {
    if (!data.settings || !data.tasks) data = FallbackData;
    
    AppState.settings = data.settings;
    AppState.tasks = data.tasks;
    AppState.speechEnabled = data.settings.enableVoiceSpeech;
    
    buildProgressBar();
    setupTimeEngine();
    
    // Prepare Web Worker
    AppState.worker = new Worker('timer-worker.js');
    AppState.worker.onmessage = handleWorkerTick;
    
    restoreState();
    setupRemoteControls();
    
    if (AppState.isRoutineActive) {
        showTaskView();
        if (AppState.worker) AppState.worker.postMessage({command: 'START'});
        var task = AppState.tasks[AppState.currentTaskIndex];
        if (task) {
            DOM.currentTaskTitle.innerText = task.title;
            updateTaskViewUI(Date.now());
        } else {
            finishRoutine();
        }
    } else {
        showPreStartView();
    }
    
    if (AppState.macroClockInterval) clearInterval(AppState.macroClockInterval);
    AppState.macroClockInterval = setInterval(updateMacroClock, 1000);
    updateMacroClock();
}

function buildProgressBar() {
    if (!DOM.progressBarContainer) return;
    DOM.progressBarContainer.innerHTML = '';
    AppState.tasks.forEach(function(task, index) {
        var stepDiv = document.createElement('div');
        stepDiv.className = 'progress-step step-upcoming';
        stepDiv.id = 'progress-step-' + index;
        
        var img = document.createElement('img');
        img.className = 'step-icon';
        img.src = task.icon || '';
        
        stepDiv.appendChild(img);
        DOM.progressBarContainer.appendChild(stepDiv);
    });
}

// --- TIME MATH ---
function setupTimeEngine() {
    var now = new Date();
    var depParts = AppState.settings.departureTime.split(':');
    var depH = parseInt(depParts[0], 10);
    var depM = parseInt(depParts[1], 10);
    
    AppState.departureDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), depH, depM, 0);
    
    // If departure time was >12 hours ago, assume it's for tomorrow
    if (now.getTime() - AppState.departureDate.getTime() > 12 * 60 * 60 * 1000) {
        AppState.departureDate.setDate(AppState.departureDate.getDate() + 1);
    }
    
    var totalMinutes = 0;
    for (var i = 0; i < AppState.tasks.length; i++) {
        totalMinutes += AppState.tasks[i].durationMinutes;
        if (i < AppState.tasks.length - 1) {
            totalMinutes += AppState.settings.defaultBufferMinutes;
        }
    }
    
    AppState.targetStartDate = new Date(AppState.departureDate.getTime() - totalMinutes * 60000);
    window.speechSynthesis.getVoices(); // Init speech
}

// --- STATE PERSISTENCE ---
function saveState() {
    var data = {
        isRoutineActive: AppState.isRoutineActive,
        currentTaskIndex: AppState.currentTaskIndex,
        taskExpectedEndDate: AppState.taskExpectedEndDate ? AppState.taskExpectedEndDate.getTime() : null,
        departureDate: AppState.departureDate ? AppState.departureDate.getTime() : null
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function restoreState() {
    try {
        var raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        var data = JSON.parse(raw);
        
        if (data.isRoutineActive && data.taskExpectedEndDate) {
            var expDate = new Date(data.taskExpectedEndDate);
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
    DOM.preStartContainer.classList.remove('hidden');
    DOM.taskContainer.classList.add('hidden');
    DOM.taskContainer.classList.remove('flex');
    DOM.completionContainer.classList.add('hidden');
    if (DOM.progressBarContainer) {
        DOM.progressBarContainer.classList.add('hidden');
        DOM.progressBarContainer.classList.remove('flex');
    }
    
    var tH = AppState.targetStartDate.getHours().toString();
    if (tH.length < 2) tH = '0' + tH;
    var tM = AppState.targetStartDate.getMinutes().toString();
    if (tM.length < 2) tM = '0' + tM;
    
    DOM.targetStartTime.innerText = 'Target Start: ' + tH + ':' + tM;
}

function showTaskView() {
    DOM.preStartContainer.classList.add('hidden');
    DOM.taskContainer.classList.remove('hidden');
    DOM.taskContainer.classList.add('flex');
    DOM.completionContainer.classList.add('hidden');
    if (DOM.progressBarContainer) {
        DOM.progressBarContainer.classList.remove('hidden');
        DOM.progressBarContainer.classList.add('flex');
    }
}

function startRoutine() {
    AppState.isRoutineActive = true;
    AppState.currentTaskIndex = 0;
    AppState.taskExpectedEndDate = null;
    
    if (!AppState.audioCtx) {
        AppState.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        AppState.audioCtx.resume();
    }
    
    var now = new Date();
    if (now > AppState.targetStartDate) {
        var lateMins = Math.floor((now - AppState.targetStartDate) / 60000);
        speak("Warning. You are starting " + lateMins + " minutes behind schedule. Focus!");
    } else {
        speak("Routine started on time. Let's go!");
    }
    
    showTaskView();
    startCurrentTask();
}

function startCurrentTask() {
    var task = AppState.tasks[AppState.currentTaskIndex];
    if (!task) return finishRoutine();
    
    AppState.taskExpectedEndDate = new Date(Date.now() + task.durationMinutes * 60000);
    AppState.hasAnnouncedHalfway = false;
    AppState.hasAnnouncedOneMin = false;
    AppState.hasAnnouncedTimeUp = false;
    
    DOM.currentTaskTitle.innerText = task.title;
    if (DOM.currentTaskIcon) {
        if (task.icon) {
            DOM.currentTaskIcon.src = task.icon;
            DOM.currentTaskIcon.classList.remove('hidden');
        } else {
            DOM.currentTaskIcon.classList.add('hidden');
        }
    }
    
    // Update progress bar UI
    for (var i = 0; i < AppState.tasks.length; i++) {
        var stepDiv = document.getElementById('progress-step-' + i);
        if (!stepDiv) continue;
        stepDiv.className = 'progress-step'; // reset
        if (i < AppState.currentTaskIndex) {
            stepDiv.classList.add('step-completed');
        } else if (i === AppState.currentTaskIndex) {
            stepDiv.classList.add('step-active');
        } else {
            stepDiv.classList.add('step-upcoming');
        }
    }

    
    saveState();
    speak("Time to " + task.title + ". You have " + task.durationMinutes + " minutes.");
    
    if (AppState.worker) AppState.worker.postMessage({command: 'START'});
    updateTaskViewUI(Date.now());
}

function finishRoutine() {
    AppState.isRoutineActive = false;
    localStorage.removeItem(STORAGE_KEY);
    
    if (AppState.worker) AppState.worker.postMessage({command: 'STOP'});
    
    if (DOM.ringContainer) DOM.ringContainer.classList.remove('ambient-overdue');
    if (DOM.actionBtn) DOM.actionBtn.classList.remove('btn-urgent', 'undo-state');
    
    DOM.taskContainer.classList.remove('flex');
    DOM.taskContainer.classList.add('hidden');
    
    if (DOM.progressBarContainer) {
        DOM.progressBarContainer.classList.add('hidden');
        DOM.progressBarContainer.classList.remove('flex');
    }
    
    DOM.completionContainer.classList.remove('hidden');
    DOM.completionContainer.classList.add('flex');
    
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
    var task = AppState.tasks[AppState.currentTaskIndex];
    
    var remainingMs = AppState.taskExpectedEndDate.getTime() - nowTs;
    var totalMs = task.durationMinutes * 60000;
    var circumference = 339.292;
    var circle = DOM.taskProgressRing;
    
    // Reset all dynamic urgency classes before applying current state
    circle.classList.remove('ring-calm', 'ring-warn', 'ring-alert', 'ring-overdue');
    if (DOM.progressRingSvg) {
        DOM.progressRingSvg.classList.remove('ring-imminent', 'ring-imminent-fast', 'ring-overdue-container');
    }
    if (DOM.ringBg) {
        DOM.ringBg.classList.remove('ring-bg-overdue');
    }
    if (DOM.ringContainer) {
        DOM.ringContainer.classList.remove('ambient-overdue');
    }
    DOM.taskCountdown.classList.remove('text-imminent', 'text-overdue');
    if (DOM.actionBtn && !AppState.undoPending) {
        DOM.actionBtn.classList.remove('btn-urgent');
    }

    if (remainingMs > 0) {
        // --- COUNTDOWN RUNNING ---
        var secondsLeft = Math.ceil(remainingMs / 1000);
        
        var m = Math.floor(secondsLeft / 60).toString();
        if (m.length < 2) m = '0' + m;
        var s = (secondsLeft % 60).toString();
        if (s.length < 2) s = '0' + s;
        
        DOM.taskCountdown.innerText = m + ':' + s;
        DOM.taskDurationLabel.innerHTML = '/ ' + task.durationMinutes + ':00';
        
        var percent = Math.min(1, Math.max(0, remainingMs / totalMs));
        var offset = circumference - (percent * circumference);
        circle.style.strokeDashoffset = offset;
        
        if (percent > 0.5) {
            circle.classList.add('ring-calm');
        } else if (percent > 0.15) {
            circle.classList.add('ring-warn');
        } else {
            circle.classList.add('ring-alert');
        }
        
        // Imminent urgency stages: Final 60s & Final 20s
        if (secondsLeft <= 20) {
            if (DOM.progressRingSvg) DOM.progressRingSvg.classList.add('ring-imminent-fast');
            DOM.taskCountdown.classList.add('text-imminent');
        } else if (secondsLeft <= 60) {
            if (DOM.progressRingSvg) DOM.progressRingSvg.classList.add('ring-imminent');
        }
        
        // Auditory milestones
        if (percent <= 0.5 && !AppState.hasAnnouncedHalfway && secondsLeft > 0) {
            speak("Halfway there.");
            AppState.hasAnnouncedHalfway = true;
        }
        
        if (secondsLeft <= 60 && !AppState.hasAnnouncedOneMin) {
            speak("One minute remaining.");
            AppState.hasAnnouncedOneMin = true;
        }
    } else {
        // --- OVERTIME / OVERDUE ACTIVE ---
        var overdueMs = Math.abs(remainingMs);
        var overdueSec = Math.floor(overdueMs / 1000);
        
        var oM = Math.floor(overdueSec / 60).toString();
        if (oM.length < 2) oM = '0' + oM;
        var oS = (overdueSec % 60).toString();
        if (oS.length < 2) oS = '0' + oS;
        
        DOM.taskCountdown.innerText = '+' + oM + ':' + oS;
        DOM.taskCountdown.classList.add('text-overdue');
        
        DOM.taskDurationLabel.innerHTML = '<span class="badge-overdue">OVERDUE</span> / ' + task.durationMinutes + ':00';
        
        // Keep the active circle at zero (fully elapsed) - no growing circle in overdue
        circle.style.strokeDashoffset = circumference;
        
        if (DOM.progressRingSvg) {
            DOM.progressRingSvg.classList.add('ring-overdue-container');
        }
        if (DOM.ringBg) {
            DOM.ringBg.classList.add('ring-bg-overdue');
        }
        if (DOM.ringContainer) {
            DOM.ringContainer.classList.add('ambient-overdue');
        }
        if (DOM.actionBtn && !AppState.undoPending) {
            DOM.actionBtn.classList.add('btn-urgent');
        }
        
        // Auditory milestone: zero mark reached
        if (!AppState.hasAnnouncedTimeUp) {
            speak("Time is up for " + task.title + "!");
            AppState.hasAnnouncedTimeUp = true;
        }
    }
}

function updateMacroClock() {
    var now = new Date();
    
    var hh = now.getHours().toString();
    if (hh.length < 2) hh = '0' + hh;
    var mm = now.getMinutes().toString();
    if (mm.length < 2) mm = '0' + mm;
    DOM.currentTimeDisplay.innerText = hh + ':' + mm;
    
    if (!AppState.departureDate) return;
    
    var timeToLeaveMs = AppState.departureDate.getTime() - now.getTime();
    
    if (timeToLeaveMs > 0) {
        var leaveTotalSec = Math.floor(timeToLeaveMs / 1000);
        var lH = Math.floor(leaveTotalSec / 3600);
        var lM = Math.floor((leaveTotalSec % 3600) / 60);
        
        if (lH > 0) {
            DOM.macroCountdownDisplay.innerText = lH + 'h ' + lM + 'm';
        } else {
            DOM.macroCountdownDisplay.innerText = lM + ' Mins';
        }
        
        if (lH === 0 && lM === 10 && !AppState.tenMinWarning) {
            speak("Ten minutes until total departure.");
            AppState.tenMinWarning = true;
        }
    } else {
         DOM.macroCountdownDisplay.innerText = "LEAVE NOW!";
         DOM.macroCountdownDisplay.classList.remove('text-blue-400');
         DOM.macroCountdownDisplay.classList.add('text-red-500');
    }
    
    if (AppState.isRoutineActive && AppState.currentTaskIndex < AppState.tasks.length && AppState.taskExpectedEndDate) {
        var currentTaskRemainingMs = Math.max(0, AppState.taskExpectedEndDate.getTime() - now.getTime());
        
        var futureMs = 0;
        for (var i = AppState.currentTaskIndex + 1; i < AppState.tasks.length; i++) {
            futureMs += AppState.tasks[i].durationMinutes * 60000;
            if (i < AppState.tasks.length - 1) {
                futureMs += AppState.settings.defaultBufferMinutes * 60000;
            }
        }
        
        var expectedCompletionTime = now.getTime() + currentTaskRemainingMs + futureMs;
        var deficitMs = expectedCompletionTime - AppState.departureDate.getTime();
        
        if (deficitMs > 60000) {
            var deficitMins = Math.ceil(deficitMs / 60000);
            DOM.deficitText.innerText = '-' + deficitMins + ' Mins Behind Schedule';
            DOM.deficitIndicator.classList.remove('hidden');
        } else {
            DOM.deficitIndicator.classList.add('hidden');
        }
    }
}

// --- REMOTE CONTROLS & UNDO LOGIC ---
function setupRemoteControls() {
    // Add click event listeners for TV virtual cursor and PC mouse
    if (DOM.startBtn) {
        DOM.startBtn.addEventListener('click', function(e) {
            startRoutine();
        });
    }
    
    if (DOM.actionBtn) {
        DOM.actionBtn.addEventListener('click', function(e) {
            onActionBtnClick();
        });
    }

    // Keep Enter key support as a fallback
    window.addEventListener('keydown', function(e) {
        var key = e.keyCode || e.which;
        if (key === 13) {
            e.preventDefault();
            if (!AppState.isRoutineActive) {
                startRoutine();
            } else {
                onActionBtnClick();
            }
        }
    });
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
    
    DOM.actionBtn.classList.remove('btn-urgent');
    DOM.actionBtn.classList.add('undo-state');
    DOM.actionBtn.innerHTML = 'UNDO NEXT TASK? (' + AppState.undoSecondsLeft + ')';
    
    if (AppState.undoTimeout) clearInterval(AppState.undoTimeout);
    
    AppState.undoTimeout = setInterval(function() {
        AppState.undoSecondsLeft--;
        if (AppState.undoSecondsLeft > 0) {
            DOM.actionBtn.innerHTML = 'UNDO NEXT TASK? (' + AppState.undoSecondsLeft + ')';
        } else {
            commitTaskCompletion();
        }
    }, 1000);
}

function cancelUndo() {
    AppState.undoPending = false;
    if (AppState.undoTimeout) {
        clearInterval(AppState.undoTimeout);
        AppState.undoTimeout = null;
    }
    
    DOM.actionBtn.classList.remove('undo-state');
    DOM.actionBtn.innerHTML = 'COMPLETE TASK';
    
    // Immediately update UI to correct time
    updateTaskViewUI(Date.now());
}

function commitTaskCompletion() {
    AppState.undoPending = false;
    if (AppState.undoTimeout) {
        clearInterval(AppState.undoTimeout);
        AppState.undoTimeout = null;
    }
    
    DOM.actionBtn.classList.remove('undo-state', 'btn-urgent');
    DOM.actionBtn.innerHTML = 'COMPLETE TASK';
    
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
    var utterance = new SpeechSynthesisUtterance(text);
    window.speechSynthesis.speak(utterance);
}

function playChime() {
    var ctx = AppState.audioCtx;
    if (!ctx) return;
    var osc = ctx.createOscillator();
    var gainNode = ctx.createGain();
    
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
    var canvas = DOM.confettiCanvas;
    var ctx = canvas.getContext('2d');
    canvas.width = 1920;
    canvas.height = 1080;
    
    var particles = [];
    var colors = ['#22c55e', '#3b82f6', '#f59e0b', '#ec4899', '#a855f7'];
    
    for (var i = 0; i < 150; i++) {
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
        var active = false;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        for (var j = 0; j < particles.length; j++) {
            var p = particles[j];
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
        }
        
        if (active) {
            requestAnimationFrame(render);
        } else {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
    }
    render();
}
