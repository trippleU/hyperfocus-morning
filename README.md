# Smart TV Morning Routine App

A single-page, highly visual, ultra-focused morning routine countdown web application optimized for large smart TV displays (e.g., 82-inch). Designed with neurodivergent accessibility (ADHD) in mind, featuring zero-cost client-side architecture.

## Features
- **Departure-Anchored Time Engine**: Backwards-calculates the target start time based on a hard departure time.
- **TV D-pad Navigation**: Uses arrow keys and `Enter` for simple remote control navigation. Only one interactive button is focused at any time.
- **Extreme Scale Typography**: Uses viewport relative units (`vw`/`vh`) for massive readability from a distance.
- **Single-Task Focus**: Hides future tasks to prevent cognitive overload.
- **Chromatic Urgency**: Progress ring changes from green, to orange, to red based on time remaining.
- **Misclick Protection (Undo State)**: A 4-second window to undo task completion.
- **Web Speech API**: Auditory milestones (start, halfway, 1 minute warning, behind schedule).
- **Gamification**: Confetti and Web Audio API chime on task completion.
- **State Persistence**: Uses `localStorage` to resume automatically.
- **Zero-Dependency Core**: Vanilla JS and HTML5 Canvas.

## Setup & Configuration

1. **Configure Routine**: Edit `routine.json` to define your tasks and absolute departure time.
   ```json
   "settings": {
     "departureTime": "07:15" // Set this to your required house departure time (24-hour format)
   }
   ```
2. **Launch App**: Open `index.html` in a web browser.
3. **TV Execution**: You can host these files on a simple static local web server (e.g., `python3 -m http.server 8000`) and navigate to the IP address via your Smart TV's built-in web browser.

## Controls
- Use **Arrow Keys** (Up, Down, Left, Right) to emulate TV D-pad navigation.
- Press **Enter** or **OK** on the remote to activate the focused button ("Start", "Complete Task", or "Undo Next Task?").

## Troubleshooting
- **Speech Not Working**: Ensure your TV browser supports the Web Speech API and that the volume is unmuted. Many browsers require a user interaction (like pressing Start) before audio can play.
- **No Progress Ring**: Ensure JavaScript is enabled and Web Workers are permitted.
