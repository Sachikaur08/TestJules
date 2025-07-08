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
  let currentLocalAdhocTimeoutTime = 0; // To display ad-hoc timeout time smoothly

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
    console.log("Popup received state for UI update:", state);

    // Update displays
    updateMainTimerDisplay(state.currentTime);
    statusMessage.textContent = getStatusMessage(state);
    workDurationInput.value = state.userSetWorkDuration / 60;

    // Main Action Button: Text, Class, Disabled status
    mainActionButton.className = 'main-action-button'; // Reset classes

    if (state.isOutsideActiveHours) {
        mainActionButton.textContent = 'Outside Schedule';
        mainActionButton.classList.add('disabled');
        mainActionButton.disabled = true;
        statusMessage.textContent = `Scheduled: ${state.settings?.startTime || 'N/A'} - ${state.settings?.endTime || 'N/A'}`;
        adhocTimeoutTimerDisplay.style.display = 'none';
        if (localAdhocTimeoutInterval) clearInterval(localAdhocTimeoutInterval);
        localAdhocTimeoutInterval = null;
        setDurationButton.disabled = true; // Disable duration setting from popup if outside hours
        resetButton.disabled = true; // Also disable reset if outside hours
    } else if (state.isAdHocTimeoutActive) { 
      mainActionButton.textContent = 'Finish Timeout'; 
      mainActionButton.classList.add('finish-timeout'); 
      mainActionButton.disabled = false;
      adhocTimeoutTimerDisplay.style.display = 'block';
      if (!localAdhocTimeoutInterval) { 
        currentLocalAdhocTimeoutTime = state.currentAdHocTimeoutTime || 0; 
        updateAdhocTimeoutTimerDisplay(currentLocalAdhocTimeoutTime);
        localAdhocTimeoutInterval = setInterval(() => {
          currentLocalAdhocTimeoutTime++;
          updateAdhocTimeoutTimerDisplay(currentLocalAdhocTimeoutTime);
        }, 1000);
      }
      setDurationButton.disabled = true; // Cannot change duration during timeout
      resetButton.disabled = true; // Cannot reset during timeout
    } else if (state.currentSessionType === 'WORK' && !state.isPaused) {
      mainActionButton.textContent = 'Take a Timeout'; 
      mainActionButton.classList.add('take-timeout'); 
      mainActionButton.disabled = false;
      adhocTimeoutTimerDisplay.style.display = 'none';
      if (localAdhocTimeoutInterval) clearInterval(localAdhocTimeoutInterval);
      localAdhocTimeoutInterval = null;
      setDurationButton.disabled = true; // Cannot change duration while work session is running
      resetButton.disabled = false;
    } else if (state.isPaused) { 
      // Determine appropriate text for "Start/Resume" based on session type
      if (state.currentSessionType === 'WORK') {
        mainActionButton.textContent = (state.currentTime === (state.settings?.userSetWorkDuration)) ? 'Start Focus' : 'Resume Focus';
      } else if (state.currentSessionType === 'SHORT_BREAK') {
        mainActionButton.textContent = 'Start Short Break';
      } else if (state.currentSessionType === 'LONG_BREAK') {
        mainActionButton.textContent = 'Start Long Break';
      } else {
         mainActionButton.textContent = 'Start'; // Generic fallback
      }
      mainActionButton.classList.add('start');
      mainActionButton.disabled = false;
      adhocTimeoutTimerDisplay.style.display = 'none';
      if (localAdhocTimeoutInterval) clearInterval(localAdhocTimeoutInterval);
      localAdhocTimeoutInterval = null;
      // Allow setting duration only if it's a work session that's fully reset or at the very start
      setDurationButton.disabled = !(state.currentSessionType === 'WORK' && state.currentTime === (state.settings?.userSetWorkDuration));
      resetButton.disabled = false;
    } else { // Default for non-WORK sessions that are running (e.g. Pomodoro breaks)
      mainActionButton.textContent = 'Break in Progress';
      mainActionButton.classList.add('disabled'); 
      mainActionButton.disabled = true; 
      adhocTimeoutTimerDisplay.style.display = 'none';
      if (localAdhocTimeoutInterval) clearInterval(localAdhocTimeoutInterval);
      localAdhocTimeoutInterval = null;
      setDurationButton.disabled = true;
      resetButton.disabled = false; // Allow resetting even during a running Pomodoro break
    }
    
    // This logic for disabling reset/set duration might be redundant if covered above, but keep for now.
    // Reset button is disabled if an ad-hoc timeout is active
    // resetButton.disabled = state.isAdHocTimeoutActive; 
    // Set duration button is disabled if timer is running or ad-hoc timeout active
    // setDurationButton.disabled = (!state.isPaused && state.currentSessionType === 'WORK') || state.isAdHocTimeoutActive;


    // Manage local interval for main timer display (smooth countdown)
    if (localMainTimerInterval) clearInterval(localMainTimerInterval);
    if (!state.isPaused && !state.isAdHocTimeoutActive) { // Updated variable name
      let displayTime = state.currentTime; // Use state's time as authoritative start
      updateMainTimerDisplay(displayTime); // Update immediately
      localMainTimerInterval = setInterval(() => {
        if (displayTime > 0) {
          displayTime--;
          updateMainTimerDisplay(displayTime);
        } else {
          clearInterval(localMainTimerInterval);
          localMainTimerInterval = null;
          // Rely on background state update for session change
        }
      }, 1000);
    }

    // Session Summary Display
    if (state.showSessionSummary) {
        sessionSummaryDisplay.textContent = state.sessionSummaryText;
        sessionSummaryDisplay.style.display = 'block';
    } else {
        sessionSummaryDisplay.style.display = 'none';
    }
  }

  function getStatusMessage(state) {
    if (state.isOutsideActiveHours && state.settings) { // Check settings exist
        return `Scheduled: ${state.settings.startTime} - ${state.settings.endTime}`;
    }
    if (state.isAdHocTimeoutActive) return "Timeout Active";
    switch (state.currentSessionType) {
      case 'WORK':
        // Provide more specific status for WORK session if it's fully reset vs. paused mid-way
        if (state.isPaused && state.currentTime === (state.settings?.userSetWorkDuration)) return "Ready to Focus";
        return state.isPaused ? "Focus Paused" : "Focus Session";
      case 'SHORT_BREAK':
        if (state.isPaused && state.currentTime === (state.settings?.shortBreakDuration)) return "Ready for Short Break";
        return state.isPaused ? "Short Break Paused" : "Short Break";
      case 'LONG_BREAK':
        if (state.isPaused && state.currentTime === (state.settings?.longBreakDuration)) return "Ready for Long Break";
        return state.isPaused ? "Long Break Paused" : "Long Break";
      default:
        return "Ready"; // Should ideally not be reached if currentSessionType is always valid
    }
  }

  // --- Event Listeners ---
  setDurationButton.addEventListener('click', () => {
    const newDurationMinutes = parseInt(workDurationInput.value, 10);
    if (newDurationMinutes > 0) {
      chrome.runtime.sendMessage({
        type: 'UPDATE_WORK_DURATION', // More specific
        userSetWorkDuration: newDurationMinutes * 60,
      });
      // UI will update via broadcast state from background
    }
  });

  mainActionButton.addEventListener('click', () => {
    // The action type is determined by the button's current text/state,
    // but it's simpler to send a generic 'MAIN_ACTION' and let background decide
    // based on its authoritative state.
    chrome.runtime.sendMessage({ type: 'MAIN_ACTION_CLICK' });
    // UI will update via broadcast state from background
  });

  resetButton.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'RESET_CYCLE' });
    // UI will update via broadcast state from background
  });

  // --- Initialization ---
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
        console.warn("No initial state from background.");
        // UI might show loading or default disabled state
      }
    });
  }

  requestInitialState();
});
