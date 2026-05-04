import base64
import io
import json
import math
import os
import random
import re

import fitz
import requests
import streamlit as st
from audio_recorder_streamlit import audio_recorder
from gtts import gTTS
from groq import Groq


def load_env_file(path: str) -> dict:
    if not os.path.exists(path):
        return {}
    env = {}
    with open(path, "r", encoding="utf-8") as handle:
        for raw in handle:
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip("\"").strip("'")
            if key:
                env[key] = value
    return env


def get_secret(key: str) -> str:
    try:
        return st.secrets[key]
    except Exception:
        return ""


_env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
_file_env = load_env_file(_env_path)

GROQ_API_KEY = (
    os.getenv("GROQ_API_KEY")
    or _file_env.get("GROQ_API_KEY", "")
    or get_secret("GROQ_API_KEY")
)
COLAB_WHISPER_URL = (
    os.getenv("COLAB_WHISPER_URL")
    or _file_env.get("COLAB_WHISPER_URL", "")
    or get_secret("COLAB_WHISPER_URL")
)

PDF_PATH = "ncert_science_8.pdf"
CHUNK_SIZE_PAGES = 15
CHUNKS_TO_SAMPLE = 4
QUESTIONS_COUNT = 5
MODEL_NAME = "llama-3.3-70b-versatile"


@st.cache_data(show_spinner=False)
def extract_pdf_text(pdf_path: str, start_page: int, end_page: int) -> str:
    doc = fitz.open(pdf_path)
    text_parts = []
    page_count = doc.page_count
    start = max(0, start_page)
    end = min(end_page, page_count)
    for page_index in range(start, end):
        text_parts.append(doc.load_page(page_index).get_text())
    doc.close()
    return "\n".join(text_parts).strip()


@st.cache_data(show_spinner=False)
def chunk_pdf_text(pdf_path: str) -> list:
    """Split the full PDF into chunks of CHUNK_SIZE_PAGES pages each."""
    doc = fitz.open(pdf_path)
    page_count = doc.page_count
    num_chunks = math.ceil(page_count / CHUNK_SIZE_PAGES)
    chunks = []
    for chunk_idx in range(num_chunks):
        start = chunk_idx * CHUNK_SIZE_PAGES
        end = min(start + CHUNK_SIZE_PAGES, page_count)
        text_parts = []
        for page_index in range(start, end):
            text_parts.append(doc.load_page(page_index).get_text())
        chunk_text = "\n".join(text_parts).strip()
        if len(chunk_text) > 100:
            chunks.append(chunk_text)
    doc.close()
    return chunks


def text_to_speech_autoplay(text: str):
    tts = gTTS(text, lang="en")
    audio_fp = io.BytesIO()
    tts.write_to_fp(audio_fp)
    audio_fp.seek(0)
    b64 = base64.b64encode(audio_fp.read()).decode("ascii")
    st.markdown(f'<audio src="data:audio/mp3;base64,{b64}" autoplay></audio>', unsafe_allow_html=True)


def parse_json_array(raw: str):
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r"\[[\s\S]*\]", raw)
        if not match:
            raise
        data = json.loads(match.group(0))
    if not isinstance(data, list):
        raise ValueError("Expected a JSON array.")
    return data


def parse_json_object(raw: str):
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r"\{[\s\S]*\}", raw)
        if not match:
            raise
        data = json.loads(match.group(0))
    if not isinstance(data, dict):
        raise ValueError("Expected a JSON object.")
    return data


def generate_questions_from_chunk(text: str, count: int, client: Groq):
    prompt = (
        "You are an NCERT Class 8 Science teacher. "
        f"Generate exactly {count} educational questions based only on the text. "
        "Cover different concepts and difficulty levels. "
        "Return ONLY a JSON array of objects. "
        "Each object must have exactly two keys: "
        '"question" and "reference_answer".\n\n'
        "Text:\n" + text
    )
    response = client.chat.completions.create(
        model=MODEL_NAME,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.4,
    )
    questions = parse_json_array(response.choices[0].message.content.strip())
    normalized = []
    for item in questions:
        if not isinstance(item, dict):
            continue
        question = str(item.get("question", "")).strip()
        reference_answer = str(item.get("reference_answer", "")).strip()
        if question and reference_answer:
            normalized.append({"question": question, "reference_answer": reference_answer})
    return normalized[:count]


