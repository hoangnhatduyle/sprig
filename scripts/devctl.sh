#!/usr/bin/env bash
# Start/stop/restart/status the project's local dev services: the Next.js
# dev server (UI + server actions/API routes — this app has no separate
# backend process, Next.js serves both) and Prisma Studio.
#
# Each service is launched with `setsid` so its PID is also its process
# group's leader; stopping sends the signal to the whole group (`kill -- -PID`),
# not just the top wrapper process. This is what a plain `pkill`/backgrounded
# `&` can miss — pnpm/next/prisma studio spawn child processes that a single
# top-level kill can leave orphaned.
#
# Usage:
#   scripts/devctl.sh start [service...]     # default: all services
#   scripts/devctl.sh stop [service...]
#   scripts/devctl.sh restart [service...]
#   scripts/devctl.sh status [service...]
#   scripts/devctl.sh logs <service>         # tail -f a service's log
#
# Services: dev (Next.js, port $PORT or 3000), studio (Prisma Studio, port
# $STUDIO_PORT or 5555). "all" (or no service argument) targets both.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RUN_DIR="$PROJECT_ROOT/.run"
PID_DIR="$RUN_DIR/pids"
LOG_DIR="$RUN_DIR/logs"
mkdir -p "$PID_DIR" "$LOG_DIR"

DEV_PORT="${PORT:-3000}"
STUDIO_PORT="${STUDIO_PORT:-5555}"
STOP_TIMEOUT_SECS=10

ALL_SERVICES=(dev studio)

usage() {
  cat <<EOF
Usage: $(basename "$0") <start|stop|restart|status|logs> [service...]

Services:
  dev     Next.js dev server (UI + server actions/API), port \$PORT or $DEV_PORT
  studio  Prisma Studio, port \$STUDIO_PORT or $STUDIO_PORT
  all     Both of the above (default when no service is given)

Examples:
  $(basename "$0") start              # start everything
  $(basename "$0") start dev          # start only the Next.js dev server
  $(basename "$0") stop studio        # stop only Prisma Studio
  $(basename "$0") stop               # stop everything
  $(basename "$0") restart dev
  $(basename "$0") status
  $(basename "$0") logs dev           # tail -f the Next.js dev server log
EOF
}

pidfile_for() { echo "$PID_DIR/$1.pid"; }
logfile_for() { echo "$LOG_DIR/$1.log"; }

valid_service() {
  local name="$1" s
  for s in "${ALL_SERVICES[@]}"; do
    [[ "$name" == "$s" ]] && return 0
  done
  return 1
}

is_running() {
  local pid_file pid
  pid_file="$(pidfile_for "$1")"
  [[ -f "$pid_file" ]] || return 1
  pid="$(cat "$pid_file" 2>/dev/null || true)"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

start_one() {
  local name="$1"
  if ! valid_service "$name"; then
    echo "Unknown service: $name" >&2
    return 1
  fi
  if is_running "$name"; then
    echo "[$name] already running (pid $(cat "$(pidfile_for "$name")"))"
    return 0
  fi
  rm -f "$(pidfile_for "$name")"

  local pid_file log_file
  pid_file="$(pidfile_for "$name")"
  log_file="$(logfile_for "$name")"
  : > "$log_file"

  case "$name" in
    dev)
      echo "[$name] starting Next.js dev server on port $DEV_PORT (log: $log_file)..."
      ( cd "$PROJECT_ROOT" && exec setsid env PORT="$DEV_PORT" pnpm dev >"$log_file" 2>&1 </dev/null ) &
      ;;
    studio)
      echo "[$name] starting Prisma Studio on port $STUDIO_PORT (log: $log_file)..."
      ( cd "$PROJECT_ROOT" && exec setsid pnpm exec prisma studio --port "$STUDIO_PORT" >"$log_file" 2>&1 </dev/null ) &
      ;;
  esac

  local pid=$!
  echo "$pid" > "$pid_file"
  sleep 1
  if kill -0 "$pid" 2>/dev/null; then
    echo "[$name] started (pid $pid)."
  else
    echo "[$name] failed to start — check $log_file" >&2
    rm -f "$pid_file"
    return 1
  fi
}

stop_one() {
  local name="$1"
  if ! valid_service "$name"; then
    echo "Unknown service: $name" >&2
    return 1
  fi
  if ! is_running "$name"; then
    echo "[$name] not running"
    rm -f "$(pidfile_for "$name")"
    return 0
  fi

  local pid_file pid waited
  pid_file="$(pidfile_for "$name")"
  pid="$(cat "$pid_file")"
  echo "[$name] stopping (pid $pid and its process group)..."
  kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true

  waited=0
  while kill -0 "$pid" 2>/dev/null && [[ $waited -lt $STOP_TIMEOUT_SECS ]]; do
    sleep 1
    waited=$((waited + 1))
  done

  if kill -0 "$pid" 2>/dev/null; then
    echo "[$name] still alive after ${STOP_TIMEOUT_SECS}s, sending SIGKILL..."
    kill -KILL -- "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
    sleep 1
  fi

  if kill -0 "$pid" 2>/dev/null; then
    echo "[$name] WARNING: pid $pid still appears alive — check manually (ps aux | grep $pid)." >&2
  else
    echo "[$name] stopped."
    rm -f "$pid_file"
  fi
}

status_one() {
  local name="$1"
  if ! valid_service "$name"; then
    echo "Unknown service: $name" >&2
    return 1
  fi
  if is_running "$name"; then
    echo "[$name] RUNNING (pid $(cat "$(pidfile_for "$name")"))"
  else
    echo "[$name] stopped"
    rm -f "$(pidfile_for "$name")" 2>/dev/null || true
  fi
}

logs_one() {
  local name="${1:-dev}"
  if ! valid_service "$name"; then
    echo "Unknown service: $name" >&2
    return 1
  fi
  local log_file
  log_file="$(logfile_for "$name")"
  if [[ ! -f "$log_file" ]]; then
    echo "[$name] no log file yet — has it been started?"
    return 0
  fi
  tail -n 50 -f "$log_file"
}

# Expands no-args / "all" to every service; otherwise passes through the
# explicit service names given on the command line.
resolve_targets() {
  if [[ $# -eq 0 || ( $# -eq 1 && "$1" == "all" ) ]]; then
    printf '%s\n' "${ALL_SERVICES[@]}"
  else
    printf '%s\n' "$@"
  fi
}

cmd="${1:-}"
[[ $# -gt 0 ]] && shift

case "$cmd" in
  start)
    while IFS= read -r svc; do start_one "$svc"; done < <(resolve_targets "$@")
    ;;
  stop)
    while IFS= read -r svc; do stop_one "$svc"; done < <(resolve_targets "$@")
    ;;
  restart)
    while IFS= read -r svc; do stop_one "$svc"; start_one "$svc"; done < <(resolve_targets "$@")
    ;;
  status)
    while IFS= read -r svc; do status_one "$svc"; done < <(resolve_targets "$@")
    ;;
  logs)
    logs_one "${1:-}"
    ;;
  -h|--help|help|"")
    usage
    ;;
  *)
    echo "Unknown command: $cmd" >&2
    usage
    exit 1
    ;;
esac
