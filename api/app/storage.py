"""S3 object storage (SeaweedFS in compose; any S3 API works). Files are streamed through the API
so access checks stay in one place and downloads are same-origin (no presigned URLs to leak).

    uv run python -m app.storage     # create the buckets
"""

from collections.abc import Iterator
from functools import lru_cache

import boto3
from botocore.client import BaseClient
from botocore.config import Config
from botocore.exceptions import ClientError

from app.config import get_settings

CHUNK = 64 * 1024


@lru_cache
def client() -> BaseClient:
    s = get_settings()
    return boto3.client(
        "s3",
        endpoint_url=s.s3_endpoint,
        aws_access_key_id=s.s3_access_key,
        aws_secret_access_key=s.s3_secret_key,
        region_name=s.s3_region,
        config=Config(s3={"addressing_style": "path"}, retries={"max_attempts": 3}),
    )


def ensure_buckets() -> None:
    s = get_settings()
    for bucket in (s.s3_bucket_documents, s.s3_bucket_content):
        try:
            client().head_bucket(Bucket=bucket)
        except ClientError:
            client().create_bucket(Bucket=bucket)


def put(bucket: str, key: str, data: bytes, content_type: str) -> None:
    client().put_object(Bucket=bucket, Key=key, Body=data, ContentType=content_type)


def size(bucket: str, key: str) -> int | None:
    """Object size in bytes, or None if it doesn't exist."""
    try:
        return client().head_object(Bucket=bucket, Key=key)["ContentLength"]
    except ClientError:
        return None


def get(bucket: str, key: str) -> bytes:
    return client().get_object(Bucket=bucket, Key=key)["Body"].read()


def list_keys(bucket: str, prefix: str) -> list[str]:
    keys: list[str] = []
    for page in client().get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=prefix):
        keys += [o["Key"] for o in page.get("Contents", [])]
    return sorted(keys)


def delete_prefix(bucket: str, prefix: str) -> None:
    keys = list_keys(bucket, prefix)
    for i in range(0, len(keys), 1000):
        client().delete_objects(Bucket=bucket, Delete={"Objects": [{"Key": k} for k in keys[i : i + 1000]]})


def stream(bucket: str, key: str) -> Iterator[bytes]:
    body = client().get_object(Bucket=bucket, Key=key)["Body"]
    try:
        yield from body.iter_chunks(CHUNK)
    finally:
        body.close()


if __name__ == "__main__":
    ensure_buckets()
    print("Buckets ready.")
