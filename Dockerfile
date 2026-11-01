FROM rust:1.99-bookworm AS build
WORKDIR /src
COPY . .
RUN cargo build --release -p kaleidoscope-orchestrator

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates python3 && rm -rf /var/lib/apt/lists/* && useradd --create-home --uid 10001 kaleidoscope && mkdir /data && chown kaleidoscope /data
COPY --from=build /src/target/release/kaleidoscope-orchestrator /usr/local/bin/kaleidoscope-orchestrator
WORKDIR /opt/kaleidoscope
COPY --from=build /src/apps/*.json /opt/kaleidoscope/apps/
USER kaleidoscope
VOLUME ["/data"]
EXPOSE 4219
ENTRYPOINT ["kaleidoscope-orchestrator"]
CMD ["--bind", "0.0.0.0:4219", "--db", "/data/kaleidoscope.db"]
