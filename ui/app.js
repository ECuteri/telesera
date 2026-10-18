(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var token = new URLSearchParams(location.hash.slice(1)).get('token');
  if (token) { sessionStorage.setItem('telesera-token', token); history.replaceState(null, '', location.pathname + location.search); }
  token = token || sessionStorage.getItem('telesera-token') || '';
  var state = { chats: [], chat: null, archived: false, messages: [], hasMore: false, authStep: 'phone', loading: false, videoKey: '', returnFocus: null, miniOrigin: '', miniBack: false, lastActivity: Date.now(), lastProgress: 0, lastTime: 0 };
  var toastTimer, chatRequest = 0, lastChatsPayload = null;
  var miniTheme = { bg_color: '#172238', text_color: '#e7edf8', hint_color: '#a0aec5', link_color: '#aac8ff', button_color: '#6389db', button_text_color: '#ffffff', secondary_bg_color: '#1b2941' };
  function normalize(value) { return String(value || '').normalize('NFKC'); }
  function el(tag, className, text) { var node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
  function show(node, visible) { node.hidden = !visible; }
  function toast(message) { $('toast').textContent = message; show($('toast'), true); clearTimeout(toastTimer); toastTimer = setTimeout(function () { show($('toast'), false); }, 6000); }
  async function api(path, data) {
    var controller = new AbortController();
    var options = { headers: { Authorization: 'Bearer ' + token }, cache: 'no-store', signal: controller.signal };
    if (data !== undefined) { options.method = 'POST'; options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(data); }
    var timeout = setTimeout(function () { controller.abort(); }, 25000);
    var response;
    try {
      response = await fetch('/api' + path, options);
      var body;
      try { body = await response.json(); } catch (error) { if (controller.signal.aborted) throw error; throw new Error('Il servizio non è ancora pronto. Riprova tra un momento.'); }
      if (!response.ok) throw new Error(body.error || 'Operazione non riuscita. Riprova.');
      return body;
    } catch (error) {
      if (controller.signal.aborted) throw new Error('La risposta sta impiegando troppo tempo. Controlla la connessione e riprova.');
      if (!response) throw new Error('La connessione si è interrotta. Riprova tra un momento.');
      throw error;
    } finally { clearTimeout(timeout); }
  }
  function resource(path) { return '/api' + path + '?token=' + encodeURIComponent(token); }
  function chatPath(chat) { return '/chats/' + encodeURIComponent(chat.id); }
  function mediaPath(chat, message) { return chatPath(chat) + '/messages/' + message.id; }
  function initials(name) { return normalize(name).trim().split(/\s+/).slice(0, 2).map(function (part) { return Array.from(part)[0] || ''; }).join('').toUpperCase() || '·'; }
  function avatar(chat, small) {
    var node = el('span', 'avatar' + (small ? ' small' : ''), initials(chat.title));
    var hash = 0; for (var i = 0; i < chat.title.length; i++) hash = ((hash << 5) - hash + chat.title.charCodeAt(i)) | 0;
    var hue = Math.abs(hash) % 80 + 190; node.style.backgroundColor = 'hsl(' + hue + ',55%,90%)'; node.style.color = 'hsl(' + hue + ',35%,40%)';
    if (chat.photo) { var img = el('img'); img.alt = ''; img.src = resource(chatPath(chat) + '/photo'); img.addEventListener('error', function () { img.remove(); }); node.appendChild(img); node.firstChild.nodeValue = ''; img.addEventListener('error', function () { node.textContent = initials(chat.title); }); }
    return node;
  }
  function time(date) { return new Date(date).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }); }
  function duration(seconds) { var value = Math.max(0, Math.floor(Number(seconds) || 0)); return (value >= 3600 ? Math.floor(value / 3600) + ':' : '') + (value >= 3600 ? String(Math.floor(value % 3600 / 60)).padStart(2, '0') : Math.floor(value / 60)) + ':' + String(value % 60).padStart(2, '0'); }
  function rememberFocus(container) { var active = document.activeElement; return active && container.contains(active) ? active.dataset.focusKey : null; }
  function restoreFocus(container, key) { if (!key) return; var nodes = container.querySelectorAll('[data-focus-key]'); for (var i = 0; i < nodes.length; i++) if (nodes[i].dataset.focusKey === key) { nodes[i].focus({ preventScroll: true }); break; } }
  function setFocus(node) { if (node && !node.hidden) node.focus(); }
  async function connect() {
    show($('retry-connection'), false); $('connection-message').textContent = 'Connessione al tuo account…';
    try {
      if (!token) throw new Error('Apri Telesera dall’app del televisore per connetterti al tuo account.');
      var status = await api('/status');
      if (status.authorized) { show($('connection'), false); show($('login'), false); show($('app'), true); $('account-name').textContent = normalize(status.user && status.user.name || 'Il tuo account'); $('account-avatar').textContent = initials($('account-name').textContent); await loadChats(); setFocus($('search')); }
      else { show($('connection'), false); show($('login'), true); renderLogin(); }
    } catch (error) { $('connection-message').textContent = error.message; show($('retry-connection'), true); }
  }
  function renderLogin() {
    var step = state.authStep, input = $('login-input'); input.value = ''; show($('login-error'), false);
    $('login-label').textContent = step === 'phone' ? 'Numero di telefono' : step === 'code' ? 'Codice di accesso' : 'Password di verifica in due passaggi';
    input.type = step === 'phone' ? 'tel' : step === 'password' ? 'password' : 'text'; input.inputMode = step === 'password' ? 'text' : 'numeric'; input.autocomplete = step === 'phone' ? 'tel' : step === 'code' ? 'one-time-code' : 'current-password'; input.placeholder = step === 'phone' ? '+39 333 1234567' : step === 'code' ? 'Codice Telegram' : 'La tua password';
    $('login-help').textContent = step === 'phone' ? 'Inserisci il numero associato al tuo account Telegram, con prefisso internazionale.' : step === 'code' ? 'Inserisci il codice ricevuto nell’app Telegram o via SMS.' : 'Il tuo account è protetto da una password aggiuntiva.';
    $('login-next').textContent = step === 'phone' ? 'Continua' : 'Accedi'; show($('login-back'), step !== 'phone'); input.focus();
  }
  async function login() {
    var value = $('login-input').value.trim(); if (!value) { $('login-input').focus(); return; }
    var key = state.authStep, payload = {}; payload[key] = key === 'password' ? $('login-input').value : value;
    $('login-next').disabled = true; show($('login-error'), false);
    try { var result = await api('/auth/' + key, payload); $('login-input').value = ''; if (result.step === 'ready') await connect(); else { state.authStep = result.step; renderLogin(); } }
    catch (error) { $('login-error').textContent = error.message; show($('login-error'), true); }
    finally { $('login-next').disabled = false; }
  }
  function renderChats() {
    var container = $('chat-list'), focus = rememberFocus(container), scroll = container.scrollTop, query = normalize($('search').value).toLocaleLowerCase('it');
    container.textContent = ''; $('archive-count').textContent = state.chats.filter(function (chat) { return chat.archived; }).length || '';
    var chats = state.chats.filter(function (chat) { return Boolean(chat.archived) === state.archived && normalize(chat.title).toLocaleLowerCase('it').includes(query); });
    chats.forEach(function (chat) {
      var row = el('button', 'chat-row' + (state.chat && state.chat.id === chat.id ? ' selected' : '')); row.dataset.focusKey = 'chat-' + chat.id; row.setAttribute('aria-label', normalize(chat.title) + (chat.unread ? ', ' + chat.unread + ' messaggi non letti' : '')); row.setAttribute('aria-current', state.chat && state.chat.id === chat.id ? 'true' : 'false'); row.appendChild(avatar(chat));
      var content = el('span', 'chat-row-content'); content.appendChild(el('span', 'chat-row-title', normalize(chat.title))); content.appendChild(el('span', 'chat-preview', normalize(chat.last_text || ({ bot: 'Bot', channel: 'Canale', group: 'Gruppo', saved: 'Messaggi salvati' }[chat.kind] || 'Apri conversazione')))); row.appendChild(content); if (chat.unread) row.appendChild(el('span', 'unread', chat.unread > 99 ? '99+' : chat.unread)); row.addEventListener('click', function () { openChat(chat); }); container.appendChild(row);
    });
    if (!chats.length) container.appendChild(el('p', 'list-empty', query ? 'Nessuna chat trovata.' : state.archived ? 'Nessuna chat archiviata.' : 'Le tue chat appariranno qui.'));
    container.scrollTop = scroll; restoreFocus(container, focus);
  }
  async function loadChats() { try { var result = await api('/chats'), payload = JSON.stringify(result.chats); if (payload !== lastChatsPayload) { state.chats = result.chats; lastChatsPayload = payload; renderChats(); } } catch (error) { if (!state.chats.length) { lastChatsPayload = null; $('chat-list').textContent = ''; $('chat-list').appendChild(el('p', 'list-empty', error.message)); var retry = el('button', 'pill load-older', 'Riprova'); retry.onclick = loadChats; $('chat-list').appendChild(retry); } else toast(error.message); } }
  function selectArchive(archived) { state.archived = archived; $('inbox-tab').classList.toggle('selected', !archived); $('archive-tab').classList.toggle('selected', archived); $('inbox-tab').setAttribute('aria-pressed', String(!archived)); $('archive-tab').setAttribute('aria-pressed', String(archived)); renderChats(); }
  async function openChat(chat) {
    state.chat = chat; state.messages = []; state.hasMore = false; chatRequest++; state.loading = false;
    $('app').classList.add('chat-open'); show($('welcome'), false); show($('conversation-head'), true); show($('message-list'), true); show($('composer'), true); show($('chat-error'), false); $('message-list').textContent = ''; $('message-list').appendChild(el('p', 'list-empty', 'Caricamento…')); $('chat-title').textContent = normalize(chat.title); $('chat-kind').textContent = { bot: 'Bot', user: 'Conversazione', group: 'Gruppo', channel: 'Canale', saved: 'Messaggi salvati' }[chat.kind] || 'Conversazione'; $('chat-avatar').textContent = ''; $('chat-avatar').appendChild(avatar(chat)); show($('bot-app'), chat.kind === 'bot' && Boolean(chat.username)); $('message-input').value = ''; renderChats(); await loadMessages(false, true);
    if (state.chat && state.chat.id === chat.id) { var first = $('message-list').querySelector('button,a'); setFocus(first || $('message-input')); }
  }
  function appendText(node, text) {
    var parts = String(text).split(/(https?:\/\/[^\s<>]+)/g); parts.forEach(function (part) { if (!/^https?:\/\//.test(part)) { node.appendChild(document.createTextNode(part)); return; } var link = el('a', '', part); link.href = part; link.rel = 'noopener noreferrer'; link.target = '_blank'; link.addEventListener('click', function (event) { event.preventDefault(); openLink(part); }); node.appendChild(link); });
  }
  function messageNode(message, chat) {
    var article = el('article', 'message' + (message.outgoing ? ' outgoing' : '')); article.dataset.messageId = message.id;
    if (message.media) {
      var media = message.media;
      if (media.kind === 'video') { var card = el('button', 'video-card'); card.dataset.focusKey = 'video-' + message.id; card.setAttribute('aria-label', 'Riproduci ' + (media.name || 'video')); var poster = el('img'); poster.alt = ''; poster.loading = 'lazy'; poster.src = resource(mediaPath(chat, message) + '/thumbnail'); poster.onerror = function () { poster.remove(); }; card.appendChild(poster); card.appendChild(el('span', 'video-play', '▶')); card.appendChild(el('span', 'video-label', (media.name || 'Video') + (media.duration ? ' · ' + duration(media.duration) : ''))); card.onclick = function () { openVideo(message, chat); }; article.appendChild(card); }
      else if (media.kind === 'photo') { var photo = el('img', 'media-photo'); photo.alt = message.text || 'Foto'; photo.loading = 'lazy'; photo.src = resource(mediaPath(chat, message) + '/media'); photo.onerror = function () { photo.replaceWith(el('p', 'error-text', 'Impossibile caricare la foto. Riapri la chat per riprovare.')); }; article.appendChild(photo); }
      else { var doc = el('a', 'document-link', '↓ ' + (media.name || 'Documento')); doc.href = resource(mediaPath(chat, message) + '/media'); doc.download = media.name || 'documento'; doc.dataset.focusKey = 'doc-' + message.id; article.appendChild(doc); }
    }
    if (message.text) { var textNode = el('div', 'message-text'); appendText(textNode, message.text); article.appendChild(textNode); }
    if (message.buttons && message.buttons.length) {
      var buttons = el('div', 'bot-buttons'); message.buttons.forEach(function (row, rowIndex) { var rowNode = el('div', 'bot-row'); row.forEach(function (button, colIndex) { var node = el('button', '', normalize(button.text)); node.dataset.focusKey = 'button-' + message.id + '-' + rowIndex + '-' + colIndex; node.disabled = button.kind === 'unsupported'; if (node.disabled) node.title = 'Questa azione non è disponibile sul televisore'; node.onclick = function () { pressBotButton(message, chat, button, rowIndex, colIndex, node); }; rowNode.appendChild(node); }); buttons.appendChild(rowNode); }); article.appendChild(buttons);
    }
    var stamp = el('div', 'message-time', time(message.date)); article.appendChild(stamp); if (!article.querySelector('button,a')) { article.tabIndex = 0; article.dataset.focusKey = 'message-' + message.id; } return article;
  }
  function renderMessages(forceBottom) {
    var container = $('message-list'), focus = rememberFocus(container), oldHeight = container.scrollHeight, oldTop = container.scrollTop, nearBottom = oldHeight - oldTop - container.clientHeight < 90;
    var previousNodes = {}; Array.prototype.forEach.call(container.querySelectorAll('article[data-message-id]'), function (node) { previousNodes[node.dataset.messageId] = node; });
    var fragment = document.createDocumentFragment(); if (state.hasMore) { var older = el('button', 'pill load-older', 'Messaggi precedenti'); older.dataset.focusKey = 'older'; older.onclick = function () { loadMessages(true); }; fragment.appendChild(older); }
    var lastDay = ''; state.messages.forEach(function (message) { var day = new Date(message.date).toLocaleDateString('it-IT', { day: 'numeric', month: 'long' }); if (day !== lastDay) { fragment.appendChild(el('div', 'day-label', day)); lastDay = day; } var signature = JSON.stringify(message), previous = previousNodes[message.id]; var node = previous && previous.dataset.signature === signature ? previous : messageNode(message, state.chat); node.dataset.signature = signature; fragment.appendChild(node); });
    if (!state.messages.length) fragment.appendChild(el('p', 'list-empty', 'Non ci sono ancora messaggi.'));
    container.textContent = ''; container.appendChild(fragment);
    if (forceBottom || nearBottom) container.scrollTop = container.scrollHeight; else container.scrollTop = oldTop;
    restoreFocus(container, focus);
  }
  async function loadMessages(older, forceBottom) {
    if (!state.chat || state.loading) return; state.loading = true; var chat = state.chat, request = chatRequest, before = older && state.messages.length ? state.messages[0].id : null;
    try {
      var result = await api(chatPath(chat) + '/messages' + (before ? '?before=' + before : '')); if (request !== chatRequest) return;
      var oldHeight = $('message-list').scrollHeight, oldTop = $('message-list').scrollTop, merged = {};
      state.messages.forEach(function (message) { merged[message.id] = message; }); result.messages.forEach(function (message) { merged[message.id] = message; });
      state.messages = Object.keys(merged).map(function (key) { return merged[key]; }).sort(function (a, b) { return a.id - b.id; });
      if (older || !before && state.messages.length <= result.messages.length) state.hasMore = result.has_more;
      renderMessages(forceBottom); if (older) $('message-list').scrollTop = oldTop + $('message-list').scrollHeight - oldHeight; show($('chat-error'), false);
    } catch (error) { if (request === chatRequest) { $('chat-error').querySelector('span').textContent = error.message; show($('chat-error'), true); } }
    finally { if (request === chatRequest) state.loading = false; }
  }
  async function send() {
    var text = $('message-input').value.trim(), chat = state.chat; if (!text || !chat) return;
    $('send-button').disabled = true;
    try { await api(chatPath(chat) + '/send', { text: text }); if (state.chat && state.chat.id === chat.id) { if ($('message-input').value.trim() === text) $('message-input').value = ''; await loadMessages(false, true); setFocus($('message-input')); } loadChats(); }
    catch (error) { toast(error.message); }
    finally { $('send-button').disabled = false; }
  }
  async function pressBotButton(message, chat, button, row, col, node) {
    node.disabled = true;
    try { var result = await api(mediaPath(chat, message) + '/button', { row: button.row === undefined ? row : button.row, col: button.col === undefined ? col : button.col }); if (result.message) toast(result.message); if (result.kind === 'miniapp' && result.url) openMiniapp(result.url); else if (result.url) openLink(result.url); if (state.chat && state.chat.id === chat.id) await loadMessages(); }
    catch (error) { toast(error.message); } finally { node.disabled = false; }
  }
  function safeHTTPS(url) { try { var parsed = new URL(url); return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? parsed : null; } catch (_) { return null; } }
  function openLink(url) { var parsed = safeHTTPS(url); if (!parsed) { toast('Questo collegamento non è supportato.'); return; } if (parsed.hostname === 't.me' || parsed.hostname === 'telegram.me') openTelegramLink(parsed); else window.open(parsed.href, '_blank', 'noopener,noreferrer'); }
  async function openTelegramLink(url) {
    var parts = url.pathname.replace(/\/$/, '').slice(1).split('/'), username = parts[0], start = url.searchParams.get('start');
    if (url.port || !/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(username) || parts.length > 2 || (start !== null && !/^[A-Za-z0-9_-]{0,64}$/.test(start))) { toast('Questo collegamento Telegram non è supportato.'); return; }
    if (url.searchParams.has('startapp') || (parts.length === 2 && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(parts[1]))) { if (start !== null) { toast('Questo collegamento Telegram non è supportato.'); return; } resolveMiniapp(url.href); return; }
    if (parts.length !== 1 || Array.from(url.searchParams.keys()).some(function (key) { return key !== 'start'; })) { toast('I collegamenti a messaggi e inviti Telegram non sono ancora supportati.'); return; }
    function hasDraft() { if (start !== null && $('message-input').value.trim()) { toast('Hai un messaggio in bozza. Invialo o cancellalo prima di richiedere il contenuto al bot.'); return true; } return false; }
    if (hasDraft()) return;
    try {
      var chat = state.chats.find(function (item) { return item.username && item.username.toLowerCase() === username.toLowerCase(); });
      if (!chat) chat = (await api('/chats/resolve?username=' + encodeURIComponent(username))).chat;
      if (!chat) { toast('Non è possibile aprire questa chat Telegram.'); return; }
      if (start !== null && chat.kind !== 'bot') { toast('Questo collegamento di avvio non identifica un bot.'); return; }
      if (hasDraft()) return;
      if (!$('miniapp').hidden) closeMiniapp();
      await openChat(chat);
      if (start !== null && state.chat && state.chat.id === chat.id && !hasDraft()) { $('message-input').value = '/start' + (start ? ' ' + start : ''); setFocus($('send-button')); toast('Premi Invia per richiedere il contenuto al bot.'); }
    } catch (error) { toast('Impossibile aprire la chat Telegram. ' + error.message); }
  }
  async function resolveMiniapp(url) { try { var result = await api('/miniapp', { url: url }); openMiniapp(result.url); } catch (error) { toast(error.message); } }
  function saveResume() { if (state.videoKey && Number.isFinite($('video').currentTime)) { try { localStorage.setItem('telesera-resume-' + state.videoKey, String($('video').ended ? 0 : $('video').currentTime)); } catch (_) {} } }
  function openVideo(message, chat) {
    state.returnFocus = document.activeElement; state.videoKey = chat.id + '-' + message.id; state.lastProgress = 0; state.lastTime = 0; show($('player'), true); show($('player-error'), false); $('player-title').textContent = message.media.name || 'Video'; $('video').src = resource(mediaPath(chat, message) + '/media'); $('video').load(); setFocus($('toggle-play')); var promise = $('video').play(); if (promise) promise.catch(function () { updatePlay(); });
  }
  function closeVideo() { saveResume(); $('video').pause(); $('video').removeAttribute('src'); $('video').load(); show($('player'), false); state.videoKey = ''; setFocus(state.returnFocus); }
  function updatePlay() { var paused = $('video').paused; $('toggle-play').textContent = paused ? '▶' : 'Ⅱ'; $('toggle-play').setAttribute('aria-label', paused ? 'Riproduci' : 'Pausa'); }
  function togglePlay() { if ($('video').paused) { var promise = $('video').play(); if (promise) promise.catch(function () { toast('Riproduzione non disponibile. Riprova.'); }); } else $('video').pause(); }
  function seek(seconds) { var video = $('video'); if (Number.isFinite(video.duration)) { video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + seconds)); saveResume(); } }
  function openMiniapp(url) {
    var parsed = safeHTTPS(url); if (!parsed) { toast('L’app non ha restituito un collegamento sicuro.'); return; }
    state.returnFocus = document.activeElement; state.miniOrigin = parsed.origin; state.miniBack = false; show($('miniapp-back'), false); show($('miniapp-footer'), false); show($('miniapp'), true); show($('miniapp-loading'), true); $('miniapp-title').textContent = state.chat ? normalize(state.chat.title) : 'Mini App'; $('miniapp-frame').src = parsed.href; setFocus($('miniapp-close'));
  }
  function closeMiniapp() { $('miniapp-frame').src = 'about:blank'; show($('miniapp'), false); state.miniOrigin = ''; state.lastActivity = Date.now(); setFocus(state.returnFocus); }
  function miniEvent(name, data) { if (state.miniOrigin) $('miniapp-frame').contentWindow.postMessage(JSON.stringify({ eventType: name, eventData: data || {} }), state.miniOrigin); }
  window.addEventListener('message', function (event) {
    if ($('miniapp').hidden || event.source !== $('miniapp-frame').contentWindow || event.origin !== state.miniOrigin) return;
    var data; try { data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data; } catch (_) { return; } if (!data || typeof data.eventType !== 'string') return;
    var detail = data.eventData || {};
    switch (data.eventType) {
      case 'web_app_ready': show($('miniapp-loading'), false); break;
      case 'web_app_close': closeMiniapp(); break;
      case 'web_app_open_tg_link': if (typeof detail.path_full !== 'string' || !/^\/(?!\/)/.test(detail.path_full) || /[\\\u0000-\u0020]/.test(detail.path_full)) { toast('Questo collegamento Telegram non è supportato.'); break; } openLink('https://t.me' + detail.path_full); break;
      case 'web_app_open_link': var link = safeHTTPS(detail.url); if (link && (link.hostname === 't.me' || link.hostname === 'telegram.me')) openTelegramLink(link); else toast('Il collegamento esterno non è stato aperto sulla TV.'); break;
      case 'web_app_expand': miniEvent('viewport_changed', { height: $('miniapp-frame').clientHeight, is_state_stable: true, is_expanded: true }); break;
      case 'web_app_request_viewport': miniEvent('viewport_changed', { height: $('miniapp-frame').clientHeight, is_state_stable: true, is_expanded: true }); break;
      case 'web_app_request_theme': miniEvent('theme_changed', { theme_params: miniTheme }); break;
      case 'web_app_setup_back_button': state.miniBack = Boolean(detail.is_visible); show($('miniapp-back'), state.miniBack); break;
      case 'web_app_setup_main_button': $('miniapp-main').textContent = String(detail.text || 'Continua').slice(0, 128); $('miniapp-main').disabled = detail.is_active === false; show($('miniapp-footer'), Boolean(detail.is_visible)); break;
      case 'web_app_request_fullscreen': miniEvent('fullscreen_changed', { is_fullscreen: true }); break;
      case 'web_app_exit_fullscreen': miniEvent('fullscreen_changed', { is_fullscreen: false }); break;
      case 'web_app_read_text_from_clipboard': miniEvent('clipboard_text_received', { req_id: detail.req_id }); break;
      case 'web_app_request_write_access': miniEvent('write_access_requested', { status: 'cancelled' }); break;
      case 'web_app_request_phone': miniEvent('phone_requested', { status: 'cancelled' }); break;
    }
  });
  function focusScope() { if (!$('about').hidden) return $('about'); if (!$('miniapp').hidden) return $('miniapp'); if (!$('player').hidden) return $('player'); if (!$('login').hidden) return $('login'); if (!$('connection').hidden) return $('connection'); return $('app'); }
  function visibleFocusable(scope) { return Array.prototype.filter.call(scope.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),a[href],iframe,[tabindex="0"]'), function (node) { var rect = node.getBoundingClientRect(); return rect.width > 0 && rect.height > 0 && !node.closest('[hidden]'); }); }
  function moveFocus(direction) {
    var nodes = visibleFocusable(focusScope()), current = document.activeElement;
    if (nodes.indexOf(current) < 0) { setFocus(nodes[0]); return; }
    var from = current.getBoundingClientRect(), fx = from.left + from.width / 2, fy = from.top + from.height / 2, candidate = null, best = Infinity;
    nodes.forEach(function (node) { if (node === current) return; var rect = node.getBoundingClientRect(), dx = rect.left + rect.width / 2 - fx, dy = rect.top + rect.height / 2 - fy; var primary = direction === 'ArrowRight' ? dx : direction === 'ArrowLeft' ? -dx : direction === 'ArrowDown' ? dy : -dy; if (primary <= 1) return; var cross = direction === 'ArrowLeft' || direction === 'ArrowRight' ? Math.abs(dy) : Math.abs(dx); var overlaps = direction === 'ArrowLeft' || direction === 'ArrowRight' ? rect.bottom > from.top && rect.top < from.bottom : rect.right > from.left && rect.left < from.right; var score = primary + cross * (overlaps ? 0.3 : 3) + (overlaps ? 0 : 100); if (score < best) { best = score; candidate = node; } });
    if (candidate) { candidate.focus({ preventScroll: true }); candidate.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
  }
  function back() {
    if (!$('about').hidden) { show($('about'), false); setFocus($('about-button')); }
    else if (!$('miniapp').hidden) { if (state.miniBack) miniEvent('back_button_pressed'); else closeMiniapp(); }
    else if (!$('player').hidden) closeVideo();
    else if (document.activeElement.matches('input,textarea')) document.activeElement.blur();
    else { $('app').classList.remove('chat-open'); setFocus($('chat-list').querySelector('.selected') || $('search')); }
  }
  document.addEventListener('keydown', function (event) {
    if (!$('screensaver').hidden) { show($('screensaver'), false); state.lastActivity = Date.now(); event.preventDefault(); event.stopImmediatePropagation(); return; }
    state.lastActivity = Date.now(); var key = event.key, editing = event.target.matches('input:not([type="range"]),textarea,[contenteditable="true"]');
    if (key === 'Escape' || key === 'BrowserBack' || event.keyCode === 461) { event.preventDefault(); back(); return; }
    if (editing) { if (key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); event.target.blur(); setFocus(event.target.id === 'login-input' ? $('login-next') : event.target.id === 'message-input' ? $('send-button') : $('chat-list').querySelector('button')); } return; }
    if (!$('player').hidden) { if (key === 'ArrowLeft' || key === 'ArrowRight') { event.preventDefault(); seek(key === 'ArrowLeft' ? -15 : 15); return; } if (key === ' ' || key === 'MediaPlayPause' || event.keyCode === 179) { event.preventDefault(); togglePlay(); return; } if (event.keyCode === 415) { if ($('video').paused) togglePlay(); return; } if (event.keyCode === 19) { $('video').pause(); return; } }
    if (/^Arrow(Up|Down|Left|Right)$/.test(key)) { event.preventDefault(); moveFocus(key); }
    if (key === 'Tab' && focusScope() !== $('app')) { var nodes = visibleFocusable(focusScope()), first = nodes[0], last = nodes[nodes.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); setFocus(last); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); setFocus(first); } }
  }, true);
  ['pointerdown', 'mousemove', 'touchstart'].forEach(function (type) { document.addEventListener(type, function (event) { state.lastActivity = Date.now(); if (!$('screensaver').hidden) { show($('screensaver'), false); event.preventDefault(); event.stopImmediatePropagation(); } }, { capture: true, passive: false }); });
  function updateClock() { var now = new Date(); $('clock').textContent = time(now); $('saver-clock').querySelector('time').textContent = time(now); $('saver-clock').querySelector('p').textContent = now.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' }); var playing = !$('player').hidden && !$('video').paused && Date.now() - state.lastProgress < 20000; if (playing || !$('miniapp').hidden) state.lastActivity = Date.now(); if (Date.now() - state.lastActivity >= 180000) show($('screensaver'), true); }
  $('retry-connection').onclick = connect; $('login-next').onclick = login; $('login-back').onclick = function () { state.authStep = 'phone'; renderLogin(); }; $('search').addEventListener('input', renderChats); $('inbox-tab').onclick = function () { selectArchive(false); }; $('archive-tab').onclick = function () { selectArchive(true); }; $('send-button').onclick = send; $('retry-chat').onclick = function () { loadMessages(); }; $('chat-back').onclick = function () { $('app').classList.remove('chat-open'); setFocus($('chat-list').querySelector('.selected')); }; $('bot-app').onclick = function () { if (state.chat && state.chat.username) resolveMiniapp('https://t.me/' + encodeURIComponent(state.chat.username) + '?startapp'); };
  $('about-button').onclick = function () { show($('about'), true); setFocus($('about-close')); }; $('about-close').onclick = function () { show($('about'), false); setFocus($('about-button')); };
  $('close-player').onclick = closeVideo; $('toggle-play').onclick = togglePlay; $('seek-back').onclick = function () { seek(-15); }; $('seek-forward').onclick = function () { seek(15); }; $('retry-video').onclick = function () { show($('player-error'), false); $('video').load(); var promise = $('video').play(); if (promise) promise.catch(updatePlay); }; $('video-progress').addEventListener('input', function () { if (Number.isFinite($('video').duration)) { $('video').currentTime = Number(this.value) / 1000 * $('video').duration; saveResume(); } });
  $('video').addEventListener('loadedmetadata', function () { var resume = 0; try { resume = Number(localStorage.getItem('telesera-resume-' + state.videoKey)) || 0; } catch (_) {} if (resume > 0 && Number.isFinite(this.duration) && resume < this.duration - 5) this.currentTime = resume; $('video-duration').textContent = duration(this.duration); });
  $('video').addEventListener('timeupdate', function () { if (Math.abs(this.currentTime - state.lastTime) > .05 && !this.paused && this.readyState >= 2) { state.lastProgress = Date.now(); state.lastTime = this.currentTime; } $('video-time').textContent = duration(this.currentTime); $('video-duration').textContent = duration(this.duration); $('video-progress').value = Number.isFinite(this.duration) && this.duration ? Math.round(this.currentTime / this.duration * 1000) : 0; saveResume(); });
  ['play', 'pause', 'ended'].forEach(function (event) { $('video').addEventListener(event, updatePlay); }); $('video').addEventListener('error', function () { if (state.videoKey && this.getAttribute('src')) { $('player-error').querySelector('p').textContent = 'Impossibile riprodurre questo video. Il formato potrebbe non essere supportato dal televisore.'; show($('player-error'), true); } });
  $('miniapp-close').onclick = closeMiniapp; $('miniapp-back').onclick = function () { miniEvent('back_button_pressed'); }; $('miniapp-main').onclick = function () { miniEvent('main_button_pressed'); }; $('miniapp-frame').addEventListener('load', function () { show($('miniapp-loading'), false); miniEvent('theme_changed', { theme_params: miniTheme }); miniEvent('viewport_changed', { height: this.clientHeight, is_state_stable: true, is_expanded: true }); });
  window.addEventListener('beforeunload', saveResume); document.addEventListener('visibilitychange', function () { if (!document.hidden) { state.lastActivity = Date.now(); if (!$('app').hidden) { loadChats(); loadMessages(); } } });
  setInterval(function () { if (!$('app').hidden && !document.hidden && $('player').hidden && $('miniapp').hidden) loadMessages(); }, 5000); setInterval(function () { if (!$('app').hidden && !document.hidden) loadChats(); }, 30000); setInterval(updateClock, 1000); setInterval(function () { if ($('screensaver').hidden) return; var saver = $('saver-clock'); saver.style.left = (20 + Math.random() * Math.max(0, innerWidth - saver.offsetWidth - 40)) + 'px'; saver.style.top = (20 + Math.random() * Math.max(0, innerHeight - saver.offsetHeight - 40)) + 'px'; }, 30000); updateClock(); connect();
}());
