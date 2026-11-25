#!/bin/zsh
set -e
cd -- "$(dirname -- "$0")"
export PATH="/opt/homebrew/opt/ruby@3.3/bin:/opt/homebrew/bin:/usr/local/opt/ruby@3.3/bin:/usr/local/bin:$PATH"
exec npm run studio
