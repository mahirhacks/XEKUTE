#!/usr/bin/env python3
"""Parse and run Pointer slash commands.

The parser is deliberately small and deterministic. It emits one JSON result on
stdout so Electron can safely use it as a local command boundary.
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from urllib.parse import urlparse

DEFAULT_COMMANDS = {
    "/passive": {"role": "static", "description": "Passive public reconnaissance", "output": "recon/passive-recon.json", "tools": ["subfinder", "amass", "theharvester"]},
    "/active": {"role": "static", "description": "Authorized active reconnaissance", "output": "recon/active-recon.json", "tools": ["httpx", "nmap", "ffuf"], "wordlist": "", "rate": 2, "threads": 10},
    "/endpoint": {"role": "static", "description": "Endpoint and page discovery", "output": "enumeration/endpoints.json", "tools": ["katana", "httpx"]},
    "/webclone": {"role": "static", "description": "Authorized WebClone inventory and screenshots", "output": "enumeration/pages.json", "tools": ["katana", "httpx", "gowitness"]},
    "/pentest": {"role": "ai", "aim": "Find and validate security weaknesses within the authorized assessment scope.", "description": "AI-guided penetration testing that stays evidence-led and asks before intrusive actions.", "prompt": "Run a scope-aware, hypothesis-driven penetration-test workflow using the Map and assessment evidence. Ask for confirmation before active testing."},
    "/scope": {"role": "ai", "description": "Review authorization and scope"},
    "/report": {"role": "ai", "description": "Build the assessment report"},
    "/map": {"role": "ai", "description": "Analyze application relationships"},
    "/settings": {"role": "ai", "description": "Open Pointer Settings"},
}

TOOL_COMMANDS = {
    "subfinder": lambda target: ["subfinder", "-d", target, "-silent"],
    "amass": lambda target: ["amass", "enum", "-passive", "-d", target],
    "theharvester": lambda target: ["theHarvester", "-d", target, "-b", "all"],
    "httpx": lambda target: ["httpx", "-silent", "-json", "-u", target],
    "nmap": lambda target: ["nmap", "-Pn", "-T2", "--top-ports", "100", target],
    "katana": lambda target: ["katana", "-u", target, "-silent", "-jsonl", "-d", "3"],
    "gowitness": lambda target: ["gowitness", "scan", "single", "--url", target],
}

def emit(value):
    print(json.dumps(value, ensure_ascii=False), flush=True)

def load_overrides(raw):
    if not raw:
        return {}
    try:
        value = json.loads(raw) if isinstance(raw, str) else raw
        return value if isinstance(value, dict) else {}
    except Exception:
        return {}

def command_config(name, overrides):
    key = name.lower()
    config = dict(DEFAULT_COMMANDS.get(key, {}))
    custom = overrides.get(key) or overrides.get(name) or {}
    if isinstance(custom, dict):
        config.update(custom)
    return config

def parse_command(raw, overrides=None):
    text = str(raw or "").strip()
    if not text.startswith("/"):
        return {"ok": False, "error": "Command must start with '/'", "code": "NOT_SLASH_COMMAND"}
    parts = text.split()
    name = parts[0].lower()
    config = command_config(name, load_overrides(overrides))
    if not config:
        return {"ok": False, "error": f"Unknown slash command: {name}", "code": "UNKNOWN_COMMAND"}
    if config.get("enabled") is False:
        return {"ok": False, "error": f"Slash command is disabled in Pointer Settings: {name}", "code": "COMMAND_DISABLED"}
    return {"ok": True, "command": name, "args": parts[1:], "role": str(config.get("role", "ai")).lower(), "aim": config.get("aim", ""), "description": config.get("description", ""), "prompt": config.get("prompt", ""), "expectedOutput": config.get("expectedOutput", ""), "constraints": config.get("constraints", ""), "output": config.get("output", ""), "tools": config.get("tools", []), "script": config.get("script", ""), "wordlist": config.get("wordlist", ""), "rate": config.get("rate", 2), "threads": config.get("threads", 10)}

def read_json(path, fallback):
    try:
        with open(path, "r", encoding="utf-8") as handle:
            value = json.load(handle)
        return value if isinstance(value, type(fallback)) else fallback
    except Exception:
        return fallback

def in_scope(assessment, target):
    host = urlparse(target if "://" in target else f"https://{target}").hostname or target
    host = host.lower().strip(".")
    scope = read_json(os.path.join(assessment, "scope", "in-scope.json"), {})
    exclusions = read_json(os.path.join(assessment, "scope", "out-of-scope.json"), {})
    def matches(value):
        value = str(value or "").lower().replace("https://", "").replace("http://", "").split("/")[0].split(":")[0]
        return host == value or (value.startswith("*.") and host.endswith(value[1:]))
    if any(matches(item.get("value", "") if isinstance(item, dict) else item) for item in exclusions.get("assets", [])):
        return False, "Target matches scope/out-of-scope.json"
    targets = scope.get("targets", [])
    wildcards = scope.get("wildcardRules", [])
    if not targets and not wildcards:
        return False, "No in-scope targets are configured"
    allowed = any(matches(item.get("value", "") if isinstance(item, dict) else item) for item in targets)
    allowed = allowed or any(matches(item.get("pattern", item.get("value", "")) if isinstance(item, dict) else item) for item in wildcards)
    return allowed, "Matched configured scope" if allowed else "Target is not in scope"

def active_authorized(assessment):
    scope = read_json(os.path.join(assessment, "scope", "in-scope.json"), {})
    config = read_json(os.path.join(assessment, "scope", "configurations.json"), {})
    engagement = read_json(os.path.join(assessment, "scope", "engagement.json"), {})
    gate = config.get("authorizationGate", {})
    confirmed = bool(scope.get("authorization", {}).get("confirmed") and engagement.get("authorization", {}).get("confirmed", True) and gate.get("authorizationConfirmed"))
    reviewed = bool(gate.get("scopeReviewed") and engagement.get("scopeReview", {}).get("reviewed", True))
    rules_accepted = bool(gate.get("rulesAccepted") and engagement.get("scopeReview", {}).get("exclusionsConfirmed", True))
    allow_active = bool(gate.get("allowActiveRecon") or scope.get("rulesOfEngagement", {}).get("allowActiveRecon", False))
    authorized = confirmed and reviewed and rules_accepted and allow_active
    return authorized, "Authorization, scope, and Rules of Engagement confirmed" if authorized else "Active recon requires confirmed authorization, reviewed scope, accepted Rules of Engagement, and allowActiveRecon"

def build_tool_command(tool, target, config, tool_dir):
    if tool == "ffuf":
        wordlist = str(config.get("wordlist") or os.environ.get("POINTER_FFUF_WORDLIST") or "").strip()
        if not wordlist or not os.path.isfile(os.path.expanduser(wordlist)):
            return None, "ffuf requires an explicitly configured wordlist (set command registry wordlist or POINTER_FFUF_WORDLIST)"
        output_file = os.path.join(tool_dir, f"ffuf-{int(time.time())}.json")
        rate = max(1, min(20, int(config.get("rate", 2))))
        threads = max(1, min(20, int(config.get("threads", 10))))
        return ["ffuf", "-u", target.rstrip("/") + "/FUZZ", "-w", os.path.expanduser(wordlist), "-ac", "-rate", str(rate), "-t", str(threads), "-of", "json", "-o", output_file], None
    command = TOOL_COMMANDS.get(tool)
    return (command(target) if command else [tool, target]), None

def parse_lines(tool, text, target):
    assets, endpoints, pages = [], [], []
    for line in str(text or "").splitlines():
        value = line.strip()
        if not value:
            continue
        item = None
        try:
            item = json.loads(value)
        except Exception:
            pass
        url = (item or {}).get("url") or (item or {}).get("input") if isinstance(item, dict) else None
        if url:
            endpoint = urlparse(url)
            endpoints.append({"method": (item or {}).get("method", "GET"), "host": endpoint.hostname or "", "path": endpoint.path or "/", "url": url, "statusCode": (item or {}).get("status-code") or (item or {}).get("status_code"), "discoveredBy": tool})
            pages.append({"url": url, "path": endpoint.path or "/", "title": (item or {}).get("title", ""), "statusCode": (item or {}).get("status-code") or (item or {}).get("status_code"), "discoveredBy": tool})
        elif re.match(r"^[A-Za-z0-9._-]+\.[A-Za-z]{2,}$", value):
            assets.append({"type": "subdomain", "value": value, "source": tool, "confidence": "observed"})
        elif value.startswith("http://") or value.startswith("https://"):
            assets.append({"type": "url", "value": value, "source": tool, "confidence": "observed"})
    return assets, endpoints, pages

def merge_json(path, command, target, results, assets, endpoints, pages):
    data = read_json(path, {})
    if not data:
        data = {"schemaVersion": 3, "runs": [], "sources": [], "discoveredAssets": [], "findings": [], "evidence": [], "endpoints": [], "pages": [], "statistics": {}}
    stamp = datetime.now(timezone.utc).isoformat()
    run_id = f"slash-{int(time.time() * 1000)}"
    run = {"id": run_id, "startedAt": stamp, "completedAt": stamp, "operator": "Pointer slash command", "tool": command, "status": "completed" if any(item.get("exitCode") == 0 for item in results) else "partial", "targetIds": [target], "outputFiles": [item.get("outputFile") for item in results if item.get("outputFile")], "notes": "Generated by the local Python slash-command runner."}
    data.setdefault("runs", []).append(run)
    data["runs"] = data["runs"][-100:]
    data.setdefault("discoveredAssets", [])
    existing_assets = {str(item.get("value")): item for item in data["discoveredAssets"] if isinstance(item, dict)}
    for item in assets:
        existing_assets.setdefault(str(item.get("value")), item)
    data["discoveredAssets"] = list(existing_assets.values())[-2000:]
    if endpoints:
        data.setdefault("endpoints", [])
        keys = {(item.get("method"), item.get("url")) for item in data["endpoints"] if isinstance(item, dict)}
        data["endpoints"].extend(item for item in endpoints if (item.get("method"), item.get("url")) not in keys)
        data["endpoints"] = data["endpoints"][-5000:]
    if pages:
        data.setdefault("pages", [])
        keys = {item.get("url") for item in data["pages"] if isinstance(item, dict)}
        data["pages"].extend(item for item in pages if item.get("url") not in keys)
        data["pages"] = data["pages"][-5000:]
    data["statistics"] = {**data.get("statistics", {}), "total": len(data.get("endpoints", data.get("pages", data.get("discoveredAssets", [])))), "lastRunAt": stamp}
    os.makedirs(os.path.dirname(path), exist_ok=True)
    temporary = path + ".tmp"
    with open(temporary, "w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2)
        handle.write("\n")
    os.replace(temporary, path)
    append_tool_output_log(os.path.dirname(os.path.dirname(path)), run_id, command, target, results)
    return data

def append_tool_output_log(assessment, run_id, command, target, results):
    log_path = os.path.join(assessment, "logs", "tool-output.jsonl")
    os.makedirs(os.path.dirname(log_path), exist_ok=True)
    stamp = datetime.now(timezone.utc).isoformat()
    with open(log_path, "a", encoding="utf-8") as handle:
        for result in results:
            output_file = result.get("outputFile", "")
            absolute = os.path.join(assessment, output_file) if output_file else ""
            digest = ""
            if absolute and os.path.isfile(absolute):
                with open(absolute, "rb") as artifact:
                    digest = hashlib.sha256(artifact.read()).hexdigest()
            handle.write(json.dumps({
                "runId": run_id,
                "timestamp": stamp,
                "tool": result.get("tool", command),
                "command": command,
                "target": target,
                "exitCode": result.get("exitCode"),
                "outputPath": output_file,
                "sha256": digest,
                "redacted": True,
                "truncated": False,
            }) + "\n")

def merge_asset_inventory(assessment, assets, source):
    if not assets:
        return
    inventory_path = os.path.join(assessment, "enumeration", "assets.json")
    data = read_json(inventory_path, {"schemaVersion": 3, "assetTemplate": {}, "assets": [], "relationships": [], "statistics": {}})
    existing = {str(item.get("value")): item for item in data.get("assets", []) if isinstance(item, dict) and item.get("value")}
    stamp = datetime.now(timezone.utc).isoformat()
    for item in assets:
        value = str(item.get("value") or "").strip()
        if not value:
            continue
        current = existing.get(value, {})
        existing[value] = {**current, **item, "source": item.get("source") or source, "lastSeen": stamp, "firstSeen": current.get("firstSeen") or stamp, "inScope": current.get("inScope"), "scopeReason": current.get("scopeReason", "")}
    data["assets"] = list(existing.values())[-5000:]
    data["statistics"] = {**data.get("statistics", {}), "total": len(data["assets"]), "unknownScope": sum(1 for item in data["assets"] if item.get("inScope") is None), "inScope": sum(1 for item in data["assets"] if item.get("inScope") is True), "outOfScope": sum(1 for item in data["assets"] if item.get("inScope") is False), "lastReconciledAt": stamp}
    with open(inventory_path, "w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2)
        handle.write("\n")

def run_command(raw, assessment, overrides=None):
    parsed = parse_command(raw, overrides)
    if not parsed.get("ok"):
        return parsed
    if parsed["role"] != "static":
        return {**parsed, "ok": True, "mode": "ai"}
    if not assessment or not os.path.isdir(assessment):
        return {"ok": False, "error": "Open an assessment before running static recon commands", "code": "ASSESSMENT_REQUIRED"}
    target = parsed["args"][0] if parsed["args"] else ""
    if not target:
        return {"ok": False, "error": f"Usage: {parsed['command']} <authorized-target>", "code": "TARGET_REQUIRED"}
    allowed, reason = in_scope(assessment, target)
    if not allowed:
        return {"ok": False, "error": reason, "code": "OUT_OF_SCOPE"}
    if parsed["command"] in ("/active", "/endpoint", "/webclone"):
        authorized, reason = active_authorized(assessment)
        if not authorized:
            return {"ok": False, "error": reason, "code": "AUTHORIZATION_REQUIRED"}
    results, assets, endpoints, pages = [], [], [], []
    tool_dir = os.path.join(assessment, "tools", parsed["command"].lstrip("/"))
    os.makedirs(tool_dir, exist_ok=True)
    for tool in parsed.get("tools", []):
        if tool == "custom_script":
            continue
        args, configuration_error = build_tool_command(tool, target, parsed, tool_dir)
        if configuration_error:
            results.append({"tool": tool, "status": "configuration_required", "error": configuration_error})
            continue
        executable = args[0]
        if not shutil.which(executable):
            results.append({"tool": tool, "status": "unavailable", "error": f"{executable} is not installed"})
            continue
        started = time.time()
        try:
            completed = subprocess.run(args, cwd=assessment, capture_output=True, text=True, timeout=90, shell=False)
            output = ((completed.stdout or "") + ("\n" + completed.stderr if completed.stderr else ""))[:500000]
            output_file = os.path.join(tool_dir, f"{tool}-{int(time.time())}.txt")
            with open(output_file, "w", encoding="utf-8", errors="replace") as handle: handle.write(output)
            found_assets, found_endpoints, found_pages = parse_lines(tool, output, target)
            assets.extend(found_assets); endpoints.extend(found_endpoints); pages.extend(found_pages)
            results.append({"tool": tool, "command": args, "exitCode": completed.returncode, "durationSeconds": round(time.time() - started, 2), "outputFile": os.path.relpath(output_file, assessment).replace(os.sep, "/")})
        except subprocess.TimeoutExpired:
            results.append({"tool": tool, "status": "timeout", "error": "Tool exceeded the 90 second safety limit"})
        except Exception as error:
            results.append({"tool": tool, "status": "error", "error": str(error)})
    custom_script = str(parsed.get("script") or "").replace("\\", "/").lstrip("/")
    if custom_script:
        script_path = os.path.abspath(os.path.join(assessment, "custom_scripts", custom_script))
        scripts_root = os.path.abspath(os.path.join(assessment, "custom_scripts"))
        if not script_path.startswith(scripts_root + os.sep) or not os.path.isfile(script_path):
            results.append({"tool": "custom_script", "status": "error", "error": "Configured custom script was not found inside custom_scripts/"})
        else:
            suffix = os.path.splitext(script_path)[1].lower()
            runner = {".py": [sys.executable], ".js": ["node"], ".mjs": ["node"], ".ps1": ["powershell", "-NoProfile", "-File"], ".sh": ["bash"], ".cmd": [], ".bat": []}.get(suffix)
            if runner is None:
                results.append({"tool": "custom_script", "status": "error", "error": f"Unsupported custom script type: {suffix}"})
            else:
                try:
                    completed = subprocess.run(runner + [script_path, target], cwd=assessment, capture_output=True, text=True, timeout=90, shell=False)
                    output = ((completed.stdout or "") + ("\n" + completed.stderr if completed.stderr else ""))[:500000]
                    output_file = os.path.join(tool_dir, f"custom-script-{int(time.time())}.txt")
                    with open(output_file, "w", encoding="utf-8", errors="replace") as handle: handle.write(output)
                    results.append({"tool": "custom_script", "exitCode": completed.returncode, "outputFile": os.path.relpath(output_file, assessment).replace(os.sep, "/")})
                except Exception as error:
                    results.append({"tool": "custom_script", "status": "error", "error": str(error)})
    output_relative = parsed.get("output")
    output_path = os.path.join(assessment, output_relative) if output_relative else ""
    data = merge_json(output_path, parsed["command"], target, results, assets, endpoints, pages) if output_path else None
    if output_path and data:
        merge_asset_inventory(assessment, assets, parsed["command"])
    return {"ok": True, "mode": "static", "command": parsed["command"], "target": target, "results": results, "output": output_relative, "normalized": {"assets": len(assets), "endpoints": len(endpoints), "pages": len(pages)}}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--action", choices=["parse", "run"], required=True)
    parser.add_argument("--payload", required=True)
    args = parser.parse_args()
    try:
        payload = json.loads(args.payload)
        result = parse_command(payload.get("command"), payload.get("overrides")) if args.action == "parse" else run_command(payload.get("command"), payload.get("assessment"), payload.get("overrides"))
        emit(result)
    except Exception as error:
        emit({"ok": False, "error": str(error), "code": "COMMAND_RUNNER_ERROR"})

if __name__ == "__main__":
    main()
