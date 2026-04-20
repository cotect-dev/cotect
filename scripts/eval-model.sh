#!/usr/bin/env bash
#
# Evaluate a model's agent capabilities against the Cotect eval suite.
#
# Usage:
#   ./scripts/eval-model.sh --endpoint URL --model NAME [OPTIONS]
#
# Required:
#   --endpoint URL    OpenAI-compatible API endpoint (e.g., http://localhost:11434/v1)
#                     Also accepts LM Studio URLs like http://host:1234/api/v1/models
#   --model NAME      Model name (e.g., llama3, gpt-4o, google/gemma-4-26b-a4b)
#
# Optional:
#   --api-key KEY     API key / bearer token (omit for local Ollama)
#   --max-turns N     Max agent turns per scenario (default: 25)
#   --timeout SECS    Seconds before a scenario times out (default: 600)
#   --scenario NAME   Run a single scenario instead of the full suite
#                     Use a substring match, e.g.: --scenario bugfix, --scenario refactor_rename
#   --all             Run all individual scenarios (not just the suite runner)
#
# Examples:
#   # Local Ollama
#   ./scripts/eval-model.sh --endpoint http://localhost:11434/v1 --model llama3
#
#   # OpenAI
#   ./scripts/eval-model.sh --endpoint https://api.openai.com/v1 --model gpt-4o --api-key sk-...
#
#   # LM Studio (accepts /api/v1/models URL directly)
#   ./scripts/eval-model.sh --endpoint http://localhost:1234/api/v1/models --model google/gemma-4-26b-a4b
#
#   # Single scenario
#   ./scripts/eval-model.sh --endpoint http://localhost:11434/v1 --model llama3 --scenario read_file
#
#   # Compare models (run multiple times, redirect output)
#   for model in llama3 codellama mistral; do
#     echo "=== $model ===" >> results.txt
#     ./scripts/eval-model.sh --endpoint http://localhost:11434/v1 --model "$model" 2>&1 >> results.txt
#   done

set -euo pipefail

ENDPOINT=""
MODEL=""
API_KEY=""
MAX_TURNS=""
TIMEOUT=""
SCENARIO=""
DIFFICULTY=""
SUITE=""
RUN_ALL=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --endpoint)   ENDPOINT="$2"; shift 2 ;;
        --model)      MODEL="$2"; shift 2 ;;
        --api-key)    API_KEY="$2"; shift 2 ;;
        --max-turns)  MAX_TURNS="$2"; shift 2 ;;
        --timeout)    TIMEOUT="$2"; shift 2 ;;
        --scenario)   SCENARIO="$2"; shift 2 ;;
        --difficulty) DIFFICULTY="$2"; shift 2 ;;
        --suite)      SUITE="$2"; shift 2 ;;
        --xhard)      SUITE="xhard"; shift ;;
        --all)        RUN_ALL=true; shift ;;
        -h|--help)
            sed -n '2,/^$/p' "$0" | sed 's/^#//; s/^ //'
            exit 0
            ;;
        *)
            # Accept bare positional as --model for yarn-friendly invocation:
            #   yarn eval:xhard <model-name>
            if [[ -z "$MODEL" && "$1" != -* ]]; then
                MODEL="$1"; shift
            else
                echo "Unknown option: $1" >&2
                echo "Run with --help for usage." >&2
                exit 1
            fi
            ;;
    esac
done

if [[ -z "$ENDPOINT" || -z "$MODEL" ]]; then
    echo "Error: --endpoint and --model are required." >&2
    echo "Run with --help for usage." >&2
    exit 1
fi

# Normalize endpoint: strip trailing /models, convert /api/v1 → /v1
ENDPOINT="${ENDPOINT%/}"
ENDPOINT="${ENDPOINT%/models}"
if [[ "$ENDPOINT" == */api/v1 ]]; then
    ENDPOINT="${ENDPOINT%/api/v1}/v1"
fi

export COTECT_EVAL_ENDPOINT="$ENDPOINT"
export COTECT_EVAL_MODEL="$MODEL"
[[ -n "$DIFFICULTY" ]] && export COTECT_EVAL_DIFFICULTY="$DIFFICULTY"

# Mirror tauri/src/agent/adapter/mod.rs::detect_format + build_adapter so the
# user sees which wire-format adapter the eval will use. Keep in sync with
# that file when new adapters land.
detect_adapter() {
    local lower
    lower="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
    case "$lower" in
        *gemma*)                                                echo "gemma (native Gemma template)" ;;
        *llama-3*|*llama3*|*llama-4*|*llama4*)                  echo "openai_compat (Llama 3 detected — no native adapter yet, falls through)" ;;
        *qwen*)                                                 echo "qwen (native Qwen template)" ;;
        *mistral*|*mixtral*|*phi-3*|*phi3*|*phi-4*|*phi4*|*deepseek*) echo "openai_compat (ChatML family detected — no native adapter yet, falls through)" ;;
        *gpt-*|*claude-*|*gemini-*|o1-*|o3-*)                   echo "openai_compat (proprietary API — server-side templating)" ;;
        *)                                                      echo "openai_compat (unknown model — server-side templating)" ;;
    esac
}
ADAPTER="$(detect_adapter "$MODEL")"

