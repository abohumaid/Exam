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
const ACTIVE_FIREBASE_EXAM_KEY_STORAGE_KEY = 'active-firebase-exam-key';
const GROQ_API_KEY_STORAGE_KEY = 'groq-api-key';
const USE_GROQ_UPLOAD_KEY = 'use-groq-upload';
const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';
let firebaseAutoSyncInProgress = false;
let firebaseAutoSyncPending = false;

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
    allQuestions = normalizeQuestionsForDisplay(parsedQuestions);
    persistActiveExamQuestions();
    renderQuestionsSection();
  } catch (error) {
    console.error('Failed to restore persisted questions:', error);
  }
}

function normalizeQuestionsForDisplay(questions) {
  if (!Array.isArray(questions)) return [];
  return questions.map((question) => {
    if (!question || typeof question !== 'object') return question;
    if (question.type !== 'tf') return question;
    const normalized = canonicalizeTFAnswers(question.answers, question.correctIndex);
    return {
      ...question,
      answers: normalized.answers,
      correctIndex: normalized.correctIndex
    };
  });
}

function getActiveFirebaseExamKey() {
  try {
    const key = localStorage.getItem(ACTIVE_FIREBASE_EXAM_KEY_STORAGE_KEY);
    return key ? String(key).trim() : '';
  } catch (error) {
    console.error('Failed to read active Firebase exam key:', error);
    return '';
  }
}

function setActiveFirebaseExamKey(key) {
  try {
    const cleaned = String(key || '').trim();
    if (!cleaned) {
      localStorage.removeItem(ACTIVE_FIREBASE_EXAM_KEY_STORAGE_KEY);
      return;
    }
    localStorage.setItem(ACTIVE_FIREBASE_EXAM_KEY_STORAGE_KEY, cleaned);
  } catch (error) {
    console.error('Failed to persist active Firebase exam key:', error);
  }
}

function clearActiveFirebaseExamKey() {
  try {
    localStorage.removeItem(ACTIVE_FIREBASE_EXAM_KEY_STORAGE_KEY);
  } catch (error) {
    console.error('Failed to clear active Firebase exam key:', error);
  }
}

function withTimeout(promise, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timeoutId);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
  });
}

function buildExamDataSnapshot() {
  return {
    savedAt: new Date().toISOString(),
    totalQuestions: allQuestions.length,
    mcCount: allQuestions.filter((q) => q.type === 'mc').length,
    tfCount: allQuestions.filter((q) => q.type === 'tf').length,
    questions: allQuestions.map((q) => ({
      id: q.id,
      type: q.type,
      question: q.question,
      answers: q.answers,
      correctIndex: q.correctIndex,
      correctAnswer: q.answers[q.correctIndex]
    }))
  };
}

function formatFirebaseSyncError(error) {
  const message = String(error?.message || error || '');
  if (!message) return 'خطأ غير معروف';
  if (message === 'timeout') return 'انتهت مهلة الاتصال بقاعدة البيانات';
  return message;
}

async function writeExamSnapshotToFirebase(options = {}) {
  const forceNew = !!options.forceNew;
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 15000;
  const db = getDB();
  const examData = buildExamDataSnapshot();
  const collectionRef = db.ref(FIRESTORE_COLLECTION);
  let examKey = forceNew ? '' : getActiveFirebaseExamKey();
  let targetRef = null;

  if (examKey) {
    targetRef = collectionRef.child(examKey);
  } else {
    targetRef = collectionRef.push();
    examKey = targetRef.key;
  }

  await withTimeout(targetRef.set(examData), timeoutMs);
  setActiveFirebaseExamKey(examKey);
  return { key: examKey, totalQuestions: examData.totalQuestions };
}

function queueAutoSyncToFirebase(changeLabel = 'التعديل') {
  const runSync = async () => {
    if (firebaseAutoSyncInProgress) {
      firebaseAutoSyncPending = true;
      return;
    }

    firebaseAutoSyncInProgress = true;
    try {
      do {
        firebaseAutoSyncPending = false;
        await writeExamSnapshotToFirebase({ forceNew: false, timeoutMs: 12000 });
      } while (firebaseAutoSyncPending);
    } catch (error) {
      console.error('Auto sync to Firebase failed:', error);
      showToast(
        `تم ${changeLabel} محلياً، لكن فشل تحديث قاعدة البيانات: ${formatFirebaseSyncError(error)}`,
        'warning'
      );
    } finally {
      firebaseAutoSyncInProgress = false;
    }
  };

  runSync();
}

// ============================================
//   DRAG & DROP UPLOAD
// ============================================
const uploadArea = document.getElementById('uploadArea');
const fileInput  = document.getElementById('fileInput');
let nextUploadForceNoAi = false;
let nextUploadAppendMode = false;

window.startFilePicker = (withoutAI = false, appendMode = false) => {
  nextUploadForceNoAi = !!withoutAI;
  nextUploadAppendMode = !!appendMode;
  fileInput.click();
};

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
  const forceNoAI = nextUploadForceNoAi;
  const appendMode = nextUploadAppendMode;
  nextUploadForceNoAi = false;
  nextUploadAppendMode = false;
  processFile(file, { forceNoAI, appendMode });
  fileInput.value = '';
};

