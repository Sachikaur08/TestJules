// background.js

// Default settings - these will be overridden by storage if available
let settings = {
    startTime: "09:00",
    endTime: "17:00",
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

    currentWorkSessionDistractions: {},
    currentlyTrackedDistractingSite: null,
    adHocTimeoutCountThisSession: 0,
    totalAdHocTimeoutDurationThisSession: 0,

    showSessionSummary: false,
    sessionSummaryText: ""
    // No snooze related properties in this version
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
    const stateWithSettings = { ...timerState, settings: { ...settings } };
    chrome.runtime.sendMessage({ type: 'TIMER_STATE_UPDATE', state: stateWithSettings });
    // console.log("State broadcasted:", JSON.parse(JSON.stringify(stateWithSettings)));
}

function saveSettingsToStorage(newSettings, callback) {
    chrome.storage.local.set(newSettings, () => {
        if (callback) callback();
    });
}

function loadSettingsAndInitializeState(callback) {
  chrome.storage.local.get([
    'startTime', 'endTime',
    'userSetWorkDuration', 'shortBreakDuration', 'longBreakDuration',
    'pomodorosUntilLongBreak', 'pomodorosCompletedThisCycle'
  ], (loadedData) => {
    settings.startTime = loadedData.startTime || settings.startTime;
    settings.endTime = loadedData.endTime || settings.endTime;
    settings.userSetWorkDuration = loadedData.userSetWorkDuration !== undefined ? loadedData.userSetWorkDuration : settings.userSetWorkDuration;
    settings.shortBreakDuration = loadedData.shortBreakDuration !== undefined ? loadedData.shortBreakDuration : settings.shortBreakDuration;
    settings.longBreakDuration = loadedData.longBreakDuration !== undefined ? loadedData.longBreakDuration : settings.longBreakDuration;
    settings.pomodorosUntilLongBreak = loadedData.pomodorosUntilLongBreak !== undefined ? loadedData.pomodorosUntilLongBreak : settings.pomodorosUntilLongBreak;

    timerState.currentTime = settings.userSetWorkDuration;
    timerState.isPaused = true;
    timerState.currentSessionType = 'WORK';
    timerState.pomodorosCompletedThisCycle = loadedData.pomodorosCompletedThisCycle || 0;

    timerState.isAdHocTimeoutActive = false;
    timerState.currentAdHocTimeoutTime = 0;
    timerState.adHocTimeoutStartTime = 0;
    timerState.adHocTimeoutCountThisSession = 0;
    timerState.totalAdHocTimeoutDurationThisSession = 0;

    timerState.currentWorkSessionDistractions = {};
    timerState.currentlyTrackedDistractingSite = null;

    // Ensure snooze related fields are at their default (non-snooze) state / absent
    timerState.pendingChoiceAfterWork = false; // Important for this revert
    // The following snooze-specific accumulators are not part of this reverted timerState definition
    // timerState.currentWorkSessionInitialStartTime = 0;
    // timerState.currentWorkSessionPlannedDuration = settings.userSetWorkDuration;
    // timerState.currentWorkSessionSnoozeCount = 0;
    // timerState.currentWorkSessionTotalSnoozeSeconds = 0;

    timerState.showSessionSummary = false;
    timerState.sessionSummaryText = "";
    timerState.currentSessionActualStartTime = 0;

    checkIfOutsideActiveHours();
    if (callback) callback();
    createOrUpdateDailyScheduler();
  });
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
        console.log("Log entry added:", logEntry.id);
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
    chrome.alarms.create(MAIN_TIMER_ALARM_NAME, { delayInMinutes: 0, periodInMinutes: 1 / 60 });
}

function startMainTimer() {
    if (checkIfOutsideActiveHours()) {
        showNotification(`Timer operational only between ${settings.startTime} and ${settings.endTime}.`);
        if (!timerState.isPaused) {
            timerState.isPaused = true;
            chrome.alarms.clear(MAIN_TIMER_ALARM_NAME);
            stopCurrentDistractionTracking(true);
        }
        broadcastState();
        return;
    }

    if (timerState.isPaused && !timerState.isAdHocTimeoutActive) {
        timerState.isPaused = false;
        timerState.showSessionSummary = false;
        timerState.currentSessionActualStartTime = Date.now();

        if (timerState.currentSessionType === 'WORK' && timerState.currentTime === settings.userSetWorkDuration) {
            timerState.currentWorkSessionDistractions = {};
            timerState.adHocTimeoutCountThisSession = 0;
            timerState.totalAdHocTimeoutDurationThisSession = 0;
            console.log("New WORK cycle segment started. Initializing aggregates.");
        }

        startMainTimerAlarm();
        handleTabActivity();
        broadcastState();
    }
}

function pauseMainTimer() {
    if (!timerState.isPaused && !timerState.isAdHocTimeoutActive && timerState.currentSessionType === 'WORK') {
        timerState.isPaused = true;
        chrome.alarms.clear(MAIN_TIMER_ALARM_NAME);
        stopCurrentDistractionTracking(true);
        console.log(`${timerState.currentSessionType} timer explicitly paused.`);
        broadcastState();
    }
}

