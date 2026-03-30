// DOM Elements
const landingPage = document.getElementById('landingPage');
const adminPanel = document.getElementById('adminPanel');
const testBtn = document.getElementById('testBtn');
const adminBtn = document.getElementById('adminBtn');
const adminPasswordModal = document.getElementById('adminPasswordModal');
const adminPasswordInput = document.getElementById('adminPasswordInput');
const adminLoginBtn = document.getElementById('adminLoginBtn');
const passwordError = document.getElementById('passwordError');

// Admin Password
const ADMIN_PASSWORD = '0000';

// Mock Question Data (for demonstration purposes)
const mockQuestions = [
  {
    id: 'q1',
    type: 'mc',
    text: 'ما هي عاصمة المملكة العربية السعودية؟',
    options: [
      { id: 'a1', text: 'جدة' },
      { id: 'a2', text: 'الرياض', isCorrect: true },
      { id: 'a3', text: 'مكة المكرمة' },
      { id: 'a4', text: 'الدمام' },
    ],
  },
  {
    id: 'q2',
    type: 'tf',
    text: 'الماء يتجمد عند درجة حرارة 0 مئوية.',
    options: [
      { id: 'a5', text: 'صحيح', isCorrect: true },
      { id: 'a6', text: 'خطأ' },
    ],
  },
  {
    id: 'q3',
    type: 'mc',
    text: 'من هو مؤلف كتاب "الأيام"؟',
    options: [
      { id: 'a7', text: 'نجيب محفوظ' },
      { id: 'a8', text: 'طه حسين', isCorrect: true },
      { id: 'a9', text: 'عباس محمود العقاد' },
      { id: 'a10', text: 'أحمد شوقي' },
    ],
  },
  {
    id: 'q4',
    type: 'tf',
    text: 'الشمس تدور حول الأرض.',
    options: [
      { id: 'a11', text: 'صحيح' },
      { id: 'a12', text: 'خطأ', isCorrect: true },
    ],
  },
  {
    id: 'q5',
    type: 'mc',
    text: 'ما هو أكبر محيط في العالم؟',
    options: [
      { id: 'a13', text: 'المحيط الأطلسي' },
      { id: 'a14', text: 'المحيط الهندي' },
      { id: 'a15', text: 'المحيط الهادئ', isCorrect: true },
      { id: 'a16', text: 'المحيط المتجمد الشمالي' },
    ],
  },
];

// --- Functions to show/hide sections and modals ---
function showLandingPage() {
  landingPage.style.display = 'flex';
  adminPanel.style.display = 'none';
  adminPasswordModal.style.display = 'none';
  document.body.classList.remove('admin-mode');
}

function showAdminPanel() {
  landingPage.style.display = 'none';
  adminPanel.style.display = 'block';
  adminPasswordModal.style.display = 'none';
  document.body.classList.add('admin-mode');
}

function openAdminPasswordModal() {
  adminPasswordModal.style.display = 'flex';
  adminPasswordInput.value = '';
  passwordError.style.display = 'none';
}

function closeAdminPasswordModal() {
  adminPasswordModal.style.display = 'none';
}

// --- Event Listeners ---
testBtn.addEventListener('click', () => {
  window.location.href = 'exam.html';
});

adminBtn.addEventListener('click', openAdminPasswordModal);

adminLoginBtn.addEventListener('click', () => {
  if (adminPasswordInput.value === ADMIN_PASSWORD) {
    showAdminPanel();
  } else {
    passwordError.textContent = 'Incorrect password. Please try again.';
    passwordError.style.display = 'block';
  }
});

adminPasswordInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    adminLoginBtn.click();
  }
});

// --- Initial Load ---
document.addEventListener('DOMContentLoaded', showLandingPage);

// --- Existing functions from index.html (to be moved here) ---
// These functions are currently defined as inline onclick attributes in index.html.
// They should be moved here and event listeners attached programmatically.
// For now, I'll just add placeholder functions to avoid errors.

function handleFileUpload(event) {
  console.log('File uploaded:', event.target.files[0].name);
  // Implement actual file handling logic here
  document.getElementById('loadingOverlay').style.display = 'flex';
  document.getElementById('loadingText').textContent = 'جاري تحليل الملف...';
  setTimeout(() => {
    document.getElementById('loadingOverlay').style.display = 'none';
    document.getElementById('questionsSection').style.display = 'block';
    // Simulate some question counts
    document.getElementById('tabAllCount').textContent = '20';
    document.getElementById('tabMCCount').textContent = '15';
    document.getElementById('tabTFCount').textContent = '5';
  }, 2000);
}

function reshuffleQuestions() {
  alert('خلط الأسئلة عشوائياً.');
}

function addNewQuestion() {
  alert('إضافة سؤال جديد.');
}

function resetAll() {
  alert('إعادة تعيين كل شيء ورفع ملف جديد.');
  showAdminPanel(); // Stay in admin panel after reset
  document.getElementById('questionsSection').style.display = 'none';
  document.getElementById('uploadSection').style.display = 'block';
}

function saveToFirebase() {
  alert('حفظ الأسئلة في Firebase.');
  document.getElementById('successModal').style.display = 'flex';
}

function filterQuestions(type) {
  alert('تصفية الأسئلة حسب النوع: ' + type);
  // Logic to filter questions
  document.querySelectorAll('.filter-tab').forEach(tab => tab.classList.remove('active'));
  document.getElementById('tab' + type.charAt(0).toUpperCase() + type.slice(1)).classList.add('active');
}

function closeSuccessModal() {
  document.getElementById('successModal').style.display = 'none';
}

function closeEditModal() {
  document.getElementById('editModal').style.display = 'none';
}

function saveEditedQuestion() {
  alert('حفظ السؤال المعدل.');
  document.getElementById('editModal').style.display = 'none';
}

// Example of how to open edit modal (this would be triggered by an edit button on a question)
// function openEditModal(questionId) {
//   document.getElementById('editModal').style.display = 'flex';
//   document.getElementById('editModalSubtitle').textContent = 'تعديل السؤال رقم ' + questionId;
//   // Populate modal with question data
// }
