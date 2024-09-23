const express = require('express');
const multer = require('multer');
const path = require('path');
const app = express();
const port = 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads');
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});

const upload = multer({ storage: storage });

let items = [];

// Admin routes
app.get('/admin', (req, res) => {
  res.send(`
    <link rel="stylesheet" href="/styles.css">
    <div class="admin-container">
      <div class="admin-form-container">
        <h1>Admin - Hidden Items</h1>
        <form action="/admin/add" method="POST">
          <input type="text" name="name" placeholder="Item Name" required />
          <input type="text" name="clue" placeholder="Clue" required />
          <input type="text" name="code" placeholder="Item Code" required />
          <input type="text" name="directions" placeholder="Directions to Claim Prize" required />
          <button class="button" type="submit">Add Item</button>
        </form>
      </div>
      <div class="admin-items-container">
        <h2>Current Items</h2>
        <ul>
          ${items.map((item, index) => `
            <li>
              ${item.name} (Code: ${item.code}) - Status: ${item.found ? 'Found' : 'Hidden'}
              <form action="/admin/delete/${index}" method="POST">
                <button class="button-red" type="submit">Delete</button>
              </form>
              <button class="button" onclick="document.getElementById('edit-form-${index}').style.display='block'">Edit</button>
              <form id="edit-form-${index}" style="display:none;" action="/admin/edit/${index}" method="POST">
                <input type="text" name="name" value="${item.name}" required />
                <input type="text" name="clue" value="${item.clue}" required />
                <input type="text" name="code" value="${item.code}" required />
                <input type="text" name="directions" value="${item.directions}" required />
                <button class="button" type="submit">Update</button>
              </form>
            </li>
          `).join('')}
        </ul>
      </div>
    </div>
  `);
});

app.post('/admin/add', (req, res) => {
  const { name, clue, code, directions } = req.body;
  items.push({ name, clue, code, directions, found: false });
  res.redirect('/admin');
});

app.post('/admin/delete/:index', (req, res) => {
  items.splice(req.params.index, 1);
  res.redirect('/admin');
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
    <div class="user-container">
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
        `).join('') : '<p>No items currently hidden.</p>'}
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
      <div class="user-container">
        <h1>Congratulations!</h1>
        <p>You found the item!</p>
        <p>Enter Item Code to Claim Your Prize:</p>
        <form action="/upload" method="POST" enctype="multipart/form-data">
          <input type="hidden" name="code" value="${item.code}" />
          <input type="text" name="inputCode" placeholder="Item Code" required />
          <label>Photo Proof:</label>
          <input type="file" name="photo" required />
          <button type="submit">Submit Photo</button>
        </form>
      </div>
    `);
  } else {
    res.send('Invalid code. Please try again.');
  }
});

app.post('/upload', upload.single('photo'), (req, res) => {
  const item = items.find(item => item.code === req.body.code);
  
  if (item && req.body.inputCode === item.code) {
    item.found = true;
    res.send(`
      <link rel="stylesheet" href="/styles.css">
      <div class="user-container">
        <h1>Congratulations!</h1>
        <p>You are a champion!</p>
        <p>The Prize: ${item.directions}</p>
        <p>Your uploaded image:</p>
        <img src="/uploads/${req.file.filename}" alt="Prize" />
      </div>
    `);
  } else {
    res.send('Invalid item code. Please try again.');
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
