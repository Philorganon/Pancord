
            // ─── Discord CSS Variables for autocomplete ───
            const DISCORD_CSS_VARS = [
                '--background-primary', '--background-secondary', '--background-tertiary',
                '--background-accent', '--background-floating',
                '--background-modifier-hover', '--background-modifier-active', '--background-modifier-selected',
                '--text-normal', '--text-muted', '--text-link',
                '--header-primary', '--header-secondary',
                '--interactive-normal', '--interactive-hover', '--interactive-active', '--interactive-muted',
                'brand', 'brand-experiment', 'brand-experiment-100a',
                'input-background', 'channeltextarea-background',
                'scrollbar-auto-thumb', 'scrollbar-auto-track', 'scrollbar-thin-thumb', 'scrollbar-thin-track',
                'green-360', 'yellow-360', 'red-400', 'blurple',
                'deprecated-panel-background', 'card-primary-bg', 'card-secondary-bg',
                'modal-background', 'modal-footer-background',
                'toast-background', 'toast-header', 'toast-contents',
                'tooltip-background', 'tooltip-text',
                'mention-background', 'mention-foreground',
                'button-secondary-background', 'button-secondary-hover',
                'popout-header', 'popout-header-primary'
            ];

            let editor;
            let isSaving = false;
            let saveTimeout = null;

            // ─── Toast system ───
            function showToast(message, type = 'info') {
                const container = document.getElementById('toastContainer');
                const toast = document.createElement('div');
                toast.className = `toast toast-${type}`;

                const icons = {
                    success: '<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>',
                    error: '<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
                    info: '<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
                };

                toast.innerHTML = `${icons[type] || icons.info}<span>${message}</span>`;
                container.appendChild(toast);

                // Remove after animation completes
                setTimeout(() => {
                    if (toast.parentNode) {
                        toast.remove();
                    }
                }, 3000);
            }

            // ─── Connection badge ───
            function updateConnectionStatus(status) {
                const badge = document.getElementById('connectionBadge');
                const label = document.getElementById('connectionLabel');
                badge.classList.remove('connected', 'disconnected', 'connecting');
                badge.classList.add(status);
                const labels = { connected: 'Connected', disconnected: 'Disconnected', connecting: 'Connecting' };
                label.textContent = labels[status] || status;
            }

            // ─── WebSocket ───
            const WS_URL = 'ws://localhost:8765';
            let ws = null;
            let reconnectTimer = null;
            let reconnectDelay = 1500;
            const maxReconnectDelay = 15000;

            function connectWebSocket() {
                if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
                    return;
                }

                updateConnectionStatus('connecting');

                try {
                    ws = new WebSocket(WS_URL);
                } catch (e) {
                    updateConnectionStatus('disconnected');
                    scheduleReconnect();
                    return;
                }

                ws.onopen = () => {
                    updateConnectionStatus('connected');
                    reconnectDelay = 1500;
                    console.log('%c🔗 WebSocket connected', 'color: #3ba55c;');
                };

                ws.onclose = (event) => {
                    updateConnectionStatus('disconnected');
                    console.log('%c🔌 WebSocket closed', 'color: #ed4245;', event.code, event.reason);
                    scheduleReconnect();
                };

                ws.onerror = (error) => {
                    console.log('%c⚠️ WebSocket error', 'color: #faa61a;', error);
                };

                ws.onmessage = (event) => {
                    try {
                        const msg = JSON.parse(event.data);
                        if (msg.type === 'SAVED') {
                            showToast('CSS saved successfully!', 'success');
                        } else if (msg.type === 'ERROR') {
                            showToast(msg.message || 'Save failed', 'error');
                        }
                    } catch (e) {
                        // Ignore non-JSON messages
                    }
                };
            }

            function scheduleReconnect() {
                if (reconnectTimer) clearTimeout(reconnectTimer);
                reconnectTimer = setTimeout(() => {
                    reconnectDelay = Math.min(reconnectDelay * 1.6, maxReconnectDelay);
                    console.log(`%c🔄 Reconnecting in ${(reconnectDelay / 1000).toFixed(1)}s...`, 'color: #faa61a;');
                    connectWebSocket();
                }, reconnectDelay);
            }

            // ─── Monaco Editor ───
            require.config({
                paths: { 'vs': 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.34.1/min/vs' }
            });

            // Define custom dark theme
            require(['vs/editor/editor.main'], function() {
                monaco.editor.defineTheme('discord-dark', {
                    base: 'vs-dark',
                    inherit: true,
                    rules: [
                        { token: 'comment', foreground: '5f6368', fontStyle: 'italic' },
                        { token: 'variable', foreground: '7289da' },
                        { token: 'string', foreground: '3ba55c' },
                        { token: 'number', foreground: 'faa61a' },
                        { token: 'keyword', foreground: 'ed4245' },
                        { token: 'delimiter', foreground: '9aa0a6' },
                        { token: 'tag', foreground: '7289da' },
                        { token: 'attribute.name', foreground: 'faa61a' },
                        { token: 'attribute.value', foreground: '3ba55c' },
                    ],
                    colors: {
                        'editor.background': '#0b0d11',
                        'editor.foreground': '#e8eaed',
                        'editor.lineHighlightBackground': '#161b2530',
                        'editor.selectionBackground': '#7289da30',
                        'editor.inactiveSelectionBackground': '#7289da18',
                        'editorCursor.foreground': '#7289da',
                        'editorLineNumber.foreground': '#3a3e45',
                        'editorLineNumber.activeForeground': '#9aa0a6',
                        'editor.selectionHighlightBackground': '#7289da15',
                        'editorBracketMatch.background': '#7289da20',
                        'editorBracketMatch.border': '#7289da40',
                        'editorGutter.background': '#0b0d11',
                        'editorWidget.background': '#11151c',
                        'editorWidget.border': '#1a1f2b',
                    }
                });

                // Fetch CSS and init editor
                fetch('/api/css')
                    .then(res => {
                        if (!res.ok) throw new Error(`HTTP ${res.status}`);
                        return res.json();
                    })
                    .then(data => {
                        editor = monaco.editor.create(document.getElementById('container'), {
                            value: data.css || '/* 🎨 Write your Discord CSS here */\n',
                            language: 'css',
                            theme: 'discord-dark',
                            automaticLayout: true,
                            fontSize: 13.5,
                            fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
                            fontLigatures: true,
                            lineHeight: 1.7,
                            padding: { top: 20, bottom: 20 },
                            scrollBeyondLastLine: false,
                            wordWrap: 'on',
                            smoothScrolling: true,
                            cursorBlinking: 'smooth',
                            cursorSmoothCaretAnimation: 'on',
                            bracketPairColorization: { enabled: true },
                            guides: { indentation: true, bracketPairs: true },
                            minimap: {
                                enabled: true,
                                scale: 1,
                                showSlider: 'mouseover',
                                renderCharacters: false,
                                maxColumn: 80,
                            },
                            suggest: {
                                showWords: true,
                                showSnippets: true,
                                showClasses: true,
                                showColors: true,
                                showFunctions: true,
                            },
                            tabSize: 4,
                            insertSpaces: true,
                            detectIndentation: false,
                            renderWhitespace: 'selection',
                            overviewRulerBorder: false,
                            hideCursorInOverviewRuler: true,
                            contextmenu: true,
                            mouseWheelZoom: true,
                        });

                        // Ctrl+S shortcut
                        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, save);

                        // Autocomplete for Discord CSS variables
                        monaco.languages.registerCompletionItemProvider('css', {
                            triggerCharacters: ['-'],
                            provideCompletionItems: function(model, position) {
                                const textUntilPos = model.getValueInRange({
                                    startLineNumber: 1,
                                    startColumn: 1,
                                    endLineNumber: position.lineNumber,
                                    endColumn: position.column
                                });
                                const match = textUntilPos.match(/--([a-zA-Z0-9-]*)$/);
                                if (!match) { return { suggestions: [] }; }
                                const query = match[1].toLowerCase();
                                const suggestions = DISCORD_CSS_VARS
                                    .filter(function(v) { return v.toLowerCase().indexOf(query) !== -1; })
                                    .map(function(v) {
                                        return {
                                            label: v,
                                            kind: monaco.languages.CompletionItemKind.Variable,
                                            insertText: v,
                                            detail: 'Discord CSS Variable',
                                            sortText: '0' + v,
                                        };
                                    });
                                return { suggestions: suggestions };
                            }
                        });

                        console.log('%c✅ Editor initialized', 'color: #3ba55c;');
                    })
                    .catch(err => {
                        console.error('Failed to load CSS:', err);
                        // Still create editor with fallback content
                        editor = monaco.editor.create(document.getElementById('container'), {
                            value: '/* ⚠️ Could not load CSS from server */\n/* Error: ' + err
                                .message + ' */\n',
                            language: 'css',
                            theme: 'discord-dark',
                            automaticLayout: true,
                            fontSize: 13.5,
                            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                            fontLigatures: true,
                            lineHeight: 1.7,
                            padding: { top: 20, bottom: 20 },
                            scrollBeyondLastLine: false,
                            wordWrap: 'on',
                            smoothScrolling: true,
                            cursorBlinking: 'smooth',
                            minimap: { enabled: true, scale: 1, showSlider: 'mouseover',
                                renderCharacters: false, maxColumn: 80 },
                        });
                        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, save);
                        showToast('Failed to load CSS from server', 'error');
                    });
            });

            // ─── Save function ───
            function save() {
                if (!editor) {
                    showToast('Editor not initialized yet', 'error');
                    return;
                }
                if (isSaving) return;

                isSaving = true;
                const css = editor.getValue();
                const btn = document.getElementById('saveBtn');

                // Visual feedback
                btn.classList.add('saved');
                const originalHTML = btn.innerHTML;
                btn.innerHTML = `
                <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <polyline points="20 6 9 17 4 12"/>
                </svg>
                Saved!
            `;

                // Send via WebSocket
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'SAVE', css }));
                    console.log('%c📤 CSS sent via WebSocket', 'color: #7289da;');
                    showToast('CSS saved successfully!', 'success');
                } else {
                    // Fallback: try HTTP POST
                    fetch('/api/css', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ css })
                        })
                        .then(res => {
                            if (!res.ok) throw new Error(`HTTP ${res.status}`);
                            return res.json();
                        })
                        .then(() => {
                            showToast('CSS saved successfully!', 'success');
                        })
                        .catch(err => {
                            showToast('Save failed: ' + err.message, 'error');
                        });
                }

                // Reset button after delay
                if (saveTimeout) clearTimeout(saveTimeout);
                saveTimeout = setTimeout(() => {
                    btn.classList.remove('saved');
                    btn.innerHTML = originalHTML;
                    isSaving = false;
                }, 1500);
            }

            // ─── Keyboard shortcut hint ───
            document.addEventListener('keydown', function(e) {
                if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                    e.preventDefault();
                    save();
                }
            });

            // ─── Init WebSocket ───
            connectWebSocket();

            // ─── Handle page unload ───
            window.addEventListener('beforeunload', () => {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.close(1000, 'Page unload');
                }
                if (reconnectTimer) clearTimeout(reconnectTimer);
                if (saveTimeout) clearTimeout(saveTimeout);
            });

console.log('%c🚀 Pancord ready', 'color: #7289da; font-weight: bold;');
console.log('%c   WebSocket: ws://localhost:8765', 'color: #9aa0a6;');
console.log('%c   Editor: Monaco 0.34.1', 'color: #9aa0a6;');