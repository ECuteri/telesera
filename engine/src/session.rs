use grammers_session::{
    BoxFuture, Session, SessionData,
    storages::MemorySession,
    types::{DcOption, PeerId, PeerInfo, UpdateState, UpdatesState},
};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, OpenOptions},
    io::{self, Write},
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
    sync::Mutex,
};

#[derive(Serialize, Deserialize)]
struct Stored {
    home_dc: i32,
    keys: Vec<(i32, String)>,
}

// Telegram keys are the durable account identity. Peer caches are reconstructed from dialogs.
pub struct FileSession {
    memory: MemorySession,
    path: PathBuf,
    write_lock: Mutex<()>,
}
impl FileSession {
    pub fn open(path: PathBuf, import: Option<(i32, String)>) -> anyhow::Result<Self> {
        let mut data = SessionData::default();
        if path.exists() {
            fs::set_permissions(&path, fs::Permissions::from_mode(0o600))?;
            let stored: Stored = serde_json::from_slice(&fs::read(&path)?)?;
            data.home_dc = stored.home_dc;
            for (id, key) in stored.keys {
                if let Some(dc) = data.dc_options.get_mut(&id) {
                    dc.auth_key = Some(
                        hex::decode(key)?
                            .try_into()
                            .map_err(|_| anyhow::anyhow!("Invalid session key length"))?,
                    );
                }
            }
        } else if let Some((id, key)) = import {
            data.home_dc = id;
            data.dc_options
                .get_mut(&id)
                .ok_or_else(|| anyhow::anyhow!("Invalid DC"))?
                .auth_key = Some(
                hex::decode(key)?
                    .try_into()
                    .map_err(|_| anyhow::anyhow!("Invalid import key length"))?,
            );
        }
        let result = Self {
            memory: MemorySession::from(data),
            path,
            write_lock: Mutex::new(()),
        };
        result.persist()?;
        Ok(result)
    }
    fn persist(&self) -> io::Result<()> {
        let _guard = self
            .write_lock
            .lock()
            .map_err(|_| io::Error::other("Session lock poisoned"))?;
        let mut keys = Vec::new();
        for id in 1..=5 {
            if let Some(dc) = self.memory.dc_option(id).map_err(io::Error::other)?
                && let Some(key) = dc.auth_key
            {
                keys.push((id, hex::encode(key)));
            }
        }
        let stored = Stored {
            home_dc: self.memory.home_dc_id().map_err(io::Error::other)?,
            keys,
        };
        private_write(&self.path, &serde_json::to_vec(&stored)?)
    }
}
pub fn private_write(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let temp = path.with_extension("new");
    let mut file = OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(&temp)?;
    file.set_permissions(fs::Permissions::from_mode(0o600))?;
    file.write_all(bytes)?;
    file.sync_all()?;
    fs::rename(temp, path)?;
    if let Some(parent) = path.parent() {
        fs::File::open(parent)?.sync_all()?;
    }
    Ok(())
}
impl Session for FileSession {
    type Error = io::Error;
    fn home_dc_id(&self) -> io::Result<i32> {
        self.memory.home_dc_id().map_err(io::Error::other)
    }
    fn dc_option(&self, id: i32) -> io::Result<Option<DcOption>> {
        self.memory.dc_option(id).map_err(io::Error::other)
    }
    fn set_home_dc_id(&self, id: i32) -> BoxFuture<'_, io::Result<()>> {
        Box::pin(async move {
            self.memory
                .set_home_dc_id(id)
                .await
                .map_err(io::Error::other)?;
            self.persist()
        })
    }
    fn set_dc_option(&self, dc: &DcOption) -> BoxFuture<'_, io::Result<()>> {
        let dc = dc.clone();
        Box::pin(async move {
            self.memory
                .set_dc_option(&dc)
                .await
                .map_err(io::Error::other)?;
            self.persist()
        })
    }
    fn peer(&self, id: PeerId) -> BoxFuture<'_, io::Result<Option<PeerInfo>>> {
        Box::pin(async move { self.memory.peer(id).await.map_err(io::Error::other) })
    }
    fn cache_peer(&self, peer: PeerInfo) -> BoxFuture<'_, io::Result<()>> {
        Box::pin(async move { self.memory.cache_peer(peer).await.map_err(io::Error::other) })
    }
    fn updates_state(&self) -> BoxFuture<'_, io::Result<UpdatesState>> {
        Box::pin(async move { self.memory.updates_state().await.map_err(io::Error::other) })
    }
    fn set_update_state(&self, state: UpdateState) -> BoxFuture<'_, io::Result<()>> {
        Box::pin(async move {
            self.memory
                .set_update_state(state)
                .await
                .map_err(io::Error::other)
        })
    }
}
