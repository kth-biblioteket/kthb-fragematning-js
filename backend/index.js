
const express = require('express');
const compression = require('compression');
const mysql = require('mysql'); 
const util = require('util');
const basicAuth = require('express-basic-auth');
const config = require('./config.json');
const jsonexport = require('jsonexport/dist')

const app = express();
const apiRoutes = express.Router();
app.use(config.app_path, express.static("../frontend/dist"));
//app.use(express.static('../frontend/dist'));
app.use(express.json());

// Överflödigt då Apache på Lafand numera sköter detta.  TODO:
// Fungerar ändå inte genom EZproxy. Vet inte om det finns något bra
// sätt runt detta. "Option AllowSendGZip" verkar inte hjälpa; testa
// att skicka datan som JS eller nåt i stället för JSON?
app.use(compression());

const basicAuthMW = basicAuth({
    users: config.users,
    challenge: true,
    realm: 'fragematning'
});

const db = mysql.createPool(config.db);

// Skapa funktion som hanterar SQL-frågor med promises.
db.pquery = util.promisify(db.query).bind(db);

function localizeDate (date) {
    return new Date(date.getTime() - (date.getTimezoneOffset() * 60000));
}

function formatEntry (entry) {
    // Hellre skulle man använda CONVERT_TZ() i SQL-frågan, men
    // beroende på servermiljön finns inte alltid stöd för
    // tidszons-koder, vilket nog ställer till problem i fråga om DST.
    //
    // Notera att MySQL-funktioner som HOUR(), WEEKDAY()
    // etc. automatiskt anpassar datumet till serverns tidszon, varför
    // HOUR(question_date) etc. inte behöver justeras här.
    entry.question_date = localizeDate(entry.question_date);
    entry.created_at = localizeDate(entry.created_at);
    return entry;
}

(async function () {
    console.log("start")
    await db.pquery(`
        CREATE TABLE IF NOT EXISTS categories (
            id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(255),
            sort_order VARCHAR(255) NOT NULL DEFAULT '',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
        CHARACTER SET utf8mb4 COLLATE utf8mb4_swedish_ci`);

    await db.pquery(`
        CREATE TABLE IF NOT EXISTS questions (
            id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
            user VARCHAR(32),
            description VARCHAR(255) NOT NULL,
            info VARCHAR(255),
            category INT NOT NULL,
            requires VARCHAR(255),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
        CHARACTER SET utf8mb4 COLLATE utf8mb4_swedish_ci`);

    await db.pquery(`
        CREATE TABLE IF NOT EXISTS entries (
            id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
            user VARCHAR(32) NOT NULL,
            question INT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            question_date DATETIME DEFAULT CURRENT_TIMESTAMP,
            type VARCHAR(64) NOT NULL,
            location VARCHAR(64) NOT NULL,
            comment TEXT,
            INDEX (user),
            INDEX (question),
            INDEX (type),
            INDEX (location)
        )
        CHARACTER SET utf8mb4 COLLATE utf8mb4_swedish_ci`);
})();

apiRoutes.get('/categories', async (req, res) => {
    try {
        const categories = await db.pquery('SELECT * FROM categories ORDER BY sort_order, name');

        if (req.query.count_entries) {
            const counts = await db.pquery('SELECT category, count(*) as c_count FROM entries a JOIN questions b ON a.question = b.id GROUP BY category');
            categories.forEach(c => {
                c.entry_count = counts.find(r => r.category === c.id) || 0;
            });
        }

        res.send(categories);
    } catch (error) {
        console.log(error);
        res.status(500).end();
    }
});

apiRoutes.put('/categories', basicAuthMW, async (req, res) => {
    try {
        for (row of req.body) {
            await db.pquery('INSERT INTO categories SET ? ON DUPLICATE KEY UPDATE ? ', [row, row]);
        }
        res.send(req.body);
    } catch (error) {
        console.log(error);
        res.status(500).end();
    }
});

apiRoutes.delete('/categories/:id', basicAuthMW, async (req, res) => {
    try {
        await db.pquery('DELETE FROM categories WHERE id = ?', req.params.id);
        await db.pquery('DELETE FROM questions WHERE category = ?', req.params.id);
        res.type('text/plain').send();
    } catch (error) {
        console.log(error);
        res.status(500).end();
    }
});

apiRoutes.get('/questions', async (req, res) => {
    try {
        const userFilter = req.query.user
              ? `WHERE a.user IS NULL OR FIND_IN_SET(${db.escape(req.query.user)}, a.user )`
              : '';
        const questions = await db.pquery(`
            SELECT a.*, b.name AS category, b.id AS categoryId
                FROM questions a JOIN categories b
                ON a.category = b.id ${userFilter}
                ORDER BY b.sort_order, b.name, description`);

        if (req.query.count_entries) {
            const counts = await db.pquery('SELECT question, count(*) FROM entries GROUP BY question');
            questions.forEach(q => {
                q.entry_count = counts.find(r => r.question === q.id) || 0;
            });
        }

        res.send(questions);
    } catch (error) {
        console.log(error);
        res.status(500).end();
    }
});

