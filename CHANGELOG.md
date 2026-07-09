# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] - 2026-07-08

### Added
- **Telegram Bot Integration**:
  - Built bot handling utilizing `telegraf` library.
  - Implemented commands: `/start`, `/upload`, `/files`, `/search`, `/folder`, `/tag`, `/trash`, `/delete`, `/info`, and `/storage`.
  - Added support for file uploads directly through private chat or forwarding from channels.
  - Implemented secure deep-linking account association via dynamic tokens.
  - Added a **Telegram Share Bot** supporting dynamic public file downloads using deep-linking and on-the-fly streaming.
- **Web Portal Dashboard**:
  - Created interactive Single Page Application (SPA) with vanilla HTML, CSS, and JS.
  - Added drag-and-drop file upload with real-time UI updates.
  - Supported folder navigation (with breadcrumbs) and creation of nested virtual directories.
  - Added file details modal, interactive tag editor, and file moving operations.
  - Added Telegram file importing modal utilizing file links or Telegram message IDs.
  - Integrated storage capacity breakdown chart and summary metrics.
- **Express Backend Service**:
  - Implemented RESTful API endpoints for authentication, file uploads, file list/downloads, folder structures, and statistics.
  - Implemented on-demand streaming of files from Telegram servers directly to client downloads.
- **Database Schema & Migrations**:
  - Initial database structure supporting `users` and `files` tables.
  - Built automated schema migration script that imports `schema.sql` at server startup.
  - Enabled auto-creation of default `admin` user if no users are present.
- **Security Protections**:
  - Integrated Express session-based authentication with `cookie-parser`.
  - Enabled CSRF (Cross-Site Request Forgery) protection on all state-changing endpoints.
  - Applied password hashing using `bcryptjs` before storage.
- **Documentation & Setup**:
  - Added [PANDUAN_SETUP.md](file:///media/devmon/TERRA/App/ProjectTerranova/terraTelegramDrive/PANDUAN_SETUP.md) setup and deployment instructions in Indonesian.
  - Added [.env.example](file:///media/devmon/TERRA/App/ProjectTerranova/terraTelegramDrive/.env.example) configuration variables placeholder.