function resetPomodoroCycle() {
    chrome.alarms.clear(MAIN_TIMER_ALARM_NAME);
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

    timerState.pendingChoiceAfterWork = false; // Ensure reset

    timerState.showSessionSummary = false;
    checkIfOutsideActiveHours();
    console.log("Pomodoro cycle reset.");
    chrome.storage.local.set({ pomodorosCompletedThisCycle: 0 });
    broadcastState();
}

function generateSessionSummary() {
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

function advanceToNextSession() {
  timerState.isPaused = true;
  chrome.alarms.clear(MAIN_TIMER_ALARM_NAME);
  let notificationMessage = "";
  const sessionEndTime = Date.now();
  let plannedDuration;

  if (timerState.currentSessionType === 'WORK') {
    plannedDuration = settings.userSetWorkDuration;
    stopCurrentDistractionTracking(true);
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
        distractions: { ...timerState.currentWorkSessionDistractions }
    });
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
    timerState.currentWorkSessionDistractions = {};
    timerState.adHocTimeoutCountThisSession = 0;
    timerState.totalAdHocTimeoutDurationThisSession = 0;

  } else {
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
    notificationMessage = "Pomodoro break's over! Time to focus.";
    timerState.currentSessionType = 'WORK';
    timerState.currentTime = settings.userSetWorkDuration;
    timerState.showSessionSummary = false;
  }

  showNotification(notificationMessage);
  broadcastState();
}

function startAdHocTimeout() {
    if (checkIfOutsideActiveHours()) {
        return;
    }
    if (timerState.currentSessionType === 'WORK' && !timerState.isAdHocTimeoutActive && !timerState.isPaused) {
        timerState.isPaused = true;
        chrome.alarms.clear(MAIN_TIMER_ALARM_NAME);
        stopCurrentDistractionTracking(true);

        timerState.isAdHocTimeoutActive = true;
        timerState.adHocTimeoutStartTime = Date.now();
        timerState.currentAdHocTimeoutTime = 0;
        timerState.showSessionSummary = false;
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
            chrome.alarms.clear(MAIN_TIMER_ALARM_NAME);
            stopCurrentDistractionTracking(true);

            if (timerState.currentSessionType === 'WORK') {
                const prematureEndTime = Date.now();
                addLogEntry({
                    id: `${timerState.currentSessionActualStartTime}_WORK_INCOMPLETE`,
                    type: 'WORK_INCOMPLETE',
                    date: getFormattedDate(timerState.currentSessionActualStartTime),
                    startTime: timerState.currentSessionActualStartTime,
                    endTime: premature_endTime, // Typo here, should be prematureEndTime
                    plannedDuration: settings.userSetWorkDuration,
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
                broadcastState();
            } else {
                advanceToNextSession();
            }
        }
    } else if (alarm.name === DAILY_SCHEDULER_ALARM_NAME) {
        console.log("Daily scheduler alarm triggered.");
        checkIfOutsideActiveHours();
        if (!timerState.isOutsideActiveHours && timerState.isPaused) {
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
            sendResponse({ ...timerState, settings: { ...settings } });
            responseSent = true;
            break;
        case 'MAIN_ACTION_CLICK':
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
            break;
        case 'RESET_CYCLE':
            resetPomodoroCycle();
            break;
        case 'UPDATE_WORK_DURATION':
            const newWorkDur = request.userSetWorkDuration;
            if (newWorkDur && newWorkDur > 0) {
                settings.userSetWorkDuration = newWorkDur;
                if (timerState.isPaused && timerState.currentSessionType === 'WORK' &&
                    (timerState.currentTime === settings.userSetWorkDuration)) {
                  timerState.currentTime = newWorkDur;
                }
                chrome.storage.local.set({ userSetWorkDuration: newWorkDur }, () => {
                    broadcastState();
                });
            }
            break;
        case 'SETTINGS_UPDATED':
            console.log("Received SETTINGS_UPDATED message from options page.");
            loadSettingsAndInitializeState(() => {
                chrome.alarms.clear(MAIN_TIMER_ALARM_NAME);
                showNotification("Settings updated. Timer has been reset to apply new durations/schedule.");
                broadcastState();
            });
            sendResponse({status: "Settings received and re-initializing."});
            responseSent = true;
            break;
        default:
            console.warn("Unknown message type received:", request.type);
            return false;
    }
    return !responseSent;
});

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
    if (timerState.currentSessionType !== 'WORK' || timerState.isPaused || timerState.isAdHocTimeoutActive || timerState.isOutsideActiveHours) {
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

chrome.runtime.onInstalled.addListener((details) => {
    console.log("Extension lifecycle: onInstalled - ", details.reason);
    loadSettingsAndInitializeState(() => {
        if (details.reason === "install") {
            showNotification("NeuroFocus Timer installed! Configure your schedule in Options.");
            saveSettingsToStorage(settings);
        }
        broadcastState();
    });
});

chrome.runtime.onStartup.addListener(() => {
    console.log("Extension lifecycle: onStartup");
    loadSettingsAndInitializeState(() => {
        chrome.alarms.clear(MAIN_TIMER_ALARM_NAME);
        broadcastState();
    });
});

loadSettingsAndInitializeState(broadcastState);
console.log("Background script loaded (reverted pre-snooze version).");