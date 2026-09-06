from __future__ import annotations

from datetime import UTC, datetime
import hashlib
import json
from pathlib import Path
from typing import Any

import chromadb
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from sentence_transformers import SentenceTransformer

from parser import parse_metrics, parse_models

DBT_PROJECT = Path(__file__).resolve().parents[2] / "dbt-project"
MANIFEST_PATH = DBT_PROJECT / "target" / "manifest.json"
SEMANTIC_MANIFEST_PATH = DBT_PROJECT / "target" / "semantic_manifest.json"
CHROMA_PATH = DBT_PROJECT.parent / "data" / "chroma"
MODEL_NAME = "BAAI/bge-m3"

app = FastAPI(title="AskData artifact parser")
embedder: SentenceTransformer | None = None
client: chromadb.ClientAPI | None = None
last_sync: str | None = None
model_count = 0
metric_count = 0


class SearchRequest(BaseModel):
    query: str
    top_k: int = Field(default=5, ge=1, le=20)


class HashEmbedder:
    dimension = 1024

    def encode(self, texts: list[str], show_progress_bar: bool = False):
        vectors = []
        for text in texts:
            vector = [0.0] * self.dimension
            for token in text.lower().split():
                digest = hashlib.sha256(token.encode("utf-8")).digest()
                for index in range(0, len(digest), 2):
                    position = int.from_bytes(digest[index:index + 2], "little") % self.dimension
                    vector[position] += ((digest[index] << 8) + digest[index + 1]) / 65535.0
            vectors.append(vector)
        return vectors


def get_embedder() -> SentenceTransformer | HashEmbedder:
    global embedder
    if embedder is None:
        try:
            embedder = SentenceTransformer(MODEL_NAME)
        except OSError:
            embedder = HashEmbedder()
    return embedder


def get_client() -> chromadb.ClientAPI:
    global client
    if client is None:
        client = chromadb.PersistentClient(path=str(CHROMA_PATH))
    return client


def reset_collection(name: str) -> chromadb.Collection:
    database = get_client()
    try:
        database.delete_collection(name)
    except Exception:
        pass
    return database.get_or_create_collection(name)


def index_items(collection: chromadb.Collection, items: list[dict[str, Any]]) -> None:
    if not items:
        return
    texts = [item["description"] for item in items]
    encoded = get_embedder().encode(texts, show_progress_bar=False)
    embeddings = encoded.tolist() if hasattr(encoded, "tolist") else encoded
    collection.add(
        ids=[item["id"] for item in items],
        documents=texts,
        metadatas=[
            {
                "name": item["name"],
                **{
                    key: value if isinstance(value, (str, int, float, bool)) else json.dumps(value, ensure_ascii=False)
                    for key, value in item.get("metadata", {}).items()
                },
            }
            for item in items
        ],
        embeddings=embeddings,
    )


def query_collection(name: str, request: SearchRequest) -> list[dict[str, Any]]:
    try:
        collection = get_client().get_collection(name)
    except Exception:
        return []
    if collection.count() == 0:
        return []
    encoded_query = get_embedder().encode([request.query], show_progress_bar=False)
    query_embedding = encoded_query.tolist() if hasattr(encoded_query, "tolist") else encoded_query
    results = collection.query(
        query_embeddings=query_embedding,
        n_results=min(request.top_k, collection.count()),
    )
    output: list[dict[str, Any]] = []
    for index, document in enumerate(results.get("documents", [[]])[0]):
        metadata = results.get("metadatas", [[]])[0][index]
        distance = results.get("distances", [[]])[0][index]
        output.append(
            {
                "name": metadata.get("name", ""),
                "description": document,
                "metadata": metadata,
                "distance": distance,
            }
        )
    return output


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "last_sync": last_sync,
        "model_count": model_count,
        "metric_count": metric_count,
    }


@app.post("/sync")
def sync() -> dict[str, Any]:
    global last_sync, model_count, metric_count
    if not MANIFEST_PATH.exists() or not SEMANTIC_MANIFEST_PATH.exists():
        raise HTTPException(status_code=409, detail="dbt artifacts are not ready")

    models = parse_models(MANIFEST_PATH)
    metrics = parse_metrics(SEMANTIC_MANIFEST_PATH)
    model_count = len(models)
    metric_count = len(metrics)

    model_collection = reset_collection("schema_models")
    metric_collection = reset_collection("metrics")
    index_items(model_collection, models)
    index_items(metric_collection, metrics)
    last_sync = datetime.now(UTC).isoformat()
    return {
        "last_sync": last_sync,
        "model_count": model_count,
        "metric_count": metric_count,
    }


@app.post("/search")
def search(request: SearchRequest) -> dict[str, Any]:
    return {
        "models": query_collection("schema_models", request),
        "metrics": query_collection("metrics", request),
        "join_hints": [],
        "examples": [],
        "knowledge": [],
    }
