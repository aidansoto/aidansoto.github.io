#!/bin/bash
#
# Reset Local Data — deletes the campus's saved data so the app starts
# fresh with the default campus. This NEVER touches source code, and it
# never deletes anything outside the app's own data folder.

bold=$(tput bold 2>/dev/null); reset=$(tput sgr0 2>/dev/null)

DATA_DIR="$HOME/Library/Application Support/com.obsidiancampus.app"

echo ""
echo "${bold}◆ OBSIDIAN CAMPUS — Reset Local Data${reset}"
echo ""
echo "This will permanently delete the saved campus data in:"
echo ""
echo "  $DATA_DIR"
echo ""
echo "  • Every finished mission, its deliverable, and the Knowledge Vault"
echo "    will be lost, along with what the Manager has learned."
echo "  • Building names, agent names and layout changes will be lost."
echo "  • Settings will return to defaults."
echo "  • The app will recreate a fresh default campus on next launch."
echo "  • Source code and the project folder are NOT touched."
echo ""
echo "  To keep a copy first: open the app, then Settings > Data >"
echo "  Export Data. Close this window, do that, and run this again."
echo ""

if [ ! -d "$DATA_DIR" ]; then
  echo "No saved data found — there is nothing to reset."
  echo ""
  read -r -p "Press Return to close this window... "
  exit 0
fi

read -r -p "Type DELETE (all capitals) to continue, or anything else to cancel: " answer
echo ""

if [ "$answer" != "DELETE" ]; then
  echo "Cancelled. Nothing was deleted."
  echo ""
  read -r -p "Press Return to close this window... "
  exit 0
fi

# Delete only the campus database files inside the app's own data folder.
rm -f "$DATA_DIR/campus.sqlite" \
      "$DATA_DIR/campus.sqlite-wal" \
      "$DATA_DIR/campus.sqlite-shm"

echo "Done. The campus data was deleted."
echo "The next launch will start with the default campus."
echo ""
read -r -p "Press Return to close this window... "
