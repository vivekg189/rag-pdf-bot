"""
db.py — Supabase database helpers for RAGdoc
Gracefully disabled when SUPABASE keys are not configured.
"""
import os
from datetime import datetime, timezone
from dotenv import load_dotenv

load_dotenv(override=True)

SUPABASE_URL              = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

_SUPABASE_READY = (
    SUPABASE_URL
    and SUPABASE_SERVICE_ROLE_KEY
    and not SUPABASE_URL.startswith("https://your-project")
    and not SUPABASE_SERVICE_ROLE_KEY.startswith("your_")
)

_client = None

if _SUPABASE_READY:
    try:
        from supabase import create_client, Client
        _client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
        print("[Supabase] Connected successfully.")
    except Exception as e:
        print(f"[Supabase] Connection failed: {e}")
        _SUPABASE_READY = False
else:
    print("[Supabase] Keys not configured — running without database persistence.")


def _db():
    if not _client:
        raise RuntimeError("Supabase is not configured.")
    return _client


# ── User helpers ──────────────────────────────────────────────────────────────

def get_or_create_user(clerk_user_id: str, email: str, name: str) -> dict:
    if not _SUPABASE_READY: return {}
    try:
        res = _db().table("users").select("*").eq("clerk_user_id", clerk_user_id).single().execute()
        return res.data
    except Exception:
        pass
    try:
        insert = _db().table("users").insert({"clerk_user_id": clerk_user_id, "email": email, "name": name}).execute()
        user = insert.data[0]
        _db().table("user_settings").insert({"user_id": clerk_user_id, "theme": "light", "preferences": {}}).execute()
        return user
    except Exception:
        try:
            res = _db().table("users").select("*").eq("clerk_user_id", clerk_user_id).single().execute()
            return res.data
        except Exception:
            return {}


def get_user(clerk_user_id: str) -> dict | None:
    if not _SUPABASE_READY: return None
    try:
        res = _db().table("users").select("*").eq("clerk_user_id", clerk_user_id).single().execute()
        return res.data
    except Exception:
        return None


# ── PDF helpers ───────────────────────────────────────────────────────────────

def save_pdf_metadata(clerk_user_id: str, filename: str, file_size: int = 0) -> dict:
    if not _SUPABASE_READY: return {}
    try:
        res = _db().table("pdfs").insert({
            "user_id": clerk_user_id,
            "filename": filename,
            "pinecone_namespace": clerk_user_id,
            "file_size": file_size,
        }).execute()
        return res.data[0]
    except Exception as e:
        print(f"[Supabase] save_pdf_metadata failed: {e}")
        return {}


def get_user_pdfs(clerk_user_id: str) -> list:
    if not _SUPABASE_READY: return []
    try:
        res = _db().table("pdfs").select("*").eq("user_id", clerk_user_id).order("upload_date", desc=True).execute()
        return res.data or []
    except Exception:
        return []


def get_pdf_count(clerk_user_id: str) -> int:
    if not _SUPABASE_READY: return 0
    try:
        res = _db().table("pdfs").select("id", count="exact").eq("user_id", clerk_user_id).execute()
        return res.count or 0
    except Exception:
        return 0


def delete_pdf(clerk_user_id: str, pdf_id: str) -> bool:
    if not _SUPABASE_READY: return False
    try:
        _db().table("pdfs").delete().eq("id", pdf_id).eq("user_id", clerk_user_id).execute()
        return True
    except Exception:
        return False


# ── Chat history helpers ───────────────────────────────────────────────────────

def save_chat(clerk_user_id: str, question: str, answer: str) -> dict | None:
    if not _SUPABASE_READY: return None
    try:
        res = _db().table("chat_history").insert({"user_id": clerk_user_id, "question": question, "answer": answer}).execute()
        return res.data[0]
    except Exception as e:
        print(f"[Supabase] save_chat failed: {e}")
        return None


def get_chat_history(clerk_user_id: str, limit: int = 50) -> list:
    if not _SUPABASE_READY: return []
    try:
        res = _db().table("chat_history").select("*").eq("user_id", clerk_user_id).order("created_at", desc=True).limit(limit).execute()
        return res.data or []
    except Exception:
        return []


def get_last_activity(clerk_user_id: str) -> str | None:
    if not _SUPABASE_READY: return None
    try:
        res = _db().table("chat_history").select("created_at").eq("user_id", clerk_user_id).order("created_at", desc=True).limit(1).execute()
        if res.data:
            return res.data[0]["created_at"]
    except Exception:
        pass
    return None


# ── User settings helpers ─────────────────────────────────────────────────────

def get_user_settings(clerk_user_id: str) -> dict:
    if not _SUPABASE_READY: return {}
    try:
        res = _db().table("user_settings").select("*").eq("user_id", clerk_user_id).single().execute()
        return res.data or {}
    except Exception:
        return {}


def update_user_settings(clerk_user_id: str, theme: str = None, preferences: dict = None) -> dict:
    if not _SUPABASE_READY: return {}
    updates = {"updated_at": datetime.now(timezone.utc).isoformat()}
    if theme is not None: updates["theme"] = theme
    if preferences is not None: updates["preferences"] = preferences
    try:
        res = _db().table("user_settings").update(updates).eq("user_id", clerk_user_id).execute()
        return res.data[0] if res.data else {}
    except Exception:
        return {}


# ── Dashboard aggregate ────────────────────────────────────────────────────────

def get_dashboard_data(clerk_user_id: str) -> dict:
    pdfs      = get_user_pdfs(clerk_user_id)
    chat_hist = get_chat_history(clerk_user_id, limit=20)
    return {
        "pdfs":          pdfs,
        "pdf_count":     len(pdfs),
        "chat_history":  chat_hist,
        "last_activity": get_last_activity(clerk_user_id),
        "settings":      get_user_settings(clerk_user_id),
    }
