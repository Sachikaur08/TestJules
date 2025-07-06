// background.js

const DEFAULT_WORK_DURATION = 25 * 60;
const DEFAULT_SHORT_BREAK_DURATION = 5 * 60;
const DEFAULT_LONG_BREAK_DURATION = 15 * 60;
const POMODOROS_UNTIL_LONG_BREAK = 4;
const MAIN_TIMER_ALARM_NAME = 'pomodoroMainTimer';

let timerState = {
  userSetWorkDuration: DEFAULT_WORK_DURATION,
  shortBreakDuration: DEFAULT_SHORT_BREAK_DURATION,
  longBreakDuration: DEFAULT_LONG_BREAK_DURATION,
  
  currentTime: DEFAULT_WORK_DURATION,
  isPaused: true,
  currentSessionType: 'WORK', // 'WORK', 'SHORT_BREAK', 'LONG_BREAK'
  pomodorosCompletedThisCycle: 0,

  isAdHocBreakActive: false,
  adHocBreakStartTime: 0,
  currentAdHocBreakTime: 0, // Duration in seconds, updated dynamically

  // For session summary
  adHocBreakCountThisSession: 0,
  totalAdHocBreakDurationThisSession: 0,
  showSessionSummary: false,
  sessionSummaryText: ""
};

// --- Helper Functions ---
function showNotification(message) {
  chrome.notifications.create({
    type: 'basic', iconUrl: 'icons/icon128.png',
    title: 'NeuroFocus Timer', message: message, priority: 2
  });
}

function broadcastState() {
  if (timerState.isAdHocBreakActive && timerState.adHocBreakStartTime > 0) {
    timerState.currentAdHocBreakTime = Math.floor((Date.now() - timerState.adHocBreakStartTime) / 1000);
  }
  chrome.runtime.sendMessage({ type: 'TIMER_STATE_UPDATE', state: { ...timerState } });
  console.log("State broadcasted:", JSON.parse(JSON.stringify(timerState))); // Deep copy for logging
}

function saveDurationsAndCycleToStorage() {
  chrome.storage.local.set({
    userSetWorkDuration: timerState.userSetWorkDuration,
    shortBreakDuration: timerState.shortBreakDuration,
    longBreakDuration: timerState.longBreakDuration,
    pomodorosCompletedThisCycle: timerState.pomodorosCompletedThisCycle
  }, () => console.log("Durations & cycle count saved."));
}

function loadStateFromStorage(callback) {
  chrome.storage.local.get([
    'userSetWorkDuration', 'shortBreakDuration', 'longBreakDuration', 'pomodorosCompletedThisCycle'
  ], (result) => {
    timerState.userSetWorkDuration = result.userSetWorkDuration !== undefined ? result.userSetWorkDuration : DEFAULT_WORK_DURATION;
    timerState.shortBreakDuration = result.shortBreakDuration !== undefined ? result.shortBreakDuration : DEFAULT_SHORT_BREAK_DURATION;
    timerState.longBreakDuration = result.longBreakDuration !== undefined ? result.longBreakDuration : DEFAULT_LONG_BREAK_DURATION;
    timerState.pomodorosCompletedThisCycle = result.pomodorosCompletedThisCycle !== undefined ? result.pomodorosCompletedThisCycle : 0;
    
    // Reset active state variables
    timerState.currentTime = timerState.userSetWorkDuration;
    timerState.isPaused = true;
    timerState.currentSessionType = 'WORK';
    timerState.isAdHocBreakActive = false;
    timerState.currentAdHocBreakTime = 0;
    timerState.adHocBreakStartTime = 0;
    timerState.adHocBreakCountThisSession = 0;
    timerState.totalAdHocBreakDurationThisSession = 0;
    timerState.showSessionSummary = false;
    timerState.sessionSummaryText = "";

    console.log("State loaded/reinitialized from storage:", timerState);
    if (callback) callback();
  });
}

// --- Timer Control Functions ---
function startMainTimer() {
  if (timerState.isPaused && !timerState.isAdHocBreakActive) {
    timerState.isPaused = false;
    timerState.showSessionSummary = false; // Clear summary when timer starts/resumes
    chrome.alarms.create(MAIN_TIMER_ALARM_NAME, { delayInMinutes: 0, periodInMinutes: 1 / 60 });
    console.log(`${timerState.currentSessionType} timer alarm started/resumed.`);
    broadcastState();
  }
}

