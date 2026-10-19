use crate::*;
use axum::extract::Path;
use grammers_client::{
    media::{Document, Sticker},
    message::InputMessage,
};
use std::{
    collections::VecDeque,
    time::{Duration, Instant},
};

// Keep access hashes private and bound cached references by age and count.
#[derive(Default)]
pub struct Catalog {
    documents: VecDeque<(String, Document, Instant)>,
    sets: HashMap<String, tl::enums::InputStickerSet>,
}
impl Catalog {
    fn remember(&mut self, raw: Vec<tl::enums::Document>) -> Vec<Value> {
        raw.into_iter().filter_map(|raw| {
            let doc = Document::from_raw_media(tl::types::MessageMediaDocument {
                nopremium:false, spoiler:false, video:false, round:false, voice:false,
                document:Some(raw), alt_documents:None, video_cover:None,
                video_timestamp:None, ttl_seconds:None,
            });
            let sticker = Sticker::from_document(&doc)?;
            let id = doc.id().to_string();
            let item = json!({"id":id,"emoji":sticker.emoji(),"format":format(&doc),"preview":format(&doc)=="static" || !doc.thumbs().is_empty()});
            self.documents.retain(|(key,_,at)| key != &id && at.elapsed() < Duration::from_secs(900));
            while self.documents.len() >= 2048 { self.documents.pop_front(); }
            self.documents.push_back((id,doc,Instant::now()));
            Some(item)
        }).collect()
    }
    fn document(&self, id: &str) -> ApiResult<Document> {
        self.documents
            .iter()
            .find(|(key, _, at)| key == id && at.elapsed() < Duration::from_secs(900))
            .map(|(_, doc, _)| doc.clone())
            .ok_or_else(|| missing("Refresh the sticker picker and try again"))
    }
}
pub fn format(doc: &Document) -> &'static str {
    match doc.mime_type() {
        Some("application/x-tgsticker") => "animated",
        Some("video/webm") => "video",
        _ => "static",
    }
}
async fn read_request<R: tl::RemoteCall>(app: &Shared, request: R) -> Result<R::Return, String> {
    tokio::time::timeout(Duration::from_secs(18), app.client.invoke(&request))
        .await
        .map_err(|_| "Sticker request timed out".to_string())?
        .map_err(|e| e.to_string())
}
pub async fn catalog(State(app): State<Shared>) -> ApiResult<Json<Value>> {
    let (recent, favorites, sets) = tokio::join!(
        read_request(
            &app,
            tl::functions::messages::GetRecentStickers {
                attached: false,
                hash: 0
            }
        ),
        read_request(&app, tl::functions::messages::GetFavedStickers { hash: 0 }),
        read_request(&app, tl::functions::messages::GetAllStickers { hash: 0 })
    );
    let mut errors = serde_json::Map::new();
    for (name, error) in [
        ("recent", recent.as_ref().err()),
        ("favorites", favorites.as_ref().err()),
        ("sets", sets.as_ref().err()),
    ] {
        if let Some(error) = error {
            errors.insert(name.into(), json!(error.to_string()));
        }
    }
    if errors.len() == 3 {
        return Err(ApiError(
            StatusCode::BAD_GATEWAY,
            "Stickers are temporarily unavailable".into(),
        ));
    }
    let mut catalog = app.stickers.lock().await;
    let recent = match recent {
        Ok(tl::enums::messages::RecentStickers::Stickers(x)) => catalog.remember(x.stickers),
        _ => vec![],
    };
    let favorites = match favorites {
        Ok(tl::enums::messages::FavedStickers::Stickers(x)) => catalog.remember(x.stickers),
        _ => vec![],
    };
    let mut result = vec![];
    if let Ok(tl::enums::messages::AllStickers::Stickers(all)) = sets {
        catalog.sets.clear();
        for raw in all.sets.into_iter().take(2000) {
            let tl::enums::StickerSet::Set(s) = raw;
            if s.masks || s.emojis {
                continue;
            }
            let id = s.id.to_string();
            result.push(json!({"id":id,"title":s.title,"count":s.count}));
            catalog.sets.insert(
                id,
                tl::types::InputStickerSetId {
                    id: s.id,
                    access_hash: s.access_hash,
                }
                .into(),
            );
        }
    }
    Ok(Json(
        json!({"recent":recent,"favorites":favorites,"sets":result,"errors":errors}),
    ))
}
pub async fn set(State(app): State<Shared>, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    let input = app
        .stickers
        .lock()
        .await
        .sets
        .get(&id)
        .cloned()
        .ok_or_else(|| missing("Refresh the sticker picker and try again"))?;
    let result = read_request(
        &app,
        tl::functions::messages::GetStickerSet {
            stickerset: input,
            hash: 0,
        },
    )
    .await
    .map_err(|e| ApiError(StatusCode::BAD_GATEWAY, e))?;
    let stickers = match result {
        tl::enums::messages::StickerSet::Set(s) => app.stickers.lock().await.remember(s.documents),
        _ => vec![],
    };
    Ok(Json(json!({"stickers":stickers})))
}
pub async fn thumbnail(State(app): State<Shared>, Path(id): Path<String>) -> ApiResult<Response> {
    let doc = app.stickers.lock().await.document(&id)?;
    media::sticker_preview(&app, &doc).await
}
#[derive(Deserialize)]
pub struct Send {
    sticker_id: String,
}
pub async fn send(
    State(app): State<Shared>,
    Path(id): Path<String>,
    Json(body): Json<Send>,
) -> ApiResult<Json<Value>> {
    let doc = app.stickers.lock().await.document(&body.sticker_id)?;
    let input = InputMessage::new().media(doc.to_raw_input_media());
    let message = app
        .client
        .send_message(telegram::peer_ref(&app, &id).await?, input)
        .await?;
    Ok(Json(json!({"id":message.id()})))
}
