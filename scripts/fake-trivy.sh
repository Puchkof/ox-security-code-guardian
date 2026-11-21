#!/bin/sh
# OOM drill stand-in for `trivy`: instead of scanning, it copies a pre-generated
# huge report (FAKE_TRIVY_REPORT) to the path given with --output. Everything after
# that (streaming parse, batching, DB writes, cleanup) is the real worker pipeline.
set -eu
out=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--output" ]; then out="$2"; shift; fi
  shift
done
[ -n "$out" ] || { echo "fake-trivy: --output is required" >&2; exit 2; }
cp "${FAKE_TRIVY_REPORT:?FAKE_TRIVY_REPORT is not set}" "$out"
