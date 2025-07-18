// background.js

// Default settings - these will be overridden by storage if available
let settings = {
    startTime: "00:00", // Default start time
    endTime: "23:59",   // Default end time
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
];

let timerState = {
    currentTime: settings.userSetWorkDuration, 
    isPaused: true,
    currentSessionType: 'WORK', 
    pomodorosCompletedThisCycle: 0,

    isAdHocTimeoutActive: false,
    adHocTimeoutStartTime: 0,
    currentAdHocTimeoutTime: 0,

    isOutsideActiveHours: true, 
    currentSessionActualStartTime: 0, 
  
    // For Distraction Tracking (accumulates over entire WORK cycle)
    currentWorkSessionDistractions: {}, 
    currentlyTrackedDistractingSite: null, 
    // For AdHoc Timeouts (accumulates over entire WORK cycle)
    adHocTimeoutCountThisSession: 0, 
    totalAdHocTimeoutDurationThisSession: 0, 

    // For session summary
    showSessionSummary: false,
  sessionSummaryText: "",

  // Snooze Functionality State
  pendingChoiceAfterWork: false, // True when WORK session ends, waiting for user to Snooze or Start Break
  currentWorkSessionInitialStartTime: 0, // Timestamp of when the *very first* segment of an extended WORK session began
  currentWorkSessionPlannedDuration: 0,  // Planned duration of the initial WORK segment from settings
  currentWorkSessionSnoozeCount: 0,    // How many times snooze was used in the current extended WORK session
  currentWorkSessionTotalSnoozeSeconds: 0, // Total accumulated snooze time for the current extended WORK session
  isSnoozeSession: false  // Track if current session is a snooze extension
};

// --- Helper Functions ---
function showNotification(message) {
    try {
        chrome.notifications.create({
            type: 'basic', iconUrl: 'icons/icon128.png',
            title: 'NeuroFocus Timer', message: message, priority: 2
        }, (notificationId) => {
            if (chrome.runtime.lastError) {
                console.error("Error creating notification:", chrome.runtime.lastError.message);
            }
        });
    } catch (error) {
        console.error("Error in showNotification:", error);
    }
}

function broadcastState() {
    // Add a small delay to prevent rapid successive broadcasts
    setTimeout(() => {
        try {
            if (timerState.isAdHocTimeoutActive && timerState.adHocTimeoutStartTime > 0) { 
                timerState.currentAdHocTimeoutTime = Math.floor((Date.now() - timerState.adHocTimeoutStartTime) / 1000); 
            }
            // Include settings in the broadcast so popup can display schedule times
            const stateWithSettings = { ...timerState, settings: { ...settings } };
            // Use sendMessage with callback to handle connection errors gracefully
            chrome.runtime.sendMessage({ type: 'TIMER_STATE_UPDATE', state: stateWithSettings }, (response) => {
                if (chrome.runtime.lastError) {
                    // Don't log errors when no popup is open - this is expected
                    if (!chrome.runtime.lastError.message.includes('Receiving end does not exist')) {
                        console.warn("Error broadcasting state:", chrome.runtime.lastError.message);
                    }
                }
            });
            // console.log("State broadcasted:", JSON.parse(JSON.stringify(stateWithSettings))); 
        } catch (error) {
            console.error("Error in broadcastState:", error);
        }
    }, 10); // Small delay to prevent rapid successive calls
}

function saveSettingsToStorage(newSettings, callback) {
    try {
        chrome.storage.local.set(newSettings, () => {
            if (chrome.runtime.lastError) {
                console.error("Error saving settings to storage:", chrome.runtime.lastError.message);
            }
            if (callback) callback();
        });
    } catch (error) {
        console.error("Error in saveSettingsToStorage:", error);
        if (callback) callback();
    }
}

