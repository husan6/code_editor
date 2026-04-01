import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import Editor from '@monaco-editor/react';
import { v4 as uuidv4 } from 'uuid';
import './App.css';

const DEFAULT_PROD_BACKEND_URL = 'https://code-editor-fg9e.onrender.com';
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL
  || (import.meta.env.PROD ? DEFAULT_PROD_BACKEND_URL : 'http://localhost:4000');

const createStarterFile = () => ({
  id: uuidv4(),
  name: 'index.js',
  code: '// Start coding...\n',
});

const getQueryParam = (key) => {
  if (typeof window === 'undefined') {
    return '';
  }

  return new URL(window.location.href).searchParams.get(key) || '';
};

const getRoomIdFromUrl = () => {
  return getQueryParam('room');
};

const getStoredFilesForRoom = (roomId) => {
  if (typeof window === 'undefined' || !roomId) {
    return null;
  }

  const backup = window.localStorage.getItem(`collab-files-${roomId}`);
  if (!backup) {
    return null;
  }

  try {
    const parsed = JSON.parse(backup);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
  } catch (error) {
    console.warn('restore parse failed', error);
    return null;
  }
};

const getLanguageFromFileName = (fileName = '') => {
  const extension = fileName.split('.').pop()?.toLowerCase();

  switch (extension) {
    case 'ts':
    case 'tsx':
      return 'typescript';
    case 'py':
      return 'python';
    case 'json':
      return 'json';
    case 'js':
    case 'jsx':
    default:
      return 'javascript';
  }
};

const syncRoomInUrl = (roomId) => {
  if (typeof window === 'undefined') {
    return;
  }

  const url = new URL(window.location.href);
  if (roomId) {
    url.searchParams.set('room', roomId);
  } else {
    url.searchParams.delete('room');
  }

  window.history.replaceState({}, '', url);
};

const getDownloadName = (fileName = '', language = 'javascript') => {
  const trimmedName = fileName.trim();
  if (!trimmedName) {
    return 'code.txt';
  }

  if (/\.[^./\\]+$/.test(trimmedName)) {
    return trimmedName;
  }

  const extensionMap = {
    javascript: 'js',
    typescript: 'ts',
    python: 'py',
    json: 'json',
  };

  return `${trimmedName}.${extensionMap[language] || 'txt'}`;
};

const getInitialSessionState = () => {
  const demo = getQueryParam('demo');
  const demoPresets = {
    editor: {
      roomId: 'portfolio-demo',
      username: 'Husan',
      autoJoin: true,
      demoCode: "function greet(name) {\n  console.log('Hello, ' + name);\n}\n\ngreet('team');\n",
    },
    'sync-host': {
      roomId: 'sync-demo-room',
      username: 'Husan',
      autoJoin: true,
      demoCode: "const users = ['Husan', 'Teammate'];\nconsole.log(users.join(', '));\n",
    },
    'sync-guest': {
      roomId: 'sync-demo-room',
      username: 'Teammate',
      autoJoin: true,
      demoCode: "const users = ['Husan', 'Teammate'];\nconsole.log(users.join(', '));\n",
    },
  };
  const preset = demoPresets[demo] || null;
  const roomId = getRoomIdFromUrl();
  const storedFiles = getStoredFilesForRoom(roomId);
  const files = storedFiles || [createStarterFile()];
  const activeFile = files[0];
  const username = preset?.username || getQueryParam('user');
  const autoJoin = preset?.autoJoin || getQueryParam('autojoin') === '1';
  const demoCode = preset?.demoCode || getQueryParam('demoCode');

  return {
    roomId: preset?.roomId || roomId,
    username,
    autoJoin,
    demoCode,
    files,
    activeFileId: activeFile.id,
    language: getLanguageFromFileName(activeFile.name),
    loadedSession: Boolean(storedFiles),
  };
};

