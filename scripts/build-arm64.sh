#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
# Run on a Linux ARM64 builder; this host is not needed by the installed app.
[ "$(uname -m)" = aarch64 ] || { echo 'Use a Linux ARM64 Docker host.' >&2; exit 1; }
docker build -f scripts/Dockerfile.builder -t telesera-builder:1.99.1 .
docker run --rm -v "$PWD:/work" -v telesera-cargo-registry:/usr/local/cargo/registry telesera-builder:1.99.1
mkdir -p dist
cp engine/target/aarch64-unknown-linux-musl/release/telesera-engine dist/telesera-engine
sha256sum dist/telesera-engine > dist/SHA256SUMS
