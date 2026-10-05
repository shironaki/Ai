#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

REPO="${BOT_REPO_DIR:-$HOME/Ai}"
BRANCH="${BOT_BRANCH:-test-global-assistant-upgrade}"
PYTHON="$REPO/.venv/bin/python"
BOT="$REPO/run.py"
PIDFILE="$REPO/termux-bot.pid"
RUNTIME_COMMIT_FILE="$REPO/data/test/runtime/bot-commit"
ROLEFILE="$REPO/data/test/runtime/termux-role"
LOCKDIR="$REPO/.termux-update.lock"
LEASE_BRANCH="${TERMUX_LEASE_BRANCH:-termux-lease}"
LEASE_PATH="${TERMUX_LEASE_PATH:-lease.json}"
DEVICE_ID=""

export BOT_ENV="${BOT_ENV:-test}"
export BOT_DATA_DIR="${BOT_DATA_DIR:-$REPO/data/${BOT_ENV}}"
DATA_DIR="$BOT_DATA_DIR"
mkdir -p "$DATA_DIR"
chmod 700 "$DATA_DIR" 2>/dev/null || true
LOG="$DATA_DIR/termux-autoupdate.log"
touch "$LOG"
chmod 600 "$LOG" 2>/dev/null || true
APPLY_UPDATED="${TERMUX_UPDATE_APPLY:-0}"
ROLLBACK_COMMIT="${TERMUX_UPDATE_ROLLBACK_COMMIT:-}"

ENV_FILE="${TERMUX_ENV_FILE:-$HOME/.config/ai/termux.env}"
if [ -f "$ENV_FILE" ]; then
    set -a
    . "$ENV_FILE"
    set +a
fi

DEVICE_ID="${TERMUX_DEVICE_ID:-}"

cd "$REPO"

is_active_role() {
    [[ ! -f "$ROLEFILE" ]] || [[ "$(cat "$ROLEFILE" 2>/dev/null || true)" == "active" ]]
}

has_fresh_active_lease() {
    [[ -n "$DEVICE_ID" ]] || return 1
    local raw owner expires now
    raw="$("$PYTHON" - <<'PY'
import base64, json, os, urllib.request
repo = os.environ.get("TERMUX_GITHUB_REPO", "shironaki/Ai")
branch = os.environ.get("TERMUX_LEASE_BRANCH", "termux-lease")
path = os.environ.get("TERMUX_LEASE_PATH", "lease.json")
token = ""
env_file = os.path.expanduser(os.environ.get("TERMUX_ENV_FILE", "~/.config/ai/termux.env"))
for name in ("TERMUX_GITHUB_TOKEN", "GITHUB_TOKEN", "GH_TOKEN"):
    token = os.environ.get(name, "").strip()
    if token: break
if not token:
    try:
        for line in open(env_file, encoding="utf-8"):
            if line.startswith("TERMUX_GITHUB_TOKEN="):
                token = line.split("=", 1)[1].strip().strip("'").strip('"')
                break
    except OSError: pass
if not token: raise SystemExit(1)
def get(p):
    req = urllib.request.Request(f"https://api.github.com/repos/{repo}{p}", headers={"Accept":"application/vnd.github+json","Authorization":f"Bearer {token}","X-GitHub-Api-Version":"2022-11-28"})
    with urllib.request.urlopen(req, timeout=12) as r: return json.loads(r.read().decode())
try: item = get(f"/contents/{path}?ref={branch}")
except Exception: item = get(f"/contents/{path}%0D?ref={branch}")
print(base64.b64decode(item["content"]).decode("utf-8"), end="")
PY
)" || return 1
    [[ -n "$raw" ]] || return 1
    owner="$(printf "%s\n" "$raw" | "$PYTHON" -c 'import json,sys; print(str(json.load(sys.stdin).get("owner","")).strip().casefold())' 2>/dev/null || true)"
    expires="$(printf "%s\n" "$raw" | "$PYTHON" -c 'import json,sys; print(int(json.load(sys.stdin).get("expires_at",0) or 0))' 2>/dev/null || true)"
    now="$(date +%s)"
    [[ "$owner" == "${DEVICE_ID,,}" ]] || return 1
    [[ "$expires" =~ ^[0-9]+$ ]] || return 1
    (( expires > now ))
}


