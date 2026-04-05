.PHONY: help init-env up up-quicktunnel up-tunnel down restart ps logs logs-app logs-quicktunnel logs-tunnel quicktunnel-url test-app autostart-install autostart-uninstall autostart-status

COMPOSE := docker compose
LAUNCH_AGENT_ID := com.you.drawio-mcp-tunnel
LAUNCH_AGENT_PATH := /Users/you/Library/LaunchAgents/$(LAUNCH_AGENT_ID).plist
AUTOSTART_SCRIPT := /Users/you/github/oss/drawio-mcp/scripts/launchd-up-tunnel.sh

help:
	@echo "Available targets:"
	@echo "  make init-env          Create .env from .env.example if it does not exist"
	@echo "  make up                Start the local app stack on 127.0.0.1:13001"
	@echo "  make up-quicktunnel    Start the app plus an ephemeral Cloudflare Quick Tunnel"
	@echo "  make up-tunnel         Start the app plus a named Cloudflare Tunnel"
	@echo "  make down              Stop and remove the compose stack"
	@echo "  make restart           Restart the local app stack"
	@echo "  make ps                Show compose service status"
	@echo "  make logs              Follow logs for all services"
	@echo "  make logs-app          Follow logs for the app service"
	@echo "  make logs-quicktunnel  Follow logs for the quicktunnel service"
	@echo "  make logs-tunnel       Follow logs for the cloudflared service"
	@echo "  make quicktunnel-url   Print the current Quick Tunnel URL from logs"
	@echo "  make test-app          Run the mcp-app-server test suite"
	@echo "  make autostart-install Install a macOS LaunchAgent for tunnel startup at login"
	@echo "  make autostart-uninstall Remove the macOS LaunchAgent"
	@echo "  make autostart-status  Show LaunchAgent installation status"

init-env:
	@if [ ! -f .env ]; then cp .env.example .env; echo "Created .env from .env.example"; else echo ".env already exists"; fi

up:
	$(COMPOSE) up -d --build

up-quicktunnel:
	$(COMPOSE) --profile quicktunnel up -d --build

up-tunnel:
	$(COMPOSE) --profile tunnel up -d --build

down:
	$(COMPOSE) down

restart: down up

ps:
	$(COMPOSE) ps

logs:
	$(COMPOSE) logs -f

logs-app:
	$(COMPOSE) logs -f app

logs-quicktunnel:
	$(COMPOSE) logs -f quicktunnel

logs-tunnel:
	$(COMPOSE) logs -f cloudflared

quicktunnel-url:
	@$(COMPOSE) logs quicktunnel | grep -Eo 'https://[-a-z0-9]+\.trycloudflare\.com' | tail -n 1

test-app:
	cd mcp-app-server && npm test

autostart-install:
	@mkdir -p "$(HOME)/Library/LaunchAgents"
	@printf '%s\n' \
		'<?xml version="1.0" encoding="UTF-8"?>' \
		'<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "https://www.apple.com/DTDs/PropertyList-1.0.dtd">' \
		'<plist version="1.0">' \
		'  <dict>' \
		'    <key>Label</key>' \
		'    <string>$(LAUNCH_AGENT_ID)</string>' \
		'    <key>ProgramArguments</key>' \
		'    <array>' \
		'      <string>$(AUTOSTART_SCRIPT)</string>' \
		'    </array>' \
		'    <key>RunAtLoad</key>' \
		'    <true/>' \
		'    <key>StandardOutPath</key>' \
		'    <string>$(HOME)/Library/Logs/$(LAUNCH_AGENT_ID).log</string>' \
		'    <key>StandardErrorPath</key>' \
		'    <string>$(HOME)/Library/Logs/$(LAUNCH_AGENT_ID).log</string>' \
		'  </dict>' \
		'</plist>' \
		> "$(LAUNCH_AGENT_PATH)"
	@chmod 644 "$(LAUNCH_AGENT_PATH)"
	@chmod +x "$(AUTOSTART_SCRIPT)"
	@launchctl unload "$(LAUNCH_AGENT_PATH)" >/dev/null 2>&1 || true
	@launchctl load "$(LAUNCH_AGENT_PATH)"
	@echo "Installed LaunchAgent at $(LAUNCH_AGENT_PATH)"

autostart-uninstall:
	@launchctl unload "$(LAUNCH_AGENT_PATH)" >/dev/null 2>&1 || true
	@rm -f "$(LAUNCH_AGENT_PATH)"
	@echo "Removed LaunchAgent $(LAUNCH_AGENT_ID)"

autostart-status:
	@if [ -f "$(LAUNCH_AGENT_PATH)" ]; then \
	  echo "LaunchAgent file: present"; \
	else \
	  echo "LaunchAgent file: missing"; \
	fi
	@launchctl list | grep "$(LAUNCH_AGENT_ID)" || true
