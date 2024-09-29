const express = require('express');
const multer = require('multer');
const path = require('path');
const axios = require('axios');
const session = require('express-session');
const { TwitterApi } = require('twitter-api-v2');
const { MongoClient, ObjectId } = require('mongodb');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));
app.use(session({ secret: 'your_secret_key', resave: false, saveUninitialized: true }));

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

let DROPBOX_ACCESS_TOKEN = process.env.DROPBOX_ACCESS_TOKEN;
const REFRESH_TOKEN = process.env.DROPBOX_REFRESH_TOKEN;

// MongoDB setup
let cachedDb = null;

async function connectToDatabase() {
    if (cachedDb) {
        return cachedDb;
    }
    const client = await MongoClient.connect(process.env.MONGODB_URI);
    const db = client.db('findr');
    cachedDb = db;
    return db;
}

// Middleware to ensure database connection
const withDatabase = (handler) => async (req, res, next) => {
    try {
        req.db = await connectToDatabase();
        return handler(req, res, next);
    } catch (error) {
        console.error('Database connection error:', error);
        return res.status(500).json({ error: 'Unable to connect to the database' });
    }
};

// Initialize Twitter client
const twitterClient = new TwitterApi({
    appKey: process.env.X_API_KEY,
    appSecret: process.env.X_API_KEY_SECRET,
    accessToken: process.env.X_ACCESS_TOKEN,
    accessSecret: process.env.X_ACCESS_TOKEN_SECRET,
});

// Function to refresh the Dropbox access token
async function refreshAccessToken() {
    try {
        const response = await axios.post('https://api.dropboxapi.com/oauth2/token', null, {
            params: {
                grant_type: 'refresh_token',
                refresh_token: REFRESH_TOKEN,
                client_id: process.env.DROPBOX_CLIENT_ID,
                client_secret: process.env.DROPBOX_CLIENT_SECRET,
            },
        });
        DROPBOX_ACCESS_TOKEN = response.data.access_token;
        console.log('Dropbox access token refreshed successfully');
    } catch (error) {
        console.error('Error refreshing token:', error.response?.data || error.message);
    }
}

// Tweet functions
const tweetItemHidden = async (itemName) => {
    const message = `NEW HIDDEN ITEM ALERT | ${itemName}`;
    try {
        await twitterClient.v2.tweet(message);
        console.log(`Tweeted: ${message}`);
    } catch (err) {
        console.error('Error tweeting:', err);
    }
};

const tweetItemFound = async (itemName) => {
    const message = `ITEM FOUND | ${itemName}`;
    try {
        await twitterClient.v2.tweet(message);
        console.log(`Tweeted: ${message}`);
    } catch (err) {
        console.error('Error tweeting:', err);
    }
};

// Admin login route
app.get('/admin/login', (req, res) => {
    res.send(`
        <link rel="stylesheet" href="/styles.css">
        <div class="admin-container">
            <h1>Admin Login</h1>
            <form action="/admin/login" method="POST">
                <input type="password" name="password" placeholder="Password" required />
                <button type="submit">Login</button>
            </form>
        </div>
    `);
});

app.post('/admin/login', (req, res) => {
    const { password } = req.body;
    if (password === 'viewsonic') {
        req.session.isAuthenticated = true;
        return res.redirect('/admin');
    }
    res.send('Invalid password. Please try again.');
});

// Admin routes
app.get('/admin', withDatabase(async (req, res) => {
    if (!req.session.isAuthenticated) {
        return res.redirect('/admin/login');
    }

    try {
        console.log('Attempting to fetch items from MongoDB...');
        const items = await req.db.collection('items').find().toArray();
        console.log(`Successfully fetched ${items.length} items from MongoDB`);

        const itemList = items.map((item) => `
            <li class="item-list">
                <strong>${item.name}</strong> - ${item.found ? 'Found' : 'Hidden'}
                <form action="/admin/edit/${item._id}" method="GET" class="inline-form">
                    <button class="button" type="submit">Edit</button>
                </form>
                <form action="/admin/delete/${item._id}" method="POST" class="inline-form">
                    <button class="button button-red" type="submit">Delete</button>
                </form>
            </li>
        `).join('');

        res.send(`
            <link rel="stylesheet" href="/styles.css">
            <div class="admin-container">
                <h1>Admin - Hidden Items</h1>
                <form action="/admin/add" method="POST" class="admin-form">
                    <input type="text" name="name" placeholder="Item Name" required />
                    <input type="text" name="clue" placeholder="Clue" required />
                    <input type="text" name="code" placeholder="Item Code" required />
                    <input type="text" name="directions" placeholder="Directions to Claim Prize" required />
                    <button class="button" type="submit">Add Item</button>
                </form>
                <h2>Current Hidden Items:</h2>
                <ul>${itemList}</ul>
            </div>
        `);
    } catch (error) {
        console.error('Error in /admin route:', error);
        res.status(500).send('An error occurred while loading the admin page. Please check server logs for more information.');
    }
}));

