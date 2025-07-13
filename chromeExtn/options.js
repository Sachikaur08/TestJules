document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements for Settings
    const startTimeInput = document.getElementById('startTime');
    const endTimeInput = document.getElementById('endTime');
    const focusDurationInput = document.getElementById('focusDuration');
    const shortBreakDurationInput = document.getElementById('shortBreakDuration');
    const longBreakDurationInput = document.getElementById('longBreakDuration');
    const pomodorosUntilLongBreakInput = document.getElementById('pomodorosUntilLongBreak');
    const saveButton = document.getElementById('saveButton');
    const statusDiv = document.getElementById('status');

    // DOM Elements for Reporting
    const focusTimeoutsChartCtx = document.getElementById('focusTimeoutsChart')?.getContext('2d');
    const cyclesChartCtx = document.getElementById('cyclesChart')?.getContext('2d');
    const reportStatusDiv = document.getElementById('reportStatus');
    const refreshReportButton = document.getElementById('refreshReportButton');
    const reportDaysInput = document.getElementById('reportDays');

    let focusTimeoutsChartInstance = null;
    let cyclesChartInstance = null;

    const DEFAULTS = {
        startTime: "09:00",
        endTime: "17:00",
        userSetWorkDuration: 25 * 60, 
        shortBreakDuration: 5 * 60,  
        longBreakDuration: 15 * 60, 
        pomodorosUntilLongBreak: 4
    };

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

    saveButton.addEventListener('click', () => {
        statusDiv.textContent = ''; 
        statusDiv.className = '';

        const startTime = startTimeInput.value;
        const endTime = endTimeInput.value;
        const focusDuration = parseInt(focusDurationInput.value, 10);
        const shortBreakDuration = parseInt(shortBreakDurationInput.value, 10);
        const longBreakDuration = parseInt(longBreakDurationInput.value, 10);
        const pomodorosUntilLongBreak = parseInt(pomodorosUntilLongBreakInput.value, 10);

        if (!startTime || !endTime) {
            displayStatus("Start and End times are required.", true); return;
        }
        if (startTime >= endTime) {
            displayStatus("End time must be after Start time.", true); return;
        }
        if (isNaN(focusDuration) || focusDuration <= 0 ||
            isNaN(shortBreakDuration) || shortBreakDuration <= 0 ||
            isNaN(longBreakDuration) || longBreakDuration <= 0 ||
            isNaN(pomodorosUntilLongBreak) || pomodorosUntilLongBreak <= 0) {
            displayStatus("All duration and cycle values must be positive numbers.", true); return;
        }

        const settingsToSave = {
            startTime: startTime,
            endTime: endTime,
            userSetWorkDuration: focusDuration * 60,
            shortBreakDuration: shortBreakDuration * 60,
            longBreakDuration: longBreakDuration * 60,
            pomodorosUntilLongBreak: pomodorosUntilLongBreak
        };

        chrome.storage.local.set(settingsToSave, () => {
            if (chrome.runtime.lastError) {
                displayStatus(`Error saving settings: ${chrome.runtime.lastError.message}`, true);
                console.error('Error saving settings:', chrome.runtime.lastError);
            } else {
                displayStatus("Settings saved successfully!", false);
                console.log('Settings saved:', settingsToSave);
                chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED' }, response => {
                    if (chrome.runtime.lastError) {
                        console.warn("Could not send SETTINGS_UPDATED to background.", chrome.runtime.lastError.message);
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
        }, 3000);
    }

    loadSettings();

    // --- Reporting Logic ---
    async function generateReportData() {
        if (!reportStatusDiv || !reportDaysInput) {
            console.warn("Report elements not found on page.");
            return;
        }
        reportStatusDiv.textContent = 'Loading report data...';
        const daysToReport = parseInt(reportDaysInput.value) || 7;

        try {
            const result = await chrome.storage.local.get('neuroFocusSessionLogs');
            const logs = result.neuroFocusSessionLogs || [];

            if (focusTimeoutsChartInstance) { focusTimeoutsChartInstance.destroy(); focusTimeoutsChartInstance = null; }
            if (cyclesChartInstance) { cyclesChartInstance.destroy(); cyclesChartInstance = null; }

            if (logs.length === 0) {
                reportStatusDiv.textContent = 'No session data logged yet to generate a report.';
                return;
            }

            const uniqueDates = [...new Set(logs.map(log => log.date))].sort((a,b) => new Date(b) - new Date(a));
            const lastNLogDays = uniqueDates.slice(0, daysToReport).reverse();

            if (lastNLogDays.length === 0) {
                reportStatusDiv.textContent = `Not enough data for the selected period (${daysToReport} day(s)).`;
                return;
            }
            
            const reportData = {
                labels: [], 
                netProductiveFocusDurationsHours: [],
                totalDistractionSiteTimeHours: [],
                timeoutDurationsHours: [],
                pomodoroCycles: [],
                maxYAxisValue: 0 
            };

            const dayFormatter = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
            let maxOverallDailyWorkRelatedHours = 0;

            lastNLogDays.forEach(dateStr => {
                const dateObj = new Date(dateStr + 'T00:00:00'); 
                reportData.labels.push(dayFormatter.format(dateObj));

                let dailyTotalWorkSessionSeconds = 0;
                let dailyTotalTimeoutSeconds = 0;
                let dailyTotalDistractionSiteSeconds = 0;
                let dailyCycles = 0;

                logs.filter(log => log.date === dateStr).forEach(log => {
                    if (log.type === 'WORK') {
                        dailyTotalWorkSessionSeconds += (log.actualDuration || 0);
                        dailyTotalTimeoutSeconds += (log.totalAdHocTimeoutDuration || 0);
                        dailyCycles++; 
                        if (log.distractions) {
                            Object.values(log.distractions).forEach(siteTime => {
                                dailyTotalDistractionSiteSeconds += (siteTime || 0);
                            });
                        }
                    }
                });

                const effectiveDistractionSeconds = Math.min(dailyTotalDistractionSiteSeconds, Math.max(0, dailyTotalWorkSessionSeconds - dailyTotalTimeoutSeconds));
                const dailyNetProductiveFocusSeconds = Math.max(0, dailyTotalWorkSessionSeconds - dailyTotalTimeoutSeconds - effectiveDistractionSeconds);
                const currentDayTotalBarHeightSeconds = dailyTotalWorkSessionSeconds;

                if (currentDayTotalBarHeightSeconds / 3600 > maxOverallDailyWorkRelatedHours) {
                    maxOverallDailyWorkRelatedHours = currentDayTotalBarHeightSeconds / 3600;
                }
                
                reportData.netProductiveFocusDurationsHours.push(dailyNetProductiveFocusSeconds / 3600); 
                reportData.totalDistractionSiteTimeHours.push(effectiveDistractionSeconds / 3600);
                reportData.timeoutDurationsHours.push(dailyTotalTimeoutSeconds / 3600); 
                reportData.pomodoroCycles.push(dailyCycles);
            });
            
            reportData.maxYAxisValue = Math.ceil(maxOverallDailyWorkRelatedHours) + 1;
            if (maxOverallDailyWorkRelatedHours === 0 && reportData.labels.length > 0) reportData.maxYAxisValue = 2;
            else if (maxOverallDailyWorkRelatedHours === 0 && reportData.labels.length === 0) reportData.maxYAxisValue = 0;

            renderFocusTimeoutsChart(reportData);
            renderCyclesChart(reportData); 
            reportStatusDiv.textContent = `Report generated for ${lastNLogDays.length} day(s).`;

        } catch (error) {
            console.error("Error generating report data:", error);
            reportStatusDiv.textContent = 'Error generating report.';
            if (focusTimeoutsChartInstance) { try { focusTimeoutsChartInstance.destroy(); } catch(e){/* ignore */} focusTimeoutsChartInstance = null; }
            if (cyclesChartInstance) { try { cyclesChartInstance.destroy(); } catch(e){/* ignore */} cyclesChartInstance = null; }
        }
    }

    function renderFocusTimeoutsChart(data) {
        if (!focusTimeoutsChartCtx) return;
        // Destruction of old instance is now handled at the start of generateReportData
        focusTimeoutsChartInstance = new Chart(focusTimeoutsChartCtx, {
            type: 'bar',
            data: {
                labels: data.labels, 
                datasets: [
                    {
                        label: 'Net Productive Focus (hours)', 
                        data: data.netProductiveFocusDurationsHours, 
                        backgroundColor: 'rgba(39, 174, 96, 0.8)', // Calming green
                        borderColor: 'rgba(39, 174, 96, 1)',
                        borderWidth: 2
                    },
                    {
                        label: 'Distracting Sites (hours)', 
                        data: data.totalDistractionSiteTimeHours, 
                        backgroundColor: 'rgba(155, 89, 182, 0.8)', // Muted purple instead of red
                        borderColor: 'rgba(155, 89, 182, 1)',
                        borderWidth: 2
                    },
                    {
                        label: 'Timeout Time (hours)',
                        data: data.timeoutDurationsHours,
                        backgroundColor: 'rgba(243, 156, 18, 0.8)', // Warm orange
                        borderColor: 'rgba(243, 156, 18, 1)',
                        borderWidth: 2
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        stacked: true, 
                        beginAtZero: true,
                        title: { 
                            display: true, 
                            text: 'Hours',
                            font: { size: 14, weight: 'bold' },
                            color: '#2c3e50'
                        },
                        suggestedMax: data.maxYAxisValue,
                        ticks: { 
                            stepSize: 1,
                            font: { size: 12 },
                            color: '#34495e'
                        },
                        grid: {
                            color: 'rgba(189, 195, 199, 0.3)'
                        }
                    },
                    x: {
                        stacked: true, 
                        title: { 
                            display: true, 
                            text: 'Date',
                            font: { size: 14, weight: 'bold' },
                            color: '#2c3e50'
                        },
                        ticks: {
                            font: { size: 12 },
                            color: '#34495e'
                        },
                        grid: {
                            color: 'rgba(189, 195, 199, 0.3)'
                        }
                    }
                },
                plugins: {
                    legend: {
                        labels: {
                            font: { size: 13, weight: '600' },
                            color: '#2c3e50',
                            usePointStyle: true,
                            padding: 15
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(44, 62, 80, 0.95)',
                        titleColor: '#ffffff',
                        bodyColor: '#ffffff',
                        borderColor: '#3498db',
                        borderWidth: 2,
                        cornerRadius: 8,
                        callbacks: {
                            label: function(context) {
                                let label = context.dataset.label || '';
                                if (label) { label += ': '; }
                                if (context.parsed.y !== null) {
                                    label += Math.round(context.parsed.y * 100) / 100 + ' hrs';
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
        // Destruction of old instance is now handled at the start of generateReportData
        cyclesChartInstance = new Chart(cyclesChartCtx, {
            type: 'bar',
            data: {
                labels: data.labels, 
                datasets: [{
                    label: 'Focus Cycles Completed',
                    data: data.pomodoroCycles,
                    backgroundColor: 'rgba(52, 152, 219, 0.8)', // Calming blue
                    borderColor: 'rgba(52, 152, 219, 1)',
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        title: { 
                            display: true, 
                            text: 'Number of Cycles',
                            font: { size: 14, weight: 'bold' },
                            color: '#2c3e50'
                        },
                        ticks: { 
                            stepSize: 1,
                            font: { size: 12 },
                            color: '#34495e'
                        },
                        grid: {
                            color: 'rgba(189, 195, 199, 0.3)'
                        }
                    },
                     x: {
                        title: { 
                            display: true, 
                            text: 'Date',
                            font: { size: 14, weight: 'bold' },
                            color: '#2c3e50'
                        },
                        ticks: {
                            font: { size: 12 },
                            color: '#34495e'
                        },
                        grid: {
                            color: 'rgba(189, 195, 199, 0.3)'
                        }
                    }
                },
                plugins: {
                    legend: {
                        labels: {
                            font: { size: 13, weight: '600' },
                            color: '#2c3e50',
                            usePointStyle: true,
                            padding: 15
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(44, 62, 80, 0.95)',
                        titleColor: '#ffffff',
                        bodyColor: '#ffffff',
                        borderColor: '#3498db',
                        borderWidth: 2,
                        cornerRadius: 8
                    }
                }
            }
        });
    }

    if (refreshReportButton) {
        refreshReportButton.addEventListener('click', generateReportData);
    }
});
