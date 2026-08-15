#!/usr/bin/env bash

# Starts the persistent Kali-side services needed by XEKUTE.
#
# Metasploit uses a persistent MessagePack RPC daemon (msfrpcd). SQLMap-MCP
# is deliberately not started here: it is a stdio MCP server and XEKUTE starts
# one instance over SSH when the sqlmap skill is leased.

set -Eeuo pipefail

XEKUTE_HOME_DIR="${XEKUTE_KALI_HOME_DIR:-${HOME}}"
XEKUTE_STATE_DIR="${XEKUTE_HOME_DIR}/.xekute"
XEKUTE_LOG_DIR="${XEKUTE_STATE_DIR}/logs"
XEKUTE_RUN_DIR="${XEKUTE_STATE_DIR}/run"
XEKUTE_MSF_ENV_FILE="${XEKUTE_MSF_ENV_FILE:-${XEKUTE_HOME_DIR}/.config/xekute/metasploit.env}"
XEKUTE_MSF_DIR="${XEKUTE_MSF_DIR:-${XEKUTE_HOME_DIR}/MetasploitMCP}"
XEKUTE_SQLMAP_DIR="${XEKUTE_SQLMAP_DIR:-${XEKUTE_HOME_DIR}/SQLMap-MCP}"
XEKUTE_MSF_LOG="${XEKUTE_LOG_DIR}/msfrpcd.log"
XEKUTE_MSF_PID="${XEKUTE_RUN_DIR}/msfrpcd.pid"

mkdir -p "${XEKUTE_LOG_DIR}" "${XEKUTE_RUN_DIR}"
chmod 700 "${XEKUTE_STATE_DIR}" "${XEKUTE_LOG_DIR}" "${XEKUTE_RUN_DIR}" 2>/dev/null || true

