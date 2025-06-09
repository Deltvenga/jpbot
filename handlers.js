/**
 * @file handlers.js
 * @description Основной файл для обработки всех входящих сообщений и callback-запросов от пользователя.
 */

// --- Импорты модулей ---
const bot = require('./botInstance');
const { readDb, writeDb, initUser } = require('./database');
const { updateCardSrs } = require('./srs');
const { getCardStatus } = require('./utils');
const csv = require('csv-parser');

// =================================================================
//  Главные обработчики (точки входа)
// =================================================================

/**
 * Обрабатывает все входящие текстовые сообщения и команды.
 * @param {TelegramBot.Message} msg - Объект сообщения от Telegram.
 */
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

    const user = readDb()[chatId] || initUser(chatId);

    // Если пользователь в процессе многошагового действия, передаем управление стейт-менеджеру.
    if (user.state) {
        handleState(msg);
        return;
    }

    // Обработка кнопок основного меню.
    switch (text) {
        case '🧠 Изучать карточки':
            startStudySession(chatId);
            break;
        case '➕ Добавить карточку':
            startAddCardProcess(chatId);
            break;
        case '⚙️ Настройки':
            showSettings(chatId);
            break;
        case '📤 Экспорт':
            exportCards(chatId);
            break;
        case '📥 Импорт':
            promptImportMethod(chatId);
            break;
        case 'Пропустить':
            bot.sendMessage(chatId, 'Используйте эту кнопку, когда я прошу ввести фуригану.');
            break;
    }
};

/**
 * Обрабатывает все нажатия на инлайн-кнопки (callback_query).
 * @param {TelegramBot.CallbackQuery} callbackQuery - Объект callback-запроса от Telegram.
 */
const callbackHandler = (callbackQuery) => {
    const { data } = callbackQuery;
    const [action] = data.split('_');

    switch (action) {
        case 'study':
            handleStudyCallback(callbackQuery);
            break;
        case 'flip':
            flipCard(callbackQuery);
            break;
        case 'rate':
            rateCard(callbackQuery);
            break;
        case 'settings':
            handleSettingsCallback(callbackQuery);
            break;
        case 'import':
            handleImportCallback(callbackQuery);
            break;
        default:
            bot.answerCallbackQuery(callbackQuery.id);
            break;
    }
};


// =================================================================
// Обработчики основных команд и действий
// =================================================================

/**
 * Обрабатывает команду /start, приветствует пользователя и показывает главное меню.
 * @param {TelegramBot.Message} msg - Объект сообщения.
 */
