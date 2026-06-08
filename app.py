from flask import Flask, render_template, request, jsonify, redirect, url_for
from werkzeug.utils import secure_filename
from functools import wraps
import os, requests, jwt
from dotenv import load_dotenv

from langchain_community.document_loaders import PyPDFLoader
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_huggingface import HuggingFaceEmbeddings
from pinecone import Pinecone
from langchain_pinecone import PineconeVectorStore
from langchain_groq import ChatGroq
from langchain.chains import RetrievalQA
from langchain.prompts import PromptTemplate

from db import (
    get_or_create_user,
    save_pdf_metadata,
    get_user_pdfs,
    save_chat,
    get_chat_history,
    get_dashboard_data,
    get_user_settings,
    update_user_settings,
    delete_pdf,
)

load_dotenv()

GROQ_API_KEY          = os.getenv("GROQ_API_KEY")
PINECONE_API_KEY      = os.getenv("PINECONE_API_KEY")
CLERK_SECRET_KEY      = os.getenv("CLERK_SECRET_KEY")
CLERK_PUBLISHABLE_KEY = os.getenv("CLERK_PUBLISHABLE_KEY")
INDEX_NAME            = "pdf-chatbot"

app = Flask(__name__)
app.config["UPLOAD_FOLDER"]      = "uploads"
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024

os.makedirs(app.config["UPLOAD_FOLDER"], exist_ok=True)

embeddings = HuggingFaceEmbeddings(model_name="sentence-transformers/all-MiniLM-L6-v2")
pc         = Pinecone(api_key=PINECONE_API_KEY)
llm        = ChatGroq(
    groq_api_key=GROQ_API_KEY,
    model_name="llama-3.3-70b-versatile",
    temperature=0.3,
    request_timeout=60,
)

PROMPT_TEMPLATE = """Answer the question using ONLY the provided PDF context.
If the answer is not found in the PDF context, respond with exactly: Answer not found in PDF.

Context:
{context}

Question:
{question}

Answer:"""


# ── Clerk JWT verification ────────────────────────────────────────────────────

_clerk_jwks = None

def _get_jwks():
    global _clerk_jwks
    if _clerk_jwks is None:
        try:
            import base64
            raw    = CLERK_PUBLISHABLE_KEY.split("_", 2)[2]
            pad    = 4 - len(raw) % 4
            domain = base64.b64decode(raw + "=" * pad).decode().rstrip("$")
            jwks_url = f"https://{domain}/.well-known/jwks.json"
            resp = requests.get(jwks_url, timeout=10)
            resp.raise_for_status()
        except Exception:
            resp = requests.get(
                "https://api.clerk.com/v1/jwks",
                headers={"Authorization": f"Bearer {CLERK_SECRET_KEY}"},
                timeout=10,
            )
            resp.raise_for_status()
        _clerk_jwks = resp.json()
    return _clerk_jwks


def verify_clerk_token(token: str) -> dict:
    jwks = _get_jwks()
    from jwt.algorithms import RSAAlgorithm
    import json

    header     = jwt.get_unverified_header(token)
    kid        = header.get("kid")
    public_key = None
    for key in jwks.get("keys", []):
        if key.get("kid") == kid:
            public_key = RSAAlgorithm.from_jwk(json.dumps(key))
            break

    if public_key is None:
        raise ValueError("Public key not found for kid")

    return jwt.decode(token, public_key, algorithms=["RS256"], options={"verify_aud": False})


def get_user_id_from_request() -> str | None:
    auth  = request.headers.get("Authorization", "")
    token = auth[7:] if auth.startswith("Bearer ") else request.cookies.get("__session")
    if not token:
        print("[AUTH] No token found in request")
        return None
    try:
        payload = verify_clerk_token(token)
        return payload.get("sub")
    except Exception as e:
        print(f"[AUTH] Token verification failed: {e} — retrying with fresh JWKS")
        # Clear JWKS cache and retry once
        global _clerk_jwks
        _clerk_jwks = None
        try:
            payload = verify_clerk_token(token)
            return payload.get("sub")
        except Exception as e2:
            print(f"[AUTH] Retry also failed: {e2}")
            return None


def require_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        user_id = get_user_id_from_request()
        if not user_id:
            if request.is_json or request.method == "POST":
                return jsonify({"error": "Unauthorized. Please sign in."}), 401
            return redirect(url_for("login"))
        request.clerk_user_id = user_id
        return f(*args, **kwargs)
    return decorated


# ── Page routes ───────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html", publishable_key=CLERK_PUBLISHABLE_KEY)


@app.route("/login")
def login():
    return render_template("login.html", publishable_key=CLERK_PUBLISHABLE_KEY)


@app.route("/signup")
def signup():
    return render_template("signup.html", publishable_key=CLERK_PUBLISHABLE_KEY)


# ── Auth sync — called by frontend after Clerk sign-in ───────────────────────

@app.route("/api/auth/sync", methods=["POST"])
@require_auth
def sync_user():
    """
    Called once after login to upsert the user into Supabase.
    Body: { email, name }
    """
    data  = request.get_json(silent=True) or {}
    email = data.get("email", "")
    name  = data.get("name", "")

    try:
        user = get_or_create_user(request.clerk_user_id, email, name)
        return jsonify({"ok": True, "user": user})
    except Exception as e:
        return jsonify({"error": f"User sync failed: {str(e)}"}), 500