// Loads all settings and then initializes timerState based on them.
function loadSettingsAndInitializeState(callback) {
  chrome.storage.local.get([
    'startTime', 'endTime',
    'userSetWorkDuration', 'shortBreakDuration', 'longBreakDuration',
    'pomodorosUntilLongBreak', 'pomodorosCompletedThisCycle', 'distractingSites',
    'savedCurrentTime', 'savedSessionType', 'savedIsPaused', 'savedIsAdHocTimeoutActive'
  ], (loadedData) => {
    settings.startTime = loadedData.startTime || settings.startTime;
    settings.endTime = loadedData.endTime || settings.endTime;
    settings.userSetWorkDuration = loadedData.userSetWorkDuration !== undefined ? loadedData.userSetWorkDuration : settings.userSetWorkDuration;
    settings.shortBreakDuration = loadedData.shortBreakDuration !== undefined ? loadedData.shortBreakDuration : settings.shortBreakDuration;
    settings.longBreakDuration = loadedData.longBreakDuration !== undefined ? loadedData.longBreakDuration : settings.longBreakDuration;
    settings.pomodorosUntilLongBreak = loadedData.pomodorosUntilLongBreak !== undefined ? loadedData.pomodorosUntilLongBreak : settings.pomodorosUntilLongBreak;

    // Restore currentTime if session is in progress
    if (
      loadedData.savedCurrentTime !== undefined &&
      loadedData.savedSessionType === 'WORK' &&
      loadedData.savedIsPaused !== undefined &&
      loadedData.savedIsAdHocTimeoutActive !== undefined
    ) {
      timerState.currentTime = loadedData.savedCurrentTime;
      timerState.currentSessionType = loadedData.savedSessionType;
      timerState.isPaused = loadedData.savedIsPaused;
      timerState.isAdHocTimeoutActive = loadedData.savedIsAdHocTimeoutActive;
    } else {
      timerState.currentTime = settings.userSetWorkDuration;
      timerState.isPaused = true;
      timerState.currentSessionType = 'WORK';
      timerState.isAdHocTimeoutActive = false;
    }
    timerState.pomodorosCompletedThisCycle = loadedData.pomodorosCompletedThisCycle || 0; 
    timerState.currentAdHocTimeoutTime = 0;
    timerState.adHocTimeoutStartTime = 0;
    timerState.adHocTimeoutCountThisSession = 0;
    timerState.totalAdHocTimeoutDurationThisSession = 0;
    timerState.currentWorkSessionDistractions = {};
    timerState.currentlyTrackedDistractingSite = null;
    // Ensure snooze related fields are at their default (non-snooze) state
    timerState.pendingChoiceAfterWork = false;
    timerState.currentWorkSessionInitialStartTime = 0; 
    timerState.currentWorkSessionPlannedDuration = settings.userSetWorkDuration;
    timerState.currentWorkSessionSnoozeCount = 0;
    timerState.currentWorkSessionTotalSnoozeSeconds = 0;
    timerState.showSessionSummary = false;
    timerState.sessionSummaryText = "";
    timerState.currentSessionActualStartTime = 0; 
    // Load distracting sites from storage
    if (loadedData.distractingSites && Array.isArray(loadedData.distractingSites)) {
        DISTRACTING_SITES.length = 0;
        DISTRACTING_SITES.push(...loadedData.distractingSites);
        console.log("Distracting sites loaded from storage:", DISTRACTING_SITES);
    }
    checkIfOutsideActiveHours(); 
    if (callback) callback();
    createOrUpdateDailyScheduler(); 
  });
}

// Helper to persist currentTime and session state
function persistCurrentTime() {
  chrome.storage.local.set({
    savedCurrentTime: timerState.currentTime,
    savedSessionType: timerState.currentSessionType,
    savedIsPaused: timerState.isPaused,
    savedIsAdHocTimeoutActive: timerState.isAdHocTimeoutActive
  });
}

// Helper to clear persisted currentTime
function clearPersistedCurrentTime() {
  chrome.storage.local.remove(['savedCurrentTime', 'savedSessionType', 'savedIsPaused', 'savedIsAdHocTimeoutActive']);
}

function checkIfOutsideActiveHours() {
    const now = new Date();
    const currentTime = now.getHours().toString().padStart(2, '0') + ":" + now.getMinutes().toString().padStart(2, '0');
    if (settings.startTime && settings.endTime) {
        timerState.isOutsideActiveHours = !(currentTime >= settings.startTime && currentTime < settings.endTime);
    } else {
        timerState.isOutsideActiveHours = false; 
    }
    return timerState.isOutsideActiveHours;
}

