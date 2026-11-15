# Feather AI 2.0 — USB quick start

1. Copy the whole `FeatherAI-2.0.0-Windows-x64` folder to the USB drive.
2. On the Windows computer, open the folder and double-click `FeatherAI.exe`.
   Windows may show a SmartScreen prompt for an unsigned local build. Choose
   **More info → Run anyway** only if you trust the copy.
3. Confirm the title bar says **WINDOWS READ-ONLY SCANNER** and the USB pill shows
   the report folder.
4. Click **▶ START PROCESS**.
5. Watch Scanner's checks. A failed check is red; an unavailable check is grey
   and labeled **UNAVAILABLE**. Neither is hidden.
6. When Repair proposes a fix, click **REVIEW FIX**. Read the action, impact,
   risk, and linked evidence.
7. Choose **APPROVE FIX** to run that one action once, or **DECLINE** to change
   nothing. Declining still writes the diagnostic report.
8. Find the report in `reports/` beside `FeatherAI.exe`:
   - `.html` — readable in any browser
   - `.txt` — plain text for notes/tickets
   - `.json` — machine-readable evidence and event timeline

## If the USB is read-only

Feather AI probes the folder before writing. If it cannot write beside the
executable, it writes to `Documents\Feather AI 2 Reports` and shows a warning in
the Report card. The reports are still local; nothing is uploaded.

## No network needed

Disconnect the network before running. The app has no network code path and the
renderer CSP blocks connections. There is no account, license check, model
download, or API key.

## Administrator prompt

Some repairs require administrator rights. Windows shows a UAC prompt for that
specific action. Cancelling the prompt cancels the repair and is recorded in the
report. Scanner does not require elevation, though some checks return richer
evidence when the app is elevated.

## What Feather AI will not do

- It will not run a repair without an explicit approval for that exact proposal.
- It will not run the same approval twice.
- It will not change antivirus settings, delete personal documents, reset the
  network stack, or install software.
- It will not report an unavailable check as a pass.