log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >> "$LOG"; }

cleanup() { rmdir "$LOCKDIR" 2>/dev/null || true; }
if ! mkdir "$LOCKDIR" 2>/dev/null; then
    log "SKIP: another Termux update is already running"
    exit 0
fi
trap cleanup EXIT

git fetch origin "$BRANCH" >> "$LOG" 2>&1

# Bootstrap stale phones that accumulated only local edits to Termux-owned
# runtime scripts. Preserve the local patch for diagnostics, then replace
# those files with the tested branch revision. Never touch arbitrary tracked
# application files; explicitly owned QA runtime files are synchronized too.
TERMUX_OWNED_FILES=(
    "autoupdate.sh"
    "codespace_boot.sh"
    "scripts/termux_control.py"
    "scripts/termux_report.py"
    "scripts/termux_update.sh"
    "scripts/termux_supervisor.sh"
    "scripts/termux_boot.sh"
    "scripts/termux_lease_watchdog.py"
    "scripts/qa_agent.py"
    "qa/scenarios.json"
)
is_termux_owned_file() {
    local candidate="$1"
    local allowed
    for allowed in "${TERMUX_OWNED_FILES[@]}"; do
        [[ "$candidate" == "$allowed" ]] && return 0
    done
    return 1
}

# Recover tracked runtime fixes already matching the remote TEST branch.
# Untracked QA data is intentionally preserved.
if [[ -n "$(git status --porcelain)" ]]; then
    if ! git diff --quiet --cached; then
        log "STOP: index contains staged changes"
        exit 1
    fi

    # Only compare files that are actually dirty in the local worktree.
    # Comparing the entire worktree against origin/$BRANCH would also flag
    # every legitimate remote commit that has not reached this old checkout,
    # which defeats bootstrap recovery.
    while IFS= read -r line; do
        [[ -z "$line" ]] && continue
        if [[ "$line" == "?? "* ]]; then
            path="${line:3}"
            if is_termux_owned_file "$path" && git cat-file -e "origin/$BRANCH:$path" 2>/dev/null; then
                backup_dir="$DATA_DIR/termux-local-patches"
                mkdir -p "$backup_dir"
                backup_file="$backup_dir/$(date +%Y%m%d-%H%M%S)-$(printf "%s" "$path" | tr "/" "_").untracked"
                if cp -p "$path" "$backup_file" 2>/dev/null; then
                    log "BOOTSTRAP: backed up stale untracked Termux/QA file: $path -> $backup_file"
                else
                    log "STOP: failed to back up stale untracked Termux/QA file: $path"
                    exit 1
                fi
                rm -f "$path"
                log "BOOTSTRAP: replacing stale untracked Termux/QA file from origin/$BRANCH: $path"
                continue
            else
                continue
            fi
        fi
        path="${line:3}"
        if ! git diff --quiet "origin/$BRANCH" -- "$path"; then
            if is_termux_owned_file "$path"; then
                backup_dir="$DATA_DIR/termux-local-patches"
                mkdir -p "$backup_dir"
                backup_file="$backup_dir/$(date +%Y%m%d-%H%M%S)-$(printf "%s" "$path" | tr "/" "_").patch"
                if git diff --binary -- "$path" > "$backup_file"; then
                    log "BOOTSTRAP: backed up stale local Termux patch: $path -> $backup_file"
                else
                    rm -f "$backup_file"
                    log "STOP: failed to back up local Termux patch: $path"
                    exit 1
                fi
                log "BOOTSTRAP: replacing stale local Termux script from origin/$BRANCH: $path"
                git checkout -- "$path"
            else
                log "STOP: tracked local change differs from origin/$BRANCH: $path"
                exit 1
            fi
        fi
    done < <(git status --porcelain)

    log "SYNC: local tracked changes match origin/$BRANCH; cleaning tracked state"
    git reset --hard "origin/$BRANCH" >> "$LOG" 2>&1
fi

LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse "origin/$BRANCH")"

is_running() {
    [[ -f "$PIDFILE" ]] || return 1
    local pid
    pid="$(cat "$PIDFILE" 2>/dev/null || true)"
    [[ -n "$pid" ]] || return 1
    kill -0 "$pid" 2>/dev/null || return 1
    ps -p "$pid" -o command= 2>/dev/null | grep -F -q -- "$BOT"
}