const LOG_STORAGE_KEY = 'neuroFocusSessionLogs';
const MAX_LOG_AGE_DAYS = 10; 

async function addLogEntry(logEntry) {
    try {
        const result = await chrome.storage.local.get(LOG_STORAGE_KEY);
        let logs = result[LOG_STORAGE_KEY] || [];
        logs.push(logEntry);
        const cutoffTimestamp = Date.now() - (MAX_LOG_AGE_DAYS * 24 * 60 * 60 * 1000);
        logs = logs.filter(entry => entry.endTime > cutoffTimestamp); 
        await chrome.storage.local.set({ [LOG_STORAGE_KEY]: logs });
        console.log("Log entry added:", logEntry.id, "Total logs:", logs.length);
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

function startMainTimerAlarm() { 
    try {
        chrome.alarms.create(MAIN_TIMER_ALARM_NAME, { delayInMinutes: 0, periodInMinutes: 1 / 60 }, (alarm) => {
            if (chrome.runtime.lastError) {
                console.error("Error creating main timer alarm:", chrome.runtime.lastError.message);
            }
        });
    } catch (error) {
        console.error("Error in startMainTimerAlarm:", error);
    }
}

function startMainTimer() { 
    if (checkIfOutsideActiveHours()) {
        showNotification(`Timer operational only between ${settings.startTime} and ${settings.endTime}.`);
        if (!timerState.isPaused) { 
            timerState.isPaused = true;
            chrome.alarms.clear(MAIN_TIMER_ALARM_NAME, (wasCleared) => {
                if (chrome.runtime.lastError) {
                    console.error("Error clearing main timer alarm:", chrome.runtime.lastError.message);
                }
            });
            stopCurrentDistractionTracking(true);
        }
        broadcastState();
        return;
    }

    if (timerState.isPaused && !timerState.isAdHocTimeoutActive) { // Removed pendingChoice check for revert
        timerState.isPaused = false;
        timerState.showSessionSummary = false; 

        // Standard initialization for any session start (WORK or BREAK)
        timerState.currentSessionActualStartTime = Date.now(); 

        // If this is the very start of a new WORK cycle
        if (timerState.currentSessionType === 'WORK' && timerState.currentTime === settings.userSetWorkDuration) {
            // Reset all session-specific state and snooze tracking
            timerState.currentWorkSessionDistractions = {};
            timerState.adHocTimeoutCountThisSession = 0; 
            timerState.totalAdHocTimeoutDurationThisSession = 0;
            timerState.currentWorkSessionSnoozeCount = 0;
            timerState.currentWorkSessionTotalSnoozeSeconds = 0;
            timerState.isSnoozeSession = false;
            timerState.isSnoozeSession = false;
            console.log("New WORK cycle segment started. Initializing session aggregates.");
        }
        
        startMainTimerAlarm();
        handleTabActivity(); 
        broadcastState();
    }
}

function pauseMainTimer() { // For explicit pause of WORK session
    if (!timerState.isPaused && !timerState.isAdHocTimeoutActive && timerState.currentSessionType === 'WORK') {
        timerState.isPaused = true;
        chrome.alarms.clear(MAIN_TIMER_ALARM_NAME, (wasCleared) => {
            if (chrome.runtime.lastError) {
                console.error("Error clearing main timer alarm during pause:", chrome.runtime.lastError.message);
            }
        });
        stopCurrentDistractionTracking(true); 
        console.log(`${timerState.currentSessionType} timer explicitly paused.`);
        broadcastState();
    }
}

function resetPomodoroCycle() {
    try {
        chrome.alarms.clear(MAIN_TIMER_ALARM_NAME, (wasCleared) => {
            if (chrome.runtime.lastError) {
                console.error("Error clearing main timer alarm:", chrome.runtime.lastError.message);
            }
        });
        timerState.isPaused = true;
        timerState.currentSessionType = 'WORK';
        timerState.currentTime = settings.userSetWorkDuration; 
        timerState.pomodorosCompletedThisCycle = 0;
        
        stopCurrentDistractionTracking(false); 
        timerState.currentWorkSessionDistractions = {};
        timerState.currentlyTrackedDistractingSite = null;
        timerState.isAdHocTimeoutActive = false; 
        timerState.currentAdHocTimeoutTime = 0; 
        timerState.adHocTimeoutStartTime = 0;    
        timerState.adHocTimeoutCountThisSession = 0; 
        timerState.totalAdHocTimeoutDurationThisSession = 0; 
        
        // Reset snooze fields to default
        timerState.pendingChoiceAfterWork = false;
        timerState.currentWorkSessionInitialStartTime = 0;
        timerState.currentWorkSessionPlannedDuration = settings.userSetWorkDuration;
        timerState.currentWorkSessionSnoozeCount = 0;
        timerState.currentWorkSessionTotalSnoozeSeconds = 0;

        timerState.showSessionSummary = false;
        checkIfOutsideActiveHours(); 
        console.log("Cycle reset.");
        chrome.storage.local.set({ pomodorosCompletedThisCycle: 0 }, () => {
            if (chrome.runtime.lastError) {
                console.error("Error saving pomodoros completed count:", chrome.runtime.lastError.message);
            }
        });
        broadcastState();
        clearPersistedCurrentTime(); // Clear saved currentTime when cycle is reset
    } catch (error) {
        console.error("Error in resetPomodoroCycle:", error);
    }
}

function generateSessionSummary() { // Simplified pre-snooze version
    let totalDistractionsThisWorkCycle = 0;
    if (timerState.currentWorkSessionDistractions && typeof timerState.currentWorkSessionDistractions === 'object') {
        Object.values(timerState.currentWorkSessionDistractions).forEach(time => totalDistractionsThisWorkCycle += time);
    }

    if (timerState.adHocTimeoutCountThisSession === 0 && totalDistractionsThisWorkCycle === 0) {
        timerState.sessionSummaryText = "Focus session completed uninterrupted! Great job!";
    } else {
        let summary = "Focus session complete!";
        if (timerState.adHocTimeoutCountThisSession > 0) {
            summary += ` ${timerState.adHocTimeoutCountThisSession} timeout(s) totaling ${Math.floor(timerState.totalAdHocTimeoutDurationThisSession/60)}m.`;
        }
        if (totalDistractionsThisWorkCycle > 0) {
            summary += ` Distraction time: ${Math.floor(totalDistractionsThisWorkCycle/60)}m.`;
        }
        timerState.sessionSummaryText = summary;
    }
    timerState.showSessionSummary = true;
}

function advanceToNextSession() { // Reverted to pre-snooze logic
  timerState.isPaused = true; 
  chrome.alarms.clear(MAIN_TIMER_ALARM_NAME, (wasCleared) => {
      if (chrome.runtime.lastError) {
          console.error("Error clearing main timer alarm during session advance:", chrome.runtime.lastError.message);
      }
  });
  let notificationMessage = "";
  const sessionEndTime = Date.now();
  let plannedDuration;

    if (timerState.currentSessionType === 'WORK') {
        plannedDuration = settings.userSetWorkDuration;
        stopCurrentDistractionTracking(true); // Finalize distraction tracking for this WORK session
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
            distractions: { ...timerState.currentWorkSessionDistractions },
            isSnoozeSession: timerState.isSnoozeSession
        });
        generateSessionSummary(); 
        // Only increment if this wasn't a snooze session
        if (!timerState.isSnoozeSession) {
            timerState.pomodorosCompletedThisCycle++;
            chrome.storage.local.set({ pomodorosCompletedThisCycle: timerState.pomodorosCompletedThisCycle }, () => {
                if (chrome.runtime.lastError) {
                    console.error("Error saving pomodoros completed count:", chrome.runtime.lastError.message);
                }
            });
        }
        // Reset the snooze session flag
        timerState.isSnoozeSession = false;
        notificationMessage = "Focus session complete! Time for a break.";     if (timerState.pomodorosCompletedThisCycle >= settings.pomodorosUntilLongBreak) { 
      timerState.currentSessionType = 'LONG_BREAK';
      timerState.currentTime = settings.longBreakDuration; 
      timerState.pomodorosCompletedThisCycle = 0; 
      chrome.storage.local.set({ pomodorosCompletedThisCycle: 0 }, () => {
          if (chrome.runtime.lastError) {
              console.error("Error resetting pomodoros completed count:", chrome.runtime.lastError.message);
          }
      }); 
    } else {
      timerState.currentSessionType = 'SHORT_BREAK';
      timerState.currentTime = settings.shortBreakDuration; 
    }
    // Reset session-specific accumulators for the next WORK session
    timerState.currentWorkSessionDistractions = {};
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
        actualDuration: Math.floor((sessionEndTime - timerState.currentSessionActualStartTime) / 1000)
    });

    if (checkIfOutsideActiveHours()) {
        showNotification("Scheduled active time has ended. Next focus session will start on the next active day.");
        timerState.showSessionSummary = false; 
        broadcastState();
        return;
    }
    notificationMessage = "Break's over! Time to focus."; 
    timerState.currentSessionType = 'WORK';
    timerState.currentTime = settings.userSetWorkDuration; 
    timerState.showSessionSummary = false;
    timerState.isSnoozeSession = false; 
  }

  showNotification(notificationMessage);
  clearPersistedCurrentTime(); // Clear saved currentTime when session ends
  broadcastState(); 
}

