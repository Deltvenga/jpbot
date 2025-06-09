// index.js
const bot = require('./botInstance');
// Импортируем оба обработчика из нового единого файла
const { messageHandler, callbackHandler } = require('./handlers');
const { startScheduler } = require('./scheduler');

// --- Подключение обработчиков ---

// Обработчик текстовых сообщений и команд
bot.on('message', messageHandler);

// Обработчик нажатий на инлайн-кнопки
bot.on('callback_query', callbackHandler);

// --- Запуск фоновых задач ---
startScheduler();


// --- Оповещение о запуске ---
console.log('Бот успешно запущен!');