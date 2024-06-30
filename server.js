const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 3000;

app.use(express.static('images'));

app.post('/save-image', (req, res) => {
  let imageData = '';
  req.on('data', chunk => {
    imageData += chunk;
  });
  req.on('end', () => {
    const imageBuffer = Buffer.from(imageData, 'base64');
    const imageName = `${uuidv4()}.jpg`;
    const imagePath = path.join(__dirname, 'images', imageName);

    fs.writeFileSync(imagePath, imageBuffer);

    res.json({ url: `http://localhost:${PORT}/${imageName}` });
  });
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});