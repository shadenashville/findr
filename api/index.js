const express = require('express');
const multer = require('multer');
const path = require('path');
const axios = require('axios');
require('dotenv').config(); // Load environment variables

const app = express();
const port = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

const storage = multer.memoryStorage(); // Store files in memory
const upload = multer({ storage: storage });

let items = [];

// Use environment variable for Dropbox access token
const DROPBOX_ACCESS_TOKEN = process.env.DROPBOX_ACCESS_TOKEN;

// Admin routes
app.get('/admin', (req, res) => {
  const itemList = items.map((item, index) => `
    <li class="item-list">
      <strong>${item.name}</strong> - ${item.found ? 'Found' : 'Hidden'}
      <form action="/admin/edit/${index}" method="GET" class="inline-form">
        <button class="button" type="submit">Edit</button>
      </form>
      <form action="/admin/delete/${index}" method="POST" class="inline-form">
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
});

// Admin add, delete, edit routes
app.post('/admin/add', (req, res) => {
  const { name, clue, code, directions } = req.body;
  items.push({ name, clue, code, directions, found: false });
  res.redirect('/admin');
});

app.post('/admin/delete/:index', (req, res) => {
  items.splice(req.params.index, 1);
  res.redirect('/admin');
});

// Edit route
app.get('/admin/edit/:index', (req, res) => {
  const item = items[req.params.index];
  res.send(`
    <link rel="stylesheet" href="/styles.css">
    <div class="admin-container">
      <h1>Edit Item</h1>
      <form action="/admin/edit/${req.params.index}" method="POST" class="admin-form">
        <input type="text" name="name" value="${item.name}" required />
        <input type="text" name="clue" value="${item.clue}" required />
        <input type="text" name="code" value="${item.code}" required />
        <input type="text" name="directions" value="${item.directions}" required />
        <button class="button" type="submit">Update Item</button>
      </form>
    </div>
  `);
});

app.post('/admin/edit/:index', (req, res) => {
  const { name, clue, code, directions } = req.body;
  items[req.params.index] = { name, clue, code, directions, found: items[req.params.index].found };
  res.redirect('/admin');
});

// User routes
app.get('/', (req, res) => {
  const hiddenItems = items.filter(item => !item.found);
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
});

app.post('/found', (req, res) => {
  const { code } = req.body;
  const item = items.find(item => item.code === code);
  
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
});

app.post('/upload', upload.single('photo'), async (req, res) => {
  const item = items.find(item => item.code === req.body.code);
  
  if (item && req.body.inputCode === item.code) {
    const photoBuffer = req.file.buffer;
    const fileName = `${Date.now()}_${req.file.originalname}`;
    
    try {
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

      item.found = true; // Update status here
      const prizeImageUrl = sharedLinkResponse.data.url.replace('www.dropbox.com', 'dl.dropboxusercontent.com');

      res.send(`
        <link rel="stylesheet" href="/styles.css">
        <div class="user-container center-text">
          <h1>Congratulations!</h1>
          <p>Reward: ${item.directions}</p>
          <p>Your uploaded image:</p>
          <img src="${prizeImageUrl}" alt="Prize Image" class="uploaded-photo" />
          <br />
          <a href="/" class="button">Go Back</a>
        </div>
      `);
      
    } catch (error) {
      console.error(error);
      res.send('Error uploading photo to Dropbox.');
    }
  } else {
    res.send('Invalid item code. Please try again.');
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
