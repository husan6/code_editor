# Realtime Collaborative Code Editor

Realtime collaborative code editor with shared rooms, live syncing, Socket.io-powered collaboration, and in-browser code execution.

## Features

- Create and join collaborative rooms
- Realtime code sync between users
- Active user list and join/leave updates
- Monaco editor integration
- Basic remote cursor sharing
- Room chat
- Copyable room invite link
- Run JavaScript / TypeScript snippets
- Save and reload sessions in memory
- Download and upload code files
- Light and dark themes

## Tech Stack

- React
- Vite
- Node.js
- Express
- Socket.io
- Monaco Editor

## Folder Structure

```text
code_editor/
├── client/
│   ├── src/
│   ├── public/
│   └── package.json
├── server/
│   ├── index.js
│   ├── server.test.js
│   ├── package.json
│   └── package-lock.json
├── docs/
│   └── screenshots/
└── README.md
```

## Run Locally

### 1. Install dependencies

```bash
cd client
npm install
cd ..
cd server
npm install
cd ..
```

### 2. Start the server

```bash
cd server
npm start
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
cd server
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

## Screenshots

Add screenshots to [`docs/screenshots/`](./docs/screenshots/README.md) and then link them here.

Suggested screenshots:

- Join room screen
- Main editor screen
- Two-tab sync demo

## Demo

- Local demo: `http://localhost:5173`
- Add a hosted link here after deployment

## Future Improvements

- Deploy client and server
- Add persistent storage for rooms and sessions
- Add authentication and room ownership
- Improve editor sandboxing for code execution
- Add richer presence indicators and typing state
- Save screenshots and a public demo link