apiRoutes.put('/questions', basicAuthMW, async (req, res) => {
    try {
        for (row of req.body) {
            await db.pquery('INSERT INTO questions SET ? ON DUPLICATE KEY UPDATE ? ', [row, row]);
        }
        res.send(req.body);
    } catch (error) {
        console.log(error);
        res.status(500).end();
    }
});

apiRoutes.delete('/questions/:id', basicAuthMW, async (req, res) => {
    try {
        await db.pquery('DELETE FROM questions WHERE id = ?', req.params.id);
        res.type('text/plain').send();
    } catch (error) {
        console.log(error);
        res.status(500).end();
    }
});

apiRoutes.get('/entries', async (req, res) => {
    try {
        const columnsMap = {
            'user': 'a.user',
            'type': 'a.type',
            'location': 'a.location',
            'categoryId': 'c.id',
            'weekday': 'WEEKDAY(a.question_date)',
            'date': 'a.question_date',
            'hour': 'HOUR(a.question_date)',
            'comment': 'a.comment'
        }

        let query =
            `SELECT
                a.*,
                HOUR(a.question_date) AS hour,
                WEEKDAY(a.question_date) AS weekday,
                WEEK(a.question_date, 3) AS week,
                YEAR(a.question_date) AS year,
                b.description AS question,
                b.id AS questionId,
                c.name AS category,
                c.id AS categoryId
            FROM entries a JOIN questions b JOIN categories c
            ON a.question = b.id AND b.category = c.id`;

        if (req.query.where) {
            // Komplexa villkor hanteras inte, men det är inte nödvändigt.
            const conditions = req.query.where
                .split(';')
                .map(c => {
                    const parts = c.match(/([^\s=<>]+)\s*(=|>=|<=|<>)(.*)/);
                    const value = /^\d+$/.test(parts[3]) ? parseInt(parts[3]) : parts[3];
                    if (value === 'NULL') {
                        return columnsMap[parts[1]] + (parts[2] === '<>' ? ' IS NOT NULL' : ' IS NULL');
                    } else {
                        return parts && columnsMap[parts[1]]
                            ? columnsMap[parts[1]] + parts[2] + db.escape(value)
                            : false;
                    }
                })
                .filter(c => c)
                .join(' AND ');
            if (conditions)
                query += ' WHERE ' + conditions;
        }

        const entries = await db.pquery(query);
        entries.forEach(e => formatEntry(e));

        if (req.query.format === 'csv') {
            // Formatera CSV lite annorlunda.
            const CSVentries = entries.map(e => {
                const weekday = ['måndag', 'tisdag', 'onsdag', 'torsdag', 'fredag', 'lördag', 'söndag'][e.weekday];

                return {
                    'Databas-ID': e.id,
                    'Användare': e.user,
                    'Fråga': e.question,
                    'Kategori': e.category,
                    'Typ': e.type,
                    'Plats': e.location,
                    'År': e.year,
                    'Datum': e.question_date.toISOString().slice(0, 10),
                    'Tid': e.question_date.toISOString().slice(11, 19),
                    'Timma': e.hour,
                    'Veckodag': weekday,
                    'Kommentar': e.comment
                }
            });

            res.type('text/csv');
            res.attachment('Frågemätning.csv');
            res.send(await jsonexport(CSVentries, { forceTextDelimiter: true }));
        } else {
            res.send(entries);
        }
    } catch (error) {
        console.log(error);
        res.status(500).end();
    }
});

apiRoutes.post('/add', async (req, res) => {
    try {
        const result = await db.pquery('INSERT INTO entries SET ?', req.body);
        const entry = await db.pquery(`
            SELECT a.*, b.description, b.info FROM entries a JOIN questions b
                ON a.question = b.id
                WHERE a.id = ?`, result.insertId);

        res.send(formatEntry(entry[0]));
    } catch (error) {
        console.log(error);
        res.status(400).end();
    }
});

apiRoutes.get('/undo/:id', async (req, res) => {
    try {
        await db.pquery('DELETE FROM entries WHERE id = ?', req.params.id);
        res.type('text/plain').send();
    } catch (error) {
        console.log(error);
        res.status(400).end();
    }
});

apiRoutes.get('/auth', basicAuthMW, (req, res) => {
    res.type('text/plain').send();
});

apiRoutes.get('/admin', basicAuthMW, (req, res) => {
    console.log("admin")
    res.sendFile(__dirname.replace(/\w*$/, '') + 'frontend/dist/index.html');
});

apiRoutes.get(/^\/\w+$/, (req, res) => {
    console.log("test")
    res.sendFile(__dirname.replace(/\w*$/, '') + 'frontend/dist/index.html');
});

app.use(config.app_path, apiRoutes);

app.listen(config.port);
