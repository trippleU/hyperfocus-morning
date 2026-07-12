You are an expert Principal Software Engineer and UX Specialist specializing in Smart TV Interface Design, Neurodivergent Accessibility (ADHD), and Zero-Cost Client-Side Architectures.

Your task is to build a single-page, highly visual, ultra-focused morning routine countdown web application optimized explicitly for a giant 82-inch wall-mounted TV display, navigated via a standard 4-way D-pad remote control. The entire application runtime must be anchored mathematically to a hard, absolute house departure time.

### 1. THE DEPARTURE-ANCHORED TIME ENGINE & SCHEDULING MATH
- **Backwards-Scheduling Engine**: The application must parse a configurable absolute departure time (e.g., "07:15"). It must dynamically calculate the total required routine duration: $\sum (\text{all task durations}) + \sum (\text{all transition buffers})$. 
- **Target Start Time Calculation**: Using the total duration, the app must calculate and display the exact target clock time the routine *must* start (e.g., if total duration is 60 minutes and departure is 07:15, target start is 06:15).
- **Real-World Time Sync & Deficit Tracking**: The engine must track the browser's real-world system clock. If the user loads or starts the app *after* the calculated Target Start Time, the UI must calculate the exact time deficit and display a prominent, clear, non-shaming delta indicator (e.g., "-5 Minutes Behind Schedule") so the user instantly realizes their current status relative to the final departure goal.

### 2. USER INTERFACE & COMPONENT SPECIFICATIONS (82" TV & ADHD Optimization)
- **Extreme Scale Typography**: All text must be rendered using viewport-relative units (`vw`/`vh`) or massive `rem` baselines to ensure flawless readability from 10–15 feet away.
- **Single-Task Focus with Global Macro Anchor**: 
  1. The central primary view MUST display exactly ONE task at a time. The rest of the routine list must be completely hidden to eliminate cognitive overload.
  2. **The Macro Anchor**: A persistent, minimalist, yet highly visible header or footer bar must display the current real-world clock time and a live, absolute countdown to the house departure time (e.g., "Current Time: 06:45 AM | Time Left to Leave House: 30 Mins"). This must remain visible across all tasks.
- **Remote Control Input & Focus Management**: The UI must contain exactly ONE primary interactive element on the main screen at any given time: the active action button. Map standard keyboard event listeners (`ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`, `Enter`) to emulate a TV remote D-pad. Ensure the active button ("Complete Task" or "Undo") is permanently focused programmatically. Pressing 'Enter' or 'OK' on the remote must trigger it instantly.
- **The Core UI Elements**:
  1. A massive, center-aligned visual countdown timer for the *current task* using an SVG circular progress ring that shrinks smoothly.
  2. The current task title in giant, high-contrast typography.
  3. The persistent Global Macro Anchor (Time remaining until departure).
  4. A singular, unmistakable focused footer button.
- **Chromatic Urgency (Time Blindness Mitigation)**: The current task's progress ring and subtle background accents must dynamically change color based on time remaining for *that specific task*: Calm Green (>50%), Transition Orange (50% down to 15%), and a high-contrast, pulsing Alert Red for the final 15%.
- **Misclick Protection (Remote Undo State)**: When "Complete Task" is executed via the remote, instantly transition to a 4-second "Undo" state. The single focused button dynamically shifts to say "Undo Next Task?" with a 4-second visual progress countdown. If 'Enter' is pressed during this window, revert to the active task timer.

### 3. AUDITORY MILESTONES & GAMIFICATION
- **Text-to-Speech (Web Speech API)**: Integrate native, zero-dependency browser Web Speech synthesis. The app must announce verbally:
  1. When a new task initializes (e.g., "Time to eat breakfast. You have 20 minutes.").
  2. A "Halfway there" spoken checkpoint for the current task.
  3. A "One minute remaining" warning for the current task.
  4. Global warnings: A dedicated spoken announcement if the routine starts behind schedule, and a "10 minutes until total departure" macro-warning.
- **Dopamine Completion Loop**: The exact moment a task successfully commits (the 4-second undo window expires), trigger a lightweight, native HTML5 Canvas confetti burst across the 82" screen accompanied by a triumphant audio chime.

### 4. DECOUPLED JSON CONFIGURATION ENGINE
- **`routine.json` Architecture**: The application must decouple its configuration entirely. Create a clean, structural `routine.json` file. On application load, fetch this file via a client-side API call. If the file is missing or fails, gracefully fall back to default seed data stored in code.
- **JSON Structure Requirements**:
  ```json
  {
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
  }

### 5. TECH STACK & RUNTIME ARCHITECTURE
Frontend Core: Vanilla HTML5, CSS3 (using Tailwind CSS via CDN for rapid utility styling), and modern ES6+ JavaScript. No complex frameworks (React/Vue/Angular) to guarantee rapid loading on low-power TV browsers.

*Time Engine*: Use a robust, drift-compensated Web Workers timer loop to ensure time tracking remains structurally accurate even if the TV browser aggressively throttles background processes or dims the panel.

*State Persistence*: Track routine progress and elapsed seconds in browser localStorage. If the TV browser reboots, crashes, or refreshes mid-routine, the app must read the state, check the real-world clock, and immediately resume at the exact corrected chronological second it should be at.

### 6. SECURITY & RESILIENCY
Content Security Policy (CSP): Provide a strict meta tag limiting execution strictly to local script code and vetted CDNs (Tailwind). Block all unsafe inline scripts.

Local Storage Hardening: Sanitize and structurally validate all incoming localStorage JSON payloads on startup to prevent app corruption.

### 7. ANTIGRAVITY 2.0 DELIVERY REQUIREMENTS
Please execute this generation by producing complete, production-ready code blocks as independent Artifacts. Do not use any text placeholders, shortened snippets, or "TODO" notes. Deliver:

`routine.json` - The default decoupled routine configuration file showcasing the departureTime property.

`index.html` - The core application file containing the responsive TV interface, Tailwind configurations, and layout orchestration (including the Global Macro Anchor UI).

`app.js` - The main application controller handling the backwards-scheduling math, real-world clock comparison, state, TV remote D-pad key listeners, Web Speech synthesizers, and canvas confetti rendering.

`timer-worker.js` - The inline or standalone Web Worker handling drift-compensated countdown calculations.

`README.md` - Clean instructions detailing how to open the client-side code on a TV web browser, customize the JSON structure (specifically modifying the departure time), and test D-pad interactions using a standard computer keyboard.