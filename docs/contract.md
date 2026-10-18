# Telesera local API contract
Independent new client by Ennio Cuteri. No source/assets/docs copied or ported from sostk/webos-telegram or /tmp/ennio-telegram-tv-9b98. Third-party libraries under their own licenses allowed.
Rust engine listens on 127.0.0.1:3190; serves ui/ at /. webOS wrapper opens http://127.0.0.1:3190/#token=LOCAL_SECRET. UI saves token in sessionStorage, removes fragment; all API fetches Authorization: Bearer token. Media/image URL queries ?token= same secret are allowed on loopback. Never log token or Telegram message text. Accept only loopback browser origin (and no Origin for native resource requests), reject other Origins; no wildcard CORS. No remote APIs or Spark dependency.
All JSON failures {error:string}; normal responses as below. IDs strings. Dates ISO8601. No public env credentials. Configuration read from file arg --config PATH: {api_id:integer,api_hash:string,token:string,data_dir:string,ui_dir:string,port:3190,import_session?:{dc_id:integer,auth_key_hex:string,user_id?:integer}}. Import only once, protect session/config at mode0600. Existing session supported. Engine restart persists account.
GET /api/status -> {authorized:bool,user?:{id,name},version:string}
POST /api/auth/phone {phone} -> {step:"code"}
POST /api/auth/code {code} -> {step:"ready"|"password"}
POST /api/auth/password {password} -> {step:"ready"}
QR optional if readily implementable; phone login complete required. Session migration by parent for tonight.
GET /api/chats -> {chats:[{id,title,kind:"user"|"bot"|"group"|"channel"|"saved",archived:bool,unread:number,photo:bool,last_text?:string}]}
GET /api/chats/:id/messages?before=INTEGER -> {messages:[{id:integer,chat_id:string,date:string,text:string,outgoing:bool,media?:{kind:"video"|"photo"|"document",name:string,mime:string,size:number,duration?:number},buttons?:[[{text,kind:"callback"|"text"|"url"|"miniapp"|"unsupported",url?:string,row:number,col:number}]]}],has_more:bool}
GET /api/chats/:id/photo -> image
GET /api/chats/:id/messages/:messageId/thumbnail -> image
GET /api/chats/:id/messages/:messageId/media -> media with Range support; bounded-memory streaming, do not download entire video before playing.
POST /api/chats/:id/send {text} -> {id:integer}
POST /api/chats/:id/messages/:messageId/button {row,col} -> {kind:"callback"|"url"|"miniapp"|"text",message?:string,url?:string}; server must resolve button from actual Telegram message, no client supplied arbitrary callback payload or URL trust.
POST /api/miniapp {url:string} -> {url:string}; parse official Telegram t.me bot/startapp links, RequestMainWebView or proper rawAPI, no arbitrary outbound fetch. Return signed HTTPS URL to UI iframe. Restrict iframe permissions camera/mic/geolocation, limited explicit Telegram WebApp bridge handling. No arbitrary parent postMessage privileged ops.
Bot poll/new messages: UI can poll active messages every 5s, refresh after send/callback; preserve scroll and focus. Chat list refresh every30s. Engine cache safe for photos and peers. Sensitive data private.
