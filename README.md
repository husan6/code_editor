# Realtime Collaborative Code Editor

## Overview

A collaborative code editor prototype with shared rooms, realtime syncing, chat, multiple open files, code execution, and simple session persistence.

## Stack

- Frontend: React + Vite
- Backend: Node.js + Express
- Realtime transport: Socket.io
- Editor: Monaco Editor

## Features

- Create and join collaborative rooms
- Realtime code sync between users
- Active user list and join/leave updates
- Basic remote cursor sharing
- Room chat
- Run JavaScript / TypeScript snippets
- Save and reload sessions in memory
- Download and upload code files
- Light and dark themes

## Local setup

### 1. Install dependencies

```bash
npm install
cd client
npm install
cd ..
```

### 2. Start the backend

```bash
npm run start
```

The backend runs on `http://localhost:4000`.

### 3. Start the frontend

In a second terminal:

```bash
cd client
npm run dev
```

The frontend runs on `http://localhost:5173`.

## Testing

Run the backend smoke test:

```bash
npm test
```

Run frontend lint:

```bash
cd client
npm run lint
```

Create a production build:

```bash
cd client
npm run build
```

## Notes

- Room and saved-session data are stored in memory only.
- The default frontend backend URL is `http://localhost:4000`.
- For production use, add persistent storage, authentication, and stronger sandboxing around code execution.
