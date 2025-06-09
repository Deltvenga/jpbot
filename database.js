// database.js
const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, 'db.json');

const readDb = () => {
    if (!fs.existsSync(dbPath)) {
        return {};
    }
    try {
        const data = fs.readFileSync(dbPath);
        return JSON.parse(data);
    } catch (error) {
        console.error('Ошибка чтения db.json:', error);
        return {};
    }
};

const writeDb = (data) => {
    try {
        fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('Ошибка записи в db.json:', error);
    }
};

const initUser = (chatId) => {
    const db = readDb();
    if (!db[chatId]) {
        db[chatId] = {
            cards: [],
            settings: {
                frontSide: 'japanese',
                // НОВОЕ ПОЛЕ:
                showFuriganaImmediately: false,
            },
            session: {},
            state: null,
            stateData: {},
        };
        writeDb(db);
    }
    return db[chatId];
};

module.exports = { readDb, writeDb, initUser };