function App() {
  const [initialSession] = useState(getInitialSessionState);

  const [roomId, setRoomId] = useState(initialSession.roomId);
  const [username, setUsername] = useState(initialSession.username);
  const [joined, setJoined] = useState(
    Boolean(initialSession.autoJoin && initialSession.roomId && initialSession.username),
  );
  const [files, setFiles] = useState(initialSession.files);
  const [activeFileId, setActiveFileId] = useState(initialSession.activeFileId);
  const [messages, setMessages] = useState([]);
  const [messageText, setMessageText] = useState('');
  const [users, setUsers] = useState([]);
  const [logs, setLogs] = useState([]);
  const [theme, setTheme] = useState('vs-dark');
  const [runOutput, setRunOutput] = useState(null);
  const [saveStatus, setSaveStatus] = useState('');
  const [loadedSession, setLoadedSession] = useState(initialSession.loadedSession);
  const [language, setLanguage] = useState(initialSession.language);
  const [roomStats, setRoomStats] = useState({ activeRooms: 0, activeUsers: 0, savedSessions: 0 });
  const [status, setStatus] = useState('Not connected');
  const socketRef = useRef(null);
  const editorRef = useRef(null);
  const markersRef = useRef({});
  const demoCodeAppliedRef = useRef(false);

  const roomUrl = useMemo(
    () => (roomId ? `${window.location.origin}?room=${roomId}` : window.location.origin),
    [roomId],
  );
  const activeFile = files.find((file) => file.id === activeFileId) || files[0];

  const addLog = useCallback((entry) => {
    setLogs((prev) => [...prev, `${new Date().toLocaleTimeString()} - ${entry}`]);
  }, []);

  const restoreFilesFromStorage = useCallback(
    (targetRoomId) => {
      const storedFiles = getStoredFilesForRoom(targetRoomId);
      if (!storedFiles) {
        setLoadedSession(false);
        return false;
      }

      setFiles(storedFiles);
      setActiveFileId(storedFiles[0].id);
      setLanguage(getLanguageFromFileName(storedFiles[0].name));
      setLoadedSession(true);
      addLog('Restored files from localStorage');
      return true;
    },
    [addLog],
  );

  const copyRoomLink = useCallback(async () => {
    if (!roomId) {
      addLog('Create or join a room first');
      return;
    }

    try {
      await navigator.clipboard.writeText(roomUrl);
      addLog('Copied room link');
    } catch (error) {
      console.warn('copy room link failed', error);
      addLog('Copy room link failed');
    }
  }, [addLog, roomId, roomUrl]);

  useEffect(() => {
    document.body.classList.toggle('light', theme === 'light');
    document.body.classList.toggle('dark', theme === 'vs-dark');

    return () => {
      document.body.classList.remove('light', 'dark');
    };
  }, [theme]);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const response = await fetch(`${BACKEND_URL}/stats`);
        if (!response.ok) {
          return;
        }

        const data = await response.json();
        setRoomStats(data);
      } catch (error) {
        console.warn('failed to fetch stats', error);
      }
    };

    fetchStats();
    const interval = setInterval(fetchStats, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      if (!roomId || files.length === 0) {
        return;
      }

      window.localStorage.setItem(`collab-files-${roomId}`, JSON.stringify(files));
      addLog('Autosaved locally');
    }, 10000);

    return () => clearInterval(timer);
  }, [addLog, files, roomId]);

  useEffect(() => {
    if (!joined) {
      return undefined;
    }

    const socket = io(BACKEND_URL, { transports: ['websocket'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      addLog('Connected to server');
      setStatus('Connected');
    });

    socket.on('connect_error', (error) => {
      console.warn('socket connection failed', error);
      addLog('Connection error');
      setStatus('Connection error');
    });

    socket.on('disconnect', () => {
      addLog('Disconnected');
      setStatus('Disconnected');
    });

    socket.on('room-data', ({ files: roomFiles, users: roomUsers = {}, messages: roomMessages = [] }) => {
      if (Array.isArray(roomFiles) && roomFiles.length > 0) {
        setFiles(roomFiles);
        setActiveFileId(roomFiles[0].id);
        setLanguage(getLanguageFromFileName(roomFiles[0].name));

        if (initialSession.demoCode && !demoCodeAppliedRef.current) {
          demoCodeAppliedRef.current = true;
          const [firstFile, ...restFiles] = roomFiles;
          const demoFiles = [{ ...firstFile, code: initialSession.demoCode }, ...restFiles];
          setFiles(demoFiles);
          socket.emit('code-change', { roomId, fileId: firstFile.id, code: initialSession.demoCode });
        }
      }

      setUsers(Object.entries(roomUsers).map(([socketId, user]) => ({ socketId, ...user })));
      setMessages(Array.isArray(roomMessages) ? roomMessages : []);
      addLog(`Joined room: ${roomId}`);
    });

    socket.on('code-change', ({ fileId, code }) => {
      setFiles((prev) => prev.map((file) => (file.id === fileId ? { ...file, code } : file)));
    });

    socket.on('user-joined', ({ username: joinedUsername }) => {
      addLog(`${joinedUsername} joined`);
    });

    socket.on('user-left', ({ username: departedUsername }) => {
      if (departedUsername) {
        addLog(`${departedUsername} left`);
      }
    });

    socket.on('active-users', (activeUsers) => {
      setUsers(Array.isArray(activeUsers) ? activeUsers : []);
    });

    socket.on('chat-message', (message) => {
      setMessages((prev) => [...prev, message]);
    });

    socket.on('cursor-change', ({ socketId, range }) => {
      const editor = editorRef.current;
      if (!editor || !range || socketId === socket.id) {
        return;
      }

      const decorations = markersRef.current[socketId] || [];
      const [newDecoration] = editor.deltaDecorations(decorations, [
        {
          range,
          options: {
            className: 'remote-cursor',
            isWholeLine: false,
            beforeContentClassName: 'remote-cursor-label',
            afterContentClassName: 'remote-cursor-after',
          },
        },
      ]);
      markersRef.current[socketId] = [newDecoration];
    });

    socket.emit('join-room', { roomId, username });

    return () => {
      socket.disconnect();
      socketRef.current = null;
      markersRef.current = {};
    };
  }, [addLog, initialSession.demoCode, joined, roomId, username]);

  const handleCreateRoom = useCallback(() => {
    const newRoomId = uuidv4();
    const starterFile = createStarterFile();

    setRoomId(newRoomId);
    setFiles([starterFile]);
    setActiveFileId(starterFile.id);
    setLanguage(getLanguageFromFileName(starterFile.name));
    setMessages([]);
    setUsers([]);
    setRunOutput(null);
    setSaveStatus('');
    setLoadedSession(false);
    setStatus('Not connected');
    syncRoomInUrl(newRoomId);
    addLog(`Room created: ${newRoomId}`);
  }, [addLog]);

  const handleJoinRoom = useCallback(() => {
    const normalizedRoomId = roomId.trim();
    const normalizedUsername = username.trim();

    if (!normalizedRoomId || !normalizedUsername) {
      addLog('Username and room are required');
      return;
    }

    setRoomId(normalizedRoomId);
    setUsername(normalizedUsername);
    syncRoomInUrl(normalizedRoomId);
    restoreFilesFromStorage(normalizedRoomId);
    setJoined(true);
  }, [addLog, restoreFilesFromStorage, roomId, username]);

  const onCodeChange = useCallback(
    (value) => {
      const nextCode = value ?? '';

      setFiles((prev) =>
        prev.map((file) => (file.id === activeFileId ? { ...file, code: nextCode } : file)),
      );

      if (!socketRef.current || !roomId || !activeFileId) {
        return;
      }

      socketRef.current.emit('code-change', { roomId, fileId: activeFileId, code: nextCode });
    },
    [activeFileId, roomId],
  );

  const handleSendMessage = useCallback(() => {
    const trimmedMessage = messageText.trim();
    if (!trimmedMessage || !socketRef.current || !roomId) {
      return;
    }

    socketRef.current.emit('chat-message', { roomId, username, message: trimmedMessage });
    setMessageText('');
  }, [messageText, roomId, username]);

  const runCode = useCallback(async () => {
    if (!['javascript', 'typescript'].includes(language)) {
      setRunOutput({ error: 'Only JavaScript / TypeScript execution is supported in this prototype.' });
      return;
    }

    try {
      const response = await fetch(`${BACKEND_URL}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: activeFile?.code || '' }),
      });
      const text = await response.text();

      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = { error: 'Backend returned non-JSON response', details: text.slice(0, 1000) };
      }

      setRunOutput(data);
      addLog('Code executed');
    } catch (error) {
      setRunOutput({ error: error.message || 'Run failed' });
      addLog('Code execution failed');
    }
  }, [activeFile, addLog, language]);

  const saveSession = useCallback(async () => {
    const normalizedRoomId = roomId.trim();
    if (!normalizedRoomId || files.length === 0) {
      setSaveStatus('Room ID and files are required');
      addLog('Cannot save without a room and files');
      return;
    }

    try {
      const response = await fetch(`${BACKEND_URL}/save-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId: normalizedRoomId, files, messages }),
      });
      const data = await response.json();
      const didSave = response.ok && data.status === 'ok';

      setSaveStatus(didSave ? 'Session saved' : 'Save failed');
      addLog(didSave ? 'Session saved' : 'Session save failed');
    } catch (error) {
      console.warn('save session failed', error);
      setSaveStatus('Save failed');
      addLog('Session save failed');
    }
  }, [addLog, files, messages, roomId]);

  const loadSavedSession = useCallback(async () => {
    const normalizedRoomId = roomId.trim();
    if (!normalizedRoomId) {
      addLog('Enter a room ID before loading a session');
      return;
    }

    try {
      const response = await fetch(`${BACKEND_URL}/session/${normalizedRoomId}`);
      if (!response.ok) {
        addLog('No saved session');
        return;
      }

      const data = await response.json();
      if (Array.isArray(data.files) && data.files.length > 0) {
        setFiles(data.files);
        setActiveFileId(data.files[0].id);
        setLanguage(getLanguageFromFileName(data.files[0].name));
      }
      setMessages(Array.isArray(data.messages) ? data.messages : []);
      setLoadedSession(true);
      addLog('Loaded saved session');
    } catch (error) {
      console.warn('load session failed', error);
      addLog('Load session failed');
    }
  }, [addLog, roomId]);

  const downloadCode = useCallback(() => {
    const fileToDownload = activeFile || files[0];
    if (!fileToDownload) {
      addLog('No file available to download');
      return;
    }

    const blob = new Blob([fileToDownload.code], { type: 'text/plain;charset=utf-8' });
    const link = document.createElement('a');
    link.download = getDownloadName(fileToDownload.name, language);
    link.href = URL.createObjectURL(blob);
    link.click();
    URL.revokeObjectURL(link.href);
    addLog('Code downloaded');
  }, [activeFile, addLog, files, language]);

  useEffect(() => {
    const onKeydown = (event) => {
      const isControl = event.ctrlKey || event.metaKey;
      if (!isControl) {
        return;
      }

      switch (event.key.toLowerCase()) {
        case 'r':
          event.preventDefault();
          void runCode();
          addLog('Shortcut: Run Code (Ctrl+R)');
          break;
        case 's':
          event.preventDefault();
          void saveSession();
          addLog('Shortcut: Save Session (Ctrl+S)');
          break;
        case 'l':
          event.preventDefault();
          void loadSavedSession();
          addLog('Shortcut: Load Session (Ctrl+L)');
          break;
        case 'd':
          event.preventDefault();
          downloadCode();
          addLog('Shortcut: Download Code (Ctrl+D)');
          break;
        case 'k':
          event.preventDefault();
          void copyRoomLink();
          addLog('Shortcut: Copy Room Link (Ctrl+K)');
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', onKeydown);
    return () => window.removeEventListener('keydown', onKeydown);
  }, [addLog, copyRoomLink, downloadCode, loadSavedSession, runCode, saveSession]);

  const uploadCode = useCallback(
    (event) => {
      const [fileData] = event.target.files || [];
      if (!fileData) {
        return;
      }

      const reader = new FileReader();
      reader.onload = (loadEvent) => {
        const code = typeof loadEvent.target?.result === 'string' ? loadEvent.target.result : '';
        const newFile = { id: uuidv4(), name: fileData.name, code };
        setFiles((prev) => [...prev, newFile]);
        setActiveFileId(newFile.id);
        setLanguage(getLanguageFromFileName(newFile.name));
        addLog(`Loaded file ${fileData.name}`);
      };
      reader.readAsText(fileData);
      event.target.value = '';
    },
    [addLog],
  );

  const handleAddFile = useCallback(() => {
    const extensionMap = {
      javascript: 'js',
      typescript: 'ts',
      python: 'py',
      json: 'json',
    };
    const nextExtension = extensionMap[language] || 'txt';
    const newFile = {
      id: uuidv4(),
      name: `file-${files.length + 1}.${nextExtension}`,
      code: '// new file\n',
    };

    setFiles((prev) => [...prev, newFile]);
    setActiveFileId(newFile.id);
    setLanguage(getLanguageFromFileName(newFile.name));
    addLog(`Created new file ${newFile.name}`);
  }, [addLog, files.length, language]);

  const handleRemoveFile = useCallback(
    (id) => {
      if (files.length === 1) {
        addLog('Cannot delete the last file');
        return;
      }

      const remainingFiles = files.filter((file) => file.id !== id);
      setFiles(remainingFiles);

      if (activeFileId === id && remainingFiles[0]) {
        setActiveFileId(remainingFiles[0].id);
        setLanguage(getLanguageFromFileName(remainingFiles[0].name));
      }

      addLog('Removed file');
    },
    [activeFileId, addLog, files],
  );

  const handleFileTabClick = useCallback(
    (file) => {
      setActiveFileId(file.id);
      setLanguage(getLanguageFromFileName(file.name));
    },
    [],
  );

  const handleEditorMount = useCallback((editor) => {
    editorRef.current = editor;
    editor.onDidChangeCursorPosition((event) => {
      if (!socketRef.current || !roomId) {
        return;
      }

      const position = event.position;
      const range = {
        startLineNumber: position.lineNumber,
        startColumn: position.column,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      };

      socketRef.current.emit('cursor-change', {
        roomId,
        socketId: socketRef.current.id,
        range,
      });
    });
  }, [roomId]);

  if (!joined) {
    return (
      <div className="page-shell">
        <div className="join-page">
          <h1>Realtime Collaborative Code Editor</h1>
          <div className="join-controls">
            <button onClick={handleCreateRoom}>Create Room</button>
            <input value={roomId} onChange={(event) => setRoomId(event.target.value)} placeholder="Room ID" />
            <input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Your name" />
            <button onClick={handleJoinRoom}>Join Room</button>
          </div>
          <p>Room Link: {roomId ? <code>{roomUrl}</code> : <i>Create or paste an existing room ID</i>}</p>
          <div className="shortcut-hint">Shortcuts: Ctrl+R Run | Ctrl+S Save | Ctrl+L Load | Ctrl+D Download | Ctrl+K Copy room link</div>
          <div className="log-area">{logs.map((line, index) => <div key={index}>{line}</div>)}</div>
        </div>
      </div>
    );
  }

  return (
    <div className={`app ${theme === 'vs-dark' ? 'dark' : 'light'}`}>
      <header>
        <div>
          <div style={{ fontWeight: 700, fontSize: '1.2rem' }}>Room: {roomId}</div>
          <div className="room-stats">
            Active Rooms: {roomStats.activeRooms} | Active Users: {roomStats.activeUsers} | Saved Sessions: {roomStats.savedSessions}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className={`status-pill ${status === 'Connected' ? 'green' : 'red'}`}>{status}</span>
        </div>
      </header>

      <div className="file-tabs">
        {files.map((file) => (
          <div key={file.id} className={`tab-item ${file.id === activeFileId ? 'active' : ''}`} onClick={() => handleFileTabClick(file)}>
            {file.name}
            <button className="tab-close" onClick={(event) => { event.stopPropagation(); handleRemoveFile(file.id); }}>
              x
            </button>
          </div>
        ))}
        <button className="add-file" onClick={handleAddFile}>+ New File</button>
      </div>

      <p className="temporary-hint">Active file: {activeFile?.name} | Language: {language}</p>

      <div className="actions">
        <select value={language} onChange={(event) => setLanguage(event.target.value)}>
          <option value="javascript">JavaScript</option>
          <option value="typescript">TypeScript</option>
          <option value="python">Python (preview)</option>
          <option value="json">JSON</option>
        </select>
        <button onClick={() => setTheme((currentTheme) => (currentTheme === 'vs-dark' ? 'light' : 'vs-dark'))}>
          {theme === 'vs-dark' ? 'Light Mode' : 'Dark Mode'}
        </button>
        <button onClick={() => void copyRoomLink()}>Copy Room Link</button>
        <button onClick={() => void runCode()}>Run Code</button>
        <button onClick={() => void saveSession()}>Save Session</button>
        <button onClick={() => void loadSavedSession()}>Load Session</button>
        <button onClick={downloadCode}>Download</button>
        <label className="upload-button">
          Upload
          <input type="file" accept=".js,.jsx,.ts,.tsx,.py,.json,.txt" onChange={uploadCode} hidden />
        </label>
      </div>

      <div className="main-grid">
        <section className="editor-pane">
          <Editor
            height="80vh"
            theme={theme}
            language={language}
            value={activeFile?.code || ''}
            onChange={onCodeChange}
            onMount={handleEditorMount}
            options={{
              minimap: { enabled: true },
              fontSize: 14,
              tabSize: 2,
              renderWhitespace: 'all',
              automaticLayout: true,
              formatOnType: true,
              formatOnPaste: true,
              codeLens: true,
              lineNumbers: 'on',
              scrollBeyondLastLine: false,
              rulers: [80, 120],
            }}
          />
        </section>

        <aside className="sidebar">
          <div className="sidebar-section">
            <h3>Users</h3>
            <ul>
              {users.map((user) => (
                <li key={user.socketId}>
                  <span className="user-badge" style={{ backgroundColor: user.color }}></span>
                  {user.username}
                </li>
              ))}
            </ul>
          </div>
          <div className="sidebar-section">
            <h3>Chat</h3>
            <div className="chat-log">
              {messages.map((message, index) => (
                <div key={index}>
                  <strong>{message.username}:</strong> {message.message}
                </div>
              ))}
            </div>
            <div className="chat-input">
              <input
                value={messageText}
                onChange={(event) => setMessageText(event.target.value)}
                placeholder="Message..."
                onKeyDown={(event) => event.key === 'Enter' && handleSendMessage()}
              />
              <button onClick={handleSendMessage}>Send</button>
            </div>
          </div>
        </aside>
      </div>

      <section className="result-pane">
        <h3>Execution Output</h3>
        <div className="output-box">
          {runOutput ? (
            runOutput.error ? (
              <div style={{ color: 'tomato' }}>Error: {runOutput.error}</div>
            ) : (
              <div>
                <div><strong>Result:</strong> {String(runOutput.result)}</div>
                <div><strong>Logs:</strong></div>
                <pre>{(runOutput.output || []).join('\n')}</pre>
              </div>
            )
          ) : (
            <div>No output yet</div>
          )}
        </div>
        <div className="save-status">{saveStatus}</div>
        {loadedSession && <div className="loaded-note">Loaded saved session data</div>}
      </section>
    </div>
  );
}

export default App;
