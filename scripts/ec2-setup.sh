#!/usr/bin/env bash
#
# One-time setup on AWS EC2 (AL2023) for GitHub deploy pulls.
# Run as a user that can write to your Apache docroot, e.g. ec2-user.
#
# Usage:
#   sudo dnf install -y git
#   bash ec2-setup.sh /var/www/html/teleprompter git@github.com:MatthewShell1/teleprompter.git
#
set -euo pipefail

DEPLOY_PATH="${1:-/var/www/html/teleprompter}"
REPO_URL="${2:-git@github.com:MatthewShell1/teleprompter.git}"

if ! command -v git >/dev/null 2>&1; then
  echo "git is required. Install with: sudo dnf install -y git"
  exit 1
fi

if [[ -d "${DEPLOY_PATH}/.git" ]]; then
  echo "Repository already exists at ${DEPLOY_PATH}"
  cd "${DEPLOY_PATH}"
  git remote -v
  exit 0
fi

sudo mkdir -p "$(dirname "${DEPLOY_PATH}")"
sudo git clone "${REPO_URL}" "${DEPLOY_PATH}.tmp"
sudo mv "${DEPLOY_PATH}.tmp" "${DEPLOY_PATH}"

# Typical Apache docroot ownership on AL2023
if id apache >/dev/null 2>&1; then
  sudo chown -R apache:apache "${DEPLOY_PATH}"
fi

echo "Clone complete: ${DEPLOY_PATH}"
echo "Ensure Apache serves this directory (Alias or DocumentRoot)."