app.post('/admin/add', withDatabase(async (req, res) => {
    const { name, clue, code, directions } = req.body;
    try {
        console.log('Adding new item:', { name, clue, code });
        const result = await req.db.collection('items').insertOne({ name, clue, code, directions, found: false });
        console.log('Item added successfully:', result);
        await tweetItemHidden(name);
        res.redirect('/admin');
    } catch (error) {
        console.error('Error adding item:', error);
        res.status(500).send('An error occurred while adding the item.');
    }
}));

app.post('/admin/delete/:id', withDatabase(async (req, res) => {
    try {
        console.log('Deleting item with ID:', req.params.id);
        const result = await req.db.collection('items').deleteOne({ _id: new ObjectId(req.params.id) });
        console.log('Delete result:', result);
        res.redirect('/admin');
    } catch (error) {
        console.error('Error deleting item:', error);
        res.status(500).send('An error occurred while deleting the item.');
    }
}));

// Edit route
app.get('/admin/edit/:id', withDatabase(async (req, res) => {
    try {
        console.log('Fetching item for edit with ID:', req.params.id);
        const item = await req.db.collection('items').findOne({ _id: new ObjectId(req.params.id) });
        console.log('Item fetched for edit:', item);
        if (!item) {
            return res.status(404).send('Item not found');
        }
        res.send(`
            <link rel="stylesheet" href="/styles.css">
            <div class="admin-container">
                <h1>Edit Item</h1>
                <form action="/admin/edit/${item._id}" method="POST" class="admin-form">
                    <input type="text" name="name" value="${item.name}" required />
                    <input type="text" name="clue" value="${item.clue}" required />
                    <input type="text" name="code" value="${item.code}" required />
                    <input type="text" name="directions" value="${item.directions}" required />
                    <button class="button" type="submit">Update Item</button>
                </form>
            </div>
        `);
    } catch (error) {
        console.error('Error fetching item for edit:', error);
        res.status(500).send('An error occurred while fetching the item for editing.');
    }
}));

app.post('/admin/edit/:id', withDatabase(async (req, res) => {
    const { name, clue, code, directions } = req.body;
    try {
        console.log('Updating item with ID:', req.params.id);
        const result = await req.db.collection('items').updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: { name, clue, code, directions } }
        );
        console.log('Update result:', result);
        res.redirect('/admin');
    } catch (error) {
        console.error('Error updating item:', error);
        res.status(500).send('An error occurred while updating the item.');
    }
}));

// User routes
app.get('/', withDatabase(async (req, res) => {
    try {
        console.log('Fetching hidden items');
        const hiddenItems = await req.db.collection('items').find({ found: false }).toArray();
        console.log('Hidden items found:', hiddenItems);

        res.send(`
            <link rel="stylesheet" href="/styles.css">
            <div class="user-container center-text">
                <h1>WESTHAVEN SCAVENGER</h1>
                <h2>Hidden Items:</h2>
                <div>
                    ${hiddenItems.length > 0 ? hiddenItems.map(item => `
                        <div class="card">
                            <strong>${item.name}</strong>
                            <p>${item.clue}</p>
                            <form action="/found" method="POST">
                                <input type="hidden" name="code" value="${item.code}" />
                                <button class="button" type="submit">FOUND IT</button>
                            </form>
                        </div>
                    `).join('') : '<p class="center-text">No items currently hidden.</p>'}
                </div>
            </div>
        `);
    } catch (error) {
        console.error('Error fetching hidden items:', error);
        res.status(500).send('An error occurred while fetching hidden items.');
    }
}));

