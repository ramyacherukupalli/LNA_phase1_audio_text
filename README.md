# PrepMeAi

PrepMeAi is a small full-stack study app that generates quiz questions from a textbook and lets students answer them with spoken responses. The repository contains a Python FastAPI backend and a Next.js frontend.

## What the project does

- Generates quiz questions from the textbook PDF using an LLM.
- Grades spoken or transcribed answers against a reference answer.
- Uses a frontend UI to trigger quiz generation and display results.
- Keeps secrets local through a backend `.env` file.

## Repository Layout

- `backend/` - FastAPI app, textbook PDF handling, question generation, answer grading, and transcription helpers.
- `frontend/` - Next.js app used for the user interface.
- `app.py` - project entry point or helper script.
- `requirements.txt` - Python dependencies for the backend.

## Backend Overview

The backend lives in [backend/main.py](backend/main.py) and exposes the logic for extracting textbook text, sampling content across the full book, and generating quiz questions.

### Important backend settings

- `GROQ_API_KEY` - required for quiz generation and grading.
- `COLAB_WHISPER_URL` - required for transcription of audio answers.

These values should be stored only in [backend/.env](backend/.env) locally. A safe template is provided in [backend/.env.example](backend/.env.example).

### Question generation flow

1. The PDF is split into chunks of pages.
2. Several chunks are sampled across the full textbook.
3. Text excerpts from those chunks are combined into a single prompt.
4. The model is asked to return a JSON array of quiz questions.
5. The backend normalizes the model response before returning it to the client.

### Key behaviors and safeguards

- The code retries with a fallback model if the primary model is rate-limited.
- JSON parsing is defensive and can recover from wrapped model output.
- The PDF is cached in memory by page range to avoid repeated heavy extraction.
- Missing env vars return clear 500 errors instead of failing silently.

## Frontend Overview

The frontend is a Next.js application under [frontend/](frontend). It is responsible for the quiz experience, starting generation, and rendering the returned questions and answers.

The frontend includes its own `.gitignore`, but the repository root also ignores generated build output and local secrets so the whole repo stays safe to push.

## Local Setup

### 1. Python backend

Create and activate a virtual environment, then install the backend dependencies.

```bash
pip install -r requirements.txt
```

If you are using the project’s backend folder directly, place your local environment variables in [backend/.env](backend/.env):

```env
GROQ_API_KEY=your_groq_api_key_here
COLAB_WHISPER_URL=https://your-transcription-service.example.com/evaluate-audio
```

### 2. Frontend

Install the frontend dependencies from the `frontend/` directory.

```bash
cd frontend
npm install
npm run dev
```

The app will usually run at `http://localhost:3000`.

### 3. Backend server

Start the backend from the `backend/` directory using your preferred Python runner.

```bash
cd backend
python main.py
```

If the backend is wired for FastAPI development with Uvicorn in your local environment, use the command that matches your existing startup script.

## Safe Push Checklist

Before pushing to GitHub, verify the following:

- [x] `backend/.env` is ignored.
- [x] `frontend/.next/` is ignored.
- [x] `frontend/node_modules/` is ignored.
- [x] `venv/` is ignored.
- [x] `backend/.env.example` is committed instead of real secrets.
- [x] No PDF or generated artifacts are staged unless you intentionally want them in the repo.

## Troubleshooting

- If quiz generation fails, confirm `GROQ_API_KEY` is set and valid.
- If transcription fails, confirm `COLAB_WHISPER_URL` is reachable.
- If the frontend hangs on generation, inspect the browser console and backend logs for request timeouts or malformed JSON responses.
- If you accidentally created generated files in a nested folder, make sure the root `.gitignore` is still excluding them.

## Notes

- The repository root is currently inside the user home directory, so avoid running `git add .` from the home root.
- Stage only the files under `PrepMeAi/` that you actually want to publish.
- Keep real secrets in local env files only.
