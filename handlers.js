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

const CARDS_PER_PAGE = 8; // Количество карточек на одной странице при просмотре

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

    if (user.state) {
        handleState(msg);
        return;
    }

    switch (text) {
        case '🧠 Изучать карточки':
            promptStudyMethod(chatId);
            break;
        case '🗂️ Мои карточки':
            promptViewCards(chatId);
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
            handleState(msg);
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
        case 'view':
            handleViewCallback(callbackQuery);
            break;
        case 'delete':
            handleDeleteCallback(callbackQuery);
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
        // --- ВОТ ОНО, ИСПРАВЛЕНИЕ: ВОЗВРАЩЕННЫЙ ОБРАБОТЧИК ---
        case 'import':
            handleImportCallback(callbackQuery);
            break;
        default:
            bot.answerCallbackQuery(callbackQuery.id);
            break;
    }
};


// =================================================================
// Обработчики основных команд и меню
// =================================================================

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
                ['🧠 Изучать карточки', '🗂️ Мои карточки'],
                ['➕ Добавить карточку', '⚙️ Настройки'],
                ['📤 Экспорт', '📥 Импорт']
            ],
            resize_keyboard: true,
        },
    });
};

/**
 * Инициирует процесс добавления новой карточки.
 * @param {number} chatId - ID чата.
 */
const startAddCardProcess = (chatId) => {
    const db = readDb();
    db[chatId].state = 'awaiting_japanese';
    writeDb(db);
    bot.sendMessage(chatId, 'Введите слово или фразу на японском:');
};

/**
 * Показывает главное меню выбора режима изучения.
 * @param {number} chatId - ID чата.
 */
const promptStudyMethod = (chatId) => {
    bot.sendMessage(chatId, 'Как будем изучать?', {
        reply_markup: {
            inline_keyboard: [
                [{ text: '📚 По темам', callback_data: 'study_by_topic' }],
                [{ text: '🔥 Только то, что пора повторить (все темы)', callback_data: 'study_due_all' }],
                [{ text: '🎲 Все подряд (случайно)', callback_data: 'study_random_all' }]
            ]
        }
    });
};

/**
 * Показывает меню просмотра карточек по статусу.
 * @param {number} chatId - ID чата.
 */
const promptViewCards = (chatId) => {
    bot.sendMessage(chatId, 'Какие карточки вы хотите посмотреть?', {
        reply_markup: {
            inline_keyboard: [
                [{ text: '🟢 Изученные', callback_data: 'view_status_learned_page_0' }],
                [{ text: '🟡 В процессе', callback_data: 'view_status_progress_page_0' }],
                [{ text: '🔴 Неизученные', callback_data: 'view_status_new_page_0' }],
            ]
        }
    });
};


// =================================================================
// Логика состояний (State Machine)
// =================================================================