function startAdHocTimeout() { 
    if (checkIfOutsideActiveHours()) {
        console.log("Cannot take timeout outside active hours.");
        return;
    }
    if (timerState.currentSessionType === 'WORK' && !timerState.isAdHocTimeoutActive && !timerState.isPaused) { 
        timerState.isPaused = true; 
        chrome.alarms.clear(MAIN_TIMER_ALARM_NAME, (wasCleared) => {
            if (chrome.runtime.lastError) {
                console.error("Error clearing main timer alarm during ad-hoc timeout:", chrome.runtime.lastError.message);
            }
        }); 
        stopCurrentDistractionTracking(true); 
        
        timerState.isAdHocTimeoutActive = true; 
        timerState.adHocTimeoutStartTime = Date.now(); 
        timerState.currentAdHocTimeoutTime = 0; 
        timerState.showSessionSummary = false; 
        persistCurrentTime(); // Save currentTime when timeout starts
        console.log("Ad-hoc timeout started. Main timer paused."); 
        broadcastState();
    }
}

function finishAdHocTimeoutAndResume() { 
    if (timerState.isAdHocTimeoutActive) { 
        const adhocEndTime = Date.now();
        const timeoutDurationInstance = Math.floor((adhocEndTime - timerState.adHocTimeoutStartTime) / 1000); 
        
        if (timeoutDurationInstance > 0) { 
            timerState.adHocTimeoutCountThisSession++; 
            timerState.totalAdHocTimeoutDurationThisSession += timeoutDurationInstance; 
        }
        
        console.log(`Ad-hoc timeout finished. Duration: ${timeoutDurationInstance}s. Total for WORK session: ${timerState.totalAdHocTimeoutDurationThisSession}s`); 
        
        timerState.isAdHocTimeoutActive = false; 
        timerState.adHocTimeoutStartTime = 0; 
        timerState.currentAdHocTimeoutTime = 0;
    
        if (checkIfOutsideActiveHours()) {
            showNotification("Scheduled active time has ended. Timer will remain paused.");
        } else {
            timerState.isPaused = false; 
            startMainTimerAlarm(); 
            handleTabActivity(); 
        }
        persistCurrentTime(); // Save currentTime when timeout ends
        broadcastState();
    }
}

