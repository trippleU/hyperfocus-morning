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
    lastHeartbeatSecond: null,
    tenMinWarning: false,
    macroClockInterval: null
};

var FallbackData = {
    "settings": {
        "departureTime": "07:20",
        "defaultBufferMinutes": 2,
        "enableVoiceSpeech": true
    },
    "tasks": [
        { "id": 1, "title": "Aufwachen & Wasser drinken", "durationMinutes": 10, "icon": "assets/droplet.svg" },
        { "id": 2, "title": "Vitamine nehmen", "durationMinutes": 3, "icon": "assets/pill.svg" },
        { "id": 3, "title": "Frühstück", "durationMinutes": 30, "icon": "assets/utensils.svg" },
        { "id": 4, "title": "Zähne putzen", "durationMinutes": 5, "icon": "assets/smile.svg" },
        { "id": 5, "title": "Kuscheln", "durationMinutes": 3, "icon": "assets/heart.svg" },
        { "id": 6, "title": "Schultasche packen", "durationMinutes": 3, "icon": "assets/backpack.svg" },
        { "id": 7, "title": "Schuhe und los", "durationMinutes": 5, "icon": "assets/footprints.svg" }
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
    DOM.ringPulseWrapper = document.getElementById('ring-pulse-wrapper');
    DOM.ringGlowAura = document.getElementById('ring-glow-aura');
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
    
    // Use cache-busting timestamp and no-store to ensure routine.json edits are picked up immediately
    fetch('routine.json?t=' + Date.now(), { cache: 'no-store' })
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
            if (DOM.currentTaskIcon) {
                if (task.icon) {
                    DOM.currentTaskIcon.src = task.icon;
                    DOM.currentTaskIcon.classList.remove('hidden');
                } else {
                    DOM.currentTaskIcon.classList.add('hidden');
                }
            }
            updateProgressBarUI(AppState.currentTaskIndex);
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
            AppState.currentTaskIndex = Math.min(data.currentTaskIndex || 0, AppState.tasks.length - 1);
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
        DOM.progressBarContainer.classList.remove('hidden');
        DOM.progressBarContainer.classList.add('flex');
        updateProgressBarUI(-1);
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

function updateProgressBarUI(activeIndex) {
    if (typeof activeIndex === 'undefined') activeIndex = AppState.currentTaskIndex;
    for (var i = 0; i < AppState.tasks.length; i++) {
        var stepDiv = document.getElementById('progress-step-' + i);
        if (!stepDiv) continue;
        stepDiv.className = 'progress-step'; // reset
        if (activeIndex === -1) {
            stepDiv.classList.add('step-upcoming');
        } else if (i < activeIndex) {
            stepDiv.classList.add('step-completed');
        } else if (i === activeIndex) {
            stepDiv.classList.add('step-active');
        } else {
            stepDiv.classList.add('step-upcoming');
        }
    }
}

function startCurrentTask() {
    var task = AppState.tasks[AppState.currentTaskIndex];
    if (!task) return finishRoutine();
    
    AppState.taskExpectedEndDate = new Date(Date.now() + task.durationMinutes * 60000);
    AppState.hasAnnouncedHalfway = false;
    AppState.hasAnnouncedOneMin = false;
    AppState.hasAnnouncedTimeUp = false;
    AppState.lastHeartbeatSecond = null;
    
    DOM.currentTaskTitle.innerText = task.title;
    if (DOM.currentTaskIcon) {
        if (task.icon) {
            DOM.currentTaskIcon.src = task.icon;
            DOM.currentTaskIcon.classList.remove('hidden');
        } else {
            DOM.currentTaskIcon.classList.add('hidden');
        }
    }
    
    updateProgressBarUI(AppState.currentTaskIndex);

    
    saveState();
    speak("Time to " + task.title + ". You have " + task.durationMinutes + " minutes.");
    
    if (AppState.worker) AppState.worker.postMessage({command: 'START'});
    updateTaskViewUI(Date.now());
}

function finishRoutine() {
    AppState.isRoutineActive = false;
    AppState.lastHeartbeatSecond = null;
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
    if (DOM.ringPulseWrapper) {
        DOM.ringPulseWrapper.classList.remove('ring-imminent', 'ring-imminent-fast', 'ring-overdue-container');
    }
    if (DOM.ringGlowAura) {
        DOM.ringGlowAura.classList.remove('aura-imminent', 'aura-imminent-fast', 'aura-overdue');
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
            if (DOM.ringPulseWrapper) DOM.ringPulseWrapper.classList.add('ring-imminent-fast');
            if (DOM.ringGlowAura) DOM.ringGlowAura.classList.add('aura-imminent-fast');
            DOM.taskCountdown.classList.add('text-imminent');
        } else if (secondsLeft <= 60) {
            if (DOM.ringPulseWrapper) DOM.ringPulseWrapper.classList.add('ring-imminent');
            if (DOM.ringGlowAura) DOM.ringGlowAura.classList.add('aura-imminent');
        }
        
        // Audio heartbeat cue during imminent urgency (final 60s)
        if (secondsLeft <= 60 && secondsLeft > 0) {
            if (AppState.lastHeartbeatSecond !== secondsLeft) {
                AppState.lastHeartbeatSecond = secondsLeft;
                playHeartbeat(secondsLeft <= 20);
            }
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
        
        // Show full solid red ring when overdue - visible, bold, and framing the counter without growing
        circle.style.strokeDashoffset = 0;
        circle.classList.add('ring-alert');
        
        if (DOM.ringPulseWrapper) {
            DOM.ringPulseWrapper.classList.add('ring-overdue-container');
        }
        if (DOM.ringGlowAura) {
            DOM.ringGlowAura.classList.add('aura-overdue');
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
            playTimeUpSound();
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
            ensureAudio();
            startRoutine();
        });
    }
    
    if (DOM.actionBtn) {
        DOM.actionBtn.addEventListener('click', function(e) {
            ensureAudio();
            onActionBtnClick();
        });
    }

    // Keep Enter key support as a fallback
    window.addEventListener('keydown', function(e) {
        ensureAudio();
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
    AppState.lastHeartbeatSecond = null;
    if (AppState.undoTimeout) {
        clearInterval(AppState.undoTimeout);
        AppState.undoTimeout = null;
    }
    
    DOM.actionBtn.classList.remove('undo-state', 'btn-urgent');
    DOM.actionBtn.innerHTML = 'COMPLETE TASK';
    
    ensureAudio();
    playChime();
    triggerConfetti();
    
    AppState.currentTaskIndex++;
    startCurrentTask();
}

// --- MEDIA & EFFECTS ---
function ensureAudio() {
    if (!AppState.audioCtx) {
        AppState.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (AppState.audioCtx.state === 'suspended') {
        AppState.audioCtx.resume();
    }
}

function playHeartbeat(isFast) {
    ensureAudio();
    var ctx = AppState.audioCtx;
    if (!ctx) return;
    
    var now = ctx.currentTime;
    
    function playThump(time, baseFreq, endFreq, gainPeak, duration) {
        var osc = ctx.createOscillator();
        var gainNode = ctx.createGain();
        
        osc.type = 'sine';
        osc.connect(gainNode);
        gainNode.connect(ctx.destination);
        
        // Frequencies tuned for TV speaker response:
        // Flat TVs roll off frequencies below 80-90Hz.
        // Starting around 160-185Hz and sweeping to 75-85Hz produces a deep, warm,
        // audible chest thump through TV speakers without sounding like an electronic beep.
        osc.frequency.setValueAtTime(baseFreq, time);
        osc.frequency.exponentialRampToValueAtTime(endFreq, time + duration);
        
        // Boosted gain matching the completion chime volume
        gainNode.gain.setValueAtTime(0.001, time);
        gainNode.gain.linearRampToValueAtTime(gainPeak, time + 0.018);
        gainNode.gain.exponentialRampToValueAtTime(0.001, time + duration);
        
        osc.start(time);
        osc.stop(time + duration);
    }
    
    // Higher volume matching playChime (0.50)
    var gain1 = isFast ? 0.65 : 0.52;
    var gain2 = isFast ? 0.44 : 0.35;
    
    // First beat: "lub" (~160Hz dropping to 75Hz)
    playThump(now, 160, 75, gain1, 0.11);
    // Second beat: "dub" (~185Hz dropping to 85Hz)
    playThump(now + 0.14, 185, 85, gain2, 0.09);
    
    if (isFast) {
        // Second heartbeat cycle at +0.5s for the final 20s
        playThump(now + 0.50, 165, 80, gain1, 0.11);
        playThump(now + 0.64, 190, 90, gain2, 0.09);
    }
}

function playTimeUpSound() {
    ensureAudio();
    var ctx = AppState.audioCtx;
    if (!ctx) return;
    
    var now = ctx.currentTime;
    // Pleasant, non-distressing warm two-tone chime at clear TV volume
    var notes = [
        { f: 523.25, t: 0, d: 0.35, gain: 0.48 },    // C5
        { f: 392.00, t: 0.22, d: 0.60, gain: 0.42 }  // G4
    ];
    
    notes.forEach(function(note) {
        var osc = ctx.createOscillator();
        var gainNode = ctx.createGain();
        osc.type = 'sine';
        osc.connect(gainNode);
        gainNode.connect(ctx.destination);
        
        osc.frequency.setValueAtTime(note.f, now + note.t);
        gainNode.gain.setValueAtTime(0.001, now + note.t);
        gainNode.gain.linearRampToValueAtTime(note.gain, now + note.t + 0.02);
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + note.t + note.d);
        
        osc.start(now + note.t);
        osc.stop(now + note.t + note.d);
    });
}

function speak(text) {
    if (!AppState.speechEnabled) return;
    if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) return;
    try {
        var utterance = new SpeechSynthesisUtterance(text);
        window.speechSynthesis.speak(utterance);
    } catch(e) {
        // Speech synthesis not supported or blocked
    }
}

function playChime() {
    ensureAudio();
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
