"""Schema-preserving ingestion for Pointer's canonical assessment datasets.

The LLM and external tools submit structured records to this process.  They never
receive a filesystem write primitive for Core assessment files.  This module
whitelists resources and fields, normalizes records against the existing schema,
deduplicates them, recomputes statistics, and atomically replaces the JSON file.
"""

from __future__ import annotations

import argparse
import copy
import json
import os
import shutil
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit


MAX_RECORDS = 250
MAX_TEXT = 20_000
MAX_PAYLOAD_BYTES = 1_000_000

RESOURCE_SPECS = {
    "active-recon": {
        "path": "recon/active-recon.json",
        "collection": "discoveredAssets",
        "template": "discoveredAssetTemplate",
        "keys": ("type", "value"),
    },
    "passive-recon": {
        "path": "recon/passive-recon.json",
        "collection": "discoveredAssets",
        "template": "discoveredAssetTemplate",
        "keys": ("type", "value"),
    },
    "endpoints": {
        "path": "enumeration/endpoints.json",
        "collection": "endpoints",
        "template": "endpointTemplate",
        "keys": ("method", "url"),
    },
    "pages": {
        "path": "enumeration/pages.json",
        "collection": "pages",
        "template": "pageTemplate",
        "keys": ("url",),
    },
    "subdomains": {
        "path": "enumeration/subdomains.json",
        "collection": "subdomains",
        "template": "subdomainTemplate",
        "keys": ("hostname",),
    },
    "assets": {
        "path": "enumeration/assets.json",
        "collection": "assets",
        "template": "assetTemplate",
        "keys": ("assetType", "value"),
    },
    "services": {
        "path": "vulnerability-scans/services.json",
        "collection": "services",
        "template": "serviceTemplate",
        "keys": ("host", "port", "transport"),
    },
}


class IngestError(Exception):
    def __init__(self, message: str, code: str = "INGEST_INVALID") -> None:
        super().__init__(message)
        self.code = code


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def bounded(value: Any, depth: int = 0) -> Any:
    if depth > 6:
        return None
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        return value[:MAX_TEXT]
    if isinstance(value, list):
        return [bounded(item, depth + 1) for item in value[:200]]
    if isinstance(value, dict):
        return {str(key)[:100]: bounded(item, depth + 1) for key, item in list(value.items())[:200]}
    return str(value)[:MAX_TEXT]


def merge_against_template(template: Any, incoming: Any) -> Any:
    """Copy only fields represented by the canonical template, recursively."""
    if isinstance(template, dict):
        source = incoming if isinstance(incoming, dict) else {}
        return {
            key: merge_against_template(default, source[key]) if key in source else copy.deepcopy(default)
            for key, default in template.items()
        }
    if isinstance(template, list):
        return bounded(incoming) if isinstance(incoming, list) else copy.deepcopy(template)
    if incoming is None:
        return copy.deepcopy(template)
    if isinstance(template, bool):
        return incoming if isinstance(incoming, bool) else copy.deepcopy(template)
    if isinstance(template, int) and not isinstance(template, bool):
        try:
            return int(incoming)
        except (TypeError, ValueError):
            return copy.deepcopy(template)
    if isinstance(template, float):
        try:
            return float(incoming)
        except (TypeError, ValueError):
            return copy.deepcopy(template)
    if template is None:
        return bounded(incoming)
    return str(incoming)[:MAX_TEXT]


def enrich(resource: str, record: dict[str, Any], source: str, now: str) -> dict[str, Any]:
    if "source" in record and not record.get("source"):
        record["source"] = source
    if "discoveredBy" in record and not record.get("discoveredBy"):
        record["discoveredBy"] = source
    for field in ("discoveredAt", "firstSeen"):
        if field in record and not record.get(field):
            record[field] = now
    for field in ("lastSeen", "lastCheckedAt"):
        if field in record:
            record[field] = now

    if resource == "endpoints" and record.get("url"):
        parsed = urlsplit(str(record["url"]))
        record["scheme"] = record.get("scheme") or parsed.scheme or "https"
        record["host"] = record.get("host") or (parsed.hostname or "")
        record["port"] = record.get("port") or parsed.port or (443 if record["scheme"] == "https" else 80)
        record["path"] = record.get("path") or parsed.path or "/"
        record["method"] = str(record.get("method") or "GET").upper()
    if resource == "pages" and record.get("url") and not record.get("path"):
        record["path"] = urlsplit(str(record["url"])).path or "/"
    if resource == "subdomains":
        record["hostname"] = str(record.get("hostname") or "").strip().lower().rstrip(".")
    if resource == "services":
        record["transport"] = str(record.get("transport") or "tcp").lower()
    return record


def identity(record: dict[str, Any], keys: tuple[str, ...]) -> tuple[str, ...]:
    return tuple(json.dumps(record.get(key), sort_keys=True, ensure_ascii=False).lower() for key in keys)


def is_meaningful(record: dict[str, Any], keys: tuple[str, ...]) -> bool:
    values = [record.get(key) for key in keys]
    return bool(values) and any(value not in (None, "", [], {}) for value in values)


