const ACTIVE_EXAM_STORAGE_KEY = 'active-exam-questions';
const LAST_FETCH_TIMESTAMP_KEY = 'last-exam-fetch-timestamp';

// Firebase Config (same as app.js)
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCe-7pE7QDig6OFj27uPRD_K6i7_QF_F1Y",
  authDomain: "video-52a71.firebaseapp.com",
  databaseURL: "https://video-52a71-default-rtdb.firebaseio.com",
  projectId: "video-52a71",
  storageBucket: "video-52a71.firebasestorage.app",
  messagingSenderId: "1080462810591",
  appId: "1:1080462810591:web:20a319346f49f9b604f86a",
  measurementId: "G-PLM4N1LZTE"
};

const FIRESTORE_COLLECTION = 'questions';

const questionsContainer = document.getElementById('questionsContainer');
const submitExamBtn = document.getElementById('submitExamBtn');
const resultsContainer = document.getElementById('resultsContainer');
const scoreDisplay = document.getElementById('scoreDisplay');
const correctCountDisplay = document.getElementById('correctCountDisplay');
const wrongCountDisplay = document.getElementById('wrongCountDisplay');
const resultsDetails = document.getElementById('resultsDetails');

let questions = [];
let displayedQuestions = [];
let userAnswers = {};

function shuffleArray(array) {
  const clonedArray = [...array];
  for (let i = clonedArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [clonedArray[i], clonedArray[j]] = [clonedArray[j], clonedArray[i]];
  }
  return clonedArray;
}

function loadQuestionsFromStorage() {
  try {
    const savedQuestions = localStorage.getItem(ACTIVE_EXAM_STORAGE_KEY);
    if (!savedQuestions) return [];
    const parsedQuestions = JSON.parse(savedQuestions);
    if (!Array.isArray(parsedQuestions)) return [];

    return parsedQuestions.filter((question) => {
      return (
        question &&
        typeof question.question === 'string' &&
        Array.isArray(question.answers) &&
        question.answers.length >= 2 &&
        Number.isInteger(question.correctIndex) &&
        question.correctIndex >= 0 &&
        question.correctIndex < question.answers.length
      );
    });
  } catch (error) {
    console.error('Failed to load exam questions:', error);
    return [];
  }
}

function buildDisplayedQuestions(sourceQuestions) {
  return shuffleArray(sourceQuestions).map((question) => {
    const options = question.answers.map((answer, index) => ({
      id: `${question.id}-${index}`,
      text: answer,
      isCorrect: index === question.correctIndex,
    }));

    return {
      id: question.id,
      type: question.type,
      text: question.question,
      options: shuffleArray(options),
    };
  });
}

function renderEmptyState(message) {
  questionsContainer.innerHTML = `
    <div class="question-item">
      <p class="question-text">${message}</p>
      <button class="btn btn-primary" onclick="window.location.href='index.html'">العودة إلى الصفحة الرئيسية</button>
    </div>
  `;
}

function renderQuestions() {
  if (questions.length === 0) {
    renderEmptyState('لا يوجد امتحان متاح حالياً. قم أولاً برفع واعتماد الأسئلة من صفحة الادمن.');
    submitExamBtn.style.display = 'none';
    return;
  }

  displayedQuestions = buildDisplayedQuestions(questions);
  questionsContainer.innerHTML = '';

  displayedQuestions.forEach((question, index) => {
    const questionElement = document.createElement('div');
    questionElement.classList.add('question-item');
    questionElement.dataset.questionId = question.id;

    const questionText = document.createElement('p');
    questionText.classList.add('question-text');
    questionText.textContent = `${index + 1}. ${question.text}`;
    questionElement.appendChild(questionText);

    const optionsContainer = document.createElement('div');
    optionsContainer.classList.add('options-container');

    question.options.forEach((option, optionIndex) => {
      const optionLabel = document.createElement('label');
      optionLabel.classList.add('option-label');

      const input = document.createElement('input');
      input.type = 'radio';
      input.name = `question-${question.id}`;
      input.value = option.id;
      input.addEventListener('change', (event) => {
        userAnswers[question.id] = event.target.value;
      });

      const optionLetter = document.createElement('span');
      optionLetter.classList.add('option-letter');
      optionLetter.textContent = String.fromCharCode(65 + optionIndex);

      const optionText = document.createElement('span');
      optionText.classList.add('option-text');
      optionText.textContent = option.text;

      optionLabel.appendChild(input);
      optionLabel.appendChild(optionLetter);
      optionLabel.appendChild(optionText);
      optionsContainer.appendChild(optionLabel);
    });

    questionElement.appendChild(optionsContainer);
    questionsContainer.appendChild(questionElement);
  });

  submitExamBtn.style.display = 'block';
}

