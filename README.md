# Ronin — WhatsApp Web Frontend

React + Vite frontend for the Ronin WhatsApp server. Connects to the backend API
via Server-Sent Events for live inbox updates.

## Initial Setup

### 1. Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) and sign up / log in
2. Click **New Project**
3. Name it (e.g. `ronin`), set a database password, choose a region
4. Click **Create new project** — wait ~2 minutes for provisioning

### 2. Get Your Supabase Credentials

1. In your Supabase project, go to **Settings** → **API**
2. Copy these two values:

| Variable | Where to find it |
|----------|-----------------|
| `VITE_SUPABASE_URL` | Project URL (e.g. `https://xyzcompany.supabase.co`) |
| `VITE_SUPABASE_ANON_KEY` | `anon` `public` key (long JWT string) |

### 3. Create an Authenticated User

1. In your Supabase project, go to **Authentication** → **Users**
2. Click **Add User** → **Create New User**
3. Enter:
   - **Email**: your email address
   - **Password**: a strong password
4. Click **Create User**
5. (Optional) If you need to confirm the email manually, click the user and
   toggle **Email Confirm** — or disable email confirmation under
   **Authentication** → **Providers** → **Email** → uncheck "Confirm email"

### 4. Deploy to Vercel (Dashboard)

#### Push to GitHub
Make sure your code is on GitHub (main branch).

#### Import Project
- Go to [vercel.com](https://vercel.com) → New Project
- Select your GitHub repo
- Vercel auto-detects Vite (Framework Preset, Build Command, Output Directory are pre-filled)

#### Configure Environment Variables
Before deploying, add these under "Environment Variables":

| Variable | Value |
|----------|-------|
| VITE_API_URL | https://your-backend.onrender.com |
| VITE_API_TOKEN | Must match API_TOKEN in your backend .env |
| VITE_SUPABASE_URL | Your Supabase project URL (from Step 2) |
| VITE_SUPABASE_ANON_KEY | Your Supabase anon public key (from Step 2) |

#### Deploy
Click Deploy. Vercel builds with `npm run build` and serves `dist/`.

#### Update Backend URL (if backend moves)
- Project Settings → Environment Variables → Edit VITE_API_URL
- Redeploy (Deployments → ⋯ → Redeploy)
