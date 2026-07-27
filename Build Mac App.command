#!/bin/bash
#
# Build Mac App — double-click this file to build the permanent Mac
# application (.app) and the installer (.dmg). Everything is built locally
# on your Mac with free tools. No developer account is required.

cd "$(dirname "$0")" || exit 1

bold=$(tput bold 2>/dev/null); dim=$(tput dim 2>/dev/null); reset=$(tput sgr0 2>/dev/null)

echo ""
echo "${bold}◆ OBSIDIAN CAMPUS — Build Mac Application${reset}"
echo "${dim}Project: $(pwd)${reset}"
echo ""

fail() {
  echo ""
  echo "${bold}The build stopped:${reset}"
  echo "  $1"
  echo ""
  echo "Troubleshooting help is in SETUP_MAC.md (in this folder)."
  echo ""
  read -r -p "Press Return to close this window... "
  exit 1
}

# ------------------------------------------------------------------ checks
command -v node >/dev/null 2>&1 || fail "Node.js is not installed. Install it with:   brew install node"
command -v cargo >/dev/null 2>&1 || fail "Rust is not installed. Install it with:
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
xcode-select -p >/dev/null 2>&1 || fail "The Xcode Command Line Tools are missing. Run:   xcode-select --install"

if [ "$(uname)" != "Darwin" ]; then
  fail "This script builds a Mac application and must be run on macOS."
fi

# ------------------------------------------------------------ dependencies
if [ ! -d node_modules ]; then
  echo "Installing project dependencies first..."
  npm install || fail "npm install did not complete."
  echo ""
fi

# ------------------------------------------------------------------ checks
echo "Running type checks..."
npm run typecheck || fail "TypeScript found a problem (details above)."
echo ""
echo "Running the test suite..."
npm test || fail "A test failed (details above)."
echo ""

# ------------------------------------------------------------------- build
echo "Building the Mac application. The first build compiles the whole Rust"
echo "toolchain and can take 10+ minutes. Later builds are much faster."
echo ""
npm run tauri build || fail "The Tauri build failed (details above)."

# ------------------------------------------------------------------ report
BUNDLE_DIR="src-tauri/target/release/bundle"
echo ""
echo "${bold}Build finished. Output locations:${reset}"
APP_PATH=$(find "$BUNDLE_DIR/macos" -maxdepth 1 -name "*.app" 2>/dev/null | head -1)
DMG_PATH=$(find "$BUNDLE_DIR/dmg" -maxdepth 1 -name "*.dmg" 2>/dev/null | head -1)

if [ -n "$APP_PATH" ]; then
  echo "  Application:  $(pwd)/$APP_PATH"
else
  echo "  Application:  not found under $BUNDLE_DIR/macos (see build output above)"
fi
if [ -n "$DMG_PATH" ]; then
  echo "  Installer:    $(pwd)/$DMG_PATH"
else
  echo "  Installer:    not found under $BUNDLE_DIR/dmg (see build output above)"
fi

echo ""
echo "To install: open the .dmg and drag the app into Applications."
echo "First launch: right-click the app and choose Open (it is not code-signed)."
echo ""

if [ -d "$BUNDLE_DIR" ]; then
  open "$BUNDLE_DIR"
fi

read -r -p "Press Return to close this window... "
