// ============================================
//   FIREBASE CONFIGURATION
// ============================================
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

// Initialize Firebase Realtime Database once
let _db = null;
function getDB() {
  if (!_db) {
    if (!firebase.apps.length) {
      firebase.initializeApp(FIREBASE_CONFIG);
    }
    _db = firebase.database();
  }
  return _db;
}

// ============================================
//   GLOBAL STATE
// ============================================
let allQuestions = [];      // parsed & shuffled questions
let editingIndex = null;    // which question is being edited
let currentFilter = 'all';  // current filter tab
let isNavbarCollapsed = false;
const ACTIVE_EXAM_STORAGE_KEY = 'active-exam-questions';
const GROQ_API_KEY_STORAGE_KEY = 'groq-api-key';
const USE_GROQ_UPLOAD_KEY = 'use-groq-upload';
const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';

/** مفتاح Groq الافتراضي. أي مفتاح تُدخله وتضغط «حفظ» يُخزَّن في المتصفح ويستبدل هذا. لا تنشر المشروع علناً — المفتاح يظهر في المصدر. */
const DEFAULT_GROQ_API_KEY =
  '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';

function getGroqApiKey() {
  const saved = localStorage.getItem(GROQ_API_KEY_STORAGE_KEY);
  if (saved && String(saved).trim()) return String(saved).trim();
  return String(DEFAULT_GROQ_API_KEY || '').trim();
}

function persistActiveExamQuestions() {
  try {
    localStorage.setItem(ACTIVE_EXAM_STORAGE_KEY, JSON.stringify(allQuestions));
  } catch (error) {
    console.error('Failed to persist questions locally:', error);
  }
}

function clearActiveExamQuestions() {
  try {
    localStorage.removeItem(ACTIVE_EXAM_STORAGE_KEY);
  } catch (error) {
    console.error('Failed to clear persisted questions:', error);
  }
}

function restoreActiveExamQuestions() {
  try {
    const savedQuestions = localStorage.getItem(ACTIVE_EXAM_STORAGE_KEY);
    if (!savedQuestions) return;
    const parsedQuestions = JSON.parse(savedQuestions);
    if (!Array.isArray(parsedQuestions) || parsedQuestions.length === 0) return;
    allQuestions = parsedQuestions;
    renderQuestionsSection();
  } catch (error) {
    console.error('Failed to restore persisted questions:', error);
  }
}

// ============================================
//   DRAG & DROP UPLOAD
// ============================================
const uploadArea = document.getElementById('uploadArea');
const fileInput  = document.getElementById('fileInput');

uploadArea.addEventListener('dragover',  e => { e.preventDefault(); uploadArea.classList.add('drag-over'); });
uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('drag-over'));
uploadArea.addEventListener('drop', e => {
  e.preventDefault();
  uploadArea.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.name.endsWith('.docx')) processFile(file);
  else showToast('يرجى رفع ملف بصيغة .docx فقط', 'error');
});

// ============================================
//   FILE UPLOAD HANDLER
// ============================================
window.handleFileUpload = async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  processFile(file);
  fileInput.value = '';
};

function extractJsonArrayFromAssistantText(text) {
  const trimmed = String(text || '').trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const start = trimmed.indexOf('[');
  const end = trimmed.lastIndexOf(']');
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

function normalizeGroqQuestions(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const type = item.type === 'tf' ? 'tf' : 'mc';
    let question = String(item.question || '').trim();
    question = question.replace(/\s*##\s*$/, '').replace(/\s*\*+\s*$/, '').trim();
    if (!question) continue;
    let answers = Array.isArray(item.answers)
      ? item.answers.map((a) => String(a).trim()).filter(Boolean)
      : [];
    if (answers.length < 2) continue;
    let correctIndex = Number(item.correctIndex);
    if (
      !Number.isInteger(correctIndex) ||
      correctIndex < 0 ||
      correctIndex >= answers.length
    ) {
      if (item.correctAnswer != null && item.correctAnswer !== '') {
        const want = String(item.correctAnswer).trim();
        const found = answers.findIndex((a) => a === want);
        correctIndex = found >= 0 ? found : 0;
      } else {
        correctIndex = 0;
      }
    }
    out.push({
      type,
      question,
      answers,
      correctIndex,
      id: generateId(),
      sourceNumber: String(out.length + 1)
    });
  }
  return out;
}

async function fetchQuestionsFromGroq(rawText, apiKey) {
  const maxChars = 14000;
  const excerpt =
    rawText.length > maxChars
      ? rawText.slice(0, maxChars) +
        '\n\n[... تم اقتصار النص لحدود الطلب — راجع الملف أو قسّمه إذا كان طويلاً جداً]'
      : rawText;

  const systemPrompt = `أنت محلل أسئلة امتحانات عربية/إنجليزية. استخرج من النص كل الأسئلة وصنّفها بدقة.

مهم — أسئلة الاختيار من متعدد (mc):
- لا تشترط أن ينتهي سطر السؤال بـ ##. اعتمد على السياق: غالباً سطر أو أكثر يصف السؤال (قد ينتهي بـ ؟) ثم تليها أسطر الخيارات.
- قد يظهر ## في نهاية السؤال أحياناً؛ إن وُجد احذفه من نص السؤال في الحقل question.
- الإجابة الصحيحة قد تُعلَّم بـ: # في نهاية السطر، أو = في بداية السطر أو نهايته (مثل "= خيار" أو "خيار =")، وليس !=.
- الخيارات الخاطئة بدون علامة، أو بعلامات أخرى غير = للصحيح.

مهم — صح وخطأ (tf):
- سؤال ينتهي أحياناً بـ * أو ** ثم سطران للإجابتين، أو سؤال صيغته (صح/غلط، نعم/لا).
- الإجابة الصحيحة: = في البداية أو النهاية، أو !! في النهاية.
- الإجابة الخاطئة: != في البداية أو النهاية، أو ! في النهاية (وليس !!).

التصنيف:
- type "tf" لسؤال صحيح/خطأ أو نعم/لا أو True/False (خياران فقط).
- type "mc" لسؤال له عدة خيارات (3 فأكثر عادة).

أعد مصفوفة JSON فقط بدون markdown.
كل عنصر: {"type":"mc"|"tf","question":"...","answers":["..."],"correctIndex":0}
- answers: نصوص نظيفة بدون ## # = != !! ! في النص النهائي.
- correctIndex: مؤشر الإجابة الصحيحة (0-based).
إذا لم توجد أسئلة أعد [].`;

  const res = await fetch(GROQ_CHAT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: excerpt }
      ],
      temperature: 0.2,
      max_tokens: 8192
    })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      data.error?.message ||
      data.message ||
      `HTTP ${res.status}`;
    throw new Error(msg);
  }

  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('لا يوجد رد من النموذج');

  const jsonStr = extractJsonArrayFromAssistantText(content);
  const parsed = JSON.parse(jsonStr);
  return normalizeGroqQuestions(parsed);
}

