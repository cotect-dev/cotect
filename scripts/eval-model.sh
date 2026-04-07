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
#   --max-turns N     Max agent turns per scenario (default: 20)
#   --timeout SECS    Seconds before a scenario times out (default: 120)
#   --scenario NAME   Run a single scenario instead of the full suite
#                     Use a substring match, e.g.: --scenario bugfix, --scenario refactor_rename
#   --all             Run all individual scenarios (not just the suite runner)
#   --verbose         Show full cargo test output (--nocapture)
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
RUN_ALL=false
VERBOSE=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --endpoint)  ENDPOINT="$2"; shift 2 ;;
        --model)     MODEL="$2"; shift 2 ;;
        --api-key)   API_KEY="$2"; shift 2 ;;
        --max-turns) MAX_TURNS="$2"; shift 2 ;;
        --timeout)   TIMEOUT="$2"; shift 2 ;;
        --scenario)  SCENARIO="$2"; shift 2 ;;
        --all)       RUN_ALL=true; shift ;;
        --verbose)   VERBOSE=true; shift ;;
        -h|--help)
            sed -n '2,/^$/p' "$0" | sed 's/^#//; s/^ //'
            exit 0
            ;;
        *)
            echo "Unknown option: $1" >&2
            echo "Run with --help for usage." >&2
            exit 1
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

# Export environment variables
export COTECT_EVAL_ENDPOINT="$ENDPOINT"
export COTECT_EVAL_MODEL="$MODEL"
[[ -n "$API_KEY" ]]   && export COTECT_EVAL_API_KEY="$API_KEY"
[[ -n "$MAX_TURNS" ]] && export COTECT_EVAL_MAX_TURNS="$MAX_TURNS"
[[ -n "$TIMEOUT" ]]   && export COTECT_EVAL_TIMEOUT="$TIMEOUT"

# Build test filter
CARGO_ARGS=(test -p cotect)

if [[ -n "$SCENARIO" ]]; then
    CARGO_ARGS+=("eval_${SCENARIO}" -- --ignored --nocapture)
elif $RUN_ALL; then
    CARGO_ARGS+=("eval_" -- --ignored --nocapture)
else
    CARGO_ARGS+=("eval_suite" -- --ignored --nocapture)
fi

if $VERBOSE; then
    # Already has --nocapture from above
    :
fi

# Print config
echo "=========================================="
echo "Cotect Model Evaluation"
echo "=========================================="
echo "Endpoint:   $ENDPOINT"
echo "Model:      $MODEL"
echo "API Key:    ${API_KEY:+(set)}${API_KEY:-(none)}"
echo "Max Turns:  ${MAX_TURNS:-20 (default)}"
echo "Timeout:    ${TIMEOUT:-120 (default)}s"
echo "Scenario:   ${SCENARIO:-full_suite}"
echo "=========================================="
echo ""

# Navigate to the Tauri crate and run
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CRATE_DIR="$SCRIPT_DIR/../tauri"

cd "$CRATE_DIR"
cargo "${CARGO_ARGS[@]}"