# Query /v1/models. If the requested MODEL isn't in the list, pick the closest
# match (substring, case-insensitive; ties broken by shortest name). This
# matters because mlx-lm rejects unknown names with a confusing 404→HF error,
# while llama.cpp silently ignores the name and serves whatever is loaded.
resolve_model() {
    local models_json models_list resolved auth_header=()
    [[ -n "$API_KEY" ]] && auth_header=(-H "Authorization: Bearer $API_KEY")
    models_json="$(curl -fsS --max-time 5 "${auth_header[@]}" "$ENDPOINT/models" 2>/dev/null)" || return 1
    models_list="$(printf '%s' "$models_json" | python3 -c '
import json,sys
try:
    d=json.load(sys.stdin)
    for m in d.get("data",[]) or d.get("models",[]):
        print(m["id"] if isinstance(m,dict) else m)
except Exception:
    sys.exit(1)
' 2>/dev/null)" || return 1
    [[ -z "$models_list" ]] && return 1
    printf '%s\n' "$models_list" | grep -Fxq "$MODEL" && { echo "$MODEL|exact"; return 0; }
    resolved="$(printf '%s' "$MODEL" "$models_list" | python3 -c '
import sys
lines=sys.stdin.read().split("\n")
want=lines[0].lower()
avail=[x for x in lines[1:] if x]
def score(a):
    al=a.lower()
    if al==want: return (0,len(a))
    if want in al: return (1,len(a))
    if al in want: return (2,len(a))
    # longest common substring length (descending)
    best=0
    for i in range(len(want)):
        for j in range(i+1,len(want)+1):
            if want[i:j] in al and j-i>best: best=j-i
    return (3,-best,len(a))
if avail:
    print(min(avail,key=score))
' 2>/dev/null)"
    [[ -z "$resolved" ]] && return 1
    echo "${resolved}|closest"
}

SERVER_MODEL_INFO="$(resolve_model || true)"
if [[ -n "$SERVER_MODEL_INFO" ]]; then
    RESOLVED_MODEL="${SERVER_MODEL_INFO%|*}"
    MATCH_KIND="${SERVER_MODEL_INFO#*|}"
    if [[ "$MATCH_KIND" == "closest" && "$RESOLVED_MODEL" != "$MODEL" ]]; then
        printf '\n\033[33m⚠  Model "%s" not found on server. Using closest match: "%s"\033[0m\n' "$MODEL" "$RESOLVED_MODEL" >&2
        MODEL="$RESOLVED_MODEL"
        export COTECT_EVAL_MODEL="$MODEL"
        ADAPTER="$(detect_adapter "$MODEL")"
    fi
fi

[[ -n "$API_KEY" ]]   && export COTECT_EVAL_API_KEY="$API_KEY"
[[ -n "$MAX_TURNS" ]] && export COTECT_EVAL_MAX_TURNS="$MAX_TURNS"
[[ -n "$TIMEOUT" ]]   && export COTECT_EVAL_TIMEOUT="$TIMEOUT"

CARGO_ARGS=(test -p cotect)
if [[ -n "$SCENARIO" ]]; then
    CARGO_ARGS+=("eval_${SCENARIO}" -- --ignored --nocapture)
elif [[ "$SUITE" == "xhard" ]]; then
    CARGO_ARGS+=("eval_extra_hard" -- --ignored --nocapture)
elif $RUN_ALL; then
    CARGO_ARGS+=("eval_" -- --ignored --nocapture)
else
    CARGO_ARGS+=("eval_suite" -- --ignored --nocapture)
fi

# ANSI colors — interactive terminal output; emitted unconditionally.
C_RULE=$'\033[34m'
C_LBL=$'\033[36m'
C_VAL=$'\033[1m'
C_DIM=$'\033[2m'
C_RST=$'\033[0m'
RULE_HEAVY="══════════════════════════════════════════════════════════════════════════════"
RULE_LIGHT="──────────────────────────────────────────────────────────────────────────────"

# Labels are padded to 9 chars (widest: "max turns") so values line up.
printf '\n%s%s%s\n'                          "$C_RULE" "$RULE_HEAVY" "$C_RST"
printf '  %sCOTECT MODEL EVALUATION%s\n'     "$C_VAL"  "$C_RST"
printf '%s%s%s\n'                            "$C_RULE" "$RULE_HEAVY" "$C_RST"
printf '  %sendpoint %s   %s\n'              "$C_LBL"  "$C_RST"  "$ENDPOINT"
printf '  %smodel    %s   %s%s%s\n'          "$C_LBL"  "$C_RST"  "$C_VAL" "$MODEL" "$C_RST"
printf '  %sadapter  %s   %s%s%s\n'          "$C_LBL"  "$C_RST"  "$C_DIM" "$ADAPTER" "$C_RST"
printf '  %sapi key  %s   %s%s%s\n'          "$C_LBL"  "$C_RST"  "$C_DIM" "${API_KEY:+(set)}${API_KEY:-(none)}" "$C_RST"
printf '  %smax turns%s   %s\n'              "$C_LBL"  "$C_RST"  "${MAX_TURNS:-20 (default)}"
printf '  %stimeout  %s   %ss\n'             "$C_LBL"  "$C_RST"  "${TIMEOUT:-120 (default)}"
SUITE_LABEL="full_suite"
if [[ -n "$SCENARIO" ]]; then SUITE_LABEL="scenario:${SCENARIO}"
elif [[ "$SUITE" == "xhard" ]]; then SUITE_LABEL="extra_hard"
elif $RUN_ALL; then SUITE_LABEL="all_categories"
fi
[[ -n "$DIFFICULTY" ]] && SUITE_LABEL="${SUITE_LABEL} · difficulty=${DIFFICULTY}"
printf '  %ssuite    %s   %s\n'              "$C_LBL"  "$C_RST"  "$SUITE_LABEL"
printf '%s%s%s\n'                            "$C_RULE" "$RULE_LIGHT" "$C_RST"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/../tauri"
cargo "${CARGO_ARGS[@]}"
