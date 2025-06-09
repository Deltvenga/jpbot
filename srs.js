// srs.js

/**
 * Обновляет параметры карточки на основе алгоритма SM-2.
 * @param {object} card - Карточка для обновления.
 * @param {number} quality - Качество ответа (0-5). 0 - не помню, 3 - плохо, 4 - помню, 5 - отлично.
 */
const updateCardSrs = (card, quality) => {
    if (quality < 3) {
        card.repetition = 0;
        card.interval = 1;
    } else {
        let newEfactor = card.efactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
        if (newEfactor < 1.3) newEfactor = 1.3;
        card.efactor = newEfactor;

        if (card.repetition === 0) {
            card.interval = 1;
        } else if (card.repetition === 1) {
            card.interval = 6;
        } else {
            card.interval = Math.round(card.interval * card.efactor);
        }
        card.repetition += 1;
    }

    const now = new Date();
    now.setDate(now.getDate() + card.interval);
    card.nextReviewDate = now.toISOString();

    return card;
};

module.exports = { updateCardSrs };