app.post('/found', withDatabase(async (req, res) => {
    const { code } = req.body;
    try {
        console.log('Searching for item with code:', code);
        const item = await req.db.collection('items').findOne({ code });
        console.log('Item found:', item);
        
        if (item) {
            res.send(`
                <link rel="stylesheet" href="/styles.css">
                <div class="user-container center-text">
                    <h1>Congratulations!</h1>
                    <p>You found the item!</p>
                    <p>Enter Code for Reward:</p>
                    <form action="/upload" method="POST" enctype="multipart/form-data" class="center-text">
                        <input type="hidden" name="code" value="${item.code}" />
                        <input type="text" name="inputCode" placeholder="Item Code" required /><br />
                        <label>Photo Proof:</label><br />
                        <div class="file-input-container">
                            <input type="file" name="photo" required />
                        </div>
                        <div class="button-container">
                            <button type="submit" class="button">Submit Photo</button>
                        </div>
                    </form>
                    <br />
                    <a href="/" class="button">Go Back</a>
                </div>
            `);
        } else {
            res.send('Invalid code. Please try again.');
        }
    } catch (error) {
        console.error('Error processing found item:', error);
        res.status(500).send('An error occurred while processing the found item.');
    }
}));
app.post('/upload', upload.single('photo'), withDatabase(async (req, res) => {
    await refreshAccessToken();

    try {
        console.log('Upload request received for code:', req.body.code);
        
        const item = await req.db.collection('items').findOne({ code: req.body.code });
        console.log('Item found in database:', item);

        if (!item) {
            console.log('Item not found in database');
            return res.status(404).send('Item not found. Please try again.');
        }

        if (item.found) {
            console.log('Item already marked as found');
            return res.status(400).send('This item has already been found.');
        }

        if (req.body.inputCode !== item.code) {
            console.log('Invalid code provided');
            return res.status(400).send('Invalid code. Please try again.');
        }

        const photoBuffer = req.file.buffer;
        const fileName = `${Date.now()}_${req.file.originalname}`;

        console.log('Uploading photo to Dropbox');
        const uploadResponse = await axios.post('https://content.dropboxapi.com/2/files/upload', photoBuffer, {
            headers: {
                'Authorization': `Bearer ${DROPBOX_ACCESS_TOKEN}`,
                'Dropbox-API-Arg': JSON.stringify({
                    path: `/uploads/${fileName}`,
                    mode: 'add',
                    autorename: true,
                    mute: false,
                }),
                'Content-Type': 'application/octet-stream',
            },
        });
        console.log('Photo uploaded successfully');

        console.log('Creating shared link for photo');
        const sharedLinkResponse = await axios.post('https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings', {
            path: uploadResponse.data.path_lower,
            settings: {
                requested_visibility: 'public',
            },
        }, {
            headers: {
                'Authorization': `Bearer ${DROPBOX_ACCESS_TOKEN}`,
                'Content-Type': 'application/json',
            },
        });
        console.log('Shared link created successfully');

        console.log('Updating item status in database');
        const updateResult = await req.db.collection('items').updateOne(
            { _id: item._id },
            { $set: { found: true } }
        );
        console.log('Update result:', updateResult);

        if (updateResult.modifiedCount === 0) {
            console.log('Failed to update item status');
            throw new Error('Failed to update item status');
        }

        console.log('Tweeting about found item');
        await tweetItemFound(item.name);

        const photoUrl = sharedLinkResponse.data.url.replace('www.dropbox.com', 'dl.dropboxusercontent.com').replace('https://', 'https://');

        console.log('Sending success response to user');
        res.send(`
            <link rel="stylesheet" href="/styles.css">
            <div class="user-container center-text">
                <h1>Congratulations!</h1>
                <p>You found the item: ${item.name}</p>
                <p>Here's your photo:</p>
                <img src="${photoUrl}" alt="Your proof" style="max-width: 300px;" />
                <br>
                <h2>Directions to Claim Your Prize:</h2>
                <p>${item.directions}</p>
                <br>
                <button class="button" onclick="window.location.href='/'">Back to Home</button>
            </div>
        `);
    } catch (error) {
        console.error('Error processing upload:', error);
        res.status(500).send('An error occurred while processing your upload. Please try again.');
    }
}));

app.listen(port, () => {
    console.log(`Server is ready to handle requests on port ${port}`);
});

module.exports = app;
