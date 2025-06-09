// commands.js
const bot = require('./botInstance');
const { readDb, writeDb, initUser } = require('./database');
const csv = require('csv-parser');

// ❌ УДАЛЯЕМ ЭТУ СТРОКУ С ВЕРХНЕГО УРОВНЯ:
// const { startStudySession, showSettings } = require('./callbacks');

// --- Обработчик текстовых сообщений ---

const messageHandler = (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!text) return;
    if (text.startsWith('/')) {
        if (text === '/start') {
            handleStart(msg);
        }
        return;
    }

    const db = readDb();
    const user = db[chatId] || initUser(chatId);

    if (user.state) {
        handleState(msg);
        return;
    }

    switch (text) {
        case '🧠 Изучать карточки':
            // ✅ ИМПОРТИРУЕМ ФУНКЦИЮ ПРЯМО ЗДЕСЬ, КОГДА ОНА НУЖНА
            require('./callbacks').startStudySession(chatId);
            break;
        case '➕ Добавить карточку':
            startAddCardProcess(chatId);
            break;
        case '⚙️ Настройки':
            // ✅ И ДЕЛАЕМ ТО ЖЕ САМОЕ ДЛЯ НАСТРОЕК
            require('./callbacks').showSettings(chatId);
            break;
        case '📤 Экспорт':
            exportCards(chatId);
            break;
        case '📥 Импорт':
            importCards(chatId);
            break;
        case 'Пропустить':
            bot.sendMessage(chatId, 'Используйте эту кнопку, когда я прошу ввести фуригану.');
            break;
    }
};

// --- Остальной код файла остается без изменений ---

const handleStart = (msg) => {
    const chatId = msg.chat.id;
    initUser(chatId);
    const welcomeMessage = `Привет, ${msg.from.first_name}! Я бот для изучения японских слов.`;
    bot.sendMessage(chatId, welcomeMessage, {
        reply_markup: {
            keyboard: [
                ['🧠 Изучать карточки'],
                ['➕ Добавить карточку', '⚙️ Настройки'],
                ['📤 Экспорт', '📥 Импорт']
            ],
            resize_keyboard: true,
        },
    });
};

const startAddCardProcess = (chatId) => {
    const db = readDb();
    db[chatId].state = 'awaiting_japanese';
    writeDb(db);
    bot.sendMessage(chatId, 'Введите слово или фразу на японском:');
};

const handleState = (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    const db = readDb();
    const user = db[chatId];

    switch (user.state) {
        case 'awaiting_japanese':
            user.stateData = { japanese: text };
            user.state = 'awaiting_furigana';
            writeDb(db);
            bot.sendMessage(chatId, 'Отлично. Теперь введите фуригану (чтение на хирагане):', {
                reply_markup: {
                    keyboard: [['Пропустить']],
                    resize_keyboard: true,
                    one_time_keyboard: true,
                }
            });
            break;

        case 'awaiting_furigana':
            user.stateData.furigana = (text === 'Пропустить') ? '' : text;
            user.state = 'awaiting_russian';
            writeDb(db);
            bot.sendMessage(chatId, 'Понял. Теперь введите перевод на русском:', {
                reply_markup: {
                    keyboard: [
                        ['🧠 Изучать карточки'],
                        ['➕ Добавить карточку', '⚙️ Настройки'],
                        ['📤 Экспорт', '📥 Импорт']
                    ],
                    resize_keyboard: true,
                }
            });
            break;

        case 'awaiting_russian':
            const newCard = {
                id: Date.now().toString(),
                japanese: user.stateData.japanese,
                furigana: user.stateData.furigana,
                russian: text,
                repetition: 0,
                efactor: 2.5,
                interval: 0,
                nextReviewDate: new Date().toISOString()
            };
            user.cards.push(newCard);
            user.state = null;
            user.stateData = {};
            writeDb(db);
            bot.sendMessage(chatId, `✅ Карточка "${newCard.japanese} - ${newCard.russian}" успешно добавлена!`);
            break;

        case 'awaiting_csv':
            if (msg.document && msg.document.mime_type.includes('csv')) {
                processCsvImport(chatId, msg.document.file_id);
            } else {
                bot.sendMessage(chatId, 'Пожалуйста, отправьте файл в формате CSV.');
            }
            user.state = null;
            writeDb(db);
            break;
    }
};

const exportCards = (chatId) => {
    const user = readDb()[chatId];
    if (!user.cards || user.cards.length === 0) {
        return bot.sendMessage(chatId, 'У вас нет карточек для экспорта.');
    }
    const header = 'japanese,furigana,russian\n';
    const rows = user.cards.map(c =>
        `"${c.japanese.replace(/"/g, '""')}","${(c.furigana || '').replace(/"/g, '""')}","${c.russian.replace(/"/g, '""')}"`
    ).join('\n');

    bot.sendDocument(chatId, Buffer.from(header + rows, 'utf-8'), {}, {
        filename: 'my_japanese_cards.csv',
        contentType: 'text/csv'
    });
};

const importCards = (chatId) => {
    const db = readDb();
    db[chatId].state = 'awaiting_csv';
    writeDb(db);
    bot.sendMessage(chatId, 'Отправьте мне CSV-файл для импорта. Формат: три колонки (japanese, furigana, russian). Без заголовков.');
};

const processCsvImport = (chatId, fileId) => {
    const db = readDb();
    const user = db[chatId];
    let importedCount = 0;

    bot.getFileStream(fileId).pipe(csv({ headers: ['japanese', 'furigana', 'russian'] }))
        .on('data', (row) => {
            if (row.japanese && row.russian) {
                user.cards.push({
                    id: `${Date.now()}-${Math.random()}`,
                    japanese: row.japanese.trim(),
                    furigana: row.furigana ? row.furigana.trim() : '',
                    russian: row.russian.trim(),
                    repetition: 0,
                    efactor: 2.5,
                    interval: 0,
                    nextReviewDate: new Date().toISOString()
                });
                importedCount++;
            }
        })
        .on('end', () => {
            writeDb(db);
            bot.sendMessage(chatId, `✅ Импорт завершен! Добавлено ${importedCount} новых карточек.`);
        });
};

module.exports = { messageHandler };