const handleStart = (msg) => {
    const chatId = msg.chat.id;
    initUser(chatId);
    bot.sendMessage(chatId, `Привет, ${msg.from.first_name}! Я бот для изучения японских слов.`, {
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

/**
 * Инициирует процесс добавления новой карточки, переводя пользователя в состояние ожидания.
 * @param {number} chatId - ID чата.
 */
const startAddCardProcess = (chatId) => {
    const db = readDb();
    db[chatId].state = 'awaiting_japanese';
    writeDb(db);
    bot.sendMessage(chatId, 'Введите слово или фразу на японском:');
};

/**
 * Экспортирует карточки пользователя в CSV-файл.
 * @param {number} chatId - ID чата.
 */
/**
 * Экспортирует карточки пользователя в CSV-файл.
 * @param {number} chatId - ID чата.
 */
const exportCards = (chatId) => {
    try {
        const user = readDb()[chatId];

        if (!user || !user.cards || user.cards.length === 0) {
            return bot.sendMessage(chatId, 'У вас нет карточек для экспорта.');
        }

        const header = 'japanese,furigana,russian\n';

        const rows = user.cards.map(c => {
            const jap = c.japanese || '';
            const furi = c.furigana || '';
            const rus = c.russian || '';
            return `"${jap.replace(/"/g, '""')}","${furi.replace(/"/g, '""')}","${rus.replace(/"/g, '""')}"`;
        }).join('\n');

        if (!rows) {
            console.error(`[Export Error] Ошибка: строки CSV пусты, хотя карточки в базе есть для пользователя ${chatId}.`);
            return bot.sendMessage(chatId, 'Произошла ошибка при формировании файла. Пожалуйста, проверьте данные ваших карточек.');
        }

        const csvContent = header + rows;
        const fileBuffer = Buffer.from(csvContent, 'utf-8');

        bot.sendDocument(chatId, fileBuffer, {}, {
            filename: 'my_japanese_cards.csv',
            contentType: 'text/csv'
        });

    } catch (error) {
        console.error('[Export Error] Произошла критическая ошибка при экспорте:', error);
        bot.sendMessage(chatId, '❌ Произошла непредвиденная ошибка во время экспорта. Администратор уже уведомлен (в консоли).');
    }
};

/**
 * Показывает пользователю выбор метода импорта: файлом или текстом.
 * @param {number} chatId - ID чата.
 */
const promptImportMethod = (chatId) => {
    bot.sendMessage(chatId, 'Как вы хотите импортировать карточки?', {
        reply_markup: {
            inline_keyboard: [
                [{ text: '📎 Файлом', callback_data: 'import_method_file' }],
                [{ text: '📝 Текстом', callback_data: 'import_method_text' }]
            ]
        }
    });
};

// =================================================================
// Логика состояний (State Machine)
// =================================================================

/**
 * Управляет многошаговыми диалогами с пользователем (добавление карточки, импорт).
 * @param {TelegramBot.Message} msg - Объект сообщения.
 */
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
                reply_markup: { keyboard: [['Пропустить']], resize_keyboard: true, one_time_keyboard: true },
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
                    resize_keyboard: true
                },
            });
            break;

        case 'awaiting_russian':
            const newCard = {
                id: Date.now().toString(),
                japanese: user.stateData.japanese,
                furigana: user.stateData.furigana,
                russian: text,
                repetition: 0, efactor: 2.5, interval: 0,
                nextReviewDate: new Date().toISOString(),
            };
            user.cards.push(newCard);
            bot.sendMessage(chatId, `✅ Карточка "${newCard.japanese} - ${newCard.russian}" успешно добавлена!`);
            user.state = null;
            user.stateData = {};
            writeDb(db);
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

        case 'awaiting_csv_text':
            const lines = text.split('\n').filter(line => line.trim() !== '');
            let importedCount = 0;
            for (const line of lines) {
                const parts = line.split(',');
                if (parts.length < 2) continue;

                const japanese = parts[0]?.trim();
                const furigana = (parts.length === 3) ? parts[1]?.trim() : '';
                const russian = (parts.length === 3) ? parts[2]?.trim() : parts[1]?.trim();

                if (japanese && russian) {
                    user.cards.push({
                        id: `${Date.now()}-${Math.random()}`,
                        japanese, furigana, russian,
                        repetition: 0, efactor: 2.5, interval: 0,
                        nextReviewDate: new Date().toISOString(),
                    });
                    importedCount++;
                }
            }
            bot.sendMessage(chatId, `✅ Импорт из текста завершен! Добавлено ${importedCount} новых карточек.`);
            user.state = null;
            writeDb(db);
            break;
    }
};

/**
 * Парсит и импортирует карточки из предоставленного CSV файла.
 * @param {number} chatId - ID чата.
 * @param {string} fileId - ID файла в Telegram.
 */
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
                    repetition: 0, efactor: 2.5, interval: 0,
                    nextReviewDate: new Date().toISOString(),
                });
                importedCount++;
            }
        })
        .on('end', () => {
            writeDb(db);
            bot.sendMessage(chatId, `✅ Импорт завершен! Добавлено ${importedCount} новых карточек.`);
        });
};


// =================================================================
// Логика инлайн-кнопок (Callbacks)
// =================================================================

/**
 * Отправляет сообщение с выбором режима изучения.
 * @param {number} chatId - ID чата.
 */
const startStudySession = (chatId) => {
    bot.sendMessage(chatId, 'Выберите режим изучения:', {
        reply_markup: {
            inline_keyboard: [
                [{ text: '🔥 Только те, что пора повторить', callback_data: 'study_mode_unlearned' }],
                [{ text: '🎲 Все карточки подряд (случайно)', callback_data: 'study_mode_all' }],
            ],
        },
    });
};

/**
 * Обрабатывает выбор режима изучения и запускает сессию.
 * @param {TelegramBot.CallbackQuery} callbackQuery - Объект callback-запроса.
 */