function submitExam() {
  let score = 0;
  let correctCount = 0;
  let wrongCount = 0;
  const detailedResults = [];

  displayedQuestions.forEach((question) => {
    const userAnswerId = userAnswers[question.id];
    const correctAnswer = question.options.find((option) => option.isCorrect);
    let isCorrect = false;

    if (userAnswerId && correctAnswer && userAnswerId === correctAnswer.id) {
      score += 1;
      correctCount += 1;
      isCorrect = true;
    } else {
      wrongCount += 1;
    }

    detailedResults.push({
      question: question,
      userAnswerId: userAnswerId,
      correctAnswer: correctAnswer,
      isCorrect: isCorrect,
    });
  });

  displayResults(score, correctCount, wrongCount, detailedResults);
}

function displayResults(score, correctCount, wrongCount, detailedResults) {
  questionsContainer.style.display = 'none';
  submitExamBtn.style.display = 'none';
  resultsContainer.style.display = 'block';

  scoreDisplay.textContent = score;
  correctCountDisplay.textContent = correctCount;
  wrongCountDisplay.textContent = wrongCount;

  resultsDetails.innerHTML = '';

  detailedResults.forEach((result, index) => {
    const questionResultElement = document.createElement('div');
    questionResultElement.classList.add('question-item');

    const questionText = document.createElement('p');
    questionText.classList.add('question-text');
    questionText.textContent = `${index + 1}. ${result.question.text}`;
    questionResultElement.appendChild(questionText);

    const optionsContainer = document.createElement('div');
    optionsContainer.classList.add('options-container');

    result.question.options.forEach((option, optionIndex) => {
      const optionLabel = document.createElement('label');
      optionLabel.classList.add('option-label');

      const feedbackIcon = document.createElement('span');
      feedbackIcon.classList.add('feedback-icon');

      const optionLetter = document.createElement('span');
      optionLetter.classList.add('option-letter');
      optionLetter.textContent = String.fromCharCode(65 + optionIndex);

      const optionText = document.createElement('span');
      optionText.classList.add('option-text');
      optionText.textContent = option.text;

      if (option.isCorrect) {
        optionLabel.classList.add('correct-answer');
        feedbackIcon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>';
        feedbackIcon.classList.add('correct');
      }

      if (result.userAnswerId === option.id && !option.isCorrect) {
        optionLabel.classList.add('selected-wrong');
        feedbackIcon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
        feedbackIcon.classList.add('wrong');
      }

      optionLabel.appendChild(optionLetter);
      optionLabel.appendChild(optionText);
      optionLabel.appendChild(feedbackIcon);
      optionsContainer.appendChild(optionLabel);
    });

    questionResultElement.appendChild(optionsContainer);
    resultsDetails.appendChild(questionResultElement);
  });
}

submitExamBtn.addEventListener('click', submitExam);

async function checkAndUpdateExam() {
  try {
    if (!firebase.apps.length) {
      firebase.initializeApp(FIREBASE_CONFIG);
    }
    const db = firebase.database();
    
    // Get the latest exam entry from Firebase (limitToLast(1))
    const ref = db.ref(FIRESTORE_COLLECTION);
    const snapshot = await ref.orderByChild('savedAt').limitToLast(1).once('value');
    
    if (snapshot.exists()) {
      const data = snapshot.val();
      const latestExamKey = Object.keys(data)[0];
      const latestExam = data[latestExamKey];
      
      const savedTimestamp = localStorage.getItem(LAST_FETCH_TIMESTAMP_KEY);
      
      // If no local timestamp or Firebase has a newer timestamp, update local storage
      if (!savedTimestamp || latestExam.savedAt !== savedTimestamp) {
        console.log('New exam found in Firebase. Updating local storage...');
        localStorage.setItem(ACTIVE_EXAM_STORAGE_KEY, JSON.stringify(latestExam.questions));
        localStorage.setItem(LAST_FETCH_TIMESTAMP_KEY, latestExam.savedAt);
        return latestExam.questions;
      } else {
        console.log('Local exam is up to date.');
      }
    }
  } catch (error) {
    console.error('Failed to sync with Firebase:', error);
  }
  return null;
}

document.addEventListener('DOMContentLoaded', async () => {
  // First, render from local storage (fastest)
  questions = loadQuestionsFromStorage();
  renderQuestions();
  
  // Then, check for updates in background (efficiency)
  const updatedQuestions = await checkAndUpdateExam();
  if (updatedQuestions) {
    questions = updatedQuestions;
    renderQuestions(); // Re-render with new data
  }
});
