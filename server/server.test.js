const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');

const PORT = 4100;
const BASE_URL = `http://127.0.0.1:${PORT}`;

function waitForServer(child) {
  return new Promise((resolve, reject) => {
    let output = '';

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Server did not start in time.\n${output}`));
    }, 10000);

    const onData = (chunk) => {
      output += chunk.toString();
      if (output.includes(`Server listening on port ${PORT}`)) {
        cleanup();
        resolve();
      }
    };

    const onExit = (code) => {
      cleanup();
      reject(new Error(`Server exited before startup with code ${code}.\n${output}`));
    };

    const cleanup = () => {
      clearTimeout(timer);
      child.stdout.off('data', onData);
      child.stderr.off('data', onData);
      child.off('exit', onExit);
    };

    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', onExit);
  });
}

async function requestJson(path, options) {
  const response = await fetch(`${BASE_URL}${path}`, options);
  const body = await response.json();
  return { response, body };
}

test('backend smoke test covers health, stats, code execution, and session persistence', async () => {
  const child = spawn(process.execPath, ['index.js'], {
    cwd: __dirname,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    await waitForServer(child);

    const health = await requestJson('/');
    assert.equal(health.response.status, 200);
    assert.equal(health.body.status, 'OK');

    const stats = await requestJson('/stats');
    assert.equal(stats.response.status, 200);
    assert.equal(stats.body.activeRooms, 0);
    assert.equal(stats.body.savedSessions, 0);

    const run = await requestJson('/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'console.log("hello from test"); 2 + 3;' }),
    });
    assert.equal(run.response.status, 200);
    assert.deepEqual(run.body.output, ['hello from test']);
    assert.equal(run.body.result, 5);

    const roomId = 'smoke-room';
    const files = [{ id: 'file-1', name: 'index.js', code: 'console.log("saved")' }];
    const messages = [{ username: 'tester', message: 'hello', createdAt: new Date().toISOString() }];

    const save = await requestJson('/save-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId, files, messages }),
    });
    assert.equal(save.response.status, 200);
    assert.equal(save.body.status, 'ok');
    assert.equal(save.body.saved.files[0].name, 'index.js');

    const load = await requestJson(`/session/${roomId}`);
    assert.equal(load.response.status, 200);
    assert.deepEqual(load.body.files, files);
    assert.deepEqual(load.body.messages, messages);

    const missing = await requestJson('/session/missing-room');
    assert.equal(missing.response.status, 404);
    assert.equal(missing.body.error, 'session not found');

    const rooms = await requestJson('/rooms');
    assert.equal(rooms.response.status, 200);
    assert.deepEqual(rooms.body.rooms, []);
    assert.equal(rooms.body.activeRoomCount, 0);
  } finally {
    child.kill();
  }
});