function createOrUpdateDailyScheduler() {
    if (settings.startTime) {
        const [hours, minutes] = settings.startTime.split(':').map(Number);
        const now = new Date();
        let nextRun = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0, 0);
        if (nextRun.getTime() < now.getTime()) { 
            nextRun.setDate(nextRun.getDate() + 1); 
        }
        chrome.alarms.create(DAILY_SCHEDULER_ALARM_NAME, {
            when: nextRun.getTime(),
            periodInMinutes: 24 * 60 
        });
    } else {
        chrome.alarms.clear(DAILY_SCHEDULER_ALARM_NAME);
    }
}

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === MAIN_TIMER_ALARM_NAME) {
        if (checkIfOutsideActiveHours()) {
            console.log("Main timer alarm fired, but now outside active hours. Stopping timer.");
            showNotification("Active schedule ended. Timer stopped.");
            timerState.isPaused = true;
            timerState.isOutsideActiveHours = true; 
            chrome.alarms.clear(MAIN_TIMER_ALARM_NAME, (wasCleared) => {
                if (chrome.runtime.lastError) {
                    console.error("Error clearing main timer alarm during schedule end:", chrome.runtime.lastError.message);
                }
            });
            stopCurrentDistractionTracking(true);
            
            if (timerState.currentSessionType === 'WORK') { // No pendingChoiceAfterWork check in this reverted version
                const prematureEndTime = Date.now();
                addLogEntry({
                    id: `${timerState.currentSessionActualStartTime}_WORK_INCOMPLETE`,
                    type: 'WORK_INCOMPLETE',
                    date: getFormattedDate(timerState.currentSessionActualStartTime),
                    startTime: timerState.currentSessionActualStartTime,
                    endTime: prematureEndTime,
                    plannedDuration: settings.userSetWorkDuration, // Use setting directly
                    actualDuration: Math.floor((prematureEndTime - timerState.currentSessionActualStartTime)/1000) - timerState.totalAdHocTimeoutDurationThisSession,
                    distractions: { ...timerState.currentWorkSessionDistractions },
                    adHocTimeoutCount: timerState.adHocTimeoutCountThisSession,
                    totalAdHocTimeoutDuration: timerState.totalAdHocTimeoutDurationThisSession,
                    notes: "Session ended due to schedule end."
                });
                timerState.currentWorkSessionDistractions = {};
                timerState.adHocTimeoutCountThisSession = 0;
                timerState.totalAdHocTimeoutDurationThisSession = 0;
            }
            broadcastState();
            return;
        }

        if (!timerState.isPaused && !timerState.isAdHocTimeoutActive) { 
            if (timerState.currentTime > 0) {
                timerState.currentTime--;
                persistCurrentTime(); // Save currentTime on every tick
                broadcastState();
            } else { 
                advanceToNextSession(); // Directly advance, no pending choice
            }
        }
    } else if (alarm.name === DAILY_SCHEDULER_ALARM_NAME) {
        console.log("Daily scheduler alarm triggered.");
        checkIfOutsideActiveHours(); 
        if (!timerState.isOutsideActiveHours && timerState.isPaused) { // No pendingChoice check
            showNotification(`It's ${settings.startTime}! Time to start your NeuroFocus sessions.`);
        }
        broadcastState(); 
    }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    let responseSent = false;
    switch (request.type) {
        case 'GET_TIMER_STATE':
            checkIfOutsideActiveHours(); 
            if (timerState.isAdHocTimeoutActive && timerState.adHocTimeoutStartTime > 0) { 
                timerState.currentAdHocTimeoutTime = Math.floor((Date.now() - timerState.adHocTimeoutStartTime) / 1000); 
            }
            // No nextBreakType needed in this reverted version's stateToSend
            sendResponse({ ...timerState, settings: { ...settings } }); 
            responseSent = true;
            break;
        case 'MAIN_ACTION_CLICK':
            // No pendingChoiceAfterWork check needed here
            checkIfOutsideActiveHours(); 
            if (timerState.isAdHocTimeoutActive) { 
                finishAdHocTimeoutAndResume(); 
            } else if (timerState.isPaused) { 
                startMainTimer(); 
            } else if (timerState.currentSessionType === 'WORK' && !timerState.isPaused) { 
                startAdHocTimeout(); 
            } else if (timerState.currentSessionType !== 'WORK' && !timerState.isPaused) { 
                pauseMainTimer(); 
            }
            sendResponse({status: "Action processed"});
            responseSent = true;
            break;
        case 'REQUEST_SNOOZE':
            // Only allow snooze if last session was WORK and just ended (i.e., before break starts)
            if ((timerState.currentSessionType === 'SHORT_BREAK' || timerState.currentSessionType === 'LONG_BREAK') && timerState.showSessionSummary) {
                // This is a snooze - treat as extension of previous work session
                timerState.currentSessionType = 'WORK';
                timerState.currentTime = 10 * 60; // 10 minutes
                timerState.isPaused = false; // Automatically start the timer
                timerState.showSessionSummary = false;
                timerState.sessionSummaryText = '';
                timerState.isSnoozeSession = true; // Mark this as a snooze session
                // Update snooze tracking stats
                timerState.currentWorkSessionSnoozeCount = (timerState.currentWorkSessionSnoozeCount || 0) + 1;
                timerState.currentWorkSessionTotalSnoozeSeconds = (timerState.currentWorkSessionTotalSnoozeSeconds || 0) + 600;
                
                // For snooze, use same session start time to treat as extension
                timerState.currentSessionActualStartTime = Date.now();
                // Keep previous distractions and timeout counts as it's the same session
                
                // Start the timer alarm and distraction tracking
                startMainTimerAlarm();
                handleTabActivity();
                
                // Decrement pomodoro count since we're extending previous session
                if (timerState.pomodorosCompletedThisCycle > 0) {
                    timerState.pomodorosCompletedThisCycle--;
                    chrome.storage.local.set({ pomodorosCompletedThisCycle: timerState.pomodorosCompletedThisCycle });
                }
                
                showNotification("Snooze activated! Focus session extended by 10 minutes.");
                broadcastState();
            }
            sendResponse({status: "Snooze processed"});
            responseSent = true;
            break;
        case 'RESET_CYCLE':
            resetPomodoroCycle(); 
            sendResponse({status: "Cycle reset"});
            responseSent = true;
            break;
        case 'UPDATE_WORK_DURATION': 
            const newWorkDur = request.userSetWorkDuration;
            if (newWorkDur && newWorkDur > 0) {
                settings.userSetWorkDuration = newWorkDur;
                if (timerState.isPaused && timerState.currentSessionType === 'WORK' && 
                    (timerState.currentTime === settings.userSetWorkDuration)) { // Simpler check
                  timerState.currentTime = newWorkDur;
                }
                chrome.storage.local.set({ userSetWorkDuration: newWorkDur }, () => {
                    if (chrome.runtime.lastError) {
                        console.error("Error saving work duration:", chrome.runtime.lastError.message);
                    } else {
                        broadcastState();
                    }
                });
            }
            sendResponse({status: "Work duration updated"});
            responseSent = true;
            break;


        default:
            console.warn("Unknown message type received:", request.type);
            return false; 
    }
    return responseSent; // Return true only if we sent a response
});

