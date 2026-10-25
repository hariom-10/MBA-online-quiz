import { useState, useEffect, useRef, useMemo } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Clock3,
  Check,
  X,
  Award,
  HelpCircle,
  CheckCircle2,
  XCircle,
  RotateCcw,
  FileText,
  BarChart3,
  Send,
  Flag,
} from "lucide-react";
import type { Question, ExtractedPaper, CbtQuestionStatus, CbtExamResult, Section } from "./model";
import { MathContent, QuestionGraphViewer } from "./MathContent";
import { getQuestionOptionKeys, evaluateStudentAnswer } from "./questionValidation";

interface CbtMockExamProps {
  paper: ExtractedPaper;
  questions: Question[];
  sections: Section[];
  candidateName: string;
  onExit: () => void;
  onSaveAttempt?: (result: CbtExamResult) => void;
  onReportQuestion?: (question: Question) => void;
}

export function CbtMockExam({
  paper,
  questions,
  sections,
  candidateName,
  onExit,
  onSaveAttempt,
  onReportQuestion,
}: CbtMockExamProps) {
  // Total time allocated: default 40 mins for sectional or 120 mins for full mock
  const totalAllocatedMinutes = questions.length > 30 ? 120 : 40;
  const [secondsRemaining, setSecondsRemaining] = useState(totalAllocatedMinutes * 60);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [markedForReview, setMarkedForReview] = useState<Record<string, boolean>>({});
  const [visited, setVisited] = useState<Record<string, boolean>>({ [questions[0]?.id]: true });
  const [timeSpent, setTimeSpent] = useState<Record<string, number>>({});
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [result, setResult] = useState<CbtExamResult | null>(null);
  const [selectedSectionFilter, setSelectedSectionFilter] = useState<string>("all");

  const currentQuestion = questions[currentIndex];
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Group questions by section
  const sectionList = useMemo(() => {
    const map = new Map<string, { id: string; name: string; count: number }>();
    questions.forEach((q) => {
      const sec = sections.find((s) => s.id === q.sectionId) ?? {
        id: q.sectionId || "general",
        name: q.topic || "General",
      };
      const existing = map.get(sec.id);
      if (existing) {
        existing.count++;
      } else {
        map.set(sec.id, { id: sec.id, name: sec.name, count: 1 });
      }
    });
    return Array.from(map.values());
  }, [questions, sections]);

  // Track time spent per question and test countdown
  useEffect(() => {
    if (result) return;
    timerRef.current = setInterval(() => {
      setSecondsRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current!);
          handleSubmitExam();
          return 0;
        }
        return prev - 1;
      });

      if (currentQuestion) {
        setTimeSpent((prev) => ({
          ...prev,
          [currentQuestion.id]: (prev[currentQuestion.id] || 0) + 1,
        }));
      }
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [currentQuestion?.id, result]);

  // Mark question visited when navigating
  const goToQuestion = (index: number) => {
    if (index >= 0 && index < questions.length) {
      setCurrentIndex(index);
      const q = questions[index];
      if (q) {
        setVisited((prev) => ({ ...prev, [q.id]: true }));
      }
    }
  };

  // Determine CBT status for each question
  const getQuestionStatus = (q: Question): CbtQuestionStatus => {
    const isAnswered = Boolean(answers[q.id]?.trim());
    const isMarked = Boolean(markedForReview[q.id]);
    const isVisited = Boolean(visited[q.id]);

    if (isAnswered && isMarked) return "answered_and_marked";
    if (isMarked) return "marked_for_review";
    if (isAnswered) return "answered";
    if (isVisited) return "not_answered";
    return "not_visited";
  };

  // Status counters for palette
  const statusCounts = useMemo(() => {
    let answered = 0;
    let notAnswered = 0;
    let notVisited = 0;
    let marked = 0;
    let answeredAndMarked = 0;

    questions.forEach((q) => {
      const status = getQuestionStatus(q);
      if (status === "answered") answered++;
      else if (status === "not_answered") notAnswered++;
      else if (status === "not_visited") notVisited++;
      else if (status === "marked_for_review") marked++;
      else if (status === "answered_and_marked") answeredAndMarked++;
    });

    return { answered, notAnswered, notVisited, marked, answeredAndMarked };
  }, [answers, markedForReview, visited, questions]);

  // Format time (HH:MM:SS or MM:SS)
  const formatTime = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hrs > 0) {
      return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    }
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  };

  // Handlers for action buttons
  const handleSelectOption = (optionKey: string) => {
    if (!currentQuestion) return;
    setAnswers((prev) => ({ ...prev, [currentQuestion.id]: optionKey }));
  };

  const handleClearResponse = () => {
    if (!currentQuestion) return;
    setAnswers((prev) => {
      const next = { ...prev };
      delete next[currentQuestion.id];
      return next;
    });
  };

  const handleToggleMarkForReview = () => {
    if (!currentQuestion) return;
    setMarkedForReview((prev) => ({
      ...prev,
      [currentQuestion.id]: !prev[currentQuestion.id],
    }));
    // Auto advance to next question
    if (currentIndex < questions.length - 1) {
      goToQuestion(currentIndex + 1);
    }
  };

  const handleSaveAndNext = () => {
    if (currentIndex < questions.length - 1) {
      goToQuestion(currentIndex + 1);
    } else {
      setShowSubmitModal(true);
    }
  };

  // Submit and calculate CAT / XAT scores
  const handleSubmitExam = () => {
    setShowSubmitModal(false);
    if (timerRef.current) clearInterval(timerRef.current);

    let rawScore = 0;
    let correct = 0;
    let incorrect = 0;
    let unattempted = 0;

    const sectionScores: Record<
      string,
      { name: string; total: number; attempted: number; correct: number; incorrect: number; score: number }
    > = {};

    questions.forEach((q) => {
      const sec = sections.find((s) => s.id === q.sectionId) ?? {
        id: q.sectionId || "general",
        name: q.topic || "General",
      };

      if (!sectionScores[sec.id]) {
        sectionScores[sec.id] = {
          name: sec.name,
          total: 0,
          attempted: 0,
          correct: 0,
          incorrect: 0,
          score: 0,
        };
      }
      sectionScores[sec.id].total++;

      const studentAns = answers[q.id]?.trim();
      const isAttempted = Boolean(studentAns);

      if (!isAttempted) {
        unattempted++;
        return;
      }

      sectionScores[sec.id].attempted++;

      // Check correctness (supports Option 1-5, letter A-E, text, and numerical)
      const isCorrect = evaluateStudentAnswer(q, studentAns);

      if (isCorrect) {
        correct++;
        rawScore += 3;
        sectionScores[sec.id].correct++;
        sectionScores[sec.id].score += 3;
      } else {
        incorrect++;
        // CAT/XAT standard: -1 for MCQ, 0 for TITA
        const isTita = q.answerMode === "text";
        if (!isTita) {
          rawScore -= 1;
          sectionScores[sec.id].score -= 1;
        }
        sectionScores[sec.id].incorrect++;
      }
    });

    const totalQuestions = questions.length;
    const attempted = correct + incorrect;
    const maxScore = totalQuestions * 3;
    const accuracy = attempted > 0 ? Math.round((correct / attempted) * 100) : 0;
    const timeUsed = totalAllocatedMinutes * 60 - secondsRemaining;

    // CAT percentile calibration estimate
    let estimatedPercentile = 50;
    if (maxScore > 0) {
      const percentageScore = (rawScore / maxScore) * 100;
      if (percentageScore >= 45) estimatedPercentile = 99.5;
      else if (percentageScore >= 38) estimatedPercentile = 99.0;
      else if (percentageScore >= 32) estimatedPercentile = 97.5;
      else if (percentageScore >= 26) estimatedPercentile = 95.0;
      else if (percentageScore >= 20) estimatedPercentile = 90.0;
      else if (percentageScore >= 14) estimatedPercentile = 80.0;
      else if (percentageScore >= 8) estimatedPercentile = 65.0;
      else if (percentageScore > 0) estimatedPercentile = 50.0;
      else estimatedPercentile = 20.0;
    }

    const examResult: CbtExamResult = {
      paperId: paper.id,
      paperTitle: paper.paperTitle || paper.fileName,
      examId: paper.examId || "cat",
      totalQuestions,
      attempted,
      correct,
      incorrect,
      unattempted,
      rawScore,
      maxScore,
      accuracy,
      estimatedPercentile,
      totalTimeSeconds: timeUsed,
      answers,
      timeSpent,
      sectionScores,
      submittedAt: new Date().toISOString(),
    };

    setResult(examResult);
    if (onSaveAttempt) {
      onSaveAttempt(examResult);
    }
  };

  // If exam submitted, show the CBT Scorecard & Analysis
  if (result) {
    return (
      <CbtScorecard
        result={result}
        paper={paper}
        questions={questions}
        sections={sections}
        onExit={onExit}
        onRetake={() => {
          setResult(null);
          setAnswers({});
          setMarkedForReview({});
          setVisited({ [questions[0]?.id]: true });
          setTimeSpent({});
          setSecondsRemaining(totalAllocatedMinutes * 60);
          setCurrentIndex(0);
        }}
        onReportQuestion={onReportQuestion}
      />
    );
  }

  const isCurrentTita = currentQuestion?.answerMode === "text";
  const selectedAnswer = currentQuestion ? answers[currentQuestion.id] ?? "" : "";
  const isMarked = currentQuestion ? Boolean(markedForReview[currentQuestion.id]) : false;

  const filteredQuestions =
    selectedSectionFilter === "all"
      ? questions
      : questions.filter((q) => q.sectionId === selectedSectionFilter);

  return (
    <div className="cbt-container">
      {/* Top Banner (TCS iON CAT Header) */}
      <header className="cbt-header">
        <div className="cbt-header-left">
          <span className="cbt-logo-badge">{paper.examName || "CAT"} CBT EXAM</span>
          <div className="cbt-test-info">
            <h1>{paper.paperTitle || paper.fileName}</h1>
            <span className="cbt-subinfo">
              Year {paper.year} · {paper.slot} · Total Questions: {questions.length}
            </span>
          </div>
        </div>

        <div className="cbt-header-center">
          <div className={`cbt-timer ${secondsRemaining < 300 ? "cbt-timer-urgent" : ""}`}>
            <Clock3 size={20} />
            <div>
              <span className="cbt-timer-label">Time Remaining</span>
              <strong className="cbt-timer-val">{formatTime(secondsRemaining)}</strong>
            </div>
          </div>
        </div>

        <div className="cbt-header-right">
          <div className="cbt-candidate-info">
            <span className="cbt-candidate-label">Candidate</span>
            <span className="cbt-candidate-name">{candidateName || "Student"}</span>
          </div>
          <button className="cbt-exit-btn" onClick={onExit} title="Exit Test">
            <ArrowLeft size={16} /> Exit
          </button>
        </div>
      </header>

      {/* Section Switcher Tabs */}
      <nav className="cbt-section-tabs">
        <span className="cbt-section-label">Sections:</span>
        <button
          className={`cbt-sec-tab ${selectedSectionFilter === "all" ? "active" : ""}`}
          onClick={() => setSelectedSectionFilter("all")}
        >
          All Questions ({questions.length})
        </button>
        {sectionList.map((sec) => (
          <button
            key={sec.id}
            className={`cbt-sec-tab ${selectedSectionFilter === sec.id ? "active" : ""}`}
            onClick={() => setSelectedSectionFilter(sec.id)}
          >
            {sec.name} ({sec.count})
          </button>
        ))}
      </nav>

      {/* Main CBT Workspace: Left = Question Canvas, Right = Palette */}
      <div className="cbt-main">
        {/* Left: Question Area */}
        <main className="cbt-question-area">
          {currentQuestion ? (
            <div className="cbt-card">
              <div className="cbt-q-header">
                <div className="cbt-q-title">
                  <span className="cbt-q-num">Question {currentIndex + 1}</span>
                  <span className="cbt-q-type-badge">
                    {isCurrentTita ? "Non-MCQ / TITA" : "Multiple Choice (MCQ)"}
                  </span>
                </div>
                <div className="cbt-q-marks">
                  Marks: <span className="cbt-pos-mark">+3.00</span> /{" "}
                  <span className="cbt-neg-mark">{isCurrentTita ? "0.00" : "-1.00"}</span>
                </div>
              </div>

              <div className="cbt-q-content">
                <MathContent text={currentQuestion.question} />
                {currentQuestion.imageUrl && (
                  <QuestionGraphViewer imageUrl={currentQuestion.imageUrl} alt={currentQuestion.imageAlt || "Question Graph / Diagram"} />
                )}
              </div>

              {/* Options or TITA Input */}
              {isCurrentTita ? (
                <div className="cbt-tita-area">
                  <label htmlFor="tita-input" className="cbt-tita-label">
                    Type your numerical / text answer below:
                  </label>
                  <input
                    id="tita-input"
                    type="text"
                    className="cbt-tita-input"
                    placeholder="Enter answer here..."
                    value={selectedAnswer}
                    onChange={(e) => handleSelectOption(e.target.value)}
                  />
                  <small className="cbt-tita-note">
                    Note: For TITA questions, there is no negative marking (-0 for incorrect).
                  </small>
                </div>
              ) : (
                <div className="cbt-options-list">
                  {getQuestionOptionKeys(currentQuestion).map((optionKey) => {
                    const text = currentQuestion.options?.[optionKey];
                    if (!text) return null;
                    const isSelected = selectedAnswer.toUpperCase() === optionKey;
                    return (
                      <label
                        key={optionKey}
                        className={`cbt-option-item ${isSelected ? "selected" : ""}`}
                        onClick={() => handleSelectOption(optionKey)}
                      >
                        <input
                          type="radio"
                          name={`cbt-q-${currentQuestion.id}`}
                          checked={isSelected}
                          onChange={() => handleSelectOption(optionKey)}
                        />
                        <span className="cbt-opt-letter">{optionKey}</span>
                        <div className="cbt-opt-text">
                          <MathContent text={text} />
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <div className="cbt-card">No question selected.</div>
          )}

          {/* Action Bottom Bar */}
          <footer className="cbt-action-bar">
            <div className="cbt-action-left">
              <button
                type="button"
                className={`button button-outline cbt-btn-review ${isMarked ? "cbt-btn-active" : ""}`}
                onClick={handleToggleMarkForReview}
              >
                <Flag size={15} /> {isMarked ? "Unmark Review" : "Mark for Review & Next"}
              </button>
              <button
                type="button"
                className="button button-quiet cbt-btn-clear"
                onClick={handleClearResponse}
                disabled={!selectedAnswer}
              >
                Clear Response
              </button>
            </div>

            <div className="cbt-action-right">
              <button
                type="button"
                className="button button-outline"
                disabled={currentIndex === 0}
                onClick={() => goToQuestion(currentIndex - 1)}
              >
                <ArrowLeft size={16} /> Previous
              </button>
              <button
                type="button"
                className="button button-primary cbt-btn-save-next"
                onClick={handleSaveAndNext}
              >
                Save &amp; Next <ArrowRight size={16} />
              </button>
              <button
                type="button"
                className="button cbt-btn-submit"
                onClick={() => setShowSubmitModal(true)}
              >
                <Send size={15} /> Submit Test
              </button>
            </div>
          </footer>
        </main>

        {/* Right: Question Palette & Status Summary */}
        <aside className="cbt-palette-sidebar">
          <div className="cbt-palette-legend">
            <h4>Question Palette</h4>
            <div className="cbt-legend-grid">
              <div className="cbt-legend-item">
                <span className="cbt-bubble cbt-b-answered">{statusCounts.answered}</span>
                <span>Answered</span>
              </div>
              <div className="cbt-legend-item">
                <span className="cbt-bubble cbt-b-not-answered">{statusCounts.notAnswered}</span>
                <span>Not Answered</span>
              </div>
              <div className="cbt-legend-item">
                <span className="cbt-bubble cbt-b-not-visited">{statusCounts.notVisited}</span>
                <span>Not Visited</span>
              </div>
              <div className="cbt-legend-item">
                <span className="cbt-bubble cbt-b-marked">{statusCounts.marked}</span>
                <span>Marked for Review</span>
              </div>
              <div className="cbt-legend-item">
                <span className="cbt-bubble cbt-b-ans-marked">{statusCounts.answeredAndMarked}</span>
                <span>Ans &amp; Marked for Review</span>
              </div>
            </div>
          </div>

          <div className="cbt-palette-body">
            <span className="cbt-palette-heading">Choose a Question:</span>
            <div className="cbt-palette-buttons">
              {filteredQuestions.map((q) => {
                const globalIndex = questions.findIndex((item) => item.id === q.id);
                const status = getQuestionStatus(q);
                const isCurrent = globalIndex === currentIndex;

                return (
                  <button
                    key={q.id}
                    type="button"
                    className={`cbt-pal-btn cbt-p-${status} ${isCurrent ? "cbt-pal-current" : ""}`}
                    onClick={() => goToQuestion(globalIndex)}
                    title={`Question ${globalIndex + 1} (${status.replace(/_/g, " ")})`}
                  >
                    {globalIndex + 1}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="cbt-palette-footer">
            <button
              type="button"
              className="button button-full cbt-btn-submit-palette"
              onClick={() => setShowSubmitModal(true)}
            >
              Submit Entire Paper
            </button>
          </div>
        </aside>
      </div>

      {/* Submit Confirmation Modal */}
      {showSubmitModal && (
        <div className="modal-overlay">
          <div className="cbt-submit-modal">
            <div className="modal-title">
              <div>
                <span className="eyebrow">READY TO COMPLETE?</span>
                <h2>Exam Submission Summary</h2>
              </div>
            </div>

            <p className="cbt-submit-desc">
              Please review your attempt statistics below before submitting. Once submitted, you cannot change your answers.
            </p>

            <div className="cbt-summary-table-wrap">
              <table className="cbt-summary-table">
                <thead>
                  <tr>
                    <th>Total Questions</th>
                    <th>Answered</th>
                    <th>Not Answered</th>
                    <th>Marked for Review</th>
                    <th>Not Visited</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><b>{questions.length}</b></td>
                    <td className="cbt-txt-green"><b>{statusCounts.answered + statusCounts.answeredAndMarked}</b></td>
                    <td className="cbt-txt-red"><b>{statusCounts.notAnswered}</b></td>
                    <td className="cbt-txt-purple"><b>{statusCounts.marked + statusCounts.answeredAndMarked}</b></td>
                    <td className="cbt-txt-gray"><b>{statusCounts.notVisited}</b></td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="cbt-submit-modal-actions">
              <button
                type="button"
                className="button button-outline"
                onClick={() => setShowSubmitModal(false)}
              >
                Resume Exam
              </button>
              <button
                type="button"
                className="button button-primary cbt-btn-confirm-submit"
                onClick={handleSubmitExam}
              >
                Yes, Submit Test Now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// -------------------------------------------------------------
// CBT Scorecard & Analysis Component
// -------------------------------------------------------------
interface CbtScorecardProps {
  result: CbtExamResult;
  paper: ExtractedPaper;
  questions: Question[];
  sections: Section[];
  onExit: () => void;
  onRetake: () => void;
  onReportQuestion?: (question: Question) => void;
}

function CbtScorecard({
  result,
  paper,
  questions,
  sections,
  onExit,
  onRetake,
  onReportQuestion,
}: CbtScorecardProps) {
  const [filterType, setFilterType] = useState<"all" | "correct" | "incorrect" | "unattempted">("all");

  const formatSeconds = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}m ${s}s`;
  };

  const filteredQuestions = questions.filter((q) => {
    const studentAns = result.answers[q.id]?.trim();
    const isAttempted = Boolean(studentAns);
    if (filterType === "unattempted") return !isAttempted;
    if (!isAttempted) return false;

    const correctAns = (q.correctAnswer ?? "").trim().toUpperCase();
    const isCorrect = studentAns.toUpperCase() === correctAns;

    if (filterType === "correct") return isCorrect;
    if (filterType === "incorrect") return !isCorrect;
    return true;
  });

  return (
    <div className="cbt-scorecard-container">
      <div className="cbt-scorecard-top">
        <button className="back-link" onClick={onExit}>
          <ArrowLeft size={16} /> Return to Dashboard
        </button>
        <button className="button button-outline" onClick={onRetake}>
          <RotateCcw size={16} /> Retake This Paper
        </button>
      </div>

      {/* Hero Performance Card */}
      <section className="cbt-hero-card">
        <div className="cbt-hero-badge">
          <Award size={32} />
        </div>
        <span className="eyebrow">OFFICIAL CBT SCORECARD</span>
        <h1>{result.paperTitle}</h1>
        <p>{paper.examName || "MBA"} Exam · {paper.slot || "Slot"} · Year {paper.year || 2024} · Completed on {new Date(result.submittedAt).toLocaleDateString()} at {new Date(result.submittedAt).toLocaleTimeString()}</p>

        <div className="cbt-hero-stats">
          <div className="cbt-stat-box score-stat">
            <span className="cbt-stat-label">Raw Score</span>
            <strong className="cbt-stat-num">
              {result.rawScore} <small>/ {result.maxScore}</small>
            </strong>
            <span className="cbt-stat-tag">Marks (+3 / -1)</span>
          </div>

          <div className="cbt-stat-box percentile-stat">
            <span className="cbt-stat-label">Projected Percentile</span>
            <strong className="cbt-stat-num">{result.estimatedPercentile}%ile</strong>
            <span className="cbt-stat-tag">CAT Normalized</span>
          </div>

          <div className="cbt-stat-box accuracy-stat">
            <span className="cbt-stat-label">Accuracy</span>
            <strong className="cbt-stat-num">{result.accuracy}%</strong>
            <span className="cbt-stat-tag">{result.correct} correct of {result.attempted}</span>
          </div>

          <div className="cbt-stat-box time-stat">
            <span className="cbt-stat-label">Time Spent</span>
            <strong className="cbt-stat-num">{formatSeconds(result.totalTimeSeconds)}</strong>
            <span className="cbt-stat-tag">~{Math.round(result.totalTimeSeconds / (result.attempted || 1))}s / question</span>
          </div>
        </div>
      </section>

      {/* Summary KPI Grid */}
      <section className="cbt-kpi-grid">
        <div className="cbt-kpi-card">
          <FileText size={20} className="kpi-icon-purple" />
          <div>
            <span>Total Questions</span>
            <strong>{result.totalQuestions}</strong>
          </div>
        </div>
        <div className="cbt-kpi-card">
          <CheckCircle2 size={20} className="kpi-icon-green" />
          <div>
            <span>Correct Answers</span>
            <strong>{result.correct} (+{result.correct * 3} marks)</strong>
          </div>
        </div>
        <div className="cbt-kpi-card">
          <XCircle size={20} className="kpi-icon-red" />
          <div>
            <span>Incorrect Answers</span>
            <strong>{result.incorrect} (-{result.incorrect} marks)</strong>
          </div>
        </div>
        <div className="cbt-kpi-card">
          <HelpCircle size={20} className="kpi-icon-gray" />
          <div>
            <span>Unattempted</span>
            <strong>{result.unattempted} (0 marks)</strong>
          </div>
        </div>
      </section>

      {/* Section-wise breakdown table */}
      {Object.keys(result.sectionScores).length > 0 && (
        <section className="cbt-section-table-card">
          <div className="section-heading">
            <div>
              <span className="eyebrow"><BarChart3 size={14} /> SECTIONAL PERFORMANCE</span>
              <h2>Section-wise Score Breakdown</h2>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Section</th>
                  <th>Questions</th>
                  <th>Attempted</th>
                  <th>Correct</th>
                  <th>Incorrect</th>
                  <th>Raw Score</th>
                  <th>Accuracy</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(result.sectionScores).map(([secId, sec]) => {
                  const secAccuracy = sec.attempted > 0 ? Math.round((sec.correct / sec.attempted) * 100) : 0;
                  return (
                    <tr key={secId}>
                      <td><b>{sec.name}</b></td>
                      <td>{sec.total}</td>
                      <td>{sec.attempted}</td>
                      <td className="cbt-txt-green">+{sec.correct}</td>
                      <td className="cbt-txt-red">-{sec.incorrect}</td>
                      <td><b>{sec.score}</b></td>
                      <td>
                        <span className={`status-pill ${secAccuracy >= 75 ? "status-resolved" : secAccuracy >= 50 ? "status-under-review" : "status-rejected"}`}>
                          {secAccuracy}%
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Detailed Question Review List */}
      <section className="cbt-review-section">
        <div className="cbt-review-header">
          <div>
            <h2>Question-by-Question Detailed Review</h2>
            <p>Inspect step-by-step solutions, correct answers, and your recorded responses.</p>
          </div>

          <div className="cbt-filter-buttons">
            <button
              className={`button button-small ${filterType === "all" ? "button-primary" : "button-outline"}`}
              onClick={() => setFilterType("all")}
            >
              All ({questions.length})
            </button>
            <button
              className={`button button-small ${filterType === "correct" ? "button-primary" : "button-outline"}`}
              onClick={() => setFilterType("correct")}
            >
              Correct ({result.correct})
            </button>
            <button
              className={`button button-small ${filterType === "incorrect" ? "button-primary" : "button-outline"}`}
              onClick={() => setFilterType("incorrect")}
            >
              Incorrect ({result.incorrect})
            </button>
            <button
              className={`button button-small ${filterType === "unattempted" ? "button-primary" : "button-outline"}`}
              onClick={() => setFilterType("unattempted")}
            >
              Skipped ({result.unattempted})
            </button>
          </div>
        </div>

        <div className="cbt-review-list">
          {filteredQuestions.map((q, idx) => {
            const studentAns = result.answers[q.id]?.trim();
            const correctAns = (q.correctAnswer ?? "").trim().toUpperCase();
            const isAttempted = Boolean(studentAns);
            const isCorrect = isAttempted && studentAns.toUpperCase() === correctAns;
            const timeForQ = result.timeSpent[q.id] || 0;
            const sec = sections.find((s) => s.id === q.sectionId);

            return (
              <article key={q.id} className={`cbt-review-card ${isCorrect ? "card-correct" : isAttempted ? "card-incorrect" : "card-skipped"}`}>
                <div className="cbt-review-card-top">
                  <div className="cbt-review-tags">
                    <span className="cbt-badge-qnum">Q.{idx + 1}</span>
                    <span className="soft-badge">{sec?.name || q.topic || "General"}</span>
                    <span className={`difficulty difficulty-${(q.difficulty || "medium").toLowerCase()}`}>
                      {q.difficulty || "Medium"}
                    </span>
                    <span className="cbt-time-badge">
                      <Clock3 size={13} /> {timeForQ}s spent
                    </span>
                  </div>

                  <div className="cbt-review-status-box">
                    {isCorrect ? (
                      <span className="cbt-status-tag cbt-tag-correct">
                        <Check size={14} /> Correct (+3)
                      </span>
                    ) : isAttempted ? (
                      <span className="cbt-status-tag cbt-tag-incorrect">
                        <X size={14} /> Incorrect (-1)
                      </span>
                    ) : (
                      <span className="cbt-status-tag cbt-tag-skipped">
                        Unattempted (0)
                      </span>
                    )}

                    {onReportQuestion && (
                      <button
                        type="button"
                        className="text-button cbt-challenge-btn"
                        onClick={() => onReportQuestion(q)}
                        title="Challenge or report an issue with this question"
                      >
                        <Flag size={14} /> Report
                      </button>
                    )}
                  </div>
                </div>

                <div className="cbt-review-q-text">
                  <MathContent text={q.question} />
                  {q.imageUrl && (
                    <QuestionGraphViewer imageUrl={q.imageUrl} alt={q.imageAlt || "Question Graph"} />
                  )}
                </div>

                {/* Option Review */}
                {q.options && Object.keys(q.options).length > 0 && (
                  <div className="cbt-review-options">
                    {getQuestionOptionKeys(q).map((letter) => {
                      const optText = q.options[letter];
                      if (!optText) return null;
                      const isStudentSelected = studentAns.toUpperCase() === letter || studentAns.toLowerCase() === optText.trim().toLowerCase();
                      const isActualCorrect = correctAns === letter || (q.correctAnswer ?? "").trim().toLowerCase() === optText.trim().toLowerCase();

                      let optClass = "";
                      if (isActualCorrect) optClass = "opt-correct";
                      else if (isStudentSelected) optClass = "opt-wrong-selected";

                      return (
                        <div key={letter} className={`cbt-review-opt-row ${optClass}`}>
                          <span className="opt-letter-tag">{letter}</span>
                          <div className="opt-text-wrap">
                            <MathContent text={optText} />
                          </div>
                          {isActualCorrect && <span className="opt-marker correct-marker">Correct Answer</span>}
                          {isStudentSelected && !isActualCorrect && (
                            <span className="opt-marker student-marker">Your Answer</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* TITA / Non-MCQ display */}
                {(!q.options || !Object.keys(q.options).length || q.answerMode === "text") && (
                  <div className="cbt-review-tita-row">
                    <div>
                      <span>Your Answer: </span>
                      <b>{studentAns || "None (Unattempted)"}</b>
                    </div>
                    <div>
                      <span>Correct Answer: </span>
                      <b className="cbt-txt-green">{q.correctAnswer || "Not specified"}</b>
                    </div>
                  </div>
                )}

                {/* Solution Explanation */}
                {q.explanation && (
                  <div className="cbt-review-solution">
                    <strong>Solution / Explanation:</strong>
                    <MathContent text={q.explanation} />
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
