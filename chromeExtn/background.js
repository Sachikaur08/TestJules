// background.js

// Default settings - these will be overridden by storage if available
let settings = {
    startTime: "09:00", // Default active start time
    endTime: "17:00",   // Default active end time
    userSetWorkDuration: 25 * 60,
    shortBreakDuration: 5 * 60,
    longBreakDuration: 15 * 60,
    pomodorosUntilLongBreak: 4,
};

const MAIN_TIMER_ALARM_NAME = 'pomodoroMainTimer';
const DAILY_SCHEDULER_ALARM_NAME = 'dailyActivationScheduler';

const DISTRACTING_SITES = [
    'youtube.com', 
    'www.youtube.com',
    'instagram.com',
    'www.instagram.com',
    'web.whatsapp.com' 
    // Note: No 'www.' for web.whatsapp.com as it's usually the direct hostname
];

let timerState = {
  // Durations will now come from 'settings' object once loaded
  currentTime: settings.userSetWorkDuration, // Initialized with default, updated on settings load
  isPaused: true,
  currentSessionType: 'WORK', // 'WORK', 'SHORT_BREAK', 'LONG_BREAK'
  pomodorosCompletedThisCycle: 0,

  isAdHocTimeoutActive: false,
  adHocTimeoutStartTime: 0,
  currentAdHocTimeoutTime: 0,

  adHocTimeoutCountThisSession: 0,
  totalAdHocTimeoutDurationThisSession: 0,
  showSessionSummary: false,
  sessionSummaryText: "",

  isOutsideActiveHours: true, 
  currentSessionActualStartTime: 0,
  
  // For Distraction Tracking
  currentWorkSessionDistractions: {}, // e.g., {'youtube.com': 120, 'instagram.com': 60}
  currentlyTrackedDistractingSite: null // e.g., { hostname: 'youtube.com', startTime: timestamp }
};

// --- Helper Functions ---
function showNotification(message) {
  chrome.notifications.create({
    type: 'basic', iconUrl: 'icons/icon128.png',
    title: 'NeuroFocus Timer', message: message, priority: 2
  });
}

function broadcastState() {
  if (timerState.isAdHocTimeoutActive && timerState.adHocTimeoutStartTime > 0) { 
    timerState.currentAdHocTimeoutTime = Math.floor((Date.now() - timerState.adHocTimeoutStartTime) / 1000); 
  }
  // Include settings in the broadcast so popup can display schedule times
  const stateWithSettings = { ...timerState, settings: { ...settings } };
  chrome.runtime.sendMessage({ type: 'TIMER_STATE_UPDATE', state: stateWithSettings });
  console.log("State broadcasted:", JSON.parse(JSON.stringify(stateWithSettings))); 
}

function saveSettingsToStorage(newSettings, callback) {
    chrome.storage.local.set(newSettings, () => {
        console.log("Settings saved to storage:", newSettings);
        if (callback) callback();
    });
}

// Loads all settings and then initializes timerState based on them.
function loadSettingsAndInitializeState(callback) {
  chrome.storage.local.get([
    'startTime', 'endTime',
    'userSetWorkDuration', 'shortBreakDuration', 'longBreakDuration',
    'pomodorosUntilLongBreak', 'pomodorosCompletedThisCycle' // pomodorosCompletedThisCycle is part of timer state but related to cycle config
  ], (loadedData) => {
    // Update global settings object
    settings.startTime = loadedData.startTime || settings.startTime;
    settings.endTime = loadedData.endTime || settings.endTime;
    settings.userSetWorkDuration = loadedData.userSetWorkDuration !== undefined ? loadedData.userSetWorkDuration : settings.userSetWorkDuration;
    settings.shortBreakDuration = loadedData.shortBreakDuration !== undefined ? loadedData.shortBreakDuration : settings.shortBreakDuration;
    settings.longBreakDuration = loadedData.longBreakDuration !== undefined ? loadedData.longBreakDuration : settings.longBreakDuration;
    settings.pomodorosUntilLongBreak = loadedData.pomodorosUntilLongBreak !== undefined ? loadedData.pomodorosUntilLongBreak : settings.pomodorosUntilLongBreak;

    // Initialize timerState based on loaded settings
    timerState.currentTime = settings.userSetWorkDuration;
    timerState.isPaused = true;
    timerState.currentSessionType = 'WORK';
    timerState.pomodorosCompletedThisCycle = loadedData.pomodorosCompletedThisCycle || 0; // Load separately as it's not part of 'settings' defaults
    
    timerState.isAdHocTimeoutActive = false;
    timerState.currentAdHocTimeoutTime = 0;
    timerState.adHocTimeoutStartTime = 0;
    timerState.adHocTimeoutCountThisSession = 0;
    timerState.totalAdHocTimeoutDurationThisSession = 0;
    timerState.showSessionSummary = false;
    timerState.sessionSummaryText = "";
    timerState.currentSessionActualStartTime = 0; // Reset this too
    
    checkIfOutsideActiveHours(); // Update active hours status

    console.log("Settings loaded and timer state initialized:", settings, timerState);
    if (callback) callback();
    createOrUpdateDailyScheduler(); // Ensure daily scheduler is set based on new times
  });
}

