# Playback compatibility

Telesera streams Telegram files to the TV's HTML video player. The Rust engine handles Telegram access and byte-range delivery; it does not add codecs to the LG media decoder or transcode files.

An `.mp4` or `.mkv` extension identifies a container, not the codecs inside it. A supported container can still contain an unsupported video profile or audio track. LG publishes [webOS 25 format and profile limits](https://webostv.developer.lge.com/develop/specifications/video-audio-250), with some capabilities depending on the TV model. Browser playback must be tested on the actual device.

## Diagnose before converting

- A network error can mean interrupted Telegram delivery; retry once the connection is restored.
- A decoding error may indicate damaged media or a codec/profile the TV cannot decode.
- An unsupported-source error can concern the container, video or audio format. A faster connection does not change codec support.

The player distinguishes these cases where the browser supplies an error code. That code alone cannot identify the exact incompatible track. For a file you are authorized to download, inspect it on a computer with `ffprobe -v error -show_streams -show_format INPUT.mkv`. Remove private filenames and metadata before sharing diagnostics.

## Conversion options

If the video and audio codecs already work on the TV, changing the container can avoid re-encoding. For MP4-compatible tracks, an example is:

```sh
ffmpeg -i INPUT.mkv -map 0:v:0 -map '0:a:0?' -c copy -movflags +faststart OUTPUT.mp4
```

If only the audio is incompatible, keep the video and convert the selected audio track:

```sh
ffmpeg -i INPUT.mkv -map 0:v:0 -map '0:a:0?' -c:v copy -c:a aac -ac 2 -movflags +faststart OUTPUT.mp4
```

These examples select the first video and optional first audio track; they do not preserve additional tracks or subtitles. They are not universal fixes: an incompatible video codec/profile requires video transcoding. [FFmpeg's documentation](https://ffmpeg.org/ffmpeg.html#Streamcopy) explains the distinction and why copying streams is cheaper than re-encoding.

Automatic conversion is not implemented in Telesera. Software video transcoding on the TV has not been benchmarked and must not be assumed to run in real time. An optional external transcoder could handle unsupported files, but would require a separate service and explicit configuration. Normal supported playback would remain local to the TV.