window.importManualQuestions = async (appendMode = true) => {
  const input = document.getElementById('manualQuestionsInput');
  if (!input) return;
  const rawText = String(input.value || '').trim();
  if (!rawText) {
    showToast('اكتب الأسئلة والإجابات أولاً داخل مربع النص', 'error');
    return;
  }

  showLoading('جاري تحليل النص المدخل...');
  try {
    const result = await processRawTextImport(rawText, {
      forceNoAI: true,
      appendMode: !!appendMode,
      sourceLabel: 'النص المدخل'
    });
    if (result?.ok) input.value = '';
  } catch (error) {
    clearImportProgressBanner();
    hideLoading();
    showToast('حدث خطأ أثناء تحليل النص: ' + (error.message || String(error)), 'error');
    console.error(error);
  }
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

function cleanText(text) {
  if (!text) return '';
  // Replace multiple spaces and newlines with a single space
  return String(text).replace(/\s+/g, ' ').trim();
}

function normalizeArabicDigits(text) {
  return String(text || '')
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)));
}

function joinTextParts(parts) {
  return cleanText((Array.isArray(parts) ? parts : []).filter(Boolean).join(' '));
}

function isGroqRateLimitError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return (
    message.includes('rate limit') ||
    message.includes('limit reached') ||
    message.includes('http 429') ||
    message.includes('rate_limit')
  );
}

function normalizeGroqQuestions(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const type = item.type === 'tf' ? 'tf' : 'mc';
    let question = cleanText(item.question || '');
    question = question.replace(/\s*##\s*$/, '').replace(/\s*\*+\s*$/, '').trim();
    if (!question) continue;
    let answers = Array.isArray(item.answers)
      ? item.answers.map((a) => cleanText(a)).filter(Boolean)
      : [];
    if (answers.length < 2) continue;
    let correctIndex = Number(item.correctIndex);
    if (
      !Number.isInteger(correctIndex) ||
      correctIndex < 0 ||
      correctIndex >= answers.length
    ) {
      if (item.correctAnswer != null && item.correctAnswer !== '') {
        const want = cleanText(item.correctAnswer);
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
      sourceNumber: item.sourceNumber || null
    });
  }
  return out;
}

function splitTextIntoGroqChunks(rawText, maxChars = 4500, overlapChars = 700) {
  const normalizedText = String(rawText || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();

  if (!normalizedText) return [];
  if (normalizedText.length <= maxChars) return [normalizedText];

  const chunks = [];
  let start = 0;

  while (start < normalizedText.length) {
    let end = Math.min(start + maxChars, normalizedText.length);

    if (end < normalizedText.length) {
      const windowText = normalizedText.slice(start, end);
      const breakPatterns = ['\n\n', '\n', '؟ ', '? ', '. '];

      for (const pattern of breakPatterns) {
        const lastIndex = windowText.lastIndexOf(pattern);
        if (lastIndex > maxChars * 0.6) {
          end = start + lastIndex + pattern.length;
          break;
        }
      }
    }

    const chunk = normalizedText.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= normalizedText.length) break;

    const nextStart = Math.max(0, end - overlapChars);
    start = nextStart > start ? nextStart : end;
  }

  return chunks;
}

function buildQuestionFingerprint(question) {
  if (!question || typeof question !== 'object') return '';

  const normalizePart = (value) =>
    cleanText(String(value || ''))
      .toLowerCase()
      .replace(/[^\w\u0600-\u06FF\s]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  return [
    question.type === 'tf' ? 'tf' : 'mc',
    normalizePart(question.question),
    ...(Array.isArray(question.answers) ? question.answers.map(normalizePart) : [])
  ].join(' || ');
}

function dedupeQuestions(questions) {
  const seen = new Set();
  const uniqueQuestions = [];

  for (const question of questions) {
    const fingerprint = buildQuestionFingerprint(question);
    if (!fingerprint || seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    uniqueQuestions.push(question);
  }

  return uniqueQuestions;
}

function hasSavedGroqApiKey() {
  const saved = localStorage.getItem(GROQ_API_KEY_STORAGE_KEY);
  return !!(saved && String(saved).trim());
}

function normalizeParsingLine(text) {
  try {
    return String(text || '').normalize('NFKC');
  } catch (error) {
    return String(text || '');
  }
}

function isOptionPrefixedAnswer(line) {
  const text = normalizeParsingLine(line).trim();
  if (!text) return false;

  if (/^\s*(?:\(?[A-Za-z]\)|[A-Za-z][\)\.\-:]|\(?[أ-ي]\)|[أ-ي][\)\.\-:])\s*\S/.test(text)) {
    return true;
  }

  if (/^\s*(?:\(?\d+\)|\d+[\)\.\-:\/])\s*\S/.test(normalizeArabicDigits(text))) {
    return true;
  }

  return false;
}

function isUnnumberedMCQuestionStart(line, nextLine = '') {
  const text = cleanText(normalizeParsingLine(line));
  const next = cleanText(normalizeParsingLine(nextLine));
  if (!text || !next || isAnnotationLine(text)) return false;
  if (isMCQuestion(text) || isTFQuestion(text) || isNumberedQuestionStart(text)) return false;
  if (isLikelyAnswerLine(text)) return false;
  if (!/[؟?]\s*$/.test(text)) return false;
  return isOptionPrefixedAnswer(next);
}

function isQuestionStartCandidate(line, nextLine = '') {
  const text = String(line || '').trim();
  if (!text || isAnnotationLine(text)) return false;
  if (isMCQuestion(text) || isTFQuestion(text) || isNumberedQuestionStart(text)) return true;
  if (isUnnumberedMCQuestionStart(text, nextLine)) return true;
  if (/[؟?]\s*$/.test(text) && isLikelyAnswerLine(nextLine)) return true;
  return false;
}

