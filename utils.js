// utils.js

// Определяет "уровень изученности" на основе данных SM-2 для отображения пользователю
const getCardStatus = (card) => {
    if (card.repetition === 0) return 'не изучена';
    if (card.repetition > 0 && card.repetition <= 2) return 'слегка изучена';
    if (card.repetition > 2 && card.repetition <= 5) return 'почти изучена';
    return 'изучена';
};

module.exports = { getCardStatus };