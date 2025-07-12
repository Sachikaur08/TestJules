console.log("Popup script loaded.");

document.addEventListener('DOMContentLoaded', function () {
  // --- UI Elements ---
  const timerDisplay = document.getElementById('timer-display');
  const statusMessage = document.getElementById('status-message');
  const workDurationInput = document.getElementById('work-duration');
  const setDurationButton = document.getElementById('set-duration-button');
  const mainActionButton = document.getElementById('main-action-button');
  const resetButton = document.getElementById('reset-button');
  const adhocTimeoutTimerDisplay = document.getElementById('adhoc-timeout-timer-display');
  const sessionSummaryDisplay = document.getElementById('session-summary');

  // --- Local State for UI updates ---
  let localMainTimerInterval = null;
  let localAdhocTimeoutInterval = null;
  let currentLocalAdhocTimeoutTime = 0;

  const DEFAULTS = { // Fallback defaults for UI if settings not in state from background
      userSetWorkDuration: 25 * 60,
      shortBreakDuration: 5 * 60,
      longBreakDuration: 15 * 60
  };

  // --- Utility Functions ---
  function formatTime(totalSeconds) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }

  function updateMainTimerDisplay(currentTime) {
    timerDisplay.textContent = formatTime(currentTime);
  }

  function updateAdhocTimeoutTimerDisplay(timeoutTime) {
    adhocTimeoutTimerDisplay.textContent = `Timeout: ${formatTime(timeoutTime)}`;
  }

  // --- UI Update Logic based on State from Background ---
  function updateUI(state) {
    // console.log("Popup received state for UI update:", state);

    updateMainTimerDisplay(state.currentTime);
    statusMessage.textContent = getStatusMessage(state);
    
    const workDurationForDisplay = state.settings?.userSetWorkDuration || DEFAULTS.userSetWorkDuration;
    workDurationInput.value = workDurationForDisplay / 60;

    mainActionButton.className = 'main-action-button'; 
    mainActionButton.disabled = false;
    resetButton.disabled = false;
    setDurationButton.disabled = false;
    adhocTimeoutTimerDisplay.style.display = 'none';
    if (localAdhocTimeoutInterval) { clearInterval(localAdhocTimeoutInterval); localAdhocTimeoutInterval = null; }

    if (state.isOutsideActiveHours) {
        mainActionButton.textContent = 'Outside Schedule';
        mainActionButton.classList.add('disabled');
        mainActionButton.disabled = true;
        setDurationButton.disabled = true; 
        resetButton.disabled = true; 
    } else if (state.isAdHocTimeoutActive) { 
      mainActionButton.textContent = 'Finish Timeout'; 
      mainActionButton.classList.add('finish-timeout'); 
      adhocTimeoutTimerDisplay.style.display = 'block';
      if (!localAdhocTimeoutInterval) { 
        currentLocalAdhocTimeoutTime = state.currentAdHocTimeoutTime || 0; 
        updateAdhocTimeoutTimerDisplay(currentLocalAdhocTimeoutTime);
        localAdhocTimeoutInterval = setInterval(() => {
          currentLocalAdhocTimeoutTime++;
          updateAdhocTimeoutTimerDisplay(currentLocalAdhocTimeoutTime);
        }, 1000);
      }
      setDurationButton.disabled = true; 
      resetButton.disabled = true; 
    } else if (state.currentSessionType === 'WORK' && !state.isPaused) {
      mainActionButton.textContent = 'Take a Timeout'; 
      mainActionButton.classList.add('take-timeout'); 
      setDurationButton.disabled = true; 
    } else if (state.isPaused) { 
      const currentPlannedDurationForState = 
          state.currentSessionType === 'WORK' ? (state.settings?.userSetWorkDuration || DEFAULTS.userSetWorkDuration) :
          state.currentSessionType === 'SHORT_BREAK' ? (state.settings?.shortBreakDuration || DEFAULTS.shortBreakDuration) :
          state.currentSessionType === 'LONG_BREAK' ? (state.settings?.longBreakDuration || DEFAULTS.longBreakDuration) :
          (state.settings?.userSetWorkDuration || DEFAULTS.userSetWorkDuration);

      if (state.currentSessionType === 'WORK') {
        mainActionButton.textContent = (state.currentTime === currentPlannedDurationForState) ? 'Start Focus' : 'Resume Focus';
      } else if (state.currentSessionType === 'SHORT_BREAK') {
        mainActionButton.textContent = 'Start Short Break';
      } else if (state.currentSessionType === 'LONG_BREAK') {
        mainActionButton.textContent = 'Start Long Break';
      } else {
         mainActionButton.textContent = 'Start'; 
      }
      mainActionButton.classList.add('start');
      setDurationButton.disabled = !(state.currentSessionType === 'WORK' && state.currentTime === currentPlannedDurationForState);
    } else { 
      mainActionButton.textContent = 'Break in Progress';
      mainActionButton.classList.add('disabled'); 
      mainActionButton.disabled = true; 
      setDurationButton.disabled = true;
    }
    
    if (localMainTimerInterval) { clearInterval(localMainTimerInterval); localMainTimerInterval = null; }
    if (!state.isPaused && !state.isAdHocTimeoutActive && !state.isOutsideActiveHours) { 
      let displayTime = state.currentTime; 
      updateMainTimerDisplay(displayTime); 
      localMainTimerInterval = setInterval(() => {
        if (displayTime > 0) {
          displayTime--;
          updateMainTimerDisplay(displayTime);
        } else {
          clearInterval(localMainTimerInterval);
          localMainTimerInterval = null;
        }
      }, 1000);
    }

    if (state.showSessionSummary) {
        sessionSummaryDisplay.textContent = state.sessionSummaryText;
        sessionSummaryDisplay.style.display = 'block';
    } else {
        sessionSummaryDisplay.style.display = 'none';
    }
  }

  function getStatusMessage(state) {
    if (state.isOutsideActiveHours && state.settings) { 
        return `Scheduled: ${state.settings.startTime} - ${state.settings.endTime}`;
    }
    if (state.isAdHocTimeoutActive) return "Timeout Active";
    
    const currentPlannedDurationForState = 
        state.currentSessionType === 'WORK' ? (state.settings?.userSetWorkDuration || DEFAULTS.userSetWorkDuration) :
        state.currentSessionType === 'SHORT_BREAK' ? (state.settings?.shortBreakDuration || DEFAULTS.shortBreakDuration) :
        state.currentSessionType === 'LONG_BREAK' ? (state.settings?.longBreakDuration || DEFAULTS.longBreakDuration) :
        (state.settings?.userSetWorkDuration || DEFAULTS.userSetWorkDuration);

    switch (state.currentSessionType) {
      case 'WORK':
        if (state.isPaused && state.currentTime === currentPlannedDurationForState) return "Ready to Focus";
        return state.isPaused ? "Focus Paused" : "Focus Session";
      case 'SHORT_BREAK':
        if (state.isPaused && state.currentTime === currentPlannedDurationForState) return "Ready for Short Break";
        return state.isPaused ? "Short Break Paused" : "Short Break";
      case 'LONG_BREAK':
        if (state.isPaused && state.currentTime === currentPlannedDurationForState) return "Ready for Long Break";
        return state.isPaused ? "Long Break Paused" : "Long Break";
      default:
        return "Ready"; 
    }
  }

  setDurationButton.addEventListener('click', () => {
    const newDurationMinutes = parseInt(workDurationInput.value, 10);
    if (newDurationMinutes > 0) {
      chrome.runtime.sendMessage({
        type: 'UPDATE_WORK_DURATION', 
        userSetWorkDuration: newDurationMinutes * 60,
      });
    }
  });

  mainActionButton.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'MAIN_ACTION_CLICK' });
  });

  resetButton.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'RESET_CYCLE' });
  });

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'TIMER_STATE_UPDATE') {
      updateUI(request.state);
    }
    return true; 
  });

  function requestInitialState() {
    chrome.runtime.sendMessage({ type: 'GET_TIMER_STATE' }, (response) => {
      if (chrome.runtime.lastError) {
        console.error("Error getting initial state:", chrome.runtime.lastError.message);
        timerDisplay.textContent = "Error";
        statusMessage.textContent = "Cannot load";
        mainActionButton.disabled = true;
        resetButton.disabled = true;
        setDurationButton.disabled = true;
        return;
      }
      if (response) {
        updateUI(response);
      } else {
        // console.warn("No initial state from background.");
      }
    });
  }

  requestInitialState();
});