function pauseMainTimer() { // Explicit pause, not ad-hoc break start
  if (!timerState.isPaused && !timerState.isAdHocBreakActive) {
    timerState.isPaused = true;
    chrome.alarms.clear(MAIN_TIMER_ALARM_NAME);
    console.log(`${timerState.currentSessionType} timer alarm explicitly paused.`);
    broadcastState();
  }
}

function resetPomodoroCycle() {
  chrome.alarms.clear(MAIN_TIMER_ALARM_NAME);
  timerState.isPaused = true;
  timerState.currentSessionType = 'WORK';
  timerState.currentTime = timerState.userSetWorkDuration;
  timerState.pomodorosCompletedThisCycle = 0;
  timerState.isAdHocBreakActive = false;
  timerState.currentAdHocBreakTime = 0;
  timerState.adHocBreakStartTime = 0;
  timerState.adHocBreakCountThisSession = 0;
  timerState.totalAdHocBreakDurationThisSession = 0;
  timerState.showSessionSummary = false;
  console.log("Pomodoro cycle reset.");
  saveDurationsAndCycleToStorage();
  broadcastState();
}

function generateSessionSummary() {
    if (timerState.adHocBreakCountThisSession === 0) {
        timerState.sessionSummaryText = "Focus session completed uninterrupted! Great job!";
    } else {
        const totalBreakSeconds = timerState.totalAdHocBreakDurationThisSession;
        const breakMinutes = Math.floor(totalBreakSeconds / 60);
        const breakSeconds = totalBreakSeconds % 60;
        timerState.sessionSummaryText = `Focus session complete! You took ${timerState.adHocBreakCountThisSession} break(s) totaling ${breakMinutes}m ${breakSeconds}s.`;
    }
    timerState.showSessionSummary = true;
}

function advanceToNextSession() {
  timerState.isPaused = true;
  chrome.alarms.clear(MAIN_TIMER_ALARM_NAME);
  let notificationMessage = "";

  if (timerState.currentSessionType === 'WORK') {
    generateSessionSummary(); // Generate summary text BEFORE resetting break counts
    timerState.pomodorosCompletedThisCycle++;
    saveDurationsAndCycleToStorage();
    notificationMessage = "Focus session complete! Time for a break.";
    
    if (timerState.pomodorosCompletedThisCycle >= POMODOROS_UNTIL_LONG_BREAK) {
      timerState.currentSessionType = 'LONG_BREAK';
      timerState.currentTime = timerState.longBreakDuration;
      timerState.pomodorosCompletedThisCycle = 0; // Reset for next cycle
    } else {
      timerState.currentSessionType = 'SHORT_BREAK';
      timerState.currentTime = timerState.shortBreakDuration;
    }
    // Reset ad-hoc break counters for the new Pomodoro break session (or next work session)
    timerState.adHocBreakCountThisSession = 0;
    timerState.totalAdHocBreakDurationThisSession = 0;

  } else { // Was a SHORT_BREAK or LONG_BREAK
    notificationMessage = "Break's over! Time to focus.";
    timerState.currentSessionType = 'WORK';
    timerState.currentTime = timerState.userSetWorkDuration;
    timerState.showSessionSummary = false; // Clear summary when moving to a new work session
    timerState.adHocBreakCountThisSession = 0; // Ensure clean slate for new work session
    timerState.totalAdHocBreakDurationThisSession = 0;
  }

  showNotification(notificationMessage);
  broadcastState(); // Broadcast state with summary and new session info
}

// --- Ad-hoc Break ---
function startAdHocBreak() {
  if (timerState.currentSessionType === 'WORK' && !timerState.isAdHocBreakActive && !timerState.isPaused) {
    timerState.isPaused = true; // Pause the main work timer
    chrome.alarms.clear(MAIN_TIMER_ALARM_NAME); // Stop its alarm
    
    timerState.isAdHocBreakActive = true;
    timerState.adHocBreakStartTime = Date.now();
    timerState.currentAdHocBreakTime = 0;
    timerState.showSessionSummary = false; // Clear summary when taking a break
    console.log("Ad-hoc break started. Main timer paused.");
    broadcastState();
  }
}

