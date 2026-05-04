"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Loader2,
  Mic,
  MicOff,
  Sparkles,
  Volume2,
  XCircle,
} from "lucide-react";

type Question = {
  question: string;
  reference_answer: string;
};

type Evaluation = {
  transcript: string;
  is_correct: boolean;
  feedback_speech: string;
};

type Step = "start" | "generating" | "quiz" | "results";

type HistoryItem = {
  question: string;
  is_correct: boolean;
  transcript: string;
  feedback_speech: string;
  reference_answer: string;
};

const API_BASE = "http://localhost:8000";

export default function Home() {
  const [step, setStep] = useState<Step>("start");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [feedback, setFeedback] = useState<Evaluation | null>(null);
  const [transcript, setTranscript] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [history, setHistory] = useState<Array<HistoryItem | null>>([]);
  const [attempts, setAttempts] = useState<Record<number, number>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const attemptsRef = useRef<Record<number, number>>({});

  const currentQuestion = useMemo(
    () => questions[currentQuestionIndex],
    [questions, currentQuestionIndex]
  );

  const currentAttempts = attempts[currentQuestionIndex] ?? 0;
  const maxAttempts = 2;
  const attemptsRemaining = Math.max(0, maxAttempts - currentAttempts);
  const canProceed = Boolean(feedback && (feedback.is_correct || currentAttempts >= maxAttempts));

  useEffect(() => {
    if (feedback?.feedback_speech) {
      const utterance = new SpeechSynthesisUtterance(feedback.feedback_speech);
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    }
  }, [feedback]);

  useEffect(() => {
    attemptsRef.current = attempts;
  }, [attempts]);

  const handleGenerate = async () => {
    setErrorMessage("");
    setStep("generating");
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90_000);
    try {
      const response = await fetch(`${API_BASE}/api/generate-questions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.detail || "Failed to generate questions.");
      }
      const data = (await response.json()) as Question[];
      if (!data || data.length === 0) {
        throw new Error("No questions were generated. Please try again.");
      }
      setQuestions(data);
      setCurrentQuestionIndex(0);
      setScore(0);
      setHistory(Array(data.length).fill(null));
      setAttempts({});
      setFeedback(null);
      setTranscript("");
      setAudioBlob(null);
      setStep("quiz");
    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof DOMException && err.name === "AbortError") {
        setErrorMessage("Request timed out. The server may be busy — please try again.");
      } else {
        setErrorMessage(err instanceof Error ? err.message : "Unexpected error.");
      }
      setStep("start");
    }
  };

  const speakQuestion = () => {
    if (!currentQuestion) return;
    const utterance = new SpeechSynthesisUtterance(currentQuestion.question);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  };

  const startRecording = async () => {
    setErrorMessage("");
    if (isRecording) return;
    if (feedback && feedback.is_correct) return;
    if (currentAttempts >= maxAttempts) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      audioChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        setAudioBlob(blob);
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      if (feedback && !feedback.is_correct) {
        setFeedback(null);
        setTranscript("");
      }
    } catch {
      setErrorMessage("Microphone permission denied or not available.");
    }
  };

  const stopRecording = () => {
    if (!mediaRecorderRef.current) return;
    mediaRecorderRef.current.stop();
    mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
    setIsRecording(false);
  };

  const submitRecording = useCallback(async () => {
    if (!audioBlob || !currentQuestion) return;
    setIsSubmitting(true);
    setErrorMessage("");
    setFeedback(null);
    setTranscript("");
    try {
      const attemptNumber = (attemptsRef.current[currentQuestionIndex] ?? 0) + 1;
      const formData = new FormData();
      formData.append("audio", audioBlob, "answer.webm");
      formData.append("question", currentQuestion.question);
      formData.append("reference_answer", currentQuestion.reference_answer);

      const response = await fetch(`${API_BASE}/api/evaluate-audio`, {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.detail || "Failed to evaluate audio.");
      }
      const data = (await response.json()) as Evaluation;
      setFeedback(data);
      setTranscript(data.transcript);
      setAttempts((prev) => {
        const next = { ...prev, [currentQuestionIndex]: attemptNumber };
        attemptsRef.current = next;
        return next;
      });
      if (data.is_correct) {
        setScore((prev) => prev + 1);
      }
      if (data.is_correct || attemptNumber >= maxAttempts) {
        setHistory((prev) => {
          const next = [...prev];
          next[currentQuestionIndex] = {
            question: currentQuestion.question,
            is_correct: data.is_correct,
            transcript: data.transcript,
            feedback_speech: data.feedback_speech,
            reference_answer: currentQuestion.reference_answer,
          };
          return next;
        });
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Unexpected error.");
    } finally {
      setIsSubmitting(false);
      setAudioBlob(null);
    }
  }, [audioBlob, currentQuestion, currentQuestionIndex]);

  useEffect(() => {
    if (audioBlob) {
      void submitRecording();
    }
  }, [audioBlob, submitRecording]);

  const handleNext = () => {
    const nextIndex = currentQuestionIndex + 1;
    if (nextIndex >= questions.length) {
      setStep("results");
      return;
    }
    setCurrentQuestionIndex(nextIndex);
    setFeedback(null);
    setTranscript("");
    setAudioBlob(null);
  };

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#f8f0e7,_#f2e2d3_45%,_#e8d4c0_100%)] text-slate-900">
      <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-6 py-14">
        <header className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-white/70 bg-white/70 p-6 shadow-xl shadow-orange-100/60 backdrop-blur">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-amber-700">
              AI Science Grader
            </p>
            <h1 className="mt-2 text-3xl font-semibold text-slate-900">
              Voice-Powered NCERT Checkpoint
            </h1>
          </div>
          <div className="flex items-center gap-3 rounded-full bg-amber-600/90 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-amber-200">
            <Sparkles className="h-4 w-4" />
            Grade Smarter
          </div>
        </header>

        {step === "start" && (
          <section className="mt-12 grid gap-8 rounded-[36px] border border-white/70 bg-white/70 p-10 shadow-2xl shadow-amber-100/80 backdrop-blur">
            <div className="max-w-2xl space-y-4">
              <h2 className="text-4xl font-semibold text-slate-900">Ready to Test Your Knowledge?</h2>
              <p className="text-lg text-slate-700">
                Generate an instant 5-question quiz covering the entire NCERT Science textbook and grade spoken answers in real time.
              </p>
            </div>
            <div className="flex flex-wrap gap-4">
              <button
                onClick={handleGenerate}
                className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-slate-400/40 transition hover:bg-slate-800"
              >
                Generate Quiz from Textbook
                <ArrowRight className="h-4 w-4" />
              </button>
              {errorMessage && (
                <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">
                  {errorMessage}
                </p>
              )}
            </div>
          </section>
        )}

        {step === "generating" && (
          <section className="mt-12 flex flex-col items-center gap-6 rounded-[36px] border border-white/70 bg-white/70 p-12 text-center shadow-2xl shadow-amber-100/80 backdrop-blur">
            <div className="flex items-center gap-3 text-amber-700">
              <Loader2 className="h-6 w-6 animate-spin" />
              <p className="text-lg font-semibold">Generating your quiz...</p>
            </div>
            <div className="h-3 w-full max-w-md rounded-full bg-amber-100">
              <div className="h-3 w-2/3 rounded-full bg-amber-500/80" />
            </div>
          </section>
        )}

        {step === "quiz" && currentQuestion && (
          <section className="mt-12 space-y-8 rounded-[36px] border border-white/70 bg-white/70 p-10 shadow-2xl shadow-amber-100/80 backdrop-blur">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.2em] text-amber-700">Question</p>
                <h2 className="mt-2 text-2xl font-semibold text-slate-900">
                  {currentQuestionIndex + 1} of {questions.length}
                </h2>
              </div>
              <div className="rounded-full bg-emerald-600/90 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-emerald-200">
                Score {score}/{questions.length}
              </div>
            </div>

            <div className="rounded-3xl border border-amber-100 bg-white/80 p-8 text-lg text-slate-800 shadow-inner">
              {currentQuestion.question}
            </div>

            <div className="flex flex-wrap gap-4">
              <button
                onClick={speakQuestion}
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-5 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300"
              >
                <Volume2 className="h-4 w-4" />
                Read Aloud
              </button>
              <button
                onClick={isRecording ? stopRecording : startRecording}
                disabled={isSubmitting || currentAttempts >= maxAttempts || feedback?.is_correct}
                className={`inline-flex items-center gap-2 rounded-full px-5 py-2 text-sm font-semibold shadow-sm transition ${
                  isRecording
                    ? "bg-rose-600 text-white hover:bg-rose-500"
                    : "bg-slate-900 text-white hover:bg-slate-800"
                }`}
              >
                {isRecording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                {isRecording ? "Stop Recording" : "Record Answer"}
              </button>
            </div>

            <div className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
              Attempts remaining: {attemptsRemaining}
            </div>

            <div className="grid gap-4 rounded-3xl border border-slate-200 bg-white/80 p-6">
              <div className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Transcript</div>
              <p className="text-base text-slate-800">
                {isSubmitting ? "Analyzing your answer..." : transcript || "Awaiting your response."}
              </p>
            </div>

            {feedback && (
              <div className="grid gap-4 rounded-3xl border border-slate-200 bg-white/80 p-6">
                <div className="flex items-center gap-3 text-lg font-semibold">
                  {feedback.is_correct ? (
                    <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                  ) : (
                    <XCircle className="h-5 w-5 text-rose-600" />
                  )}
                  {feedback.is_correct ? "Correct" : "Needs Improvement"}
                </div>
                <p className="text-base text-slate-700">{feedback.feedback_speech}</p>
                {!feedback.is_correct && currentAttempts >= maxAttempts && (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    Correct answer: {currentQuestion.reference_answer}
                  </div>
                )}
              </div>
            )}

            {errorMessage && (
              <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">
                {errorMessage}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-4">
              <button
                onClick={handleNext}
                disabled={!canProceed}
                className="inline-flex items-center gap-2 rounded-full bg-amber-600/90 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-amber-200 transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next Question
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </section>
        )}

        {step === "results" && (
          <section className="mt-12 space-y-8 rounded-[36px] border border-white/70 bg-white/70 p-10 shadow-2xl shadow-amber-100/80 backdrop-blur">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.2em] text-amber-700">Results</p>
                <h2 className="mt-2 text-3xl font-semibold text-slate-900">Final Score</h2>
              </div>
              <div className="rounded-full bg-emerald-600/90 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-emerald-200">
                {score}/{questions.length}
              </div>
            </div>

            <div className="grid gap-4">
              {questions.map((question, index) => {
                const item = history[index];
                return (
                  <div
                    key={`${question.question}-${index}`}
                    className="rounded-3xl border border-slate-200 bg-white/80 p-6"
                  >
                    <div className="flex items-center gap-3 text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
                      Question {index + 1}
                    </div>
                    <p className="mt-3 text-base font-semibold text-slate-800">{question.question}</p>
                  <div className="mt-3 flex items-center gap-2 text-sm">
                    {item?.is_correct ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    ) : (
                      <XCircle className="h-4 w-4 text-rose-600" />
                    )}
                    <span className="font-semibold">
                      {item?.is_correct ? "Correct" : "Incorrect"}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-slate-600">
                    Your answer: {item?.transcript || "No answer recorded."}
                  </p>
                  <p className="mt-2 text-sm text-slate-600">
                    Correct answer: {item?.reference_answer || question.reference_answer}
                  </p>
                </div>
              );
            })}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
