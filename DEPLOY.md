# HQP Drone Ops — Deployment Guide

This guide walks you through getting the app live at your own URL.
No coding experience required. Everything used here is free.

**Total time: about 20–30 minutes**

---

## What you'll set up

| Service | What it does | Cost |
|---------|-------------|------|
| GitHub  | Stores your code | Free |
| Supabase | Database + file storage | Free |
| Vercel  | Hosts your website | Free |

---

## Step 1 — GitHub (store your code)

1. Go to **github.com** and create a free account if you don't have one
2. Once logged in, click the **+** button (top right) → **New repository**
3. Repository name: `hqp-drone-ops`
4. Leave everything else as default, click **Create repository**
5. On the next screen, click **uploading an existing file**
6. Drag and drop ALL the files and folders from the `hqp-drone-ops` folder you downloaded
   - Make sure to include: `src/`, `index.html`, `package.json`, `vite.config.js`, `schema.sql`, `.env.example`
7. Scroll down, click **Commit changes**

Your code is now on GitHub. ✓

---

## Step 2 — Supabase (database + file storage)

### 2a — Create a project

1. Go to **supabase.com** and create a free account
2. Click **New project**
3. Fill in:
   - **Name:** `hqp-drone-ops`
   - **Database password:** choose something strong and save it somewhere safe
   - **Region:** choose the closest to Australia (e.g. Southeast Asia / ap-southeast-1)
4. Click **Create new project**
5. Wait about 2 minutes for it to finish setting up

### 2b — Create the database table

1. In the left sidebar, click **SQL Editor**
2. Click **New query**
3. Open the `schema.sql` file from your project folder (open it in Notepad/TextEdit)
4. Copy all the text from that file
5. Paste it into the SQL Editor
6. Click **Run** (or press Ctrl+Enter / Cmd+Enter)
7. You should see "Success. No rows returned" — that means it worked ✓

### 2c — Create the file storage bucket

1. In the left sidebar, click **Storage**
2. Click **New bucket**
3. Fill in:
   - **Bucket name:** `job-files`
   - **Public bucket:** turn this ON ← important
4. Click **Create bucket**

### 2d — Get your API keys

1. In the left sidebar, click **Settings** (gear icon at the bottom)
2. Click **API**
3. You'll see two values you need — keep this tab open:
   - **Project URL** — looks like `https://abcdefgh.supabase.co`
   - **anon public** key — a long string of letters/numbers

---

## Step 3 — Vercel (host your website)

1. Go to **vercel.com**
2. Click **Sign up** → choose **Continue with GitHub** (easiest — links your accounts)
3. Once logged in, click **Add New…** → **Project**
4. Find `hqp-drone-ops` in the list, click **Import**
5. **Before clicking Deploy**, scroll down to **Environment Variables**
6. Add two variables (using the values from Supabase Step 2d):

   | Name | Value |
   |------|-------|
   | `VITE_SUPABASE_URL` | your Project URL from Supabase |
   | `VITE_SUPABASE_ANON_KEY` | your anon public key from Supabase |

   To add each one: type the name, paste the value, click **Add**

7. Click **Deploy**
8. Wait about 1 minute
9. You'll see a success screen with your live URL — something like `hqp-drone-ops.vercel.app`

**Your app is live.** ✓

---

## Step 4 — First-time setup in the app

1. Open your new URL
2. You should see the **Client Portal** (HQ Plantations view)
3. Click **◈ Operations** → enter PIN **1234**
4. Click **⚙ Settings** and:
   - **Change the PIN** from 1234 to something only you know
   - **Add your notification email** so you get an email draft when HQ books a job
5. Click Save

---

## Step 5 — Custom domain (optional)

If you have your own domain (e.g. `droneops.yourbusiness.com.au`):

1. In Vercel, go to your project → **Settings** → **Domains**
2. Click **Add Domain**
3. Type your domain name and follow the instructions
4. Vercel will guide you through adding a DNS record with your domain registrar (GoDaddy, Namecheap, etc.)
5. Takes 5–30 minutes to go live

---

## Sharing with HQ Plantations

Once deployed, send HQ Plantations your URL. That's it — they open it in any browser, no account needed, and can book jobs directly. You'll get an email notification each time (if configured).

**Your Operations view is protected by PIN** — HQ Plantations can only see the Client Portal.

---

## If something goes wrong

| Problem | Fix |
|---------|-----|
| App shows "Supabase not configured" | Check your environment variables in Vercel — Settings → Environment Variables |
| Database error on load | Re-run the schema.sql in Supabase SQL Editor |
| Files not uploading | Check your `job-files` bucket exists and is set to Public |
| App won't build on Vercel | Check the build log for errors — usually a typo in env variable names |

For any of these, feel free to paste the error message back into this chat and I can help diagnose it.

---

## Updating the app in future

When changes are made to the code:
1. The updated files will be provided
2. Go to your GitHub repo → find the file → click the pencil icon to edit, or drag a new version
3. Vercel automatically redeploys within about 1 minute of any GitHub change

---

## Storage limits (Supabase free tier)

- **Database:** 500MB (thousands of jobs)
- **File storage:** 1GB total
- **Bandwidth:** 5GB/month

For typical drone operations use, the free tier should last years. If you ever hit limits, Supabase Pro is $25/month.