local_bot_ready() {
    is_running || return 1
    local heartbeat_file="$DATA_DIR/runtime/heartbeat"
    [[ -f "$heartbeat_file" ]] || return 1
    local timestamp timestamp_int now age
    timestamp="$(cat "$heartbeat_file" 2>/dev/null || true)"
    [[ "$timestamp" =~ ^[0-9]+([.][0-9]+)?$ ]] || return 1
    timestamp_int="${timestamp%%.*}"
    now="$(date +%s)"
    age=$((now - timestamp_int))
    (( age >= 0 && age <= 30 ))
}
stop_bot() {
    if ! is_running; then
        rm -f "$PIDFILE"
        return 0
    fi
    local pid
    pid="$(cat "$PIDFILE")"
    kill "$pid" 2>/dev/null || true
    for _ in {1..15}; do
        is_running || break
        sleep 1
    done
    rm -f "$PIDFILE" "$RUNTIME_COMMIT_FILE"
}

install_dependencies() {
    if ! "$PYTHON" -m pip --version >> "$LOG" 2>&1; then
        log "STOP: pip unavailable"
        return 1
    fi

    local platform_name
    platform_name="$("$PYTHON" -c 'import platform; print(platform.system().lower())')"
    local is_termux="false"
    if [[ -n "${PREFIX:-}" && "$PREFIX" == /data/data/com.termux/* ]] || [[ -d /data/data/com.termux/files/usr ]]; then
        is_termux="true"
    fi

    if [[ "$platform_name" == "android" || "$is_termux" == "true" ]]; then
        log "DEPS: Android/Termux detected (platform=$platform_name); using Android wheels and isolating aiogram 2.x"

        local tmp_req
        tmp_req="${TMPDIR:-/data/data/com.termux/files/usr/tmp}/ai-requirements.$$"
        if ! awk '
            /^[[:space:]]*aiogram([<=>~!].*)?[[:space:]]*$/ { next }
            { print }
        ' "$REPO/requirements.txt" > "$tmp_req"; then
            log "STOP: failed to prepare Termux requirements"
            rm -f "$tmp_req"
            return 1
        fi
        if grep -qiE '^[[:space:]]*aiogram([<=>~!].*)?[[:space:]]*$' "$tmp_req"; then
            log "STOP: aiogram leaked into isolated Termux requirements"
            rm -f "$tmp_req"
            return 1
        fi

        if ! "$PYTHON" -m pip install --upgrade pip >> "$LOG" 2>&1; then
            log "STOP: failed to upgrade pip"
            rm -f "$tmp_req"
            return 1
        fi

        if ! "$PYTHON" -m pip install --only-binary=:all: "aiohttp>=3.14,<3.15" >> "$LOG" 2>&1; then
            log "STOP: Android aiohttp wheel installation failed"
            rm -f "$tmp_req"
            return 1
        fi

        if ! "$PYTHON" -m pip install --only-binary=:all: -r "$tmp_req" >> "$LOG" 2>&1; then
            log "STOP: Termux pure-Python dependency installation failed"
            rm -f "$tmp_req"
            return 1
        fi

        if ! "$PYTHON" -m pip install --no-deps "aiogram==2.25.2" >> "$LOG" 2>&1; then
            log "STOP: aiogram installation failed"
            rm -f "$tmp_req"
            return 1
        fi

        if ! "$PYTHON" -m pip install --only-binary=:all: "Babel>=2.9.1,<2.10" "certifi>=2021.10.8" "magic-filter>=1.0.9,<1.1.0" >> "$LOG" 2>&1; then
            log "STOP: aiogram runtime dependencies failed"
            rm -f "$tmp_req"
            return 1
        fi

        rm -f "$tmp_req"

        if ! "$PYTHON" -c 'import aiogram, aiohttp, requests; print("TERMUX IMPORTS OK", aiogram.__version__, aiohttp.__version__)' >> "$LOG" 2>&1; then
            log "STOP: Termux runtime imports failed"
            return 1
        fi
    else
        if ! "$PYTHON" -m pip install -r "$REPO/requirements.txt" >> "$LOG" 2>&1; then
            log "STOP: dependency installation failed"
            return 1
        fi
    fi

    "$PYTHON" -m pip install pytest >> "$LOG" 2>&1
}

require_fresh_lease() {
    if ! is_active_role; then return 0; fi
    if ! has_fresh_active_lease; then
        log "FENCE: active runtime lost its fresh lease"
        stop_bot || true
        return 1
    fi
    return 0
}

start_bot() {
    if ! has_fresh_active_lease; then
        log "STOP: refusing to start bot without a fresh active lease"
        return 1
    fi
    if is_running; then
        return 0
    fi
    nohup "$PYTHON" "$BOT" >> "$DATA_DIR/bot.log" 2>&1 < /dev/null &
    echo $! > "$PIDFILE"
    printf "%s\n" "$(git rev-parse HEAD)" > "$RUNTIME_COMMIT_FILE"
    sleep 8
    if PYTHONPATH="$REPO${PYTHONPATH:+:$PYTHONPATH}" "$PYTHON" "$REPO/scripts/healthcheck.py" >> "$LOG" 2>&1; then
        return 0
    fi
    if local_bot_ready; then
        log "HEALTH: Telegram API unavailable/transient; local bot heartbeat is fresh, preserving new revision"
        return 0
    fi
    return 1
}

rollback() {
    local good_commit="$1"
    log "ROLLBACK: restoring $good_commit without re-running dependency installer"
    stop_bot || true
    git reset --hard "$good_commit" >> "$LOG" 2>&1
    if start_bot; then
        log "ROLLBACK: stable revision restored and health-verified"
    else
        log "ROLLBACK: stable revision restored but health check failed"
        return 1
    fi
}

if [[ "$LOCAL" != "$REMOTE" ]]; then
    log "UPDATE: $LOCAL -> $REMOTE"
    # A stale phone may still carry the default/old "active" role while
    # another device owns the lease. It is safe to synchronize code while no
    # bot is running locally; only stopping/running an active bot requires a
    # fresh lease.
    if is_active_role && is_running; then
        if ! has_fresh_active_lease; then
            log "STOP: refusing update because active device has no fresh lease"
            exit 1
        fi
        stop_bot
        if ! has_fresh_active_lease; then
            log "FENCE: lease lost after stopping bot; update aborted"
            exit 1
        fi
    fi
    if ! git pull --ff-only origin "$BRANCH" >> "$LOG" 2>&1; then
        log "STOP: fast-forward update failed"
        if is_active_role && has_fresh_active_lease; then
            start_bot || true
        fi
        exit 1
    fi
    if is_active_role && ! has_fresh_active_lease; then
        log "FENCE: lease lost after code update; bot remains stopped"
        exit 1
    fi

    # The current shell loaded the pre-update script into memory. Restart from
    # disk so dependency installation uses the freshly pulled implementation.
    log "UPDATE: restarting updater from freshly pulled revision"
    # The current process owns the update lock. Release it before exec so the
    # freshly loaded updater can acquire the lock instead of self-skipping.
    trap - EXIT
    cleanup
    exec env TERMUX_UPDATE_APPLY=1 TERMUX_UPDATE_ROLLBACK_COMMIT="$LOCAL" bash "$REPO/scripts/termux_update.sh"

elif [[ "$APPLY_UPDATED" == "1" ]]; then
    if ! is_active_role; then
        stop_bot
        log "UPDATE: standby skips dependency installation and keeps bot stopped"
        exit 0
    fi
    if ! has_fresh_active_lease; then
        stop_bot
        log "FENCE: active lease lost before dependency installation"
        exit 1
    fi
    if ! install_dependencies; then
        if [[ -n "$ROLLBACK_COMMIT" ]]; then
            rollback "$ROLLBACK_COMMIT" || true
        else
            log "ROLLBACK: no previous commit available; bot remains stopped"
        fi
        exit 1
    fi

    if ! has_fresh_active_lease; then
        stop_bot
        log "FENCE: lease lost after dependency installation"
        exit 1
    fi

    if ! "$PYTHON" -m pytest -q >> "$LOG" 2>&1; then
        if [[ -n "$ROLLBACK_COMMIT" ]]; then
            rollback "$ROLLBACK_COMMIT" || true
        else
            log "ROLLBACK: no previous commit available; bot remains stopped"
        fi
        exit 1
    fi

    if ! has_fresh_active_lease; then
        stop_bot
        log "FENCE: lease lost after tests"
        exit 1
    fi

    stop_bot
    if ! has_fresh_active_lease; then
        log "FENCE: lease lost before restart"
        exit 1
    fi
    if ! start_bot; then
        log "UPDATE: new revision failed health check"
        if [[ -n "$ROLLBACK_COMMIT" ]]; then
            rollback "$ROLLBACK_COMMIT" || true
        else
            log "ROLLBACK: no previous commit available; bot remains stopped"
        fi
        exit 1
    fi
    log "UPDATE: bot restarted and health-verified"

elif ! is_active_role; then
    if is_running; then
        log "ROLE: standby; stopping bot"
        stop_bot
    fi
    log "OK: standby role; bot remains stopped"

elif ! is_running; then
    NEED_DEPS="0"

    if [[ ! -x "$PYTHON" ]]; then
        log "RECOVERY: .venv missing; creating virtual environment"
        if ! python -m venv "$REPO/.venv" >> "$LOG" 2>&1; then
            log "STOP: failed to create Python virtual environment"
            exit 1
        fi
        NEED_DEPS="1"
    elif ! "$PYTHON" -c 'import aiogram, aiohttp, requests' >> "$LOG" 2>&1; then
        log "RECOVERY: Python runtime imports failed; reinstalling dependencies"
        NEED_DEPS="1"
    fi

    if [[ "$NEED_DEPS" == "1" ]]; then
        if ! install_dependencies; then
            log "STOP: initial/recovery dependency installation failed"
            exit 1
        fi
    fi

    if ! start_bot; then
        log "STOP: initial/recovery bot start or health check failed"
        exit 1
    fi

    log "RECOVERY: bot started and health-verified"
else
    # A running bot can survive a git update because its Python process keeps the
    # old modules in memory. Detect that stale process explicitly and restart it
    # on the current checkout even when LOCAL == REMOTE.
    RUNNING_COMMIT="$(cat "$RUNTIME_COMMIT_FILE" 2>/dev/null || true)"
    if [[ "$RUNNING_COMMIT" != "$LOCAL" ]]; then
        log "UPDATE: running bot revision ${RUNNING_COMMIT:-unknown} != checkout $LOCAL; restarting"
        if ! has_fresh_active_lease; then
            log "FENCE: lease lost before stale-runtime restart"
            exit 1
        fi
        stop_bot
        if ! has_fresh_active_lease; then
            log "FENCE: lease lost before stale-runtime restart start"
            exit 1
        fi
        if ! start_bot; then
            log "STOP: stale-runtime restart failed"
            exit 1
        fi
        log "UPDATE: stale runtime replaced with checkout $LOCAL"
    fi

    # Keep runtime dependencies self-healing even when the bot process is still alive.
    # This also repairs auxiliary Termux services (for example the battery watchdog)
    # that import the same Python dependencies as the bot.
    if ! "$PYTHON" -c 'import aiogram, aiohttp, requests' >> "$LOG" 2>&1; then
        log "RECOVERY: Python runtime imports failed while bot is running; reinstalling dependencies"
        if install_dependencies; then
            log "RECOVERY: dependencies restored"
        else
            log "RECOVERY: dependency reinstall failed"
        fi
    fi

    PYTHONPATH="$REPO${PYTHONPATH:+:$PYTHONPATH}" "$PYTHON" "$REPO/scripts/healthcheck.py" >> "$LOG" 2>&1 || {
        log "RECOVERY: health check failed; restarting bot"
        stop_bot
        start_bot
    }
fi

if [[ "$LOCAL" != "$REMOTE" ]] && ! git diff --quiet "$LOCAL" "$REMOTE" -- scripts/termux_supervisor.sh scripts/termux_boot.sh scripts/qa_agent.py; then
    # The supervisor has its own revision guard and will exec the freshly pulled
    # script on its next loop. Do not kill its parent from the updater: doing so
    # can leave the bot healthy while silently removing the control-plane guardian.
    log "UPDATE: supervisor/boot/QA script changed; supervisor revision guard will reload it"
fi

log "OK: Termux sync check completed at $(git rev-parse HEAD)"