function checkIfOutsideActiveHours() {
    const now = new Date();
    const currentTime = now.getHours().toString().padStart(2, '0') + ":" + now.getMinutes().toString().padStart(2, '0');
    
    if (settings.startTime && settings.endTime) {
        timerState.isOutsideActiveHours = !(currentTime >= settings.startTime && currentTime < settings.endTime);
    } else {
        // If no start/end times are set (e.g. user clears them in options), assume always active.
        timerState.isOutsideActiveHours = false; 
    }
    // console.log(`Current time: ${currentTime}, Start: ${settings.startTime}, End: ${settings.endTime}, OutsideActiveHours: ${timerState.isOutsideActiveHours}`);
    return timerState.isOutsideActiveHours;
}


// --- Data Logging ---
const LOG_STORAGE_KEY = 'neuroFocusSessionLogs';
const MAX_LOG_AGE_DAYS = 10; // For pruning logs

async function addLogEntry(logEntry) {
    try {
        const result = await chrome.storage.local.get(LOG_STORAGE_KEY);
        let logs = result[LOG_STORAGE_KEY] || [];

        logs.push(logEntry);

        // Pruning: Keep logs for MAX_LOG_AGE_DAYS
        const cutoffTimestamp = Date.now() - (MAX_LOG_AGE_DAYS * 24 * 60 * 60 * 1000);
        logs = logs.filter(entry => entry.endTime > cutoffTimestamp); // Assuming endTime is a timestamp

        await chrome.storage.local.set({ [LOG_STORAGE_KEY]: logs });
        console.log("Log entry added and logs pruned:", logEntry, "Total logs:", logs.length);
    } catch (error) {
        console.error("Error adding log entry:", error);
    }
}