// --- Distraction Tracking Logic (remains largely the same) ---
function getHostname(url) {
    if (!url) return null;
    try { return new URL(url).hostname; } catch (e) { return null; }
}

function stopCurrentDistractionTracking(logToConsole = false) {
    if (timerState.currentlyTrackedDistractingSite) {
        const durationSeconds = Math.floor((Date.now() - timerState.currentlyTrackedDistractingSite.startTime) / 1000);
        const siteHostname = timerState.currentlyTrackedDistractingSite.hostname;
        if (durationSeconds > 0) {
            if (typeof timerState.currentWorkSessionDistractions !== 'object' || timerState.currentWorkSessionDistractions === null) {
                timerState.currentWorkSessionDistractions = {};
            }
            timerState.currentWorkSessionDistractions[siteHostname] = (timerState.currentWorkSessionDistractions[siteHostname] || 0) + durationSeconds;
        }
        timerState.currentlyTrackedDistractingSite = null;
    }
}

function startDistractionTracking(hostname) {
    if (timerState.currentlyTrackedDistractingSite && timerState.currentlyTrackedDistractingSite.hostname !== hostname) {
        stopCurrentDistractionTracking(true); 
    }
    if (!timerState.currentlyTrackedDistractingSite || timerState.currentlyTrackedDistractingSite.hostname !== hostname) {
        timerState.currentlyTrackedDistractingSite = { hostname: hostname, startTime: Date.now() };
    }
}

