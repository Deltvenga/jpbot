// botInstance.js
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.error('Ошибка: Токен для Telegram бота не найден. Убедитесь, что вы создали .env файл и указали в нем TELEGRAM_BOT_TOKEN.');
    process.exit(1);
}

const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

module.exports = bot;