const handleStudyCallback = (callbackQuery) => {
    const { data, message } = callbackQuery;
    const chatId = message.chat.id;
    const [_action, _mode, modeType] = data.split('_');

    const db = readDb();
    const user = db[chatId];
    if (!user.cards || user.cards.length === 0) {
        bot.answerCallbackQuery(callbackQuery.id, { text: "Сначала добавьте карточки!" });
        return;
    }

    const cardsToReview = (modeType === 'unlearned')
        ? user.cards.filter(c => new Date(c.nextReviewDate) <= new Date())
        : user.cards;

    const queue = cardsToReview.map(c => c.id).sort(() => Math.random() - 0.5);

    if (queue.length === 0) {
        bot.editMessageText('🎉 На сегодня карточек для повторения нет!', {
            chat_id: chatId,
            message_id: message.message_id
        });
        return;
    }

    user.session = { queue, currentIndex: 0 };
    writeDb(db);

    bot.deleteMessage(chatId, message.message_id);
    sendNextCard(chatId);
};

/**
 * Отправляет следующую карточку в сессии изучения.
 * @param {number} chatId - ID чата.
 */
const sendNextCard = (chatId) => {
    const db = readDb();
    const user = db[chatId];
    const session = user.session;
    if (!session || session.currentIndex >= session.queue.length) {
        bot.sendMessage(chatId, '🎉 Отлично! Карточки на сегодня закончились.');
        user.session = {};
        writeDb(db);
        return;
    }

    const cardId = session.queue[session.currentIndex];
    const card = user.cards.find(c => c.id === cardId);
    if (!card) {
        session.currentIndex++;
        writeDb(db);
        sendNextCard(chatId);
        return;
    }

    let messageText;
    const { settings } = user;
    if (settings.frontSide === 'japanese' && settings.showFuriganaImmediately && card.furigana) {
        messageText = `**${card.japanese}**\n*${card.furigana}*`;
    } else {
        messageText = `**${settings.frontSide === 'japanese' ? card.japanese : card.russian}**`;
    }
    messageText += `\n\n*Статус: ${getCardStatus(card)}*`;

    bot.sendMessage(chatId, messageText, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [[
                { text: '🔄 Перевернуть', callback_data: `flip_${card.id}` },
                { text: '✅ Отлично помню!', callback_data: `rate_5_${card.id}` }
            ]]
        },
    });
};

/**
 * "Переворачивает" карточку, показывая ее обратную сторону и кнопки оценки.
 * @param {TelegramBot.CallbackQuery} callbackQuery - Объект callback-запроса.
 */
const flipCard = (callbackQuery) => {
    const { data, message, id: callbackId } = callbackQuery;
    const cardId = data.split('_')[1];

    const db = readDb();
    const user = db[message.chat.id];
    const card = user.cards.find(c => c.id === cardId);
    if (!card) {
        return bot.answerCallbackQuery(callbackId, { text: 'Карточка не найдена!' });
    }

    const { frontSide } = user.settings;
    const frontText = frontSide === 'japanese' ? card.japanese : card.russian;
    const backText = frontSide === 'japanese' ? card.russian : card.japanese;

    let backSideMessage;
    if (frontSide === 'japanese') {
        backSideMessage = `**${frontText}**\n`;
        if (card.furigana) {
            backSideMessage += `*${card.furigana}*\n`;
        }
        backSideMessage += `---\n**${backText}**`;
    } else {
        backSideMessage = `**${frontText}**\n---\n**${backText}**\n`;
        if (card.furigana) {
            backSideMessage += `*${card.furigana}*\n`;
        }
    }
    backSideMessage += `\n\n*Статус: ${getCardStatus(card)}*`;

    bot.editMessageText(backSideMessage, {
        chat_id: message.chat.id,
        message_id: message.message_id,
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: '❌ Не помню', callback_data: `rate_0_${card.id}` },
                    { text: '🤔 Плохо', callback_data: `rate_3_${card.id}` },
                    { text: '✅ Помню', callback_data: `rate_4_${card.id}` }]
            ]
        },
    });
    bot.answerCallbackQuery(callbackId);
};

/**
 * Обрабатывает оценку карточки, обновляет ее SRS-статус и показывает следующую.
 * @param {TelegramBot.CallbackQuery} callbackQuery - Объект callback-запроса.
 */