# ── Dashboard ─────────────────────────────────────────────────────────────────

@app.route("/api/dashboard", methods=["GET"])
@require_auth
def dashboard():
    """Return PDF list, chat history, counts, last activity."""
    try:
        data = get_dashboard_data(request.clerk_user_id)
        return jsonify(data)
    except Exception as e:
        return jsonify({"error": f"Dashboard fetch failed: {str(e)}"}), 500


# ── PDF routes ────────────────────────────────────────────────────────────────

@app.route("/api/pdfs", methods=["GET"])
@require_auth
def list_pdfs():
    """Return all PDFs for the authenticated user from Supabase."""
    try:
        pdfs = get_user_pdfs(request.clerk_user_id)
        return jsonify({"pdfs": pdfs})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/pdfs/<pdf_id>", methods=["DELETE"])
@require_auth
def remove_pdf(pdf_id):
    ok = delete_pdf(request.clerk_user_id, pdf_id)
    if ok:
        return jsonify({"ok": True})
    return jsonify({"error": "Delete failed or not found."}), 404


@app.route("/upload", methods=["POST"])
@require_auth
def upload():
    import traceback
    user_id = request.clerk_user_id

    if "pdf" not in request.files:
        return jsonify({"error": "No file part in request."}), 400

    file = request.files["pdf"]
    if not file or file.filename == "":
        return jsonify({"error": "No file selected."}), 400
    if not file.filename.lower().endswith(".pdf"):
        return jsonify({"error": "Only PDF files are allowed."}), 400

    filename  = secure_filename(file.filename)
    filepath  = os.path.join(app.config["UPLOAD_FOLDER"], filename)
    file.save(filepath)
    file_size = os.path.getsize(filepath)

    try:
        loader    = PyPDFLoader(filepath)
        documents = loader.load()

        if not documents:
            return jsonify({"error": "Could not extract text from PDF. It may be scanned or empty."}), 422

        splitter = RecursiveCharacterTextSplitter(chunk_size=500, chunk_overlap=100)
        docs     = splitter.split_documents(documents)

        # Store embeddings in Pinecone under user's namespace
        PineconeVectorStore.from_documents(
            documents=docs,
            embedding=embeddings,
            index_name=INDEX_NAME,
            namespace=user_id,
        )

        # Store metadata in Supabase (non-critical — don't fail upload if this errors)
        pdf_record = None
        try:
            pdf_record = save_pdf_metadata(user_id, filename, file_size)
        except Exception as db_err:
            print(f"[WARN] Supabase metadata save failed: {db_err}")

        return jsonify({
            "message":  f'"{filename}" uploaded and indexed successfully.',
            "filename": filename,
            "pdf":      pdf_record,
        })

    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": f"Processing failed: {str(e)}"}), 500


# ── Chat route ────────────────────────────────────────────────────────────────

@app.route("/ask", methods=["POST"])
@require_auth
def ask():
    user_id  = request.clerk_user_id
    data     = request.get_json(silent=True) or {}
    question = (data.get("question") or "").strip()

    if not question:
        return jsonify({"error": "Question cannot be empty."}), 400

    try:
        PROMPT = PromptTemplate(
            template=PROMPT_TEMPLATE,
            input_variables=["context", "question"],
        )

        # Query only this user's Pinecone namespace
        vector_store = PineconeVectorStore(
            index_name=INDEX_NAME,
            embedding=embeddings,
            namespace=user_id,
        )
        retriever = vector_store.as_retriever(search_kwargs={"k": 5})

        qa_chain = RetrievalQA.from_chain_type(
            llm=llm,
            retriever=retriever,
            chain_type="stuff",
            chain_type_kwargs={"prompt": PROMPT},
        )

        response = qa_chain.invoke({"query": question})
        result   = response.get("result", "").strip()

        if "Answer not found in PDF" in result:
            general = llm.invoke(question)
            answer  = "**Answer not found in the uploaded PDF.**\n\n**General AI Answer:**\n\n" + general.content
        else:
            answer = result

        # Persist to Supabase chat_history (non-blocking — failure won't break chat)
        try:
            save_chat(user_id, question, answer)
        except Exception:
            pass

        return jsonify({"answer": answer})

    except Exception as e:
        return jsonify({"error": f"Error generating answer: {str(e)}"}), 500


# ── Chat history route ────────────────────────────────────────────────────────

@app.route("/api/chat/history", methods=["GET"])
@require_auth
def chat_history():
    limit = min(int(request.args.get("limit", 50)), 100)
    try:
        history = get_chat_history(request.clerk_user_id, limit=limit)
        return jsonify({"history": history})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── Settings routes ───────────────────────────────────────────────────────────

@app.route("/api/settings", methods=["GET"])
@require_auth
def get_settings():
    try:
        settings = get_user_settings(request.clerk_user_id)
        return jsonify(settings)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/settings", methods=["PATCH"])
@require_auth
def patch_settings():
    data = request.get_json(silent=True) or {}
    try:
        updated = update_user_settings(
            request.clerk_user_id,
            theme=data.get("theme"),
            preferences=data.get("preferences"),
        )
        return jsonify(updated)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    app.run(debug=True)
