document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const startTimeInput = document.getElementById('startTime');
    const endTimeInput = document.getElementById('endTime');
    const focusDurationInput = document.getElementById('focusDuration');
    const shortBreakDurationInput = document.getElementById('shortBreakDuration');
    const longBreakDurationInput = document.getElementById('longBreakDuration');
    const pomodorosUntilLongBreakInput = document.getElementById('pomodorosUntilLongBreak');
    const saveButton = document.getElementById('saveButton');
    const statusDiv = document.getElementById('status');

    // Default values (in case nothing is in storage yet)
    // These should ideally align with defaults in background.js for consistency
    const DEFAULTS = {
        startTime: "09:00",
        endTime: "17:00",
        userSetWorkDuration: 25 * 60, // seconds
        shortBreakDuration: 5 * 60,  // seconds
        longBreakDuration: 15 * 60, // seconds
        pomodorosUntilLongBreak: 4
    };

    // Load settings from storage and populate fields
    function loadSettings() {
        chrome.storage.local.get([
            'startTime', 'endTime', 
            'userSetWorkDuration', 'shortBreakDuration', 'longBreakDuration', 
            'pomodorosUntilLongBreak'
        ], (data) => {
            startTimeInput.value = data.startTime || DEFAULTS.startTime;
            endTimeInput.value = data.endTime || DEFAULTS.endTime;
            focusDurationInput.value = data.userSetWorkDuration ? (data.userSetWorkDuration / 60) : (DEFAULTS.userSetWorkDuration / 60);
            shortBreakDurationInput.value = data.shortBreakDuration ? (data.shortBreakDuration / 60) : (DEFAULTS.shortBreakDuration / 60);
            longBreakDurationInput.value = data.longBreakDuration ? (data.longBreakDuration / 60) : (DEFAULTS.longBreakDuration / 60);
            pomodorosUntilLongBreakInput.value = data.pomodorosUntilLongBreak || DEFAULTS.pomodorosUntilLongBreak;
            console.log('Settings loaded:', data);
        });
    }

    // Save settings to storage
    saveButton.addEventListener('click', () => {
        statusDiv.textContent = ''; // Clear previous status
        statusDiv.className = '';

        const startTime = startTimeInput.value;
        const endTime = endTimeInput.value;
        const focusDuration = parseInt(focusDurationInput.value, 10);
        const shortBreakDuration = parseInt(shortBreakDurationInput.value, 10);
        const longBreakDuration = parseInt(longBreakDurationInput.value, 10);
        const pomodorosUntilLongBreak = parseInt(pomodorosUntilLongBreakInput.value, 10);

        // Basic Validation
        if (!startTime || !endTime) {
            displayStatus("Start and End times are required.", true);
            return;
        }
        if (startTime >= endTime) {
            displayStatus("End time must be after Start time.", true);
            return;
        }
        if (isNaN(focusDuration) || focusDuration <= 0 ||
            isNaN(shortBreakDuration) || shortBreakDuration <= 0 ||
            isNaN(longBreakDuration) || longBreakDuration <= 0 ||
            isNaN(pomodorosUntilLongBreak) || pomodorosUntilLongBreak <= 0) {
            displayStatus("All duration and cycle values must be positive numbers.", true);
            return;
        }

        const settingsToSave = {
            startTime: startTime,
            endTime: endTime,
            userSetWorkDuration: focusDuration * 60,      // Store in seconds
            shortBreakDuration: shortBreakDuration * 60, // Store in seconds
            longBreakDuration: longBreakDuration * 60,  // Store in seconds
            pomodorosUntilLongBreak: pomodorosUntilLongBreak
        };

        chrome.storage.local.set(settingsToSave, () => {
            if (chrome.runtime.lastError) {
                displayStatus(`Error saving settings: ${chrome.runtime.lastError.message}`, true);
                console.error('Error saving settings:', chrome.runtime.lastError);
            } else {
                displayStatus("Settings saved successfully!", false);
                console.log('Settings saved:', settingsToSave);
                // Optionally, notify background script that settings have changed
                chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED' }, response => {
                    if (chrome.runtime.lastError) {
                        console.warn("Could not send SETTINGS_UPDATED message to background, it might be inactive.", chrome.runtime.lastError.message);
                    } else {
                        console.log("Background script acknowledged settings update.", response);
                    }
                });
            }
        });
    });

    function displayStatus(message, isError) {
        statusDiv.textContent = message;
        statusDiv.className = isError ? 'status-error' : 'status-success';
        setTimeout(() => {
            statusDiv.textContent = '';
            statusDiv.className = '';
        }, 3000); // Clear status after 3 seconds
    }

    // Initial load
    loadSettings();

    // --- Reporting ---
    const focusTimeoutsChartCtx = document.getElementById('focusTimeoutsChart')?.getContext('2d');
    const cyclesChartCtx = document.getElementById('cyclesChart')?.getContext('2d');
    const reportStatusDiv = document.getElementById('reportStatus');
    const refreshReportButton = document.getElementById('refreshReportButton');

    let focusTimeoutsChartInstance = null;
    let cyclesChartInstance = null;

    async function generateReportData() {
        if (!reportStatusDiv) return; // In case this script runs where these elements don't exist
        reportStatusDiv.textContent = 'Loading report data...';

        try {
            const result = await chrome.storage.local.get('neuroFocusSessionLogs');
            const logs = result.neuroFocusSessionLogs || [];

            if (logs.length === 0) {
                reportStatusDiv.textContent = 'No session data logged yet to generate a report.';
                if (focusTimeoutsChartInstance) focusTimeoutsChartInstance.destroy();
                if (cyclesChartInstance) cyclesChartInstance.destroy();
                return;
            }

            // Get data for the last 7 unique days that have logs
            const uniqueDates = [...new Set(logs.map(log => log.date))].sort((a,b) => new Date(b) - new Date(a));
            const last7LogDays = uniqueDates.slice(0, 7).reverse(); // Get latest 7, then reverse to have oldest first for chart

            if (last7LogDays.length === 0) {
                reportStatusDiv.textContent = 'Not enough data for the last 7 days.';
                 if (focusTimeoutsChartInstance) focusTimeoutsChartInstance.destroy();
                if (cyclesChartInstance) cyclesChartInstance.destroy();
                return;
            }
            
            const reportData = {
                dates: [],
                focusDurations: [],
                timeoutDurations: [],
                pomodoroCycles: []
            };

            last7LogDays.forEach(dateStr => {
                reportData.dates.push(dateStr.slice(5)); // Format as MM-DD for label

                let dailyFocus = 0;
                let dailyTimeouts = 0;
                let dailyCycles = 0;

                logs.filter(log => log.date === dateStr).forEach(log => {
                    if (log.type === 'WORK') {
                        dailyFocus += (log.actualDuration || 0);
                        dailyTimeouts += (log.totalAdHocTimeoutDuration || 0);
                        dailyCycles++; // Each WORK log is one completed Pomodoro cycle
                    }
                });
                reportData.focusDurations.push(dailyFocus / 60); // Convert to minutes
                reportData.timeoutDurations.push(dailyTimeouts / 60); // Convert to minutes
                reportData.pomodoroCycles.push(dailyCycles);
            });
            
            renderFocusTimeoutsChart(reportData);
            renderCyclesChart(reportData);
            reportStatusDiv.textContent = `Report generated for ${last7LogDays.length} day(s).`;

        } catch (error) {
            console.error("Error generating report data:", error);
            reportStatusDiv.textContent = 'Error generating report.';
        }
    }

    function renderFocusTimeoutsChart(data) {
        if (!focusTimeoutsChartCtx) return;
        if (focusTimeoutsChartInstance) {
            focusTimeoutsChartInstance.destroy();
        }
        focusTimeoutsChartInstance = new Chart(focusTimeoutsChartCtx, {
            type: 'bar',
            data: {
                labels: data.dates,
                datasets: [
                    {
                        label: 'Focus Time (minutes)',
                        data: data.focusDurations,
                        backgroundColor: 'rgba(75, 192, 192, 0.7)',
                        borderColor: 'rgba(75, 192, 192, 1)',
                        borderWidth: 1
                    },
                    {
                        label: 'Timeout Time (minutes)',
                        data: data.timeoutDurations,
                        backgroundColor: 'rgba(255, 159, 64, 0.7)',
                        borderColor: 'rgba(255, 159, 64, 1)',
                        borderWidth: 1
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        title: { display: true, text: 'Minutes' }
                    },
                    x: {
                        title: { display: true, text: 'Date' }
                    }
                },
                plugins: {
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                let label = context.dataset.label || '';
                                if (label) {
                                    label += ': ';
                                }
                                if (context.parsed.y !== null) {
                                    label += Math.round(context.parsed.y * 100) / 100 + ' min';
                                }
                                return label;
                            }
                        }
                    }
                }
            }
        });
    }

    function renderCyclesChart(data) {
        if (!cyclesChartCtx) return;
        if (cyclesChartInstance) {
            cyclesChartInstance.destroy();
        }
        cyclesChartInstance = new Chart(cyclesChartCtx, {
            type: 'bar',
            data: {
                labels: data.dates,
                datasets: [{
                    label: 'Pomodoro Cycles Completed',
                    data: data.pomodoroCycles,
                    backgroundColor: 'rgba(54, 162, 235, 0.7)',
                    borderColor: 'rgba(54, 162, 235, 1)',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        title: { display: true, text: 'Number of Cycles' },
                        ticks: {
                            stepSize: 1 // Ensure y-axis shows whole numbers for cycles
                        }
                    },
                     x: {
                        title: { display: true, text: 'Date' }
                    }
                }
            }
        });
    }

    if (refreshReportButton) {
        refreshReportButton.addEventListener('click', generateReportData);
    }
    
    // Auto-load report data when options page is opened
    if (focusTimeoutsChartCtx && cyclesChartCtx) { // Only if chart canvases are on the page
        generateReportData();
    }
});
