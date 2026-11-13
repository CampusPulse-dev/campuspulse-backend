# Official MinIO source is pinned because its old public container registry was removed.
FROM golang:1.24-alpine AS build
RUN apk add --no-cache git ca-certificates
WORKDIR /src
RUN git init && git remote add origin https://github.com/minio/minio.git && git fetch --depth 1 origin 7aac2a2c5b7c882e68c1ce017d8256be2feea27f && git checkout FETCH_HEAD
RUN CGO_ENABLED=0 go build -trimpath -o /minio .
FROM alpine:3.22
RUN apk add --no-cache ca-certificates
COPY --from=build /minio /usr/local/bin/minio
USER 1000:1000
WORKDIR /tmp
ENTRYPOINT ["minio"]
