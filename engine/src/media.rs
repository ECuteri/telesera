use crate::*;
use axum::{extract::Path, http::HeaderMap};
use bytes::Bytes;
use futures_util::stream;
use grammers_client::media::{Downloadable, Media};
use std::io;
const CHUNK: usize = 256 * 1024;

pub async fn photo(State(app): State<Shared>, Path(id): Path<String>) -> ApiResult<Response> {
    let p = telegram::peer(&app, &id).await?;
    let photo = p
        .photo(false)
        .await?
        .ok_or_else(|| missing("Foto non disponibile"))?;
    small_image(&app, &photo).await
}
pub async fn thumbnail(
    State(app): State<Shared>,
    Path((id, mid)): Path<(String, i32)>,
) -> ApiResult<Response> {
    let m = telegram::message(&app, &id, mid).await?;
    let thumbs = match m.media() {
        Some(Media::Photo(p)) => p.thumbs(),
        Some(Media::Document(d)) => d.thumbs(),
        _ => return Err(missing("Anteprima non disponibile")),
    };
    // Prefer a real 320px JPEG over vector or stripped placeholders.
    let photo = thumbs
        .into_iter()
        .filter(|p| p.to_raw_input_location().is_some() || p.to_data().is_some())
        .min_by_key(|p| {
            if p.size() >= 10_000 {
                p.size()
            } else {
                usize::MAX - p.size()
            }
        })
        .ok_or_else(|| missing("Anteprima non disponibile"))?;
    small_image(&app, &photo).await
}
async fn small_image<D: Downloadable>(app: &Shared, photo: &D) -> ApiResult<Response> {
    let _permit = app.downloads.clone().acquire_owned().await?;
    let mut iter = app.client.iter_download(photo).chunk_size(CHUNK as i32);
    let mut bytes = Vec::new();
    while let Some(chunk) = iter.next().await? {
        if bytes.len() + chunk.len() > 4 * 1024 * 1024 {
            return Err(bad("Anteprima troppo grande"));
        }
        bytes.extend(chunk);
    }
    if bytes.is_empty() {
        return Err(missing("Immagine non disponibile"));
    }
    Ok(Response::builder()
        .header(header::CONTENT_TYPE, "image/jpeg")
        .header(header::CONTENT_LENGTH, bytes.len())
        .body(Body::from(bytes))
        .unwrap())
}

pub async fn media(
    State(app): State<Shared>,
    Path((id, mid)): Path<(String, i32)>,
    headers: HeaderMap,
) -> ApiResult<Response> {
    let m = telegram::message(&app, &id, mid).await?;
    let media = m.media().ok_or_else(|| missing("File non disponibile"))?;
    let (mime, size, attachment) = match &media {
        Media::Photo(p) => ("image/jpeg".to_string(), p.size(), false),
        Media::Document(d) => {
            let mime = d.mime_type().unwrap_or("application/octet-stream");
            let inline = matches!(
                mime,
                "video/mp4"
                    | "video/webm"
                    | "video/x-matroska"
                    | "video/quicktime"
                    | "image/jpeg"
                    | "image/png"
                    | "image/webp"
                    | "image/gif"
                    | "audio/mpeg"
                    | "audio/ogg"
            );
            (
                if inline {
                    mime
                } else {
                    "application/octet-stream"
                }
                .to_string(),
                d.size(),
                !inline,
            )
        }
        _ => return Err(missing("File non disponibile")),
    };
    let size = size.ok_or_else(|| bad("Dimensione del file sconosciuta"))? as u64;
    let range = headers
        .get(header::RANGE)
        .map(|h| h.to_str())
        .transpose()
        .map_err(|_| bad("Range non valido"))?;
    let (start, end, partial) = match byte_range(range, size) {
        Ok(r) => r,
        Err(()) => {
            return Ok(Response::builder()
                .status(StatusCode::RANGE_NOT_SATISFIABLE)
                .header(header::CONTENT_RANGE, format!("bytes */{size}"))
                .body(Body::empty())
                .unwrap());
        }
    };
    let permit = app.downloads.clone().acquire_owned().await?;
    let iter = app
        .client
        .iter_download(&media)
        .chunk_size(CHUNK as i32)
        .skip_chunks((start / (CHUNK as u64)) as i32);
    let length = if size == 0 { 0 } else { end - start + 1 };
    let stream = stream::try_unfold(
        (iter, (start % (CHUNK as u64)) as usize, length, permit),
        |(mut iter, mut skip, mut left, permit)| async move {
            if left == 0 {
                return Ok::<_, io::Error>(None);
            }
            loop {
                let chunk = iter
                    .next()
                    .await
                    .map_err(io::Error::other)?
                    .ok_or_else(|| {
                        io::Error::new(
                            io::ErrorKind::UnexpectedEof,
                            "Telegram download ended early",
                        )
                    })?;
                if skip >= chunk.len() {
                    skip -= chunk.len();
                    continue;
                }
                let take = (chunk.len() - skip).min(left as usize);
                let bytes = Bytes::from(chunk).slice(skip..skip + take);
                left -= take as u64;
                return Ok(Some((bytes, (iter, 0, left, permit))));
            }
        },
    );
    let mut builder = Response::builder()
        .status(if partial {
            StatusCode::PARTIAL_CONTENT
        } else {
            StatusCode::OK
        })
        .header(header::CONTENT_TYPE, mime)
        .header(header::CONTENT_LENGTH, length)
        .header(header::ACCEPT_RANGES, "bytes");
    if partial {
        builder = builder.header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{size}"));
    }
    if attachment {
        builder = builder.header(header::CONTENT_DISPOSITION, "attachment");
    }
    Ok(builder.body(Body::from_stream(stream)).unwrap())
}
// Exactly one RFC 9110 byte range; each stream retains at most one 256 KiB Telegram chunk.
fn byte_range(value: Option<&str>, size: u64) -> Result<(u64, u64, bool), ()> {
    let Some(value) = value else {
        return Ok((0, size.saturating_sub(1), false));
    };
    if size == 0 {
        return Err(());
    }
    let range = value.strip_prefix("bytes=").ok_or(())?;
    if range.contains(',') {
        return Err(());
    }
    let (start, end) = range.split_once('-').ok_or(())?;
    if start.is_empty() {
        let count = end.parse::<u64>().map_err(|_| ())?;
        if count == 0 {
            return Err(());
        }
        Ok((size.saturating_sub(count), size - 1, true))
    } else {
        let start = start.parse::<u64>().map_err(|_| ())?;
        let end = if end.is_empty() {
            size - 1
        } else {
            end.parse::<u64>().map_err(|_| ())?.min(size - 1)
        };
        if start >= size || start > end {
            return Err(());
        }
        Ok((start, end, true))
    }
}
