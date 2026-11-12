#!/bin/bash
cd -- "$(dirname -- "$0")" || exit 1
if ! command -v python3 >/dev/null 2>&1; then
  echo 'API 翻译需要 Python 3。只使用常用语时，可直接打开 HTML 文件。'
  exit 1
fi
exec python3 translation_server.py --open