function finishAdHocBreakAndResume() {
  if (timerState.isAdHocBreakActive) {
    const breakDuration = Math.floor((Date.now() - timerState.adHocBreakStartTime) / 1000);
    timerState.adHocBreakCountThisSession++;
    timerState.totalAdHocBreakDurationThisSession += breakDuration;
    
    console.log(`Ad-hoc break finished. Duration: ${breakDuration}s. Total for session: ${timerState.totalAdHocBreakDurationThisSession}s`);
    // No notification here, summary comes at end of focus session.
    
    timerState.isAdHocBreakActive = false;
    timerState.adHocBreakStartTime = 0;
    timerState.currentAdHocBreakTime = 0;
    
    // Automatically resume the main WORK timer
    timerState.isPaused = false; 
    chrome.alarms.create(MAIN_TIMER_ALARM_NAME, { delayInMinutes: 0, periodInMinutes: 1 / 60 });
    console.log("Main timer resumed after ad-hoc break.");
    broadcastState();
  }
}

// --- Alarm Listener ---
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === MAIN_TIMER_ALARM_NAME) {
    if (!timerState.isPaused && !timerState.isAdHocBreakActive) {
      if (timerState.currentTime > 0) {
        timerState.currentTime--;
        broadcastState();
      } else {
        advanceToNextSession();
      }
    }
  }
});

// --- Message Listener ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("Background received message:", request.type, request);
  switch (request.type) {
    case 'GET_TIMER_STATE':
      if (timerState.isAdHocBreakActive && timerState.adHocBreakStartTime > 0) {
        timerState.currentAdHocBreakTime = Math.floor((Date.now() - timerState.adHocBreakStartTime) / 1000);
      }
      sendResponse({ ...timerState });
      break;
    case 'MAIN_ACTION_CLICK':
      if (timerState.isAdHocBreakActive) {
        finishAdHocBreakAndResume();
      } else if (timerState.isPaused) { // Covers WORK paused, or any Pomodoro session initially paused
        startMainTimer();
      } else if (timerState.currentSessionType === 'WORK' && !timerState.isPaused) { // WORK session is running
        startAdHocBreak();
      }
      // For running Pomodoro breaks (SHORT/LONG), main action button is disabled by popup.js, so no action here.
      break;
    case 'RESET_CYCLE':
      resetPomodoroCycle();
      break;
    case 'UPDATE_WORK_DURATION':
      const newWorkDuration = request.userSetWorkDuration;
      if (newWorkDuration && newWorkDuration > 0) {
        timerState.userSetWorkDuration = newWorkDuration;
        if (timerState.isPaused && timerState.currentSessionType === 'WORK' && !timerState.isAdHocBreakActive) {
          timerState.currentTime = newWorkDuration;
        }
        saveDurationsAndCycleToStorage();
        console.log("Work duration updated to:", newWorkDuration);
        broadcastState();
      }
      break;
    default:
      console.warn("Unknown message type received:", request.type);
      return false;
  }
  return true; 
});

// --- Extension Lifecycle ---
chrome.runtime.onInstalled.addListener((details) => {
  console.log("Extension lifecycle: onInstalled - ", details.reason);
  loadStateFromStorage(() => {
    if (details.reason === "install") {
      showNotification("NeuroFocus Timer installed! Set focus time & start.");
      saveDurationsAndCycleToStorage(); // Save initial defaults
    }
    broadcastState();
  });
});

chrome.runtime.onStartup.addListener(() => {
  console.log("Extension lifecycle: onStartup");
  loadStateFromStorage(() => {
    chrome.alarms.clear(MAIN_TIMER_ALARM_NAME); // Clear any orphaned alarms
    broadcastState();
  });
});

// Initial load of state when script first runs
loadStateFromStorage(broadcastState);
console.log("Background script loaded and initial state processed.");

// Utility to format time, if needed by notifications from background (already defined in popup)
// function formatTime(seconds) { ... } // Not strictly needed here if popup handles all time formatting