function getFormattedDate(timestamp) {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// --- Timer Control Functions ---
function startMainTimer() {
  if (checkIfOutsideActiveHours()) {
    showNotification(`Timer operational only between ${settings.startTime} and ${settings.endTime}.`);
    console.log("Attempted to start timer outside active hours.");
    // Ensure timer is paused and doesn't start
    if (!timerState.isPaused) { // If it somehow thought it was running
        timerState.isPaused = true;
        chrome.alarms.clear(MAIN_TIMER_ALARM_NAME);
    }
    broadcastState();
    return;
  }

  if (timerState.isPaused && !timerState.isAdHocTimeoutActive) {
    timerState.isPaused = false;
    timerState.showSessionSummary = false;
    timerState.currentSessionActualStartTime = Date.now(); // Record actual start time for logging
    chrome.alarms.create(MAIN_TIMER_ALARM_NAME, { delayInMinutes: 0, periodInMinutes: 1 / 60 });
    console.log(`${timerState.currentSessionType} timer alarm started/resumed at ${new Date(timerState.currentSessionActualStartTime).toLocaleTimeString()}`);
    broadcastState();
  }
}

function pauseMainTimer() { // Explicit pause, not ad-hoc timeout start
  if (!timerState.isPaused && !timerState.isAdHocTimeoutActive) { // Renamed variable
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
  timerState.currentTime = settings.userSetWorkDuration; // Use settings
  timerState.pomodorosCompletedThisCycle = 0;
  timerState.isAdHocTimeoutActive = false; 
  timerState.currentAdHocTimeoutTime = 0; 
  timerState.adHocTimeoutStartTime = 0;    
  timerState.adHocTimeoutCountThisSession = 0; 
  timerState.totalAdHocTimeoutDurationThisSession = 0; 
  timerState.showSessionSummary = false;
    
    // Reset distraction tracking for the new cycle
    stopCurrentDistractionTracking(false); // Stop any active, but don't log as it's a reset
    timerState.currentWorkSessionDistractions = {};
    timerState.currentlyTrackedDistractingSite = null;

  checkIfOutsideActiveHours(); // Re-check active hours status
  console.log("Pomodoro cycle reset.");
  // Save pomodorosCompletedThisCycle to storage, as it's part of cycle config
  chrome.storage.local.set({ pomodorosCompletedThisCycle: 0 }, () => {
    console.log("Pomodoros completed count reset in storage.");
  });
  broadcastState();
}

function generateSessionSummary() {
    if (timerState.adHocTimeoutCountThisSession === 0) { 
        timerState.sessionSummaryText = "Focus session completed uninterrupted! Great job!";
    } else {
        const totalTimeoutSeconds = timerState.totalAdHocTimeoutDurationThisSession; 
        const timeoutMinutes = Math.floor(totalTimeoutSeconds / 60);
        const timeoutSeconds = totalTimeoutSeconds % 60;
        timerState.sessionSummaryText = `Focus session complete! You took ${timerState.adHocTimeoutCountThisSession} timeout(s) totaling ${timeoutMinutes}m ${timeoutSeconds}s.`; 
    }
    timerState.showSessionSummary = true;
}

function advanceToNextSession() {
  if (checkIfOutsideActiveHours() && timerState.currentSessionType === 'WORK') {
      // If a work session ends and we are now outside active hours, generate summary but don't start a break.
      generateSessionSummary();
      showNotification("Scheduled active time has ended for today.");
      console.log("Work session ended outside active hours. No new session started.");
      timerState.isPaused = true; // Ensure it's paused
      chrome.alarms.clear(MAIN_TIMER_ALARM_NAME);
      // Reset counters for next potential work session if needed (or handle this at start of new work day)
      // timerState.adHocTimeoutCountThisSession = 0; 
      // timerState.totalAdHocTimeoutDurationThisSession = 0;
      broadcastState();
      return;
  }

  timerState.isPaused = true;
  chrome.alarms.clear(MAIN_TIMER_ALARM_NAME);
  let notificationMessage = "";
  const sessionEndTime = Date.now();
  let plannedDuration;

  // Log the completed session
  if (timerState.currentSessionType === 'WORK') {
    plannedDuration = settings.userSetWorkDuration;
    addLogEntry({
        id: `${timerState.currentSessionActualStartTime}_WORK`,
        type: 'WORK',
        date: getFormattedDate(timerState.currentSessionActualStartTime),
        startTime: timerState.currentSessionActualStartTime,
        endTime: sessionEndTime,
        plannedDuration: plannedDuration,
        actualDuration: Math.floor((sessionEndTime - timerState.currentSessionActualStartTime) / 1000), 
        adHocTimeoutCount: timerState.adHocTimeoutCountThisSession,
        totalAdHocTimeoutDuration: timerState.totalAdHocTimeoutDurationThisSession,
        distractions: { ...timerState.currentWorkSessionDistractions } // Log recorded distractions
    });

    // Stop any active distraction tracking before moving to break/next session
    stopCurrentDistractionTracking(true); 

    generateSessionSummary(); 
    timerState.pomodorosCompletedThisCycle++;
    chrome.storage.local.set({ pomodorosCompletedThisCycle: timerState.pomodorosCompletedThisCycle });
    notificationMessage = "Focus session complete! Time for a Pomodoro break."; 
    
    if (timerState.pomodorosCompletedThisCycle >= settings.pomodorosUntilLongBreak) { 
      timerState.currentSessionType = 'LONG_BREAK';
      timerState.currentTime = settings.longBreakDuration; 
      timerState.pomodorosCompletedThisCycle = 0; 
      chrome.storage.local.set({ pomodorosCompletedThisCycle: 0 }); 
    } else {
      timerState.currentSessionType = 'SHORT_BREAK';
      timerState.currentTime = settings.shortBreakDuration; 
    }
    timerState.adHocTimeoutCountThisSession = 0; 
    timerState.totalAdHocTimeoutDurationThisSession = 0; 

  } else { // Was a SHORT_BREAK or LONG_BREAK
    plannedDuration = (timerState.currentSessionType === 'SHORT_BREAK') ? settings.shortBreakDuration : settings.longBreakDuration;
    addLogEntry({
        id: `${timerState.currentSessionActualStartTime}_${timerState.currentSessionType}`,
        type: timerState.currentSessionType,
        date: getFormattedDate(timerState.currentSessionActualStartTime),
        startTime: timerState.currentSessionActualStartTime,
        endTime: sessionEndTime,
        plannedDuration: plannedDuration,
        actualDuration: Math.floor((sessionEndTime - timerState.currentSessionActualStartTime) / 1000) // Approximate
    });

    if (checkIfOutsideActiveHours()) {
        showNotification("Scheduled active time has ended. Next focus session will start on the next active day.");
        console.log("Pomodoro break ended outside active hours. No new work session started.");
        timerState.showSessionSummary = false; 
        broadcastState();
        return;
    }
    notificationMessage = "Pomodoro break's over! Time to focus."; 
    timerState.currentSessionType = 'WORK';
    timerState.currentTime = settings.userSetWorkDuration; 
    timerState.showSessionSummary = false; 
    timerState.adHocTimeoutCountThisSession = 0; 
    timerState.totalAdHocTimeoutDurationThisSession = 0;
    // Reset distraction data for the new WORK session
    timerState.currentWorkSessionDistractions = {};
    timerState.currentlyTrackedDistractingSite = null;
  }

  showNotification(notificationMessage);
  broadcastState(); 
}

// --- Ad-hoc Timeout ---
let currentAdHocTimeoutDetails = null; // To store start time of an individual timeout for logging

function startAdHocTimeout() { 
  if (checkIfOutsideActiveHours()) {
      console.log("Cannot take timeout outside active hours.");
      return;
  }
  if (timerState.currentSessionType === 'WORK' && !timerState.isAdHocTimeoutActive && !timerState.isPaused) { 
    timerState.isPaused = true; 
    chrome.alarms.clear(MAIN_TIMER_ALARM_NAME); 
    
    timerState.isAdHocTimeoutActive = true; 
    timerState.adHocTimeoutStartTime = Date.now(); // This is for the *entire* adhoc period for timerState
    currentAdHocTimeoutDetails = { // Log individual timeout start
        id: `${Date.now()}_ADHOC_TIMEOUT`,
        timeoutStartTime: Date.now() 
    };
    timerState.currentAdHocTimeoutTime = 0; 
    timerState.showSessionSummary = false; 
    console.log("Ad-hoc timeout started. Main timer paused.");
    // No need to call stopCurrentDistractionTracking here, as handleTabActivity will stop it
    // when the timer state becomes paused or adHocTimeoutActive.
    broadcastState();
  }
}

function finishAdHocTimeoutAndResume() { 
  if (timerState.isAdHocTimeoutActive) { 
    const adhocEndTime = Date.now();
    const timeoutDuration = Math.floor((adhocEndTime - timerState.adHocTimeoutStartTime) / 1000); // This is total adhoc duration for this instance
    
    if (currentAdHocTimeoutDetails) {
        // Here we would ideally add currentAdHocTimeoutDetails to a temporary list in timerState,
        // which then gets saved with the WORK session log.
        // For now, we'll just use the count and total duration already being tracked by timerState.
        // This means we are not yet logging individual timeouts, only the aggregate for the session summary.
        // To log individual timeouts, timerState would need an array like `currentSessionAdhocTimeouts`.
        console.log("Individual ad-hoc timeout ended:", { 
            ...currentAdHocTimeoutDetails, 
            timeoutEndTime: adhocEndTime, 
            duration: Math.floor((adhocEndTime - currentAdHocTimeoutDetails.timeoutStartTime)/1000)
        });
        currentAdHocTimeoutDetails = null;
    }
    
    timerState.adHocTimeoutCountThisSession++; 
    timerState.totalAdHocTimeoutDurationThisSession += timeoutDuration; 
    
    console.log(`Ad-hoc timeout finished. Duration for this instance: ${timeoutDuration}s. Total for session: ${timerState.totalAdHocTimeoutDurationThisSession}s`); 
    
    timerState.isAdHocTimeoutActive = false; 
    timerState.adHocTimeoutStartTime = 0; 
    timerState.currentAdHocTimeoutTime = 0;
    
    // After finishing an ad-hoc timeout, the timer should resume.
    // The handleTabActivity() will then re-evaluate if distraction tracking should start
    // based on the currently active tab when the timer resumes.
    if (checkIfOutsideActiveHours()) {
        showNotification("Scheduled active time has ended. Timer will remain paused.");
        console.log("Ad-hoc timeout finished, but now outside active hours. Main timer remains paused.");
        // timerState.isPaused is true (set by startAdHocTimeout or by checkIfOutsideActiveHours)
    } else {
        timerState.isPaused = false; // Resume the main WORK timer
        chrome.alarms.create(MAIN_TIMER_ALARM_NAME, { delayInMinutes: 0, periodInMinutes: 1 / 60 });
        console.log("Main timer resumed after ad-hoc timeout.");
        // Immediately check current tab in case it's a distracting one
        handleTabActivity(); 
    }
    broadcastState();
  }
}

// --- Daily Scheduler ---
function createOrUpdateDailyScheduler() {
    if (settings.startTime) {
        const [hours, minutes] = settings.startTime.split(':').map(Number);
        const now = new Date();
        let nextRun = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0, 0);
        
        if (nextRun.getTime() < now.getTime()) { // If start time for today has already passed
            nextRun.setDate(nextRun.getDate() + 1); // Schedule for tomorrow
        }
        
        chrome.alarms.create(DAILY_SCHEDULER_ALARM_NAME, {
            when: nextRun.getTime(),
            periodInMinutes: 24 * 60 // Every 24 hours
        });
        console.log(`Daily scheduler alarm set for ${nextRun.toLocaleString()}`);
    } else {
        chrome.alarms.clear(DAILY_SCHEDULER_ALARM_NAME);
        console.log("Daily scheduler alarm cleared as no start time is set.");
    }
}


// --- Alarm Listener ---
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === MAIN_TIMER_ALARM_NAME) {
    if (checkIfOutsideActiveHours()) {
        console.log("Main timer alarm fired, but now outside active hours. Stopping timer.");
        showNotification("Active schedule ended. Timer stopped.");
        timerState.isPaused = true;
        timerState.isOutsideActiveHours = true; // ensure this is set
        chrome.alarms.clear(MAIN_TIMER_ALARM_NAME);
        // Potentially generate end-of-day report here if it's a work session that just ended.
        if(timerState.currentSessionType === 'WORK' && timerState.currentTime === 0) {
            // This means the work session naturally completed right as we went out of hours.
            // advanceToNextSession will handle summary if currentTime hit 0.
            // If currentTime > 0, it means it was interrupted.
        }
        broadcastState();
        return;
    }

    if (!timerState.isPaused && !timerState.isAdHocTimeoutActive) { 
      if (timerState.currentTime > 0) {
        timerState.currentTime--;
        broadcastState();
      } else {
        advanceToNextSession();
      }
    }
  } else if (alarm.name === DAILY_SCHEDULER_ALARM_NAME) {
    console.log("Daily scheduler alarm triggered.");
    checkIfOutsideActiveHours(); // This will update isOutsideActiveHours
    if (!timerState.isOutsideActiveHours && timerState.isPaused) {
        // Potentially auto-start the first session of the day if desired, or just enable the timer.
        // For now, just ensures the state is correct for user to manually start.
        showNotification(`It's ${settings.startTime}! Time to start your NeuroFocus sessions.`);
        // Reset cycle if needed or desired at start of new day
        // resetPomodoroCycle(); // This might be too aggressive. Let user decide.
    }
    broadcastState(); // Broadcast updated isOutsideActiveHours status
  }
});