/**
 * Управляет многошаговыми диалогами с пользователем.
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
                reply_markup: { remove_keyboard: true }
            });
            break;

        case 'awaiting_russian':
            user.stateData.russian = text;
            user.state = 'awaiting_topic';
            writeDb(db);
            const topicButtons = user.topics.map(topic => [topic]);
            bot.sendMessage(chatId, 'К какой теме отнести эту карточку? Вы можете выбрать существующую или написать новую.', {
                reply_markup: {
                    keyboard: topicButtons,
                    resize_keyboard: true,
                    one_time_keyboard: true,
                }
            });
            break;

        case 'awaiting_topic':
            const topic = text.trim();
            const newCard = {
                id: Date.now().toString(),
                topic: topic,
                japanese: user.stateData.japanese,
                furigana: user.stateData.furigana,
                russian: user.stateData.russian,
                repetition: 0,
                efactor: 2.5,
                interval: 0,
                nextReviewDate: new Date().toISOString(),
            };
            user.cards.push(newCard);
            if (!user.topics.includes(topic)) {
                user.topics.push(topic);
            }
            bot.sendMessage(chatId, `✅ Карточка "${newCard.japanese}" добавлена в тему "${topic}"!`, {
                reply_markup: {
                    keyboard: [
                        ['🧠 Изучать карточки', '🗂️ Мои карточки'],
                        ['➕ Добавить карточку', '⚙️ Настройки'],
                        ['📤 Экспорт', '📥 Импорт']
                    ],
                    resize_keyboard: true,
                }
            });
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
            const textLines = msg.text.split('\n').filter(line => line.trim() !== '');
            let count = 0;
            const userTopics = new Set(user.topics || []);

            for (const line of textLines) {
                const parts = line.split(',');
                if (parts.length < 2) continue;

                const topic = parts.length > 2 ? parts.pop().trim() : 'Без темы';
                const russian = parts.pop().trim();
                const japanese = parts.shift().trim();
                const furigana = parts.join(',').trim(); // Все, что осталось посередине

                if (japanese && russian) {
                    const newCard = {
                        id: `${Date.now()}-${Math.random()}`,
                        japanese,
                        furigana: furigana || '',
                        russian,
                        topic: topic || 'Без темы',
                        repetition: 0,
                        efactor: 2.5,
                        interval: 0,
                        nextReviewDate: new Date().toISOString(),
                    };
                    user.cards.push(newCard);

                    if (topic !== 'Без темы' && !userTopics.has(topic)) {
                        user.topics.push(topic);
                        userTopics.add(topic);
                    }
                    count++;
                }
            }

            bot.sendMessage(chatId, `✅ Импорт из текста завершен! Добавлено ${count} новых карточек.`);
            user.state = null;
            writeDb(db);
            break;
    }
};


// =================================================================
// Логика изучения (Callbacks)
// =================================================================

const handleStudyCallback = (callbackQuery) => {
    const { data, message } = callbackQuery;
    const chatId = message.chat.id;
    const db = readDb();
    const user = db[chatId];

    bot.deleteMessage(chatId, message.message_id).catch(() => {});

    if (data === 'study_by_topic') {
        if (!user.topics || user.topics.length === 0) {
            bot.sendMessage(chatId, 'У вас еще нет тем. Сначала добавьте карточку с темой.');
            return;
        }
        const topicButtons = user.topics.map(topic => ([{ text: topic, callback_data: `study_topic_${topic}` }]));
        bot.sendMessage(chatId, 'Выберите тему для изучения:', { reply_markup: { inline_keyboard: topicButtons } });
        return;
    }

    if (data.startsWith('study_topic_')) {
        const topic = data.replace('study_topic_', '');
        bot.sendMessage(chatId, `Тема: "${topic}". Что делаем?`, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔥 Учить то, что пора', callback_data: `study_start_due_${topic}` }],
                    [{ text: '🎲 Учить все подряд', callback_data: `study_start_all_${topic}` }],
                ]
            }
        });
        return;
    }

    let cardsToStudy = [];
    if (data === 'study_due_all') {
        cardsToStudy = user.cards.filter(c => new Date(c.nextReviewDate) <= new Date());
    } else if (data === 'study_random_all') {
        cardsToStudy = user.cards;
    } else if (data.startsWith('study_start_')) {
        const parts = data.split('_');
        const mode = parts[2];
        const topic = parts[3];
        const topicCards = user.cards.filter(c => c.topic === topic);
        if (mode === 'due') {
            cardsToStudy = topicCards.filter(c => new Date(c.nextReviewDate) <= new Date());
        } else {
            cardsToStudy = topicCards;
        }
    }

    if (cardsToStudy.length === 0) {
        bot.sendMessage(chatId, '🎉 Отлично! Карточек для изучения в этом режиме нет.');
        return;
    }

    const queue = cardsToStudy.map(c => c.id).sort(() => Math.random() - 0.5);
    user.session = { queue, currentIndex: 0 };
    writeDb(db);
    sendNextCard(chatId);
};

const sendNextCard = (chatId) => {
    const db = readDb();
    const user = db[chatId];
    const session = user.session;
    if (!session || session.currentIndex >= session.queue.length) {
        bot.sendMessage(chatId, '🎉 Отлично! Карточки на сегодня закончились.');
        user.session = {}; writeDb(db); return;
    }
    const cardId = session.queue[session.currentIndex];
    const card = user.cards.find(c => c.id === cardId);
    if (!card) {
        session.currentIndex++; writeDb(db); sendNextCard(chatId); return;
    }
    let messageText; const { settings } = user;
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

const flipCard = (callbackQuery) => {
    const { data, message, id: callbackId } = callbackQuery;
    const cardId = data.split('_')[1];
    const db = readDb();
    const user = db[message.chat.id];
    const card = user.cards.find(c => c.id === cardId);
    if (!card) { return bot.answerCallbackQuery(callbackId, { text: 'Карточка не найдена!' }); }
    const { frontSide } = user.settings;
    const frontText = frontSide === 'japanese' ? card.japanese : card.russian;
    const backText = frontSide === 'japanese' ? card.russian : card.japanese;
    let backSideMessage;
    if (frontSide === 'japanese') {
        backSideMessage = `**${frontText}**\n`;
        if (card.furigana) { backSideMessage += `*${card.furigana}*\n`; }
        backSideMessage += `---\n**${backText}**`;
    } else {
        backSideMessage = `**${frontText}**\n---\n**${backText}**\n`;
        if (card.furigana) { backSideMessage += `*${card.furigana}*\n`; }
    }
    backSideMessage += `\n\n*Статус: ${getCardStatus(card)}*`;
    bot.editMessageText(backSideMessage, {
        chat_id: message.chat.id, message_id: message.message_id, parse_mode: 'Markdown',
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
        if (cardIndex !== -1) { user.cards[cardIndex] = updateCardSrs(user.cards[cardIndex], quality); }
        bot.answerCallbackQuery(callbackId);
    }
    session.currentIndex++;
    writeDb(db);
    bot.deleteMessage(chatId, message.message_id);
    sendNextCard(chatId);
};


// =================================================================
// Логика просмотра и управления карточками
// =================================================================

const handleViewCallback = (callbackQuery) => {
    const { data, message } = callbackQuery;
    const chatId = message.chat.id;

    if (data === 'view_back_to_status') {
        bot.deleteMessage(chatId, message.message_id).catch(() => {});
        promptViewCards(chatId);
        return;
    }

    const [_action, _status, status, _page, pageStr] = data.split('_');
    const page = parseInt(pageStr, 10);
    const db = readDb();
    const user = db[chatId];
    let filteredCards = [];
    let statusTitle = '';

    if (status === 'learned') {
        filteredCards = user.cards.filter(c => c.repetition >= 5);
        statusTitle = '🟢 Изученные';
    } else if (status === 'progress') {
        filteredCards = user.cards.filter(c => c.repetition > 0 && c.repetition < 5);
        statusTitle = '🟡 В процессе';
    } else if (status === 'new') {
        filteredCards = user.cards.filter(c => c.repetition === 0);
        statusTitle = '🔴 Неизученные';
    }

    if (filteredCards.length === 0) {
        bot.answerCallbackQuery(callbackQuery.id, { text: 'В этой категории карточек нет.' });
        return;
    }

    const totalPages = Math.ceil(filteredCards.length / CARDS_PER_PAGE);
    const pageCards = filteredCards.slice(page * CARDS_PER_PAGE, (page + 1) * CARDS_PER_PAGE);

    let messageText = `*${statusTitle} (${page + 1}/${totalPages})*\n\n`;
    const keyboardRows = [];

    pageCards.forEach(card => {
        messageText += `*${card.japanese}* (${card.furigana || '–'}): ${card.russian}\nТема: _${card.topic || 'Без темы'}_\n\n`;
        keyboardRows.push([{ text: `❌ Удалить "${card.japanese}"`, callback_data: `delete_confirm_${card.id}` }]);
    });

    const paginationRow = [];
    if (page > 0) {
        paginationRow.push({ text: '⬅️ Назад', callback_data: `view_status_${status}_page_${page - 1}` });
    }
    if (page < totalPages - 1) {
        paginationRow.push({ text: 'Вперед ➡️', callback_data: `view_status_${status}_page_${page + 1}` });
    }
    if (paginationRow.length > 0) {
        keyboardRows.push(paginationRow);
    }
    keyboardRows.push([{ text: '↩️ Назад к выбору статуса', callback_data: 'view_back_to_status' }]);

    bot.editMessageText(messageText, {
        chat_id: chatId,
        message_id: message.message_id,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboardRows }
    }).catch(() => {});
    bot.answerCallbackQuery(callbackQuery.id);
};

const handleDeleteCallback = (callbackQuery) => {
    const { data, message } = callbackQuery;
    const chatId = message.chat.id;
    const [_action, command, cardId] = data.split('_');
    const db = readDb();
    const user = db[chatId];
    const card = user.cards.find(c => c.id === cardId);

    if (!card && command !== 'cancel') {
        bot.answerCallbackQuery(callbackQuery.id, { text: 'Карточка уже удалена.' });
        return;
    }

    if (command === 'confirm') {
        bot.editMessageReplyMarkup({
            inline_keyboard: [
                [{ text: `Удалить "${card.japanese}"?`, callback_data: 'delete_noop' }],
                [{ text: '✅ Да', callback_data: `delete_execute_${cardId}` }, { text: '❌ Нет', callback_data: `delete_cancel` }]
            ]
        }, { chat_id: chatId, message_id: message.message_id });
        bot.answerCallbackQuery(callbackQuery.id);
    } else if (command === 'execute') {
        user.cards = user.cards.filter(c => c.id !== cardId);
        writeDb(db);
        bot.deleteMessage(chatId, message.message_id).catch(() => {});
        bot.answerCallbackQuery(callbackQuery.id, { text: 'Карточка удалена.' });
        promptViewCards(chatId);
    } else if (command === 'cancel') {
        bot.deleteMessage(chatId, message.message_id).catch(() => {});
        bot.answerCallbackQuery(callbackQuery.id, { text: 'Удаление отменено.' });
        promptViewCards(chatId);
    }
};


// =================================================================
// Настройки и импорт/экспорт
// =================================================================

const showSettings = (chatId, messageId = null) => {
    const { settings } = readDb()[chatId];
    const frontSideText = settings.frontSide === 'japanese' ? 'Японский' : 'Русский';
    const furiganaText = settings.showFuriganaImmediately ? 'Да' : 'Нет';
    const messageText = `⚙️ **Настройки**\n- Лицевая сторона: **${frontSideText}**\n- Показывать фуригану сразу: **${furiganaText}**`;
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
        bot.editMessageText('Хорошо, вставьте ваш список в следующем сообщении.\n\nФормат:\n`японский,фуригана,русский,тема`\n`японский,русский,тема`\n`японский,русский`\n\nКаждая карточка с новой строки.', {
            chat_id: chatId, message_id: message.message_id, parse_mode: 'Markdown'
        });
    }
    writeDb(db);
    bot.answerCallbackQuery(callbackQuery.id);
};

const exportCards = (chatId) => {
    try {
        const user = readDb()[chatId];
        if (!user || !user.cards || user.cards.length === 0) {
            return bot.sendMessage(chatId, 'У вас нет карточек для экспорта.');
        }
        const header = 'japanese,furigana,russian,topic\n';
        const rows = user.cards.map(c => {
            const jap = c.japanese || ''; const furi = c.furigana || ''; const rus = c.russian || ''; const top = c.topic || '';
            return `"${jap.replace(/"/g, '""')}","${furi.replace(/"/g, '""')}","${rus.replace(/"/g, '""')}","${top.replace(/"/g, '""')}"`;
        }).join('\n');
        const fileBuffer = Buffer.from(header + rows, 'utf-8');
        bot.sendDocument(chatId, fileBuffer, {}, { filename: 'my_japanese_cards.csv', contentType: 'text/csv' });
    } catch (error) {
        console.error('[Export Error]:', error);
        bot.sendMessage(chatId, '❌ Произошла ошибка во время экспорта.');
    }
};

const processCsvImport = (chatId, fileId) => {
    // Эта функция может быть расширена для поддержки колонки "topic"
    // Пока оставим ее для обратной совместимости
    const db = readDb();
    const user = db[chatId];
    let importedCount = 0;
    bot.getFileStream(fileId).pipe(csv({ headers: ['japanese', 'furigana', 'russian', 'topic'] }))
        .on('data', (row) => {
            if (row.japanese && row.russian) {
                user.cards.push({
                    id: `${Date.now()}-${Math.random()}`,
                    japanese: row.japanese.trim(),
                    furigana: row.furigana ? row.furigana.trim() : '',
                    russian: row.russian.trim(),
                    topic: row.topic ? row.topic.trim() : 'Без темы',
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
// Экспорт
// =================================================================

module.exports = {
    messageHandler,
    callbackHandler
};