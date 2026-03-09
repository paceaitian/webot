@echo off
:: Webot 开机自启脚本
cd /d K:\AI\webot
call npx pm2 start ecosystem.config.cjs --silent