// --- Message Listener ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("Background received message:", request.type, request);
  let responseSent = false;
  switch (request.type) {
    case 'GET_TIMER_STATE':
      checkIfOutsideActiveHours(); // Ensure this is up-to-date before sending
      if (timerState.isAdHocTimeoutActive && timerState.adHocTimeoutStartTime > 0) { 
        timerState.currentAdHocTimeoutTime = Math.floor((Date.now() - timerState.adHocTimeoutStartTime) / 1000); 
      }
      sendResponse({ ...timerState });
      responseSent = true;
      break;
    case 'MAIN_ACTION_CLICK':
      checkIfOutsideActiveHours(); // Re-check before action
      if (timerState.isAdHocTimeoutActive) { 
        finishAdHocTimeoutAndResume(); 
      } else if (timerState.isPaused) { 
        startMainTimer(); // This function now includes the active hours check
      } else if (timerState.currentSessionType === 'WORK' && !timerState.isPaused) { 
        startAdHocTimeout(); 
      }
      // No explicit sendResponse needed, broadcastState handles it.
      break;
    case 'RESET_CYCLE':
      resetPomodoroCycle(); // This also calls broadcastState
      break;
    case 'UPDATE_WORK_DURATION': // This message comes from popup.js for quick duration change
      // This should ideally update the 'settings.userSetWorkDuration' and save it
      // For now, let's assume options page is the master for this setting to avoid conflict
      // Or, we update settings object and save it.
      const newWorkDur = request.userSetWorkDuration;
      if (newWorkDur && newWorkDur > 0) {
        settings.userSetWorkDuration = newWorkDur;
        if (timerState.isPaused && timerState.currentSessionType === 'WORK' && !timerState.isAdHocTimeoutActive) { 
          timerState.currentTime = newWorkDur;
        }
        // Save this specific setting change
        chrome.storage.local.set({ userSetWorkDuration: newWorkDur }, () => {
            console.log("Work duration updated via popup to:", newWorkDur);
            broadcastState();
        });
      }
      break;
    case 'SETTINGS_UPDATED': // Message from options.js
      console.log("Received SETTINGS_UPDATED message from options page.");
      loadSettingsAndInitializeState(() => {
        // Settings are reloaded, timer state re-initialized, daily scheduler updated.
        // If a timer was running, it's now reset and paused.
        // This is a hard reset of state based on new settings.
        chrome.alarms.clear(MAIN_TIMER_ALARM_NAME); // Stop any active pomodoro timer
        // Consider if we should notify user that settings are applied and timer reset.
        showNotification("Settings updated. Timer has been reset to apply new durations/schedule.");
        broadcastState(); 
      });
      sendResponse({status: "Settings received and re-initializing."});
      responseSent = true;
      break;
    default:
      console.warn("Unknown message type received:", request.type);
      return false; // Important for unknown types
  }
  return !responseSent; // Return true if sendResponse will be called asynchronously (implicitly by broadcastState)
                        // or if it has already been called.
});

