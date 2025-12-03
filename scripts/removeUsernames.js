const fs = require('fs').promises;
const path = require('path');

const usersDir = path.join(__dirname, '..', 'data', 'users');

async function removeUsernames() {
    try {
        const files = await fs.readdir(usersDir);
        let count = 0;
        for (const file of files) {
            if (!file.endsWith('.json')) continue;
            const filePath = path.join(usersDir, file);
            try {
                const raw = await fs.readFile(filePath, 'utf8');
                const data = JSON.parse(raw);
                if (data.username) {
                    delete data.username;
                    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
                    count++;
                }
            } catch (err) {
                console.error(`Error processing ${file}:`, err);
            }
        }
        console.log(`Removed username from ${count} files.`);
    } catch (err) {
        console.error('Error reading users directory:', err);
    }
}

removeUsernames();