async function handleTabActivity() {
    if (timerState.currentSessionType !== 'WORK' || timerState.isPaused || timerState.isAdHocTimeoutActive || timerState.isOutsideActiveHours) { // Removed pendingChoice check
        if (timerState.currentlyTrackedDistractingSite) {
            stopCurrentDistractionTracking(true);
        }
        return;
    }
    try {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!activeTab || !activeTab.url) {
            if (timerState.currentlyTrackedDistractingSite) stopCurrentDistractionTracking(true);
            return;
        }
        const currentHostname = getHostname(activeTab.url);
        if (DISTRACTING_SITES.includes(currentHostname)) {
            if (!timerState.currentlyTrackedDistractingSite || timerState.currentlyTrackedDistractingSite.hostname !== currentHostname) {
                startDistractionTracking(currentHostname);
            }
        } else {
            if (timerState.currentlyTrackedDistractingSite) stopCurrentDistractionTracking(true);
        }
    } catch (error) {
        console.error("Error in handleTabActivity:", error);
        if (timerState.currentlyTrackedDistractingSite) stopCurrentDistractionTracking(false); 
    }
}

chrome.tabs.onActivated.addListener(activeInfo => { handleTabActivity(); });
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (tab.active && (changeInfo.url || changeInfo.status === 'complete')) handleTabActivity();
});
chrome.windows.onFocusChanged.addListener(windowId => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) {
        if (timerState.currentlyTrackedDistractingSite) stopCurrentDistractionTracking(true);
    } else {
        handleTabActivity();
    }
});

