# Setting up Obsidian Campus on your Mac

This guide assumes very little coding experience. Follow it top to bottom.
Everything in it is free — no accounts, no subscriptions, no API keys.

---

## 1. Download the project

**Option A — with Git (recommended):**

1. Open the **Terminal** app (press `⌘ Space`, type `Terminal`, press Return).
2. Paste this and press Return:

   ```bash
   git clone -b claude/mission-control-upgrade https://github.com/aidansoto/aidansoto.github.io.git obsidian-campus
   ```

3. The project is now in a folder called `obsidian-campus` inside your home
   folder.

The `-b claude/mission-control-upgrade` part matters — that branch is where the
campus and Mission Control live. Cloning without it gets you `main`, which does
not have the app.

**Option B — as a ZIP:** on the GitHub page, use the branch dropdown to pick
**claude/mission-control-upgrade** first, then click the green **Code** button →
**Download ZIP** and double-click the ZIP to unpack it. Picking the branch
before downloading is the same trap as above.

## 2. Open the project folder

In Finder, go to your home folder and open `obsidian-campus` (or wherever you
unpacked the ZIP). Keep this window handy — the double-clickable helper files
live here:

| File | What it does |
| --- | --- |
| `Launch Campus.command` | Starts the app in development mode |
| `Build Mac App.command` | Builds the permanent Mac application |
| `Open Project Folder.command` | Opens this folder in Finder |
| `Reset Local Data.command` | Erases saved campus data (asks first) |

## 3. Install Homebrew (skip if you have it)

Homebrew is the free installer most Mac developers use. In Terminal:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Follow the prompts (it will ask for your Mac password). When it finishes, it
may print one or two lines starting with `echo` and `eval` — paste those in
too, exactly as shown.

**Check it worked:** `brew --version` should print a version number.

## 4. Install Node.js (skip if you have it)

```bash
brew install node
```

**Check:** `node --version` should print `v20` or higher.

## 5. Install Rust (skip if you have it)

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

Press Return to accept the default installation. Then **close Terminal and
open a new window** so the tools are picked up.

**Check:** `cargo --version` should print a version number.

## 6. Install the Xcode Command Line Tools (skip if you have them)

```bash
xcode-select --install
```

Click **Install** in the popup and wait for it to finish. This is Apple's
free compiler kit — no Xcode app and no paid developer account needed.

**Check:** `xcode-select -p` should print a path.

> Those four tools are everything Tauri needs on macOS. There is no separate
> "Tauri install" step — the project pulls it in automatically.

## 7. Install the project dependencies

In Terminal:

```bash
cd ~/obsidian-campus     # or wherever you put the folder
npm install
```

This takes a minute or two and only needs to be done once.

## 8. Launch the development application

**Easiest:** double-click **`Launch Campus.command`** in the project folder.

If macOS says it "cannot be opened because it is from an unidentified
developer": **right-click the file → Open → Open**. You only do this once.

**Or in Terminal:**

```bash
npm run tauri dev
```

The very first launch compiles the desktop shell and can take **several
minutes**. A window opens with the campus. Later launches take seconds.

## 9. Build the permanent Mac application

**Easiest:** double-click **`Build Mac App.command`**. It checks everything,
runs the tests, builds the app, and opens the output folder in Finder.

**Or in Terminal:**

```bash
npm run tauri build
```

The first build takes 10+ minutes. When it finishes:

## 10. Where the finished files are

Inside the project folder:

| File | Location |
| --- | --- |
| The application | `src-tauri/target/release/bundle/macos/Obsidian Campus.app` |
| The installer | `src-tauri/target/release/bundle/dmg/Obsidian Campus_0.1.0_aarch64.dmg` |

(The `.dmg` name ends in `_aarch64` on Apple Silicon Macs and `_x64` on Intel
Macs.)

## 11. Install it like a normal app

1. Double-click the `.dmg`.
2. Drag **Obsidian Campus** onto the **Applications** folder shown next to it.
3. Eject the installer (drag it to the Trash).
4. Open **Finder → Applications**.

## 12. If macOS blocks the app the first time

The app is not code-signed (signing is only needed for distributing to other
people, and requires a paid Apple account — not needed for your own use).
macOS will therefore warn you on the first open.

**Fix: right-click (or Control-click) `Obsidian Campus.app` → Open → Open.**
You only ever do this once. If macOS still refuses, run this in Terminal:

```bash
xattr -dr com.apple.quarantine "/Applications/Obsidian Campus.app"
```

## 13. Pin it to the Dock

While the app is running, right-click its icon in the Dock →
**Options → Keep in Dock**. From then on it opens with one click, like any
other app, and you can leave the campus running on a monitor.

---

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `command not found: npm` | Node.js isn't installed — do step 4, then open a **new** Terminal window. |
| `command not found: cargo` | Rust isn't installed — do step 5, then open a **new** Terminal window. |
| `xcrun: error: invalid active developer path` | Run `xcode-select --install` (step 6). |
| First launch/build is extremely slow | Normal — Rust compiles everything once, then caches it. |
| A `.command` file won't open | Right-click it → Open → Open (one time only). |
| The window opens but stays on "Initialising Campus" with a red message | The graphics renderer failed to start. Quit and reopen; if it persists, copy the message from Settings → Diagnostics. |
| The app says the database could not be opened | The campus still runs but won't save. Check that your disk isn't full, then restart the app. `Reset Local Data.command` clears a corrupt database. |
| You want a completely fresh start | Quit the app, run `Reset Local Data.command`, relaunch. |
| Build fails after a macOS update | Run `xcode-select --install` again, then retry. |

**Where your data lives:**
`~/Library/Application Support/com.obsidiancampus.app/campus.sqlite`
The app automatically keeps the last 20 revisions of your campus inside that
database. You can also export/import your campus as a JSON file from
**Settings → Data** inside the app.