def generate_questions_full_textbook(client: Groq):
    """Generate questions spanning the entire textbook by sampling random chunks."""
    chunks = chunk_pdf_text(PDF_PATH)
    if not chunks:
        raise ValueError("No meaningful text extracted from the PDF.")

    num_to_sample = min(CHUNKS_TO_SAMPLE, len(chunks))
    sampled = random.sample(chunks, num_to_sample)

    base_per_chunk = QUESTIONS_COUNT // num_to_sample
    remainder = QUESTIONS_COUNT % num_to_sample
    counts = [base_per_chunk + (1 if i < remainder else 0) for i in range(num_to_sample)]

    all_questions = []
    for chunk_text, count in zip(sampled, counts):
        if count <= 0:
            continue
        try:
            qs = generate_questions_from_chunk(chunk_text, count, client)
            all_questions.extend(qs)
        except Exception:
            continue

    if len(all_questions) < QUESTIONS_COUNT:
        remaining_chunks = [c for c in chunks if c not in sampled]
        random.shuffle(remaining_chunks)
        needed = QUESTIONS_COUNT - len(all_questions)
        for chunk_text in remaining_chunks:
            if needed <= 0:
                break
            try:
                qs = generate_questions_from_chunk(chunk_text, min(needed, 2), client)
                all_questions.extend(qs)
                needed -= len(qs)
            except Exception:
                continue

    if not all_questions:
        raise ValueError("Failed to generate any questions from the textbook.")

    random.shuffle(all_questions)
    return all_questions[:QUESTIONS_COUNT]


def grade_answer(question: str, reference_answer: str, student_transcript: str, client: Groq):
    prompt = (
        "You are a strict but encouraging Class 8 Science teacher. "
        "Evaluate the student's answer based only on the reference answer. "
        "Return ONLY a valid JSON object with keys: "
        '"is_correct" (boolean) and "feedback_speech" (short encouragement).\n\n'
        f"Question: {question}\n"
        f"Reference Answer: {reference_answer}\n"
        f"Student Answer: {student_transcript}\n"
    )
    response = client.chat.completions.create(
        model=MODEL_NAME,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.1,
        response_format={"type": "json_object"},
    )
    result = parse_json_object(response.choices[0].message.content.strip())
    return {
        "is_correct": bool(result.get("is_correct", False)),
        "feedback_speech": str(result.get("feedback_speech", "")).strip() or "Thanks for your answer.",
    }


st.title("🧬 AI Science Grader")

if "current_q_index" not in st.session_state:
    st.session_state.current_q_index = 0
if "questions" not in st.session_state:
    st.session_state.questions = []
if "total_score" not in st.session_state:
    st.session_state.total_score = 0
if "quiz_complete" not in st.session_state:
    st.session_state.quiz_complete = False
if "feedback_history" not in st.session_state:
    st.session_state.feedback_history = []
if "evaluations" not in st.session_state:
    st.session_state.evaluations = {}
if "play_feedback" not in st.session_state:
    st.session_state.play_feedback = False

if not GROQ_API_KEY:
    st.error("Set GROQ_API_KEY in your environment or Streamlit secrets.")
    st.stop()
if not COLAB_WHISPER_URL:
    st.error("Set COLAB_WHISPER_URL in your environment or Streamlit secrets.")
    st.stop()

client = Groq(api_key=GROQ_API_KEY)

try:
    chunks = chunk_pdf_text(PDF_PATH)
except Exception as exc:
    st.error(f"Failed to read {PDF_PATH}: {exc}")
    st.stop()

