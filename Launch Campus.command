#!/bin/bash
#
# Launch Campus — double-click this file to start Obsidian Campus in
# development mode. It checks your tools, installs anything missing from
# npm, and opens the app window. Free, local, no accounts, no API keys.

cd "$(dirname "$0")" || exit 1

bold=$(tput bold 2>/dev/null); dim=$(tput dim 2>/dev/null); reset=$(tput sgr0 2>/dev/null)

echo ""
echo "${bold}◆ OBSIDIAN CAMPUS — Launch${reset}"
echo "${dim}Project: $(pwd)${reset}"
echo ""

fail() {
  echo ""
  echo "${bold}Something needs attention:${reset}"
  echo "  $1"
  echo ""
  echo "Full setup help is in SETUP_MAC.md (in this folder)."
  echo ""
  read -r -p "Press Return to close this window... "
  exit 1
}

# ------------------------------------------------------------------ checks
command -v node >/dev/null 2>&1 || fail "Node.js is not installed.
  Install it with Homebrew:   brew install node
  (No Homebrew? See SETUP_MAC.md, step 2.)"

command -v npm >/dev/null 2>&1 || fail "npm was not found even though Node.js is installed.
  Reinstalling Node.js usually fixes this:   brew reinstall node"

command -v cargo >/dev/null 2>&1 || fail "Rust is not installed (the desktop shell needs it).
  Install it with:   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
  Then close and reopen this window."

xcode-select -p >/dev/null 2>&1 || fail "The Xcode Command Line Tools are not installed.
  Install them with:   xcode-select --install
  Accept the popup, wait for it to finish, then run this file again."

# ------------------------------------------------------------ dependencies
if [ ! -d node_modules ]; then
  echo "First run — installing project dependencies (one-time, a few minutes)..."
  npm install || fail "npm install did not complete. Check your internet connection and try again."
  echo ""
fi

# ----------------------------------------------------------------- launch
echo "Starting the campus. The first launch compiles the desktop shell and"
echo "can take several minutes — later launches are much faster."
echo "${dim}Leave this window open while the campus is running. Close the app window to stop.${reset}"
echo ""

npm run tauri dev
status=$?

echo ""
if [ $status -ne 0 ]; then
  echo "${bold}The campus exited with an error (code $status).${reset}"
  echo "Common fixes are listed in SETUP_MAC.md under Troubleshooting."
else
  echo "Campus closed normally."
fi
echo ""
read -r -p "Press Return to close this window... "
