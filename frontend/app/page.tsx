"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Brain,
  ChevronRight,
  Loader2,
  Mic,
  MicOff,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Volume2,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type Question = {
  question: string;
  reference_answer: string;
  difficulty?: string;
};

type SemanticEvaluation = {
  transcript: string;
  core_concept_score: number;
  terminology_score: number;
  misconception_score: number;
  total_weighted_score: number;
  feedback_speech: string;
  topic_tag: string;
  is_correct: boolean;
};

type SessionItem = {
  question: string;
  reference_answer: string;
  transcript: string;
  evaluation: SemanticEvaluation;
};

type TopicDetail = { score: number; status: string; action: string };
type MasterProfile = Record<string, Record<string, TopicDetail>>;
type Step = "start" | "quiz" | "analyzing" | "results";

const API = "http://localhost:8000";
const MAX_Q = 4;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function ScoreBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="h-2 w-full rounded-full bg-slate-200">
      <div
        className="h-2 rounded-full transition-all duration-700"
        style={{ width: `${Math.round(value * 100)}%`, background: color }}
      />
    </div>
  );
}

function statusColor(status: string) {
  if (status === "Strong") return { bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-700", bar: "#059669" };
  if (status === "Moderate") return { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700", bar: "#d97706" };
  return { bg: "bg-rose-50", border: "border-rose-200", text: "text-rose-700", bar: "#e11d48" };
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function Home() {
  const [step, setStep] = useState<Step>("start");
  const [currentQuestion, setCurrentQuestion] = useState<Question | null>(null);
  const [sessionHistory, setSessionHistory] = useState<SessionItem[]>([]);
  const sessionRef = useRef<SessionItem[]>([]);
  const [questionNumber, setQuestionNumber] = useState(0);

  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isFetching, setIsFetching] = useState(false);

  const [feedback, setFeedback] = useState<SemanticEvaluation | null>(null);
  const [transcript, setTranscript] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [masterProfile, setMasterProfile] = useState<MasterProfile | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Keep ref in sync
  useEffect(() => { sessionRef.current = sessionHistory; }, [sessionHistory]);

  // TTS feedback
  useEffect(() => {
    if (feedback?.feedback_speech) {
      const u = new SpeechSynthesisUtterance(feedback.feedback_speech);
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    }
  }, [feedback]);

  /* ---------- Start Diagnostic ---------- */
  const handleStart = async () => {
    setErrorMessage("");
    setIsFetching(true);
    try {
      const r = await fetch(`${API}/api/generate-questions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: 1 }),
        signal: AbortSignal.timeout(90_000),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || "Failed to fetch anchor question.");
      const data = await r.json();
      const q = Array.isArray(data) ? data[0] : data;
      if (!q?.question) throw new Error("No question returned.");
      setCurrentQuestion(q);
      setSessionHistory([]);
      sessionRef.current = [];
      setQuestionNumber(1);
      setFeedback(null);
      setTranscript("");
      setMasterProfile(null);
      setStep("quiz");
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : "Unexpected error.");
    } finally {
      setIsFetching(false);
    }
  };

  /* ---------- Audio recording (preserved) ---------- */
  const startRecording = async () => {
    setErrorMessage("");
    if (isRecording || isSubmitting || feedback) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      recorder.onstop = () => setAudioBlob(new Blob(audioChunksRef.current, { type: "audio/webm" }));
      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
    } catch {
      setErrorMessage("Microphone permission denied.");
    }
  };

  const stopRecording = () => {
    if (!mediaRecorderRef.current) return;
    mediaRecorderRef.current.stop();
    mediaRecorderRef.current.stream.getTracks().forEach((t) => t.stop());
    setIsRecording(false);
  };

  /* ---------- Submit recording ---------- */
  const submitRecording = useCallback(async () => {
    if (!audioBlob || !currentQuestion) return;
    setIsSubmitting(true);
    setErrorMessage("");
    setFeedback(null);
    setTranscript("");
    try {
      const fd = new FormData();
      fd.append("audio", audioBlob, "answer.webm");
      fd.append("question", currentQuestion.question);
      fd.append("reference_answer", currentQuestion.reference_answer);
      const r = await fetch(`${API}/api/evaluate-audio`, { method: "POST", body: fd });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || "Evaluation failed.");
      const data = (await r.json()) as SemanticEvaluation;
      setFeedback(data);
      setTranscript(data.transcript);
      const item: SessionItem = {
        question: currentQuestion.question,
        reference_answer: currentQuestion.reference_answer,
        transcript: data.transcript,
        evaluation: data,
      };
      setSessionHistory((prev) => { const next = [...prev, item]; sessionRef.current = next; return next; });
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : "Unexpected error.");
    } finally {
      setIsSubmitting(false);
      setAudioBlob(null);
    }
  }, [audioBlob, currentQuestion]);

  useEffect(() => { if (audioBlob) void submitRecording(); }, [audioBlob, submitRecording]);

  /* ---------- Continue / branch ---------- */
  const handleContinue = async () => {
    if (!feedback || !currentQuestion) return;
    const history = sessionRef.current;

    if (history.length >= MAX_Q) {
      setStep("analyzing");
      setFeedback(null);
      setTranscript("");
      try {
        const results = history.map((h) => ({
          question: h.question,
          transcript: h.transcript,
          total_weighted_score: h.evaluation.total_weighted_score,
          topic_tag: h.evaluation.topic_tag,
          core_concept_score: h.evaluation.core_concept_score,
          terminology_score: h.evaluation.terminology_score,
          misconception_score: h.evaluation.misconception_score,
        }));
        const r = await fetch(`${API}/api/generate-master-profile`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_results: results }),
        });
        if (!r.ok) throw new Error("Profile generation failed.");
        const d = await r.json();
        setMasterProfile(d.master_profile);
      } catch (e) {
        setErrorMessage(e instanceof Error ? e.message : "Profile generation failed.");
      }
      setStep("results");
      return;
    }

    setIsFetching(true);
    setFeedback(null);
    setTranscript("");
    setErrorMessage("");
    try {
      const r = await fetch(`${API}/api/generate-next-question`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          previous_question: currentQuestion.question,
          student_transcript: feedback.transcript,
          score: feedback.total_weighted_score,
          topic: feedback.topic_tag,
        }),
      });
      if (!r.ok) throw new Error("Failed to generate next question.");
      const d = await r.json();
      setCurrentQuestion(d);
      setQuestionNumber((n) => n + 1);
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : "Unexpected error.");
    } finally {
      setIsFetching(false);
    }
  };

  const speakQuestion = () => {
    if (!currentQuestion) return;
    const u = new SpeechSynthesisUtterance(currentQuestion.question);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  };

  const isLastQuestion = sessionHistory.length >= MAX_Q;

  /* ------------------------------------------------------------------ */
  /*  RENDER                                                             */
  /* ------------------------------------------------------------------ */
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#f8f0e7,_#f2e2d3_45%,_#e8d4c0_100%)] text-slate-900">
      <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-6 py-14">

        {/* ---------- Header ---------- */}
        <header className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-white/70 bg-white/70 p-6 shadow-xl shadow-orange-100/60 backdrop-blur">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-amber-700">
              Adaptive Diagnostic Engine
            </p>
            <h1 className="mt-2 text-3xl font-semibold text-slate-900">
              Voice-Powered NCERT Checkpoint
            </h1>
          </div>
          <div className="flex items-center gap-3 rounded-full bg-amber-600/90 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-amber-200">
            <Brain className="h-4 w-4" />
            Smart Diagnostic
          </div>
        </header>

        {/* ====================== START ====================== */}
        {step === "start" && (
          <section className="mt-12 grid gap-8 rounded-[36px] border border-white/70 bg-white/70 p-10 shadow-2xl shadow-amber-100/80 backdrop-blur">
            <div className="max-w-2xl space-y-4">
              <h2 className="text-4xl font-semibold text-slate-900">Ready for Your Diagnostic?</h2>
              <p className="text-lg text-slate-700">
                Answer {MAX_Q} adaptive questions. The system evaluates your understanding in real-time, adjusts difficulty, and builds a personalized knowledge profile.
              </p>
              <div className="flex items-center gap-6 pt-2">
                {[
                  { n: "1", t: "Anchor Question" },
                  { n: "2", t: "Adaptive Branching" },
                  { n: "3", t: "Knowledge Map" },
                ].map((s) => (
                  <div key={s.n} className="flex items-center gap-2 text-sm text-slate-600">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-600 text-xs font-bold text-white">{s.n}</span>
                    {s.t}
                  </div>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-4">
              <button
                onClick={handleStart}
                disabled={isFetching}
                className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-slate-400/40 transition hover:bg-slate-800 disabled:opacity-60"
              >
                {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {isFetching ? "Generating Anchor Question..." : "Start Diagnostic"}
              </button>
              {errorMessage && (
                <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">{errorMessage}</p>
              )}
            </div>
          </section>
        )}

        {/* ====================== QUIZ ====================== */}
        {step === "quiz" && currentQuestion && (
          <section className="mt-12 space-y-8 rounded-[36px] border border-white/70 bg-white/70 p-10 shadow-2xl shadow-amber-100/80 backdrop-blur">
            {/* Top bar */}
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.2em] text-amber-700">Question</p>
                <h2 className="mt-2 text-2xl font-semibold text-slate-900">
                  {questionNumber} of {MAX_Q}
                </h2>
              </div>
              <div className="flex items-center gap-3">
                {currentQuestion.difficulty && (
                  <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider ${
                    currentQuestion.difficulty === "harder"
                      ? "bg-violet-100 text-violet-700"
                      : "bg-sky-100 text-sky-700"
                  }`}>
                    {currentQuestion.difficulty === "harder" ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                    {currentQuestion.difficulty}
                  </span>
                )}
                <span className="rounded-full bg-emerald-600/90 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-emerald-200">
                  {sessionHistory.length}/{MAX_Q} answered
                </span>
              </div>
            </div>

            {/* Progress dots */}
            <div className="flex gap-2">
              {Array.from({ length: MAX_Q }).map((_, i) => (
                <div key={i} className={`h-2 flex-1 rounded-full transition-all ${
                  i < sessionHistory.length ? "bg-emerald-500" : i === sessionHistory.length ? "bg-amber-400" : "bg-slate-200"
                }`} />
              ))}
            </div>

            {/* Question card */}
            {isFetching ? (
              <div className="flex items-center justify-center gap-3 rounded-3xl border border-amber-100 bg-white/80 p-10 shadow-inner">
                <Loader2 className="h-5 w-5 animate-spin text-amber-600" />
                <span className="text-lg text-slate-600">Generating next question...</span>
              </div>
            ) : (
              <div className="rounded-3xl border border-amber-100 bg-white/80 p-8 text-lg text-slate-800 shadow-inner">
                {currentQuestion.question}
              </div>
            )}

            {/* Controls */}
            {!isFetching && !feedback && (
              <div className="flex flex-wrap gap-4">
                <button onClick={speakQuestion} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-5 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300">
                  <Volume2 className="h-4 w-4" /> Read Aloud
                </button>
                <button
                  onClick={isRecording ? stopRecording : startRecording}
                  disabled={isSubmitting}
                  className={`inline-flex items-center gap-2 rounded-full px-5 py-2 text-sm font-semibold shadow-sm transition ${
                    isRecording ? "bg-rose-600 text-white hover:bg-rose-500" : "bg-slate-900 text-white hover:bg-slate-800"
                  }`}
                >
                  {isRecording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                  {isRecording ? "Stop Recording" : "Record Answer"}
                </button>
              </div>
            )}

            {/* Transcript */}
            <div className="grid gap-4 rounded-3xl border border-slate-200 bg-white/80 p-6">
              <div className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Transcript</div>
              <p className="text-base text-slate-800">
                {isSubmitting ? "Analyzing your answer..." : transcript || "Awaiting your response."}
              </p>
            </div>

            {/* Feedback card */}
            {feedback && (
              <div className="space-y-5 rounded-3xl border border-slate-200 bg-white/80 p-6">
                {/* Total score */}
                <div className="flex items-center justify-between">
                  <span className="text-lg font-semibold text-slate-900">Weighted Score</span>
                  <span className={`text-2xl font-bold ${feedback.total_weighted_score >= 0.7 ? "text-emerald-600" : feedback.total_weighted_score >= 0.4 ? "text-amber-600" : "text-rose-600"}`}>
                    {Math.round(feedback.total_weighted_score * 100)}%
                  </span>
                </div>
                <ScoreBar value={feedback.total_weighted_score} color={feedback.total_weighted_score >= 0.7 ? "#059669" : feedback.total_weighted_score >= 0.4 ? "#d97706" : "#e11d48"} />

                {/* Breakdown */}
                <div className="grid gap-3 sm:grid-cols-3">
                  {[
                    { label: "Core Concept", value: feedback.core_concept_score, weight: "50%", color: "#6366f1" },
                    { label: "Terminology", value: feedback.terminology_score, weight: "30%", color: "#0891b2" },
                    { label: "Misconceptions", value: feedback.misconception_score, weight: "−20%", color: "#e11d48" },
                  ].map((m) => (
                    <div key={m.label} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                      <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
                        <span>{m.label}</span><span>{m.weight}</span>
                      </div>
                      <p className="mt-1 text-xl font-bold text-slate-900">{Math.round(m.value * 100)}%</p>
                      <ScoreBar value={m.value} color={m.color} />
                    </div>
                  ))}
                </div>

                {/* Topic & speech */}
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-indigo-100 px-3 py-1 text-xs font-bold text-indigo-700">{feedback.topic_tag}</span>
                </div>
                <p className="text-base text-slate-700">{feedback.feedback_speech}</p>
              </div>
            )}

            {errorMessage && (
              <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">{errorMessage}</p>
            )}

            {/* Continue / View Results */}
            {feedback && (
              <button
                onClick={handleContinue}
                disabled={isFetching}
                className="inline-flex items-center gap-2 rounded-full bg-amber-600/90 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-amber-200 transition hover:bg-amber-500 disabled:opacity-50"
              >
                {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronRight className="h-4 w-4" />}
                {isLastQuestion ? "View Knowledge Profile" : "Next Question"}
              </button>
            )}
          </section>
        )}

        {/* ====================== ANALYZING ====================== */}
        {step === "analyzing" && (
          <section className="mt-12 space-y-6 rounded-[36px] border border-white/70 bg-white/70 p-10 shadow-2xl shadow-amber-100/80 backdrop-blur">
            <div className="flex items-center gap-3 text-amber-700">
              <Loader2 className="h-6 w-6 animate-spin" />
              <p className="text-lg font-semibold">Building your knowledge profile...</p>
            </div>
            {/* Skeleton cards */}
            <div className="grid gap-4 sm:grid-cols-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="animate-pulse space-y-3 rounded-2xl border border-slate-200 bg-white/80 p-6">
                  <div className="h-4 w-24 rounded bg-slate-200" />
                  <div className="h-8 w-16 rounded bg-slate-200" />
                  <div className="h-2 w-full rounded-full bg-slate-200" />
                  <div className="h-3 w-32 rounded bg-slate-100" />
                </div>
              ))}
            </div>
            <div className="h-3 w-full max-w-md rounded-full bg-amber-100">
              <div className="h-3 w-2/3 animate-pulse rounded-full bg-amber-500/80" />
            </div>
          </section>
        )}

        {/* ====================== RESULTS ====================== */}
        {step === "results" && (
          <section className="mt-12 space-y-8 rounded-[36px] border border-white/70 bg-white/70 p-10 shadow-2xl shadow-amber-100/80 backdrop-blur">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.2em] text-amber-700">Knowledge Profile</p>
                <h2 className="mt-2 text-3xl font-semibold text-slate-900">Your Diagnostic Results</h2>
              </div>
              <div className="flex items-center gap-3 rounded-full bg-indigo-600/90 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-200">
                <Brain className="h-4 w-4" /> {sessionHistory.length} Questions Analyzed
              </div>
            </div>

            {/* Legend */}
            <div className="flex flex-wrap gap-4 text-xs font-semibold uppercase tracking-wider">
              <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-emerald-500" />Strong — Revision Only</span>
              <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-amber-500" />Moderate — Light Review</span>
              <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-rose-500" />Weak — Prioritize</span>
            </div>

            {/* Profile cards */}
            {masterProfile ? (
              Object.entries(masterProfile).map(([subject, topics]) => (
                <div key={subject} className="space-y-4">
                  <h3 className="text-xl font-semibold text-slate-900">{subject}</h3>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {Object.entries(topics).map(([topic, detail]) => {
                      const c = statusColor(detail.status);
                      return (
                        <div key={topic} className={`rounded-2xl border ${c.border} ${c.bg} p-5 shadow-sm transition hover:shadow-md`}>
                          <p className="text-sm font-semibold text-slate-800">{topic}</p>
                          <p className={`mt-1 text-3xl font-bold ${c.text}`}>{Math.round(detail.score * 100)}%</p>
                          <ScoreBar value={detail.score} color={c.bar} />
                          <div className="mt-3 flex items-center justify-between">
                            <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${c.text} ${c.bg}`}>{detail.status}</span>
                            <span className="text-xs text-slate-500">{detail.action}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            ) : (
              <p className="text-slate-600">{errorMessage || "No profile data available."}</p>
            )}

            {/* Session history accordion */}
            <details className="rounded-3xl border border-slate-200 bg-white/80 p-6">
              <summary className="cursor-pointer text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
                Session History ({sessionHistory.length} questions)
              </summary>
              <div className="mt-4 grid gap-4">
                {sessionHistory.map((item, i) => (
                  <div key={i} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                    <p className="text-sm font-semibold text-slate-800">Q{i + 1}: {item.question}</p>
                    <p className="mt-1 text-sm text-slate-600">Your answer: {item.transcript}</p>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                      <span className="rounded-full bg-indigo-100 px-2 py-0.5 font-bold text-indigo-700">{item.evaluation.topic_tag}</span>
                      <span className={`rounded-full px-2 py-0.5 font-bold ${item.evaluation.total_weighted_score >= 0.7 ? "bg-emerald-100 text-emerald-700" : item.evaluation.total_weighted_score >= 0.4 ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700"}`}>
                        {Math.round(item.evaluation.total_weighted_score * 100)}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </details>

            {/* Restart */}
            <button
              onClick={() => { setStep("start"); setErrorMessage(""); }}
              className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-slate-400/40 transition hover:bg-slate-800"
            >
              Start New Diagnostic <ArrowRight className="h-4 w-4" />
            </button>
          </section>
        )}
      </div>
    </main>
  );
}