async function processFile(file) {
  showLoading('جاري قراءة الملف...');
  try {
    const arrayBuffer = await file.arrayBuffer();
    setLoadingText('جاري استخراج النصوص...');
    const result = await mammoth.extractRawText({ arrayBuffer });
    setLoadingText('جاري تحليل الأسئلة...');
    const rawText = result.value;
    let questions = [];

    const groqKey = getGroqApiKey();
    const useGroq = localStorage.getItem(USE_GROQ_UPLOAD_KEY) === '1';

    if (groqKey && useGroq) {
      setLoadingText('جاري استخراج الأسئلة عبر الذكاء الاصطناعي (Groq)...');
      try {
        const aiQuestions = await fetchQuestionsFromGroq(rawText, groqKey);
        if (aiQuestions.length > 0) questions = aiQuestions;
      } catch (groqErr) {
        console.error(groqErr);
        showToast(
          'تنبيه: فشل Groq، يُجرى التحليل بالقواعد. ' +
            (groqErr.message || String(groqErr)),
          'warning'
        );
      }
    }

    if (questions.length === 0) {
      questions = parseQuestions(rawText);
    }

    if (questions.length === 0 && groqKey && !useGroq) {
      setLoadingText('جاري استخراج الأسئلة عبر الذكاء الاصطناعي (Groq)...');
      try {
        const aiQuestions = await fetchQuestionsFromGroq(rawText, groqKey);
        if (aiQuestions.length > 0) questions = aiQuestions;
      } catch (groqErr) {
        console.error(groqErr);
      }
    }

    if (questions.length === 0) {
      hideLoading();
      // Show first 300 chars of extracted text to help debug
      const preview = rawText.replace(/\s+/g, ' ').trim().slice(0, 300);
      console.warn('No questions found. Extracted text preview:', preview);
      showToast(
        'لم يتم العثور على أسئلة! فعّل «استخدم الذكاء الاصطناعي» لالتقاط الأسئلة بدون ##، أو استخدم القواعد: ## / # / = / != في بداية أو نهاية السطر.',
        'error'
      );
      return;
    }
    allQuestions = questions;
    persistActiveExamQuestions();
    setLoadingText('جاري تجهيز العرض...');
    setTimeout(() => {
      hideLoading();
      renderQuestionsSection();
      showToast(`تم استخراج ${questions.length} سؤال بنجاح!`, 'success');
    }, 300);
  } catch (err) {
    hideLoading();
    showToast('حدث خطأ أثناء قراءة الملف: ' + err.message, 'error');
    console.error(err);
  }
}

// ============================================
//   PARSER — extracts questions from raw text
// ============================================

// Helper: does this line mark an MCQ question?
// Accepts: "text ##"  "text?##"  "text ?##"  "1. text ##"
function isMCQuestion(line) {
  return /\S\s*##\s*$/.test(line);
}

// إجابة صحيحة للاختياري: تنتهي بـ # أو تبدأ بـ = (وليس !=)
function isMCCorrectTrailingHash(line) {
  return /\S\s*#\s*$/.test(line) && !/\S\s*##\s*$/.test(line);
}

function isLeadingEqualsCorrect(line) {
  const t = String(line).trim();
  return t.startsWith('=') && !t.startsWith('!=');
}

function isLeadingNotEqualsWrong(line) {
  return String(line).trim().startsWith('!=');
}

/** = في نهاية السطر (ليس !=) */
function isTrailingEqualsCorrect(line) {
  const t = String(line).trim();
  if (t.endsWith('!=')) return false;
  return t.endsWith('=');
}

/** != في نهاية السطر */
function isTrailingNotEqualsWrong(line) {
  return String(line).trim().endsWith('!=');
}

function stripMCCorrectAnswerText(line) {
  const t = String(line).trim();
  if (isLeadingEqualsCorrect(line)) return stripAnswerPrefix(t.replace(/^=\s*/, '').trim());
  if (isTrailingEqualsCorrect(line)) return stripAnswerPrefix(t.replace(/\s*=\s*$/, '').trim());
  return stripMarker(line, '#');
}