// --- Extension Lifecycle ---
chrome.runtime.onInstalled.addListener((details) => {
    console.log("Extension lifecycle: onInstalled - ", details.reason);
    loadSettingsAndInitializeState(() => { 
        if (details.reason === "install") {
            showNotification("NeuroFocus Timer installed! Configure your schedule in Options.");
            saveSettingsToStorage(settings);
        }
        // Don't broadcast state during initialization - popup will request it when needed
    });
});

chrome.runtime.onStartup.addListener(() => {
    console.log("Extension lifecycle: onStartup");
    loadSettingsAndInitializeState(() => { 
        chrome.alarms.clear(MAIN_TIMER_ALARM_NAME, (wasCleared) => {
            if (chrome.runtime.lastError) {
                console.error("Error clearing main timer alarm on startup:", chrome.runtime.lastError.message);
            }
        }); 
        // Don't broadcast state during initialization - popup will request it when needed
    });
});

// Listen for changes in chrome.storage and reload settings if relevant keys change
chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local') {
        const relevantKeys = [
            'startTime', 'endTime', 'userSetWorkDuration', 'shortBreakDuration',
            'longBreakDuration', 'pomodorosUntilLongBreak', 'distractingSites'
        ];
        if (Object.keys(changes).some(key => relevantKeys.includes(key))) {
            console.log("Detected settings change in storage, reloading settings...");
            loadSettingsAndInitializeState(() => {
                broadcastState();
            });
        }
    }
});

// --- Context Menu Setup ---
function createContextMenus() {
    // Remove existing context menus to avoid duplicates
    chrome.contextMenus.removeAll(() => {
        // Create the main context menu item
        chrome.contextMenus.create({
            id: "openNeuroFocusTimer",
            title: "NeuroFocusTimer",
            contexts: ["page", "selection", "link"]
        }, () => {
            if (chrome.runtime.lastError) {
                console.error("Error creating context menu:", chrome.runtime.lastError.message);
            } else {
                console.log("Context menu created successfully");
            }
        });
    });
}

// Context menu click handler
chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "openNeuroFocusTimer") {
        console.log("Context menu: NeuroFocusTimer clicked");
        // Open the popup by programmatically clicking the extension icon
        chrome.action.openPopup();
    }
});

loadSettingsAndInitializeState(() => {
    console.log("Background script initialized successfully.");
    createContextMenus();
});
console.log("Background script loaded (reverted pre-snooze version).");
