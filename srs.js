/**
 * @file srs.js
 * @description Реализация алгоритма интервальных повторений SuperMemo-2 (SM-2).
 */

/**
 * Обновляет параметры карточки на основе алгоритма SM-2.
 * @param {object} card - Карточка для обновления.
 * @param {number} quality - Качество ответа (0-5).
 */
const updateCardSrs = (card, quality) => {
    if (quality < 3) {
        // Если ответ плохой, сбрасываем прогресс, но не убираем карточку надолго.
        card.repetition = 0;
        card.interval = 1; // Возвращаем через 1 день
    } else {
        // Рассчитываем новый E-Factor
        let newEfactor = card.efactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
        if (newEfactor < 1.3) {
            newEfactor = 1.3;
        }
        card.efactor = newEfactor;

        // Рассчитываем новый интервал с более плавным ростом
        if (card.repetition === 0) {
            card.interval = 1;
        } else if (card.repetition === 1) {
            card.interval = 4; // Было 6, но пусть первый шаг будет короче
        } else {
            // Увеличиваем интервал более значительно
            card.interval = Math.round(card.interval * card.efactor);
        }
        card.repetition += 1;
    }

    // Ограничим максимальный интервал, например, одним годом.
    if (card.interval > 365) {
        card.interval = 365;
    }

    const now = new Date();
    now.setDate(now.getDate() + card.interval);
    card.nextReviewDate = now.toISOString();

    return card;
};

module.exports = { updateCardSrs };