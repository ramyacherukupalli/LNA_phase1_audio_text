#!/usr/bin/env python3
"""
Groq API Limit Checker

This script checks your Groq API usage and quota information.
Requires GROQ_API_KEY to be set in the environment or in a .env file.

Usage:
    python scripts/check_groq_api_limit.py
"""

import os
import sys
from pathlib import Path

try:
    from groq import Groq
except ImportError:
    print("❌ Error: 'groq' library not installed.")
    print("   Install it with: pip install groq")
    sys.exit(1)


def load_env_file() -> None:
    """Load environment variables from .env file if it exists."""
    env_path = Path(__file__).resolve().parent.parent / "backend" / ".env"
    if not env_path.exists():
        return
    try:
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value
    except Exception as e:
        print(f"⚠️  Warning: Could not load .env file: {e}")


def parse_int_env(var_name: str) -> int | None:
    """Parse an integer env var; return None when unset or invalid."""
    raw_value = os.getenv(var_name, "").strip()
    if not raw_value:
        return None
    raw_value = raw_value.strip('"').strip("'").replace(",", "")
    try:
        return int(raw_value)
    except ValueError:
        return None


def check_api_limit() -> None:
    """Check Groq API quota and usage."""
    load_env_file()
    
    api_key = os.getenv("GROQ_API_KEY", "").strip()
    if not api_key:
        print("❌ Error: GROQ_API_KEY is not set.")
        print("   Set it in your environment or in backend/.env")
        sys.exit(1)
    
    print("🔍 Checking Groq API quota...\n")
    
    try:
        # Initialize Groq client - strip quotes if present
        api_key_clean = api_key.strip('"').strip("'")
        client = Groq(api_key=api_key_clean)
        
        # Test the API by making a simple request
        # We use a very short timeout and minimal input to minimize usage
        response = client.chat.completions.create(
            model="llama-3.1-8b-instant",  # smallest/fastest model for testing
            messages=[{"role": "user", "content": "Respond with: OK"}],
            max_tokens=5,
            timeout=10,
        )
        
        # If we got here, the API key is valid
        print("✅ API Key: VALID")
        print("✅ API Connection: SUCCESS\n")
        
        print("📊 API Status:")
        print(f"   Response ID: {response.id}")
        print(f"   Model: {response.model}")
        print(f"   Created: {response.created}")
        print(f"   Tokens used (this test): {response.usage.total_tokens}")
        print(f"   - Prompt: {response.usage.prompt_tokens}")
        print(f"   - Completion: {response.usage.completion_tokens}\n")

        budget = parse_int_env("GROQ_TOKEN_BUDGET")
        used = parse_int_env("GROQ_TOKEN_USED")
        if budget is not None and used is not None:
            remaining = max(budget - used - response.usage.total_tokens, 0)
            print("🧮 Token Budget (estimated):")
            print(f"   Budget: {budget}")
            print(f"   Used (before this test): {used}")
            print(f"   Remaining (after this test): {remaining}\n")
        elif budget is not None:
            print("🧮 Token Budget (estimated):")
            print(f"   Budget: {budget}")
            print("   Set GROQ_TOKEN_USED to compute remaining tokens.\n")
        
        print("ℹ️  Note:")
        print("   Groq does not expose a public 'quota' or 'remaining credits' endpoint.")
        print("   You can check your usage and rate limits on the Groq Console:")
        print("   https://console.groq.com/keys")
        print("\n   Common rate limits:")
        print("   - Free tier: Variable RPM (requests per minute)")
        print("   - Check your Groq dashboard for your specific limits")
        print("   - 429 errors indicate rate limiting; use exponential backoff\n")
        
    except Exception as e:
        error_str = str(e).lower()
        
        # Handle common error cases
        if "401" in error_str or "unauthorized" in error_str:
            print(f"❌ Error: Invalid API Key")
            print(f"   Details: {e}\n")
        elif "429" in error_str or "rate" in error_str:
            print(f"⚠️  Rate Limited: You have hit the API rate limit")
            print(f"   Details: {e}\n")
            print("   Solutions:")
            print("   1. Wait a few minutes before retrying")
            print("   2. Check your Groq Console for rate limit details")
            print("   3. Implement exponential backoff in your application\n")
        elif "timeout" in error_str or "connection" in error_str:
            print(f"❌ Connection Error: Could not reach Groq API")
            print(f"   Details: {e}\n")
        else:
            print(f"❌ Error: {e}\n")
        
        sys.exit(1)


if __name__ == "__main__":
    check_api_limit()
