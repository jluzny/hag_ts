#!/bin/sh
# HAG HVAC production launcher - secret-free, tracked in Git.
#
# This is the file the deployment starts the service with:
#   server1: /home/jiri/apps/hag_ts/start_hag.sh
# started at boot by the deployment's root crontab entry and by manual
# restarts. It deliberately contains no credentials. Every secret is read at
# start time from deployment-local env files that are mode 0600 and gitignored
# (see Agents.md, "Production configuration and secret policy"):
#
#   $HAG_HA_TOKEN_ENV_FILE     Home Assistant long-lived token        (0600, ignored)
#   $HAG_TELEGRAM_ENV_FILE     Telegram bot token of the alert route  (0600, ignored)
#
# Every path below can be overridden through the environment, so the launcher
# can be rehearsed offline against a sandbox:
#
#   HAG_DRY_RUN=1 HAG_APP_DIR=/tmp/sandbox HAG_BUN_BIN=/tmp/fake-bun \
#     HAG_CONFIG_FILE=/tmp/sandbox/config/hvac_config_prod.yaml \
#     HAG_HA_TOKEN_ENV_FILE=/tmp/sandbox/.hag_ha_token.env \
#     HAG_TELEGRAM_ENV_FILE=/tmp/sandbox/.hag_telegram.env sh start_hag.sh
#
# POSIX sh only: on the server /bin/sh is busybox ash. `printenv` (busybox) is
# used to read back the required variables without eval.

set -u

APP_DIR=${HAG_APP_DIR:-/home/jiri/apps/hag_ts}
BUN_BIN=${HAG_BUN_BIN:-/home/jiri/.bun/bin/bun}
CONFIG_FILE=${HAG_CONFIG_FILE:-$APP_DIR/config/hvac_config_prod.yaml}
LOG_FILE=${HAG_LOG_FILE:-$APP_DIR/log.log}
HA_TOKEN_ENV_FILE=${HAG_HA_TOKEN_ENV_FILE:-/home/jiri/.hag_ha_token.env}
TELEGRAM_ENV_FILE=${HAG_TELEGRAM_ENV_FILE:-/home/jiri/.hag_telegram.env}

# Variables that must be present before the service may start. Degraded-mode
# fault alerts are part of the approved production contract (the tracked
# config enables hvacOptions.alerts.telegram), so the Telegram bot token is
# required next to the Home Assistant token. A deployment that intentionally
# runs without alert delivery narrows the list instead of going silently mute:
#   HAG_REQUIRED_VARS=HASS_HassOptions__Token
REQUIRED_VARS=${HAG_REQUIRED_VARS:-HASS_HassOptions__Token HASS_TelegramBotToken}

# Deterministic file permissions for the service log, independent of umask.
umask 022

# Messages name variables and paths, never values.
fail() {
  printf 'HAG start: %s\n' "$1" >&2
  exit 1
}

# Source a protected env file if it exists. A missing file is not fatal on its
# own - the required-variable check below is the single gate.
load_env_file() {
  file=$1
  case $file in
    */*) ;;
    *) file=./$file ;;
  esac
  if [ -r "$file" ]; then
    set -a
    . "$file" || { set +a; fail "could not read env file: $file"; }
    set +a
  fi
}

load_env_file "$TELEGRAM_ENV_FILE"
load_env_file "$HA_TOKEN_ENV_FILE"

missing=
for var in $REQUIRED_VARS; do
  case $var in
    "" | *[!A-Za-z0-9_]* | [0-9]*)
      fail "HAG_REQUIRED_VARS holds an unusable variable name (value not shown)"
      ;;
  esac
  if [ -z "$(printenv "$var" 2>/dev/null || true)" ]; then
    missing="$missing $var"
  fi
done

if [ -n "$missing" ]; then
  fail "missing required variable(s):$missing - supply them in $HA_TOKEN_ENV_FILE and $TELEGRAM_ENV_FILE (values are never printed)"
fi

[ -x "$BUN_BIN" ] || fail "bun runtime is missing or not executable: $BUN_BIN"
[ -r "$CONFIG_FILE" ] || fail "configuration file is missing or not readable: $CONFIG_FILE"

cd "$APP_DIR" || fail "cannot change directory to $APP_DIR"

if [ -n "${HAG_DRY_RUN:-}" ] && [ "$HAG_DRY_RUN" != "0" ]; then
  printf 'HAG start (dry run): %s run %s/src/main.ts --config %s (cwd %s, log %s)\n' \
    "$BUN_BIN" "$APP_DIR" "$CONFIG_FILE" "$(pwd)" "$LOG_FILE"
  exit 0
fi

# The service runs in the background and keeps its log through tee, truncating
# it on each start - the behaviour the deployment has always had.
"$BUN_BIN" run "$APP_DIR/src/main.ts" --config "$CONFIG_FILE" 2>&1 | tee "$LOG_FILE" &
