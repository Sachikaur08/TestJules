document.getElementById('mentalHealthForm').addEventListener('submit', function(event) {
    event.preventDefault(); // Prevent actual form submission

    let totalScore = 0;
    const form = event.target;
    const questions = [
        { name: 'q1', type: 'mood' }, { name: 'q2', type: 'mood' },
        { name: 'q3', type: 'anxiety' }, { name: 'q4', type: 'anxiety' },
        { name: 'q5', type: 'stress' }, { name: 'q6', type: 'stress' }, // Note: q6 is reverse scored in HTML
        { name: 'q7', type: 'coping' }, // Note: q7 is reverse scored in HTML
        { name: 'q8', type: 'coping' }, // Note: q8 is reverse scored in HTML
        { name: 'q9', type: 'wellbeing' }, // Note: q9 is reverse scored in HTML
        { name: 'q10', type: 'wellbeing' } // Note: q10 is reverse scored in HTML
    ];

    let allQuestionsAnswered = true;

    for (const question of questions) {
        const selectedOption = form.elements[question.name].value;
        if (selectedOption) {
            totalScore += parseInt(selectedOption);
        } else {
            allQuestionsAnswered = false;
            break; // Stop if any question is unanswered
        }
    }

    const resultsDiv = document.getElementById('results');
    const scoreP = document.getElementById('score');
    const feedbackP = document.getElementById('feedback');

    if (!allQuestionsAnswered) {
        scoreP.textContent = '';
        feedbackP.textContent = 'Please answer all questions before submitting.';
        resultsDiv.style.display = 'block';
        resultsDiv.style.backgroundColor = '#f8d7da'; // Light red for error
        resultsDiv.style.borderColor = '#f5c6cb';
        feedbackP.style.color = '#721c24';

        // Scroll to the first unanswered question
        for (const question of questions) {
            if (!form.elements[question.name].value) {
                const unansweredElement = form.elements[question.name][0] || form.elements[question.name]; // Handle single radio vs group
                if (unansweredElement) {
                    const questionDiv = unansweredElement.closest('.question');
                    if (questionDiv) {
                        questionDiv.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        // Optionally, add a visual cue to the unanswered question
                        questionDiv.style.borderLeft = '3px solid red';
                    }
                }
                break;
            }
        }
        return;
    }
     // Reset borders if all questions are answered
    document.querySelectorAll('.question').forEach(qDiv => {
        qDiv.style.borderLeft = '3px solid #007bff'; // Reset to original or desired color
    });


    scoreP.textContent = `Your total score is: ${totalScore}.`;

    let feedbackMessage = '';
    // Example feedback logic (can be much more sophisticated)
    // Max possible score: 3+3+3+3+4+4+3+3+4+3 = 33 (Based on current values)
    if (totalScore <= 10) {
        feedbackMessage = "Your responses suggest a good level of mental well-being. Keep up the healthy habits!";
        resultsDiv.style.backgroundColor = '#d4edda'; // Green for good
        resultsDiv.style.borderColor = '#c3e6cb';
        feedbackP.style.color = '#155724';
    } else if (totalScore <= 20) {
        feedbackMessage = "Your responses suggest some areas where your mental well-being could be improved. Consider exploring stress-management techniques or talking to someone you trust.";
        resultsDiv.style.backgroundColor = '#fff3cd'; // Yellow for moderate
        resultsDiv.style.borderColor = '#ffeeba';
        feedbackP.style.color = '#856404';
    } else {
        feedbackMessage = "Your responses suggest significant concerns regarding your mental well-being. It is highly recommended to seek support from a mental health professional. You are not alone, and help is available.";
        resultsDiv.style.backgroundColor = '#f8d7da'; // Red for concern
        resultsDiv.style.borderColor = '#f5c6cb';
        feedbackP.style.color = '#721c24';
    }
    feedbackP.textContent = feedbackMessage;
    resultsDiv.style.display = 'block';
    resultsDiv.scrollIntoView({ behavior: 'smooth', block: 'center' });
});
