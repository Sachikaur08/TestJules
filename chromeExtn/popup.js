// Placeholder for popup script
console.log("Popup script loaded.");

document.addEventListener('DOMContentLoaded', function () {
  const timerDisplay = document.getElementById('timer-display');
  const startButton = document.getElementById('start-button');
  const pauseButton = document.getElementById('pause-button');
  const resetButton = document.getElementById('reset-button');
  const statusMessage = document.getElementById('status-message');

  // Initial timer values (example: 25 minutes work)
  let workDuration = 25 * 60; // in seconds
  let breakDuration = 5 * 60; // in seconds
  let currentTime = workDuration;
  let isPaused = true;
  let isWorkSession = true;
  let timerInterval;

  function updateDisplay() {
    const minutes = Math.floor(currentTime / 60);
    const seconds = currentTime % 60;
    timerDisplay.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }

  function startTimer() {
    if (isPaused) {
      isPaused = false;
      startButton.textContent = 'Start'; // Or disable if you prefer
      timerInterval = setInterval(() => {
        if (currentTime > 0) {
          currentTime--;
          updateDisplay();
        } else {
          // Timer reached zero
          clearInterval(timerInterval);
          isPaused = true;
          // Switch session type
          isWorkSession = !isWorkSession;
          currentTime = isWorkSession ? workDuration : breakDuration;
          statusMessage.textContent = isWorkSession ? "Work Session" : "Break Time!";
          updateDisplay();
          // Notify background script to show notification
          chrome.runtime.sendMessage({
            type: 'TIMER_ENDED',
            isWork: !isWorkSession // If it *was* work, now it's break, and vice-versa
          });
          // Potentially auto-start next session or wait for user
        }
      }, 1000);
    }
  }

  function pauseTimer() {
    isPaused = true;
    clearInterval(timerInterval);
    startButton.textContent = 'Resume';
  }

  function resetTimer() {
    clearInterval(timerInterval);
    isPaused = true;
    isWorkSession = true; // Default to work session
    currentTime = workDuration;
    statusMessage.textContent = "Work Session";
    startButton.textContent = 'Start';
    updateDisplay();
  }

  startButton.addEventListener('click', () => {
    if (isPaused && startButton.textContent === 'Resume') {
        startTimer();
    } else if (isPaused) {
        startTimer();
    }
  });
  pauseButton.addEventListener('click', pauseTimer);
  resetButton.addEventListener('click', resetTimer);

  // Initialize display
  updateDisplay();

  // Listen for state updates from background script (e.g., timer running in another popup instance or from background)
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'TIMER_STATE_UPDATE') {
      currentTime = request.currentTime;
      isPaused = request.isPaused;
      isWorkSession = request.isWorkSession;
      workDuration = request.workDuration;
      breakDuration = request.breakDuration;
      statusMessage.textContent = isWorkSession ? "Work Session" : "Break Time!";
      updateDisplay();
      if (!isPaused) {
        startTimer(); // Resume timer if it was running
      }
    }
  });

  // Request current timer state from background script when popup opens
  chrome.runtime.sendMessage({ type: 'GET_TIMER_STATE' }, (response) => {
    if (chrome.runtime.lastError) {
        console.error("Error getting timer state:", chrome.runtime.lastError.message);
        // Proceed with default initialization if background isn't ready or there's an error
        resetTimer(); // Or some other default state
        return;
    }
    if (response) {
        currentTime = response.currentTime;
        isPaused = response.isPaused;
        isWorkSession = response.isWorkSession;
        workDuration = response.workDuration; // Assuming these are part of the state
        breakDuration = response.breakDuration;
        statusMessage.textContent = isWorkSession ? "Work Session" : "Break Time!";
        updateDisplay();
        if (!isPaused) {
            // If timer was running and popup is opened, ensure interval is restarted for the popup's context
            // The actual timing should be driven by alarms in background.js
            // This startTimer() here is more about re-syncing the popup's countdown display interval.
            startTimer();
        }
         startButton.textContent = isPaused ? (currentTime === (isWorkSession ? workDuration : breakDuration) ? 'Start' : 'Resume') : 'Start';
    } else {
        // If no response, initialize with defaults
        resetTimer();
    }
  });
});
