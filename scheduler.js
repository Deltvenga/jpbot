// scheduler.js
const cron = require('node-cron');
const bot = require('./botInstance');
const { readDb } = require('./database');

const startScheduler = () => {
    // Запускаем задачу каждый день в 9:00 утра по московскому времени
    cron.schedule('0 9 * * *', () => {
        console.log('Проверка карточек для ежедневных напоминаний...');
        const db = readDb();

        for (const userId in db) {
            const user = db[userId];
            const cardsToReview = user.cards.filter(c => new Date(c.nextReviewDate) <= new Date());

            if (cardsToReview.length > 0) {
                bot.sendMessage(userId, `👋 Привет! У тебя есть ${cardsToReview.length} карточек для повторения. Нажми "🧠 Изучать карточки", чтобы начать!`)
                    .catch(err => console.error(`Не удалось отправить напоминание пользователю ${userId}:`, err.message));
            }
        }
    }, {
        timezone: "Europe/Moscow"
    });
};

module.exports = { startScheduler };