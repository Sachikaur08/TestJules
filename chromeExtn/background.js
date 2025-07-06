// Background script for managing timer state and notifications

let timerState = {
  currentTime: 25 * 60, // Default work duration in seconds
  workDuration: 25 * 60,
  breakDuration: 5 * 60,
  isPaused: true,
  isWorkSession: true, // true for work, false for break
  timerId: null // To store the alarm name
};

// Function to update timer state (e.g., when popup sends new settings)
function updateTimerSettings(newWorkDuration, newBreakDuration) {
  timerState.workDuration = newWorkDuration;
  timerState.breakDuration = newBreakDuration;
  if (timerState.isPaused) { // Only update current time if paused and reset
    timerState.currentTime = timerState.isWorkSession ? newWorkDuration : newBreakDuration;
  }
}

function startTimerAlarm() {
  if (timerState.isPaused) {
    timerState.isPaused = false;
    // Create an alarm that fires every second
    // Note: Frequent alarms like every second are resource-intensive.
    // For a production extension, consider alternatives or less frequent updates if possible.
    // However, for a countdown timer, this is a common approach.
    // Chrome alarms are not guaranteed to fire exactly on time.
    chrome.alarms.create('pomodoroTimer', { delayInMinutes: 0, periodInMinutes: 1 / 60 });
    console.log("Timer alarm started.");
  }
}

function pauseTimerAlarm() {
  timerState.isPaused = true;
  chrome.alarms.clear('pomodoroTimer');
  console.log("Timer alarm paused.");
}

function resetTimerAlarm() {
  timerState.isPaused = true;
  timerState.isWorkSession = true;
  timerState.currentTime = timerState.workDuration;
  chrome.alarms.clear('pomodoroTimer');
  console.log("Timer alarm reset.");
  broadcastState();
}

function showNotification(message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png', // Ensure you have this icon
    title: 'NeuroFocus Timer',
    message: message,
    priority: 2
  });
}

// Listen for alarm events
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'pomodoroTimer' && !timerState.isPaused) {
    if (timerState.currentTime > 0) {
      timerState.currentTime--;
    } else {
      // Timer reached zero
      timerState.isPaused = true; // Pause before switching
      chrome.alarms.clear('pomodoroTimer'); // Stop the alarm

      timerState.isWorkSession = !timerState.isWorkSession;
      const previousSessionWasWork = !timerState.isWorkSession; // if it's now break, previous was work

      timerState.currentTime = timerState.isWorkSession ? timerState.workDuration : timerState.breakDuration;

      if (previousSessionWasWork) {
        showNotification("Work session ended! Time for a break.");
      } else {
        showNotification("Break's over! Time to focus.");
      }
      // Optionally auto-start next session's alarm here, or wait for user action from popup
      // For now, we'll require manual start from popup for the next session
    }
    broadcastState(); // Send updated state to any open popups
  }
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("Message received in background:", request);
  if (request.type === 'GET_TIMER_STATE') {
    sendResponse(timerState);
    return true; // Indicates response will be sent asynchronously or keeps message channel open
  } else if (request.type === 'START_TIMER') {
    startTimerAlarm();
    sendResponse({ status: "Timer started" });
  } else if (request.type === 'PAUSE_TIMER') {
    pauseTimerAlarm();
    sendResponse({ status: "Timer paused" });
  } else if (request.type === 'RESET_TIMER') {
    resetTimerAlarm();
    sendResponse({ status: "Timer reset" });
  } else if (request.type === 'TIMER_ENDED') { // This message comes from popup.js when its interval hits 0
    // This is slightly redundant if alarms are perfectly in sync, but good for robustness
    // The alarm listener should primarily handle this.
    // However, if popup's timer hits 0 first, it tells background.
    // Background then decides if notification is needed based on its state.

    const wasWorkSession = request.isWork; // isWork:true means the session that *just ended* was a work session
    if (wasWorkSession) {
      showNotification("Work session ended! Time for a break.");
    } else {
      showNotification("Break's over! Time to focus.");
    }
    // Ensure background state is also ready for the next session
    // This logic is mostly duplicated in the alarm handler, so care must be taken
    if (!timerState.isPaused) { // If alarm was still somehow running
        pauseTimerAlarm(); // Pause it
    }
    timerState.isWorkSession = !wasWorkSession; // Flip session type
    timerState.currentTime = timerState.isWorkSession ? timerState.workDuration : timerState.breakDuration;
    timerState.isPaused = true; // Always pause after a session ends, require manual restart
    broadcastState();
    sendResponse({ status: "Notification shown" });

  } else if (request.type === 'UPDATE_SETTINGS') {
    // Example: chrome.runtime.sendMessage({ type: 'UPDATE_SETTINGS', workDuration: 20*60, breakDuration: 10*60 });
    updateTimerSettings(request.workDuration, request.breakDuration);
    if(timerState.isPaused) { // if paused, update the current time to the new duration immediately
        timerState.currentTime = timerState.isWorkSession ? timerState.workDuration : timerState.breakDuration;
        broadcastState();
    }
    sendResponse({ status: "Settings updated" });
  }
  return true; // Keep message channel open for async response
});

// Function to broadcast the current state to any listening popups
function broadcastState() {
  chrome.runtime.sendMessage({
    type: 'TIMER_STATE_UPDATE',
    ...timerState
  }, response => {
    if (chrome.runtime.lastError) {
      // console.log("Error broadcasting state or no popup listening:", chrome.runtime.lastError.message);
    }
  });
}

// Initial broadcast in case a popup is already open when the background script reloads
// (e.g., during development)
// Note: This might not always work as expected due to timing of popup opening vs. background script loading.
// The popup's GET_TIMER_STATE on load is more reliable.
// broadcastState();

console.log("Background script loaded and initialized.");
// Show a notification on install/update (optional)
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    console.log("Extension installed.");
    showNotification("NeuroFocus Timer installed! Click the icon to start focusing.");
  } else if (details.reason === "update") {
    console.log("Extension updated.");
    // showNotification("NeuroFocus Timer has been updated!");
  }
  // Initialize default state in storage (optional, if you want settings to persist across browser restarts more robustly)
  chrome.storage.local.get(['workDuration', 'breakDuration'], (result) => {
    if (result.workDuration && result.breakDuration) {
      timerState.workDuration = result.workDuration;
      timerState.breakDuration = result.breakDuration;
    } else {
      // Store default values if not already there
      chrome.storage.local.set({
        workDuration: timerState.workDuration,
        breakDuration: timerState.breakDuration
      });
    }
    // Always reset to the work session duration when the extension is installed/re-enabled
    timerState.currentTime = timerState.workDuration;
    timerState.isPaused = true;
    timerState.isWorkSession = true;
    broadcastState();
  });
});

// Load settings from storage when the extension starts
chrome.storage.local.get(['workDuration', 'breakDuration'], (result) => {
  if (result.workDuration !== undefined) {
    timerState.workDuration = result.workDuration;
  }
  if (result.breakDuration !== undefined) {
    timerState.breakDuration = result.breakDuration;
  }
  // Initialize currentTime based on loaded settings, assuming it's a fresh start or reset.
  timerState.currentTime = timerState.workDuration;
  timerState.isPaused = true;
  timerState.isWorkSession = true;
  console.log("Initial settings loaded from storage:", timerState);
  broadcastState(); // Broadcast after loading initial settings
});