if not chunks:
    st.error("No text extracted from the PDF.")
    st.stop()

if not st.session_state.questions:
    with st.spinner("Generating questions from the entire textbook..."):
        try:
            st.session_state.questions = generate_questions_full_textbook(client)
        except Exception as exc:
            st.error(f"Question generation failed: {exc}")
            st.stop()

if st.session_state.current_q_index >= len(st.session_state.questions):
    st.session_state.quiz_complete = True

if st.session_state.quiz_complete:
    st.header("Quiz Complete")
    st.metric("Final Score", f"{st.session_state.total_score}/{len(st.session_state.questions)}")
    st.subheader("Feedback Summary")
    if st.session_state.feedback_history:
        for idx, item in enumerate(st.session_state.feedback_history, start=1):
            st.write(f"{idx}. {item['question']}")
            st.write(f"Your answer: {item['transcript']}")
            st.write(f"Result: {'Correct' if item['is_correct'] else 'Incorrect'}")
            st.write(f"Feedback: {item['feedback_speech']}")
            st.divider()
    else:
        st.write("No feedback available.")
    st.stop()

current_index = st.session_state.current_q_index
current_item = st.session_state.questions[current_index]
question_text = current_item["question"]
reference_answer = current_item["reference_answer"]

st.header(f"Question {current_index + 1} of {len(st.session_state.questions)}")
st.info(question_text)

if st.button("🔊 Read Question Aloud"):
    text_to_speech_autoplay(question_text)

st.divider()
st.write("🎙️ **Record your answer:**")
audio_bytes = audio_recorder(
    text="Click to Record",
    recording_color="#e83e8c",
    neutral_color="#6c757d",
    key=f"audio_recorder_{current_index}",
)

current_eval = st.session_state.evaluations.get(current_index)

if audio_bytes:
    st.audio(audio_bytes, format="audio/wav")

if audio_bytes and current_eval is None:
    if st.button("Submit Answer"):
        with st.spinner("Transcribing audio via Colab..."):
            try:
                files = {"audio": ("student.wav", audio_bytes, "audio/wav")}
                colab_response = requests.post(COLAB_WHISPER_URL, files=files, timeout=120)
                colab_response.raise_for_status()
                payload = colab_response.json()
                if payload.get("status") != "success":
                    raise ValueError("Colab transcription failed.")
                transcript = str(payload.get("transcript", "")).strip()
                if not transcript:
                    raise ValueError("Empty transcript returned from Colab.")
            except Exception as exc:
                st.error(f"Colab transcription failed: {exc}")
                st.stop()

        with st.spinner("Grading against NCERT Textbook..."):
            try:
                evaluation = grade_answer(question_text, reference_answer, transcript, client)
            except Exception as exc:
                st.error(f"Groq grading failed: {exc}")
                st.stop()

        st.session_state.evaluations[current_index] = {
            "transcript": transcript,
            **evaluation,
        }
        st.session_state.feedback_history.append(
            {
                "question": question_text,
                "reference_answer": reference_answer,
                "transcript": transcript,
                "is_correct": evaluation["is_correct"],
                "feedback_speech": evaluation["feedback_speech"],
            }
        )
        if evaluation["is_correct"]:
            st.session_state.total_score += 1
        st.session_state.play_feedback = True
        current_eval = st.session_state.evaluations[current_index]

if current_eval is not None:
    st.success("Transcription Complete!")
    st.write(f"**You said:** {current_eval['transcript']}")
    if current_eval["is_correct"]:
        st.balloons()
        st.success("**Result:** Correct! ✅")
    else:
        st.warning("**Result:** Incorrect ❌")
    st.write(f"**Teacher's Feedback:** {current_eval['feedback_speech']}")

    if st.session_state.play_feedback:
        text_to_speech_autoplay(current_eval["feedback_speech"])
        st.session_state.play_feedback = False

    if st.button("Next Question"):
        st.session_state.current_q_index += 1
        st.session_state.play_feedback = False