function splitLongTextPreservingLines(text, maxChars = 12000) {
  const rawLines = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const parts = [];
  let currentLines = [];
  let currentLength = 0;

  const flush = () => {
    if (!currentLines.length) return;
    const value = currentLines.join('\n').trim();
    if (value) parts.push(value);
    currentLines = [];
    currentLength = 0;
  };

  for (const rawLine of rawLines) {
    const line = String(rawLine || '').trimEnd();
    const lineLength = line.length + 1;

    if (currentLines.length && currentLength + lineLength > maxChars) {
      flush();
    }

    currentLines.push(line);
    currentLength += lineLength;
  }

  flush();
  return parts;
}

function buildQuestionBlocks(rawText) {
  const rawLines = String(rawText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const blocks = [];
  let currentBlock = [];
  let sawQuestionStart = false;

  function nextNonBlankLine(fromIndex) {
    for (let index = fromIndex; index < rawLines.length; index++) {
      const value = String(rawLines[index] || '').trim();
      if (value) return value;
    }
    return '';
  }

  for (let index = 0; index < rawLines.length; index++) {
    const trimmedLine = String(rawLines[index] || '').trim();

    if (!trimmedLine) {
      if (sawQuestionStart && currentBlock.length) currentBlock.push('');
      continue;
    }

    const nextLine = nextNonBlankLine(index + 1);
    if (isQuestionStartCandidate(trimmedLine, nextLine)) {
      if (currentBlock.length) {
        const blockText = currentBlock.join('\n').trim();
        if (blockText) blocks.push(blockText);
      }
      currentBlock = [trimmedLine];
      sawQuestionStart = true;
      continue;
    }

    if (sawQuestionStart) {
      currentBlock.push(trimmedLine);
    }
  }

  if (currentBlock.length) {
    const blockText = currentBlock.join('\n').trim();
    if (blockText) blocks.push(blockText);
  }

  return blocks;
}

function splitTextIntoUploadBatches(rawText, maxBlocks = 35, maxChars = 12000) {
  const blocks = buildQuestionBlocks(rawText);
  const batches = [];
  let currentBatchBlocks = [];
  let currentBatchLength = 0;

  function flushBatch() {
    if (!currentBatchBlocks.length) return;
    batches.push({
      text: currentBatchBlocks.join('\n\n').trim(),
      estimatedQuestions: currentBatchBlocks.length
    });
    currentBatchBlocks = [];
    currentBatchLength = 0;
  }

  const sourceBlocks = blocks.length
    ? blocks
    : splitLongTextPreservingLines(rawText, maxChars);

  for (const originalBlock of sourceBlocks) {
    const blockParts =
      originalBlock.length > maxChars
        ? splitLongTextPreservingLines(originalBlock, maxChars)
        : [originalBlock];

    for (const blockText of blockParts) {
      const normalizedBlock = String(blockText || '').trim();
      if (!normalizedBlock) continue;

      const projectedLength =
        currentBatchLength + normalizedBlock.length + (currentBatchBlocks.length ? 2 : 0);

      if (
        currentBatchBlocks.length &&
        (currentBatchBlocks.length >= maxBlocks || projectedLength > maxChars)
      ) {
        flushBatch();
      }

      currentBatchBlocks.push(normalizedBlock);
      currentBatchLength += normalizedBlock.length + (currentBatchBlocks.length > 1 ? 2 : 0);
    }
  }

  flushBatch();

  if (batches.length === 0) {
    return [
      {
        text: String(rawText || '').trim(),
        estimatedQuestions: 0
      }
    ];
  }

  return batches;
}

function ensureImportProgressBanner() {
  const questionsSection = document.getElementById('questionsSection');
  if (!questionsSection) return null;

  let banner = document.getElementById('importProgressBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'importProgressBanner';
    banner.style.cssText = [
      'display:flex',
      'flex-direction:column',
      'gap:8px',
      'padding:16px 18px',
      'margin-bottom:18px',
      'border-radius:18px',
      'background:linear-gradient(135deg, rgba(41,89,255,0.16), rgba(0,188,212,0.12))',
      'border:1px solid rgba(116,166,255,0.28)',
      'box-shadow:0 16px 40px rgba(0,0,0,0.16)'
    ].join(';');
    banner.innerHTML = `
      <div id="importProgressTitle" style="font-size:1rem;font-weight:700;color:#f4f8ff"></div>
      <div id="importProgressMeta" style="font-size:0.92rem;color:#d7e5ff"></div>
      <div style="width:100%;height:10px;border-radius:999px;background:rgba(255,255,255,0.12);overflow:hidden">
        <div id="importProgressBar" style="width:0%;height:100%;border-radius:999px;background:linear-gradient(90deg,#5bc0ff,#6ef3c5);transition:width .25s ease"></div>
      </div>
    `;
    questionsSection.prepend(banner);
  }

  return banner;
}

function updateImportProgressBanner(currentPart, totalParts, totalQuestions, addedInPart) {
  const banner = ensureImportProgressBanner();
  if (!banner) return;

  const safeTotal = Math.max(totalParts || 1, 1);
  const percentage = Math.min(100, Math.round((currentPart / safeTotal) * 100));
  const title = document.getElementById('importProgressTitle');
  const meta = document.getElementById('importProgressMeta');
  const bar = document.getElementById('importProgressBar');

  if (title) {
    title.textContent =
      currentPart >= safeTotal
        ? 'اكتمل رفع جميع أجزاء الملف'
        : `جاري رفع الجزء ${currentPart} من ${safeTotal} إلى صفحة الأدمن`;
  }

  if (meta) {
    meta.textContent =
      `تمت إضافة ${totalQuestions} سؤال حتى الآن` +
      (typeof addedInPart === 'number'
        ? `، منها ${addedInPart} سؤال في الجزء الحالي`
        : '');
  }

  if (bar) {
    bar.style.width = `${percentage}%`;
  }
}

function clearImportProgressBanner(delayMs = 0) {
  const removeBanner = () => {
    const banner = document.getElementById('importProgressBanner');
    if (banner) banner.remove();
  };

  if (delayMs > 0) {
    setTimeout(removeBanner, delayMs);
    return;
  }

  removeBanner();
}

async function fetchQuestionsFromGroq(rawText, apiKey) {
  const chunks = splitTextIntoGroqChunks(rawText);
  if (chunks.length === 0) return [];

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

  const collectedQuestions = [];

  for (let index = 0; index < chunks.length; index++) {
    if (chunks.length > 1) {
      setLoadingText(
        `جاري استخراج الأسئلة عبر الذكاء الاصطناعي (Groq)... الجزء ${index + 1} من ${chunks.length}`
      );
    }

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
          {
            role: 'user',
            content:
              `استخرج كل الأسئلة الموجودة في هذا الجزء فقط من الملف، ولا تتجاهل أي سؤال واضح.\n` +
              `الجزء ${index + 1} من ${chunks.length}:\n\n${chunks[index]}`
          }
        ],
        temperature: 0.2,
        max_tokens: 2400
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
    collectedQuestions.push(...normalizeGroqQuestions(parsed));
  }

  return dedupeQuestions(collectedQuestions);
}