function stripTfTrailingEqMarkers(s) {
  let t = String(s).trim();
  if (t.endsWith('!=')) return t.slice(0, -2).trim();
  if (t.endsWith('=')) return t.slice(0, -1).trim();
  return t;
}

// Helper: does this line mark a TF question?
// - ينتهي بـ ** (علامة صح/خطأ صريحة) أو بـ * (قديم)
function isTFQuestion(line) {
  if (/\S\s*\*\*\s*$/.test(line)) return true;
  if (/\S\s*\*\s*$/.test(line)) return true;
  return false;
}

function stripTFQuestionMarker(line) {
  if (/\S\s*\*\*\s*$/.test(line)) return stripMarker(line, '**');
  return stripMarker(line, '*');
}

// صح/خطأ: صحيح = في بداية السطر، أو !! في النهاية (قديم)
function isTFCorrectTrailing(line) {
  return /\S\s*!!\s*$/.test(line);
}

function isTFWrongTrailing(line) {
  return /\S\s*!\s*$/.test(line) && !/\S\s*!!\s*$/.test(line);
}

function stripTFCorrectAnswerText(line) {
  const t = String(line).trim();
  if (isLeadingEqualsCorrect(line)) return stripAnswerPrefix(t.replace(/^=\s*/, '').trim());
  if (isTrailingEqualsCorrect(line)) return stripAnswerPrefix(t.replace(/\s*=\s*$/, '').trim());
  return stripAnswerPrefix(stripMarker(line, '!!'));
}

function stripTFWrongAnswerText(line) {
  const t = String(line).trim();
  if (isLeadingNotEqualsWrong(line)) return stripAnswerPrefix(t.replace(/^!=\s*/, '').trim());
  if (isTrailingNotEqualsWrong(line)) return stripAnswerPrefix(t.replace(/\s*!=\s*$/, '').trim());
  return stripAnswerPrefix(stripMarker(line, '!'));
}

// Remove trailing marker(s) and clean text
function stripMarker(line, marker) {
  // Remove the trailing marker (with optional spaces around it)
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return line.replace(new RegExp('\\s*' + escaped + '\\s*$'), '').trim();
}

// Extract leading question number like "1." "1)" "Q1." etc.
function extractLeadingNumber(text) {
  const match = text.match(/^\s*(?:Q\s*)?(\d+)[\.\)]\s*(.*)$/i);
  if (!match) {
    return { number: null, text: text.trim() };
  }
  return { number: match[1], text: match[2].trim() };
}

// Skip "Answer: ..." lines and similar annotation lines
function isAnnotationLine(line) {
  return /^(answer|الاجابة|الإجابة|الجواب)\s*:/i.test(line);
}

// Numbered question style: 1. ... / 1) ... / Q1. ...
function isNumberedQuestionStart(line) {
  return /^\s*(?:Q\s*)?\d+[\.\)]\s+\S/.test(line);
}

function stripAnswerPrefix(line) {
  // Remove common option prefixes: A) / A. / a- / 1) / 1. / - / •
  return line
    .replace(/^\s*[A-Za-z][\)\.\-:]\s+/, '')
    .replace(/^\s*\d+[\)\.\-:]\s+/, '')
    .replace(/^\s*[-•]\s+/, '')
    .trim();
}

function stripTfTrailingMarkers(s) {
  return String(s)
    .replace(/\s*!!\s*$/, '')
    .replace(/\s*!\s*$/, '')
    .trim();
}

function stripTfLeadingEqMarkers(s) {
  let t = String(s).trim();
  if (t.startsWith('!=')) return t.slice(2).trim();
  if (t.startsWith('=')) return t.slice(1).trim();
  return t;
}

function normalizeTfToken(text) {
  const t = stripTfTrailingMarkers(
    stripTfTrailingEqMarkers(stripTfLeadingEqMarkers(String(text)))
  )
    .trim()
    .toLowerCase()
    .replace(/[٫٬،.?!؟]/g, '')
    .replace(/\s+/g, ' ');
  if (t.startsWith('صحيح') || t === 'صح' || t === 'ص') return 'صحيح';
  if (t.startsWith('خطأ') || t.startsWith('غلط') || t.startsWith('خطا')) return 'خطأ';
  if (t === 'true' || t === 't') return 'true';
  if (t === 'false' || t === 'f') return 'false';
  if (t === 'نعم' || t === 'yes' || t === 'y') return 'نعم';
  if (t === 'لا' || t === 'no' || t === 'n') return 'لا';
  return t;
}

function isTrueFalsePair(answers) {
  if (!Array.isArray(answers) || answers.length !== 2) return false;
  const a = normalizeTfToken(answers[0]);
  const b = normalizeTfToken(answers[1]);
  const tfPairs = [
    ['true', 'false'],
    ['false', 'true'],
    ['صحيح', 'خطأ'],
    ['خطأ', 'صحيح'],
    ['صح', 'غلط'],
    ['غلط', 'صح'],
    ['نعم', 'لا'],
    ['لا', 'نعم'],
    ['yes', 'no'],
    ['no', 'yes']
  ];
  return tfPairs.some(([x, y]) => a === x && b === y);
}

/** صح/خطأ: زوج !! و ! أو زوج = و != (في بداية أو نهاية السطر) */
function hasTfMarkerPair(answers, hadTrueMarker, hadFalseMarker, hadEqMarker, hadNeMarker) {
  if (answers.length === 2 && hadEqMarker && hadNeMarker) return true;
  if (hadTrueMarker && hadFalseMarker && answers.length === 2) return true;
  return false;
}