// --- Extension Lifecycle ---
chrome.runtime.onInstalled.addListener((details) => {
  console.log("Extension lifecycle: onInstalled - ", details.reason);
  loadSettingsAndInitializeState(() => { // This now also calls createOrUpdateDailyScheduler
    if (details.reason === "install") {
      showNotification("NeuroFocus Timer installed! Configure your schedule in Options.");
      // Save initial default settings to storage on first install
      saveSettingsToStorage(settings);
    }
    broadcastState();
  });
});

chrome.runtime.onStartup.addListener(() => {
  console.log("Extension lifecycle: onStartup");
  loadSettingsAndInitializeState(() => { // This now also calls createOrUpdateDailyScheduler
    chrome.alarms.clear(MAIN_TIMER_ALARM_NAME); 
    broadcastState();
  });
});

// Initial load of settings and state when script first runs
loadSettingsAndInitializeState(broadcastState);
console.log("Background script loaded and initial settings/state processed.");


// --- Distraction Tracking Logic ---

function getHostname(url) {
    if (!url) return null;
    try {
        return new URL(url).hostname;
    } catch (e) {
        // console.warn("Could not parse URL for hostname:", url, e);
        return null;
    }
}

function stopCurrentDistractionTracking(logToConsole = false) {
    if (timerState.currentlyTrackedDistractingSite) {
        const durationSeconds = Math.floor((Date.now() - timerState.currentlyTrackedDistractingSite.startTime) / 1000);
        const siteHostname = timerState.currentlyTrackedDistractingSite.hostname;

        if (durationSeconds > 0) {
            timerState.currentWorkSessionDistractions[siteHostname] = (timerState.currentWorkSessionDistractions[siteHostname] || 0) + durationSeconds;
            if(logToConsole) console.log(`Tracked ${durationSeconds}s on ${siteHostname}. Total for session: ${timerState.currentWorkSessionDistractions[siteHostname]}s`);
        }
        timerState.currentlyTrackedDistractingSite = null;
        // No broadcastState here, will be broadcasted by calling function or next timer tick
    }
}

