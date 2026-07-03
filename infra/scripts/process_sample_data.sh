#!/bin/bash
set -euo pipefail

# ============================================================================
# process_sample_data.sh
# ----------------------------------------------------------------------------
# Installs the post-deploy Python dependency and runs scripts/post_deploy.py to
# load the sample data into the deployed application.
#
# Run AFTER build_and_deploy_images.sh has completed (the application images
# must be built, pushed and running first). Configuration is read from the azd
# environment.
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# Load azd environment outputs into the shell. Parse without `eval` so that any
# command substitution embedded in a value cannot execute in this shell.
if command -v azd >/dev/null 2>&1; then
  while IFS='=' read -r _key _val; do
    [ -z "${_key}" ] && continue
    _val="${_val%\"}"
    _val="${_val#\"}"
    export "${_key}=${_val}"
  done < <(azd env get-values 2>/dev/null)
fi

# Resolve the Python executable (python3 preferred, fall back to python).
if command -v python3 >/dev/null 2>&1; then
  PYTHON="python3"
elif command -v python >/dev/null 2>&1; then
  PYTHON="python"
else
  echo "ERROR: Python is not installed or not on PATH." >&2
  exit 1
fi

echo "===== Installing post-deploy dependencies ====="
"${PYTHON}" -m pip install -r "${REPO_ROOT}/scripts/requirements-post-deploy.txt" --quiet

echo "===== Loading sample data ====="
"${PYTHON}" "${REPO_ROOT}/scripts/post_deploy.py" --skip-tests

echo ""
echo "===== Done ====="