function parseQuestions(text) {
  const questions = [];

  // Normalize line endings and split
  const rawLines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  // Trim each line
  const lines = rawLines.map(l => l.trim());

  // Debug output
  console.log('=== EXTRACTED TEXT ===');
  console.log(lines.join('\n'));
  console.log('=== END ===');

  // Helper: peek forward past blank lines, return index of next non-blank line (-1 if none)
  function nextNonBlank(from) {
    let j = from;
    while (j < lines.length && !lines[j]) j++;
    return j < lines.length ? j : -1;
  }

  // Helper: should we stop collecting answers?
  // Stop only when the next meaningful line is a new question (or end of file)
  function shouldStop(from) {
    const next = nextNonBlank(from);
    if (next === -1) return true;                      // end of text
    if (isAnnotationLine(lines[next])) return false;   // annotation — keep going (will skip it)
    if (isMCQuestion(lines[next])) return true;        // next question starts
    if (isTFQuestion(lines[next])) return true;        // next TF question starts
    if (isNumberedQuestionStart(lines[next])) return true; // next numbered question starts
    return false;                                      // still an answer line
  }

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Skip empty and annotation lines at top level
    if (!line || isAnnotationLine(line)) { i++; continue; }

    // ── Numbered Question (fallback without markers) ──
    if (isNumberedQuestionStart(line) && !isMCQuestion(line) && !isTFQuestion(line)) {
      const parsedQuestion = extractLeadingNumber(line);
      const questionText = parsedQuestion.text;
      i++;

      const answers = [];
      let correctIndex = -1;
      let hadTfTrueMarker = false;
      let hadTfFalseMarker = false;
      let hadEqMarker = false;
      let hadNeMarker = false;

      while (i < lines.length) {
        const aLine = lines[i];

        if (!aLine) {
          if (shouldStop(i + 1)) { i++; break; }
          i++;
          continue;
        }

        if (isMCQuestion(aLine) || isTFQuestion(aLine) || isNumberedQuestionStart(aLine)) break;
        if (isAnnotationLine(aLine)) { i++; continue; }

        if (isLeadingNotEqualsWrong(aLine)) {
          hadTfFalseMarker = true;
          hadNeMarker = true;
          const answerText = stripTFWrongAnswerText(aLine);
          if (answerText) answers.push(answerText);
        } else if (isTrailingNotEqualsWrong(aLine)) {
          hadTfFalseMarker = true;
          hadNeMarker = true;
          const answerText = stripTFWrongAnswerText(aLine);
          if (answerText) answers.push(answerText);
        } else if (isLeadingEqualsCorrect(aLine)) {
          hadTfTrueMarker = true;
          hadEqMarker = true;
          const answerText = stripMCCorrectAnswerText(aLine);
          if (answerText) {
            correctIndex = answers.length;
            answers.push(answerText);
          }
        } else if (isTrailingEqualsCorrect(aLine)) {
          hadTfTrueMarker = true;
          hadEqMarker = true;
          const answerText = stripMCCorrectAnswerText(aLine);
          if (answerText) {
            correctIndex = answers.length;
            answers.push(answerText);
          }
        } else if (isMCCorrectTrailingHash(aLine)) {
          const answerText = stripAnswerPrefix(stripMarker(aLine, '#'));
          if (answerText) {
            correctIndex = answers.length;
            answers.push(answerText);
          }
        } else if (isTFCorrectTrailing(aLine)) {
          hadTfTrueMarker = true;
          const answerText = stripAnswerPrefix(stripMarker(aLine, '!!'));
          if (answerText) {
            correctIndex = answers.length;
            answers.push(answerText);
          }
        } else if (isTFWrongTrailing(aLine)) {
          hadTfFalseMarker = true;
          const answerText = stripAnswerPrefix(stripMarker(aLine, '!'));
          if (answerText) answers.push(answerText);
        } else {
          const answerText = stripAnswerPrefix(aLine);
          if (answerText) answers.push(answerText);
        }
        i++;
      }

      // If it has no answers, treat it as normal text and skip it.
      if (!questionText || answers.length === 0) {
        continue;
      }

      if (correctIndex === -1) correctIndex = 0;
      const type =
        hasTfMarkerPair(
          answers,
          hadTfTrueMarker,
          hadTfFalseMarker,
          hadEqMarker,
          hadNeMarker
        ) || isTrueFalsePair(answers)
          ? 'tf'
          : 'mc';

      questions.push({
        type,
        question: questionText,
        answers,
        correctIndex,
        id: generateId(),
        sourceNumber: parsedQuestion.number
      });
      continue;
    }

    // ── MCQ Question ──────────────────────────────────
    if (isMCQuestion(line)) {
      const rawText = line; // Keep markers like ##
      const parsedQuestion = extractLeadingNumber(rawText);
      const questionText = parsedQuestion.text;
      i++;
      const answers = [];
      let correctIndex = -1;

      while (i < lines.length) {
        const aLine = lines[i];

        if (!aLine) {
          if (shouldStop(i + 1)) { i++; break; }
          i++; continue;
        }

        if (isMCQuestion(aLine) || isTFQuestion(aLine)) break;
        if (isAnnotationLine(aLine)) { i++; continue; }

        // Determine if it's a correct answer using available markers
        if (isLeadingEqualsCorrect(aLine) || isTrailingEqualsCorrect(aLine) || isMCCorrectTrailingHash(aLine)) {
          correctIndex = answers.length;
          answers.push(aLine); // Keep markers like # or =
        } else {
          answers.push(aLine);
        }
        i++;
      }

      if (questionText && answers.length > 0) {
        if (correctIndex === -1) correctIndex = 0;
        const qType =
          answers.length === 2 && isTrueFalsePair(answers) ? 'tf' : 'mc';
        questions.push({
          type: qType,
          question: questionText,
          answers,
          correctIndex,
          id: generateId(),
          sourceNumber: parsedQuestion.number
        });
      }
      continue;
    }

    // ── TF Question ───────────────────────────────────
    if (isTFQuestion(line)) {
      let rawText = line; // Keep markers like ! or !! or *
      let isForcedTrue = false;
      let isForcedFalse = false;

      // Detect !! (True) first
      if (/\S\s*!!\s*$/.test(line)) {
        isForcedTrue = true;
      } 
      // Detect ! (False) second
      else if (/\S\s*!\s*$/.test(line)) {
        isForcedFalse = true;
      }
      
      const parsedQuestion = extractLeadingNumber(rawText);
      const questionText = parsedQuestion.text;
      i++;
      const answers = [];
      let correctIndex = -1;

      while (i < lines.length) {
        const aLine = lines[i];

        if (!aLine) {
          if (shouldStop(i + 1)) { i++; break; }
          i++; continue;
        }

        if (isMCQuestion(aLine) || isTFQuestion(aLine) || isNumberedQuestionStart(aLine)) break;
        if (isAnnotationLine(aLine)) { i++; continue; }

        // Determine if it's a correct answer using available markers
        if (isLeadingEqualsCorrect(aLine) || isTrailingEqualsCorrect(aLine) || isTFCorrectTrailing(aLine)) {
          correctIndex = answers.length;
          answers.push(aLine); // Keep markers like !! or =
        } else {
          answers.push(aLine);
        }
        i++;
      }

      // If no answers provided, use defaults and forced logic
      if (answers.length === 0) {
        answers.push('True');
        answers.push('False');
        if (isForcedTrue) correctIndex = 0;
        else if (isForcedFalse) correctIndex = 1;
        else correctIndex = 0; 
      } else {
        if (correctIndex === -1) {
          if (isForcedTrue) correctIndex = 0;
          else if (isForcedFalse) correctIndex = 1;
          else correctIndex = 0;
        }
      }

      if (questionText) {
        questions.push({
          type: 'tf',
          question: questionText,
          answers,
          correctIndex,
          id: generateId(),
          sourceNumber: parsedQuestion.number
        });
      }
      continue;
    }

    i++;
  }

  return questions;
}

