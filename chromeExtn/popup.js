console.log("Popup script loaded.");

document.addEventListener('DOMContentLoaded', function () {
  // --- UI Elements ---
  const timerDisplay = document.getElementById('timer-display');
  const statusMessage = document.getElementById('status-message');
  const workDurationInput = document.getElementById('work-duration');
  const setDurationButton = document.getElementById('set-duration-button');
  const mainActionButton = document.getElementById('main-action-button');
  const resetButton = document.getElementById('reset-button');
  const adhocBreakTimerDisplay = document.getElementById('adhoc-break-timer-display');
  const sessionSummaryDisplay = document.getElementById('session-summary');

  // --- Local State for UI updates ---
  let localMainTimerInterval = null;
  let localAdhocBreakInterval = null;
  let currentLocalAdhocBreakTime = 0; // To display ad-hoc break time smoothly

  // --- Utility Functions ---
  function formatTime(totalSeconds) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }

  function updateMainTimerDisplay(currentTime) {
    timerDisplay.textContent = formatTime(currentTime);
  }

  function updateAdhocBreakTimerDisplay(breakTime) {
    adhocBreakTimerDisplay.textContent = `Ad-hoc Break: ${formatTime(breakTime)}`;
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
    if (state.isAdHocBreakActive) {
      mainActionButton.textContent = 'Finish Break';
      mainActionButton.classList.add('finish-break');
      mainActionButton.disabled = false;
      adhocBreakTimerDisplay.style.display = 'block';
      if (!localAdhocBreakInterval) { // Start local adhoc counter if not already running
        currentLocalAdhocBreakTime = state.currentAdHocBreakTime || 0;
        updateAdhocBreakTimerDisplay(currentLocalAdhocBreakTime);
        localAdhocBreakInterval = setInterval(() => {
          currentLocalAdhocBreakTime++;
          updateAdhocBreakTimerDisplay(currentLocalAdhocBreakTime);
        }, 1000);
      }
    } else if (state.currentSessionType === 'WORK' && !state.isPaused) {
      mainActionButton.textContent = 'Take a Break';
      mainActionButton.classList.add('take-break');
      mainActionButton.disabled = false;
      adhocBreakTimerDisplay.style.display = 'none';
      if (localAdhocBreakInterval) clearInterval(localAdhocBreakInterval);
      localAdhocBreakInterval = null;
    } else if (state.isPaused) { // Covers WORK paused, or any session type when initially paused
      mainActionButton.textContent = 'Start Focus';
      if (state.currentSessionType === 'WORK') mainActionButton.textContent = 'Resume Focus';
      if (state.currentSessionType === 'SHORT_BREAK') mainActionButton.textContent = 'Start Short Break';
      if (state.currentSessionType === 'LONG_BREAK') mainActionButton.textContent = 'Start Long Break';
      mainActionButton.classList.add('start');
      mainActionButton.disabled = false;
      adhocBreakTimerDisplay.style.display = 'none';
      if (localAdhocBreakInterval) clearInterval(localAdhocBreakInterval);
      localAdhocBreakInterval = null;
    } else { // Default for non-WORK sessions that are running (e.g. Pomodoro breaks)
      mainActionButton.textContent = 'Break in Progress';
      mainActionButton.classList.add('disabled'); // Make it look disabled
      mainActionButton.disabled = true; // Actually disable it
      adhocBreakTimerDisplay.style.display = 'none';
      if (localAdhocBreakInterval) clearInterval(localAdhocBreakInterval);
      localAdhocBreakInterval = null;
    }
    
    // Reset button is disabled if an ad-hoc break is active
    resetButton.disabled = state.isAdHocBreakActive;
    // Set duration button is disabled if timer is running or ad-hoc break active
    setDurationButton.disabled = (!state.isPaused && state.currentSessionType === 'WORK') || state.isAdHocBreakActive;


    // Manage local interval for main timer display (smooth countdown)
    if (localMainTimerInterval) clearInterval(localMainTimerInterval);
    if (!state.isPaused && !state.isAdHocBreakActive) {
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
    if (state.isAdHocBreakActive) return "Ad-hoc Break Active";
    switch (state.currentSessionType) {
      case 'WORK':
        return state.isPaused ? "Focus Paused" : "Focus Session";
      case 'SHORT_BREAK':
        return state.isPaused ? "Short Break Paused" : "Short Break";
      case 'LONG_BREAK':
        return state.isPaused ? "Long Break Paused" : "Long Break";
      default:
        return "Ready";
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
