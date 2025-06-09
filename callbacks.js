// Внутри файла callbacks.js

const flipCard = (callbackQuery) => {
    const { data, message, id: callbackId } = callbackQuery;
    const cardId = data.split('_')[1];
    const db = readDb();
    const user = db[message.chat.id];
    const card = user.cards.find(c => c.id === cardId);

    if (!card) return bot.answerCallbackQuery(callbackId, { text: 'Карточка не найдена!' });

    const frontText = user.settings.frontSide === 'japanese' ? card.japanese : card.russian;
    const backText = user.settings.frontSide === 'japanese' ? card.russian : card.japanese;

    // --- ИЗМЕНЕНИЕ НАЧАЛОСЬ ---
    // Формируем текст обратной стороны с фуриганой
    let backSideMessage;

    if (user.settings.frontSide === 'japanese') {
        // Если лицевая сторона - японский, то на обороте показываем фуригану и русский
        backSideMessage = `**${frontText}**\n`;
        // Добавляем фуригану, только если она есть
        if (card.furigana) {
            backSideMessage += `*${card.furigana}*\n`;
        }
        backSideMessage += `---\n**${backText}**`;
    } else {
        // Если лицевая сторона - русский, то на обороте показываем японский и фуригану
        backSideMessage = `**${frontText}**\n---\n**${backText}**\n`;
        if (card.furigana) {
            backSideMessage += `*${card.furigana}*\n`;
        }
    }

    backSideMessage += `\n\n*Статус: ${getCardStatus(card)}*`;
    // --- ИЗМЕНЕНИЕ ЗАКОНЧИЛОСЬ ---

    bot.editMessageText(backSideMessage, { // Используем новую переменную
        chat_id: message.chat.id,
        message_id: message.message_id,
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: '❌ Не помню', callback_data: `rate_0_${card.id}` }, { text: '🤔 Плохо', callback_data: `rate_3_${card.id}` }, { text: '✅ Помню', callback_data: `rate_4_${card.id}` }]
            ]
        }
    });
    bot.answerCallbackQuery(callbackId);
};