def statistics(resource: str, rows: list[dict[str, Any]]) -> dict[str, int]:
    if resource == "endpoints" or resource == "pages":
        return {
            "total": len(rows),
            "authenticated": sum(row.get("authentication") not in (None, "", "unknown", "none", "unauthenticated") for row in rows),
            "unauthenticated": sum(row.get("authentication") in ("none", "unauthenticated") for row in rows),
            "tested": sum(row.get("tested") is True for row in rows),
            "untested": sum(row.get("tested") is not True for row in rows),
        }
    if resource == "subdomains":
        return {
            "total": len(rows),
            "live": sum(row.get("live") is True for row in rows),
            "inScope": sum(row.get("inScope") is True for row in rows),
            "takeoverCandidates": sum(row.get("takeoverStatus") not in (None, "", "not-checked", "not-vulnerable") for row in rows),
            "tested": sum(row.get("tested") is True for row in rows),
        }
    if resource == "assets":
        return {
            "total": len(rows),
            "inScope": sum(row.get("inScope") is True for row in rows),
            "outOfScope": sum(row.get("inScope") is False for row in rows),
            "unknownScope": sum(row.get("inScope") is None for row in rows),
            "live": sum(row.get("live") is True or row.get("status") == "live" for row in rows),
            "stale": sum(row.get("status") == "stale" for row in rows),
            "untested": sum(row.get("tested") is not True for row in rows),
        }
    if resource == "services":
        return {
            "total": len(rows),
            "current": sum(row.get("versionStatus") == "current" for row in rows),
            "outdated": sum(row.get("versionStatus") == "outdated" for row in rows),
            "endOfLife": sum(row.get("endOfLife") is True for row in rows),
            "unknown": sum(row.get("versionStatus") not in ("current", "outdated") and row.get("endOfLife") is not True for row in rows),
        }
    return {}


def atomic_json_write(target: Path, document: dict[str, Any]) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    encoded = (json.dumps(document, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
    fd, temp_name = tempfile.mkstemp(prefix=f".{target.name}.", suffix=".tmp", dir=str(target.parent))
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(encoded)
            stream.flush()
            os.fsync(stream.fileno())
        with open(temp_name, "r", encoding="utf-8") as stream:
            json.load(stream)
        if target.exists():
            shutil.copy2(target, target.with_suffix(target.suffix + ".bak"))
        os.replace(temp_name, target)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)


def ingest(payload: dict[str, Any]) -> dict[str, Any]:
    workspace_raw = str(payload.get("workspace") or "").strip()
    resource = str(payload.get("resource") or "").strip().lower()
    records = payload.get("records")
    source = str(payload.get("source") or "typed-ingest").strip()[:160] or "typed-ingest"
    if not workspace_raw:
        raise IngestError("Assessment workspace is required", "WORKSPACE_REQUIRED")
    if resource not in RESOURCE_SPECS:
        raise IngestError("This Core resource is not writable through typed ingestion", "RESOURCE_NOT_ALLOWED")
    if not isinstance(records, list) or not records:
        raise IngestError("At least one structured record is required", "RECORDS_REQUIRED")
    if len(records) > MAX_RECORDS:
        raise IngestError(f"At most {MAX_RECORDS} records may be ingested at once", "RECORD_LIMIT")

    workspace = Path(workspace_raw).resolve(strict=True)
    spec = RESOURCE_SPECS[resource]
    target = (workspace / spec["path"]).resolve(strict=True)
    try:
        target.relative_to(workspace)
    except ValueError as exc:
        raise IngestError("Resolved dataset escaped the assessment workspace", "PATH_ESCAPE") from exc

    with target.open("r", encoding="utf-8") as stream:
        document = json.load(stream)
    template = document.get(spec["template"])
    if not isinstance(template, dict):
        raise IngestError("The canonical dataset template is missing or invalid", "SCHEMA_INVALID")
    existing = document.get(spec["collection"])
    if not isinstance(existing, list):
        raise IngestError("The canonical dataset collection is missing or invalid", "SCHEMA_INVALID")

    now = utc_now()
    accepted: list[dict[str, Any]] = []
    rejected = 0
    for raw in records:
        if not isinstance(raw, dict):
            rejected += 1
            continue
        normalized = enrich(resource, merge_against_template(template, raw), source, now)
        if not is_meaningful(normalized, spec["keys"]):
            rejected += 1
            continue
        accepted.append(normalized)

    merged: dict[tuple[str, ...], dict[str, Any]] = {}
    order: list[tuple[str, ...]] = []
    for row in [*existing, *accepted]:
        if not isinstance(row, dict) or not is_meaningful(row, spec["keys"]):
            continue
        key = identity(row, spec["keys"])
        if key not in merged:
            order.append(key)
        merged[key] = row
    rows = [merged[key] for key in order]
    document[spec["collection"]] = rows
    if "statistics" in document:
        document["statistics"] = statistics(resource, rows)
    if resource == "assets":
        document["lastReconciledAt"] = now

    atomic_json_write(target, document)
    return {
        "ok": True,
        "resource": resource,
        "path": spec["path"],
        "collection": spec["collection"],
        "accepted": len(accepted),
        "rejected": rejected,
        "total": len(rows),
        "source": source,
    }


def read_payload(raw: str) -> dict[str, Any]:
    data = sys.stdin.buffer.read(MAX_PAYLOAD_BYTES + 1) if raw == "-" else raw.encode("utf-8")
    if len(data) > MAX_PAYLOAD_BYTES:
        raise IngestError("Ingestion payload exceeds 1 MB", "PAYLOAD_TOO_LARGE")
    parsed = json.loads(data.decode("utf-8"))
    if not isinstance(parsed, dict):
        raise IngestError("Ingestion payload must be an object", "PAYLOAD_INVALID")
    return parsed


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--payload", required=True)
    args = parser.parse_args()
    try:
        result = ingest(read_payload(args.payload))
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except (IngestError, json.JSONDecodeError, OSError) as exc:
        code = exc.code if isinstance(exc, IngestError) else "INGEST_FAILED"
        print(json.dumps({"ok": False, "error": str(exc), "code": code}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