const rateCard = (callbackQuery) => {
    const { data, message, id: callbackId } = callbackQuery;
    const [_action, qualityStr, cardId] = data.split('_');
    const quality = parseInt(qualityStr, 10);
    const chatId = message.chat.id;

    const db = readDb();
    const user = db[chatId];
    const session = user.session;
    if (!session || !session.queue) {
        bot.answerCallbackQuery(callbackId, { text: 'Сессия изучения не найдена.' });
        bot.deleteMessage(chatId, message.message_id);
        return;
    }

    if (quality < 4) {
        const failedCardId = session.queue[session.currentIndex];
        session.queue.push(failedCardId);
        bot.answerCallbackQuery(callbackId, { text: 'Хорошо, вернемся к этой карточке позже.' });
    } else {
        const cardIndex = user.cards.findIndex(c => c.id === cardId);
        if (cardIndex !== -1) {
            user.cards[cardIndex] = updateCardSrs(user.cards[cardIndex], quality);
        }
        bot.answerCallbackQuery(callbackId);
    }

    session.currentIndex++;
    writeDb(db);

    bot.deleteMessage(chatId, message.message_id);
    sendNextCard(chatId);
};

/**
 * Показывает меню настроек или обновляет его.
 * @param {number} chatId - ID чата.
 * @param {number|null} messageId - ID сообщения для редактирования (если есть).
 */
const showSettings = (chatId, messageId = null) => {
    const { settings } = readDb()[chatId];

    const frontSideText = settings.frontSide === 'japanese' ? 'Японский' : 'Русский';
    const furiganaText = settings.showFuriganaImmediately ? 'Да' : 'Нет';

    const messageText = `⚙️ **Настройки**
- Лицевая сторона: **${frontSideText}**
- Показывать фуригану сразу: **${furiganaText}**`;

    const keyboard = {
        inline_keyboard: [
            [{ text: `Сменить лицевую сторону на "${settings.frontSide === 'japanese' ? 'Русский' : 'Японский'}"`, callback_data: 'settings_toggle_front' }],
            [{ text: settings.showFuriganaImmediately ? "Не показывать фуригану сразу" : "Показывать фуригану сразу", callback_data: 'settings_toggle_furigana' }]
        ]
    };

    if (messageId) {
        bot.editMessageText(messageText, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: keyboard }).catch(() => {});
    } else {
        bot.sendMessage(chatId, messageText, { parse_mode: 'Markdown', reply_markup: keyboard });
    }
};

/**
 * Обрабатывает нажатия кнопок в меню настроек.
 * @param {TelegramBot.CallbackQuery} callbackQuery - Объект callback-запроса.
 */
const handleSettingsCallback = (callbackQuery) => {
    const { data, message, id: callbackId } = callbackQuery;
    const db = readDb();
    const user = db[message.chat.id];
    let isChanged = false;

    if (data === 'settings_toggle_front') {
        user.settings.frontSide = user.settings.frontSide === 'japanese' ? 'russian' : 'japanese';
        bot.answerCallbackQuery(callbackId, { text: `Лицевая сторона изменена!` });
        isChanged = true;
    } else if (data === 'settings_toggle_furigana') {
        user.settings.showFuriganaImmediately = !user.settings.showFuriganaImmediately;
        bot.answerCallbackQuery(callbackId, { text: `Настройка показа фуриганы изменена!` });
        isChanged = true;
    }

    if (isChanged) {
        writeDb(db);
        showSettings(message.chat.id, message.message_id);
    } else {
        bot.answerCallbackQuery(callbackId);
    }
};

/**
 * Обрабатывает выбор метода импорта.
 * @param {TelegramBot.CallbackQuery} callbackQuery - Объект callback-запроса.
 */
const handleImportCallback = (callbackQuery) => {
    const { data, message } = callbackQuery;
    const chatId = message.chat.id;
    const method = data.split('_')[2];
    const db = readDb();

    if (method === 'file') {
        db[chatId].state = 'awaiting_csv';
        bot.editMessageText('Отлично, отправьте мне CSV-файл.', { chat_id: chatId, message_id: message.message_id });
    } else if (method === 'text') {
        db[chatId].state = 'awaiting_csv_text';
        bot.editMessageText('Хорошо, вставьте ваш список в следующем сообщении.\n\nФормат:\n`слово,фуригана,перевод`\n`слово,перевод`\n\nКаждая карточка с новой строки.', {
            chat_id: chatId, message_id: message.message_id, parse_mode: 'Markdown'
        });
    }

    writeDb(db);
    bot.answerCallbackQuery(callbackQuery.id);
};


// =================================================================
// Экспорт
// =================================================================

module.exports = {
    messageHandler,
    callbackHandler
};