async function processRawTextImport(rawText, options = {}) {
  const forceNoAI = !!options.forceNoAI;
  const appendMode = !!options.appendMode;
  const sourceLabel = String(options.sourceLabel || 'المصدر');
  const previousQuestions = Array.isArray(allQuestions) ? [...allQuestions] : [];
  const previousFirebaseExamKey = getActiveFirebaseExamKey();
  let workingQuestions = appendMode ? [...previousQuestions] : [];
  let groqRateLimited = false;
  let warnedAboutGroqFailure = false;
  let hasShownQuestionsSection = false;

  const groqKey = getGroqApiKey();
  const useGroq = !forceNoAI && localStorage.getItem(USE_GROQ_UPLOAD_KEY) === '1';
  const allowGroqFallback = !forceNoAI && (useGroq || hasSavedGroqApiKey());
  const uploadBatches = splitTextIntoUploadBatches(rawText);

  if (!appendMode) {
    allQuestions = [];
    currentFilter = 'all';
    clearActiveExamQuestions();
    clearActiveFirebaseExamKey();
  }
  clearImportProgressBanner();

  if (forceNoAI) {
    setLoadingText('جاري التحليل المحلي بدون استخدام الذكاء الاصطناعي...');
  } else if (uploadBatches.length > 1) {
    setLoadingText(
      appendMode
        ? `تم تقسيم ${sourceLabel} إلى ${uploadBatches.length} أجزاء، جاري الإضافة...`
        : `تم تقسيم ${sourceLabel} إلى ${uploadBatches.length} أجزاء، جاري الرفع...`
    );
  } else {
    setLoadingText(appendMode ? 'جاري إضافة الأسئلة على الموجود...' : 'جاري تحليل الأسئلة...');
  }

  for (let batchIndex = 0; batchIndex < uploadBatches.length; batchIndex++) {
    const batch = uploadBatches[batchIndex];
    let batchQuestions = [];

    setLoadingText(
      uploadBatches.length > 1
        ? `جاري تجهيز الجزء ${batchIndex + 1} من ${uploadBatches.length}...`
        : appendMode
          ? 'جاري إضافة الأسئلة على الموجود...'
          : 'جاري تحليل الأسئلة...'
    );

    if (groqKey && useGroq && !groqRateLimited) {
      try {
        batchQuestions = await fetchQuestionsFromGroq(batch.text, groqKey);
      } catch (groqErr) {
        groqRateLimited = isGroqRateLimitError(groqErr);
        if (groqRateLimited) {
          localStorage.setItem(USE_GROQ_UPLOAD_KEY, '0');
          const groqCheckbox = document.getElementById('useGroqCheckbox');
          if (groqCheckbox) groqCheckbox.checked = false;
        }
        console.error(groqErr);
        if (!warnedAboutGroqFailure) {
          showToast(
            groqRateLimited
              ? 'تم تجاوز الحد اليومي لمفتاح Groq الحالي، وسيتم المتابعة بالتحليل المحلي.'
              : 'تنبيه: فشل Groq، وسيتم المتابعة بالقواعد المحلية.',
            'warning'
          );
          warnedAboutGroqFailure = true;
        }
      }
    }

    if (batchQuestions.length === 0) {
      batchQuestions = parseQuestions(batch.text);
    }

    if (batchQuestions.length === 0 && groqKey && allowGroqFallback && !useGroq && !groqRateLimited) {
      try {
        batchQuestions = await fetchQuestionsFromGroq(batch.text, groqKey);
      } catch (groqErr) {
        groqRateLimited = groqRateLimited || isGroqRateLimitError(groqErr);
        console.error(groqErr);
      }
    }

    const previousCount = workingQuestions.length;
    workingQuestions = dedupeQuestions([...workingQuestions, ...batchQuestions]);
    allQuestions = workingQuestions;
    const addedInPart = workingQuestions.length - previousCount;
    persistActiveExamQuestions();

    if (!hasShownQuestionsSection) {
      hideLoading();
      renderQuestionsSection();
      hasShownQuestionsSection = true;
    } else {
      updateTabCounts();
      renderQuestionsList();
    }

    updateImportProgressBanner(
      batchIndex + 1,
      uploadBatches.length,
      workingQuestions.length,
      addedInPart
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const totalAdded = workingQuestions.length - (appendMode ? previousQuestions.length : 0);

  if (workingQuestions.length === 0) {
    clearImportProgressBanner();
    if (!appendMode && previousQuestions.length > 0) {
      allQuestions = previousQuestions;
      persistActiveExamQuestions();
      setActiveFirebaseExamKey(previousFirebaseExamKey);
      updateTabCounts();
      renderQuestionsList();
    } else if (!appendMode) {
      clearActiveFirebaseExamKey();
    }
    if (!hasShownQuestionsSection) hideLoading();
    const preview = String(rawText || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    console.warn('No questions found. Extracted text preview:', preview);
    showToast(
      forceNoAI
        ? 'لم يتم العثور على أسئلة بالتحليل المحلي. تأكد من تنسيق العلامات: = للصحيح و != للخطأ.'
        : groqRateLimited
          ? 'تعذر استخدام Groq لأن الحد اليومي للمفتاح الحالي انتهى، كما أن التحليل المحلي لم يفهم التنسيق بالكامل.'
          : 'لم يتم العثور على أسئلة! استخدم تنسيق العلامات: = للإجابة الصحيحة و != للإجابة الخاطئة.',
      'error'
    );
    return { ok: false, added: 0, total: allQuestions.length };
  }

  if (appendMode && totalAdded <= 0) {
    clearImportProgressBanner();
    updateTabCounts();
    renderQuestionsList();
    showToast(`لم يتم العثور على أسئلة جديدة لإضافتها من ${sourceLabel}.`, 'warning');
    return { ok: false, added: 0, total: workingQuestions.length };
  }

  if (!hasShownQuestionsSection) {
    hideLoading();
    renderQuestionsSection();
  } else {
    updateTabCounts();
    renderQuestionsList();
  }

  updateImportProgressBanner(
    uploadBatches.length,
    uploadBatches.length,
    workingQuestions.length,
    0
  );

  showToast(
    appendMode
      ? `تمت إضافة ${totalAdded} سؤال على الموجود (الإجمالي الآن ${workingQuestions.length}).`
      : uploadBatches.length > 1
        ? `تم رفع ${sourceLabel} بالكامل على ${uploadBatches.length} أجزاء، بعدد ${workingQuestions.length} سؤال.`
        : forceNoAI
          ? `تم استخراج ${workingQuestions.length} سؤال بدون استخدام الذكاء الاصطناعي.`
          : `تم استخراج ${workingQuestions.length} سؤال بنجاح!`,
    'success'
  );
  clearImportProgressBanner(2500);
  return { ok: true, added: appendMode ? totalAdded : workingQuestions.length, total: workingQuestions.length };
}

async function processFile(file, options = {}) {
  showLoading('جاري قراءة الملف...');
  try {
    const arrayBuffer = await file.arrayBuffer();
    setLoadingText('جاري استخراج النصوص...');
    const result = await mammoth.extractRawText({ arrayBuffer });
    const rawText = result.value;
    return await processRawTextImport(rawText, {
      ...options,
      sourceLabel: file?.name || 'الملف'
    });
  } catch (err) {
    clearImportProgressBanner();
    hideLoading();
    showToast('حدث خطأ أثناء قراءة الملف: ' + err.message, 'error');
    console.error(err);
    return { ok: false, added: 0, total: allQuestions.length };
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

function hasTfEqMarker(line) {
  return isTrailingEqualsCorrect(line) || isTrailingNotEqualsWrong(line);
}

function parseStandaloneTfQuestion(line, nextLine = '') {
  const sourceLine = String(line || '').trim();
  if (!sourceLine || !hasTfEqMarker(sourceLine)) return null;
  if (isOptionPrefixedAnswer(sourceLine) && !isNumberedQuestionStart(sourceLine)) return null;
  if (isMCQuestion(sourceLine) || isTFQuestion(sourceLine)) return null;

  const stripped = stripTfTrailingEqMarkers(sourceLine).trim();
  if (!stripped) return null;

  const looksLikeQuestion =
    isNumberedQuestionStart(stripped) ||
    /[؟?]\s*$/.test(stripped) ||
    stripped.length >= 8;
  if (!looksLikeQuestion) return null;

  const next = String(nextLine || '').trim();
  const nextLooksLikeStandaloneTf =
    hasTfEqMarker(next) && !isOptionPrefixedAnswer(next);
  if (
    next &&
    !isNumberedQuestionStart(next) &&
    !isMCQuestion(next) &&
    !isTFQuestion(next) &&
    isLikelyAnswerLine(next) &&
    !nextLooksLikeStandaloneTf
  ) {
    return null;
  }

  const parsedQuestion = extractLeadingNumber(stripped);
  const questionText = cleanText(parsedQuestion.text);
  if (!questionText) return null;

  const correctIndex = isTrailingNotEqualsWrong(sourceLine) ? 1 : 0;
  return {
    type: 'tf',
    question: questionText,
    answers: ['True', 'False'],
    correctIndex,
    id: generateId(),
    sourceNumber: parsedQuestion.number
  };
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
  const normalizedText = normalizeArabicDigits(text);
  const match = normalizedText.match(/^\s*(?:Q\s*|س\s*)?(\d+)\s*[\.\)\-\/:]\s*(.*)$/i);
  if (!match) {
    return { number: null, text: String(text || '').trim() };
  }
  return { number: match[1], text: match[2].trim() };
}

// Skip "Answer: ..." lines and similar annotation lines
function isAnnotationLine(line) {
  return /^(answer|الاجابة|الإجابة|الجواب)\s*:/i.test(line);
}

// Numbered question style: 1. ... / 1) ... / Q1. ...
function isNumberedQuestionStart(line) {
  const normalizedLine = normalizeArabicDigits(line);
  return /^\s*(?:Q\s*|س\s*)?\d+\s*[\.\)\-\/:]\s*\S/.test(normalizedLine);
}

function stripAnswerPrefix(line) {
  // Remove common option prefixes: A) / A. / a- / 1) / 1. / - / •
  return normalizeParsingLine(line)
    .replace(/^\s*(?:\(?[A-Za-z]\)|[A-Za-z][\)\.\-:]|\(?[أ-ي]\)|[أ-ي][\)\.\-:])\s*/, '')
    .replace(/^\s*(?:\(?\d+\)|\d+[\)\.\-:\/])\s*/, '')
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

function canonicalizeTFAnswers(answers, correctIndex) {
  const cleanedAnswers = Array.isArray(answers)
    ? answers.map((answer) => cleanText(answer)).filter(Boolean)
    : [];

  const fallbackIndex = Number.isInteger(correctIndex) && correctIndex >= 0 ? correctIndex : 0;

  if (cleanedAnswers.length !== 2) {
    return {
      answers: ['True', 'False'],
      correctIndex: fallbackIndex === 1 ? 1 : 0
    };
  }

  const trueTokens = new Set(['true', 'صحيح', 'نعم']);
  const falseTokens = new Set(['false', 'خطأ', 'لا']);
  const firstToken = normalizeTfToken(cleanedAnswers[0]);
  const secondToken = normalizeTfToken(cleanedAnswers[1]);

  const isTrueFalsePair =
    (trueTokens.has(firstToken) && falseTokens.has(secondToken)) ||
    (falseTokens.has(firstToken) && trueTokens.has(secondToken));

  if (!isTrueFalsePair) {
    return {
      answers: ['True', 'False'],
      correctIndex: fallbackIndex === 1 ? 1 : 0
    };
  }

  const sourceTrueIndex = trueTokens.has(firstToken) ? 0 : 1;
  const sourceCorrect = fallbackIndex;
  const correctIsTrue = sourceCorrect === sourceTrueIndex;

  return {
    answers: ['True', 'False'],
    correctIndex: correctIsTrue ? 0 : 1
  };
}

function isLikelyAnswerLine(line) {
  const text = normalizeParsingLine(line).trim();
  if (!text) return false;

  if (
    isLeadingEqualsCorrect(text) ||
    isLeadingNotEqualsWrong(text) ||
    isTrailingEqualsCorrect(text) ||
    isTrailingNotEqualsWrong(text) ||
    isMCCorrectTrailingHash(text) ||
    isTFCorrectTrailing(text) ||
    isTFWrongTrailing(text)
  ) {
    return true;
  }

  if (isOptionPrefixedAnswer(text)) {
    return true;
  }

  const token = normalizeTfToken(text);
  return ['true', 'false', 'صحيح', 'خطأ', 'نعم', 'لا'].includes(token);
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
  const normalizedText = normalizeArabicDigits(
    String(text || '').replace(/\u00A0/g, ' ')
  );
  const rawLines = normalizedText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

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
    const nextAfter = nextNonBlank(next + 1);
    const nextLine = lines[next];
    const followingLine = nextAfter >= 0 ? lines[nextAfter] : '';
    if (parseStandaloneTfQuestion(nextLine, followingLine)) return true;
    if (isUnnumberedMCQuestionStart(nextLine, followingLine)) return true;
    return false;                                      // still an answer line
  }

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Skip empty and annotation lines at top level
    if (!line || isAnnotationLine(line)) { i++; continue; }

    // ── Standalone TF Question (question line ends with = or !=) ──
    const nextLineIndex = nextNonBlank(i + 1);
    const nextLine = nextLineIndex >= 0 ? lines[nextLineIndex] : '';
    const standaloneTf = parseStandaloneTfQuestion(line, nextLine);
    if (standaloneTf) {
      questions.push(standaloneTf);
      i++;
      continue;
    }

    // ── Unnumbered MCQ (question line + A/B/C/D answers) ──
    if (isUnnumberedMCQuestionStart(line, nextLine)) {
      const questionParts = [line];
      i++;

      const answers = [];
      let correctIndex = -1;

      while (i < lines.length) {
        const aLine = lines[i];

        if (!aLine) {
          if (shouldStop(i + 1)) { i++; break; }
          i++;
          continue;
        }

        const aNextLineIndex = nextNonBlank(i + 1);
        const aNextLine = aNextLineIndex >= 0 ? lines[aNextLineIndex] : '';
        if (answers.length > 0 && parseStandaloneTfQuestion(aLine, aNextLine)) break;
        if (answers.length > 0 && isUnnumberedMCQuestionStart(aLine, aNextLine)) break;
        if (isMCQuestion(aLine) || isTFQuestion(aLine) || isNumberedQuestionStart(aLine)) break;
        if (isAnnotationLine(aLine)) { i++; continue; }

        if (answers.length === 0 && !isLikelyAnswerLine(aLine)) {
          questionParts.push(cleanText(aLine));
          i++;
          continue;
        }

        if (isLeadingNotEqualsWrong(aLine) || isTrailingNotEqualsWrong(aLine)) {
          const wrongText = stripTFWrongAnswerText(aLine);
          if (wrongText) answers.push(cleanText(wrongText));
        } else if (
          isLeadingEqualsCorrect(aLine) ||
          isTrailingEqualsCorrect(aLine) ||
          isMCCorrectTrailingHash(aLine)
        ) {
          const correctText = stripMCCorrectAnswerText(aLine);
          if (correctText) {
            correctIndex = answers.length;
            answers.push(cleanText(correctText));
          }
        } else {
          const answerText = stripAnswerPrefix(aLine);
          if (answerText) {
            if (answers.length > 0 && !isLikelyAnswerLine(aLine)) {
              answers[answers.length - 1] = cleanText(
                `${answers[answers.length - 1]} ${answerText}`
              );
            } else {
              answers.push(cleanText(answerText));
            }
          }
        }
        i++;
      }

      const questionText = joinTextParts(questionParts);
      if (questionText && answers.length > 0) {
        if (correctIndex === -1) correctIndex = 0;
        const qType = answers.length === 2 && isTrueFalsePair(answers) ? 'tf' : 'mc';
        const normalized = qType === 'tf'
          ? canonicalizeTFAnswers(answers, correctIndex)
          : { answers, correctIndex };
        questions.push({
          type: qType,
          question: questionText,
          answers: normalized.answers,
          correctIndex: normalized.correctIndex,
          id: generateId(),
          sourceNumber: null
        });
      }
      continue;
    }

    // ── Numbered Question (fallback without markers) ──
    if (isNumberedQuestionStart(line) && !isMCQuestion(line) && !isTFQuestion(line)) {
      const parsedQuestion = extractLeadingNumber(line);
      const questionParts = [parsedQuestion.text];
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

        const aNextLineIndex = nextNonBlank(i + 1);
        const aNextLine = aNextLineIndex >= 0 ? lines[aNextLineIndex] : '';
        if (answers.length > 0 && parseStandaloneTfQuestion(aLine, aNextLine)) break;
        if (answers.length > 0 && isUnnumberedMCQuestionStart(aLine, aNextLine)) break;
        if (isMCQuestion(aLine) || isTFQuestion(aLine) || isNumberedQuestionStart(aLine)) break;
        if (isAnnotationLine(aLine)) { i++; continue; }

        if (answers.length === 0 && !isLikelyAnswerLine(aLine)) {
          questionParts.push(cleanText(aLine));
          i++;
          continue;
        }

        if (isLeadingNotEqualsWrong(aLine)) {
          hadTfFalseMarker = true;
          hadNeMarker = true;
          const answerText = stripTFWrongAnswerText(aLine);
          if (answerText) answers.push(cleanText(answerText));
        } else if (isTrailingNotEqualsWrong(aLine)) {
          hadTfFalseMarker = true;
          hadNeMarker = true;
          const answerText = stripTFWrongAnswerText(aLine);
          if (answerText) answers.push(cleanText(answerText));
        } else if (isLeadingEqualsCorrect(aLine)) {
          hadTfTrueMarker = true;
          hadEqMarker = true;
          const answerText = stripMCCorrectAnswerText(aLine);
          if (answerText) {
            correctIndex = answers.length;
            answers.push(cleanText(answerText));
          }
        } else if (isTrailingEqualsCorrect(aLine)) {
          hadTfTrueMarker = true;
          hadEqMarker = true;
          const answerText = stripMCCorrectAnswerText(aLine);
          if (answerText) {
            correctIndex = answers.length;
            answers.push(cleanText(answerText));
          }
        } else if (isMCCorrectTrailingHash(aLine)) {
          const answerText = stripAnswerPrefix(stripMarker(aLine, '#'));
          if (answerText) {
            correctIndex = answers.length;
            answers.push(cleanText(answerText));
          }
        } else if (isTFCorrectTrailing(aLine)) {
          hadTfTrueMarker = true;
          const answerText = stripAnswerPrefix(stripMarker(aLine, '!!'));
          if (answerText) {
            correctIndex = answers.length;
            answers.push(cleanText(answerText));
          }
        } else if (isTFWrongTrailing(aLine)) {
          hadTfFalseMarker = true;
          const answerText = stripAnswerPrefix(stripMarker(aLine, '!'));
          if (answerText) answers.push(cleanText(answerText));
        } else {
          const answerText = stripAnswerPrefix(aLine);
          if (answerText) {
            if (answers.length > 0 && !isLikelyAnswerLine(aLine)) {
              answers[answers.length - 1] = cleanText(
                `${answers[answers.length - 1]} ${answerText}`
              );
            } else {
              answers.push(cleanText(answerText));
            }
          }
        }
        i++;
      }

      const questionText = joinTextParts(questionParts);

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
      const normalized = type === 'tf'
        ? canonicalizeTFAnswers(answers, correctIndex)
        : { answers, correctIndex };

      questions.push({
        type,
        question: questionText,
        answers: normalized.answers,
        correctIndex: normalized.correctIndex,
        id: generateId(),
        sourceNumber: parsedQuestion.number
      });
      continue;
    }

    // ── MCQ Question ──────────────────────────────────
    if (isMCQuestion(line)) {
      const rawText = line; // Keep markers like ##
      const parsedQuestion = extractLeadingNumber(rawText);
      const questionText = cleanText(parsedQuestion.text);
      i++;
      const answers = [];
      let correctIndex = -1;

      while (i < lines.length) {
        const aLine = lines[i];

        if (!aLine) {
          if (shouldStop(i + 1)) { i++; break; }
          i++; continue;
        }

        const aNextLineIndex = nextNonBlank(i + 1);
        const aNextLine = aNextLineIndex >= 0 ? lines[aNextLineIndex] : '';
        if (answers.length > 0 && parseStandaloneTfQuestion(aLine, aNextLine)) break;
        if (answers.length > 0 && isUnnumberedMCQuestionStart(aLine, aNextLine)) break;
        if (isMCQuestion(aLine) || isTFQuestion(aLine)) break;
        if (isAnnotationLine(aLine)) { i++; continue; }

        // Prefer "=" marker at the end for MC correct answers
        if (isLeadingNotEqualsWrong(aLine) || isTrailingNotEqualsWrong(aLine)) {
          const wrongText = stripTFWrongAnswerText(aLine);
          if (wrongText) answers.push(cleanText(wrongText));
        } else if (
          isLeadingEqualsCorrect(aLine) ||
          isTrailingEqualsCorrect(aLine) ||
          isMCCorrectTrailingHash(aLine)
        ) {
          const correctText = stripMCCorrectAnswerText(aLine);
          if (correctText) {
            correctIndex = answers.length;
            answers.push(cleanText(correctText));
          }
        } else {
          const answerText = stripAnswerPrefix(aLine);
          if (answerText) answers.push(cleanText(answerText));
        }
        i++;
      }

      if (questionText && answers.length > 0) {
        if (correctIndex === -1) correctIndex = 0;
        const qType =
          answers.length === 2 && isTrueFalsePair(answers) ? 'tf' : 'mc';
        const normalized = qType === 'tf'
          ? canonicalizeTFAnswers(answers, correctIndex)
          : { answers, correctIndex };
        questions.push({
          type: qType,
          question: questionText,
          answers: normalized.answers,
          correctIndex: normalized.correctIndex,
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
      const questionText = cleanText(parsedQuestion.text);
      i++;
      const answers = [];
      let correctIndex = -1;

      while (i < lines.length) {
        const aLine = lines[i];

        if (!aLine) {
          if (shouldStop(i + 1)) { i++; break; }
          i++; continue;
        }

        const aNextLineIndex = nextNonBlank(i + 1);
        const aNextLine = aNextLineIndex >= 0 ? lines[aNextLineIndex] : '';
        if (answers.length > 0 && isUnnumberedMCQuestionStart(aLine, aNextLine)) break;
        if (isMCQuestion(aLine) || isTFQuestion(aLine) || isNumberedQuestionStart(aLine)) break;
        if (isAnnotationLine(aLine)) { i++; continue; }

        // Prefer "=" (true) and "!=" (false) markers
        if (isLeadingNotEqualsWrong(aLine) || isTrailingNotEqualsWrong(aLine) || isTFWrongTrailing(aLine)) {
          const wrongText = stripTFWrongAnswerText(aLine);
          if (wrongText) answers.push(cleanText(wrongText));
        } else if (isLeadingEqualsCorrect(aLine) || isTrailingEqualsCorrect(aLine) || isTFCorrectTrailing(aLine)) {
          const correctText = stripTFCorrectAnswerText(aLine);
          if (correctText) {
            correctIndex = answers.length;
            answers.push(cleanText(correctText));
          }
        } else {
          const answerText = stripAnswerPrefix(aLine);
          if (answerText) answers.push(cleanText(answerText));
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
        const normalized = canonicalizeTFAnswers(answers, correctIndex);
        questions.push({
          type: 'tf',
          question: questionText,
          answers: normalized.answers,
          correctIndex: normalized.correctIndex,
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
  queueAutoSyncToFirebase('حذف السؤال');
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
  let finalAnswers = validAnswers;
  let finalCorrectIndex = newCorrectIndex;
  if (q.type === 'tf') {
    const normalized = canonicalizeTFAnswers(validAnswers, newCorrectIndex);
    finalAnswers = normalized.answers;
    finalCorrectIndex = normalized.correctIndex;
  }
  allQuestions[editingIndex] = {
    ...q,
    question: newText,
    answers: finalAnswers,
    correctIndex: finalCorrectIndex
  };
  persistActiveExamQuestions();
  closeEditModal();
  updateTabCounts();
  renderQuestionsList();
  queueAutoSyncToFirebase('تعديل السؤال');
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
  clearActiveFirebaseExamKey();
  clearImportProgressBanner();
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
    setLoadingText('جاري حفظ الأسئلة...');
    const saved = await writeExamSnapshotToFirebase({ forceNew: true, timeoutMs: 15000 });

    hideLoading();
    document.getElementById('successMessage').textContent =
      `تم حفظ ${allQuestions.length} سؤال في قاعدة البيانات بنجاح! (ID: ${saved.key})`;
    document.getElementById('successModal').style.display = 'flex';

  } catch (err) {
    hideLoading();
    console.error('Firebase error:', err);
    if (String(err?.message || '') === 'timeout' || (err.message && err.message.includes('permission'))) {
      showToast('⚠️ تأكد من أن قواعد قاعدة البيانات تسمح بالكتابة', 'error');
    } else {
      showToast('فشل الحفظ: ' + formatFirebaseSyncError(err), 'error');
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

  const savedOverride = localStorage.getItem(GROQ_API_KEY_STORAGE_KEY);
  const hasEmbedded = !!String(DEFAULT_GROQ_API_KEY || '').trim();
  if (localStorage.getItem(USE_GROQ_UPLOAD_KEY) === null) {
    localStorage.setItem(USE_GROQ_UPLOAD_KEY, savedOverride ? '1' : '0');
  }
  cb.checked = localStorage.getItem(USE_GROQ_UPLOAD_KEY) === '1';

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