function startDistractionTracking(hostname) {
    // Stop any existing tracking first (e.g. if rapidly switching between distracting sites)
    if (timerState.currentlyTrackedDistractingSite && timerState.currentlyTrackedDistractingSite.hostname !== hostname) {
        stopCurrentDistractionTracking(true); 
    }
    // Start new tracking only if not already tracking this same site
    if (!timerState.currentlyTrackedDistractingSite || timerState.currentlyTrackedDistractingSite.hostname !== hostname) {
        timerState.currentlyTrackedDistractingSite = { hostname: hostname, startTime: Date.now() };
        console.log("Started tracking distraction:", hostname);
    }
}


async function handleTabActivity() {
    // Conditions for active tracking
    if (timerState.currentSessionType !== 'WORK' || timerState.isPaused || timerState.isAdHocTimeoutActive || timerState.isOutsideActiveHours) {
        if (timerState.currentlyTrackedDistractingSite) {
            console.log("WORK session no longer active/valid for tracking. Stopping distraction tracking.");
            stopCurrentDistractionTracking(true);
            broadcastState(); // Ensure popup knows about stopped distraction if it was displayed
        }
        return;
    }

    try {
        // Get the currently active tab in the currently focused window
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (!activeTab || !activeTab.url) {
            // No active tab or no URL (e.g. new tab page, incognito without permission if applicable)
            if (timerState.currentlyTrackedDistractingSite) {
                console.log("Active tab has no URL or not found. Stopping distraction tracking.");
                stopCurrentDistractionTracking(true);
                // broadcastState(); // Consider if a broadcast is needed here
            }
            return;
        }
        
        const currentHostname = getHostname(activeTab.url);

        if (DISTRACTING_SITES.includes(currentHostname)) {
            // If not already tracking this site, or if it's a different distracting site
            if (!timerState.currentlyTrackedDistractingSite || timerState.currentlyTrackedDistractingSite.hostname !== currentHostname) {
                startDistractionTracking(currentHostname);
            }
            // If already tracking this exact site, do nothing, let it continue.
        } else {
            // Current tab is not a distracting site, so stop tracking if we were.
            if (timerState.currentlyTrackedDistractingSite) {
                console.log(`Switched to non-distracting site (${currentHostname}). Stopping tracking for ${timerState.currentlyTrackedDistractingSite.hostname}.`);
                stopCurrentDistractionTracking(true);
            }
        }
    } catch (error) {
        console.error("Error in handleTabActivity:", error);
        // Ensure tracking is stopped on error to prevent inconsistent states
        if (timerState.currentlyTrackedDistractingSite) {
            stopCurrentDistractionTracking(false); // Don't log to console again if error is the reason
        }
    }
    // No broadcastState here by default, as this can fire very frequently.
    // State changes relevant to UI (like total distraction time) are handled by timer ticks or session changes.
}


// --- Event Listeners for Tab Activity ---
// Fires when the active tab in a window changes
chrome.tabs.onActivated.addListener(activeInfo => {
    console.log("Tab activated:", activeInfo.tabId);
    handleTabActivity();
});

// Fires when a tab is updated (e.g., URL changes)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // We only care about updates to the *active* tab in the *current* window.
    // And only if URL changes or status is complete (to avoid premature checks on loading tabs)
    if (tab.active && (changeInfo.url || changeInfo.status === 'complete')) {
        console.log("Tab updated:", tabId, "ChangeInfo:", changeInfo.status, changeInfo.url);
        handleTabActivity();
    }
});

// Fires when the focused window changes
chrome.windows.onFocusChanged.addListener(windowId => {
    console.log("Window focus changed to:", windowId);
    if (windowId === chrome.windows.WINDOW_ID_NONE) {
        // Browser window lost focus (e.g., user clicked on another app)
        if (timerState.currentlyTrackedDistractingSite) {
            console.log("Browser window lost focus. Stopping distraction tracking.");
            stopCurrentDistractionTracking(true);
            // broadcastState(); // Maybe broadcast if this implies a pause in activity
        }
    } else {
        // A Chrome window gained focus, check its active tab.
        handleTabActivity();
    }
});