// ============================================
//   SHUFFLE
// ============================================
function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function shuffleQuestions(questions) {
  return shuffleArray(questions).map(q => {
    // Shuffle answers but keep track of correct one
    const indices = q.answers.map((_, i) => i);
    const shuffled = shuffleArray(indices);
    const newAnswers = shuffled.map(i => q.answers[i]);
    const newCorrectIndex = shuffled.indexOf(q.correctIndex);
    return { ...q, answers: newAnswers, correctIndex: newCorrectIndex };
  });
}

window.reshuffleQuestions = () => {
  allQuestions = shuffleQuestions(allQuestions);
  persistActiveExamQuestions();
  renderQuestionsList();
  showToast('تم خلط الأسئلة والإجابات عشوائياً', 'info');
};

// ============================================
//   RENDER
// ============================================
function renderQuestionsSection() {
  document.getElementById('uploadSection').style.display = 'none';
  document.getElementById('questionsSection').style.display = 'block';
  
  // Apply collapse state to all header components
  const displayStyle = isNavbarCollapsed ? 'none' : 'flex';
  document.getElementById('headerTopActions').style.display = displayStyle;
  document.getElementById('headerNavbar').style.display = isNavbarCollapsed ? 'none' : 'flex';
  
  document.getElementById('navbarToggleBtn').style.display = 'flex';
  document.getElementById('navbarToggleBtn').classList.toggle('collapsed', isNavbarCollapsed);
  
  updateTabCounts();
  renderQuestionsList();
}

function updateTabCounts() {
  const mc = allQuestions.filter(q => q.type === 'mc').length;
  const tf = allQuestions.filter(q => q.type === 'tf').length;
  document.getElementById('tabAllCount').textContent = allQuestions.length;
  document.getElementById('tabMCCount').textContent = mc;
  document.getElementById('tabTFCount').textContent = tf;
}

function getFilteredQuestions() {
  if (currentFilter === 'mc') return allQuestions.filter(q => q.type === 'mc');
  if (currentFilter === 'tf') return allQuestions.filter(q => q.type === 'tf');
  return allQuestions;
}

