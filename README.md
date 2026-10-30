# CampusVoice

**CampusVoice — Student Feedback Management System** is a single, full-stack campus feedback platform. One shared website provides separate, role-protected student and authorized host experiences, backed by one Express API and MongoDB database.

## Features

- Shared landing page with student and host/admin login options.
- Student registration and sign-in, six feedback categories, optional anonymous feedback, history, complaints, and profile.
- Authorized host dashboard, student and feedback management, complaint tracking, analytics, CSV reports, feedback questions and periods, and system settings.
- JWT authentication, bcrypt password hashing, and server-side role checks for protected API requests.
- Responsive interface, light/dark themes, and dashboard charts.

## Technology

- Frontend: React 18, Vite, Tailwind CSS, React Router, Framer Motion, Lucide, and Recharts.
- Backend: Node.js, Express, Mongoose, MongoDB, JWT, and bcrypt.

## Requirements

- Node.js 20 or newer
- MongoDB (local or hosted)

## Local setup

1. Install dependencies:

   ```powershell
   npm install
   ```

2. Copy `.env.example` to `.env`. Set `MONGODB_URI` to your running MongoDB connection string. Generate a private JWT key and place it in `JWT_SECRET`:

   ```powershell
   node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
   ```

   Never commit `.env` or share its values.

3. To enable host sign-in, set a unique `HOST_EMAIL` and `HOST_PASSWORD` (at least 12 characters) in `.env`. The backend provisions this authorized account on first startup. There is no public host registration.
4. Start both frontend and backend:

   ```powershell
   npm.cmd run dev
   ```

5. Open `http://localhost:5173`. Vite proxies `/api` requests to the Express API at `http://localhost:5000`.

The backend loads `.env` first and can fall back to a local `module.env` when present. Keep both files private. MongoDB Community Server must be running; on Windows, check with `Get-Service MongoDB` and start it in an elevated PowerShell terminal with `Start-Service MongoDB` if needed.

Student registration is enabled by default and can be disabled in Host → System settings.

## Production

Run `npm run build` to create the static frontend in `dist`. Configure the web server to serve that directory with SPA history fallback and proxy `/api` requests to the Express server. Set `CLIENT_ORIGIN` to the deployed frontend origin.

## GitHub project description

Single full-stack student feedback platform with student and authorized host dashboards, six campus feedback categories, and a shared React, Express, and MongoDB backend.
