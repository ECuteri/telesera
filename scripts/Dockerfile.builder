FROM rust:1.99.1-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends musl-tools && rm -rf /var/lib/apt/lists/* \
    && rustup target add aarch64-unknown-linux-musl
ENV CARGO_TARGET_AARCH64_UNKNOWN_LINUX_MUSL_LINKER=musl-gcc
WORKDIR /work/engine
CMD ["cargo", "build", "--release", "--locked", "--target", "aarch64-unknown-linux-musl"]