function renderQuestionsList() {
  const list = document.getElementById('questionsList');
  const filtered = getFilteredQuestions();
  list.innerHTML = '';

  if (filtered.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="10"/>
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
          <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
        <h3>لا توجد أسئلة في هذا القسم</h3>
        <p>جرب تبويباً آخر أو أضف أسئلة جديدة</p>
      </div>`;
    return;
  }

  filtered.forEach((q, filteredIdx) => {
    const globalIdx = allQuestions.indexOf(q);
    const card = createQuestionCard(q, globalIdx, filteredIdx + 1);
    list.appendChild(card);
  });
}

function createQuestionCard(q, globalIdx, displayNum) {
  const card = document.createElement('div');
  card.className = `question-card ${q.type}`;
  card.id = `question-card-${globalIdx}`;
  card.style.animationDelay = `${(displayNum - 1) * 0.05}s`;
  const questionNumber = q.sourceNumber || displayNum;

  const typeLabel = q.type === 'mc' ? 'اختيار من متعدد' : 'صح / غلط';
  const typeIcon  = q.type === 'mc'
    ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`;

  const answersHTML = q.answers.map((ans, i) => {
    const isCorrect = i === q.correctIndex;
    const label = String.fromCharCode(65 + i);
    return `
      <div class="answer-item ${isCorrect ? 'correct' : ''}">
        <div class="answer-marker">${label}</div>
        <span>${escapeHtml(ans)}</span>
        ${isCorrect ? '<span class="correct-label">✓ الإجابة الصحيحة</span>' : ''}
      </div>`;
  }).join('');

  card.innerHTML = `
    <div class="question-header">
      <div class="question-meta">
        <div class="question-type-badge">${typeIcon} ${typeLabel}</div>
        <div class="question-line">
          <div class="question-number">${questionNumber}</div>
          <div class="question-text">${escapeHtml(q.question)}</div>
        </div>
      </div>
      <div class="question-actions">
        <button class="icon-btn" title="تعديل" onclick="openEditModal(${globalIdx})">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
        <button class="icon-btn delete" title="حذف" onclick="deleteQuestion(${globalIdx})">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
            <path d="M10 11v6M14 11v6"/>
            <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
          </svg>
        </button>
      </div>
    </div>
    <div class="answers-list">${answersHTML}</div>`;

  return card;
}

// ============================================
//   FILTER
// ============================================
window.filterQuestions = (filter) => {
  currentFilter = filter;
  document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
  
  // Normalize ID for selector (handles All, MC, TF)
  const tabId = `tab${filter.toUpperCase()}`;
  const tabElement = document.getElementById(tabId);
  if (tabElement) tabElement.classList.add('active');
  
  renderQuestionsList();
};

// ============================================
//   DELETE QUESTION
// ============================================
window.deleteQuestion = (globalIdx) => {
  allQuestions.splice(globalIdx, 1);
  persistActiveExamQuestions();
  updateTabCounts();
  renderQuestionsList();
  showToast('تم حذف السؤال', 'warning');
};

// ============================================
//   EDIT MODAL
// ============================================
window.openEditModal = (globalIdx) => {
  editingIndex = globalIdx;
  const q = allQuestions[globalIdx];
  const subtitle = q.type === 'mc' ? 'سؤال اختيار من متعدد' : 'سؤال صح / غلط';
  document.getElementById('editModalSubtitle').textContent = subtitle;

  const body = document.getElementById('editModalBody');
  body.innerHTML = '';

  // Question text
  const qGroup = document.createElement('div');
  qGroup.className = 'form-group';
  qGroup.innerHTML = `
    <label>نص السؤال</label>
    <textarea class="form-textarea" id="editQuestionText">${escapeHtml(q.question)}</textarea>`;
  body.appendChild(qGroup);

  // Answers
  const aLabel = document.createElement('div');
  aLabel.className = 'edit-section-label';
  aLabel.textContent = 'الإجابات (حدد الإجابة الصحيحة بالنقر على الزر الدائري)';
  body.appendChild(aLabel);

  const answersContainer = document.createElement('div');
  answersContainer.id = 'editAnswersContainer';
  answersContainer.style.display = 'flex';
  answersContainer.style.flexDirection = 'column';
  answersContainer.style.gap = '8px';
  body.appendChild(answersContainer);

  renderEditAnswers(q, answersContainer);

  // Add answer button (for MCQ)
  if (q.type === 'mc') {
    const addBtn = document.createElement('button');
    addBtn.className = 'add-answer-btn';
    addBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> إضافة إجابة`;
    addBtn.onclick = () => {
      const q2 = allQuestions[editingIndex];
      q2.answers.push('');
      renderEditAnswers(q2, answersContainer);
    };
    body.appendChild(addBtn);
  }

  document.getElementById('editModal').style.display = 'flex';
};

function renderEditAnswers(q, container) {
  container.innerHTML = '';
  q.answers.forEach((ans, i) => {
    const row = document.createElement('div');
    row.className = `answer-edit-row ${i === q.correctIndex ? 'correct-row' : ''}`;
    row.innerHTML = `
      <input type="radio" name="editCorrect" value="${i}" ${i === q.correctIndex ? 'checked' : ''} 
             onchange="setCorrectAnswer(${i})" title="تحديد كإجابة صحيحة" />
      <input type="text" class="form-input" value="${escapeHtml(ans)}" 
             placeholder="أدخل نص الإجابة..." 
             oninput="updateAnswerText(${i}, this.value)" />
      ${q.answers.length > 2 ? `
        <button class="btn btn-danger-ghost" style="padding:6px 10px" onclick="removeAnswer(${i})" title="حذف الإجابة">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>` : ''}`;
    container.appendChild(row);
  });
}

window.setCorrectAnswer = (i) => {
  allQuestions[editingIndex].correctIndex = i;
  const container = document.getElementById('editAnswersContainer');
  document.querySelectorAll('.answer-edit-row').forEach((row, idx) => {
    row.classList.toggle('correct-row', idx === i);
  });
};

window.updateAnswerText = (i, value) => {
  allQuestions[editingIndex].answers[i] = value;
};

window.removeAnswer = (i) => {
  const q = allQuestions[editingIndex];
  if (q.answers.length <= 2) return;
  q.answers.splice(i, 1);
  if (q.correctIndex >= q.answers.length) q.correctIndex = q.answers.length - 1;
  const container = document.getElementById('editAnswersContainer');
  renderEditAnswers(q, container);
};

window.saveEditedQuestion = () => {
  const q = allQuestions[editingIndex];
  const newText = document.getElementById('editQuestionText').value.trim();
  if (!newText) { showToast('نص السؤال لا يمكن أن يكون فارغاً', 'error'); return; }
  // Filter empty answers
  const validAnswers = q.answers.filter(a => a.trim());
  if (validAnswers.length < 2) { showToast('يجب أن يكون هناك إجابتان على الأقل', 'error'); return; }
  // Adjust correct index if answers filtered
  const newCorrectIndex = Math.min(q.correctIndex, validAnswers.length - 1);
  allQuestions[editingIndex] = { ...q, question: newText, answers: validAnswers, correctIndex: newCorrectIndex };
  persistActiveExamQuestions();
  closeEditModal();
  updateTabCounts();
  renderQuestionsList();
  showToast('تم تحديث السؤال بنجاح', 'success');
};

window.closeEditModal = () => {
  document.getElementById('editModal').style.display = 'none';
  editingIndex = null;
};

// ============================================
//   ADD NEW QUESTION
// ============================================
window.addNewQuestion = () => {
  const newQ = {
    id: generateId(),
    type: 'mc',
    question: 'سؤال جديد',
    answers: ['إجابة أولى', 'إجابة ثانية', 'إجابة ثالثة', 'إجابة رابعة'],
    correctIndex: 0,
    sourceNumber: String(allQuestions.length + 1)
  };
  allQuestions.unshift(newQ);
  persistActiveExamQuestions();
  updateTabCounts();
  renderQuestionsList();
  setTimeout(() => openEditModal(0), 200);
};

// ============================================
//   RESET
// ============================================
window.resetAll = () => {
  allQuestions = [];
  currentFilter = 'all';
  isNavbarCollapsed = false;
  clearActiveExamQuestions();
  document.getElementById('headerNavbar').style.display = 'none';
  document.getElementById('headerTopActions').style.display = 'none';
  document.getElementById('navbarToggleBtn').style.display = 'none';
  document.getElementById('navbarToggleBtn').classList.remove('collapsed');
  document.getElementById('questionsSection').style.display = 'none';
  document.getElementById('uploadSection').style.display = 'flex';
};

// ============================================
//   FIREBASE SAVE
// ============================================
window.saveToFirebase = async () => {
  if (allQuestions.length === 0) {
    showToast('لا توجد أسئلة للحفظ', 'error');
    return;
  }
  await doSaveToFirebase();
};

// No longer needed but kept for backward compat
window.closeFirebaseModal = () => {
  document.getElementById('firebaseModal').style.display = 'none';
};

window.confirmSaveToFirebase = () => doSaveToFirebase();

async function doSaveToFirebase() {
  showLoading('جاري الاتصال بـ Firebase...');
  try {
    const db = getDB();
    setLoadingText('جاري حفظ الأسئلة...');

    const examData = {
      savedAt: new Date().toISOString(),
      totalQuestions: allQuestions.length,
      mcCount: allQuestions.filter(q => q.type === 'mc').length,
      tfCount: allQuestions.filter(q => q.type === 'tf').length,
      questions: allQuestions.map(q => ({
        id: q.id,
        type: q.type,
        question: q.question,
        answers: q.answers,
        correctIndex: q.correctIndex,
        correctAnswer: q.answers[q.correctIndex]
      }))
    };

    // Timeout after 15 seconds
    const refPath = db.ref(FIRESTORE_COLLECTION);
    const savePromise = refPath.push(examData);
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), 15000)
    );

    const snap = await Promise.race([savePromise, timeoutPromise]);

    hideLoading();
    document.getElementById('successMessage').textContent =
      `تم حفظ ${allQuestions.length} سؤال في قاعدة البيانات بنجاح! (ID: ${snap.key})`;
    document.getElementById('successModal').style.display = 'flex';

  } catch (err) {
    hideLoading();
    console.error('Firebase error:', err);
    if (err.message === 'timeout' || (err.message && err.message.includes('permission'))) {
      showToast('⚠️ تأكد من أن قواعد قاعدة البيانات تسمح بالكتابة', 'error');
    } else {
      showToast('فشل الحفظ: ' + err.message, 'error');
    }
  }
}

function showFirestoreInstructions() {
  const existing = document.getElementById('firestoreHelp');
  if (existing) return;

  const help = document.createElement('div');
  help.id = 'firestoreHelp';
  help.style.cssText = `
    position:fixed; bottom:90px; left:50%; transform:translateX(-50%);
    background:#1a1a35; border:1px solid rgba(108,99,255,0.4); border-radius:16px;
    padding:20px 24px; z-index:400; max-width:480px; width:90%;
    box-shadow:0 20px 60px rgba(0,0,0,0.6); direction:rtl;
  `;
  help.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
      <strong style="color:#f0f0ff;font-size:1rem">🔧 إصلاح قواعد Firestore</strong>
      <button onclick="document.getElementById('firestoreHelp').remove()"
        style="background:none;border:none;color:#9090b8;font-size:1.2rem;cursor:pointer">✕</button>
    </div>
    <p style="color:#9090b8;font-size:0.85rem;margin-bottom:14px;line-height:1.7">
      اذهب إلى <strong style="color:#b0a9ff">Firebase Console</strong> ← Firestore Database ← Rules<br>
      وضع هذا الكود:
    </p>
    <pre style="background:#0a0a1a;padding:12px;border-radius:8px;color:#4dffc3;font-size:0.8rem;overflow-x:auto;border:1px solid rgba(0,212,170,0.2)">rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}</pre>
    <p style="color:#ffa726;font-size:0.75rem;margin-top:10px">
      ⚠️ هذا للتطوير فقط — عدّل القواعد قبل النشر الرسمي
    </p>
    <div style="margin-top:12px">
      <a href="https://console.firebase.google.com/project/video-52a71/firestore/rules"
         target="_blank"
         style="display:inline-flex;align-items:center;gap:6px;background:linear-gradient(135deg,#6c63ff,#5a52e0);
                color:white;padding:8px 16px;border-radius:8px;text-decoration:none;font-size:0.85rem;font-weight:600">
        🔗 افتح Firebase Rules مباشرة
      </a>
    </div>
  `;
  document.body.appendChild(help);
}

window.closeSuccessModal = () => {
  document.getElementById('successModal').style.display = 'none';
};

// (Firebase config is now hardcoded in FIREBASE_CONFIG above)

// ============================================
//   LOADING HELPERS
// ============================================
function showLoading(text = 'جاري التحميل...') {
  document.getElementById('loadingText').textContent = text;
  document.getElementById('loadingOverlay').style.display = 'flex';
}

function setLoadingText(text) {
  document.getElementById('loadingText').textContent = text;
}

function hideLoading() {
  document.getElementById('loadingOverlay').style.display = 'none';
}

// ============================================
//   TOAST NOTIFICATIONS
// ============================================
function showToast(msg, type = 'info') {
  const container = document.getElementById('toastContainer');
  const icons = {
    success: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`,
    error:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
    warning: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    info:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`
  };

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `${icons[type] || icons.info} <span>${msg}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'toastOut 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ============================================
//   UTILITIES
// ============================================
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toggleScrollTopButton() {
  const button = document.getElementById('scrollTopBtn');
  if (!button) return;
  const shouldShow = window.scrollY > 320;
  button.classList.toggle('visible', shouldShow);
}

window.scrollToTop = () => {
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

window.toggleNavbar = () => {
  isNavbarCollapsed = !isNavbarCollapsed;
  const navbar = document.getElementById('headerNavbar');
  const actions = document.getElementById('headerTopActions');
  const toggleButton = document.getElementById('navbarToggleBtn');
  
  const displayStyle = isNavbarCollapsed ? 'none' : 'flex';
  
  if (navbar) navbar.style.display = displayStyle;
  if (actions) actions.style.display = displayStyle;
  
  if (toggleButton) {
    toggleButton.classList.toggle('collapsed', isNavbarCollapsed);
  }
};

// Close modals on overlay click
document.getElementById('firebaseModal').addEventListener('click', function(e) {
  if (e.target === this) closeFirebaseModal();
});
document.getElementById('editModal').addEventListener('click', function(e) {
  if (e.target === this) closeEditModal();
});
document.getElementById('successModal').addEventListener('click', function(e) {
  if (e.target === this) closeSuccessModal();
});

function initGroqUploadUi() {
  const cb = document.getElementById('useGroqCheckbox');
  const inp = document.getElementById('groqApiKeyInput');
  const btn = document.getElementById('saveGroqKeyBtn');
  if (!cb || !inp || !btn) return;

  if (localStorage.getItem(USE_GROQ_UPLOAD_KEY) === null && DEFAULT_GROQ_API_KEY) {
    localStorage.setItem(USE_GROQ_UPLOAD_KEY, '1');
  }
  cb.checked = localStorage.getItem(USE_GROQ_UPLOAD_KEY) === '1';

  const savedOverride = localStorage.getItem(GROQ_API_KEY_STORAGE_KEY);
  const hasEmbedded = !!String(DEFAULT_GROQ_API_KEY || '').trim();
  inp.placeholder = savedOverride
    ? 'مفتاح محفوظ في المتصفح — الصق مفتاحاً جديداً للاستبدال'
    : hasEmbedded
      ? 'يُستخدم المفتاح المضمّن في الكود — الصق مفتاحاً ليُحفظ في المتصفح'
      : 'مفتاح Groq (يبدأ عادة بـ gsk_)';

  cb.addEventListener('change', () => {
    localStorage.setItem(USE_GROQ_UPLOAD_KEY, cb.checked ? '1' : '0');
  });

  btn.addEventListener('click', () => {
    const v = inp.value.trim();
    if (!v) {
      showToast('الصق المفتاح أولاً', 'error');
      return;
    }
    localStorage.setItem(GROQ_API_KEY_STORAGE_KEY, v);
    inp.value = '';
    inp.placeholder = 'مفتاح محفوظ في المتصفح — الصق مفتاحاً جديداً للاستبدال';
    showToast('تم حفظ المفتاح في المتصفح (يستبدل المضمّن في الكود)', 'success');
  });
}

document.addEventListener('DOMContentLoaded', restoreActiveExamQuestions);
document.addEventListener('DOMContentLoaded', toggleScrollTopButton);
document.addEventListener('DOMContentLoaded', initGroqUploadUi);
window.addEventListener('scroll', toggleScrollTopButton);