if [[ -f "${XEKUTE_MSF_ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${XEKUTE_MSF_ENV_FILE}"
  set +a
fi

XEKUTE_MSF_HOST="${MSF_SERVER:-127.0.0.1}"
XEKUTE_MSF_PORT="${MSF_PORT:-55553}"
XEKUTE_MSF_SSL="${MSF_SSL:-false}"
XEKUTE_MSF_PASSWORD="${MSF_PASSWORD:-}"

require_command() {
  local command_name="$1"
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "${command_name}" >&2
    exit 1
  fi
}

port_is_listening() {
  ss -lntH 2>/dev/null | grep -Eq "[.:]${XEKUTE_MSF_PORT}[[:space:]]"
}

start_ssh() {
  require_command systemctl
  sudo systemctl enable --now ssh
  printf 'SSH service: ready\n'
}

start_metasploit_database() {
  if ! command -v msfdb >/dev/null 2>&1; then
    printf 'Metasploit database helper not found; continuing without database startup.\n' >&2
    return 0
  fi
  if sudo msfdb start >/dev/null 2>&1; then
    printf 'Metasploit database: ready\n'
  else
    printf 'Metasploit database could not be started; database-backed MCP tools may be limited.\n' >&2
  fi
}

start_metasploit_rpc() {
  require_command msfrpcd
  require_command ss

  if port_is_listening; then
    printf 'Metasploit RPC: already listening on %s:%s\n' "${XEKUTE_MSF_HOST}" "${XEKUTE_MSF_PORT}"
    return 0
  fi

  if [[ -z "${XEKUTE_MSF_PASSWORD}" ]]; then
    read -r -s -p "Metasploit RPC password: " XEKUTE_MSF_PASSWORD
    printf '\n'
  fi

  if [[ "${XEKUTE_MSF_SSL,,}" != "false" ]]; then
    printf 'This launcher expects MSF_SSL=false because XEKUTE uses msfrpcd -S.\n' >&2
    printf 'Set MSF_SSL=false in %s and retry.\n' "${XEKUTE_MSF_ENV_FILE}" >&2
    exit 1
  fi

  nohup msfrpcd \
    -P "${XEKUTE_MSF_PASSWORD}" \
    -S \
    -a "${XEKUTE_MSF_HOST}" \
    -p "${XEKUTE_MSF_PORT}" \
    -f >>"${XEKUTE_MSF_LOG}" 2>&1 &
  local process_id=$!
  printf '%s\n' "${process_id}" >"${XEKUTE_MSF_PID}"
  chmod 600 "${XEKUTE_MSF_PID}" "${XEKUTE_MSF_LOG}" 2>/dev/null || true

  for _ in {1..30}; do
    if port_is_listening; then
      printf 'Metasploit RPC: ready on %s:%s\n' "${XEKUTE_MSF_HOST}" "${XEKUTE_MSF_PORT}"
      return 0
    fi
    if ! kill -0 "${process_id}" 2>/dev/null; then
      printf 'Metasploit RPC exited before opening its port. Recent log:\n' >&2
      tail -n 30 "${XEKUTE_MSF_LOG}" >&2 || true
      exit 1
    fi
    sleep 1
  done

  printf 'Timed out waiting for Metasploit RPC on port %s. Recent log:\n' "${XEKUTE_MSF_PORT}" >&2
  tail -n 30 "${XEKUTE_MSF_LOG}" >&2 || true
  exit 1
}

check_sqlmap() {
  if command -v sqlmap >/dev/null 2>&1; then
    printf 'SQLMap: %s\n' "$(sqlmap --version 2>/dev/null | head -n 1)"
  else
    printf 'SQLMap is not on PATH. Install it with: sudo apt install -y sqlmap\n' >&2
    return 1
  fi

  local sqlmap_python="${XEKUTE_SQLMAP_DIR}/.venv/bin/python"
  if [[ ! -x "${sqlmap_python}" || ! -f "${XEKUTE_SQLMAP_DIR}/server.py" ]]; then
    printf 'SQLMap-MCP: not installed at %s\n' "${XEKUTE_SQLMAP_DIR}" >&2
    return 1
  fi
  if "${sqlmap_python}" -c 'import fastmcp' >/dev/null 2>&1; then
    printf 'SQLMap-MCP: ready for XEKUTE stdio launch\n'
  else
    printf 'SQLMap-MCP: FastMCP dependency is missing in %s/.venv\n' "${XEKUTE_SQLMAP_DIR}" >&2
    return 1
  fi
}

check_metasploit_mcp() {
  local launcher="${XEKUTE_MSF_DIR}/run-xekute.sh"
  local server="${XEKUTE_MSF_DIR}/MetasploitMCP.py"
  if [[ ! -f "${server}" ]]; then
    printf 'MetasploitMCP.py is missing at %s\n' "${server}" >&2
    return 1
  fi
  if [[ ! -x "${launcher}" ]]; then
    printf 'Metasploit MCP launcher is missing or not executable: %s\n' "${launcher}" >&2
    return 1
  fi
  printf 'Metasploit-MCP: ready for XEKUTE stdio launch\n'
}

status() {
  require_command ss
  if port_is_listening; then
    printf 'Metasploit RPC: listening on %s:%s\n' "${XEKUTE_MSF_HOST}" "${XEKUTE_MSF_PORT}"
  else
    printf 'Metasploit RPC: stopped\n'
  fi
  check_metasploit_mcp || true
  check_sqlmap || true
}

stop_metasploit_rpc() {
  if [[ ! -f "${XEKUTE_MSF_PID}" ]]; then
    printf 'No XEKUTE-managed Metasploit RPC PID file found.\n'
    return 0
  fi
  local process_id
  process_id="$(tr -cd '0-9' <"${XEKUTE_MSF_PID}")"
  if [[ -n "${process_id}" ]] && kill -0 "${process_id}" 2>/dev/null; then
    kill "${process_id}"
    printf 'Stopped XEKUTE-managed Metasploit RPC (PID %s).\n' "${process_id}"
  else
    printf 'Metasploit RPC process is no longer running.\n'
  fi
  rm -f "${XEKUTE_MSF_PID}"
}

case "${1:-start}" in
  start)
    start_ssh
    start_metasploit_database
    start_metasploit_rpc
    check_metasploit_mcp
    check_sqlmap
    printf 'XEKUTE Kali services are ready.\n'
    ;;
  status)
    status
    ;;
  stop)
    stop_metasploit_rpc
    ;;
  *)
    printf 'Usage: %s [start|status|stop]\n' "$0" >&2
    exit 2
    ;;
esac
