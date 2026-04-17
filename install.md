# Compliance Controls — Installation Guide

This guide covers deploying the app by manually creating a Google Apps Script
project. No command-line tools are needed. Works on both consumer Gmail and
Google Workspace (enterprise) accounts.

---

## Prerequisites

- A Google account (consumer Gmail or Workspace)
- Google Drive access
- Google Apps Script enabled (Workspace admins: Admin Console → Apps → Google
  Workspace → Apps Script → set to ON for the target users/OUs)

---

## Step 1: Create the Apps Script Project

1. Go to [script.google.com](https://script.google.com)
2. Click **New project**
3. Rename the project to **Compliance Controls** (click "Untitled project" at
   top-left)

---

## Step 2: Add the Source Files

The Apps Script editor starts with a single `Code.gs` file. You need to replace
it and add the remaining files.

### Files to create

| File in editor | Source file in this repo | Type |
|---------------|------------------------|------|
| `Code.gs` | `src/Code.gs` | Script (.gs) |
| `DriveService.gs` | `src/DriveService.gs` | Script (.gs) |
| `Index.html` | `src/Index.html` | HTML |
| `Styles.html` | `src/Styles.html` | HTML |
| `App.html` | `src/App.html` | HTML |

### How to add each file

**For `.gs` files:**
1. In the editor sidebar (left), click **+** next to "Files"
2. Select **Script**
3. Name it exactly as shown (without the `.gs` extension — the editor adds it)
4. Delete the placeholder `function myFunction() {}` content
5. Paste the full content from the corresponding source file

**For `.html` files:**
1. Click **+** next to "Files"
2. Select **HTML**
3. Name it exactly as shown (without the `.html` extension)
4. Delete the placeholder HTML content
5. Paste the full content from the corresponding source file

**For `Code.gs`:** The project already has this file — just select it and
replace its content with the content from `src/Code.gs`.

### Update the manifest

1. In the editor, click the gear icon **⚙ Project Settings** (left sidebar)
2. Check **Show "appsscript.json" manifest file in editor**
3. Go back to the Editor view — `appsscript.json` now appears in the file list
4. Replace its content with the content from `src/appsscript.json`

---

## Step 3: Set Up the Drive Root Folder

The app stores all data (controls, attachments) in a single Drive folder. You
have two options to set this up:

### Option A: Let the app create it automatically

1. In the Apps Script editor, select **`initEnvironment`** from the function
   dropdown (next to the Run ▶ button, at the top)
2. Click **Run** ▶
3. First run will ask for authorization — click **Review Permissions**, select
   your account, and allow access
4. Check the **Execution log** (View → Execution log) — it shows:
   ```
   Created root folder: 1aBcD...xYz (https://drive.google.com/drive/folders/...)
   ```
5. The `ComplianceApp` folder now exists in your Drive root

### Option B: Use an existing folder

If you already have a folder you'd like to use (e.g., a Shared Drive folder):

1. Open the folder in Google Drive
2. Copy the folder ID from the URL:
   `https://drive.google.com/drive/folders/`**`THIS_PART`**
3. In the Apps Script editor, click **⚙ Project Settings** (left sidebar)
4. Scroll to **Script Properties**
5. Click **Add script property**
6. Set:
   - Property: `ROOT_FOLDER_ID`
   - Value: paste the folder ID
7. Click **Save script properties**

> **Tip:** Option B is useful when you want data on a Shared Drive that multiple
> people can access, or when you want to control the folder location.

---

## Step 4: Deploy as a Web App

1. In the editor, click **Deploy** → **New deployment**
2. Click the gear icon ⚙ next to "Select type" → choose **Web app**
3. Fill in:
   - **Description:** `v1.0` (or any version label)
   - **Execute as:** `User accessing the web app`
   - **Who has access:** choose based on your needs:
     - `Only myself` — personal use
     - `Anyone within [your organization]` — enterprise internal
     - `Anyone` — if no Workspace domain restriction applies
4. Click **Deploy**
5. Copy the **Web app URL** — this is your app's permanent address

> The URL looks like:
> `https://script.google.com/macros/s/AKfyc.../exec`

---

## Step 5: First Use

1. Open the Web app URL in your browser
2. On first visit, you may be asked to authorize again — accept
3. The app loads with an empty state
4. Click **Load Sample Data** (bottom of the sidebar) to create:
   - 1 standard (ISO 27001:2022)
   - 3 sample controls with pre-filled layer content
   - 1 sample draw.io diagram (3-page incident management process)
5. Select a control → use `+`/`-` buttons or mouse wheel to navigate layers

---

## Updating the App

When a new version of the source code is available:

1. Open the Apps Script editor
2. Replace the content of each file with the updated source
3. Click **Deploy** → **Manage deployments**
4. Click the pencil icon ✏ on the active deployment
5. Set **Version** to **New version**
6. Update the description (e.g., `v1.1`)
7. Click **Deploy**

The Web app URL stays the same — users see the new version immediately.

---

## Multi-User / Enterprise Notes

### Access control

- **Editor access to the script** = can modify app code + deploy
- **Web app access** = can use the app (read/write data in Drive)
- **Drive folder sharing** = controls who sees the data

Recommended setup:
- 1-2 admins have editor access to the Apps Script project
- All users access via the Web app URL
- The `ComplianceApp` Drive folder is shared with the team
  (or placed on a Shared Drive)

### Shared Drives (enterprise)

If your organization uses Shared Drives:

1. Create a Shared Drive or folder for compliance data
2. Use **Option B** from Step 3 to point the app at that folder
3. All team members with Shared Drive access can use the app

### Multiple environments

You can run separate instances (e.g., dev + production):

| | Dev | Production |
|---|---|---|
| Apps Script project | Personal consumer account | Enterprise Workspace |
| Drive folder | My Drive/ComplianceApp-dev | Shared Drive/Compliance |
| ROOT_FOLDER_ID | (auto-created by initEnvironment) | (set via Script Properties) |
| Code | Edit freely, test | Copy from dev when stable |
| URL | personal /exec URL | enterprise /exec URL |

The source code is identical. Only the Script Property `ROOT_FOLDER_ID` differs.

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Authorization required" on every visit | Clear browser cookies for `script.google.com`, re-authorize |
| "This app isn't verified" warning | Click **Advanced** → **Go to Compliance Controls (unsafe)** — this is normal for personal scripts |
| No controls appear after Load Sample Data | Check Execution log for errors; verify Drive permissions |
| draw.io diagram doesn't render | Ensure the browser can reach `viewer.diagrams.net` (not blocked by corporate firewall) |
| "Exception: Cannot find folder" | Script Property `ROOT_FOLDER_ID` points to a deleted/inaccessible folder — update it |
| Apps Script disabled (enterprise) | Workspace admin must enable: Admin Console → Apps → Google Workspace → Apps Script |
| Script Properties not visible | Go to ⚙ Project Settings → confirm "Show manifest" is checked; properties are under Project Settings, not in code |
