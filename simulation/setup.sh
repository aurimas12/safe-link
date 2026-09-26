#!/usr/bin/env bash
# SafeLink simuliacijos aplinka: InfraRisk (užfiksuotas commit) + Python 3.10 venv.
# Paleidimas: ./simulation/setup.sh
set -euo pipefail
cd "$(dirname "$0")"

INFRARISK_REPO=https://github.com/srijithbalakrishnan/dreaminsg-integrated-model.git
INFRARISK_COMMIT=3e395de   # peržiūrėtas 2026-09-26; keisti tik sąmoningai
PYTHON=${PYTHON:-python3.10}

if [ ! -d vendor/infrarisk/.git ]; then
  mkdir -p vendor
  git clone --quiet "$INFRARISK_REPO" vendor/infrarisk
fi
git -C vendor/infrarisk fetch --quiet origin
git -C vendor/infrarisk checkout --quiet "$INFRARISK_COMMIT"

if [ ! -d .venv ]; then
  "$PYTHON" -m venv .venv
fi
.venv/bin/pip install --quiet --upgrade pip wheel
.venv/bin/pip install --quiet -r requirements.txt
# Priklausomybės jau užfiksuotos requirements.txt – InfraRisk diegiam be jų, kad neperrašytų versijų.
.venv/bin/pip install --quiet --no-deps -e vendor/infrarisk

echo "InfraRisk $(git -C vendor/infrarisk rev-parse --short HEAD) paruoštas: simulation/.venv"
